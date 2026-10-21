import type { Request } from './coordination.js';

export type NextStep = {
  requestId: string;
  title: string;
  kind: 'review-record' | 'recovery' | 'dispute' | 'confirmation' | 'progress' | 'coverage';
  label: string;
  reason: string;
};

const soon = 2 * 60 * 60 * 1000;
const rank: Record<NextStep['kind'], number> = {
  'review-record': 0, recovery: 1, dispute: 2, confirmation: 3, progress: 4, coverage: 5,
};

// Suggestions from an already-authorized board snapshot, never permissions or writes.
// The caller supplies the snapshot time so results are reproducible, not predictions.
export function buildNextSteps(requests: readonly Request[], asOf: number): NextStep[] {
  if (!Number.isFinite(asOf)) throw new RangeError('A valid snapshot time is required.');
  const steps: (NextStep & { due: number })[] = [];
  for (const request of requests) {
    const due = Date.parse(request.due_at);
    const add = (kind: NextStep['kind'], label: string, reason: string) => {
      steps.push({ requestId: request.id, title: request.title, kind, label, reason, due });
    };
    switch (request.status) {
      case 'confirmed_done':
      case 'cancelled':
        break;
      case 'uncovered':
        add('recovery', 'Review a new plan', 'This snapshot shows the task as uncovered. New outreach needs a separately reviewed and approved recovery plan.');
        break;
      case 'disputed':
        add('dispute', 'Review the disagreement', 'Completion was disputed. Review the timeline before deciding what happens next.');
        break;
      case 'helper_reported_done':
        add('confirmation', 'Review completion', 'The helper reported done. Only you can confirm or dispute completion.');
        break;
      case 'accepted':
      case 'seeking':
        if (!Number.isFinite(due)) {
          add('review-record', 'Check the deadline', 'The deadline cannot be read. Review the request; no timing or coverage conclusion was inferred.');
        } else if (request.status === 'accepted' && due <= asOf) {
          add('progress', 'Check progress', 'The deadline has passed and completion is not reported. Acceptance remains recorded; this does not mean the helper failed.');
        } else if (request.status === 'seeking' && due <= asOf + soon) {
          add('coverage', 'Review the coverage gap', due <= asOf
            ? 'The deadline has passed with no recorded acceptance. Offers do not establish coverage; review the latest record.'
            : 'Due within two hours with no recorded acceptance. Review open offers; nothing is sent from this inbox.');
        }
        break;
      default:
        add('review-record', 'Inspect an unfamiliar state', 'This request has an unrecognized status. Review its record rather than assuming coverage or completion.');
    }
  }
  return steps.sort((a, b) => rank[a.kind] - rank[b.kind]
    || (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity)
    || a.requestId.localeCompare(b.requestId))
    .map(({ due: _due, ...step }) => step);
}
