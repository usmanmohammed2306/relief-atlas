import { ArrowRight, Check, CircleAlert, HandHeart } from 'lucide-react';
import type { Request } from './coordination.js';

/** Decorative, local SVG artwork. Status always comes from the request record. */
export function HelpVisual({ type, className = '' }: { type: string; className?: string }) {
  return <svg className={`help-visual ${className}`} viewBox="0 0 120 100" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="60" cy="84" rx="38" ry="7" fill="currentColor" opacity=".08"/>
    {type === 'meal' ? <>
      <ellipse cx="61" cy="64" rx="35" ry="15" fill="var(--art-light, #faf6ec)" stroke="currentColor" strokeWidth="2"/>
      <ellipse cx="61" cy="60" rx="27" ry="11" fill="var(--art-fill, #e2cda5)"/>
      <path d="M35 58c0-18 11-29 26-29s26 11 26 29" fill="var(--art-fill, #e2cda5)" stroke="currentColor" strokeWidth="2"/>
      <path d="M61 29v-6m-5 0h10M24 37v31m-6-31v10c0 6 12 6 12 0V37m67 0v31m0-31c10 9 9 17 0 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M48 19c-5-6 5-7 0-13m25 13c-5-6 5-7 0-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35"/>
    </> : type === 'ride' ? <>
      <path d="M24 57l8-22a8 8 0 018-5h38a8 8 0 017 5l11 22" fill="var(--art-fill, #c7d5e3)" stroke="currentColor" strokeWidth="2"/>
      <path d="M35 51l5-14h36l7 14H35z" fill="var(--art-light, #f3f7fa)"/>
      <rect x="20" y="51" width="80" height="25" rx="9" fill="var(--art-fill, #c7d5e3)" stroke="currentColor" strokeWidth="2"/>
      <rect x="28" y="69" width="12" height="14" rx="4" fill="currentColor"/>
      <rect x="80" y="69" width="12" height="14" rx="4" fill="currentColor"/>
      <path d="M29 60h12m38 0h12m-38 6h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </> : <>
      <path d="M23 48l37-29 37 29" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M31 43v36h58V43L60 21 31 43z" fill="var(--art-fill, #cbdcc8)" stroke="currentColor" strokeWidth="2"/>
      <path d="M51 79V52h19v27" fill="var(--art-light, #f3f6ed)" stroke="currentColor" strokeWidth="2"/>
      <path d="M75 35c-5-8-17-4-15 4 1 5 15 14 15 14s14-9 15-14c2-8-10-12-15-4z" fill="var(--art-light, #f3f6ed)" stroke="currentColor" strokeWidth="2"/>
      <circle cx="65" cy="65" r="1.5" fill="currentColor"/>
    </>}
  </svg>;
}

export function TaskProgress({ status }: { status: string }) {
  if (['uncovered', 'disputed', 'cancelled'].includes(status)) return null;
  const current = ({ seeking: 0, accepted: 1, helper_reported_done: 2, confirmed_done: 3 } as Record<string, number>)[status];
  if (current === undefined) return null;
  return <ol className="task-progress" aria-label="Task progress">{['Approved', 'Accepted', 'Reported', 'Confirmed'].map((step, index) =>
    <li key={step} className={index < current ? 'complete' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined} aria-label={`${step}: ${index < current || status === 'confirmed_done' ? 'complete' : index === current ? 'current stage' : 'not yet'}`}>
      <span>{index < current || status === 'confirmed_done' ? <Check size={10}/> : <i/>}</span><small>{step}</small>
    </li>)}</ol>;
}

export function CareOverview({ recipient, requests, helper, attention, confirmation, onNext }: {
  recipient: string; requests: Request[]; helper: boolean; attention: number; confirmation: number; onNext: () => void;
}) {
  return <section className="care-overview" aria-label="Circle briefing">
    <div className="care-overview-copy"><span className="eyebrow">EVERYDAY HELP, TOGETHER</span>
      <h1>{recipient}’s circle</h1>
      <p>{helper ? 'Choose what works for you.' : attention ? `${attention} ${attention === 1 ? 'task needs' : 'tasks need'} a new plan.` : confirmation ? `${confirmation} ${confirmation === 1 ? 'task is' : 'tasks are'} ready for your confirmation.` : 'A clear plan for the people you care about.'}</p>
      <button className="primary" onClick={onNext}>{helper ? <HandHeart size={18}/> : attention ? <CircleAlert size={18}/> : <ArrowRight size={18}/>} {helper ? 'See my offers' : attention ? 'Review the gaps' : confirmation ? 'Review completion' : 'Ask for help'}</button>
    </div>
    <div className="care-overview-art" aria-label="Request types in this circle">{(['meal', 'visit', 'ride'] as const).map(type => {
      const count = requests.filter(request => request.type === type).length;
      return <div className={`care-type-card ${type}`} key={type}><HelpVisual type={type}/><div><strong>{count}</strong><span>{type === 'meal' ? count===1?'Meal':'Meals' : type === 'visit' ? count===1?'Visit':'Visits' : count===1?'Ride':'Rides'}</span></div></div>;
    })}</div>
  </section>;
}
