import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { Database } from './db.js';
import { parseAtlasTasks, type AtlasTask } from './atlas-parser.js';
import { AppError, type Actor } from './service.js';
import { modelInputTokenAllowance, modelOutputTokenLimit, type ModelLimits } from './bedrock-proposer.js';
import { fingerprint, proposalVersion, proposalInputProblem, proposalMessages, ProposalRejected, validateProposal,
  type ProposalProvider, type ProposalReceipt } from './proposals.js';

export type ProposalResult={tasks:AtlasTask[];receipt:ProposalReceipt};
export class ProposalService {
  constructor(private db:Database,readonly provider:ProposalProvider,private limits:ModelLimits){}
  async propose(actor:Actor,householdId:string,text:string,timeZone:string,key:string,now=new Date()):Promise<ProposalResult>{
    z.uuid().parse(key);
    const problem=proposalInputProblem(text);if(problem)throw new AppError(422,`Model drafting stopped: ${problem}. Edit the request or prepare manually.`);
    const input=proposalMessages(text,timeZone,now);
    if(Buffer.byteLength(input.system+input.user)>6000)throw new AppError(422,'Model input exceeds the bounded prompt allowance.');
    const hash=fingerprint(JSON.stringify({text,timeZone,version:proposalVersion,modelId:this.provider.modelId,source:this.provider.source}));
    const reserveMicros=Math.ceil(modelInputTokenAllowance*this.limits.inputUsdPerMillion+modelOutputTokenLimit*this.limits.outputUsdPerMillion);
    const cached=await this.db.transaction(async tx=>{
      const access=await tx.query(`SELECT m.id FROM memberships m JOIN households h ON h.id=m.household_id
        WHERE m.household_id=$1 AND m.user_id=$2 AND m.role='organizer' AND m.status='active'
        AND h.consent_attested_at IS NOT NULL FOR SHARE OF m`,[householdId,actor.id]);
      if(!access.rows.length)throw new AppError(403,'Only an active organizer with household consent can use model drafting.');
      const day=String((await tx.query("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day")).rows[0].day);
      await tx.query('INSERT INTO model_budget(day) VALUES($1) ON CONFLICT DO NOTHING',[day]);
      const budget=(await tx.query('SELECT * FROM model_budget WHERE day=$1 FOR UPDATE',[day])).rows[0];
      const prior=(await tx.query('SELECT * FROM model_calls WHERE id=$1',[key])).rows[0];
      if(prior){
        if(prior.actor_id!==actor.id||prior.household_id!==householdId||prior.input_hash!==hash)throw new AppError(409,'This proposal key belongs to a different request.');
        if(prior.status==='pending')throw new AppError(409,'This proposal is still running or was interrupted. No automatic model retry will occur.');
        if(prior.status==='failed')throw new AppError(422,'This proposal needs a clarified request. No automatic model retry will occur.');
        return prior.result as ProposalResult;
      }
      if(budget.calls>=this.limits.maxCalls||Number(budget.reserved_micros)+reserveMicros>this.limits.dailyMicros)throw new AppError(429,'The configured model trial allowance is exhausted. Use deterministic drafting.');
      await tx.query('UPDATE model_budget SET calls=calls+1,reserved_micros=reserved_micros+$2 WHERE day=$1',[day,reserveMicros]);
      await tx.query('INSERT INTO model_calls(id,household_id,actor_id,input_hash) VALUES($1,$2,$3,$4)',[key,householdId,actor.id,hash]);
      return null;
    });
    if(cached)return cached;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const started=performance.now();
    let result:ProposalResult;
    try {
      let reason='provider_unavailable';
      let usage:{inputTokens:number;outputTokens:number;estimatedCostUsd:number}|undefined;
      try{
        const response=await Promise.race([this.provider.invoke(input,controller.signal),new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>{controller.abort();reject(new ProposalRejected('timeout'));},this.limits.timeoutMs);
        })]);
        const inputTokens=z.number().int().min(0).max(modelInputTokenAllowance).parse(response.inputTokens);
        const outputTokens=z.number().int().min(0).max(modelOutputTokenLimit).parse(response.outputTokens);
        usage={inputTokens,outputTokens,estimatedCostUsd:(inputTokens*this.limits.inputUsdPerMillion+outputTokens*this.limits.outputUsdPerMillion)/1e6};
        const validated=validateProposal(response.raw,text,timeZone,now);
        result={tasks:validated.tasks,receipt:{version:proposalVersion,source:this.provider.source,outcome:'validated',
          modelId:this.provider.modelId,attemptId:key,inputHash:fingerprint(text),promptHash:fingerprint(input.system+input.user),
          elapsedMs:performance.now()-started,...usage,citations:validated.citations}};
      }catch(error){
        if(error instanceof ProposalRejected)reason=error.reason;
        const tasks=parseAtlasTasks(text,timeZone,now);
        for(const task of tasks)task.warnings.push('Model validation was unavailable. Deterministic fallback: check every task and missing fact before approval.');
        result={tasks,receipt:{version:proposalVersion,source:this.provider.source,outcome:'fallback',reason,
          modelId:this.provider.modelId,attemptId:key,inputHash:fingerprint(text),promptHash:fingerprint(input.system+input.user),
          elapsedMs:performance.now()-started,...usage,citations:[]}};
      }
      await this.db.query("UPDATE model_calls SET status='complete',result=$2 WHERE id=$1 AND status='pending'",[key,JSON.stringify(result)]);
      return result;
    }catch{
      await this.db.query("UPDATE model_calls SET status='failed' WHERE id=$1 AND status='pending'",[key]);
      throw new AppError(422,'No validated draft is available. Clarify the request or enter tasks manually.');
    }finally{if(timer)clearTimeout(timer);controller.abort();}
  }
}
