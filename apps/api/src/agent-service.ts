import {z} from 'zod';
import type {Database,Queryable} from './db.js';
import {AppError,type Actor} from './service.js';
import {contactAllowed} from './eligibility.js';
import {taskDateAllowed} from './availability.js';
import {checkSafetyText} from './scope.js';
import {fingerprint} from './proposals.js';
import type {ModelLimits} from './bedrock-proposer.js';
import {AgentInput,AgentAnswer,agentSystem,agentVersion,agentMaxSteps,agentMaxInputTokens,agentMaxOutputTokens,
  groundedTasks,helperRef,policy,tools,wireTools,type AgentProvider,type AgentMessage} from './agent-contract.js';

export type AgentFact={id:string;tool:string;observedAt:string;data:unknown};
export type AgentRun={kind:'agent';version:string;runId:string;source:AgentProvider['source'];modelId:string;outcome:'completed'|'needs_clarification'|'stopped';
  reason?:string;answer?:AgentAnswer;facts:AgentFact[];turns:string[];inputTokens:number;outputTokens:number;modelCalls:number;estimatedCostUsd:number;usageComplete:boolean;
  draftEvidence?:NonNullable<ReturnType<typeof groundedTasks>>};
async function access(tx:Queryable,actor:Actor,householdId:string){
 const row=(await tx.query(`SELECT h.timezone FROM households h JOIN memberships m ON m.household_id=h.id
   WHERE h.id=$1 AND h.closed_at IS NULL AND h.consent_attested_at IS NOT NULL
   AND m.user_id=$2 AND m.role='organizer' AND m.status='active' FOR SHARE OF h,m`,[householdId,actor.id])).rows[0];
 if(!row)throw new AppError(403,'Only an active organizer with household consent can use the assistant.');
 return String(row.timezone);
}
export const publicAgentRun=({turns,draftEvidence,...run}:AgentRun)=>({...run,canPrepareDraft:!!draftEvidence&&run.outcome==='completed',
  draftWarning:draftEvidence?'These are selected source clauses, not proof that every need was captured. Review omissions, dates and helpers.':undefined});

export class AgentService{
 constructor(private db:Database,readonly provider:AgentProvider,private limits:ModelLimits){}
 private async stored(tx:Queryable,actor:Actor,runId:string){
   const row=(await tx.query('SELECT * FROM model_calls WHERE id=$1',[runId])).rows[0];
   if(!row||row.actor_id!==actor.id)throw new AppError(404,'Assistant run not found.');
   await access(tx,actor,row.household_id);
   if(row.status==='pending')throw new AppError(409,'This run is pending or interrupted. It will not automatically retry.');
   if(row.status!=='complete'||row.result?.kind!=='agent')throw new AppError(409,'This run did not finish. No automatic retry.');
   return {householdId:String(row.household_id),run:row.result as AgentRun};
 }
 async get(actor:Actor,runId:string){z.uuid().parse(runId);return this.db.transaction(tx=>this.stored(tx,actor,runId));}
 async run(actor:Actor,raw:unknown):Promise<AgentRun>{
   const input=AgentInput.parse(raw);
   const unsafe=checkSafetyText(input.text);if(unsafe)throw new AppError(422,unsafe);
   const hash=fingerprint(JSON.stringify({version:agentVersion,input,modelId:this.provider.modelId,source:this.provider.source}));
   const reserved=await this.db.transaction(async tx=>{
     const timezone=await access(tx,actor,input.householdId);
     const prior=(await tx.query('SELECT * FROM model_calls WHERE id=$1',[input.runId])).rows[0];
     if(prior){
       if(prior.actor_id!==actor.id||prior.household_id!==input.householdId||prior.input_hash!==hash)throw new AppError(409,'This run key belongs to another request.');
       if(prior.status!=='complete'||prior.result?.kind!=='agent')throw new AppError(409,'This run is pending or interrupted. It will not automatically retry.');
       return {timezone,turns:[] as string[],cached:prior.result as AgentRun};
     }
     const turns=input.parentRunId?(await this.stored(tx,actor,input.parentRunId)):undefined;
     if(turns&&turns.householdId!==input.householdId)throw new AppError(403,'Assistant history belongs to another circle.');
     const history=[...(turns?.run.turns||[]),input.text];
     if(history.length>3||Buffer.byteLength(JSON.stringify(history))>4000)throw new AppError(422,'Start a new conversation after three bounded turns.');
     const day=String((await tx.query("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day")).rows[0].day);
     await tx.query('INSERT INTO model_budget(day) VALUES($1) ON CONFLICT DO NOTHING',[day]);
     const budget=(await tx.query('SELECT * FROM model_budget WHERE day=$1 FOR UPDATE',[day])).rows[0];
     // A competing client may have inserted this key while we waited for the daily lock.
     const concurrent=(await tx.query('SELECT * FROM model_calls WHERE id=$1',[input.runId])).rows[0];
     if(concurrent){
       if(concurrent.actor_id!==actor.id||concurrent.household_id!==input.householdId||concurrent.input_hash!==hash)throw new AppError(409,'This run key belongs to another request.');
       if(concurrent.status!=='complete'||concurrent.result?.kind!=='agent')throw new AppError(409,'This run is pending or interrupted. It will not automatically retry.');
       return {timezone,turns:[] as string[],cached:concurrent.result as AgentRun};
     }
     // Reserve the entire possible tool loop before its first external call. No refund on timeout/crash.
     const micros=agentMaxSteps*Math.ceil(agentMaxInputTokens*this.limits.inputUsdPerMillion+agentMaxOutputTokens*this.limits.outputUsdPerMillion);
     if(Number(budget.calls)+agentMaxSteps>this.limits.maxCalls||Number(budget.reserved_micros)+micros>this.limits.dailyMicros)throw new AppError(429,'The shared model allowance cannot cover another bounded assistant run.');
     await tx.query('UPDATE model_budget SET calls=calls+$2,reserved_micros=reserved_micros+$3 WHERE day=$1',[day,agentMaxSteps,micros]);
     await tx.query('INSERT INTO model_calls(id,household_id,actor_id,input_hash) VALUES($1,$2,$3,$4)',[input.runId,input.householdId,actor.id,hash]);
     return {timezone,turns:history,cached:undefined};
   });
   if(reserved.cached)return reserved.cached;
   const result:AgentRun={kind:'agent',version:agentVersion,runId:input.runId,source:this.provider.source,modelId:this.provider.modelId,outcome:'stopped',facts:[],turns:reserved.turns,inputTokens:0,outputTokens:0,modelCalls:0,estimatedCostUsd:0,usageComplete:false};
   const messages:AgentMessage[]=[{role:'user',content:[{text:JSON.stringify({userTurns:reserved.turns,householdTimezone:reserved.timezone,referenceInstant:new Date().toISOString()})}]}];
   const usedIds=new Set<string>();let toolCount=0,accountedCalls=0;
   try{
     for(let step=0;step<agentMaxSteps;step++){
       await this.db.transaction(tx=>access(tx,actor,input.householdId));
       // Bound total prompt bytes including tool observations; conservative token allowance, not billing cap.
       if(Buffer.byteLength(JSON.stringify(messages)+agentSystem+JSON.stringify(wireTools))>8000)throw new Error('context_limit');
       const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
       let response:Awaited<ReturnType<AgentProvider['invoke']>>;
       try{
         result.modelCalls++;result.usageComplete=false;
         response=await Promise.race([this.provider.invoke({system:agentSystem,messages:structuredClone(messages)},controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},this.limits.timeoutMs);})]);
       }finally{if(timer)clearTimeout(timer);controller.abort();}
       await this.db.transaction(tx=>access(tx,actor,input.householdId));
       result.inputTokens+=z.number().int().min(0).max(agentMaxInputTokens).parse(response.inputTokens);
       result.outputTokens+=z.number().int().min(0).max(agentMaxOutputTokens).parse(response.outputTokens);
       accountedCalls++;result.usageComplete=accountedCalls===result.modelCalls;
       result.estimatedCostUsd=(result.inputTokens*this.limits.inputUsdPerMillion+result.outputTokens*this.limits.outputUsdPerMillion)/1e6;
       const calls=response.message.content.flatMap(block=>'toolUse'in block?[block.toolUse]:[]);
       if(response.stop==='tool_use'){
         if(!calls.length||calls.length>4||toolCount+calls.length>8)throw new Error('tool_limit');
         messages.push(response.message);const content:AgentMessage['content']=[];
         for(const call of calls){
           if(usedIds.has(call.toolUseId)||!call.toolUseId||call.toolUseId.length>100)throw new Error('duplicate_tool_id');
           usedIds.add(call.toolUseId);toolCount++;
           const spec=tools.find(tool=>tool.name===call.name);
           if(!spec||!spec.schema.safeParse(call.input).success)throw new Error('forbidden_tool');
           const data=await this.tool(actor,input.householdId,call.name,call.input);
           const fact={id:`fact_${result.facts.length+1}`,tool:call.name,observedAt:new Date().toISOString(),data};
           if(Buffer.byteLength(JSON.stringify(fact))>8000)throw new Error('tool_result_limit');
           result.facts.push(fact);content.push({toolResult:{toolUseId:call.toolUseId,status:'success',content:[{json:fact}]}});
         }
         messages.push({role:'user',content});continue;
       }
       if(response.stop!=='end_turn'||calls.length||!result.facts.length)throw new Error('unverified_answer');
       const answer=AgentAnswer.parse(JSON.parse(response.message.content.map(block=>'text'in block?block.text:'').join('')));
       if(/\b(?:I|we|the assistant)\s+(?:(?:have|has|already)\s+)*(?:sent|approved|dispatched|contacted|invited|assigned|confirmed|completed)\b/i.test(answer.summary))throw new Error('unsupported_action_claim');
       if(!answer.citations.length||answer.citations.some(id=>!result.facts.some(fact=>fact.id===id)))throw new Error('unknown_citation');
       result.draftEvidence=groundedTasks(answer,reserved.turns,reserved.timezone,new Date());
       result.answer=answer;result.outcome=answer.questions.length?'needs_clarification':'completed';break;
     }
     if(!result.answer)result.reason='step_limit';
   }catch(error){
     if(error instanceof AppError&&error.status===403){await this.db.query("UPDATE model_calls SET status='failed' WHERE id=$1 AND status='pending'",[input.runId]);throw error;}
     const known=['timeout','context_limit','tool_limit','duplicate_tool_id','forbidden_tool','tool_result_limit','unverified_answer','unknown_citation','unsupported_action_claim','ungrounded_task','ungrounded_time','duplicate_task'];
     result.reason=error instanceof Error&&known.includes(error.message)?error.message:'provider_or_validation_failure';
     delete result.answer;delete result.draftEvidence;result.outcome='stopped';
   }
   try{
     await this.db.transaction(async tx=>{await access(tx,actor,input.householdId);await tx.query("UPDATE model_calls SET status='complete',result=$2 WHERE id=$1 AND status='pending'",[input.runId,JSON.stringify(result)]);});
   }catch(error){await this.db.query("UPDATE model_calls SET status='failed' WHERE id=$1 AND status='pending'",[input.runId]);throw error;}
   return result;
 }
 private async tool(actor:Actor,householdId:string,name:string,raw:unknown){
   return this.db.transaction(async tx=>{
     await access(tx,actor,householdId);
     if(name==='look_up_policy')return {topic:(raw as {topic:keyof typeof policy}).topic,text:policy[(raw as {topic:keyof typeof policy}).topic]};
     if(name==='read_coverage'){
       const rows=(await tx.query('SELECT id,type,due_at,status FROM coverage_requests WHERE household_id=$1 ORDER BY due_at,id LIMIT 21',[householdId])).rows;
       return {truncated:rows.length>20,requests:rows.slice(0,20).map(row=>({ref:`task_${fingerprint(String(row.id)).slice(0,12)}`,type:row.type,dueAt:new Date(row.due_at).toISOString(),status:row.status==='seeking'&&new Date(row.due_at)<=new Date()?'uncovered':row.status})),boundary:'Point-in-time facts. Sent is not accepted. Reported is not confirmed.'};
     }
     const input=raw as {type:string;dueAt?:string;excludeHelperRef?:string};
     const rows=(await tx.query(`SELECT m.id,m.status,p.opted_in,p.task_types,p.quiet_start,p.quiet_end,p.timezone,p.unavailable_dates
       FROM memberships m LEFT JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=$1 AND m.role='helper' ORDER BY m.id LIMIT 51`,[householdId])).rows;
     if(rows.length>50)throw new AppError(422,'Too many helper records for the bounded assistant. Use the ordinary planner.');
     const helpers=rows.map(row=>{const reasons:string[]=[];
       if(row.status!=='active')reasons.push('not_active');if(!row.opted_in)reasons.push('not_opted_in');
       if(!Array.isArray(row.task_types)||!row.task_types.includes(input.type))reasons.push('task_type');
       if(!contactAllowed(row))reasons.push('contact_window');
       if(input.dueAt&&!taskDateAllowed(row,input.dueAt))reasons.push('unavailable_date');
       return {ref:helperRef(String(row.id)),eligible:reasons.length===0,reasons};});
     if(name==='rehearse_gap'){
       if(!helpers.some(helper=>helper.ref===input.excludeHelperRef))throw new AppError(422,'Unknown scoped helper reference.');
       return {hypothetical:true,sideEffects:0,excluded:input.excludeHelperRef,alternatives:helpers.filter(helper=>helper.eligible&&helper.ref!==input.excludeHelperRef).map(helper=>helper.ref),boundary:'Candidates only. No acceptance, reassignment or outreach.'};
     }
     return {type:input.type,dueAt:input.dueAt||null,dateChecked:!!input.dueAt,helpers,boundary:'Current contact eligibility only. A missing date leaves date availability unknown. Never a commitment.'};
   });
 }
}
