import { GitCompareArrows } from 'lucide-react';
import { compareReviewTasks, type ReviewChange, type ReviewField, type ReviewTask } from './review-changes.js';
import './review-changes.css';

const labels: Record<ReviewField, string> = {
  type: 'Task type', title: 'Title', brief: 'Briefing', dueAt: 'Deadline',
  recipientIds: 'Helpers and outreach order', location: 'Private location', instructions: 'Private instructions',
};
const types: Record<string, string> = { meal: 'Meal', visit: 'Visit / check-in', ride: 'Ride' };

export function ReviewChanges({ saved, proposed, digest, people }: {
  saved: readonly ReviewTask[];
  proposed: readonly ReviewTask[];
  digest: string;
  people: readonly { id: string; display_name: string }[];
}) {
  const comparison = compareReviewTasks(saved, proposed);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function valueText(field: ReviewField, value: ReviewChange['before']): string {
    if (Array.isArray(value)) return value.length ? value.map((id, index) =>
      `${index + 1}. ${people.find(person => person.id === id)?.display_name || 'Unavailable helper'} · wave ${index < 2 ? 1 : 2}`
    ).join('\n') : 'No helpers selected';
    if (field === 'dueAt') {
      if (!value) return 'Missing exact time';
      if (!Number.isFinite(Date.parse(value))) return `Unreadable deadline: ${value}`;
      const readable = new Date(value).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset',
      });
      return `${readable}\n${value}`;
    }
    if (field === 'type' && value) return types[value] || value;
    return value || 'Not provided';
  }
  function values(change: ReviewChange) {
    return <dl className="review-change-values">
      <div><dt>Saved review</dt><dd>{valueText(change.field, change.before)}</dd></div>
      <div><dt>Your unsaved edit</dt><dd>{valueText(change.field, change.after)}</dd></div>
    </dl>;
  }
  return <section className="review-changes" aria-labelledby="review-changes-heading">
    <header><span className="eyebrow"><GitCompareArrows size={16} aria-hidden="true"/> BEFORE YOU SAVE</span>
      <h3 id="review-changes-heading">Review your changes</h3>
      <p>Compared with saved review <code>{digest.slice(0, 12)}</code>. These edits are local, not approved or sent.</p>
    </header>
    {comparison.structureChanged ? <p className="review-change-notice" role="status">The number of tasks changed. Save and review every task again; this comparison will not guess which tasks correspond.</p>
      : comparison.changes.length ? <>
        <p className="review-change-count" role="status" aria-live="polite" aria-atomic="true">{comparison.changes.length} changed {comparison.changes.length === 1 ? 'field' : 'fields'} across {comparison.changedTasks} {comparison.changedTasks === 1 ? 'task' : 'tasks'}.</p>
        <ol>{comparison.changes.map(change => <li key={`${change.taskIndex}:${change.field}`}>
          <h4>Task {change.taskIndex + 1} · {labels[change.field]}</h4>
          {change.field === 'location' || change.field === 'instructions'
            ? <details><summary>Show private before and after values</summary>{values(change)}</details>
            : values(change)}
          {change.field === 'recipientIds' && <p className="review-change-note">Order determines outreach waves. Eligibility is checked again when you approve. Unavailable names are not proof of eligibility.</p>}
        </li>)}</ol>
      </> : <p className="review-change-notice" role="status">No editable task values differ from the saved review. A refresh may still be required; save to recheck the exact outreach.</p>}
    <footer>Deadline comparison timezone: {timezone}. Saving regenerates the exact outreach preview. Review it before separately approving. This comparison makes no requests and is not a permanent change history.</footer>
  </section>;
}
