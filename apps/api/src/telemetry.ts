/** Identifier-only operational receipts. Never pass source text or provider errors. */
export type Observation = {
  kind: 'http' | 'mcp_tool' | 'job';
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  tool?: string;
  planId?: string;
  careRequestIds?: string[];
  jobId?: string;
  offerId?: string;
  careRequestId?: string;
  jobKind?: string;
  attempt?: number;
  phase?: string;
  delivery?: string;
};
export type Observer = (event: Readonly<Observation>) => void;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const operationalId = (value: unknown): string | undefined => typeof value === 'string' && uuid.test(value) ? value : undefined;

// Explicit projection is intentional: accepting arbitrary properties here could
// put household text, credentials or provider diagnostics into operational logs.
export function observation(input: Observation): Observation {
  const result: Observation = { kind: input.kind };
  for (const key of ['requestId', 'planId', 'jobId', 'offerId', 'careRequestId'] as const) {
    const id = operationalId(input[key]); if (id) result[key] = id;
  }
  if (input.careRequestIds) result.careRequestIds = input.careRequestIds.map(operationalId).filter((id): id is string => !!id).slice(0, 5);
  if (input.route && /^\/(?:api|mcp)(?:\/[a-z:-]+)*$/.test(input.route)) result.route = input.route;
  if (input.method && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(input.method)) result.method = input.method;
  if (input.statusCode && Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599) result.statusCode = input.statusCode;
  if (input.durationMs !== undefined && Number.isFinite(input.durationMs) && input.durationMs >= 0) result.durationMs = Math.round(input.durationMs * 1000) / 1000;
  if (input.attempt !== undefined && Number.isInteger(input.attempt) && input.attempt > 0) result.attempt = input.attempt;
  if (input.tool && ['create_atlas_plan', 'rehearse_decline', 'get_request_status', 'get_today_coverage', 'get_household_summary'].includes(input.tool)) result.tool = input.tool;
  if (input.jobKind && ['invite', 'send_offer', 'at_risk', 'due'].includes(input.jobKind)) result.jobKind = input.jobKind;
  if (input.phase && ['claimed', 'delivery_attempt', 'adapter_result', 'done', 'retry_scheduled', 'failed', 'lease_superseded'].includes(input.phase)) result.phase = input.phase;
  if (input.delivery && ['sent', 'simulated', 'in_app'].includes(input.delivery)) result.delivery = input.delivery;
  return result;
}

export function observe(sink: Observer | undefined, input: Observation): void {
  if (!sink) return;
  try {
    const result = sink(Object.freeze(observation(input))) as unknown;
    // Instrumentation must not change authorization, job state or delivery retries.
    if (result && typeof (result as Promise<unknown>).catch === 'function') void (result as Promise<unknown>).catch(() => {});
  } catch { /* The underlying product operation remains authoritative. */ }
}

export function planReceipt(value: unknown): Pick<Observation, 'planId' | 'careRequestIds'> {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  return { ...(operationalId(row.id) ? { planId: operationalId(row.id) } : {}),
    ...(Array.isArray(row.requestIds) ? { careRequestIds: row.requestIds.map(operationalId).filter((id): id is string => !!id).slice(0, 5) } : {}) };
}
