import {useEffect,useRef,useState} from 'react';
import {ArrowRight,MessageCircle,ShieldCheck} from 'lucide-react';
import './planning-assistant.css';
type Run={runId:string;source:'bedrock'|'contract-test';outcome:'completed'|'needs_clarification'|'stopped';reason?:string;canPrepareDraft:boolean;draftWarning?:string;
 answer?:{summary:string;questions:string[];citations:string[];tasks:{type:string;turn:number;quote:string;timeQuote?:string}[]};
 facts:{id:string;tool:string;observedAt:string;data:unknown}[];modelCalls:number;inputTokens:number;outputTokens:number;estimatedCostUsd:number};
type Props={householdId:string;source:string;api:(path:string,init?:RequestInit)=>Promise<any>;onPlan:(plan:any)=>void;onDirtyChange:(dirty:boolean)=>void};
const labels:Record<string,string>={read_coverage:'Checked current coverage',check_helpers:'Checked helper boundaries',rehearse_gap:'Rehearsed a missing helper',look_up_policy:'Read the coordination policy'};
export function PlanningAssistant({householdId,source,api,onPlan,onDirtyChange}:Props){
 const [text,setText]=useState(''),[consent,setConsent]=useState(false),[run,setRun]=useState<Run|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [turns,setTurns]=useState(0),[retryPending,setRetryPending]=useState(false);
 const attempt=useRef<{text:string;parentRunId?:string;runId:string}|null>(null),generation=useRef(0);
 const callbacks=useRef({api,onPlan,onDirtyChange});callbacks.current={api,onPlan,onDirtyChange};
 useEffect(()=>{callbacks.current.onDirtyChange(!!text.trim()||busy);},[text,busy]);
 useEffect(()=>()=>{generation.current++;callbacks.current.onDirtyChange(false);},[householdId]);
 async function consult(){
  if(busy||!consent||text.trim().length<4||turns>=3)return;
  if(!attempt.current||attempt.current.text!==text||attempt.current.parentRunId!==run?.runId)attempt.current={text,parentRunId:run?.runId,runId:crypto.randomUUID()};
  const current=++generation.current;setBusy(true);setError('');
  try{
   const result=await callbacks.current.api('/api/agent/runs',{method:'POST',body:JSON.stringify({...attempt.current,householdId,consent:true})}) as Run;
   if(current!==generation.current)return;setRun(result);setText('');setTurns(value=>value+1);attempt.current=null;setRetryPending(false);
  }catch(cause){if(current===generation.current){setError(cause instanceof Error?cause.message:String(cause));setRetryPending(true);}}
  finally{if(current===generation.current)setBusy(false);}
 }
 async function prepare(){if(!run||busy||text.trim())return;const current=++generation.current;setBusy(true);setError('');try{
  const plan=await callbacks.current.api(`/api/agent/runs/${run.runId}/draft`,{method:'POST',body:'{}'});if(current===generation.current)callbacks.current.onPlan(plan);
 }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(current===generation.current)setBusy(false);}}
 return <section className="planning-assistant" aria-label="Planning assistant">
  <div className="assistant-intro"><MessageCircle size={21}/><div><h2>Let’s work through it.</h2><p>Explain the situation. The assistant can check facts, explore a gap and ask what is missing.</p></div></div>
  <p className="assistant-mode">{source==='contract-test'?'Injected tool-loop test. No live AI model.':'Amazon Bedrock · AI suggestions, with source receipts'}</p>
  {run&&<div className="assistant-result" aria-live="polite">
   {run.outcome==='stopped'?<p role="status">The assistant stopped ({run.reason}). No plan was approved or sent. You can use the ordinary planner.</p>:<>
    <span className="eyebrow">ASSISTANT SUGGESTION</span><p>{run.answer?.summary}</p>
    {!!run.answer?.questions.length&&<div className="assistant-questions"><h3>What still needs an answer</h3>{run.answer.questions.map((question,index)=><p key={index}>{question}</p>)}</div>}
    {!!run.answer?.tasks.length&&<div className="assistant-quotes"><h3>Proposed needs</h3>{run.answer.tasks.map((task,index)=><blockquote key={index}>{task.quote}{task.timeQuote&&<span>Clarified: {task.timeQuote}</span>}</blockquote>)}</div>}
    <details className="focus-disclosure"><summary>See the factual checks ({run.facts.length})</summary><p>Only the records below are factual observations. The explanation above is a model suggestion. Eligibility does not mean acceptance.</p>{run.facts.map(fact=><article key={fact.id}><h4>{labels[fact.tool]||fact.tool}</h4><small>{fact.id} · {new Date(fact.observedAt).toLocaleString()}</small><pre>{JSON.stringify(fact.data,null,2)}</pre></article>)}<small>{run.modelCalls} model calls · {run.inputTokens+run.outputTokens} reported tokens · estimated inference ${run.estimatedCostUsd.toFixed(5)}. Not a bill or spending cap.</small></details>
    {run.canPrepareDraft&&<><p className="assistant-boundary">{run.draftWarning}</p><button className="primary" disabled={busy||!!text.trim()} onClick={()=>void prepare()}>Prepare drafts for my review<ArrowRight size={16}/></button></>}
   </>}
  </div>}
  {error&&<p role="alert" className="focus-form-error">{error}</p>}
  {turns<3&&<div className="assistant-input"><label htmlFor="assistant-situation">{run?'Add the missing details':'What needs arranging?'}</label><textarea id="assistant-situation" rows={4} maxLength={1000} value={text} disabled={busy} onChange={event=>{setText(event.target.value);setRetryPending(false);}} placeholder="Dinner Friday, a Saturday visit and a Monday ride. One helper might cancel. What should I check?"/>
   <label className="checkline"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>Use this fictional conversation and pseudonymous coverage/availability facts with the configured model.</label>
   <small>No stored names, addresses, task notes or locations are retrieved for the model. Anything you type can be sent. Use fictional data and leave private information out.</small>
   <button className="secondary" disabled={busy||!consent||text.trim().length<4} onClick={()=>void consult()}>{busy?'Checking the plan…':retryPending?'Check this attempt again':'Work through this'}<ArrowRight size={16}/></button>
  </div>}
  {turns>=3&&<p>The three-turn conversation limit is reached. Start a new conversation for another situation.</p>}
  <p className="focus-wizard-assurance"><ShieldCheck size={14}/>The assistant cannot approve outreach, contact helpers or mark work done.</p>
 </section>;
}
