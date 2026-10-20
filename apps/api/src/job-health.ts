import type { Queryable } from './db.js';

export async function jobHealth(db:Queryable,householdId?:string) {
  const scope=householdId?`WHERE (payload->>'requestId') IN (SELECT id FROM coverage_requests WHERE household_id=$1)
    OR (payload->>'offerId') IN (SELECT o.id FROM offers o JOIN coverage_requests r ON r.id=o.request_id WHERE r.household_id=$1)
    OR payload->>'householdId'=$1`:'';
  const result=await db.query(`SELECT
    count(*) FILTER (WHERE status='pending' AND run_at<=now())::int AS ready,
    count(*) FILTER (WHERE status='failed')::int AS failed,
    count(*) FILTER (WHERE status='running' AND claimed_at<now()-interval '5 minutes')::int AS abandoned,
    COALESCE(max(EXTRACT(EPOCH FROM now()-run_at)) FILTER (WHERE status='pending' AND run_at<=now()),0)::float8 AS oldest
    FROM jobs ${scope}`,householdId?[householdId]:[]);
  const row=result.rows[0];
  return {readyJobs:row.ready,failedJobs:row.failed,abandonedLeases:row.abandoned,oldestReadySeconds:Math.max(0,Math.round(row.oldest))};
}

export function sweepTelemetry(health:Awaited<ReturnType<typeof jobHealth>>,processed:number,failed=false){
  const values={ReadyJobs:health.readyJobs,FailedJobs:health.failedJobs,AbandonedLeases:health.abandonedLeases,OldestReadySeconds:health.oldestReadySeconds,ProcessedJobs:processed,SweepFailed:failed?1:0,SweepSucceeded:failed?0:1};
  return {_aws:{Timestamp:Date.now(),CloudWatchMetrics:[{Namespace:'ReliefAtlas/Outbox',Dimensions:[['Worker']],Metrics:Object.keys(values).map(Name=>({Name,Unit:Name==='OldestReadySeconds'?'Seconds':'Count'}))}]},Worker:'database-sweep',kind:'scheduled-job-sweep',...values};
}
