// Read-only presentation model. No fetch, storage, dispatch or authorization.
export type Offer = { id: string; status: string; wave: number; user_id: string; display_name: string };
export type Request = {
  id: string; title: string; brief: string; type: string; status: string;
  derivedUncovered?: boolean; due_at: string; created_at: string;
  accepted_name?: string; accepted_by?: string; location: string;
  instructions: string; atRisk: boolean; offers: Offer[];
};
export type Event = { id: string; request_id: string; kind: string; created_at: string; actor_name?: string; detail?: Record<string, unknown> };
export type Board = { timezone: string; requests: Request[]; notifications: { id: string; message: string; kind: string; created_at: string }[]; events: Event[] };
export type MapHelper = { id: string; name: string };
export type MapEdge = { id: string; requestId: string; helperId: string; status: string; kind: 'commitment' | 'outreach' | 'closed' };

export const statusLabels: Record<string, string> = {
  seeking: 'Seeking help', accepted: 'Accepted', helper_reported_done: 'Needs confirmation',
  confirmed_done: 'Confirmed done', uncovered: 'Uncovered', cancelled: 'Cancelled', disputed: 'Disputed'
};
export const offerLabels: Record<string, string> = {
  queued: 'Queued for outreach', simulated: 'Simulated offer', in_app_available: 'Available in-app',
  sent: 'Email sent', accepted: 'Helper accepted', declined: 'Helper declined',
  delivery_failed: 'Delivery failed', expired: 'Expired', cancelled: 'Cancelled'
};
export const statusTone = (status: string) => ['uncovered', 'disputed'].includes(status) ? 'red' : ['accepted', 'confirmed_done'].includes(status) ? 'green' : 'amber';

export function explainStatus(request: Request): string {
  switch (request.status) {
    case 'seeking': return 'No helper has accepted this task. An offer is not a commitment.';
    case 'accepted': return `${request.accepted_name || 'A helper'} accepted responsibility. Completion has not been reported.`;
    case 'helper_reported_done': return 'The helper reported completion. The organizer still needs to confirm or dispute it.';
    case 'confirmed_done': return 'The organizer confirmed completion. This is distinct from the helper’s report.';
    case 'uncovered': return 'This task is uncovered. Any new outreach requires a separately reviewed and approved recovery plan.';
    case 'disputed': return 'The organizer disputed completion. Do not count this task as confirmed done.';
    case 'cancelled': return 'This task was cancelled. The map does not create replacement outreach.';
    default: return 'Unrecognized state. Inspect the authoritative record before relying on it.';
  }
}

const priority: Record<string, number> = { uncovered: 0, disputed: 0, helper_reported_done: 1, seeking: 2, accepted: 3, confirmed_done: 4, cancelled: 5 };

export function buildCoverageMap(input: Request[], events: Event[]) {
  // Bounded rendering, with explicit truncation. Never imply the graph is complete.
  const ordered = [...input].sort((a, b) => (priority[a.status] ?? 6) - (priority[b.status] ?? 6) || a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id));
  const requests = ordered.slice(0, 6);
  const helpersById = new Map<string, MapHelper>();
  for (const request of requests) for (const offer of request.offers) {
    if (!helpersById.has(offer.user_id)) helpersById.set(offer.user_id, { id: offer.user_id, name: offer.display_name || 'Invited helper' });
  }
  const helpers = [...helpersById.values()].slice(0, 8);
  const shownHelperIds = new Set(helpers.map(helper => helper.id));
  const edges: MapEdge[] = [];
  for (const request of requests) for (const offer of request.offers) {
    if (!shownHelperIds.has(offer.user_id)) continue;
    const accepted = ['accepted', 'helper_reported_done', 'confirmed_done', 'disputed'].includes(request.status)
      && request.accepted_by === offer.user_id && offer.status === 'accepted';
    const openOffer = request.status === 'seeking' && ['queued', 'sent', 'simulated', 'in_app_available'].includes(offer.status);
    edges.push({ id: offer.id, requestId: request.id, helperId: offer.user_id, status: offer.status, kind: accepted ? 'commitment' : openOffer ? 'outreach' : 'closed' });
  }
  const requestIds = new Set(requests.map(request => request.id));
  const receipts = events.filter(event => requestIds.has(event.request_id)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { requests, helpers, edges, receipts, omittedRequests: Math.max(0, input.length - requests.length), omittedHelpers: Math.max(0, helpersById.size - helpers.length) };
}
