import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {SupabaseClient} from '@supabase/supabase-js';
import { ArrowRight, HeartHandshake, Home, List, Moon, Network, Plus, ShieldCheck, Sun, Users, X, MoreHorizontal } from 'lucide-react';
import './style.css';
import { AtlasPlanner } from './AtlasPlanner.js';
import { ReliabilityLab } from './ReliabilityLab.js';
import './design.css';
import { CoverageMap } from './CoverageMap.js';
import { CommandMenu, type Tab } from './CommandMenu.js';
import { type Board, type Request } from './coordination.js';
import './workspace.css';
import { FocusHome, FocusTask, TaskRows } from './FocusWorkspace.js';
import { AtlasScene } from './AtlasScene.js';
import './cinematic.css';

import { HelperTimeOff } from './HelperTimeOff.js';
import { beginCognitoSignIn, completeCognitoSignIn, cognitoAccessToken, endCognitoSession, type CognitoSettings } from './cognito-session.js';
import { readTheme, persistTheme, type Theme } from './appearance.js';
import{ProductWelcome,type ProductProfile}from'./ProductWelcome.js';
import{TrustCenter}from'./TrustCenter.js';
import{CircleControlsPanel}from'./CircleControls.js';
import './readability.css';
import './simple.css';
import './focus.css';

type Circle={id:string;name:string;care_recipient_name:string;role:'organizer'|'helper';status:string};
type Me={actor:{id:string;email:string;displayName:string};circles:Circle[];pending:Circle[]};
type Operations={jobs:Record<string,number>;uncovered:number;deliveryFailed:number;oldestReadySeconds:number;abandonedLeases:number;note:string};
type SavedDraft={id:string;titles:string[];createdAt:string;expiresAt:string;recoverySourceId:string|null};

const demoPeople=[['demo-organizer','Alex · organizer'],['demo-helper-1','Sam · helper'],['demo-helper-2','Jordan · helper'],['demo-helper-3','Riley · helper']];
const typeLabel:Record<string,string>={meal:'Meal drop-off',visit:'Visit / check-in',ride:'Ride'};
function errText(error:unknown){return error instanceof Error?error.message:String(error);}

function App(){
  const [supabase,setSupabase]=useState<SupabaseClient|null>(null);
  const [cognito,setCognito]=useState<CognitoSettings|null>(null);
  const [demo,setDemo]=useState(false);
  const [configReady,setConfigReady]=useState(false);
  const [profile,setProfile]=useState<ProductProfile>({name:'Relief Atlas',stage:'Private pilot preview',supportEmail:'',version:'0.2.0-preview'});
  const [showWelcome,setShowWelcome]=useState(()=>new URLSearchParams(window.location.search).get('welcome')==='1');
  const [showTrust,setShowTrust]=useState(false);
  const [showScene,setShowScene]=useState(false);
  const [navigationSignal,setNavigationSignal]=useState(0);
  const [hasUnsaved,setHasUnsaved]=useState(false);
  const [lastRequestId,setLastRequestId]=useState<string|null>(null);
  const [deliveryMode,setDeliveryMode]=useState<'email'|'simulated'|'in_app'>('in_app');
  const [actorId,setActorId]=useState(localStorage.getItem('relief-demo-user')||'demo-organizer');
  const [tab,setTab]=useState<Tab>('today');
  const [me,setMe]=useState<Me|null>(null);
  const [householdId,setHouseholdId]=useState(localStorage.getItem('relief-household')||'');
  const [board,setBoard]=useState<Board|null>(null);
  const [ops,setOps]=useState<Operations|null>(null);
  const [drafts,setDrafts]=useState<SavedDraft[]>([]);
  const [people,setPeople]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [email,setEmail]=useState('');
  const [authVersion,setAuthVersion]=useState(0);
  const loadGeneration=useRef(0);
  const preferencesLoaded=useRef('');
  const [inviteEmail,setInviteEmail]=useState('');
  const [newCircleName,setNewCircleName]=useState('');
  const [recipientName,setRecipientName]=useState('');
  const [consent,setConsent]=useState(false);
  const [selectedTypes,setSelectedTypes]=useState<string[]>(['meal','visit','ride']);
  const [quietStart,setQuietStart]=useState(22);
  const [quietEnd,setQuietEnd]=useState(7);
  const [optedIn,setOptedIn]=useState(false);
  const [unavailableDates,setUnavailableDates]=useState<string[]>([]);
  const [preferenceTimezone,setPreferenceTimezone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [selectedRequestId,setSelectedRequestId]=useState<string|null>(null);
  const [requestFilter,setRequestFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [boardView,setBoardView]=useState<'list'|'map'>('list');
  const [boardFetchedAt,setBoardFetchedAt]=useState<string|null>(null);
  const [theme,setTheme]=useState<Theme>(()=>readTheme());
  useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='night'?'#0b1512':'#f1f0e8');persistTheme(theme);},[theme]);
  const toggleTheme=()=>setTheme(value=>value==='night'?'daylight':'night');
  function canLeave(){return !hasUnsaved||window.confirm('Leave without saving your changes? Your last saved draft will remain.');}
  function navigate(next:Tab){if(next!==tab&&!canLeave())return;if(next!=='ask')history.replaceState({},'',location.pathname);setTab(next);}
  function openMap(){if(!canLeave())return;history.replaceState({},'',location.pathname);setTab('tools');setBoardView('map');setQuery('');setRequestFilter('all');}
  function inspectRequest(id:string){setSelectedRequestId(id);setTab('task');}
  function resumeDraft(id:string){history.replaceState({},'',`?plan=${encodeURIComponent(id)}`);setTab('ask');}


  const active=me?.circles.find(circle=>circle.id===householdId)||me?.circles[0];
  const role=active?.role;
  const matchesFilter=(item:Request)=>requestFilter==='all'||(requestFilter==='attention'?['uncovered','disputed'].includes(item.status):item.status===requestFilter);
  const visibleRequests=(board?.requests||[]).filter(item=>matchesFilter(item)&&`${item.title} ${item.brief} ${typeLabel[item.type]||item.type}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at)||a.id.localeCompare(b.id));
  const filtering=requestFilter!=='all'||query.trim().length>0;
  const previousTab=useRef(tab);
  useEffect(()=>{if(previousTab.current!==tab){document.getElementById('main-content')?.focus();window.scrollTo({top:0,behavior:'instant'});previousTab.current=tab;}},[tab]);

  async function api<T>(path:string,init:RequestInit={}):Promise<T>{
    const token=cognito?cognitoAccessToken(cognito):(await supabase?.auth.getSession())?.data.session?.access_token;
    const response=await fetch(path,{...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),...(demo?{'x-demo-user':actorId}:token?{Authorization:`Bearer ${token}`}:{}) ,...init.headers}});
    const requestId=response.headers.get('x-request-id');if(requestId&&/^[a-f0-9-]{36}$/.test(requestId))setLastRequestId(requestId);
    const body=await response.json().catch(()=>({error:'Unexpected response'}));
    if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
    return body as T;
  }
  async function reload(){
    const generation=++loadGeneration.current;
    try{
      if(!demo){
        const token=cognito?cognitoAccessToken(cognito):(await supabase?.auth.getSession())?.data.session?.access_token;
        if(!token){if(generation===loadGeneration.current){setMe(null);setBoard(null);setPeople([]);setOps(null);setDrafts([]);}return;}
      }
      const identity=await api<Me>('/api/me');
      const chosen=identity.circles.find(circle=>circle.id===householdId)||identity.circles[0];
      if(chosen){
        const [nextBoard,nextPeople]=await Promise.all([api<Board>(`/api/households/${chosen.id}/board`),api<any[]>(`/api/households/${chosen.id}/circle`)]);
        const [nextOps,nextDrafts]=chosen.role==='organizer'?await Promise.all([
          api<Operations>(`/api/atlas/households/${chosen.id}/operations`),
          api<SavedDraft[]>(`/api/atlas/households/${chosen.id}/drafts`)
        ]):[null,[]];
        if (generation!==loadGeneration.current) return;
        setHouseholdId(chosen.id);localStorage.setItem('relief-household',chosen.id);
        setBoard(nextBoard);setBoardFetchedAt(new Date().toISOString());setPeople(nextPeople);setOps(nextOps);setDrafts(nextDrafts);
        const preferenceKey=`${identity.actor.id}:${chosen.id}`;
        if(preferencesLoaded.current!==preferenceKey){
          const mine=nextPeople.find(person=>person.user_id===identity.actor.id);
          setSelectedTypes(mine?.task_types||[]);setQuietStart(mine?.quiet_start??22);setQuietEnd(mine?.quiet_end??7);
          setOptedIn(mine?.opted_in===true);setPreferenceTimezone(mine?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone);
          setUnavailableDates(mine?.unavailable_dates||[]);
          preferencesLoaded.current=preferenceKey;
        }
      }else{if(generation!==loadGeneration.current)return;setBoard(null);setPeople([]);setOps(null);setDrafts([]);}
      setMe(identity);
      setError('');
    }catch(e){if(generation!==loadGeneration.current)return;setMe(null);setBoard(null);setPeople([]);setOps(null);setDrafts([]);setError(errText(e));}
  }
  useEffect(()=>{void Promise.allSettled([fetch('/api/health').then(r=>r.json()).then(v=>setDemo(!!v.demo)),fetch('/api/public-config').then(r=>r.json()).then(async v=>{if(v.product)setProfile(v.product);setDeliveryMode(v.deliveryMode||'in_app');if(v.authProvider==='cognito'&&v.cognito){const settings:CognitoSettings=v.cognito;try{await completeCognitoSignIn(settings);}catch(error){setError(errText(error));}setCognito(settings);}else if(v.supabaseUrl&&v.supabaseAnonKey){const{createClient}=await import('@supabase/supabase-js');setSupabase(createClient(v.supabaseUrl,v.supabaseAnonKey));}})]).then(()=>setConfigReady(true));},[]);
  useEffect(()=>{if(demo||supabase||cognito)void reload();},[demo,actorId,householdId,supabase,cognito,authVersion,tab]);
  useEffect(()=>{if(!supabase)return;const {data}=supabase.auth.onAuthStateChange(()=>{loadGeneration.current++;setMe(null);setBoard(null);setPeople([]);setOps(null);setAuthVersion(version=>version+1);});return()=>data.subscription.unsubscribe();},[supabase]);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[active?.id,actorId,demo]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).has('plan')&&me)setTab('ask');},[me?.actor.id]);
  async function act(fn:()=>Promise<unknown>,success:string){setLoading(true);setError('');setNotice('');try{await fn();setNotice(success);await reload();}catch(e){setError(errText(e));}finally{setLoading(false);}}
  async function magicLink(){if(!supabase){setError('Supabase is not configured.');return;}const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});if(error)setError(error.message);else setNotice('Check your email for a sign-in link.');}
  async function signOut(){loadGeneration.current++;setMe(null);setBoard(null);setPeople([]);setOps(null);setDrafts([]);setSelectedRequestId(null);history.replaceState({},'',location.pathname);try{if(cognito)await endCognitoSession(cognito);else{await supabase?.auth.signOut();await reload();}}catch(error){setError(errText(error));}}
  async function switchDemo(id:string){if(!canLeave())return;loadGeneration.current++;setMe(null);setBoard(null);setBoardFetchedAt(null);setBoardView('list');setPeople([]);setOps(null);setDrafts([]);setRequestFilter('all');setQuery('');setSelectedRequestId(null);history.replaceState({},'',window.location.pathname);setActorId(id);localStorage.setItem('relief-demo-user',id);setTab('today');setNotice('');setError('');}
  async function recover(requestId:string){await act(async()=>{const plan=await api<{id:string}>(`/api/atlas/requests/${requestId}/recover`,{method:'POST'});history.replaceState({},'',`?plan=${encodeURIComponent(plan.id)}`);setTab('ask');},'Recovery draft created. Choose a deadline and helpers, then review and approve. Nothing was sent.');}
  async function createCircle(){await act(async()=>{const result=await api<{id:string}>('/api/households',{method:'POST',body:JSON.stringify({name:newCircleName,careRecipientName:recipientName,consentAttested:consent,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});setHouseholdId(result.id);},'Care circle created. Invite someone you trust.');}
  async function invite(){if(!active)return;await act(()=>api(`/api/households/${active.id}/invitations`,{method:'POST',body:JSON.stringify({email:inviteEmail})}),deliveryMode==='email'?'Invitation created and email queued. Delivery is not yet confirmed.':'Invitation created in-app. No email was sent. Share the Relief sign-in link yourself.');setInviteEmail('');}
  async function savePreferences(){if(!active)return;await act(()=>api(`/api/households/${active.id}/preferences`,{method:'PATCH',body:JSON.stringify({taskTypes:selectedTypes,quietStart,quietEnd,timezone:preferenceTimezone,optedIn,unavailableDates})}),'Preferences saved.');}

  const trust=<TrustCenter open={showTrust} onClose={()=>setShowTrust(false)} profile={profile} context={{demo,deliveryMode,lastRequestId}}/>;
  if(configReady&&(showWelcome||!demo&&!me))return <><ProductWelcome profile={profile} demo={demo} signedIn={!!me} onTrust={()=>setShowTrust(true)} email={email} onEmail={setEmail} onMagicLink={supabase&&!me?()=>void magicLink():undefined} error={error} onEnter={demo||me||cognito?()=>{if(demo||me){setShowWelcome(false);const params=new URLSearchParams(location.search);params.delete('welcome');history.replaceState({},'',location.pathname+(params.size?'?'+params:''));}else if(cognito)void beginCognitoSignIn(cognito).catch(e=>setError(errText(e)));}:undefined}/>{trust}</>;
  return <div className="focus-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="focus-app-header"><button className="focus-brand" aria-label="Relief home" onClick={()=>navigate('today')}><HeartHandshake size={24}/>relief<span>.</span></button>
      {active&&<nav className="focus-navigation" aria-label="Main navigation">{([['today',Home,'Home'],[role==='organizer'?'plan':'offers',List,role==='organizer'?'Plan':'Offers'],['circle',Users,'People']] as const).map(([key,Icon,name])=><button key={key} className={tab===key||tab==='task'&&(key==='plan'||key==='offers')?'active':''} aria-current={tab===key||tab==='task'&&(key==='plan'||key==='offers')?'page':undefined} onClick={()=>navigate(key)}><Icon size={17}/><span>{name}</span></button>)}</nav>}
      <div className="focus-account">{demo&&<select aria-label="Demo account" value={actorId} onChange={event=>void switchDemo(event.target.value)}>{demoPeople.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>}
        <details className="focus-options" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label="More options"><MoreHorizontal size={22}/></summary><div className="focus-options-panel" onClick={event=>{if((event.target as Element).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}>
          <button onClick={()=>navigate('tools')}>Tools & diagnostics</button>
          <button aria-label={theme==='night'?'Switch to daylight':'Switch to night shift'} onClick={toggleTheme}>{theme==='night'?<Sun size={16}/>:<Moon size={16}/>} {theme==='night'?'Light appearance':'Dark appearance'}</button>
          <button onClick={()=>{if(canLeave())setShowWelcome(true);}}>About Relief Atlas</button><button onClick={()=>setShowTrust(true)}>Privacy & support</button>
          {active&&<button onClick={()=>setNavigationSignal(value=>value+1)}>Keyboard navigation</button>}
          {!demo&&<button onClick={()=>void signOut()}>Sign out</button>}
        </div></details>
      </div>
    </header>
    <main className="focus-main" id="main-content" tabIndex={-1}>
      {error&&<div className="focus-notice error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      {notice&&<div className="focus-notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></div>}
      {!configReady||demo&&!me&&!error?<section className="page loading-circle" role="status"><ShieldCheck size={24}/><h1>Opening your circle.</h1><p>Checking your identity and the latest factual status.</p></section>:!demo&&!me?<section className="auth-card"><span className="eyebrow">WELCOME TO RELIEF</span><h1>Start with someone you trust.</h1><p>Sign in to create a care circle or accept an invitation.</p>{cognito?<button className="primary" onClick={()=>void beginCognitoSignIn(cognito).catch(error=>setError(errText(error)))}>Sign in securely <ArrowRight size={16}/></button>:<div className="row"><input type="email" aria-label="Sign-in email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button className="primary" onClick={()=>void magicLink()}>Send sign-in link</button></div>}</section>:
      me&&!active?<section className="auth-card"><span className="eyebrow">YOUR CARE CIRCLE</span><h1>Good care starts together.</h1><p>Create a private circle for nonmedical tasks, or accept an invitation below.</p>{me.pending.map(p=><div className="pending-invite" key={p.id}><span>Invitation to <strong>{p.name}</strong></span><button className="primary" onClick={()=>void act(()=>api(`/api/households/${p.id}/join`,{method:'POST'}),'Invitation accepted. Choose your helper preferences.')}>Accept invitation</button></div>)}<div className="form-grid"><label>Circle name<input value={newCircleName} onChange={e=>setNewCircleName(e.target.value)} placeholder="Dad’s circle"/></label><label>Care recipient’s first name<input value={recipientName} onChange={e=>setRecipientName(e.target.value)} placeholder="Dad"/></label></div><label className="checkline"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I have the care recipient’s permission to share these minimal details with invited helpers.</label><button className="primary" disabled={!newCircleName||!recipientName||!consent||loading} onClick={()=>void createCircle()}>Create circle <ArrowRight size={16}/></button></section>:
      active&&<>
        {tab==='today'&&<FocusHome name={active.name} board={board} fetchedAt={boardFetchedAt} helper={role==='helper'} drafts={drafts} onAsk={()=>{history.replaceState({},'',location.pathname);setTab('ask');}} onPlan={()=>setTab('plan')} onOffers={()=>setTab('offers')} onOpen={inspectRequest} onResume={resumeDraft}/>}
        {tab==='plan'&&role==='organizer'&&<section className="focus-page" aria-label="Plan"><header className="focus-page-heading"><h1>Your plan</h1><button className="primary" onClick={()=>{history.replaceState({},'',location.pathname);setTab('ask');}}><Plus size={17}/>Ask for help</button></header>
          <div className="focus-plan-controls"><input type="search" aria-label="Search requests" placeholder="Find a request" value={query} onChange={event=>setQuery(event.target.value)}/><select aria-label="Filter requests" value={requestFilter} onChange={event=>setRequestFilter(event.target.value)}><option value="all">All requests</option><option value="attention">Needs attention</option><option value="seeking">Seeking help</option><option value="accepted">Accepted</option><option value="helper_reported_done">Needs confirmation</option><option value="confirmed_done">Confirmed done</option></select></div>
          <TaskRows requests={visibleRequests} onOpen={inspectRequest}/>{!visibleRequests.length&&<p className="focus-empty">{filtering?'No requests match.':'No requests yet.'}</p>}
          {drafts.length>0&&<details className="focus-disclosure" aria-label="Saved drafts"><summary>Saved drafts · {drafts.length}</summary>{drafts.map(draft=><button className="focus-saved-row" key={draft.id} onClick={()=>resumeDraft(draft.id)}><span>{draft.titles.join(' · ')}<small>Not approved · Not sent</small></span><ArrowRight size={16}/></button>)}</details>}
        </section>}
        {tab==='ask'&&role==='organizer'&&<section className="focus-page focus-ask-page"><AtlasPlanner key={`${active.id}:${me!.actor.id}`} householdId={active.id} people={people} demo={demo} deliveryMode={deliveryMode} initialPlanId={new URLSearchParams(window.location.search).get('plan')} api={api} onDirtyChange={setHasUnsaved} onApproved={async()=>{await reload();setTab('plan');history.replaceState({},'',window.location.pathname);}}/></section>}
        {tab==='task'&&(board?.requests.find(request=>request.id===selectedRequestId)?<FocusTask request={board.requests.find(request=>request.id===selectedRequestId)!} organizer={role==='organizer'} actorId={me!.actor.id} events={board.events.filter(event=>event.request_id===selectedRequestId)} busy={loading} onBack={()=>setTab(role==='organizer'?'plan':'offers')} onAction={(path,body,message)=>void act(()=>api(path,{method:'POST',body:JSON.stringify(body)}),message)} onRecover={()=>selectedRequestId&&void recover(selectedRequestId)}/>:<section className="focus-page"><h1>Request unavailable</h1><button className="secondary" onClick={()=>setTab('today')}>Back home</button></section>)}
        {tab==='offers'&&<section className="focus-page" aria-label="Offers"><header className="focus-page-heading"><h1>Your offers</h1></header><TaskRows requests={(board?.requests||[]).filter(request=>request.offers.some(offer=>offer.user_id===me!.actor.id))} onOpen={inspectRequest}/>{!(board?.requests||[]).some(request=>request.offers.some(offer=>offer.user_id===me!.actor.id))&&<p className="focus-empty">No offers yet.</p>}</section>}
        {tab==='circle'&&<section className="focus-page focus-people">
          <header className="focus-page-heading"><h1>Your people</h1></header>
          {role==='organizer'&&<details className="focus-disclosure"><summary>Invite a helper</summary><div className="panel"><h2>Invite a trusted helper</h2><p>They’ll choose which tasks they’re willing to cover and when they can be contacted. {deliveryMode!=='email'?'No email is sent. Share the sign-in link with them yourself.':'Email is queued only after you create the invitation.'}</p><div className="row"><input type="email" aria-label="Helper email" placeholder="helper@example.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/><button className="primary" disabled={loading||!inviteEmail} onClick={()=>void invite()}>{deliveryMode==='email'?'Queue invite email':'Create in-app invitation'} <ArrowRight size={16}/></button></div></div></details>}
          {role==='helper'&&<details className="focus-disclosure" open={!optedIn||undefined}><summary>Your availability</summary><div className="panel"><h2>Your preferences</h2><p>Relief only contacts you for selected tasks within your chosen hours. Equal start and end hours mean no quiet period.</p>
            <div className="type-checks">{Object.entries(typeLabel).map(([value,name])=><label key={value} className="checkline"><input type="checkbox" checked={selectedTypes.includes(value)} onChange={()=>setSelectedTypes(selectedTypes.includes(value)?selectedTypes.filter(x=>x!==value):[...selectedTypes,value])}/>{name}</label>)}</div>
            <div className="form-grid"><label>Quiet hours start<select value={quietStart} onChange={e=>setQuietStart(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{h}:00</option>)}</select></label><label>Quiet hours end<select value={quietEnd} onChange={e=>setQuietEnd(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{h}:00</option>)}</select></label><label>Contact timezone<input value={preferenceTimezone} onChange={e=>setPreferenceTimezone(e.target.value)} placeholder="America/Phoenix"/></label></div>
            <HelperTimeOff dates={unavailableDates} timezone={preferenceTimezone} disabled={loading} onChange={setUnavailableDates}/>
            <label className="checkline"><input type="checkbox" checked={optedIn} onChange={e=>setOptedIn(e.target.checked)}/>I’m ready to receive requests.</label><button className="primary" disabled={loading} onClick={()=>void savePreferences()}>Save preferences</button>
          </div></details>}
          <div className="panel"><h2>People in this circle</h2><div className="people-list">{people.map(person=><div className="person-row" key={person.id}><span className="mini-avatar">{person.display_name?.charAt(0)||person.email?.charAt(0)||'?'}</span><span><strong>{person.display_name||person.email}</strong><small>{person.role==='organizer'?'Organizer':person.status==='removed'?'Access revoked':person.status==='pending'?'Invitation pending':person.opted_in?'Helper · opted in':'Helper · not opted in'}</small></span>{role==='organizer'&&person.role==='helper'&&person.status!=='removed'?<button className="text-button danger" onClick={()=>{if(confirm(`Remove ${person.email} from this circle?`))void act(()=>api(`/api/households/${active.id}/members/${person.id}`,{method:'DELETE'}),'Helper removed.');}}>Remove</button>:null}</div>)}</div></div>
          {role==='organizer'&&<details className="focus-disclosure"><summary>Circle settings</summary><CircleControlsPanel key={active.id} householdId={active.id} name={active.name} api={api} onClosed={async()=>{await reload();setTab('today');setNotice('Circle closed. All access was revoked and unfinished work cancelled. Historical data was retained, not deleted.');}}/></details>}
        </section>}
        {tab==='tools'&&<section className="focus-page focus-tools" aria-label="Tools and diagnostics"><header className="focus-page-heading"><h1>Tools & diagnostics</h1></header>
          {role==='organizer'&&<><button className="secondary" aria-label="Coverage map" onClick={()=>setBoardView(value=>value==='map'?'list':'map')}>Coverage map<Network size={16}/></button>{boardView==='map'&&<CoverageMap requests={board?.requests||[]} events={board?.events||[]} fetchedAt={boardFetchedAt} onInspect={inspectRequest}/>}</>}
          {role==='organizer'&&ops&&<details className="ops-panel"><summary>Operator view · database job health</summary><div><span>Pending jobs <strong>{ops.jobs.pending||0}</strong></span><span>Running <strong>{ops.jobs.running||0}</strong></span><span>Failed jobs <strong>{ops.jobs.failed||0}</strong></span><span>Oldest ready job <strong>{ops.oldestReadySeconds}s</strong></span><span>Abandoned leases <strong>{ops.abandonedLeases}</strong></span><span>Failed deliveries <strong>{ops.deliveryFailed}</strong></span><span>Uncovered tasks <strong>{ops.uncovered}</strong></span></div><small>{ops.note} Failed jobs require investigation. No metric here proves an email reached a person.</small></details>}
          {demo&&deliveryMode==='simulated'&&role==='organizer'&&<details className="demo-lab-panel"><summary>Reliability lab · try a fictional delivery outage</summary><ReliabilityLab key={`${active.id}:${me!.actor.id}`} api={api}/></details>}
          <details className="optional-scene" open={showScene} onToggle={event=>setShowScene(event.currentTarget.open)}><summary>Explore care illustrations</summary>{showScene&&<AtlasScene/>}</details>

        </section>}
      </>}
    </main>
    <footer className="focus-app-footer"><span>{demo?'Demo · No real messages':'Private by invitation'} · Nonmedical help</span><button onClick={()=>setShowTrust(true)}>Privacy & support</button></footer>
    {active&&<CommandMenu hideTrigger openSignal={navigationSignal} key={`${active.id}:${me?.actor.id}`} organizer={role==='organizer'} onNavigate={navigate} onMap={openMap} onTheme={toggleTheme} theme={theme}/>}
    {trust}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
