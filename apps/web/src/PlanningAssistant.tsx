import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,MessageCircle,ShieldCheck} from 'lucide-react';
import {HelpVisual} from './CareVisuals.js';
import './planning-assistant.css';
type Fact={id:string;tool:string;observedAt:string;data:unknown};
type HelperCheck={ref:string;eligible:boolean;reasons:string[]};
type Run={runId:string;source:'bedrock'|'local'|'contract-test';outcome:'completed'|'needs_clarification'|'stopped';reason?:string;canPrepareDraft:boolean;draftWarning?:string;
 answer?:{summary:string;questions:string[];citations:string[];tasks:{type:string;turn:number;quote:string;timeQuote?:string}[]};
 taskPreviews?:{type:string;dueAt:string|null}[];facts:Fact[];modelCalls:number;inputTokens:number;outputTokens:number;estimatedCostUsd:number};
type Person={id:string;display_name?:string;role?:string};
type Props={householdId:string;source:string;people:Person[];api:(path:string,init?:RequestInit)=>Promise<any>;onPlan:(plan:any)=>void;onDirtyChange:(dirty:boolean)=>void};
const typeNames:Record<string,string>={meal:'Dinner',visit:'Check-in',ride:'Ride'};
const factNames:Record<string,string>={read_coverage:'What is already arranged',check_helpers:'Who could be asked',rehearse_gap:'If someone cannot help',look_up_policy:'How your plan stays in your control'};
const reasons:Record<string,string>={not_active:'Invitation not active',not_opted_in:'Has not opted in',task_type:'Does not offer this kind of help',contact_window:'Outside their contact hours',unavailable_date:'Away on this date'};
const statuses:Record<string,string>={seeking:'Waiting for a reply',accepted:'Helper accepted',helper_reported_done:'Needs your confirmation',confirmed_done:'Confirmed done',uncovered:'Needs a helper',cancelled:'Cancelled',disputed:'Needs resolving'};
const dateLabel=(value:string|null|undefined)=>value?new Date(value).toLocaleString(undefined,{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time still to choose';
function FactCard({fact,names}:{fact:Fact;names:Record<string,string>}){
 const data=fact.data as {requests?:{ref:string;type:string;dueAt:string;status:string}[];truncated?:boolean;helpers?:HelperCheck[];type?:string;dueAt?:string;dateChecked?:boolean;hypothetical?:boolean;alternatives?:string[];text?:string};
 return <article className="assistant-fact"><h4>{factNames[fact.tool]||'Plan check'}</h4>
  {fact.tool==='read_coverage'&&<>{data.requests?.length?data.requests.map(task=><p key={task.ref}>{typeNames[task.type]||'Task'} · {dateLabel(task.dueAt)}<strong>{statuses[task.status]||'Check the plan'}</strong></p>):<p>No existing tasks were found in this check.</p>}{data.truncated&&<small>Showing the first 20 tasks. Open Plan for the wider picture.</small>}</>}
  {fact.tool==='check_helpers'&&<><small>{typeNames[data.type||'']||'Help'} · {dateLabel(data.dueAt)}</small>{data.helpers?.map(helper=><p key={helper.ref}><span>{names[helper.ref]||'Invited helper'}</span><strong className={helper.eligible?'eligible':'limited'}>{helper.eligible?data.dateChecked?'Could be asked':'Date still needs checking':helper.reasons.map(reason=>reasons[reason]||'Needs checking').join(' · ')}</strong></p>)}</>}
  {fact.tool==='rehearse_gap'&&<p>{data.alternatives?.length?`${data.alternatives.map(ref=>names[ref]||'Another invited helper').join(', ')} could be considered.`:'No other eligible helper was found in this rehearsal.'}<small>A possibility, not a new commitment. Nothing changes until you review it.</small></p>}
  {fact.tool==='look_up_policy'&&<p>{data.text}</p>}
  <small>Checked {new Date(fact.observedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}. Preferences can change.</small>
 </article>;
}
export function PlanningAssistant({householdId,source,people,api,onPlan,onDirtyChange}:Props){
 const [text,setText]=useState(''),[consent,setConsent]=useState(false),[run,setRun]=useState<Run|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [turns,setTurns]=useState(0),[retryPending,setRetryPending]=useState(false),[names,setNames]=useState<Record<string,string>>({});
 const attempt=useRef<{text:string;parentRunId?:string;runId:string}|null>(null),generation=useRef(0);
 const callbacks=useRef({api,onPlan,onDirtyChange});callbacks.current={api,onPlan,onDirtyChange};
 useEffect(()=>{callbacks.current.onDirtyChange(!!text.trim()||busy);},[text,busy]);
 useEffect(()=>()=>{generation.current++;callbacks.current.onDirtyChange(false);},[householdId]);
 useEffect(()=>{let current=true;void Promise.all(people.filter(person=>person.role==='helper').map(async person=>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(person.id));return [`helper_${Array.from(new Uint8Array(hash)).map(value=>value.toString(16).padStart(2,'0')).join('').slice(0,12)}`,person.display_name||'Invited helper'];})).then(pairs=>{if(current)setNames(Object.fromEntries(pairs));}).catch(()=>{if(current)setNames({});});return()=>{current=false;};},[people,householdId]);
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
 const example=source==='contract-test';
 return <section className="planning-assistant" aria-label="Planning assistant">
  <div className="assistant-intro"><span className="assistant-symbol"><MessageCircle size={23}/></span><div><h2>One conversation. A clearer week.</h2><p>Tell Relief what needs arranging. We’ll check the details together.</p></div></div>
  {example&&<details className="assistant-example-note"><summary>Example conversation</summary><p>This walkthrough uses prewritten assistant responses and fictional people. A live AI model is not connected.</p></details>}
  {run&&<div className="assistant-result" aria-live="polite">
   {run.outcome==='stopped'?<><p role="status">I couldn’t finish this plan. Nothing has been sent. You can still prepare it yourself.</p><details className="focus-disclosure"><summary>What happened?</summary><p>{run.reason||'This attempt did not finish.'}</p></details></>:<>
    <span className="eyebrow">A PLAN TO REVIEW</span><p className="assistant-summary">{run.answer?.tasks.length?run.answer.tasks.length===1?'Let’s review this request.':`Let’s review these ${['','one','two','three','four','five'][run.answer.tasks.length]} requests.`:run.answer?.summary}</p>
    {!!run.answer?.questions.length&&(run.canPrepareDraft&&run.taskPreviews?.every(task=>!!task.dueAt)?<details className="assistant-optional-questions"><summary>Questions to consider during review</summary>{run.answer.questions.map((question,index)=><p key={index}>{question}</p>)}</details>:<div className="assistant-questions"><h3>One thing to check</h3>{run.answer.questions.map((question,index)=><p key={index}>{question}</p>)}</div>)}
    {!!run.answer?.tasks.length&&<div className="assistant-week" aria-label="Proposed help">{run.answer.tasks.map((task,index)=>{
      const preview=run.taskPreviews?.[index];
      const checks=run.facts.filter(fact=>fact.tool==='check_helpers').map(fact=>fact.data as {type:string;dueAt?:string;dateChecked:boolean;helpers:HelperCheck[]});
      const match=preview?.dueAt?checks.find(check=>check.type===task.type&&check.dateChecked&&check.dueAt&&Date.parse(check.dueAt)===Date.parse(preview.dueAt!)):undefined;
      const candidates=match?.helpers.filter(helper=>helper.eligible).map(helper=>names[helper.ref]).filter(Boolean)||[];
      return <article className="assistant-need" key={index}><span className={`task-art ${task.type}`}><HelpVisual type={task.type as 'meal'|'visit'|'ride'}/></span><div><small>{dateLabel(preview?.dueAt)}</small><h3>{task.quote}</h3>{task.timeQuote&&<p>Clarified: {task.timeQuote}</p>}<p>{candidates.length?`Could ask ${candidates.join(' or ')}.`:match?'No eligible helper found. Choose another option in review.':'Choose a helper during review.'}</p></div><span className="assistant-draft-badge">Draft</span></article>;
    })}</div>}
    {run.canPrepareDraft&&<div className="assistant-handoff"><p>Check that every need is here. You’ll choose helpers and review the messages next.</p><button className="primary" disabled={busy||!!text.trim()} onClick={()=>void prepare()}>Review this plan<ArrowRight size={16}/></button></div>}
    <details className="focus-disclosure assistant-checks"><summary>What Relief checked ({run.facts.length})</summary><p>These are current records. A possible helper still needs to accept.</p><details className="assistant-model-note"><summary>Assistant’s note</summary><p>{run.answer?.summary}</p><small>This is a model suggestion. Use the factual checks below to verify it.</small></details>{run.facts.map(fact=><FactCard key={fact.id} fact={fact} names={names}/>)}<details className="assistant-technical"><summary>Technical receipt</summary><p>{run.modelCalls} {example?'injected test responses':'model calls'} · {run.inputTokens+run.outputTokens} reported tokens · estimated inference ${run.estimatedCostUsd.toFixed(5)}. This is not a bill or a spending cap.</p><pre>{JSON.stringify({source:run.source,facts:run.facts},null,2)}</pre></details></details>
   </>}
  </div>}
  {error&&<p role="alert" className="focus-form-error">{error}</p>}
  {turns<3&&(!run?.canPrepareDraft||!!text.trim())&&<div className="assistant-input"><label htmlFor="assistant-situation">{run?'Add the missing details':'What needs arranging?'}</label><textarea id="assistant-situation" rows={4} maxLength={1000} value={text} disabled={busy} onChange={event=>{setText(event.target.value);setRetryPending(false);}} placeholder="Dad needs dinner Friday, a visit Saturday and a ride Monday. Can you help me work out a plan?"/>
   <label className="checkline"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>{example?'Continue with this fictional example.':'Use AI to help plan this request.'}</label>
   {!example&&<small>{source==='local'?'AI runs on this device. Keep private details out of this fictional demo.':'Your messages and limited availability facts may be sent to the configured AI service. Keep private details out.'}</small>}
   <button className="primary" disabled={busy||!consent||text.trim().length<4} onClick={()=>void consult()}>{busy?'Working through the details…':retryPending?'Check this attempt again':run?'Continue the conversation':'Help me make a plan'}<ArrowRight size={16}/></button>
  </div>}
  {run?.canPrepareDraft&&turns<3&&!text.trim()&&<button className="text-button assistant-refine" disabled={busy} onClick={()=>setText('I also need ')}>Add another detail</button>}
  {turns>=3&&<p>This conversation has reached its limit. Start a new one for another situation.</p>}
  <p className="focus-wizard-assurance"><ShieldCheck size={14}/>You review every message. Nothing is sent until you approve.</p>
 </section>;
}
