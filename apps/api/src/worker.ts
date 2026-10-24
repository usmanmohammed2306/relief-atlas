import { randomUUID } from 'node:crypto';
import type { Database, Queryable, Row } from './db.js';
import { contactAllowed } from './eligibility.js';
import { taskDateAllowed } from './availability.js';
import { reconcileCoverage } from './coverage.js';
import { observe, type Observer } from './telemetry.js';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]!);

export function offerMessage(type:string,dueAt:string,origin=process.env.APP_ORIGIN || 'http://localhost:5173') {
  const label=type==='meal'?'meal drop-off':type==='ride'?'ride coordination':'visit/check-in';
  const due=new Date(dueAt).toLocaleString('en-US',{timeZone:'UTC'})+' UTC';
  return {
    subject:`Could you help with a ${label}?`,
    text:`Someone in your Relief circle requested ${label}.\nDue: ${due}\nOpen Relief (${origin}) to review and accept or decline. No location or private instructions are included.`,
    html:`<p>Someone in your Relief circle requested ${escapeHtml(label)}.</p><p>Due: ${escapeHtml(new Date(dueAt).toLocaleString('en-US',{timeZone:'UTC'}))} UTC</p><p><a href="${escapeHtml(origin)}">Open Relief</a> to review and accept or decline. No location or private instructions are included.</p>`
  };
}

export type DeliveryResult='sent'|'simulated'|'in_app';
export type DeliveryMode='email'|'simulated'|'in_app';
export type Mailer=(to:string,subject:string,html:string,key:string,mode?:DeliveryMode)=>Promise<DeliveryResult>;
function validateMode(mode:string):DeliveryMode {
  if (mode!=='email' && mode!=='simulated' && mode!=='in_app') throw new Error('Invalid DELIVERY_MODE');
  if (mode==='simulated' && process.env.DEMO_MODE!=='true') throw new Error('Simulated delivery requires DEMO_MODE=true');
  if (mode==='email' && process.env.DEMO_MODE==='true') throw new Error('Email delivery is forbidden in fictional demo mode');
  return mode;
}
export function deliveryMode():DeliveryMode {
  return validateMode(process.env.DELIVERY_MODE || (process.env.DEMO_MODE==='true'?'simulated':'in_app'));
}
export async function sendEmail(to:string, subject:string, html:string, key:string,approvedMode:DeliveryMode=deliveryMode()):Promise<DeliveryResult> {
  const mode=validateMode(approvedMode);
  if (mode==='simulated') return 'simulated';
  if (mode==='in_app') return 'in_app';
  if (deliveryMode()!=='email') throw new Error('Email delivery is disabled');
  if (!process.env.RESEND_API_KEY) throw new Error('Email delivery requires RESEND_API_KEY');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':key },
    body:JSON.stringify({ from:process.env.EMAIL_FROM || 'Relief <onboarding@resend.dev>', to:[to], subject, html }),
    signal:AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
  return 'sent';
}

export async function runOneJob(db:Database,mailer:Mailer=sendEmail,observer?:Observer):Promise<boolean> {
  const job=await db.transaction(async tx=>{
    const ready=await tx.query("SELECT * FROM jobs WHERE (status='pending' AND run_at<=now()) OR (status='running' AND claimed_at<now()-interval '5 minutes') ORDER BY run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
    if (!ready.rows.length) return null;
    const claimed=await tx.query("UPDATE jobs SET status='running',claimed_at=now(),attempts=attempts+1,lease_token=$2 WHERE id=$1 RETURNING *",[ready.rows[0].id,randomUUID()]);
    return claimed.rows[0];
  });
  if (!job) return false;
  const started=performance.now();
  const receipt={kind:'job' as const,jobId:job.id,jobKind:job.kind,attempt:Number(job.attempts),offerId:job.payload.offerId,careRequestId:job.payload.requestId};
  observe(observer,{...receipt,phase:'claimed'});
  try {
    await perform(db,job,mailer,observer);
    const completed=await db.query("UPDATE jobs SET status='done',claimed_at=NULL,lease_token=NULL,last_error=NULL WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING id",[job.id,job.lease_token]);
    observe(observer,{...receipt,phase:completed.rows.length?'done':'lease_superseded',durationMs:performance.now()-started});
  } catch(error) {
    const message=error instanceof Error?error.message:'Unknown job failure';
    const failed=Number(job.attempts)>=3;
    const applied=await fenced(db,job,async tx=>{
      await tx.query("UPDATE jobs SET status=$2,claimed_at=NULL,lease_token=NULL,last_error=$3,run_at=now()+interval '2 minutes' WHERE id=$1",[job.id,failed?'failed':'pending',message.slice(0,200)]);
      if (job.kind!=='send_offer') return;
      const offer=await loadOffer(tx,job,true);
      if (!offer||offer.status!=='queued'||offer.request_status!=='seeking'||offer.delivery_generation!==(job.payload.generation||0)) return;
      await tx.query('INSERT INTO notifications(id,household_id,user_id,request_id,kind,message) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),offer.household_id,offer.organizer_id,offer.request_id,'delivery_problem',failed?'An approved offer could not be delivered. Review a recovery plan.':'An approved offer is delayed; Relief will retry.']);
      if (failed) {
        await tx.query("UPDATE offers SET status='delivery_failed' WHERE id=$1 AND status='queued'",[offer.id]);
        await workerEvent(tx,job,offer,'delivery_failed');
        await reconcileCoverage(tx,offer.request_id);
      }
    });
    observe(observer,{...receipt,phase:applied?(failed?'failed':'retry_scheduled'):'lease_superseded',durationMs:performance.now()-started});
  }
  return true;
}

async function fenced(db:Database,job:Row,action:(tx:Queryable)=>Promise<void>) {
  return db.transaction(async tx=>{
    const current=(await tx.query('SELECT status,lease_token FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
    if (current?.status!=='running'||current.lease_token!==job.lease_token) return false;
    await action(tx);
    return true;
  });
}

async function loadOffer(db:Queryable,job:Row,lock=false):Promise<Row|undefined> {
  return (await db.query('SELECT o.*,r.type,r.due_at,r.status AS request_status,r.household_id,r.organizer_id,m.email,m.status AS member_status,p.opted_in,p.task_types,p.quiet_start,p.quiet_end,p.timezone,p.unavailable_dates FROM offers o JOIN coverage_requests r ON r.id=o.request_id JOIN memberships m ON m.id=o.membership_id JOIN helper_preferences p ON p.membership_id=m.id WHERE o.id=$1'+(lock?' FOR UPDATE OF o,r,m,p':''),[job.payload.offerId])).rows[0];
}

function available(offer:Row,job:Row) {
  return offer.status==='queued'&&offer.delivery_generation===(job.payload.generation||0)&&offer.request_status==='seeking'&&new Date(offer.due_at)>new Date();
}

function eligible(offer:Row) {
  return offer.member_status==='active'&&offer.opted_in&&offer.task_types.includes(offer.type)&&contactAllowed(offer)&&taskDateAllowed(offer,offer.due_at)&&(!offer.recipient_email||offer.recipient_email===offer.email);
}

async function workerEvent(tx:Queryable,job:Row,offer:Row,kind:string,detail:Record<string,unknown>={}) {
  await tx.query('INSERT INTO events(id,household_id,request_id,kind,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[job.id,offer.household_id,offer.request_id,kind,JSON.stringify({offerId:offer.id,jobId:job.id,generation:job.payload.generation||0,...detail})]);
}

async function perform(db:Database,job:Row,mailer:Mailer,observer?:Observer):Promise<void> {
  if (job.kind==='invite') {
    const { householdId,email }=job.payload;
    const pending=await db.query("SELECT 1 FROM memberships WHERE household_id=$1 AND email=$2 AND status='pending'",[householdId,email]);
    if (!pending.rows.length) return;
    const name=(await db.query('SELECT name FROM households WHERE id=$1',[householdId])).rows[0]?.name || 'a care circle';
    const origin=process.env.APP_ORIGIN || 'http://localhost:5173';
    await mailer(email,`Invitation to ${name}`,`<p>You were invited to ${escapeHtml(name)} on Relief.</p><p><a href="${escapeHtml(origin)}">Open Relief</a> and sign in with this email to accept. You will not receive care requests until you opt in.</p>`,job.id,job.payload.deliveryMode||'in_app');
    return;
  }
  if (job.kind==='send_offer') {
    const offer=await loadOffer(db,job);
    if (!offer || !available(offer,job)) return;
    if(!eligible(offer)) {
      await fenced(db,job,async tx=>{
        const current=await loadOffer(tx,job,true);
        if (!current||!available(current,job)) return;
        await tx.query("UPDATE offers SET status='expired' WHERE id=$1 AND status='queued'",[offer.id]);
        await workerEvent(tx,job,offer,'offer_skipped_ineligible');
        await tx.query('INSERT INTO notifications(id,household_id,user_id,request_id,kind,message) VALUES($1,$2,$3,$4,$5,$6)',[job.id,offer.household_id,offer.organizer_id,offer.request_id,'offer_skipped','An approved helper became unavailable before outreach. Please review coverage.']);
        await reconcileCoverage(tx,offer.request_id);
      });
      return;
    }
    const message=offer.message_subject&&offer.message_html?{subject:offer.message_subject,html:offer.message_html}:offerMessage(offer.type,new Date(offer.due_at).toISOString());
    const approvedMode=offer.delivery_mode as DeliveryMode|null;
    const receipt={kind:'job' as const,jobId:job.id,jobKind:job.kind,attempt:Number(job.attempts),offerId:offer.id,careRequestId:offer.request_id};
    observe(observer,{...receipt,phase:'delivery_attempt'});
    const mode=await mailer(offer.recipient_email||offer.email,message.subject,message.html,`${offer.id}:${offer.delivery_generation}`,approvedMode||deliveryMode());
    if (approvedMode && mode!==(approvedMode==='email'?'sent':approvedMode)) throw new Error('Delivery adapter returned an unexpected channel');
    observe(observer,{...receipt,phase:'adapter_result',delivery:mode});
    await fenced(db,job,async tx=>{
      const current=await loadOffer(tx,job,true);
      if (!current) return;
      if (!available(current,job)||!eligible(current)) {
        await workerEvent(tx,job,current,'delivery_result_obsolete',{deliveryResult:mode});
        if (available(current,job)) await tx.query("UPDATE offers SET status='expired' WHERE id=$1",[current.id]);
        await reconcileCoverage(tx,current.request_id);
        return;
      }
      const status=mode==='in_app'?'in_app_available':mode;
      const updated=await tx.query("UPDATE offers SET status=$2,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1 AND status='queued' AND EXISTS (SELECT 1 FROM coverage_requests WHERE id=offers.request_id AND status='seeking') RETURNING request_id",[offer.id,status]);
      if (updated.rows.length) await workerEvent(tx,job,offer,mode==='in_app'?'offer_available_in_app':mode==='simulated'?'email_simulated':'offer_sent',{deliveryMode:approvedMode||mode});
    });
    return;
  }
  if (job.kind==='at_risk' || job.kind==='due') {
    await fenced(db,job,async tx=>{
      const request=(await tx.query('SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE',[job.payload.requestId])).rows[0];
      if (!request||request.status!=='seeking') return;
      if (job.kind==='due') {
        if (new Date(request.due_at)<=new Date()) await reconcileCoverage(tx,request.id);
      } else await tx.query('INSERT INTO notifications(id,household_id,user_id,request_id,kind,message) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[job.id,request.household_id,request.organizer_id,request.id,'at_risk','No helper has accepted yet. Please make a backup plan.']);
    });
  }
}

export function startWorker(db:Database,observer?:Observer):()=>Promise<void> {
  let stopped=false;
  let busy=false;
  let active:Promise<void>=Promise.resolve();
  const tick=async()=>{
    if (stopped||busy) return;
    busy=true;
    try { for (let count=0;!stopped&&count<20;count++) if (!(await runOneJob(db,sendEmail,observer))) break; }
    catch { console.error('Worker tick failed. Inspect job health using the operator view.'); }
    finally { busy=false; }
  };
  active=tick();
  const interval=setInterval(()=>{if(!busy&&!stopped)active=tick();},5000);
  return async()=>{ stopped=true; clearInterval(interval); await active; };
}
