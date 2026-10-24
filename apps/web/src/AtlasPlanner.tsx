import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronRight, FlaskConical, LockKeyhole, MessageSquareText, Save, ShieldCheck } from 'lucide-react';
import './atlas.css';
import './planner-focus.css';
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
type Props={householdId:string;people:Person[];demo:boolean;deliveryMode:'email'|'simulated'|'in_app';initialPlanId?:string|null;api:(path:string,init?:RequestInit)=>Promise<any>;onApproved:()=>Promise<void>};

function localInput(iso:string|null){if(!iso)return '';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
const names:Record<string,string>={meal:'Meal drop-off',visit:'Visit / check-in',ride:'Ride'};

export function AtlasPlanner({householdId,people,demo,deliveryMode,initialPlanId,api,onApproved}:Props){
  const [input,setInput]=useState('Bring dinner Friday at 6pm and check on Dad Saturday at 10am');
  const [plan,setPlan]=useState<Plan|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [excluded,setExcluded]=useState('');
  const [rehearsal,setRehearsal]=useState<Rehearsal|null>(null);
  const [coverage,setCoverage]=useState<Record<string,number>|null>(null);
  const [mcpTrace,setMcpTrace]=useState<McpTrace|null>(null);
  const [model,setModel]=useState({available:false,source:'disabled'});
  const [useModel,setUseModel]=useState(false);
  const [composerOpen,setComposerOpen]=useState(false);
  const [deadlineAnswers,setDeadlineAnswers]=useState<Record<number,{date:string;time:string}>>({});
  const sourceInput=useRef<HTMLTextAreaElement>(null);
  const focusSource=useRef(false);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  const clarificationHeading=useRef<HTMLHeadingElement>(null);
  const focusReview=useRef(false);
  const proposalAttempt=useRef<{text:string;key:string}|null>(null);
  const apiRef=useRef(api);apiRef.current=api;
  const rehearsalGeneration=useRef(0);
  const operationGeneration=useRef(0);
  useEffect(()=>{let current=true;setUseModel(false);proposalAttempt.current=null;apiRef.current('/api/public-config').then(config=>{if(current)setModel(config.model||{available:false,source:'disabled'});}).catch(()=>{if(current)setModel({available:false,source:'disabled'});});return()=>{current=false;};},[householdId]);
  useEffect(()=>()=>{rehearsalGeneration.current++;operationGeneration.current++;},[householdId]);
  useEffect(()=>{const heading=clarificationHeading.current||reviewHeading.current;if(!busy&&focusReview.current&&heading){focusReview.current=false;heading.focus();heading.scrollIntoView({block:'start',behavior:'instant'});}},[busy,plan?.id,plan?.digest]);
  useEffect(()=>{if(composerOpen&&focusSource.current&&sourceInput.current){focusSource.current=false;sourceInput.current.focus();sourceInput.current.scrollIntoView({block:'center',behavior:'instant'});}},[composerOpen]);
  useEffect(()=>{if(!initialPlanId||plan?.id===initialPlanId)return;let current=true;invalidateRehearsal();api(`/api/atlas/plans/${initialPlanId}`).then((fresh:Plan)=>{if(!current)return;if(fresh.householdId!==householdId)throw new Error('This draft belongs to another circle. Switch to that circle before reviewing it.');if(fresh.status!=='draft')throw new Error('This plan was already approved. Check its factual status on Today.');setPlan(fresh);setTasks(fresh.tasks);setInput(fresh.sourceText);setDeadlineAnswers({});setDirty(!!fresh.needsRefresh);setExcluded('');setComposerOpen(false);}).catch((cause:unknown)=>{if(current)setError(String(cause instanceof Error?cause.message:cause));});return()=>{current=false;rehearsalGeneration.current++;};},[initialPlanId,householdId]);

  function invalidateRehearsal(){rehearsalGeneration.current++;setRehearsal(null);}
  function editOriginal(){focusSource.current=true;if(composerOpen){focusSource.current=false;sourceInput.current?.focus();sourceInput.current?.scrollIntoView({block:'center',behavior:'instant'});}else setComposerOpen(true);}
  function change(index:number,patch:Partial<Task>){if(busy)return;setTasks(current=>current.map((item,i)=>i===index?{...item,...patch}:item));setDirty(true);setNotice('');invalidateRehearsal();}
  function changeDeadline(index:number,value:string){setDeadlineAnswers(current=>{const next={...current};delete next[index];return next;});try{change(index,{dueAt:deadlineInstant(value)});setError('');}catch(cause){change(index,{dueAt:null});setError(cause instanceof Error?cause.message:String(cause));}}
  function validateScope(fresh:Plan){if(fresh.householdId!==householdId)throw new Error('This draft belongs to another circle. Switch to that circle before reviewing it.');if(fresh.status!=='draft')throw new Error('This plan was already approved. Check its factual status on Today.');}
  function answerDeadline(index:number){const answer=deadlineAnswers[index];if(!answer?.date||!answer.time||busy)return;try{const dueAt=deadlineInstant(`${answer.date}T${answer.time}`);if(!dueAt||new Date(dueAt)<=new Date())throw new Error('Choose a future date and exact time.');change(index,{dueAt});setError('');setNotice('Answer applied to the draft only. Save the exact review, then approve separately.');requestAnimationFrame(()=>{const heading=clarificationHeading.current||reviewHeading.current;heading?.focus();});}catch(cause){change(index,{dueAt:null});setError(cause instanceof Error?cause.message:String(cause));}}
  async function prepare(){const generation=++operationGeneration.current;invalidateRehearsal();setExcluded('');setBusy(true);setError('');setNotice('');try{
    if(useModel&&proposalAttempt.current?.text!==input)proposalAttempt.current={text:input,key:crypto.randomUUID()};
    const result=await api('/api/simulate',{method:'POST',body:JSON.stringify({householdId,text:input,useModel,proposalKey:useModel?proposalAttempt.current?.key:undefined})});
    const fresh=await api(`/api/atlas/plans/${result.id}`) as Plan;
    if(generation!==operationGeneration.current)return;validateScope(fresh);
    setMcpTrace(result.mcpTrace);
    setPlan(fresh);setTasks(fresh.tasks);setDeadlineAnswers({});setDirty(false);setRehearsal(null);setComposerOpen(false);focusReview.current=true;
    history.replaceState({},'',`?plan=${encodeURIComponent(fresh.id)}`);
    setNotice('Drafts are ready to review. Nothing was sent.');
  }catch(e){if(generation===operationGeneration.current)setError(String(e instanceof Error?e.message:e));}finally{if(generation===operationGeneration.current)setBusy(false);}}
  async function save(){if(!plan)return;const generation=++operationGeneration.current;invalidateRehearsal();setBusy(true);setError('');try{
    const saved=await api(`/api/atlas/plans/${plan.id}`,{method:'PUT',body:JSON.stringify({previousDigest:plan.digest,tasks})}) as Plan;
    const fresh=await api(`/api/atlas/plans/${saved.id}`) as Plan;
    if(generation!==operationGeneration.current)return;validateScope(fresh);
    setPlan(fresh);setTasks(fresh.tasks);setDeadlineAnswers({});setDirty(false);setRehearsal(null);setComposerOpen(false);focusReview.current=true;
    setNotice('Review saved. The approval fingerprint now matches these exact tasks.');
  }catch(e){if(generation===operationGeneration.current)setError(String(e instanceof Error?e.message:e));}finally{if(generation===operationGeneration.current)setBusy(false);}}
  async function rehearse(){if(!plan||!excluded||dirty)return;const generation=++rehearsalGeneration.current;const digest=plan.digest;setRehearsal(null);setBusy(true);setError('');try{
    const result=await api('/api/simulate/rehearse',{method:'POST',body:JSON.stringify({planId:plan.id,excludedMembershipId:excluded})}) as Rehearsal;
    if(generation!==rehearsalGeneration.current)return;
    if(result.sourcePlanId!==plan.id||result.snapshotDigest!==digest||result.excludedMembershipId!==excluded)throw new Error('The saved plan changed. Save or reload the review before rehearsing again.');
    setMcpTrace((result as Rehearsal&{mcpTrace:McpTrace}).mcpTrace);
    setRehearsal(result);
  }catch(e){if(generation===rehearsalGeneration.current)setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
  async function askCoverage(){setBusy(true);setError('');try{
    const result=await api('/api/simulate/coverage',{method:'POST',body:JSON.stringify({householdId})});
    setMcpTrace(result.mcpTrace);
    setCoverage(result);
  }catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
  async function approve(){if(!plan||dirty||busy||!ready)return;const generation=++operationGeneration.current;invalidateRehearsal();setBusy(true);setError('');try{
    await api(`/api/atlas/plans/${plan.id}/approve`,{method:'POST',body:JSON.stringify({digest:plan.digest})});
    if(generation!==operationGeneration.current)return;
    setNotice(plan.deliveryMode==='email'?'Approved. Email outreach is queued, not yet sent or accepted.':plan.deliveryMode==='simulated'?'Approved. Fictional offers are simulated; no email was sent.':'Approved. Offers will appear in-app; no email will be sent. No helper has accepted yet.');
    setPlan(null);setTasks([]);setRehearsal(null);await onApproved();
  }catch(e){if(generation===operationGeneration.current)setError(String(e instanceof Error?e.message:e));}finally{if(generation===operationGeneration.current)setBusy(false);}}
  const helperOptions=people.filter(person=>person.role==='helper'&&person.status==='active'&&person.opted_in);
  const selectedHelpers=[...new Set(tasks.flatMap(task=>task.recipientIds))].map(id=>helperOptions.find(person=>person.id===id)).filter((person):person is Person=>!!person);
  const excludedName=selectedHelpers.find(person=>person.id===excluded)?.display_name||'this helper';
  const expired=!!plan&&new Date(plan.expiresAt)<=new Date();
  const dateBlocked=tasks.some(task=>task.dueAt&&task.recipientIds.some(id=>{const person=helperOptions.find(person=>person.id===id);return !person||taskDateAvailability(person,task.dueAt)!=='available';}));
  const ready=!expired&&!dateBlocked&&tasks.length>0&&tasks.every(task=>task.dueAt&&new Date(task.dueAt)>new Date()&&task.recipientIds.length>0&&task.title.length>=4&&task.brief.length>=4);
  const approvalHint=expired?'This review expired. Prepare a fresh plan.':dateBlocked?'A selected helper is unavailable on a task date, or their date availability cannot be checked. Review helpers and save again.':dirty?'Save your edits to refresh the exact message and fingerprint.':!ready?'Each task needs a future deadline, a title, a briefing and at least one helper.':'Ready for your approval. Eligibility is checked again on the server.';
  const unresolved=tasks.flatMap((task,taskIndex)=>task.dueAt&&new Date(task.dueAt)>new Date()?[]:[plan?.clarifications?.find(question=>question.taskIndex===taskIndex)||{taskIndex,field:'dueAt',code:'exact_deadline',question:`What future date and exact time should task ${taskIndex+1}, “${task.title}” be due?`,explanation:'Choose a complete deadline. Atlas will not invent one.'}]);
  const question=unresolved[0];
  const answer=question?deadlineAnswers[question.taskIndex]||{date:'',time:''}:{date:'',time:''};

  return <section className={`atlas-planner ${plan?'has-review':'is-composing'}`} aria-label="Atlas outreach planner">
    <ol className="planner-steps" aria-label="Outreach review steps"><li className={!plan?'current':'complete'} aria-current={!plan?'step':undefined}><span>{plan?<Check size={14}/>:1}</span> Describe the need</li><li className={plan?'current':''} aria-current={plan?'step':undefined}><span>2</span> Review every detail</li><li><span>3</span> Approve outreach</li></ol>
    <div className="atlas-intro"><span className="eyebrow">ALEXA-STYLE WEB SIMULATOR · NOT ALEXA+</span>{!plan&&<p>Start with a day and time for each task. You will review everything before anyone is contacted.</p>}</div>
    <details className="source-composer" open={!plan||composerOpen} onToggle={event=>{if(plan)setComposerOpen(event.currentTarget.open);}}>
    <summary>Original request and drafting options <ChevronRight size={16}/></summary>
    {plan&&<p className="source-context">Editing this text does not change your saved review. Create drafts to review the result; nothing is sent.</p>}
    <label className="atlas-label" htmlFor="atlas-request">Describe the help needed</label>
    <textarea ref={sourceInput} id="atlas-request" rows={3} maxLength={1000} disabled={busy} aria-describedby="composer-guidance" value={input} onChange={event=>setInput(event.target.value)} placeholder="Bring dinner Friday at 6pm and check on Dad Saturday at 10am"/>
    <div className="composer-guidance" id="composer-guidance"><span>Include a day and exact time for each task.</span><span>{input.length} / 1,000</span></div>
    <div className="model-choice"><label className="atlas-check"><input type="checkbox" checked={useModel} disabled={busy||!model.available} onChange={event=>{setUseModel(event.target.checked);proposalAttempt.current=null;}}/><span>{model.source==='contract-test'?'Use injected model contract test':'Use model-assisted drafting'}</span></label><p className="channel-note">{!model.available?'Model provider disabled. Drafting uses deterministic rules; no model call is made.':model.source==='contract-test'?'Test adapter only. No live model or AWS call. Approval is still required.':'Opt in to send this request text to Amazon Bedrock. Do not include private details. Helpers, addresses and household records are not sent. This does not authorize outreach.'}</p></div>
    {plan&&input!==plan.sourceText&&<p className="channel-note" role="status">This text does not change the review below. Create drafts to review your new wording. Only the saved review can be approved.</p>}
    {!plan&&<div className="request-examples" aria-label="Example requests"><span>Try a starting point</span>{['Bring dinner tomorrow at 6pm','Check on Dad tomorrow at 10am'].map(example=><button key={example} disabled={busy} onClick={()=>setInput(example)}>{example} <ArrowRight size={13}/></button>)}</div>}
    <div className="atlas-actions"><span><LockKeyhole size={14}/> {demo?'Fictional demo accounts and simulated offers':deliveryMode==='in_app'?'Private circle; in-app offers only':'Private circle; email enabled'}</span><button className={plan?'secondary':'primary'} disabled={busy||input.trim().length<4} onClick={()=>void prepare()}><MessageSquareText size={17}/> {busy?'Working…':'Create drafts'}</button></div>
    </details>
    <div className="atlas-actions coverage-action"><span>Already made a plan?</span><button className="text-button" disabled={busy} onClick={()=>void askCoverage()}>Check current coverage <ArrowRight size={14}/></button></div>
    {coverage&&<div className="atlas-feedback" role="status">Current factual status: {coverage.seeking||0} seeking, {coverage.accepted||0} accepted, {coverage.pendingConfirmation||0} awaiting organizer confirmation, {coverage.confirmed||0} confirmed, {coverage.uncovered||0} uncovered.</div>}
    {error&&<div className="atlas-feedback bad" role="alert"><AlertTriangle size={16}/>{error}</div>}
    {notice&&<div className="atlas-feedback good" role="status"><Check size={16}/>{notice}</div>}
    {mcpTrace&&<details className="outreach-preview"><summary>Actual MCP connection evidence</summary><p>Protocol {mcpTrace.protocol} · {mcpTrace.server} · {mcpTrace.toolCount} available tools</p><p>{mcpTrace.steps.join(' → ')} · <code>{mcpTrace.tool}</code></p><small>This is a real HTTP MCP exchange on this service, not a connection to Amazon Alexa+.</small></details>}
    {plan?.recoverySourceId&&<div className="atlas-feedback" role="status">Recovery draft. The original task remains uncovered or disputed. Choose helpers and approve this new plan separately.</div>}
    {plan&&<p className="channel-note">This saved plan uses {plan.deliveryMode==='email'?'email outreach':plan.deliveryMode==='simulated'?'fictional simulated offers':'in-app offers only; no email'}. The approval record includes this channel.</p>}
    {plan?.proposal?.source&&<details className="outreach-preview proposal-receipt"><summary>Draft source and validation receipt</summary><p>{plan.proposal.source==='deterministic'?'Deterministic parser. No model call.':plan.proposal.source==='contract-test'?'Injected contract-test response. Not a live model.':'Amazon Bedrock proposal.'} {plan.proposal.outcome==='fallback'?'Model proposal was not validated. These drafts use the deterministic fallback; check for missing tasks.':'Draft structure checked. This is not helper acceptance or a guarantee of complete understanding.'}</p>{plan.proposal.reason&&<p>Fallback reason: <code>{plan.proposal.reason}</code></p>}{plan.proposal.modelId&&<p>Model: <code>{plan.proposal.modelId}</code></p>}{plan.proposal.inputTokens!==undefined&&<p>Provider-reported tokens: {plan.proposal.inputTokens} input / {plan.proposal.outputTokens} output. Estimated inference cost: ${plan.proposal.estimatedCostUsd?.toFixed(6)}; not a billing receipt.</p>}{plan.proposal.attemptId&&<p>Attempt: <code>{plan.proposal.attemptId}</code></p>}{plan.proposal.citations?.map(citation=><blockquote key={citation.taskIndex}><strong>Original task {citation.taskIndex+1} · {citation.type}</strong><p>{plan.sourceText.slice(citation.start,citation.end)}</p><small>Exact source quote. Deadline derived by code; ambiguity remains unresolved.</small></blockquote>)}<small>This receipt describes the original draft, not later organizer edits. Only your saved exact review can be approved.</small></details>}
    {expired&&<div className="atlas-warning" role="alert">This review expired. Prepare a fresh plan and review its current helpers before approval.</div>}
    {plan&&<div className="atlas-review"><div className="atlas-review-head"><span className="eyebrow">EXACT REVIEW</span><h2 ref={reviewHeading} tabIndex={-1}>{tasks.length} separate {tasks.length===1?'task':'tasks'}</h2><p>Check each task and its exact message. Save any edits before approving.</p><div className="review-context"><span>Review version <code>{plan.digest.slice(0,12)}</code></span><button className="text-button review-source-link" onClick={editOriginal}>Edit original request <ArrowRight size={14}/></button></div></div>
      {question&&!expired&&<section className="deadline-clarification" aria-label="Deadline clarification"><span className="eyebrow">ONE DETAIL TO CONFIRM · {unresolved.length} {unresolved.length===1?'TASK NEEDS':'TASKS NEED'} A DEADLINE</span><h3 ref={clarificationHeading} tabIndex={-1}>{question.question}</h3><p>{question.explanation}</p><div className="form-grid"><label>Confirm date for task {question.taskIndex+1}<input type="date" disabled={busy} value={answer.date} onChange={event=>setDeadlineAnswers(current=>({...current,[question.taskIndex]:{...answer,date:event.target.value}}))}/></label><label>Exact time for task {question.taskIndex+1}<input type="time" disabled={busy} value={answer.time} onChange={event=>setDeadlineAnswers(current=>({...current,[question.taskIndex]:{...answer,time:event.target.value}}))}/></label></div><p className="channel-note">Your browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. An answer edits this draft only. Nothing is contacted or approved.</p><button className="secondary" disabled={busy||!answer.date||!answer.time} onClick={()=>answerDeadline(question.taskIndex)}>Apply answer to draft <ArrowRight size={14}/></button></section>}
      {tasks.map((task,index)=><article className="atlas-task" key={index}><div className="atlas-task-head"><span className="atlas-number">{String(index+1).padStart(2,'0')}</span><div><strong>{names[task.type]}</strong><small>{task.dueAt?new Date(task.dueAt).toLocaleString():'Missing exact time'}</small></div><span className="atlas-tag">DRAFT · NOT SENT</span></div>
        <fieldset className="task-edit-fields" disabled={busy} aria-label={`Task ${index+1} draft fields`}>
        <div className="form-grid"><label>Task type<select value={task.type} onChange={event=>change(index,{type:event.target.value as Task['type'],recipientIds:[]})}><option value="meal">Meal</option><option value="visit">Visit</option><option value="ride">Ride</option></select></label><label>Deadline<input type="datetime-local" value={localInput(task.dueAt)} onChange={event=>changeDeadline(index,event.target.value)} aria-describedby={`deadline-zone-${index}`}/></label></div>
        <p id={`deadline-zone-${index}`} className="channel-note">Deadline shown in your browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
        <label>Title<input value={task.title} onChange={event=>change(index,{title:event.target.value})}/></label><label>Briefing<input value={task.brief} onChange={event=>change(index,{brief:event.target.value})}/></label>
        <div className="form-grid"><label>Private location, visible after acceptance<input value={task.location} onChange={event=>change(index,{location:event.target.value})}/></label><label>Private instructions, visible after acceptance<input value={task.instructions} onChange={event=>change(index,{instructions:event.target.value})}/></label></div>
        <fieldset><legend>Invited, opted-in helpers</legend>{helperOptions.filter(person=>person.task_types?.includes(task.type)).map(person=>{const dateState=taskDateAvailability(person,task.dueAt);const blocked=!person.contact_allowed||!!task.dueAt&&dateState!=='available';return <label className="atlas-check" key={person.id}><input type="checkbox" checked={task.recipientIds.includes(person.id)} disabled={busy||blocked&&!task.recipientIds.includes(person.id)} onChange={()=>change(index,{recipientIds:task.recipientIds.includes(person.id)?task.recipientIds.filter(id=>id!==person.id):[...task.recipientIds,person.id]})}/><span>{person.display_name||person.email}{!person.contact_allowed?' · quiet hours, unavailable for contact now':''}{dateState==='unavailable'?` · unavailable on this task date (${person.timezone})`:task.dueAt&&dateState==='unknown'?' · task date availability needs review':''}</span></label>;})}{!helperOptions.some(person=>person.task_types?.includes(task.type)&&person.contact_allowed&&(!task.dueAt||taskDateAvailability(person,task.dueAt)==='available'))&&<p>No eligible helpers for this task now. Review the date or ask another invited helper. Approval rechecks eligibility.</p>}</fieldset>
        </fieldset>
        {!task.dueAt&&<div className="atlas-warning">Exact time missing. Atlas will not invent one.</div>}
        {plan.outreach[index]&&!dirty&&<details className="outreach-preview" open><summary>Exact outreach message and waves <ChevronRight size={15}/></summary><p>{plan.outreach[index].recipients.map(item=>`${item.email} (wave ${item.wave})`).join(', ')||'No recipients'}</p><strong>{plan.outreach[index].subject||'Set a due time to preview the message'}</strong>{plan.outreach[index].text&&<p className="message-preview">{plan.outreach[index].text}</p>}<small>Wave 1 queues immediately after approval. Wave 2 queues 15 minutes later. Delivery and acceptance are separate states.</small></details>}
      </article>)}
      {dirty&&<ReviewChanges saved={plan.tasks} proposed={tasks} digest={plan.digest} people={people}/>}
      <div className="atlas-save"><span><LockKeyhole size={16}/> {dirty?'Unsaved edits cannot be approved. Save before leaving this page.':'Saved. You can return from Today or refresh this page.'}</span><button className="secondary" disabled={busy||!dirty} onClick={()=>void save()}><Save size={16}/> Save exact review</button></div>
      <div className="rehearsal-panel"><div><span className="eyebrow">REHEARSE A FAILURE</span><h3>What if a helper declines?</h3><p>Compare the saved draft with one hypothetical decline, using a factual snapshot of current preferences and contact windows.</p></div><div className="rehearsal-controls"><select aria-label="Helper to remove in rehearsal" value={excluded} onChange={event=>{setExcluded(event.target.value);invalidateRehearsal();}}><option value="">Choose a helper</option>{selectedHelpers.map(person=><option value={person.id} key={person.id}>{person.display_name||person.email}</option>)}</select><button className="secondary" disabled={!excluded||busy||dirty} onClick={()=>void rehearse()}><FlaskConical size={16}/> Rehearse decline</button></div>
        <p className="rehearsal-boundary">No helper has accepted these drafts. Rehearsal changes no plans, creates no offers and contacts nobody.</p>
        <div className="rehearsal-announcement" role="status" aria-live="polite" aria-atomic="true">{rehearsal&&<><strong>Hypothetical only. {rehearsal.sideEffects} side effects.</strong><span>{rehearsal.scenarios.filter(scenario=>scenario.uncoveredIfDeclined).length} of {rehearsal.scenarios.length} tasks would have no remaining selected helper.</span></>}</div>
        {rehearsal&&<div className="rehearsal-results">
          {rehearsal.scenarios.map((scenario,index)=><article className="rehearsal-comparison" key={index} aria-label={`Rehearsal for ${scenario.title}`}><h4>{scenario.title}</h4><div className="rehearsal-columns"><div><span className="rehearsal-column-label">Selected and eligible now</span><strong>{scenario.selectedBefore.length?scenario.selectedBefore.join(', '):'No eligible selected helper'}</strong><p>Saved draft. No acceptance yet.</p></div><div className={scenario.uncoveredIfDeclined?'rehearsal-risk':'rehearsal-backup'}><span className="rehearsal-column-label">If {excludedName} declines</span><strong>{scenario.remainingApproved.length?scenario.remainingApproved.join(', '):'No selected helper remains'}</strong><p>{scenario.uncoveredIfDeclined?'If approved outreach is exhausted, this task becomes uncovered.':'These helpers remain in the draft. One must still accept before the task has coverage.'}</p></div></div><p className="rehearsal-next"><b>Before approval:</b> {scenario.possibleNewCandidates.length?`You could review ${scenario.possibleNewCandidates.join(', ')} as alternatives. Select any changes above, save, then approve the exact revised plan.`:'No additional eligible helper is available in this snapshot. Review preferences or wait for a contact window before changing the plan.'}</p></article>)}
          <details className="rehearsal-receipt"><summary>Snapshot receipt</summary><dl><div><dt>Captured</dt><dd><time dateTime={rehearsal.snapshotAt}>{new Date(rehearsal.snapshotAt).toLocaleString()}</time></dd></div><div><dt>Saved plan</dt><dd><code>{rehearsal.sourcePlanId}</code></dd></div><div><dt>Fingerprint</dt><dd><code>{rehearsal.snapshotDigest}</code></dd></div><div><dt>Existing queued jobs in this circle</dt><dd>{rehearsal.queuedJobsAtSnapshot}</dd></div><div><dt>Rehearsal side effects</dt><dd>{rehearsal.sideEffects}</dd></div></dl><p>Preferences can change after this snapshot. Approval rechecks eligibility. Existing jobs are unrelated to this rehearsal.</p></details>
        </div>}
      </div>
      <div className="atlas-approval"><div><span className="eyebrow"><ShieldCheck size={14}/> YOUR DECISION</span><strong>Nothing is covered yet.</strong><p>Approval queues outreach only. A helper must still accept.</p><p id="approval-guidance" className="approval-guidance">{approvalHint}</p></div><button className="primary" aria-describedby="approval-guidance" disabled={busy||dirty||!ready} onClick={()=>void approve()}><Check size={16}/> Approve exact plan</button></div>
    </div>}
  </section>;
}
