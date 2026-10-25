import {randomUUID} from 'node:crypto';
import type {Database,Queryable,Row} from './db.js';
import {AppError,type Actor} from './service.js';

async function authorized(tx:Queryable,actor:Actor,householdId:string){
  const found=await tx.query(`SELECT h.id,h.name,h.care_recipient_name,h.timezone,h.created_at,h.closed_at
    FROM households h JOIN memberships m ON m.household_id=h.id
    WHERE h.id=$1 AND m.user_id=$2 AND m.role='organizer' AND m.status='active' AND h.closed_at IS NULL
    FOR SHARE OF h,m`,[householdId,actor.id]);
  if(!found.rows.length)throw new AppError(403,'Only an active organizer can manage this circle.');
  return found.rows[0];
}

export class CircleControls{
  constructor(private db:Database){}
  async export(actor:Actor,householdId:string){
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const household=await authorized(tx,actor,householdId);
      const data={household,people:[] as Row[],requests:[] as Row[],offers:[] as Row[],plans:[] as Row[],events:[] as Row[],assistantRuns:[] as Row[]};
      const queries:Record<Exclude<keyof typeof data,'household'>,string>={
        people:`SELECT m.id,m.user_id,m.email,m.role,m.status,m.created_at,u.display_name,
          p.task_types,p.quiet_start,p.quiet_end,p.timezone,p.opted_in,p.unavailable_dates
          FROM memberships m LEFT JOIN app_users u ON u.id=m.user_id LEFT JOIN helper_preferences p ON p.membership_id=m.id
          WHERE m.household_id=$1 ORDER BY m.id LIMIT 1001`,
        requests:`SELECT id,type,title,brief,instructions,location,due_at,status,accepted_by,created_at,updated_at,plan_id,plan_task_index
          FROM coverage_requests WHERE household_id=$1 ORDER BY id LIMIT 1001`,
        offers:`SELECT o.id,o.request_id,o.membership_id,o.wave,o.status,o.delivery_mode,o.sent_at,o.responded_at
          FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=$1 ORDER BY o.id LIMIT 1001`,
        plans:`SELECT id,source_text,payload,digest,status,delivery_mode,review_snapshot,recovery_source_id,created_at,expires_at
          FROM atlas_plans WHERE household_id=$1 ORDER BY id LIMIT 1001`,
        events:`SELECT id,request_id,actor_id,kind,detail,created_at FROM events WHERE household_id=$1 ORDER BY created_at,id LIMIT 1001`,
        assistantRuns:`SELECT id,actor_id,status,result,created_at FROM model_calls WHERE household_id=$1 AND result->>'kind'='agent' ORDER BY created_at,id LIMIT 1001`
      };
      for(const [key,sql]of Object.entries(queries)){
        const rows=(await tx.query(sql,[householdId])).rows;
        if(rows.length>1000)throw new AppError(409,'This circle exceeds the self-service export limit. Arrange an assisted export; no partial export was returned.');
        data[key as keyof typeof queries]=rows;
      }
      const result={schemaVersion:1,product:'Relief Atlas',exportedAt:new Date().toISOString(),scope:'This circle only. Contains private family data. Not a support diagnostic.',...data};
      if(Buffer.byteLength(JSON.stringify(result))>5*1024*1024)throw new AppError(409,'This circle exceeds the export size limit. Arrange an assisted export; no partial export was returned.');
      return result;
    });
  }
  async close(actor:Actor,householdId:string,confirmation:string){
    return this.db.transaction(async tx=>{
      const household=(await tx.query('SELECT id,name,created_by,closed_at FROM households WHERE id=$1 FOR UPDATE',[householdId])).rows[0];
      if(!household)throw new AppError(403,'Only an active organizer can manage this circle.');
      if(household.closed_at){
        if(household.created_by!==actor.id)throw new AppError(403,'Only an active organizer can manage this circle.');
        return {closed:true,duplicate:true,closedAt:new Date(household.closed_at).toISOString(),dataDeleted:false};
      }
      await authorized(tx,actor,householdId);
      if(confirmation!==household.name)throw new AppError(422,'Type the exact circle name to confirm closing it.');
      const requests=(await tx.query(`SELECT id,status FROM coverage_requests WHERE household_id=$1
        AND status IN ('seeking','accepted','helper_reported_done','disputed') ORDER BY id FOR UPDATE`,[householdId])).rows;
      await tx.query('SELECT id FROM memberships WHERE household_id=$1 ORDER BY id FOR UPDATE',[householdId]);
      await tx.query(`UPDATE memberships SET status='removed' WHERE household_id=$1 AND status IN ('pending','active')`,[householdId]);
      await tx.query(`UPDATE helper_preferences SET opted_in=false WHERE membership_id IN (SELECT id FROM memberships WHERE household_id=$1)`,[householdId]);
      await tx.query(`UPDATE offers SET status='cancelled',delivery_generation=delivery_generation+1
        WHERE request_id IN (SELECT id FROM coverage_requests WHERE household_id=$1 AND status<>'confirmed_done')
        AND status IN ('queued','sent','simulated','in_app_available','accepted')`,[householdId]);
      await tx.query(`UPDATE coverage_requests SET status='cancelled',updated_at=now()
        WHERE household_id=$1 AND status IN ('seeking','accepted','helper_reported_done','disputed')`,[householdId]);
      const cancelled=await tx.query(`UPDATE jobs SET status='cancelled',lease_token=NULL,claimed_at=NULL,last_error='circle_closed'
        WHERE status IN ('pending','running') AND (payload->>'householdId'=$1
        OR payload->>'requestId' IN (SELECT id FROM coverage_requests WHERE household_id=$1)
        OR payload->>'offerId' IN (SELECT o.id FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=$1)) RETURNING id`,[householdId]);
      for(const request of requests)await tx.query(`INSERT INTO events(id,household_id,request_id,actor_id,kind,detail)
        VALUES($1,$2,$3,$4,'request_cancelled_circle_closed',$5)`,[randomUUID(),householdId,request.id,actor.id,JSON.stringify({previousStatus:request.status})]);
      await tx.query(`INSERT INTO events(id,household_id,actor_id,kind,detail) VALUES($1,$2,$3,'circle_closed',$4)`,[randomUUID(),householdId,actor.id,JSON.stringify({requestsCancelled:requests.length,jobsCancelled:cancelled.rows.length,dataDeleted:false})]);
      const updated=await tx.query('UPDATE households SET closed_at=now() WHERE id=$1 RETURNING closed_at',[householdId]);
      return {closed:true,duplicate:false,closedAt:new Date(updated.rows[0].closed_at).toISOString(),requestsCancelled:requests.length,jobsCancelled:cancelled.rows.length,dataDeleted:false};
    });
  }
}
