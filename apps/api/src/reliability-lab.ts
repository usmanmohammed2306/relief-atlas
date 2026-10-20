import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AtlasService } from './atlas.js';
import { createEmbeddedDatabase, migrate, seedDemo, type Database } from './db.js';
import { AppError, ReliefService, type Actor } from './service.js';
import { deliveryMode, runOneJob, type Mailer } from './worker.js';

export type ReliabilityCheck = {
  id: string;
  label: string;
  passed: boolean;
  expected: string | number | boolean;
  actual: string | number | boolean;
};
export type ReliabilityCounts = { plans: number; requests: number; offers: number; jobs: number; events: number };
export type ReliabilityStep = {
  id: string;
  label: string;
  at: string;
  elapsedMilliseconds: number;
  requestStatus: string;
  offerStatus: string;
  jobStatus: string;
  attempts: number;
  adapterCalls: number;
  eventIds: string[];
  counts: ReliabilityCounts;
};
export type ReliabilityScenario = {
  id: 'control' | 'delivery_outage';
  label: string;
  description: string;
  elapsedMilliseconds: number;
  steps: ReliabilityStep[];
  events: { id: string; kind: string; at: string; actor: string }[];
  checks: ReliabilityCheck[];
  final: { requestId: string; requestStatus: string; offerStatus: string; jobStatus: string; attempts: number };
  recovery: null | { planId: string; sourceRequestId: string; status: string; selectedHelpers: number; queuedJobsDelta: number };
};
export type ReliabilityLabReport = {
  schemaVersion: 1;
  runId: string;
  measuredAt: string;
  elapsedMilliseconds: number;
  status: 'passed' | 'failed';
  scope: string;
  checks: ReliabilityCheck[];
  totals: {
    scenarios: number;
    checks: number;
    passedChecks: number;
    adapterCalls: number;
    externalContacts: 0;
    preapprovalContacts: number;
    sandboxDatabases: number;
    closedSandboxDatabases: number;
  };
  scenarios: ReliabilityScenario[];
};

const organizer: Actor = { id: 'demo-organizer', email: 'alex@example.test', displayName: 'Alex Morgan' };
const rounded = (value: number) => Number(value.toFixed(3));
const check = (id: string, label: string, actual: ReliabilityCheck['actual'], expected: ReliabilityCheck['expected']): ReliabilityCheck => ({ id, label, passed: actual === expected, expected, actual });
const stateCounts = async (db: Database): Promise<ReliabilityCounts> => (await db.query<ReliabilityCounts>(`SELECT
  (SELECT count(*)::int FROM atlas_plans) AS plans,
  (SELECT count(*)::int FROM coverage_requests) AS requests,
  (SELECT count(*)::int FROM offers) AS offers,
  (SELECT count(*)::int FROM jobs) AS jobs,
  (SELECT count(*)::int FROM events) AS events`)).rows[0];
const sameCounts = (left: ReliabilityCounts, right: ReliabilityCounts) => (Object.keys(left) as (keyof ReliabilityCounts)[]).every(key => left[key] === right[key]);

// This function owns its databases. It deliberately accepts neither a database
// nor a provider adapter, so a route cannot accidentally target a real household.
export async function runReliabilityLab(options: { demoEnabled: boolean }): Promise<ReliabilityLabReport> {
  if (!options.demoEnabled || process.env.DEMO_MODE !== 'true') throw new AppError(404, 'The reliability lab is available only in the fictional demo.');
  if (deliveryMode() !== 'simulated') throw new AppError(409, 'The reliability lab requires simulated delivery.');
  const started = performance.now();
  const measuredAt = new Date().toISOString();
  let sandboxDatabases = 0;
  let closedSandboxDatabases = 0;
  let preapprovalContacts = 0;
  const scenarios: ReliabilityScenario[] = [];
  const isolationChecks: ReliabilityCheck[] = [];

  for (const scenarioId of ['control', 'delivery_outage'] as const) {
    // No directory means a new in-memory database, even when the process has a
    // DATABASE_URL, DB_HOST, or PGLITE_DIR pointing at its ordinary application.
    const db = await createEmbeddedDatabase();
    sandboxDatabases++;
    try {
      await migrate(db);
      await seedDemo(db);
      const initial = await stateCounts(db);
      isolationChecks.push(check(`${scenarioId}.empty_fixture`, 'A fresh fictional sandbox starts without plans, requests, offers, jobs or events', Object.values(initial).reduce((sum, count) => sum + count, 0), 0));
      const result = await runScenario(db, scenarioId);
      scenarios.push(result.scenario);
      preapprovalContacts += result.preapprovalContacts;
    } finally {
      // Exceptions, including failed assertions in production services, propagate
      // after disposal. They can never produce a successful report.
      await db.close();
      closedSandboxDatabases++;
    }
  }

  const checks = [
    ...isolationChecks,
    ...scenarios.flatMap(scenario => scenario.checks),
    check('sandboxes_disposed', 'Every allocated sandbox was closed before returning', closedSandboxDatabases, sandboxDatabases)
  ];
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    measuredAt,
    elapsedMilliseconds: rounded(performance.now() - started),
    status: checks.every(item => item.passed) ? 'passed' : 'failed',
    scope: 'Local fictional PGlite execution using the application approval and worker code. Delivery adapters are simulated. Only the sandbox retry due times are accelerated; elapsed time is local execution time, not the production retry delay. No AWS, real email, model, browser latency, load test or user study is measured.',
    checks,
    totals: {
      scenarios: scenarios.length,
      checks: checks.length,
      passedChecks: checks.filter(item => item.passed).length,
      adapterCalls: scenarios.reduce((sum, scenario) => sum + (scenario.steps.at(-1)?.adapterCalls ?? 0), 0),
      externalContacts: 0,
      preapprovalContacts,
      sandboxDatabases,
      closedSandboxDatabases
    },
    scenarios
  };
}

async function runScenario(db: Database, scenarioId: ReliabilityScenario['id']): Promise<{ scenario: ReliabilityScenario; preapprovalContacts: number }> {
  const started = performance.now();
  const service = new ReliefService(db);
  const atlas = new AtlasService(db, service);
  const steps: ReliabilityStep[] = [];
  const checks: ReliabilityCheck[] = [];
  let requestId: string | undefined;
  let adapterCalls = 0;
  const deliveryKeys: string[] = [];
  const deliveryRecipients: string[] = [];
  const deliveryModes: (string | undefined)[] = [];
  const deliveryBodies: string[] = [];
  const assertObserved = (id: string, label: string, actual: ReliabilityCheck['actual'], expected: ReliabilityCheck['expected']) => checks.push(check(`${scenarioId}.${id}`, label, actual, expected));

  const snapshot = async (id: string, label: string): Promise<ReliabilityStep> => {
    const request = requestId ? (await db.query('SELECT status FROM coverage_requests WHERE id=$1', [requestId])).rows[0] : undefined;
    const offer = requestId ? (await db.query('SELECT id,status FROM offers WHERE request_id=$1', [requestId])).rows[0] : undefined;
    const job = offer ? (await db.query("SELECT status,attempts FROM jobs WHERE kind='send_offer' AND payload->>'offerId'=$1", [offer.id])).rows[0] : undefined;
    const events = requestId ? (await db.query('SELECT id FROM events WHERE request_id=$1 ORDER BY created_at,id', [requestId])).rows : [];
    const step: ReliabilityStep = {
      id,
      label,
      at: new Date().toISOString(),
      elapsedMilliseconds: rounded(performance.now() - started),
      requestStatus: request?.status ?? 'not_created',
      offerStatus: offer?.status ?? 'not_created',
      jobStatus: job?.status ?? 'not_created',
      attempts: Number(job?.attempts ?? 0),
      adapterCalls,
      eventIds: events.map(event => event.id),
      counts: await stateCounts(db)
    };
    steps.push(step);
    return step;
  };

  // This adapter cannot invoke sendEmail or use provider credentials. Every
  // attempt comes from the unchanged application worker and its durable job.
  const adapter: Mailer = async (to, _subject, html, key, mode) => {
    adapterCalls++;
    deliveryKeys.push(key);
    deliveryRecipients.push(to);
    deliveryModes.push(mode);
    deliveryBodies.push(html);
    if (scenarioId === 'delivery_outage') throw new Error('Injected fictional delivery outage');
    return 'simulated';
  };

  const draft = await atlas.create(organizer, 'demo-household', 'Bring dinner tomorrow at 6pm');
  const saved = await atlas.update(organizer, draft.id, draft.digest, [{
    ...draft.tasks[0],
    dueAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
    recipientIds: ['demo-member-1'],
    location: '123 Fictional Lane'
  }]);
  const draftStep = await snapshot('draft', 'Prepare and save the exact review');
  assertObserved('draft_has_no_outreach', 'Drafting creates no requests, offers, jobs or events', draftStep.counts.requests + draftStep.counts.offers + draftStep.counts.jobs + draftStep.counts.events, 0);
  const rehearsal = await atlas.rehearse(organizer, saved.id, 'demo-member-1');
  const rehearsalStep = await snapshot('rehearsal', 'Rehearse the selected helper declining');
  assertObserved('rehearsal_writes_nothing', 'Rehearsal leaves the recorded row counts unchanged', sameCounts(draftStep.counts, rehearsalStep.counts), true);
  assertObserved('rehearsal_finds_gap', 'Removing the only selected helper reveals the coverage gap', rehearsal.scenarios[0].uncoveredIfDeclined, true);
  const beforeApprovalContacts = adapterCalls;
  assertObserved('no_preapproval_contact', 'No delivery adapter is called before approval', beforeApprovalContacts, 0);

  const approved = await atlas.approve(organizer, saved.id, saved.digest);
  const approvedRequestId = approved.requestIds[0] as unknown;
  if (typeof approvedRequestId !== 'string') throw new Error('The lab approval did not return a request ID.');
  requestId = approvedRequestId;
  const approvedStep = await snapshot('approved', 'Organizer approves the exact saved plan');
  assertObserved('one_approved_request', 'Approval creates exactly one request', approvedStep.counts.requests, 1);
  assertObserved('one_approved_offer', 'Approval creates exactly one offer', approvedStep.counts.offers, 1);
  assertObserved('three_durable_jobs', 'Approval creates delivery, risk and deadline jobs together', approvedStep.counts.jobs, 3);

  const duplicate = await atlas.approve(organizer, saved.id, saved.digest);
  const duplicateStep = await snapshot('duplicate_approval', 'Replay the same approval');
  assertObserved('duplicate_returns_original', 'Repeated approval returns the original request ID', duplicate.duplicate && JSON.stringify(duplicate.requestIds) === JSON.stringify(approved.requestIds), true);
  assertObserved('duplicate_adds_no_rows', 'Repeated approval adds no plans, requests, offers, jobs or events', sameCounts(approvedStep.counts, duplicateStep.counts), true);

  const plannedAttempts = scenarioId === 'control' ? 1 : 3;
  const deliveryJob = (await db.query("SELECT j.id FROM jobs j JOIN offers o ON j.payload->>'offerId'=o.id WHERE j.kind='send_offer' AND o.request_id=$1", [requestId])).rows[0];
  for (let attempt = 1; attempt <= plannedAttempts; attempt++) {
    if (attempt > 1) {
      // A lab clock shortcut, scoped to this fresh database and this delivery
      // job. The worker still performs its actual claim, attempt and retry logic.
      await db.query("UPDATE jobs SET run_at=now()-interval '1 second' WHERE id=$1 AND status='pending'", [deliveryJob.id]);
    }
    const processed = await runOneJob(db, adapter);
    const step = await snapshot(`attempt_${attempt}`, scenarioId === 'control' ? 'Worker makes the simulated offer available' : `Worker observes delivery failure ${attempt} of 3`);
    assertObserved(`attempt_${attempt}_processed`, `Delivery attempt ${attempt} is processed by the real worker`, processed, true);
    assertObserved(`attempt_${attempt}_count`, `Delivery attempt ${attempt} is stored durably`, step.attempts, attempt);
    if (scenarioId === 'delivery_outage' && attempt < 3) {
      assertObserved(`attempt_${attempt}_pending`, `Failed attempt ${attempt} remains queued for retry`, step.jobStatus, 'pending');
      assertObserved(`attempt_${attempt}_seeking`, `Failed attempt ${attempt} does not claim helper acceptance`, step.requestStatus, 'seeking');
    }
  }

  const delivered = steps.at(-1)!;
  assertObserved('bounded_adapter_calls', 'The adapter is called exactly once per planned attempt', adapterCalls, plannedAttempts);
  assertObserved('one_delivery_key', 'Retries preserve the delivery idempotency key', new Set(deliveryKeys).size, 1);
  assertObserved('fictional_recipient', 'Every attempted recipient is the fictional selected helper', deliveryRecipients.every(to => to === 'sam@example.test'), true);
  assertObserved('simulated_channel', 'Every adapter call uses the reviewed simulated channel', deliveryModes.every(mode => mode === 'simulated'), true);
  assertObserved('location_stays_private', 'Outreach never includes the private task location', deliveryBodies.every(html => !html.includes('123 Fictional Lane')), true);
  assertObserved('final_request', 'The final request status reflects observed coverage', delivered.requestStatus, scenarioId === 'control' ? 'seeking' : 'uncovered');
  assertObserved('final_offer', 'The final offer status reflects delivery evidence', delivered.offerStatus, scenarioId === 'control' ? 'simulated' : 'delivery_failed');
  assertObserved('final_job', 'The final job retains the worker outcome', delivered.jobStatus, scenarioId === 'control' ? 'done' : 'failed');

  let recovery: ReliabilityScenario['recovery'] = null;
  if (scenarioId === 'delivery_outage') {
    // Preserve a useful failed report if a regression leaves a wrong terminal
    // state. Recovery authorization itself is not bypassed to make a green demo.
    if (delivered.requestStatus === 'uncovered') {
      const before = await stateCounts(db);
      const recoveryDraft = await atlas.recover(organizer, approvedRequestId);
      const after = await snapshot('recovery', 'Prepare a new recovery draft without sending');
      recovery = {
        planId: recoveryDraft.id,
        sourceRequestId: recoveryDraft.recoverySourceId!,
        status: recoveryDraft.status,
        selectedHelpers: recoveryDraft.tasks.reduce((sum, task) => sum + task.recipientIds.length, 0),
        queuedJobsDelta: after.counts.jobs - before.jobs
      };
      assertObserved('recovery_only_adds_draft', 'Recovery adds one plan and no other records', after.counts.plans === before.plans + 1 && ['requests', 'offers', 'jobs', 'events'].every(key => after.counts[key as keyof ReliabilityCounts] === before[key as keyof ReliabilityCounts]), true);
      assertObserved('recovery_has_no_selection', 'Recovery requires a new helper selection', recovery.selectedHelpers, 0);
      assertObserved('recovery_has_no_jobs', 'Recovery queues no outreach jobs', recovery.queuedJobsDelta, 0);
      assertObserved('old_failure_preserved', 'The original request remains uncovered after recovery', after.requestStatus, 'uncovered');
    }
    assertObserved('recovery_requires_approval', 'Recovery exists only as an unapproved draft linked to the failed request', recovery?.status === 'draft' && recovery.sourceRequestId === requestId, true);
  }

  const timeline = await atlas.timeline(organizer, approvedRequestId);
  assertObserved('one_approval_event', 'The approval replay leaves exactly one approval event', timeline.events.filter(event => event.kind === 'plan_approved').length, 1);
  assertObserved('no_false_completion', 'No acceptance or completion event is invented', timeline.events.filter(event => ['helper_accepted', 'helper_reported_done', 'confirmed_done'].includes(event.kind)).length, 0);
  assertObserved('no_real_sent_event', 'Simulated delivery never claims real email was sent', timeline.events.filter(event => event.kind === 'offer_sent').length, 0);
  assertObserved('terminal_evidence', 'The worker outcome has exactly one source event', timeline.events.filter(event => event.kind === (scenarioId === 'control' ? 'email_simulated' : 'delivery_failed')).length, 1);
  const finalStep = steps.at(-1)!;
  return {
    preapprovalContacts: beforeApprovalContacts,
    scenario: {
      id: scenarioId,
      label: scenarioId === 'control' ? 'Healthy delivery' : 'Delivery outage',
      description: scenarioId === 'control' ? 'A simulated offer becomes available. The task is still seeking because no helper has accepted.' : 'Three injected adapter failures exhaust delivery. Coverage becomes uncovered, and recovery starts as a new unapproved draft.',
      elapsedMilliseconds: rounded(performance.now() - started),
      steps,
      events: timeline.events.map(event => ({ id: event.sourceEventId, kind: event.kind, at: event.at, actor: event.actor })),
      checks,
      final: { requestId: approvedRequestId, requestStatus: finalStep.requestStatus, offerStatus: finalStep.offerStatus, jobStatus: finalStep.jobStatus, attempts: finalStep.attempts },
      recovery
    }
  };
}
