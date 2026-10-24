import { randomUUID } from 'node:crypto';
import type { Database, Queryable, Row } from './db.js';
import { extractTask, safeBrief, TaskType } from './ai.js';
import { checkScope, checkSafetyText } from './scope.js';
import { contactAllowed } from './eligibility.js';
import { taskDateAllowed, UnavailableDates } from './availability.js';
import { reconcileCoverage } from './coverage.js';
import { deliveryMode } from './worker.js';

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Actor = { id: string; email: string; displayName: string };
const id = () => randomUUID();
const at = (value: unknown) => new Date(String(value)).toISOString();

async function member(db: Queryable, householdId: string, actorId: string, role?: 'organizer' | 'helper'): Promise<Row> {
  const result = await db.query('SELECT * FROM memberships WHERE household_id=$1 AND user_id=$2 AND status=$3 FOR SHARE',[householdId,actorId,'active']);
  const found = result.rows[0];
  if (!found || (role && found.role !== role)) throw new AppError(403,'You do not have access to this care circle.');
  return found;
}

export class ReliefService {
  constructor(public db: Database,private interpret:typeof extractTask=extractTask) {}

  async upsertUser(actor: Actor): Promise<void> {
    await this.db.query('INSERT INTO app_users(id,email,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name',[actor.id,actor.email.toLowerCase(),actor.displayName]);
  }

  async me(actor: Actor) {
    await this.upsertUser(actor);
    const circles = await this.db.query('SELECT h.id,h.name,h.care_recipient_name,m.role,m.status FROM memberships m JOIN households h ON h.id=m.household_id WHERE m.user_id=$1 AND m.status=$2 ORDER BY h.created_at DESC',[actor.id,'active']);
    const pending = await this.db.query('SELECT h.id,h.name,h.care_recipient_name,m.role FROM memberships m JOIN households h ON h.id=m.household_id WHERE lower(m.email)=lower($1) AND m.status=$2',[actor.email,'pending']);
    return { actor, circles: circles.rows, pending: pending.rows };
  }

  async createHousehold(actor: Actor, input: { name: string; careRecipientName: string; consentAttested: boolean;timezone:string }) {
    if (!input.consentAttested) throw new AppError(422,'Confirm that the care recipient agreed to the information shared in this circle.');
    try{new Intl.DateTimeFormat('en-US',{timeZone:input.timezone});}catch{throw new AppError(422,'Choose a valid timezone.');}
    const householdId=id();
    await this.db.transaction(async tx => {
      await tx.query('INSERT INTO households(id,name,care_recipient_name,timezone,consent_attested_at,created_by) VALUES($1,$2,$3,$4,now(),$5)',[householdId,input.name.trim(),input.careRecipientName.trim(),input.timezone,actor.id]);
      await tx.query('INSERT INTO memberships(id,household_id,user_id,email,role,status) VALUES($1,$2,$3,$4,$5,$6)',[id(),householdId,actor.id,actor.email,'organizer','active']);
    });
    return { id: householdId };
  }

  async circle(actor: Actor, householdId: string):Promise<Row[]> {
    await member(this.db,householdId,actor.id);
    const people=await this.db.query('SELECT m.id,m.user_id,m.email,m.role,m.status,u.display_name,p.task_types,p.quiet_start,p.quiet_end,p.timezone,p.opted_in,p.unavailable_dates FROM memberships m LEFT JOIN app_users u ON u.id=m.user_id LEFT JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=$1 ORDER BY m.role,m.created_at',[householdId]);
    return people.rows.map(person=>({...person,contact_allowed:person.role==='helper'&&person.status==='active'&&person.opted_in&&contactAllowed(person)}));
  }

  async invite(actor: Actor, householdId: string, email: string) {
    await member(this.db,householdId,actor.id,'organizer');
    const normalized=email.trim().toLowerCase();
    if (normalized === actor.email.toLowerCase()) throw new AppError(422,'You are already in this circle.');
    const membershipId=id();
    await this.db.transaction(async tx => {
      await tx.query('SELECT id FROM households WHERE id=$1 FOR UPDATE',[householdId]);
      const prior=await tx.query('SELECT * FROM memberships WHERE household_id=$1 AND email=$2 FOR UPDATE',[householdId,normalized]);
      if (prior.rows[0]?.status==='active') throw new AppError(409,'This helper is already active.');
      if (prior.rows[0]?.status==='pending') throw new AppError(409,'This invitation is already pending.');
      if (prior.rows.length) {
        await tx.query('UPDATE memberships SET status=$2,user_id=NULL WHERE id=$1',[prior.rows[0].id,'pending']);
        await tx.query('UPDATE helper_preferences SET opted_in=false WHERE membership_id=$1',[prior.rows[0].id]);
      }
      else await tx.query('INSERT INTO memberships(id,household_id,email,role,status) VALUES($1,$2,$3,$4,$5)',[membershipId,householdId,normalized,'helper','pending']);
      await this.queue(tx,'invite',{householdId,email:normalized,deliveryMode:deliveryMode()},new Date());
    });
    return { invited: normalized };
  }

  async join(actor: Actor, householdId: string) {
    await this.upsertUser(actor);
    await this.db.transaction(async tx=>{
      const result=await tx.query('UPDATE memberships SET user_id=$1,status=$4 WHERE household_id=$2 AND lower(email)=lower($3) AND status=$5 RETURNING id',[actor.id,householdId,actor.email,'active','pending']);
      if (!result.rows.length) throw new AppError(404,'No pending invitation for this email.');
      await tx.query('INSERT INTO helper_preferences(membership_id) VALUES($1) ON CONFLICT DO NOTHING',[result.rows[0].id]);
    });
    return { joined: true };
  }

  async preferences(actor: Actor, householdId: string, input: { taskTypes: string[]; quietStart: number; quietEnd: number; timezone: string; optedIn: boolean; unavailableDates?:string[] }) {
    const types=[...new Set(input.taskTypes.map(t=>TaskType.parse(t)))];
    const unavailable=input.unavailableDates===undefined?undefined:UnavailableDates.safeParse(input.unavailableDates);
    if(unavailable&&!unavailable.success)throw new AppError(422,'Choose at most 60 valid unavailable dates.');
    try { new Intl.DateTimeFormat('en-US',{timeZone:input.timezone}); } catch { throw new AppError(422,'Choose a valid timezone.'); }
    await this.db.transaction(async tx=>{
      const m=await member(tx,householdId,actor.id,'helper');
      await tx.query('INSERT INTO helper_preferences(membership_id,task_types,quiet_start,quiet_end,timezone,opted_in) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(membership_id) DO UPDATE SET task_types=EXCLUDED.task_types,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,timezone=EXCLUDED.timezone,opted_in=EXCLUDED.opted_in',[m.id,types,input.quietStart,input.quietEnd,input.timezone,input.optedIn]);
      // Older clients omit this field. Only an explicit array replaces time off.
      if(unavailable?.success)await tx.query('UPDATE helper_preferences SET unavailable_dates=$2 WHERE membership_id=$1',[m.id,JSON.stringify(unavailable.data)]);
    });
    return { saved: true };
  }

  async removeHelper(actor: Actor, householdId: string, membershipId: string) {
    await member(this.db,householdId,actor.id,'organizer');
    return this.db.transaction(async tx=>{
      const result=await tx.query("SELECT * FROM memberships WHERE id=$1 AND household_id=$2 AND role='helper' AND status IN ('active','pending') FOR UPDATE",[membershipId,householdId]);
      const helper=result.rows[0];
      if (!helper) throw new AppError(404,'Helper not found.');
      await tx.query("UPDATE memberships SET status='removed' WHERE id=$1",[membershipId]);
      await tx.query('UPDATE helper_preferences SET opted_in=false WHERE membership_id=$1',[membershipId]);
      const cancelled=await tx.query("UPDATE offers SET status='cancelled' WHERE membership_id=$1 AND status IN ('queued','sent','simulated','in_app_available') RETURNING request_id",[membershipId]);
      const active=await tx.query("SELECT * FROM coverage_requests WHERE household_id=$1 AND accepted_by=$2 AND status='accepted' FOR UPDATE",[householdId,helper.user_id]);
      for (const request of active.rows) {
        const canReopen=new Date(request.due_at)>new Date();
        await tx.query('UPDATE coverage_requests SET status=$2,accepted_by=NULL,updated_at=now() WHERE id=$1',[request.id,canReopen?'seeking':'uncovered']);
        await tx.query("UPDATE offers SET status='cancelled' WHERE request_id=$1 AND status='accepted'",[request.id]);
        if (canReopen) {
          const backups=await tx.query("UPDATE offers SET status='queued',delivery_generation=delivery_generation+1 WHERE request_id=$1 AND status='cancelled' AND responded_at IS NULL AND membership_id<>$2 AND membership_id IN (SELECT id FROM memberships WHERE status='active') RETURNING id,delivery_generation",[request.id,membershipId]);
          for (const offer of backups.rows) await this.queue(tx,'send_offer',{offerId:offer.id,generation:offer.delivery_generation},new Date());
        }
        await this.event(tx,householdId,request.id,actor.id,'helper_removed_reopened');
        await this.notify(tx,householdId,actor.id,request.id,'helper_removed',canReopen?'A helper with an accepted task was removed. Relief is seeking a backup.':'A helper with an accepted task was removed after its due time. This task is uncovered.');
        await reconcileCoverage(tx,request.id);
      }
      for (const requestId of new Set(cancelled.rows.map(offer=>offer.request_id))) await reconcileCoverage(tx,requestId);
      return {removed:true,reopened:active.rows.length};
    });
  }

  async eligible(householdId: string, type: string, dueAt?:string|null) {
    const rows=await this.db.query("SELECT m.id,m.email,u.display_name,p.* FROM memberships m JOIN app_users u ON u.id=m.user_id JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=$1 AND m.role='helper' AND m.status='active' AND p.opted_in=true AND $2=ANY(p.task_types) ORDER BY m.created_at,m.id",[householdId,type]);
    return rows.rows.filter(row=>contactAllowed(row)&&(!dueAt||taskDateAllowed(row,dueAt))).slice(0,5).map(row=>({ id:row.id,email:row.email,name:row.display_name }));
  }

  async eligibleFor(actor:Actor,householdId:string,type:string) {
    await member(this.db,householdId,actor.id,'organizer');
    return this.eligible(householdId,TaskType.parse(type));
  }

  async preview(actor: Actor, householdId: string, text: string) {
    await member(this.db,householdId,actor.id,'organizer');
    const scope=checkScope(text);
    if (!scope.allowed) throw new AppError(422,scope.reason || 'This request is outside Relief’s scope.');
    const household=await this.db.query('SELECT timezone FROM households WHERE id=$1',[householdId]);
    const { task,source }=await this.interpret(text,household.rows[0]?.timezone || 'America/Phoenix');
    return { ...task, brief:safeBrief(task.type,task.title), recipients:await this.eligible(householdId,task.type,task.dueAt), source, needsReview:true,warnings:scope.warnings };
  }

  async saveDraft(actor: Actor, householdId: string, text: string) {
    const payload=await this.preview(actor,householdId,text);
    const draftId=id();
    await this.db.query("INSERT INTO request_drafts(id,household_id,organizer_id,input_text,payload,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",[draftId,householdId,actor.id,text,JSON.stringify(payload)]);
    return { draftId, reviewUrl:`${process.env.APP_ORIGIN || 'http://localhost:5173'}/?draft=${draftId}`, preview:payload };
  }

  async getDraft(actor: Actor, draftId: string) {
    const result=await this.db.query('SELECT * FROM request_drafts WHERE id=$1 AND organizer_id=$2 AND expires_at>now()',[draftId,actor.id]);
    if (!result.rows.length) throw new AppError(404,'Draft not found or expired.');
    return result.rows[0].payload;
  }

  private async event(tx: Queryable, householdId: string, requestId: string | null, actorId: string | null, kind: string, detail: Row={}) {
    await tx.query('INSERT INTO events(id,household_id,request_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6)',[id(),householdId,requestId,actorId,kind,JSON.stringify(detail)]);
  }
  private async notify(tx: Queryable, householdId: string, userId: string, requestId: string | null, kind: string, message: string) {
    await tx.query('INSERT INTO notifications(id,household_id,user_id,request_id,kind,message) VALUES($1,$2,$3,$4,$5,$6)',[id(),householdId,userId,requestId,kind,message]);
  }
  private async queue(tx: Queryable, kind: string, payload: Row, runAt: Date) {
    await tx.query('INSERT INTO jobs(id,kind,payload,run_at) VALUES($1,$2,$3,$4)',[id(),kind,JSON.stringify(payload),runAt.toISOString()]);
  }

  async createRequest(actor: Actor, input: { householdId:string; type:string; title:string; brief:string; instructions:string; location:string; dueAt:string; recipientIds:string[]; idempotencyKey:string }) {
    await member(this.db,input.householdId,actor.id,'organizer');
    const unsafe=checkSafetyText([input.title,input.brief,input.instructions].join(' '));
    if (unsafe) throw new AppError(422,unsafe);
    const type=TaskType.parse(input.type);
    const due=new Date(input.dueAt);
    if (!Number.isFinite(due.getTime()) || due <= new Date()) throw new AppError(422,'Choose a future due time.');
    if (!input.recipientIds.length || input.recipientIds.length>5 || new Set(input.recipientIds).size!==input.recipientIds.length) throw new AppError(422,'Choose one to five eligible helpers.');
    const eligible=await this.eligible(input.householdId,type,input.dueAt);
    if (!input.recipientIds.every(memberId=>eligible.some(item=>item.id===memberId))) throw new AppError(422,'A selected helper is no longer eligible. Review recipients again.');
    return this.db.transaction(async tx=>{
      const prior=await tx.query('SELECT id FROM coverage_requests WHERE organizer_id=$1 AND idempotency_key=$2',[actor.id,input.idempotencyKey]);
      if (prior.rows.length) return { id:prior.rows[0].id, duplicate:true };
      const current=await tx.query("SELECT m.id,m.status,p.opted_in,p.task_types,p.quiet_start,p.quiet_end,p.timezone,p.unavailable_dates FROM memberships m JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=$1 AND m.id=ANY($2::text[]) FOR UPDATE OF m,p",[input.householdId,input.recipientIds]);
      if (current.rows.length!==input.recipientIds.length || current.rows.some(row=>row.status!=='active'||!row.opted_in||!row.task_types.includes(type)||!contactAllowed(row)||!taskDateAllowed(row,input.dueAt))) throw new AppError(409,'A helper’s availability changed. Review recipients again.');
      if (due<=new Date()) throw new AppError(422,'The due time has passed.');
      const requestId=id();
      const inserted=await tx.query('INSERT INTO coverage_requests(id,household_id,organizer_id,type,title,brief,instructions,location,due_at,status,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organizer_id,idempotency_key) DO NOTHING RETURNING id',[requestId,input.householdId,actor.id,type,input.title.trim(),input.brief.trim(),input.instructions.trim(),input.location.trim(),due.toISOString(),'seeking',input.idempotencyKey]);
      if (!inserted.rows.length) {
        const existing=await tx.query('SELECT id FROM coverage_requests WHERE organizer_id=$1 AND idempotency_key=$2',[actor.id,input.idempotencyKey]);
        return {id:existing.rows[0].id,duplicate:true};
      }
      for (const [index,membershipId] of input.recipientIds.entries()) {
        const offerId=id();
        await tx.query("INSERT INTO offers(id,request_id,membership_id,wave,status) VALUES($1,$2,$3,$4,'queued')",[offerId,requestId,membershipId,index<2?1:2]);
        await this.queue(tx,'send_offer',{offerId},index<2?new Date():new Date(Date.now()+15*60_000));
      }
      await this.queue(tx,'at_risk',{requestId},new Date(Math.max(Date.now(),due.getTime()-30*60_000)));
      await this.queue(tx,'due',{requestId},due);
      await this.event(tx,input.householdId,requestId,actor.id,'request_dispatched',{recipientCount:input.recipientIds.length});
      return { id:requestId, duplicate:false };
    });
  }

  async offerResponse(actor: Actor, offerId: string, response: 'accept'|'decline') {
    return this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT o.*,r.household_id,r.status AS request_status,r.due_at,r.organizer_id,m.user_id FROM offers o JOIN coverage_requests r ON r.id=o.request_id JOIN memberships m ON m.id=o.membership_id WHERE o.id=$1 FOR UPDATE OF o,r',[offerId]);
      const offer=rows.rows[0];
      if (!offer || offer.user_id!==actor.id) throw new AppError(403,'This offer is not yours.');
      await member(tx,offer.household_id,actor.id,'helper');
      if (offer.status==='accepted' && response==='accept') return { status:'accepted',requestId:offer.request_id };
      if (offer.status==='declined' && response==='decline') return { status:'declined',requestId:offer.request_id };
      if (!['sent','simulated','in_app_available'].includes(offer.status) || offer.request_status!=='seeking' || new Date(offer.due_at)<=new Date()) throw new AppError(409,'This offer is no longer available.');
      if (response==='decline') {
        await tx.query("UPDATE offers SET status='declined',responded_at=now() WHERE id=$1",[offerId]);
        await this.event(tx,offer.household_id,offer.request_id,actor.id,'offer_declined');
        await reconcileCoverage(tx,offer.request_id);
        return { status:'declined',requestId:offer.request_id };
      }
      const preference=(await tx.query('SELECT timezone,unavailable_dates FROM helper_preferences WHERE membership_id=$1 FOR SHARE',[offer.membership_id])).rows[0];
      if(!preference||!taskDateAllowed(preference,offer.due_at))throw new AppError(409,'This task falls on one of your unavailable dates. Update your preferences or decline the offer.');
      await tx.query("UPDATE coverage_requests SET status='accepted',accepted_by=$2,updated_at=now() WHERE id=$1",[offer.request_id,actor.id]);
      await tx.query("UPDATE offers SET status='accepted',responded_at=now() WHERE id=$1",[offerId]);
      await tx.query("UPDATE offers SET status='cancelled' WHERE request_id=$1 AND id<>$2 AND status IN ('queued','sent','simulated','in_app_available')",[offer.request_id,offerId]);
      await this.event(tx,offer.household_id,offer.request_id,actor.id,'helper_accepted');
      await this.notify(tx,offer.household_id,offer.organizer_id,offer.request_id,'accepted','A helper accepted. The task is not complete yet.');
      return { status:'accepted',requestId:offer.request_id };
    });
  }

  async helperComplete(actor: Actor, requestId: string) {
    return this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE',[requestId]);
      const request=rows.rows[0];
      if (!request || request.accepted_by!==actor.id) throw new AppError(403,'You are not the accepted helper.');
      await member(tx,request.household_id,actor.id,'helper');
      if (request.status==='helper_reported_done') return { status:request.status };
      if (request.status!=='accepted') throw new AppError(409,'This request cannot be marked done.');
      await tx.query("UPDATE coverage_requests SET status='helper_reported_done',updated_at=now() WHERE id=$1",[requestId]);
      await this.event(tx,request.household_id,requestId,actor.id,'helper_reported_done');
      await this.notify(tx,request.household_id,request.organizer_id,requestId,'needs_confirmation','The helper reported completion. Please confirm or dispute.');
      return { status:'helper_reported_done' };
    });
  }

  async organizerConfirm(actor: Actor, requestId: string, decision: 'confirm'|'dispute') {
    return this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE',[requestId]);
      const request=rows.rows[0];
      if (!request) throw new AppError(404,'Request not found.');
      await member(tx,request.household_id,actor.id,'organizer');
      if (request.status!=='helper_reported_done') throw new AppError(409,'Wait for the helper to report completion.');
      const status=decision==='confirm'?'confirmed_done':'disputed';
      await tx.query('UPDATE coverage_requests SET status=$2,updated_at=now() WHERE id=$1',[requestId,status]);
      await this.event(tx,request.household_id,requestId,actor.id,status);
      if (decision==='dispute' && request.accepted_by) await this.notify(tx,request.household_id,request.accepted_by,requestId,'disputed','The organizer disputed completion. Please contact them directly.');
      return { status };
    });
  }

  async helperCancel(actor: Actor, requestId: string) {
    return this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE',[requestId]);
      const request=rows.rows[0];
      if (!request || request.accepted_by!==actor.id) throw new AppError(403,'You are not the accepted helper.');
      await member(tx,request.household_id,actor.id,'helper');
      if (request.status!=='accepted') throw new AppError(409,'This task cannot be reopened.');
      const remaining=new Date(request.due_at)>new Date();
      await tx.query('UPDATE coverage_requests SET status=$2,accepted_by=NULL,updated_at=now() WHERE id=$1',[requestId,remaining?'seeking':'uncovered']);
      await tx.query("UPDATE offers SET status='cancelled' WHERE request_id=$1 AND status='accepted'",[requestId]);
      if (remaining) {
        const others=await tx.query("UPDATE offers SET status='queued',delivery_generation=delivery_generation+1 WHERE request_id=$1 AND status='cancelled' AND responded_at IS NULL RETURNING id,delivery_generation",[requestId]);
        for (const offer of others.rows) await this.queue(tx,'send_offer',{offerId:offer.id,generation:offer.delivery_generation},new Date());
      }
      await this.event(tx,request.household_id,requestId,actor.id,'helper_cancelled');
      await this.notify(tx,request.household_id,request.organizer_id,requestId,'helper_cancelled',remaining?'The helper cancelled. Relief is seeking a backup.':'The helper cancelled after the due time. This task is uncovered.');
      await reconcileCoverage(tx,requestId);
      return { status:(await tx.query('SELECT status FROM coverage_requests WHERE id=$1',[requestId])).rows[0].status };
    });
  }

  async board(actor: Actor, householdId: string) {
    const m=await member(this.db,householdId,actor.id);
    const household=await this.db.query('SELECT timezone FROM households WHERE id=$1',[householdId]);
    const rows=await this.db.query("SELECT r.*,u.display_name AS accepted_name FROM coverage_requests r LEFT JOIN app_users u ON u.id=r.accepted_by WHERE r.household_id=$1 ORDER BY r.due_at DESC LIMIT 100",[householdId]);
    const visible=rows.rows;
    // Fetch offers once for the existing bounded board, not once per request.
    // No cache: membership is rechecked above on every read. Helpers fetch only
    // their own offers; request fields are still redacted below until acceptance.
    const offersByRequest=new Map<string,Row[]>();
    if(visible.length){
      const offers=await this.db.query(`SELECT o.request_id,o.id,o.status,o.wave,m.user_id,u.display_name
        FROM offers o JOIN coverage_requests r ON r.id=o.request_id
        JOIN memberships m ON m.id=o.membership_id LEFT JOIN app_users u ON u.id=m.user_id
        WHERE r.household_id=$1 AND o.request_id=ANY($2::text[])
          AND ($3::text IS NULL OR m.user_id=$3)
        ORDER BY o.request_id,o.wave,o.id`,[householdId,visible.map(request=>request.id),m.role==='organizer'?null:actor.id]);
      for(const {request_id,...offer} of offers.rows){
        const group=offersByRequest.get(request_id)||[];group.push(offer);offersByRequest.set(request_id,group);
      }
    }
    const requests:Row[]=[];
    for (const request of visible) {
      const offers=offersByRequest.get(request.id)||[];
      const mine=offers.find(o=>o.user_id===actor.id);
      if (m.role==='helper' && !mine) continue;
      const canSeeDetails=m.role==='organizer'||request.accepted_by===actor.id;
      const genericTitle=request.type==='meal'?'Meal drop-off':request.type==='ride'?'Ride coordination':'Visit / check-in';
      const derivedUncovered=request.status==='seeking'&&new Date(request.due_at)<=new Date();
      requests.push({ ...request,status:derivedUncovered?'uncovered':request.status,derivedUncovered,title:canSeeDetails?request.title:genericTitle,brief:canSeeDetails?request.brief:safeBrief(request.type,genericTitle),due_at:at(request.due_at),created_at:at(request.created_at),location:canSeeDetails?request.location:'',instructions:canSeeDetails?request.instructions:'',offers:m.role==='organizer'?offers:mine?[mine]:[],atRisk:request.status==='seeking'&&!derivedUncovered&&new Date(request.due_at).getTime()-Date.now()<=30*60_000 });
    }
    const notifications=await this.db.query('SELECT id,kind,message,request_id,created_at,read_at FROM notifications WHERE household_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30',[householdId,actor.id]);
    const events=m.role==='organizer'?(await this.db.query('SELECT e.id,e.request_id,e.kind,e.detail,e.created_at,u.display_name AS actor_name FROM events e LEFT JOIN app_users u ON u.id=e.actor_id WHERE e.household_id=$1 ORDER BY e.created_at DESC LIMIT 100',[householdId])).rows:[];
    return { timezone:household.rows[0]?.timezone||'America/Phoenix',requests,notifications:notifications.rows,events };
  }

  async requestStatus(actor: Actor, requestId: string) {
    const rows=await this.db.query('SELECT id,household_id,title,status,due_at,accepted_by FROM coverage_requests WHERE id=$1',[requestId]);
    const request=rows.rows[0];
    if (!request) throw new AppError(404,'Request not found.');
    const m=await member(this.db,request.household_id,actor.id);
    if (m.role==='helper') {
      const offered=await this.db.query('SELECT 1 FROM offers WHERE request_id=$1 AND membership_id=$2',[requestId,m.id]);
      if (!offered.rows.length) throw new AppError(403,'This request is not visible to you.');
    }
    const derivedUncovered=request.status==='seeking'&&new Date(request.due_at)<=new Date();
    return { id:request.id,title:m.role==='organizer'||request.accepted_by===actor.id?request.title:'Care request',status:derivedUncovered?'uncovered':request.status,derivedUncovered,dueAt:at(request.due_at),accepted:!!request.accepted_by };
  }
}
