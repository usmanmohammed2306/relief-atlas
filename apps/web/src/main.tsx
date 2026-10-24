import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Activity, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, HeartHandshake, Home, List, Moon, Network, Plus, Search, ShieldCheck, Sun, Users, X } from 'lucide-react';
import './style.css';
import { AtlasPlanner } from './AtlasPlanner.js';
import { ReliabilityLab } from './ReliabilityLab.js';
import './design.css';
import { CoverageMap } from './CoverageMap.js';
import { CommandMenu, type Tab } from './CommandMenu.js';
import { statusLabels as label, offerLabels as offerLabel, type Board, type Request } from './coordination.js';
import './workspace.css';
import { AtlasScene } from './AtlasScene.js';
import './cinematic.css';
import { NextSteps } from './NextSteps.js';
import { HelperTimeOff } from './HelperTimeOff.js';

type Circle={id:string;name:string;care_recipient_name:string;role:'organizer'|'helper';status:string};
type Me={actor:{id:string;email:string;displayName:string};circles:Circle[];pending:Circle[]};
type Operations={jobs:Record<string,number>;uncovered:number;deliveryFailed:number;oldestReadySeconds:number;abandonedLeases:number;note:string};
type SavedDraft={id:string;titles:string[];createdAt:string;expiresAt:string;recoverySourceId:string|null};

const demoPeople=[['demo-organizer','Alex · organizer'],['demo-helper-1','Sam · helper'],['demo-helper-2','Jordan · helper'],['demo-helper-3','Riley · helper']];
const typeLabel:Record<string,string>={meal:'Meal drop-off',visit:'Visit / check-in',ride:'Ride'};
function dateText(value:string){return new Date(value).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function dateKey(value:Date,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
function errText(error:unknown){return error instanceof Error?error.message:String(error);}

function App(){
  const [supabase,setSupabase]=useState<SupabaseClient|null>(null);
  const [demo,setDemo]=useState(false);
  const [configReady,setConfigReady]=useState(false);
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
  const [expanded,setExpanded]=useState<string|null>(null);
  const [requestFilter,setRequestFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [boardView,setBoardView]=useState<'list'|'map'>('list');
  const [boardFetchedAt,setBoardFetchedAt]=useState<string|null>(null);
  const [inspectTarget,setInspectTarget]=useState<string|null>(null);
  const [theme,setTheme]=useState<'night'|'daylight'>(()=>localStorage.getItem('relief-theme')==='daylight'?'daylight':'night');
  useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('relief-theme',theme);},[theme]);
  const toggleTheme=()=>setTheme(value=>value==='night'?'daylight':'night');
  useEffect(()=>{if(!inspectTarget)return;const node=document.getElementById(`request-${inspectTarget}`);if(node){node.focus();node.scrollIntoView({block:'center',behavior:'instant'});setInspectTarget(null);}},[inspectTarget,boardView]);
  function openMap(){setTab('today');setBoardView('map');setQuery('');setRequestFilter('all');}
  function inspectRequest(id:string){setBoardView('list');setExpanded(id);setQuery('');setRequestFilter('all');setInspectTarget(id);}

  const active=me?.circles.find(circle=>circle.id===householdId)||me?.circles[0];
  const role=active?.role;
  const dueToday=useMemo(()=>board?.requests.filter(item=>dateKey(new Date(item.due_at),board.timezone)===dateKey(new Date(),board.timezone))||[],[board]);
  const openCount=board?.requests.filter(item=>['seeking','uncovered','disputed'].includes(item.status)).length||0;
  const matchesFilter=(item:Request)=>requestFilter==='all'||(requestFilter==='attention'?['uncovered','disputed'].includes(item.status):item.status===requestFilter);
  const visibleRequests=(board?.requests||[]).filter(item=>matchesFilter(item)&&`${item.title} ${item.brief} ${typeLabel[item.type]||item.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleToday=visibleRequests.filter(item=>dueToday.includes(item));
  const pendingConfirmation=board?.requests.filter(item=>item.status==='helper_reported_done').length||0;
  const attentionCount=board?.requests.filter(item=>['uncovered','disputed'].includes(item.status)).length||0;
  const filtering=requestFilter!=='all'||query.trim().length>0;
  const briefingTitle=role==='helper'?'Help, on\nyour terms.':attentionCount?'Let’s find\nanother way.':pendingConfirmation?'Ready for\nyour check.':board?.requests.length?'Your people.\nA clearer picture.':'Everyday help.\nMade clear.';
  const briefingText=role==='helper'?'Choose the offers you can genuinely commit to. Private details appear only after you accept.':attentionCount?`${attentionCount} ${attentionCount===1?'task needs':'tasks need'} a new plan. Review the gaps, choose who to ask, then approve new outreach.`:pendingConfirmation?`${pendingConfirmation} ${pendingConfirmation===1?'task is':'tasks are'} reported done. Only the organizer can confirm completion.`:'Meals, visits and rides, with people you trust. Review each plan before anyone is asked.';
  function focusRequests(filter:string){setRequestFilter(filter);setQuery('');document.getElementById('coverage-heading')?.scrollIntoView({block:'start'});document.getElementById('coverage-heading')?.focus();}
  function nextStep(){if(role==='helper')setTab('offers');else if(attentionCount||pendingConfirmation)focusRequests(attentionCount?'attention':'helper_reported_done');else setTab('ask');}
  const previousTab=useRef(tab);
  useEffect(()=>{if(previousTab.current!==tab){document.getElementById('main-content')?.focus();window.scrollTo({top:0,behavior:'instant'});previousTab.current=tab;}},[tab]);

  async function api<T>(path:string,init:RequestInit={}):Promise<T>{
    const token=(await supabase?.auth.getSession())?.data.session?.access_token;
    const response=await fetch(path,{...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),...(demo?{'x-demo-user':actorId}:token?{Authorization:`Bearer ${token}`}:{}) ,...init.headers}});
    const body=await response.json().catch(()=>({error:'Unexpected response'}));
    if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
    return body as T;
  }
  async function reload(){
    const generation=++loadGeneration.current;
    try{
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
  useEffect(()=>{void Promise.allSettled([fetch('/api/health').then(r=>r.json()).then(v=>setDemo(!!v.demo)),fetch('/api/public-config').then(r=>r.json()).then(v=>{setDeliveryMode(v.deliveryMode||'in_app');if(v.supabaseUrl&&v.supabaseAnonKey)setSupabase(createClient(v.supabaseUrl,v.supabaseAnonKey));})]).then(()=>setConfigReady(true));},[]);
  useEffect(()=>{if(demo||supabase)void reload();},[demo,actorId,householdId,supabase,authVersion,tab]);
  useEffect(()=>{if(!supabase)return;const {data}=supabase.auth.onAuthStateChange(()=>{loadGeneration.current++;setMe(null);setBoard(null);setPeople([]);setOps(null);setAuthVersion(version=>version+1);});return()=>data.subscription.unsubscribe();},[supabase]);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[active?.id,actorId,demo]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).has('plan')&&me)setTab('ask');},[me?.actor.id]);
  async function act(fn:()=>Promise<unknown>,success:string){setLoading(true);setError('');setNotice('');try{await fn();setNotice(success);await reload();}catch(e){setError(errText(e));}finally{setLoading(false);}}
  async function magicLink(){if(!supabase){setError('Supabase is not configured.');return;}const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});if(error)setError(error.message);else setNotice('Check your email for a sign-in link.');}
  async function switchDemo(id:string){loadGeneration.current++;setMe(null);setBoard(null);setBoardFetchedAt(null);setBoardView('list');setInspectTarget(null);setPeople([]);setOps(null);setDrafts([]);setRequestFilter('all');setQuery('');setExpanded(null);history.replaceState({},'',window.location.pathname);setActorId(id);localStorage.setItem('relief-demo-user',id);setTab('today');setNotice('');setError('');}
  async function recover(requestId:string){await act(async()=>{const plan=await api<{id:string}>(`/api/atlas/requests/${requestId}/recover`,{method:'POST'});history.replaceState({},'',`?plan=${encodeURIComponent(plan.id)}`);setTab('ask');},'Recovery draft created. Choose a deadline and helpers, then review and approve. Nothing was sent.');}
  async function createCircle(){await act(async()=>{const result=await api<{id:string}>('/api/households',{method:'POST',body:JSON.stringify({name:newCircleName,careRecipientName:recipientName,consentAttested:consent,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});setHouseholdId(result.id);},'Care circle created. Invite someone you trust.');}
  async function invite(){if(!active)return;await act(()=>api(`/api/households/${active.id}/invitations`,{method:'POST',body:JSON.stringify({email:inviteEmail})}),deliveryMode==='email'?'Invitation created and email queued. Delivery is not yet confirmed.':'Invitation created in-app. No email was sent. Share the Relief sign-in link yourself.');setInviteEmail('');}
  async function savePreferences(){if(!active)return;await act(()=>api(`/api/households/${active.id}/preferences`,{method:'PATCH',body:JSON.stringify({taskTypes:selectedTypes,quietStart,quietEnd,timezone:preferenceTimezone,optedIn,unavailableDates})}),'Preferences saved.');}

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><HeartHandshake size={24}/></span><span>relief<span className="brand-dot">.</span><small>ATLAS</small></span></div>
      <div className="brand-subtitle">Help that follows through.</div>
      <div className="workspace-label">CARE CIRCLE</div>
      <div className="workspace"><span className="avatar">{active?.care_recipient_name?.charAt(0)||'R'}</span><span><strong>{active?.name||'Your circle'}</strong><small>{role==='organizer'?'Organizer workspace':role==='helper'?'Invited helper':'Private by invitation'}</small></span><ShieldCheck size={15}/></div>
      {(me?.circles.length||0)>1&&<label className="circle-switch">Switch circle<select aria-label="Care circle" value={active?.id} onChange={event=>{loadGeneration.current++;setBoard(null);setPeople([]);setOps(null);setDrafts([]);setQuery('');setRequestFilter('all');setExpanded(null);setHouseholdId(event.target.value);history.replaceState({},'',window.location.pathname);setTab('today');}}>{me!.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></label>}
      <nav aria-label="Main navigation">
        {([['today',Home,'Today'],['ask',Plus,'Ask for help'],['offers',HeartHandshake,'My offers'],['circle',Users,'Circle']] as const).filter(([key])=>key!=='ask'||role==='organizer').map(([key,Icon,name])=><button key={key} aria-current={tab===key?'page':undefined} className={`nav-item ${tab===key?'active':''}`} onClick={()=>setTab(key)}><Icon size={19}/><span>{name}</span>{key==='today'&&openCount>0?<span className="nav-count">{openCount}</span>:null}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="safety-note"><ShieldCheck size={18}/><span>Nonmedical help only. For emergencies, contact local emergency services.</span></div><div className="sidebar-foot">Built for the people who show up.</div></div>
    </aside>

    <main className="main" id="main-content" tabIndex={-1}>
      <header className="topbar"><div className="topbar-context"><span className="context-dot"/> A little help. A clearer picture.</div><div className="mobile-brand">relief<span>.</span><small>{demo?'DEMO':'PRIVATE'}</small></div><div className="top-right">{active&&<CommandMenu key={`${active.id}:${me?.actor.id}`} organizer={role==='organizer'} onNavigate={setTab} onMap={openMap} onTheme={toggleTheme} theme={theme}/>}<button className="theme-toggle" aria-label={theme==='night'?'Switch to daylight':'Switch to night shift'} onClick={toggleTheme}>{theme==='night'?<Sun size={18}/>:<Moon size={18}/>}</button><span className="demo-pill">{demo?'FICTIONAL DEMO':'PRIVATE CIRCLE'}</span>{demo?<select aria-label="Demo account" value={actorId} onChange={e=>void switchDemo(e.target.value)}>{demoPeople.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>:<button className="text-button" onClick={()=>supabase?.auth.signOut().then(()=>reload())}>Sign out</button>}<span className="user-avatar">{me?.actor.displayName?.charAt(0)||'?'}</span></div></header>
      {error&&<div className="alert error" role="alert"><CircleHelp size={18}/>{error}{!me&&(demo||supabase)&&<button className="text-button" onClick={()=>void reload()}>Reload circle</button>}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></div>}

      {!configReady||demo&&!me&&!error?<section className="page loading-circle" role="status"><ShieldCheck size={24}/><h1>Opening your circle.</h1><p>Checking your identity and the latest factual status.</p></section>:!demo&&!me?<section className="auth-card"><span className="eyebrow">WELCOME TO RELIEF</span><h1>Start with someone you trust.</h1><p>Sign in with your email to create a care circle or accept an invitation.</p><div className="row"><input type="email" aria-label="Sign-in email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button className="primary" onClick={()=>void magicLink()}>Send sign-in link</button></div></section>:
      me&&!active?<section className="auth-card"><span className="eyebrow">YOUR CARE CIRCLE</span><h1>Good care starts together.</h1><p>Create a private circle for nonmedical tasks, or accept an invitation below.</p>{me.pending.map(p=><div className="pending-invite" key={p.id}><span>Invitation to <strong>{p.name}</strong></span><button className="primary" onClick={()=>void act(()=>api(`/api/households/${p.id}/join`,{method:'POST'}),'Invitation accepted. Choose your helper preferences.')}>Accept invitation</button></div>)}<div className="form-grid"><label>Circle name<input value={newCircleName} onChange={e=>setNewCircleName(e.target.value)} placeholder="Dad’s circle"/></label><label>Care recipient’s first name<input value={recipientName} onChange={e=>setRecipientName(e.target.value)} placeholder="Dad"/></label></div><label className="checkline"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I have the care recipient’s permission to share these minimal details with invited helpers.</label><button className="primary" disabled={!newCircleName||!recipientName||!consent||loading} onClick={()=>void createCircle()}>Create circle <ArrowRight size={16}/></button></section>:
      active&&<>
        {tab==='today'&&<section className="page"><div className="dashboard-head"><span className="eyebrow">YOUR CARE CIRCLE</span><span>{greeting()}, {me?.actor.displayName.split(' ')[0]}.</span></div>
          <section className="orbit-hero" aria-label="Circle briefing">
            <div className="daily-brief"><div className="hero-kicker"><span/> {active.care_recipient_name}’s circle <span className="hero-kicker-divider">/</span> Private by invitation</div><h1>{briefingTitle}</h1><p>{briefingText}</p><button className="primary hero-action" onClick={nextStep}>{role==='helper'?'See my offers':attentionCount?'Review the gaps':pendingConfirmation?'Review completion':'Ask for help'} <ArrowRight size={18}/></button><span className="hero-assurance"><ShieldCheck size={14}/> {role==='helper'?'Accept only what you can do.':'You approve. Then we reach out.'}</span><div className="hero-sequence" aria-label="Coordination steps"><span>01 <b>{role==='helper'?'Review offer':'Describe'}</b></span><i/><span>02 <b>{role==='helper'?'Accept':'Review'}</b></span><i/><span>03 <b>{role==='helper'?'Report':'Approve'}</b></span></div></div>
            <AtlasScene/>
          </section>
          <div className="section-head summary-heading"><h2>{role==='helper'?'Your offers and commitments':'Your circle at a glance'}</h2><span>{role==='helper'?'Only requests shared with you':'This board · all states'}</span></div>
          <div className="summary-grid truth-summary" role="group" aria-label="Filter by task status">{([
            ['accepted','Accepted, not done','green',Check],['helper_reported_done','Helper reported done','amber',Clock3],
            ['confirmed_done','Organizer confirmed','green',CheckCircle2],['seeking','Seeking help','amber',Clock3],
            ['attention','Needs attention','red',Bell]
          ] as const).map(([status,title,color,Icon])=>{const count=board?.requests.filter(request=>status==='attention'?['uncovered','disputed'].includes(request.status):request.status===status).length||0;return <button className="summary-card" key={status} aria-label={`${title}: ${count}`} aria-pressed={requestFilter===status} onClick={()=>focusRequests(requestFilter===status?'all':status)}><span className={`summary-icon ${color}`}><Icon size={17}/></span><span className="summary-number">{count}</span><span className="summary-label">{title}</span><ArrowRight className="summary-arrow" size={14}/></button>;})}</div>
          {role==='organizer'&&board&&boardFetchedAt&&<NextSteps key={`${active.id}:${me!.actor.id}`} board={board} fetchedAt={boardFetchedAt} onInspect={inspectRequest}/>}
          {role==='organizer'&&drafts.length>0&&<section className="saved-drafts" aria-label="Saved drafts"><h2>Pick up a saved draft</h2><p>Nothing has been approved or sent from these drafts. Your latest 20 unexpired drafts appear here.</p>{drafts.map(draft=><article key={draft.id}><div><strong>{draft.titles.join(' · ')}</strong><small>{draft.recoverySourceId?'Recovery draft · ':''}{draft.titles.length} {draft.titles.length===1?'task':'tasks'} · review expires <time dateTime={draft.expiresAt}>{dateText(draft.expiresAt)}</time></small></div><button className="secondary" onClick={()=>{history.replaceState({},'',`?plan=${encodeURIComponent(draft.id)}`);setTab('ask');}}>Resume draft <ArrowRight size={16}/></button></article>)}</section>}
          {board?.notifications.length?<div className="notifications"><div className="section-title"><Bell size={17}/> Updates</div>{board.notifications.slice(0,3).map(n=><div key={n.id} className="notification"><span className="notification-dot"/><span>{n.message}</span><small>{dateText(n.created_at)}</small></div>)}</div>:null}
          <div className="section-head coverage-heading"><div><span className="eyebrow">COMMITMENTS, NOT ASSUMPTIONS</span><h2 id="coverage-heading" tabIndex={-1}>Your requests</h2></div><label className="request-search"><Search size={16}/><input aria-label="Search requests" type="search" placeholder="Find a request" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
          <div className="coverage-toolbar"><div className="request-filters" role="group" aria-label="Filter requests">{[['all','Everything'],['attention','Needs attention'],['helper_reported_done','Awaiting confirmation'],['confirmed_done','Finished']].map(([value,title])=><button key={value} aria-pressed={requestFilter===value} onClick={()=>setRequestFilter(value)}>{title}</button>)}</div>{role==='organizer'&&<div className="view-switch" role="group" aria-label="Coverage view"><button aria-label="List view" aria-pressed={boardView==='list'} onClick={()=>setBoardView('list')}><List size={15}/><span>List</span></button><button aria-label="Coverage map" aria-pressed={boardView==='map'} onClick={()=>setBoardView('map')}><Network size={15}/><span>Map</span></button></div>}</div>
          {filtering&&<p className="filter-result" role="status">{visibleRequests.length} matching {visibleRequests.length===1?'request':'requests'} <button className="text-button" onClick={()=>{setRequestFilter('all');setQuery('');}}>Clear filters</button></p>}
          {boardView==='map'&&role==='organizer'?<CoverageMap key={`${active.id}:${me!.actor.id}`} requests={visibleRequests} events={board?.events||[]} fetchedAt={boardFetchedAt} onInspect={inspectRequest}/>:<>
          <div className="section-head"><h2>Today’s coverage</h2><span>{visibleToday.length} {visibleToday.length===1?'task':'tasks'} · {board?.timezone}</span></div>
          {visibleToday.length?visibleToday.map(r=><RequestCard key={r.id} request={r} organizer={role==='organizer'} onRecover={()=>void recover(r.id)} actorId={me!.actor.id} events={board?.events.filter(e=>e.request_id===r.id)||[]} expanded={expanded===r.id} onToggle={()=>setExpanded(expanded===r.id?null:r.id)} onAction={(path,body,message)=>void act(()=>api(path,{method:'POST',body:JSON.stringify(body||{})}),message)} disabled={loading}/>):visibleRequests.length>0?<p className="quiet-day"><CheckCircle2 size={16}/>{filtering?'No matching requests due today.':'No requests due today.'} Other dates are below.</p>:<div className="empty-state"><span className="empty-icon"><Activity size={25}/></span><h3>{filtering?'No matching requests.':'Your next chapter starts here.'}</h3><p>{filtering?'Try another filter or search. Nothing has been changed.':role==='helper'?'Your invitations and offers will appear here.':'A meal, a visit, a ride. Start with one small ask.'}</p>{filtering&&<button className="secondary" onClick={()=>{setRequestFilter('all');setQuery('');}}>Clear filters <ArrowRight size={16}/></button>}</div>}
          {visibleRequests.filter(r=>!dueToday.includes(r)).length>0&&<><div className="section-head"><h2>Other requests</h2><span>{visibleRequests.filter(r=>!dueToday.includes(r)).length} tasks</span></div>{visibleRequests.filter(r=>!dueToday.includes(r)).map(r=><RequestCard key={r.id} request={r} organizer={role==='organizer'} onRecover={()=>void recover(r.id)} actorId={me!.actor.id} events={board?.events.filter(e=>e.request_id===r.id)||[]} expanded={expanded===r.id} onToggle={()=>setExpanded(expanded===r.id?null:r.id)} onAction={(path,body,message)=>void act(()=>api(path,{method:'POST',body:JSON.stringify(body||{})}),message)} disabled={loading}/>)}</>}
          </>}
          {role==='organizer'&&<div className="workbench-heading"><ShieldCheck size={17}/><div><strong>Behind the scenes</strong><span>Inspect the evidence. Try a failure safely.</span></div><span>ADVANCED</span></div>}
          {role==='organizer'&&ops&&<details className="ops-panel"><summary>Operator view · database job health</summary><div><span>Pending jobs <strong>{ops.jobs.pending||0}</strong></span><span>Running <strong>{ops.jobs.running||0}</strong></span><span>Failed jobs <strong>{ops.jobs.failed||0}</strong></span><span>Oldest ready job <strong>{ops.oldestReadySeconds}s</strong></span><span>Abandoned leases <strong>{ops.abandonedLeases}</strong></span><span>Failed deliveries <strong>{ops.deliveryFailed}</strong></span><span>Uncovered tasks <strong>{ops.uncovered}</strong></span></div><small>{ops.note} Failed jobs require investigation. No metric here proves an email reached a person.</small></details>}
          {demo&&deliveryMode==='simulated'&&role==='organizer'&&<details className="demo-lab-panel"><summary>Reliability lab · try a fictional delivery outage</summary><ReliabilityLab key={`${active.id}:${me!.actor.id}`} api={api}/></details>}
          <div className="page-footnote"><ShieldCheck size={14}/> Private by invitation. Nonmedical by design. Nothing sent without approval.</div>
        </section>}
        {tab==='ask'&&<section className="page ask-page"><div className="page-head"><div><span className="eyebrow">ASK FOR HELP</span><h1>One less thing on your shoulders.</h1><p>Tell Atlas what you need. Nothing is sent until you approve the exact plan.</p></div></div>{role!=='organizer'?<div className="empty-state"><ShieldCheck size={28}/><h3>Only organizers can create requests.</h3><p>You can respond to offers in My offers.</p></div>:<AtlasPlanner key={`${active.id}:${me!.actor.id}`} householdId={active.id} people={people} demo={demo} deliveryMode={deliveryMode} initialPlanId={new URLSearchParams(window.location.search).get('plan')} api={api} onApproved={async()=>{await reload();setTab('today');history.replaceState({},'',window.location.pathname);}}/>}</section>}
        {tab==='offers'&&<section className="page"><div className="page-head"><div><span className="eyebrow">MY OFFERS</span><h1>Show up when you can.</h1><p>Only accept when you’re able to follow through.</p></div></div>{(board?.requests||[]).filter(r=>r.offers.some(o=>o.user_id===me?.actor.id)).length?board!.requests.filter(r=>r.offers.some(o=>o.user_id===me?.actor.id)).map(r=><RequestCard key={r.id} request={r} organizer={false} actorId={me!.actor.id} events={[]} expanded={expanded===r.id} onToggle={()=>setExpanded(expanded===r.id?null:r.id)} onAction={(path,body,message)=>void act(()=>api(path,{method:'POST',body:JSON.stringify(body||{})}),message)} disabled={loading}/>):<div className="empty-state"><HeartHandshake size={27}/><h3>No offers yet.</h3><p>When someone in your circle needs help, you’ll see it here.</p></div>}</section>}
        {tab==='circle'&&<section className="page">
          <div className="page-head"><div><span className="eyebrow">YOUR PEOPLE</span><h1>Care is a team effort.</h1><p>Only invited people can see this private circle.</p></div></div>
          {role==='organizer'&&<div className="panel"><h2>Invite a trusted helper</h2><p>They’ll choose which tasks they’re willing to cover and when they can be contacted. {deliveryMode!=='email'?'No email is sent. Share the sign-in link with them yourself.':'Email is queued only after you create the invitation.'}</p><div className="row"><input type="email" aria-label="Helper email" placeholder="helper@example.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/><button className="primary" disabled={loading||!inviteEmail} onClick={()=>void invite()}>{deliveryMode==='email'?'Queue invite email':'Create in-app invitation'} <ArrowRight size={16}/></button></div></div>}
          {role==='helper'&&<div className="panel"><h2>Your preferences</h2><p>Relief only contacts you for selected tasks within your chosen hours. Equal start and end hours mean no quiet period.</p>
            <div className="type-checks">{Object.entries(typeLabel).map(([value,name])=><label key={value} className="checkline"><input type="checkbox" checked={selectedTypes.includes(value)} onChange={()=>setSelectedTypes(selectedTypes.includes(value)?selectedTypes.filter(x=>x!==value):[...selectedTypes,value])}/>{name}</label>)}</div>
            <div className="form-grid"><label>Quiet hours start<select value={quietStart} onChange={e=>setQuietStart(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{h}:00</option>)}</select></label><label>Quiet hours end<select value={quietEnd} onChange={e=>setQuietEnd(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{h}:00</option>)}</select></label><label>Contact timezone<input value={preferenceTimezone} onChange={e=>setPreferenceTimezone(e.target.value)} placeholder="America/Phoenix"/></label></div>
            <HelperTimeOff dates={unavailableDates} timezone={preferenceTimezone} disabled={loading} onChange={setUnavailableDates}/>
            <label className="checkline"><input type="checkbox" checked={optedIn} onChange={e=>setOptedIn(e.target.checked)}/>I’m ready to receive requests.</label><button className="primary" disabled={loading} onClick={()=>void savePreferences()}>Save preferences</button>
          </div>}
          <div className="panel"><h2>People in this circle</h2><div className="people-list">{people.map(person=><div className="person-row" key={person.id}><span className="mini-avatar">{person.display_name?.charAt(0)||person.email?.charAt(0)||'?'}</span><span><strong>{person.display_name||person.email}</strong><small>{person.role==='organizer'?'Organizer':person.status==='removed'?'Access revoked':person.status==='pending'?'Invitation pending':person.opted_in?'Helper · opted in':'Helper · not opted in'}</small></span>{role==='organizer'&&person.role==='helper'&&person.status!=='removed'?<button className="text-button danger" onClick={()=>{if(confirm(`Remove ${person.email} from this circle?`))void act(()=>api(`/api/households/${active.id}/members/${person.id}`,{method:'DELETE'}),'Helper removed.');}}>Remove</button>:null}</div>)}</div></div>
        </section>}
      </>}
      <footer className="mobile-nav" aria-label="Mobile navigation">{([['today',Home,'Today'],['ask',Plus,'Ask'],['offers',HeartHandshake,'Offers'],['circle',Users,'Circle']] as const).filter(([key])=>key!=='ask'||role==='organizer').map(([key,Icon,name])=><button key={key} aria-current={tab===key?'page':undefined} className={tab===key?'active':''} onClick={()=>setTab(key)}><Icon size={20}/><span>{name}</span></button>)}</footer>
    </main>
  </div>;
}

function greeting(){const hour=new Date().getHours();return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';}
const eventLabel:Record<string,string>={plan_approved:'Organizer approved the exact plan',offer_sent:'Email provider accepted the offer',offer_available_in_app:'Offer became available in-app',email_simulated:'Fictional offer simulated',helper_accepted:'Helper accepted responsibility',helper_reported_done:'Helper reported completion',confirmed_done:'Organizer confirmed completion',disputed:'Organizer disputed completion',uncovered:'Task became uncovered',helper_cancelled:'Helper cancelled acceptance',delivery_failed:'Delivery failed after retries',offer_declined:'Helper declined the offer',offer_skipped_ineligible:'Helper became ineligible before outreach',delivery_result_obsolete:'Late delivery result ignored',helper_removed_reopened:'Helper access revoked; coverage reviewed'};
function RequestCard({request:r,organizer,actorId,events,expanded,onToggle,onAction,onRecover,disabled}:{request:Request;organizer:boolean;actorId:string;events:Board['events'];expanded:boolean;onToggle:()=>void;onAction:(path:string,body:object|null,message:string)=>void;onRecover?:()=>void;disabled:boolean}){
  const myOffer=r.offers.find(o=>o.user_id===actorId);
  const status=label[r.status]||r.status;
  const tone=r.status==='uncovered'||r.status==='disputed'?'red':r.atRisk||r.status==='seeking'||r.status==='helper_reported_done'?'amber':'green';
  return <article className="request-card" id={`request-${r.id}`} tabIndex={-1}>
    <div className={`status-rail ${tone}`}/>
    <div className="request-top"><div><div className="request-category">{typeLabel[r.type]||r.type} · <time dateTime={r.due_at}>{dateText(r.due_at)}</time></div><h3>{r.title}</h3><p>{r.brief}</p></div><div className="request-badges"><span className={`status-chip ${tone}`}><span className="chip-dot"/>{status}</span>{r.atRisk&&<span className="risk-label"><Clock3 size={13}/> At risk · deadline approaching</span>}</div></div>
    {r.accepted_name&&<div className="accepted-line"><CheckCircle2 size={17}/> {r.status==='confirmed_done'?'Confirmed with':'Accepted by'} {r.accepted_name}</div>}
    {r.status==='seeking'&&<div className="accepted-line muted"><Clock3 size={17}/> An available offer is not an acceptance. Keep a backup plan.</div>}
    {r.status==='uncovered'&&<div className="accepted-line danger"><Bell size={17}/> No approved helper covers this task. Review a recovery plan.</div>}
    {myOffer?.status==='simulated'&&<div className="accepted-line muted">Fictional in-app offer. No email was sent.</div>}
    {myOffer?.status==='in_app_available'&&<div className="accepted-line muted">Available in-app. No email was sent. Check here for updates.</div>}
    {myOffer&&['sent','simulated','in_app_available'].includes(myOffer.status)&&r.status==='seeking'&&<div className="card-actions"><button disabled={disabled} className="primary" onClick={()=>onAction(`/api/offers/${myOffer.id}/respond`,{response:'accept'},'You accepted. Please follow through or cancel promptly.')}>Accept</button><button disabled={disabled} className="secondary" onClick={()=>onAction(`/api/offers/${myOffer.id}/respond`,{response:'decline'},'Offer declined.')}>Decline</button></div>}
    {r.accepted_by===actorId&&r.status==='accepted'&&!organizer&&<div className="card-actions"><button disabled={disabled} className="primary" onClick={()=>onAction(`/api/requests/${r.id}/helper-complete`,{},'Completion reported. The organizer still needs to confirm.')}>Report done</button><button disabled={disabled} className="secondary" onClick={()=>onAction(`/api/requests/${r.id}/helper-cancel`,{},'Acceptance cancelled. Organizer alerted.')}>I can’t do it</button></div>}
    {organizer&&r.status==='helper_reported_done'&&<div className="card-actions"><button disabled={disabled} className="primary" onClick={()=>onAction(`/api/requests/${r.id}/organizer-confirm`,{decision:'confirm'},'Task confirmed done.')}>Confirm done</button><button disabled={disabled} className="secondary" onClick={()=>onAction(`/api/requests/${r.id}/organizer-confirm`,{decision:'dispute'},'Completion disputed. Please contact the helper.')}>Dispute</button></div>}
    {organizer&&['uncovered','disputed'].includes(r.status)&&<div className="card-actions"><button disabled={disabled} className="primary" onClick={onRecover}>Review recovery plan <ArrowRight size={16}/></button></div>}
    {(organizer||r.accepted_by===actorId)&&<button className="details-toggle" aria-expanded={expanded} aria-controls={`details-${r.id}`} onClick={onToggle}>{expanded?'Hide':'View'} details and timeline <ChevronDown size={16} className={expanded?'rotated':''}/></button>}
    {expanded&&<div className="details" id={`details-${r.id}`}>
      <div><strong>Location</strong><span>{r.location||'Not provided'}</span></div>
      <div><strong>Instructions</strong><span>{r.instructions||'Not provided'}</span></div>
      {organizer&&<section className="offer-receipts" aria-label="Offer evidence"><strong>Outreach evidence</strong>{r.offers.map(offer=><div key={offer.id}><span>{offer.display_name||'Invited helper'}</span><span>{offerLabel[offer.status]||offer.status} · wave {offer.wave}</span></div>)}</section>}
      {organizer&&<div className="timeline"><strong>Activity and provenance</strong>{events.length?[...events].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).map(e=><details className="provenance-event" key={e.id}><summary>{eventLabel[e.kind]||e.kind.replaceAll('_',' ')}<time dateTime={e.created_at}>{dateText(e.created_at)}</time></summary><p>{e.actor_name||'Relief system'} · Event <code>{e.id}</code></p>{typeof e.detail?.planDigest==='string'&&<p>Approved plan <code>{e.detail.planDigest}</code></p>}{typeof e.detail?.deliveryMode==='string'&&<p>Delivery channel: {e.detail.deliveryMode}</p>}{typeof e.detail?.reason==='string'&&<p>Reason: {e.detail.reason.replaceAll('_',' ')}</p>}</details>):<span>No activity yet.</span>}</div>}
    </div>}
  </article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
