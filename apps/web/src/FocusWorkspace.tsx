import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Plus, ShieldCheck } from 'lucide-react';
import { HelpVisual, TaskProgress } from './CareVisuals.js';
import { buildNextSteps } from './next-steps.js';
import { offerLabels, statusLabels, statusTone, type Board, type Request } from './coordination.js';

export type DraftSummary = {id:string;titles:string[];createdAt:string;expiresAt:string;recoverySourceId:string|null};
export function shortDate(value:string){return new Date(value).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
export function TaskRows({requests,onOpen}:{requests:Request[];onOpen:(id:string)=>void}){
  return <ul className="focus-task-list">{requests.map(request=><li key={request.id}>
    <button className="focus-task-row" data-request-id={request.id} onClick={()=>onOpen(request.id)}>
      <span className={`task-art ${request.type}`}><HelpVisual type={request.type}/></span>
      <span className="focus-row-name"><strong>{request.title}</strong><time dateTime={request.due_at}>{shortDate(request.due_at)}</time></span>
      <span className={`status-chip ${statusTone(request.status)}`}>{statusLabels[request.status]||'Needs review'}</span><ArrowRight size={16}/>
    </button>
  </li>)}</ul>;
}
export function FocusHome({name,board,fetchedAt,helper,drafts,onAsk,onPlan,onOffers,onOpen,onResume}:{
  name:string;board:Board|null;fetchedAt:string|null;helper:boolean;drafts:DraftSummary[];
  onAsk:()=>void;onPlan:()=>void;onOffers:()=>void;onOpen:(id:string)=>void;onResume:(id:string)=>void;
}){
  const steps=board&&fetchedAt?buildNextSteps(board.requests,Date.parse(fetchedAt)):[];
  const requests=board?.requests||[];
  const myNext=helper?[...requests].filter(r=>r.offers.some(offer=>['sent','simulated','in_app_available','accepted'].includes(offer.status))&&r.status!=='confirmed_done'&&r.status!=='uncovered'&&r.status!=='cancelled').sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at))[0]:requests.find(r=>r.id===steps[0]?.requestId);
  const subtitle=helper?'Help, on your terms.':'A little less to keep track of.';
  return <section className="focus-page focus-home" aria-label="Home">
    <header className="focus-page-heading"><div><h1>{name}</h1><p>{subtitle}</p></div>{!helper&&requests.length>0&&<button className="secondary" onClick={onAsk}><Plus size={17}/>Ask for help</button>}</header>
    {myNext?<article className={`focus-next-card ${myNext.type}`}>
      <span className={`focus-next-art task-art ${myNext.type}`}><HelpVisual type={myNext.type}/></span>
      <div className="focus-next-copy"><span className="focus-kicker">{helper?'YOUR NEXT REQUEST':`${steps.length} ${steps.length===1?'TASK NEEDS':'TASKS NEED'} YOUR REVIEW`}</span>
        <h2>{myNext.title}</h2><p><time dateTime={myNext.due_at}>{shortDate(myNext.due_at)}</time></p>
        <span className={`status-chip ${statusTone(myNext.status)}`}>{statusLabels[myNext.status]}</span>
        <button className="primary" onClick={()=>onOpen(myNext.id)}>{myNext.status==='helper_reported_done'&&!helper?'Review completion':myNext.status==='uncovered'?'Find a new helper':'Open request'}<ArrowRight size={17}/></button>
      </div>
    </article>:<article className="focus-calm-card"><span className="focus-calm-icon"><CheckCircle2 size={32}/></span><h2>{requests.length?'Nothing waiting for your review.':'Start with one small ask.'}</h2><p>{requests.length?requests.some(request=>request.status==='accepted')?'Accepted work is still in progress.':'View the plan for current statuses.':'A meal, a visit or a ride.'}</p>{!requests.length&&!helper&&<button className="primary" onClick={onAsk}>Ask for help<ArrowRight size={17}/></button>}{helper&&!requests.length&&<span>Your offers will appear here.</span>}</article>}
    <button className="focus-plan-link" onClick={helper?onOffers:onPlan}><span>{helper?'View my offers':'View the plan'}<small>{requests.length} {requests.length===1?'request':'requests'}</small></span><ArrowRight size={19}/></button>
    {!helper&&drafts.length>0&&<section className="focus-draft-link" aria-label="Saved drafts"><button onClick={()=>onResume(drafts[0].id)}><span><strong>Continue your draft</strong><small>{drafts[0].titles.join(' · ')} · Not sent</small></span><ArrowRight size={17}/></button>{drafts.length>1&&<button className="text-button" onClick={onPlan}>View all {drafts.length} drafts</button>}</section>}
  </section>;
}

const eventNames:Record<string,string>={plan_approved:'Outreach approved',offer_sent:'Email accepted by provider',email_simulated:'Demo offer made available',offer_available_in_app:'Offer available in Relief',helper_accepted:'Helper accepted',helper_reported_done:'Helper reported done',confirmed_done:'Organizer confirmed done',helper_cancelled:'Helper cancelled',offer_declined:'Helper declined',delivery_failed:'Delivery failed',uncovered:'Task became uncovered',disputed:'Completion disputed'};
export function FocusTask({request:r,organizer,actorId,events,busy,onBack,onAction,onRecover}:{
  request:Request;organizer:boolean;actorId:string;events:Board['events'];busy:boolean;onBack:()=>void;
  onAction:(path:string,body:object,message:string)=>void;onRecover:()=>void;
}){
  const mine=r.offers.find(offer=>offer.user_id===actorId);
  const canSeePrivate=organizer||r.accepted_by===actorId;
  const explanation=r.status==='uncovered'?'No helper is covering this task.':r.status==='seeking'?'Waiting for a helper to accept.':r.status==='helper_reported_done'?'Reported done. The organizer still needs to confirm.':r.status==='accepted'?`${r.accepted_name||'A helper'} accepted. This task is not done yet.`:r.status==='confirmed_done'?'The organizer confirmed this task is done.':r.status==='disputed'?'Completion needs to be resolved.':'This task is closed.';
  return <section className="focus-page focus-task-detail" aria-label="Request details" data-request-id={r.id}>
    <button className="focus-back" onClick={onBack}><ArrowLeft size={16}/>Back to {organizer?'plan':'offers'}</button>
    <header className="focus-detail-heading"><span className={`task-art ${r.type}`}><HelpVisual type={r.type}/></span><span className={`status-chip ${statusTone(r.status)}`}>{statusLabels[r.status]||r.status}</span><h1>{r.title}</h1><p><Clock3 size={15}/><time dateTime={r.due_at}>{shortDate(r.due_at)}</time></p></header>
    <div className="focus-decision"><p>{explanation}</p><TaskProgress status={r.status}/>
      {!organizer&&mine&&['sent','simulated','in_app_available'].includes(mine.status)&&r.status==='seeking'&&<><p className="focus-brief">{r.brief}</p><div className="focus-actions"><button className="primary" disabled={busy} onClick={()=>onAction(`/api/offers/${mine.id}/respond`,{response:'accept'},'You accepted this request.')}>Accept</button><button className="secondary" disabled={busy} onClick={()=>onAction(`/api/offers/${mine.id}/respond`,{response:'decline'},'Offer declined.')}>Decline</button></div></>}
      {!organizer&&r.accepted_by===actorId&&r.status==='accepted'&&<div className="focus-actions"><button className="primary" disabled={busy} onClick={()=>onAction(`/api/requests/${r.id}/helper-complete`,{},'Reported done. Waiting for organizer confirmation.')}>Report done</button><button className="text-button" disabled={busy} onClick={()=>onAction(`/api/requests/${r.id}/helper-cancel`,{},'Acceptance cancelled. Organizer notified.')}>I can’t do it</button></div>}
      {organizer&&r.status==='helper_reported_done'&&<div className="focus-actions"><button className="primary" disabled={busy} onClick={()=>onAction(`/api/requests/${r.id}/organizer-confirm`,{decision:'confirm'},'Task confirmed done.')}>Confirm done</button><button className="secondary" disabled={busy} onClick={()=>onAction(`/api/requests/${r.id}/organizer-confirm`,{decision:'dispute'},'Completion disputed.')}>Dispute</button></div>}
      {organizer&&['uncovered','disputed'].includes(r.status)&&<button className="primary" disabled={busy} onClick={onRecover}>Review recovery plan<ArrowRight size={16}/></button>}
      {!organizer&&mine?.status==='queued'&&r.status==='seeking'&&<p className="focus-delivery-note">This offer is queued. It will become available here after delivery.</p>}
      {!organizer&&mine?.status==='delivery_failed'&&<p className="focus-delivery-note">Delivery failed. The organizer needs to review the plan.</p>}
      {mine?.status==='simulated'&&<small className="focus-delivery-note">Demo offer · no real message sent.</small>}
      {mine?.status==='in_app_available'&&<small className="focus-delivery-note">In-app offer · no email sent.</small>}
    </div>
    {canSeePrivate&&<details className="focus-disclosure" open={!organizer&&r.status==='accepted'}><summary>Notes & location</summary><div className="focus-private"><p>{r.brief}</p><dl><dt>Location</dt><dd>{r.location||'Not provided'}</dd><dt>Instructions</dt><dd>{r.instructions||'Not provided'}</dd></dl></div></details>}
    {organizer&&<details className="focus-disclosure"><summary>Activity timeline</summary><ol className="focus-history">{[...events].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id)).map(event=><li key={event.id}><strong>{eventNames[event.kind]||event.kind.replaceAll('_',' ')}</strong><span>{event.actor_name||'Relief'} · {shortDate(event.created_at)}</span><details><summary>Receipt</summary><code>{event.id}</code>{typeof event.detail?.planDigest==='string'&&<p>Approved plan <code>{event.detail.planDigest}</code></p>}</details></li>)}</ol><div className="focus-offer-history">{r.offers.map(offer=><p key={offer.id}>{offer.display_name||'Invited helper'}<span>{offerLabels[offer.status]||offer.status}</span></p>)}</div></details>}
    {!canSeePrivate&&<p className="focus-private-hint"><ShieldCheck size={14}/>Private details appear after acceptance.</p>}
  </section>;
}
