import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Queryable, Row } from './db.js';
import { AtlasTask, parseAtlasTasks } from './atlas-parser.js';
import { checkSafetyText } from './scope.js';
import { contactAllowed } from './eligibility.js';
import { AppError, type Actor, ReliefService } from './service.js';
import { deliveryMode,offerMessage } from './worker.js';
import { jobHealth } from './job-health.js';
import { ProposalService } from './proposal-service.js';
import { fingerprint, proposalVersion, proposalInputProblem, type ProposalReceipt } from './proposals.js';
import { deadlineClarifications } from './clarification.js';

export const AtlasTasks=z.array(AtlasTask).min(1).max(5);
type Outreach={recipients:{membershipId:string;email:string;wave:number}[];subject:string|null;text:string|null;html:string|null};
// JSONB preserves array order but not object key order. Hash a canonical encoding.
function canonical(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value!==null && typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest=(tasks:AtlasTask[],outreach:Outreach[],mode:string)=>createHash('sha256').update(canonical({tasks,outreach,deliveryMode:mode})).digest('hex');
const uid=()=>randomUUID();

async function review(db:Queryable,householdId:string,tasks:AtlasTask[]):Promise<Outreach[]> {
  const outreach:Outreach[]=[];
  for (const task of tasks) {
    const members=await db.query('SELECT id,email FROM memberships WHERE household_id=$1 AND id=ANY($2::text[])',[householdId,task.recipientIds]);
    const message=task.dueAt?offerMessage(task.type,task.dueAt):null;
    outreach.push({recipients:task.recipientIds.map((membershipId,index)=>({membershipId,email:members.rows.find(row=>row.id===membershipId)?.email||'Unavailable',wave:index<2?1:2})),subject:message?.subject||null,text:message?.text||null,html:message?.html||null});
  }
  return outreach;
}

async function organizer(db:Queryable,householdId:string,actor:Actor) {
  const found=await db.query("SELECT 1 FROM memberships WHERE household_id=$1 AND user_id=$2 AND role='organizer' AND status='active' FOR SHARE",[householdId,actor.id]);
  if (!found.rows.length) throw new AppError(403,'Only an active organizer can review this plan.');
}

export class AtlasService {
  constructor(private db:Database,private relief:ReliefService,private proposals?:ProposalService) {}

  async drafts(actor:Actor,householdId:string) {
    await organizer(this.db,householdId,actor);
    // Repeat the membership check in the read itself so a concurrent revocation
    // cannot expose a plan after the initial authorization statement.
    const result=await this.db.query(`SELECT a.id,a.payload,a.created_at,a.expires_at,a.recovery_source_id
      FROM atlas_plans a WHERE a.household_id=$1 AND a.organizer_id=$2
      AND a.status='draft' AND a.expires_at>now() AND EXISTS
        (SELECT 1 FROM memberships m WHERE m.household_id=a.household_id
         AND m.user_id=$2 AND m.role='organizer' AND m.status='active')
      ORDER BY a.created_at DESC,a.id DESC LIMIT 20`,[householdId,actor.id]);
    return result.rows.map(plan=>({id:plan.id,titles:AtlasTasks.parse(plan.payload).map(task=>task.title),
      createdAt:new Date(plan.created_at).toISOString(),expiresAt:new Date(plan.expires_at).toISOString(),
      recoverySourceId:plan.recovery_source_id}));
  }

  async create(actor:Actor,householdId:string,text:string,options:{useModel?:boolean;proposalKey?:string}={}) {
    await organizer(this.db,householdId,actor);
    const unsafe=checkSafetyText(text);
    if (unsafe) throw new AppError(422,unsafe);
    const inputProblem=proposalInputProblem(text);
    if(inputProblem)throw new AppError(422,`Drafting stopped: ${inputProblem}. Clarify the request.`);
    const household=await this.db.query('SELECT timezone FROM households WHERE id=$1',[householdId]);
    let tasks:AtlasTask[];
    let receipt:ProposalReceipt={version:proposalVersion,source:'deterministic',outcome:'validated',inputHash:fingerprint(text),citations:[]};
    if(options.useModel&&!this.proposals)throw new AppError(409,'Model drafting is disabled. No external model was called.');
    try {
      if(options.useModel){
        if(!options.proposalKey)throw new AppError(422,'Model drafting requires a proposal replay key.');
        const result=await this.proposals!.propose(actor,householdId,text,household.rows[0].timezone,options.proposalKey);
        tasks=result.tasks;receipt=result.receipt;
      }else tasks=parseAtlasTasks(text,household.rows[0].timezone);
    }
    catch(error) { if(error instanceof AppError)throw error;throw new AppError(422,'Could not prepare tasks. Clarify the request.'); }
    for (const task of tasks) task.recipientIds=(await this.relief.eligible(householdId,task.type)).map(item=>item.id);
    await this.relief.upsertUser(actor);
    return this.saveNew(actor,householdId,text,tasks,null,receipt,options.useModel?options.proposalKey:undefined);
  }

  private async saveNew(actor:Actor,householdId:string,text:string,tasks:AtlasTask[],recoverySourceId:string|null=null,proposal?:ProposalReceipt,proposalKey?:string) {
    const planId=uid();
    const mode=deliveryMode();
    const outreach=await review(this.db,householdId,tasks);
    const hash=digest(tasks,outreach,mode);
    // Recheck access after a potentially slow provider call; no external work in this transaction.
    const savedId=await this.db.transaction(async tx=>{
      await organizer(tx,householdId,actor);
      const inserted=await tx.query("INSERT INTO atlas_plans(id,household_id,organizer_id,source_text,payload,digest,expires_at,delivery_mode,review_snapshot,recovery_source_id,proposal_metadata,proposal_key) VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 hours',$7,$8,$9,$10,$11) ON CONFLICT (proposal_key) DO NOTHING RETURNING id",[planId,householdId,actor.id,text,JSON.stringify(tasks),hash,mode,JSON.stringify(outreach),recoverySourceId,JSON.stringify(proposal||{}),proposalKey||null]);
      if(inserted.rows.length)return planId;
      const prior=(await tx.query('SELECT id FROM atlas_plans WHERE proposal_key=$1 AND household_id=$2 AND organizer_id=$3',[proposalKey,householdId,actor.id])).rows[0];
      if(!prior)throw new AppError(409,'Proposal replay scope changed.');return String(prior.id);
    });
    return {...await this.get(actor,savedId),reviewUrl:`${process.env.APP_ORIGIN||'http://localhost:5173'}/?plan=${savedId}`};
  }

  async recover(actor:Actor,requestId:string) {
    const request=(await this.db.query('SELECT * FROM coverage_requests WHERE id=$1',[requestId])).rows[0];
    if (!request) throw new AppError(404,'Request not found.');
    await organizer(this.db,request.household_id,actor);
    if (!['uncovered','disputed'].includes(request.status) && !(request.status==='seeking' && new Date(request.due_at)<=new Date())) throw new AppError(409,'Recovery is available for uncovered or disputed tasks.');
    const dueAt=new Date(request.due_at)>new Date()?new Date(request.due_at).toISOString():null;
    const task=AtlasTask.parse({type:request.type,title:request.title,brief:request.brief,dueAt,recipientIds:[],location:request.location,instructions:request.instructions,warnings:dueAt?[]:['Choose a new exact due time.']});
    return this.saveNew(actor,request.household_id,`Recovery review: ${request.title}`,[task],requestId);
  }

  private async row(actor:Actor,planId:string,db:Queryable=this.db):Promise<Row> {
    const result=await db.query('SELECT * FROM atlas_plans WHERE id=$1',[planId]);
    const plan=result.rows[0];
    if (!plan) throw new AppError(404,'Plan not found.');
    await organizer(db,plan.household_id,actor);
    if (plan.organizer_id!==actor.id) throw new AppError(403,'This plan belongs to another organizer.');
    return plan;
  }

  async get(actor:Actor,planId:string) {
    const plan=await this.row(actor,planId);
    const tasks=plan.payload as AtlasTask[];
    const outreach=plan.review_snapshot.length?plan.review_snapshot:await review(this.db,plan.household_id,tasks);
    return {id:plan.id,householdId:plan.household_id,sourceText:plan.source_text,tasks,digest:plan.digest,status:plan.status,expiresAt:new Date(plan.expires_at).toISOString(),outreach,deliveryMode:plan.delivery_mode,recoverySourceId:plan.recovery_source_id,needsRefresh:!plan.review_snapshot.length,proposal:plan.proposal_metadata as Partial<ProposalReceipt>,clarifications:plan.status==='draft'?deadlineClarifications(tasks,plan.source_text):[]};
  }

  async update(actor:Actor,planId:string,previousDigest:string,input:AtlasTask[]) {
    const tasks=AtlasTasks.parse(input);
    for (const task of tasks) {
      const unsafe=checkSafetyText([task.title,task.brief,task.instructions,task.location].join(' '));
      if (unsafe) throw new AppError(422,unsafe);
      task.warnings=task.dueAt?[]:['An exact day and time are required. Choose them before approval.'];
    }
    return this.db.transaction(async tx=>{
      const locked=await tx.query('SELECT * FROM atlas_plans WHERE id=$1 FOR UPDATE',[planId]);
      if (!locked.rows.length) throw new AppError(404,'Plan not found.');
      const plan=locked.rows[0];
      await organizer(tx,plan.household_id,actor);
      if (plan.organizer_id!==actor.id) throw new AppError(403,'This plan belongs to another organizer.');
      if (plan.status!=='draft'||new Date(plan.expires_at)<=new Date()) throw new AppError(409,'This plan is no longer editable.');
      if (plan.digest!==previousDigest) throw new AppError(409,'The plan changed. Reload before editing.');
      const mode=deliveryMode();
      const outreach=await review(tx,plan.household_id,tasks);
      const hash=digest(tasks,outreach,mode);
      await tx.query('UPDATE atlas_plans SET payload=$2,digest=$3,delivery_mode=$4,review_snapshot=$5 WHERE id=$1',[planId,JSON.stringify(tasks),hash,mode,JSON.stringify(outreach)]);
      return {id:planId,householdId:plan.household_id,sourceText:plan.source_text,tasks,outreach,deliveryMode:mode,digest:hash,status:'draft',expiresAt:new Date(plan.expires_at).toISOString(),clarifications:deadlineClarifications(tasks,plan.source_text)};
    });
  }

  async approve(actor:Actor,planId:string,approvedDigest:string) {
    return this.db.transaction(async tx=>{
      const locked=await tx.query('SELECT * FROM atlas_plans WHERE id=$1 FOR UPDATE',[planId]);
      if (!locked.rows.length) throw new AppError(404,'Plan not found.');
      const plan=locked.rows[0];
      await organizer(tx,plan.household_id,actor);
      if (plan.organizer_id!==actor.id) throw new AppError(403,'This plan belongs to another organizer.');
      if (plan.digest!==approvedDigest) throw new AppError(409,'The reviewed plan changed. Reload before approval.');
      if (plan.status==='approved') {
        const prior=await tx.query('SELECT id FROM coverage_requests WHERE plan_id=$1 ORDER BY plan_task_index',[planId]);
        return {requestIds:prior.rows.map(row=>row.id),duplicate:true};
      }
      if (new Date(plan.expires_at)<=new Date()) throw new AppError(409,'This plan expired. Prepare it again.');
      const tasks=AtlasTasks.parse(plan.payload);
      const outreach=plan.review_snapshot as Outreach[];
      if (outreach.length!==tasks.length||digest(tasks,outreach,plan.delivery_mode)!==plan.digest) throw new AppError(409,'The outreach review changed. Save and review the plan again.');
      if (deliveryMode()!==plan.delivery_mode) throw new AppError(409,'The delivery channel changed. Save and review the plan again.');
      const requestIds:string[]=[];
      for (const [index,task] of tasks.entries()) {
        const unsafe=checkSafetyText([task.title,task.brief,task.instructions,task.location].join(' '));
        if (unsafe) throw new AppError(422,unsafe);
        if (!task.dueAt||new Date(task.dueAt)<=new Date()) throw new AppError(422,`Task ${index+1} needs a future, exact due time.`);
        if (!task.recipientIds.length||new Set(task.recipientIds).size!==task.recipientIds.length) throw new AppError(422,`Task ${index+1} needs one to five distinct helpers.`);
        const people=await tx.query("SELECT m.id,m.email,m.status,m.role,p.opted_in,p.task_types,p.quiet_start,p.quiet_end,p.timezone FROM memberships m JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=$1 AND m.id=ANY($2::text[]) FOR UPDATE OF m,p",[plan.household_id,task.recipientIds]);
        if (people.rows.length!==task.recipientIds.length||people.rows.some(row=>row.role!=='helper'||row.status!=='active'||!row.opted_in||!row.task_types.includes(task.type)||!contactAllowed(row))) throw new AppError(409,`Task ${index+1} has a helper who is no longer eligible. Review the plan.`);
        if (people.rows.some(row=>outreach[index].recipients.find(person=>person.membershipId===row.id)?.email!==row.email)) throw new AppError(409,'A recipient address changed. Save and review the plan again.');
        const requestId=uid();
        requestIds.push(requestId);
        await tx.query("INSERT INTO coverage_requests(id,household_id,organizer_id,type,title,brief,instructions,location,due_at,status,idempotency_key,plan_id,plan_task_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'seeking',$10,$11,$12)",[requestId,plan.household_id,actor.id,task.type,task.title.trim(),task.brief.trim(),task.instructions.trim(),task.location.trim(),task.dueAt,`${planId}:${index}`,planId,index]);
        for (const [wave,membershipId] of task.recipientIds.entries()) {
          const offerId=uid();
          const message=outreach[index];
          const recipient=message.recipients.find(person=>person.membershipId===membershipId)!;
          await tx.query("INSERT INTO offers(id,request_id,membership_id,wave,status,message_subject,message_html,delivery_mode,recipient_email) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8)",[offerId,requestId,membershipId,wave<2?1:2,message.subject,message.html,plan.delivery_mode,recipient.email]);
          await tx.query("INSERT INTO jobs(id,kind,payload,run_at) VALUES($1,'send_offer',$2,$3)",[uid(),JSON.stringify({offerId,generation:0}),new Date(Date.now()+(wave<2?0:15*60_000)).toISOString()]);
        }
        await tx.query("INSERT INTO jobs(id,kind,payload,run_at) VALUES($1,'at_risk',$2,$3)",[uid(),JSON.stringify({requestId}),new Date(Math.max(Date.now(),new Date(task.dueAt).getTime()-30*60_000)).toISOString()]);
        await tx.query("INSERT INTO jobs(id,kind,payload,run_at) VALUES($1,'due',$2,$3)",[uid(),JSON.stringify({requestId}),task.dueAt]);
        await tx.query('INSERT INTO events(id,household_id,request_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6)',[uid(),plan.household_id,requestId,actor.id,'plan_approved',JSON.stringify({planId,planDigest:approvedDigest,taskIndex:index,recipientCount:task.recipientIds.length,deliveryMode:plan.delivery_mode,recoverySourceId:plan.recovery_source_id})]);
      }
      await tx.query("UPDATE atlas_plans SET status='approved',approved_at=now() WHERE id=$1",[planId]);
      return {requestIds,duplicate:false};
    });
  }

  async rehearse(actor:Actor,planId:string,excludedMembershipId:string) {
    await this.row(actor,planId);
    // One read statement captures all factual inputs at the same database snapshot.
    // No jobs, plans, offers, or events are written by this path.
    const snapshot=await this.db.query(`SELECT a.*,now() AS snapshot_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',u.display_name,'status',m.status,'role',m.role,'opted_in',p.opted_in,'task_types',p.task_types,'quiet_start',p.quiet_start,'quiet_end',p.quiet_end,'timezone',p.timezone) ORDER BY m.id)
        FROM memberships m JOIN app_users u ON u.id=m.user_id JOIN helper_preferences p ON p.membership_id=m.id WHERE m.household_id=a.household_id),'[]'::jsonb) AS people,
      (SELECT count(*)::int FROM jobs j WHERE j.status IN ('pending','running') AND
        ((j.payload->>'offerId') IN (SELECT o.id FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=a.household_id)
         OR (j.payload->>'requestId') IN (SELECT r.id FROM coverage_requests r WHERE r.household_id=a.household_id))) AS queued_jobs
      FROM atlas_plans a WHERE a.id=$1 AND a.organizer_id=$2 AND EXISTS
        (SELECT 1 FROM memberships m WHERE m.household_id=a.household_id AND m.user_id=$2 AND m.role='organizer' AND m.status='active')`,[planId,actor.id]);
    const plan=snapshot.rows[0];
    if (!plan) throw new AppError(403,'Organizer access changed.');
    const tasks=AtlasTasks.parse(plan.payload);
    if (!tasks.some(task=>task.recipientIds.includes(excludedMembershipId))) throw new AppError(422,'Choose a helper selected in this reviewed plan.');
    const scenarios=[];
    for (const task of tasks) {
      const candidates=(plan.people as Row[]).filter(person=>person.status==='active'&&person.role==='helper'&&person.opted_in&&person.task_types.includes(task.type)&&contactAllowed(person,new Date(plan.snapshot_at)));
      const selected=candidates.filter(person=>task.recipientIds.includes(person.id));
      const remaining=selected.filter(person=>person.id!==excludedMembershipId);
      scenarios.push({title:task.title,dueAt:task.dueAt,selectedBefore:selected.map(person=>person.name),remainingApproved:remaining.map(person=>person.name),uncoveredIfDeclined:remaining.length===0,possibleNewCandidates:candidates.filter(person=>!task.recipientIds.includes(person.id)).map(person=>person.name)});
    }
    return {mode:'hypothetical',sourcePlanId:planId,snapshotDigest:plan.digest,snapshotAt:new Date(plan.snapshot_at).toISOString(),excludedMembershipId,scenarios,sideEffects:0,queuedJobsAtSnapshot:plan.queued_jobs};
  }

  async timeline(actor:Actor,requestId:string) {
    const request=(await this.db.query('SELECT household_id FROM coverage_requests WHERE id=$1',[requestId])).rows[0];
    if (!request) throw new AppError(404,'Request not found.');
    await organizer(this.db,request.household_id,actor);
    const result=await this.db.query('SELECT e.id,e.kind,e.detail,e.created_at,e.actor_id,u.display_name AS actor_name FROM events e LEFT JOIN app_users u ON u.id=e.actor_id WHERE e.request_id=$1 ORDER BY e.created_at,e.id',[requestId]);
    return {requestId,events:result.rows.map(row=>({id:row.id,kind:row.kind,detail:row.detail,at:new Date(row.created_at).toISOString(),actor:row.actor_name||'Relief system',sourceEventId:row.id}))};
  }

  async operations(actor:Actor,householdId:string) {
    await organizer(this.db,householdId,actor);
    const rows=await this.db.query("SELECT j.status,count(*)::int AS count FROM jobs j WHERE (j.payload->>'requestId') IN (SELECT id FROM coverage_requests WHERE household_id=$1) OR (j.payload->>'offerId') IN (SELECT o.id FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=$1) GROUP BY j.status",[householdId]);
    const uncovered=await this.db.query("SELECT count(*)::int AS count FROM coverage_requests WHERE household_id=$1 AND (status='uncovered' OR (status='seeking' AND due_at<=now()))",[householdId]);
    const deliveryFailed=await this.db.query("SELECT count(*)::int AS count FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=$1 AND o.status='delivery_failed'",[householdId]);
    return {jobs:Object.fromEntries(rows.rows.map(row=>[row.status,row.count])),...await jobHealth(this.db,householdId),uncovered:uncovered.rows[0].count,deliveryFailed:deliveryFailed.rows[0].count,note:'Database measurements. A deployed scheduled worker can publish these as CloudWatch metrics; this view does not prove that integration is live.'};
  }
}
