import { useState } from 'react';
import { ArrowUpRight, GitBranch, LockKeyhole, ScanLine, ShieldCheck } from 'lucide-react';
import { buildCoverageMap, explainStatus, offerLabels, statusLabels, statusTone, type Board, type Request } from './coordination.js';

type Props = { requests: Request[]; events: Board['events']; fetchedAt: string | null; onInspect: (id: string) => void };

export function CoverageMap({ requests, events, fetchedAt, onInspect }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const model = buildCoverageMap(requests, events);
  const selected = model.requests.find(request => request.id === selectedId) || model.requests[0];
  const receipts = selected ? model.receipts.filter(event => event.request_id === selected.id) : [];
  const height = Math.max(180, Math.max(model.requests.length, model.helpers.length) * 86 + 8);

  return <section className="coverage-map" aria-label="Factual coverage map">
    <header className="map-header"><div><span className="eyebrow"><ScanLine size={13}/> RELATIONSHIPS, NOT PREDICTIONS</span><h2>See who’s connected. Know what’s committed.</h2></div><span className="map-snapshot">Fetched {fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'time unavailable'}<small>Read-only snapshot · refreshes about every 15s</small></span></header>
    <div className="map-legend"><span><i className="legend-line commitment"/> Accepted responsibility</span><span><i className="legend-line outreach"/> Outreach, not acceptance</span><span><i className="legend-line closed"/> Closed or historical offer</span></div>
    {selected ? <>
      <div className="map-column-labels"><span>Tasks · gaps first, then deadlines</span><span>Helpers named in offer records</span></div>
      <p className="mobile-map-note">Select a task to inspect its helper connections below.</p>
      <div className="map-graph" style={{ minHeight: height }}>
        <svg className="map-edges" viewBox={`0 0 800 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {model.edges.map(edge => {
            const start = model.requests.findIndex(request => request.id === edge.requestId) * 86 + 40;
            const end = model.helpers.findIndex(helper => helper.id === edge.helperId) * 86 + 40;
            return <path key={edge.id} d={`M 340 ${start} C 400 ${start}, 400 ${end}, 460 ${end}`} className={`map-edge ${edge.kind} ${edge.requestId === selected.id ? 'selected' : ''}`}/>;
          })}
        </svg>
        <div className="map-task-nodes" role="group" aria-label="Select a mapped task">{model.requests.map(request => <button className={`map-task-node ${statusTone(request.status)}`} key={request.id} aria-pressed={selected.id === request.id} onClick={() => setSelectedId(request.id)}><span className="node-indicator"/><span><strong>{request.title}</strong><small>{statusLabels[request.status] || request.status}</small></span><ArrowUpRight size={14}/></button>)}</div>
        <div className="map-helper-nodes">{model.helpers.map(helper => {
          const related = model.edges.filter(edge => edge.requestId === selected.id && edge.helperId === helper.id);
          const connectionKind = related.some(edge => edge.kind === 'commitment') ? 'commitment' : related.some(edge => edge.kind === 'outreach') ? 'outreach' : 'closed';
          return <div className={`map-helper-node ${related.length ? `connected ${connectionKind}` : ''}`} key={helper.id}><span className="map-person-avatar">{helper.name.charAt(0)}</span><span><strong>{helper.name}</strong><small>{related.length ? related.map(edge => offerLabels[edge.status] || edge.status).join(' · ') : 'No offer for the selected task'}</small></span></div>;
        })}{!model.helpers.length && <p className="map-no-helpers">No helper offer records in this view. The map will not invent a connection.</p>}</div>
      </div>
      {(model.omittedRequests > 0 || model.omittedHelpers > 0) && <p className="map-limit" role="status">Bounded view: {model.omittedRequests} additional tasks and {model.omittedHelpers} additional helpers are not drawn. Filter to narrow the view, or use List for full request records.</p>}
      <section className="decision-receipt" aria-label="Selected task receipt">
        <div className="receipt-heading"><div><span className="eyebrow"><GitBranch size={13}/> DECISION RECEIPT</span><h3>{selected.title}</h3></div><span className={`status-chip ${statusTone(selected.status)}`}><span className="chip-dot"/>{statusLabels[selected.status] || selected.status}</span></div>
        <p className="receipt-explanation">{explainStatus(selected)}</p>
        <dl className="receipt-facts"><div><dt>Due</dt><dd><time dateTime={selected.due_at}>{new Date(selected.due_at).toLocaleString()}</time><small>Browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small></dd></div><div><dt>Outreach records</dt><dd>{selected.offers.length}<small>Records do not prove a person read a message.</small></dd></div><div><dt>Recorded events</dt><dd>{receipts.length}<small>For this task in the fetched board snapshot.</small></dd></div></dl>
        <ul className="receipt-offers" aria-label="Selected task helper connections">{selected.offers.map(offer => <li key={offer.id}><span>{offer.display_name || 'Invited helper'}</span><strong>{offerLabels[offer.status] || offer.status}</strong><small>Wave {offer.wave}</small></li>)}{!selected.offers.length && <li>No offer records.</li>}</ul>
        {receipts[0] && <details className="map-source-receipt"><summary>Latest recorded event</summary><p>{receipts[0].kind.replaceAll('_', ' ')} · {receipts[0].actor_name || 'Relief system'}</p><time dateTime={receipts[0].created_at}>{new Date(receipts[0].created_at).toLocaleString()}</time><code>{receipts[0].id}</code></details>}
        <div className="receipt-footer"><span><LockKeyhole size={14}/> Private location is not displayed in this map.</span><button className="secondary" onClick={() => onInspect(selected.id)}>Open full timeline <ArrowUpRight size={15}/></button></div>
      </section>
    </> : <div className="map-empty"><ShieldCheck size={27}/><h3>No tasks in this view.</h3><p>Clear your filters or create a reviewed plan. Drafts do not appear as commitments.</p></div>}
    <p className="map-boundary">This map reads the current board. It does not rehearse, approve, contact helpers or change task state. Accepted responsibility does not mean confirmed completion.</p>
  </section>;
}
