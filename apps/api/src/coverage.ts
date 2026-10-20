import { randomUUID } from 'node:crypto';
import type { Queryable } from './db.js';

// Call inside the transaction that ends an offer. Locking the request serializes
// exhaustion with acceptance so an uncovered result cannot overwrite a winner.
export async function reconcileCoverage(tx:Queryable,requestId:string):Promise<boolean> {
  const request=(await tx.query('SELECT * FROM coverage_requests WHERE id=$1 FOR UPDATE',[requestId])).rows[0];
  if (!request||request.status!=='seeking') return false;
  const available=await tx.query("SELECT 1 FROM offers WHERE request_id=$1 AND status IN ('queued','sent','simulated','in_app_available') LIMIT 1",[requestId]);
  if (available.rows.length && new Date(request.due_at)>new Date()) return false;
  const reason=new Date(request.due_at)<=new Date()?'deadline_passed':'approved_helpers_exhausted';
  await tx.query("UPDATE coverage_requests SET status='uncovered',updated_at=now() WHERE id=$1",[requestId]);
  await tx.query("UPDATE offers SET status='expired' WHERE request_id=$1 AND status IN ('queued','sent','simulated','in_app_available')",[requestId]);
  await tx.query('INSERT INTO events(id,household_id,request_id,kind,detail) VALUES($1,$2,$3,$4,$5)',[randomUUID(),request.household_id,requestId,'uncovered',JSON.stringify({reason})]);
  await tx.query('INSERT INTO notifications(id,household_id,user_id,request_id,kind,message) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),request.household_id,request.organizer_id,requestId,'uncovered',reason==='deadline_passed'?'Nobody accepted before the deadline. Review a recovery plan.':'No approved helper remains available. This task is uncovered. Review a recovery plan.']);
  return true;
}
