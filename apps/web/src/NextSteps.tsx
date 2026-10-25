import { useState } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, ListChecks } from 'lucide-react';
import type { Board } from './coordination.js';
import { buildNextSteps } from './next-steps.js';
import './next-steps.css';

export function NextSteps({ board, fetchedAt, onInspect }: {
  board: Board;
  fetchedAt: string;
  onInspect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const steps = buildNextSteps(board.requests, Date.parse(fetchedAt));
  const visible = showAll ? steps : steps.slice(0, 3);
  return <section className="next-steps" aria-labelledby="next-steps-heading">
    <header>
      <div><span className="eyebrow"><ListChecks size={16} aria-hidden="true"/> NEXT UP</span>
        <h2 id="next-steps-heading">What needs you next</h2></div>
      <span className="next-steps-count">{steps.length} to review</span>
    </header>

    {visible.length ? <ol>{visible.map(step => <li key={step.requestId}>
      <span className={`next-step-icon ${step.kind}`} aria-hidden="true">{step.kind==='confirmation'?<CircleCheck size={22}/>:<CircleAlert size={22}/>}</span><div><span className={`next-step-label ${step.kind}`}>{step.label}</span>
        <h3>{step.title}</h3><details className="next-step-reason"><summary>Why this needs review</summary><p>{step.reason}</p></details></div>
      <button className="secondary" aria-label={`Inspect request: ${step.title}`} onClick={() => onInspect(step.requestId)}>
        Review <ArrowRight size={15} aria-hidden="true"/>
      </button>
    </li>)}</ol> : <p className="next-steps-empty">Nothing needs your review right now.</p>}
    {steps.length > 3 && <button className="text-button next-steps-expand" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
      {showAll ? 'Show first three' : `Show all ${steps.length} next steps`}
    </button>}
    <footer><details><summary>Updated {new Date(fetchedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · About these suggestions</summary><p>Read-only · snapshot <time dateTime={fetchedAt}>{new Date(fetchedAt).toLocaleString(undefined, { timeZone: board.timezone })}</time> ({board.timezone}). Inspecting sends nothing and changes no task status.</p></details></footer>
  </section>;
}
