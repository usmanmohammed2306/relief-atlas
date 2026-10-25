import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FlaskConical, LockKeyhole } from 'lucide-react';
import './atlas.css';
import './planner-focus.css';
import { HelpVisual } from './CareVisuals.js';
import { deadlineInstant } from './deadline.js';
import { ReviewChanges } from './ReviewChanges.js';

import { taskDateAvailability } from './task-availability.js';

type Task={type:'meal'|'visit'|'ride';title:string;brief:string;dueAt:string|null;recipientIds:string[];location:string;instructions:string;warnings:string[]};
type Outreach={recipients:{email:string;wave:number}[];subject:string|null;text:string|null;html:string|null};
type Clarification={taskIndex:number;field:'dueAt';code:string;question:string;explanation:string};
type Plan={id:string;householdId:string;digest:string;tasks:Task[];outreach:Outreach[];status:string;sourceText:string;expiresAt:string;deliveryMode:'email'|'in_app'|'simulated';recoverySourceId?:string|null;needsRefresh?:boolean;clarifications?:Clarification[];proposal?:{source?:string;outcome?:string;reason?:string;modelId?:string;attemptId?:string;inputHash?:string;promptHash?:string;inputTokens?:number;outputTokens?:number;estimatedCostUsd?:number;citations?:{taskIndex:number;start:number;end:number;type:string;timeSource:string}[]}};
type Rehearsal={mode:string;sideEffects:number;sourcePlanId:string;snapshotDigest:string;snapshotAt:string;excludedMembershipId:string;queuedJobsAtSnapshot:number;scenarios:{title:string;selectedBefore:string[];remainingApproved:string[];uncoveredIfDeclined:boolean;possibleNewCandidates:string[]}[]};
type McpTrace={protocol:string;server:string;toolCount:number;tool:string;steps:string[]};
type Person={id:string;email:string;display_name:string;role:string;status:string;opted_in?:boolean;task_types?:string[];contact_allowed?:boolean;timezone?:string;unavailable_dates?:string[]};
type Props={householdId:string;people:Person[];demo:boolean;deliveryMode:'email'|'simulated'|'in_app';initialPlanId?:string|null;api:(path:string,init?:RequestInit)=>Promise<any>;onApproved:()=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void};

function localInput(iso:string|null){if(!iso)return '';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
const names:Record<string,string>={meal:'Meal drop-off',visit:'Visit / check-in',ride:'Ride'};

export function AtlasPlanner({householdId,people,demo,deliveryMode,initialPlanId,api,onApproved,onDirtyChange}:Props){
  const [input,setInput]=useState('');
  const [plan,setPlan]=useState<Plan|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [phase,setPhase]=useState<'describe'|'details'|'review'>('describe');
  const [cursor,setCursor]=useState(0),[messageIndex,setMessageIndex]=useState(0);
  const [seen,setSeen]=useState<Set<number>>(new Set());
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [model,setModel]=useState({available:false,source:'disabled'}),[useModel,setUseModel]=useState(false);
  const [mcpTrace,setMcpTrace]=useState<McpTrace|null>(null);
  const [excluded,setExcluded]=useState(''),[rehearsal,setRehearsal]=useState<Rehearsal|null>(null);
  const operation=useRef(0),rehearsalGeneration=useRef(0),proposalAttempt=useRef<{text:string;key:string}|null>(null);
  const apiRef=useRef(api);apiRef.current=api;
  const heading=useRef<HTMLHeadingElement>(null);
  const unsaved=dirty||phase==='describe'&&input.trim().length>0&&input!==plan?.sourceText;
  useEffect(()=>{onDirtyChange?.(unsaved);},[unsaved,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  useEffect(()=>{if(!unsaved)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[unsaved]);
  useEffect(()=>{let current=true;apiRef.current('/api/public-config').then(config=>{if(current)setModel(config.model||{available:false,source:'disabled'});}).catch(()=>{});return()=>{current=false;};},[householdId]);
  useEffect(()=>()=>{operation.current++;rehearsalGeneration.current++;},[householdId]);
  useEffect(()=>{heading.current?.focus();window.scrollTo({top:0,behavior:'instant'});},[phase,cursor,messageIndex]);
  useEffect(()=>{if(!initialPlanId||plan?.id===initialPlanId)return;let current=true;setBusy(true);apiRef.current(`/api/atlas/plans/${initialPlanId}`).then((fresh:Plan)=>{
    if(!current)return;validate(fresh);setPlan(fresh);setTasks(fresh.tasks);setInput(fresh.sourceText);setDirty(!!fresh.needsRefresh);setCursor(0);setPhase('details');
  }).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;rehearsalGeneration.current++;};},[initialPlanId,householdId]);
  function validate(fresh:Plan){if(fresh.householdId!==householdId)throw new Error('This draft belongs to another circle.');if(fresh.status!=='draft')throw new Error('This plan was already approved. Open the plan to see its status.');}
  function invalidate(){rehearsalGeneration.current++;setRehearsal(null);setSeen(new Set());}
  function change(index:number,patch:Partial<Task>){if(busy)return;setTasks(current=>current.map((task,i)=>i===index?{...task,...patch}:task));setDirty(true);setNotice('');invalidate();}
  function changeDate(index:number,value:string){try{change(index,{dueAt:deadlineInstant(value)});setError('');}catch(cause){change(index,{dueAt:null});setError(cause instanceof Error?cause.message:String(cause));}}
  async function prepare(){if(busy||input.trim().length<4)return;const generation=++operation.current;setBusy(true);setError('');setNotice('');invalidate();setExcluded('');try{
    if(useModel&&proposalAttempt.current?.text!==input)proposalAttempt.current={text:input,key:crypto.randomUUID()};
    const result=await api('/api/simulate',{method:'POST',body:JSON.stringify({householdId,text:input,useModel,proposalKey:useModel?proposalAttempt.current?.key:undefined})});
    const fresh=await api(`/api/atlas/plans/${result.id}`) as Plan;if(generation!==operation.current)return;validate(fresh);
    setMcpTrace(result.mcpTrace);setPlan(fresh);setTasks(fresh.tasks);setDirty(false);setCursor(0);setPhase('details');history.replaceState({},'',`?plan=${encodeURIComponent(fresh.id)}`);
  }catch(cause){if(generation===operation.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(generation===operation.current)setBusy(false);}}
  async function review(){if(!plan||busy||!ready)return;const generation=++operation.current;setBusy(true);setError('');invalidate();try{
    let fresh=plan;
    if(dirty){const saved=await api(`/api/atlas/plans/${plan.id}`,{method:'PUT',body:JSON.stringify({previousDigest:plan.digest,tasks})}) as Plan;fresh=await api(`/api/atlas/plans/${saved.id}`) as Plan;}
    if(generation!==operation.current)return;validate(fresh);setPlan(fresh);setTasks(fresh.tasks);setDirty(false);setMessageIndex(0);setSeen(new Set([0]));setPhase('review');setNotice('');
  }catch(cause){if(generation===operation.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(generation===operation.current)setBusy(false);}}
  async function rehearse(){if(!plan||!excluded||dirty||busy)return;const generation=++rehearsalGeneration.current,digest=plan.digest;setBusy(true);setError('');setRehearsal(null);try{
    const result=await api('/api/simulate/rehearse',{method:'POST',body:JSON.stringify({planId:plan.id,excludedMembershipId:excluded})}) as Rehearsal&{mcpTrace:McpTrace};
    if(generation!==rehearsalGeneration.current)return;if(result.sourcePlanId!==plan.id||result.snapshotDigest!==digest||result.excludedMembershipId!==excluded)throw new Error('The saved plan changed. Review it again.');setMcpTrace(result.mcpTrace);setRehearsal(result);
  }catch(cause){if(generation===rehearsalGeneration.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(generation===rehearsalGeneration.current)setBusy(false);}}
  async function approve(){if(!plan||busy||dirty||!ready||seen.size!==tasks.length||phase!=='review')return;const generation=++operation.current;setBusy(true);setError('');try{
    await api(`/api/atlas/plans/${plan.id}/approve`,{method:'POST',body:JSON.stringify({digest:plan.digest})});if(generation!==operation.current)return;await onApproved();
  }catch(cause){if(generation===operation.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(generation===operation.current)setBusy(false);}}
  const helperOptions=people.filter(person=>person.role==='helper'&&person.status==='active'&&person.opted_in);
  const expired=!!plan&&new Date(plan.expiresAt)<=new Date();
  function validTask(task:Task){return !!task.dueAt&&new Date(task.dueAt)>new Date()&&task.title.trim().length>=4&&task.brief.trim().length>=4&&task.recipientIds.length>0&&task.recipientIds.every(id=>{const person=helperOptions.find(helper=>helper.id===id);return person?.contact_allowed&&person.task_types?.includes(task.type)&&taskDateAvailability(person,task.dueAt)==='available';});}
  const ready=!expired&&tasks.length>0&&tasks.every(validTask);
  const task=tasks[cursor],messageTask=tasks[messageIndex],outreach=plan?.outreach[messageIndex];
  const selectedHelpers=[...new Set(tasks.flatMap(task=>task.recipientIds))].map(id=>helperOptions.find(helper=>helper.id===id)).filter((person):person is Person=>!!person);
  const step=phase==='describe'?1:phase==='details'?2:3;
  const stepTitle=phase==='describe'?'What would help?':phase==='details'?'Set the details.':'Review the message.';
  const hint=expired?'This draft expired. Start again.':!ready?'Each task needs a future time, a short description and an available helper.':dirty?'Save your changes before approval.':'Approval starts outreach. A helper still needs to accept.';
  return <section className={`focus-wizard phase-${phase}`} aria-label="Outreach planner">
    <div className="focus-wizard-top"><span>STEP {step} OF 3</span><div aria-label="Progress">{[1,2,3].map(value=><i className={value<=step?'active':''} key={value}/>)}</div></div>
    <h1 ref={heading} tabIndex={-1}>{stepTitle}</h1>
    {error&&<div className="focus-form-error" role="alert"><AlertTriangle size={17}/>{error}</div>}
    {notice&&<p role="status">{notice}</p>}
    {plan?.proposal?.outcome==='fallback'&&phase!=='describe'&&<p className="focus-validation" role="status">Automatic drafting fell back to rules. Check for missing tasks.</p>}
    {phase==='describe'&&<div className="focus-compose">
      <p>A meal, a visit or a ride. Include a day and time.</p>
      <label className="sr-only" htmlFor="atlas-request">Describe the help needed</label><textarea id="atlas-request" rows={4} maxLength={1000} disabled={busy} value={input} onChange={event=>setInput(event.target.value)} placeholder="Dinner Friday at 6pm and a visit Saturday at 10am"/>
      <details className="focus-example"><summary>Need an example?</summary>{['Bring dinner tomorrow at 6pm','Check on Dad tomorrow at 10am'].map(example=><button key={example} onClick={()=>setInput(example)}>{example}<ArrowRight size={14}/></button>)}</details>
      {model.available&&<details className="focus-disclosure"><summary>Drafting options</summary><label className="checkline"><input type="checkbox" checked={useModel} disabled={busy} onChange={event=>{setUseModel(event.target.checked);proposalAttempt.current=null;}}/>{model.source==='contract-test'?'Use injected model contract test':'Use model-assisted drafting'}</label><p>{model.source==='contract-test'?'Injected test adapter. No live model.':'Opt in to send this request text to Amazon Bedrock. Do not include private details. Helper records and addresses are not sent.'}</p></details>}
      <button className="primary focus-continue" disabled={busy||input.trim().length<4} onClick={()=>void prepare()}>{busy?'Preparing…':'Continue'}<ArrowRight size={17}/></button>
      <p className="focus-wizard-assurance"><LockKeyhole size={13}/>{demo?'Demo · no real messages':'Nothing sent until you approve.'}</p>
    </div>}
    {phase==='details'&&plan&&task&&<>
      <p className="focus-task-count">Task {cursor+1} of {tasks.length}</p>
      <div className="focus-task-editor" data-task-index={cursor}><span className={`task-art ${task.type}`}><HelpVisual type={task.type}/></span>
        <fieldset disabled={busy}><label>What needs doing?<input aria-label="Title" value={task.title} onChange={event=>change(cursor,{title:event.target.value})}/></label>
          <label>When?<input aria-label="Deadline" type="datetime-local" value={localInput(task.dueAt)} aria-describedby="wizard-timezone" onChange={event=>changeDate(cursor,event.target.value)}/></label><small id="wizard-timezone">{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          {!task.dueAt&&<p className="focus-missing-time" role="status">{plan.clarifications?.find(item=>item.taskIndex===cursor)?.question||'Choose a future date and exact time.'}</p>}
          <fieldset className="focus-helper-picker"><legend>Who would you like to ask?</legend>{helperOptions.filter(person=>person.task_types?.includes(task.type)).map(person=>{const dateState=taskDateAvailability(person,task.dueAt),blocked=!person.contact_allowed||!!task.dueAt&&dateState!=='available';return <label className="focus-helper-choice" key={person.id}><input type="checkbox" checked={task.recipientIds.includes(person.id)} disabled={busy||blocked&&!task.recipientIds.includes(person.id)} onChange={()=>change(cursor,{recipientIds:task.recipientIds.includes(person.id)?task.recipientIds.filter(id=>id!==person.id):[...task.recipientIds,person.id]})}/><span className="focus-helper-avatar" aria-hidden="true">{(person.display_name||person.email).charAt(0)}</span><span>{person.display_name||person.email}{blocked&&<small>{!person.contact_allowed?'Quiet hours':dateState==='unavailable'?'Unavailable on this date':'Date needs review'}</small>}</span></label>;})}{!helperOptions.length&&<p>Invite a helper and ask them to opt in first.</p>}</fieldset>
          <details className="focus-disclosure focus-task-extras" open={task.brief.trim().length<4||undefined}><summary>Add a note or location</summary><label>Task type<select value={task.type} onChange={event=>change(cursor,{type:event.target.value as Task['type'],recipientIds:[]})}><option value="meal">Meal</option><option value="visit">Visit</option><option value="ride">Ride</option></select></label><label>Briefing<input value={task.brief} onChange={event=>change(cursor,{brief:event.target.value})}/></label><label>Private location, visible after acceptance<input value={task.location} onChange={event=>change(cursor,{location:event.target.value})}/></label><label>Private instructions, visible after acceptance<input value={task.instructions} onChange={event=>change(cursor,{instructions:event.target.value})}/></label></details>
        </fieldset>
      </div>
      {dirty&&<details className="focus-disclosure"><summary>Review changes</summary><ReviewChanges saved={plan.tasks} proposed={tasks} digest={plan.digest} people={people}/></details>}
      {expired&&<p className="focus-form-error">This draft expired. Start again with a new request.</p>}
      <div className="focus-wizard-actions"><button className="text-button" disabled={busy} onClick={()=>{setError('');if(cursor)setCursor(cursor-1);else setPhase('describe');}}><ArrowLeft size={16}/>Back</button>{cursor<tasks.length-1?<button className="primary" disabled={busy||!validTask(task)||expired} onClick={()=>{setCursor(cursor+1);setError('');}}>Next task<ArrowRight size={16}/></button>:<button className="primary" disabled={busy||!ready} onClick={()=>void review()}>{busy?'Saving…':dirty?'Save & review':'Review messages'}<ArrowRight size={16}/></button>}</div>
      {!validTask(task)&&!expired&&<p className="focus-validation">Choose a future time and at least one available helper. Notes need at least four characters.</p>}
      <p className="focus-wizard-assurance"><LockKeyhole size={13}/>Draft only. Nothing sent.</p>
    </>}
    {phase==='review'&&plan&&messageTask&&outreach&&<>
      <p className="focus-task-count">Message {messageIndex+1} of {tasks.length}</p>
      <div className="focus-message-context"><span className={`task-art ${messageTask.type}`}><HelpVisual type={messageTask.type}/></span><div><h2>{messageTask.title}</h2><time dateTime={messageTask.dueAt||undefined}>{messageTask.dueAt?new Date(messageTask.dueAt).toLocaleString():'Time needed'}</time></div><button className="text-button" disabled={busy} onClick={()=>{setCursor(messageIndex);setPhase('details');}}>Edit</button></div>
      <article className="focus-message" aria-label="Exact outreach message"><header><span>TO</span><div>{outreach.recipients.map(person=><p key={person.email}>{person.email}{person.wave>1&&<small>Wave {person.wave} · 15 minutes after approval</small>}</p>)}</div></header><h3>{outreach.subject}</h3><p className="focus-message-body">{outreach.text}</p><footer>{plan.deliveryMode==='simulated'?'Simulated offers only. No real messages.':plan.deliveryMode==='in_app'?'In-app offers only. No email.':'Email outreach. Queued after approval.'}</footer></article>
      <div className="focus-wizard-actions"><button className="text-button" disabled={busy} onClick={()=>{if(messageIndex)setMessageIndex(messageIndex-1);else{setCursor(tasks.length-1);setPhase('details');}}}><ArrowLeft size={16}/>Back</button>{messageIndex<tasks.length-1?<button className="primary" disabled={busy||dirty} onClick={()=>{const next=messageIndex+1;setMessageIndex(next);setSeen(current=>new Set([...current,next]));}}>Next message<ArrowRight size={16}/></button>:<button className="primary" disabled={busy||dirty||!ready||seen.size!==tasks.length} onClick={()=>void approve()}>{busy?'Approving…':'Approve exact plan'}<Check size={16}/></button>}</div>
      <p className="focus-wizard-assurance" id="approval-guidance">{hint}</p>
      <details className="focus-disclosure focus-rehearsal"><summary>What if someone declines?</summary><p>Preview only. Your plan stays unchanged.</p><div className="focus-rehearsal-controls"><select aria-label="Helper to remove in rehearsal" value={excluded} disabled={busy} onChange={event=>{rehearsalGeneration.current++;setRehearsal(null);setExcluded(event.target.value);}}><option value="">Choose a helper</option>{selectedHelpers.map(person=><option key={person.id} value={person.id}>{person.display_name||person.email}</option>)}</select><button className="secondary" disabled={!excluded||busy||dirty} onClick={()=>void rehearse()}><FlaskConical size={15}/>Rehearse decline</button></div>
        {rehearsal&&<div className="focus-rehearsal-results" role="status"><strong>Hypothetical only. {rehearsal.sideEffects} side effects.</strong>{rehearsal.scenarios.map((scenario,index)=><article key={index}><h3>{scenario.title}</h3><p>{scenario.uncoveredIfDeclined?'No selected helper would remain.':`${scenario.remainingApproved.join(', ')} would remain in the draft.`}</p><small>{scenario.possibleNewCandidates.length?`Alternatives to review: ${scenario.possibleNewCandidates.join(', ')}.`:'No additional eligible helper in this snapshot.'}</small></article>)}<details><summary>Snapshot receipt</summary><time dateTime={rehearsal.snapshotAt}>{new Date(rehearsal.snapshotAt).toLocaleString()}</time><code>{rehearsal.snapshotDigest}</code></details></div>}
      </details>
      <details className="focus-disclosure focus-draft-evidence"><summary>Draft details</summary><p>{plan.proposal?.source==='contract-test'?'Injected contract-test response. Not a live model.':plan.proposal?.source==='deterministic'?'Deterministic parser. No model call.':plan.proposal?.source?'Model-assisted proposal.':'Draft source not recorded.'}</p>{plan.proposal?.outcome==='fallback'&&<p>Model proposal was not validated. Check these fallback drafts for missing tasks.</p>}{plan.proposal?.reason&&<p>Fallback reason: {plan.proposal.reason}</p>}{mcpTrace&&<p>Protocol {mcpTrace.protocol} · {mcpTrace.server} · {mcpTrace.toolCount} tools</p>}<code>{plan.digest}</code></details>
    </>}
  </section>;
}
