import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, ShieldCheck } from 'lucide-react';
import './reliability-lab.css';

type Check = {
  id: string;
  label: string;
  passed: boolean;
  expected: string | number | boolean;
  actual: string | number | boolean;
};
type Step = {
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
  counts: { plans: number; requests: number; offers: number; jobs: number; events: number };
};
type Scenario = {
  id: 'control' | 'delivery_outage';
  label: string;
  description: string;
  elapsedMilliseconds: number;
  steps: Step[];
  events: { id: string; kind: string; at: string; actor: string }[];
  checks: Check[];
  final: { requestId: string; requestStatus: string; offerStatus: string; jobStatus: string; attempts: number };
  recovery: null | { planId: string; sourceRequestId: string; status: string; selectedHelpers: number; queuedJobsDelta: number };
};
type Report = {
  schemaVersion: 1;
  runId: string;
  measuredAt: string;
  elapsedMilliseconds: number;
  status: 'passed' | 'failed';
  scope: string;
  checks: Check[];
  totals: { scenarios: number; checks: number; passedChecks: number; adapterCalls: number; externalContacts: number; preapprovalContacts: number; sandboxDatabases: number; closedSandboxDatabases: number };
  scenarios: Scenario[];
};
type Props = { api: (path: string, init?: RequestInit) => Promise<any> };

const statusLabels: Record<string, string> = {
  not_created: 'Not created', seeking: 'Seeking help', accepted: 'Helper accepted',
  helper_reported_done: 'Helper reported done', confirmed_done: 'Organizer confirmed done',
  uncovered: 'Uncovered', simulated: 'Simulated offer', delivery_failed: 'Delivery failed',
  queued: 'Queued', pending: 'Pending', running: 'Running', done: 'Completed',
  failed: 'Failed', draft: 'Draft', approved: 'Approved', cancelled: 'Cancelled'
};
const eventLabels: Record<string, string> = {
  plan_approved: 'Organizer approved the exact plan', email_simulated: 'Fictional offer simulated',
  delivery_failed: 'Delivery failed after retries', uncovered: 'Task became uncovered',
  helper_accepted: 'Helper accepted responsibility', helper_reported_done: 'Helper reported completion',
  confirmed_done: 'Organizer confirmed completion'
};
function statusName(value: string) { return statusLabels[value] || value.replaceAll('_', ' '); }
function duration(milliseconds: number) { return `${(milliseconds / 1000).toFixed(2)} s`; }

function CheckReceipts({ checks, label }: { checks: Check[]; label: string }) {
  return <details className="lab-receipts">
    <summary>{label} ({checks.length})</summary>
    <ul className="lab-checks">{checks.map(check => <li key={check.id} className={check.passed ? 'lab-check-pass' : 'lab-check-fail'}>
      <span className="lab-check-result">{check.passed ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}{check.passed ? 'Passed' : 'Failed'}</span>
      <strong>{check.label}</strong>
      <span className="lab-check-values">Expected <code>{String(check.expected)}</code> · Observed <code>{String(check.actual)}</code></span>
    </li>)}</ul>
  </details>;
}

function ScenarioReport({ scenario }: { scenario: Scenario }) {
  const passed = scenario.checks.filter(check => check.passed).length;
  return <article className={`lab-scenario lab-scenario-${scenario.id}`} aria-label={scenario.label}>
    <div className="lab-scenario-heading"><span className="eyebrow">{scenario.id === 'control' ? 'CONTROL' : 'INJECTED FAILURE'}</span><h3>{scenario.label}</h3><p>{scenario.description}</p></div>
    <div className="lab-final-state"><span>Observed task state</span><strong>{statusName(scenario.final.requestStatus)}</strong><p>{scenario.final.requestStatus === 'seeking' ? 'The delivery job finished. A helper still has to accept.' : scenario.final.requestStatus === 'uncovered' ? 'Outreach failed. The organizer still needs a recovery plan.' : 'Read the execution receipts below to inspect this result.'}</p></div>
    <dl className="lab-facts"><div><dt>Offer</dt><dd>{statusName(scenario.final.offerStatus)}</dd></div><div><dt>Delivery job</dt><dd>{statusName(scenario.final.jobStatus)}</dd></div><div><dt>Delivery attempts</dt><dd>{scenario.final.attempts}</dd></div><div><dt>Checks passed</dt><dd>{passed} / {scenario.checks.length}</dd></div></dl>
    {scenario.recovery && <div className="lab-recovery"><strong>Observed recovery: {statusName(scenario.recovery.status)}</strong><p>{scenario.recovery.selectedHelpers} helpers selected · {scenario.recovery.queuedJobsDelta} additional queued jobs</p><p>A separate review and organizer approval are required before new outreach.</p></div>}
    <details className="lab-receipts"><summary>Execution trace ({scenario.steps.length} steps)</summary><ol className="lab-trace">{scenario.steps.map((step, index) => <li key={step.id}>
      <div className="lab-trace-title"><span aria-hidden="true">{index + 1}</span><strong>{step.label}</strong></div>
      <time dateTime={step.at}>{new Date(step.at).toLocaleTimeString()} · +{duration(step.elapsedMilliseconds)}</time>
      <dl className="lab-step-facts"><div><dt>Task</dt><dd>{statusName(step.requestStatus)}</dd></div><div><dt>Offer</dt><dd>{statusName(step.offerStatus)}</dd></div><div><dt>Job</dt><dd>{statusName(step.jobStatus)}</dd></div><div><dt>Attempts</dt><dd>{step.attempts}</dd></div></dl>
      <p className="lab-counts">Database rows: {step.counts.plans} plans, {step.counts.requests} requests, {step.counts.offers} offers, {step.counts.jobs} jobs, {step.counts.events} events. Adapter calls: {step.adapterCalls}.</p>
      {step.eventIds.length > 0 && <p className="lab-event-ids">Source events: {step.eventIds.map(id => <code key={id}>{id}</code>)}</p>}
    </li>)}</ol></details>
    <CheckReceipts checks={scenario.checks} label="Scenario checks" />
    <details className="lab-receipts"><summary>Event provenance ({scenario.events.length})</summary><ol className="lab-events">{scenario.events.map(event => <li key={event.id}><strong>{eventLabels[event.kind] || event.kind.replaceAll('_', ' ')}</strong><span>{event.actor} · <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time></span><code>{event.id}</code></li>)}</ol></details>
  </article>;
}

export function ReliabilityLab({ api }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);

  async function runDrill() {
    const current = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true); setError(''); setReport(null);
    try {
      const result = await api('/api/demo/reliability-lab', { method: 'POST', body: JSON.stringify({}), signal: controller.current.signal }) as Report;
      if (current === generation.current) setReport(result);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return <section className="reliability-lab" aria-label="Reliability lab">
    <div className="lab-intro"><span className="eyebrow">RELIABILITY LAB · FICTIONAL DATA</span><h2>When delivery breaks, does the truth hold?</h2><p>Run the same approved request twice. Compare healthy simulated delivery with an injected outage, then inspect what the database actually recorded.</p></div>
    <div className="lab-scope"><ShieldCheck size={19} aria-hidden="true" /><p>Each scenario runs in a new isolated local database using fictional people. Retries are accelerated. Your circle is unchanged and no real contact is made. This does not exercise AWS, real email or an AI model.</p></div>
    <div className="lab-run"><button className="primary" disabled={busy} onClick={() => void runDrill()}><FlaskConical size={17} aria-hidden="true" />{busy ? 'Running delivery outage drill…' : 'Run delivery outage drill'}</button><span>Uses the application service and delivery worker.</span></div>
    <div className="lab-announcement" role="status" aria-live="polite" aria-atomic="true">{busy ? 'Running both scenarios and collecting execution receipts.' : report ? `Drill ${report.status}. ${report.totals.passedChecks} of ${report.totals.checks} checks passed. ${report.totals.externalContacts} external contacts.` : ''}</div>
    {error && <div className="lab-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>The drill could not finish: {error}</span></div>}
    {report && <div className="lab-report">
      <div className={`lab-result lab-result-${report.status}`}>{report.status === 'passed' ? <CheckCircle2 size={23} aria-hidden="true" /> : <AlertTriangle size={23} aria-hidden="true" />}<div><strong>{report.totals.passedChecks} / {report.totals.checks} checks passed</strong><p>{report.status === 'passed' ? 'The measured checks passed for this local run.' : 'A check failed. Inspect the observed values before relying on this run.'}</p></div></div>
      <dl className="lab-run-facts"><div><dt>External contacts</dt><dd>{report.totals.externalContacts}</dd></div><div><dt>Contacts before approval</dt><dd>{report.totals.preapprovalContacts}</dd></div><div><dt>Sandboxes closed</dt><dd>{report.totals.closedSandboxDatabases} / {report.totals.sandboxDatabases}</dd></div></dl>
      <div className="lab-comparison">{report.scenarios.map(scenario => <ScenarioReport key={scenario.id} scenario={scenario} />)}</div>
      <CheckReceipts checks={report.checks} label="Run checks" />
      <details className="lab-receipts lab-run-receipt"><summary>Run receipt and measurement scope</summary><dl><div><dt>Run</dt><dd><code>{report.runId}</code></dd></div><div><dt>Measured</dt><dd><time dateTime={report.measuredAt}>{new Date(report.measuredAt).toLocaleString()}</time></dd></div><div><dt>Total local run duration</dt><dd>{duration(report.elapsedMilliseconds)}</dd></div><div><dt>Simulated adapter calls</dt><dd>{report.totals.adapterCalls}</dd></div></dl><p>{report.scope}</p><p>Durations include local database setup and test work. They are execution receipts, not an application latency or cloud availability benchmark.</p></details>
    </div>}
  </section>;
}
