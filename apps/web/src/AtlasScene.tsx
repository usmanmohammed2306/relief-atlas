import { useEffect, useId, useRef, useState } from 'react';
import { Box, Car, DoorOpen, House, Move, Pause, Play, RotateCcw, Soup } from 'lucide-react';
import type { SpatialRenderer } from './spatial-renderer.js';
import './atlas-scene.css';

type Rotation = { yaw: number; pitch: number };
type Quality = 'full' | 'lite';
type SceneFocus = 'home' | 'meal' | 'visit' | 'ride';
const focusCopy: Record<SceneFocus, string> = {
  home: 'Small, practical help. From people you trust.',
  meal: 'A meal drop-off. You choose who to ask.',
  visit: 'A friendly visit. The helper chooses whether to accept.',
  ride: 'A planned ride. Private details stay protected.',
};
const initialRotation: Rotation = { yaw: -.36, pitch: -.22 };
const motionPreferenceKey = 'relief-scene-paused';
const qualityPreferenceKey = 'relief-scene-quality';
const readPreference = (key: string) => { try { return window.sessionStorage.getItem(key); } catch { return null; } };
const storePreference = (key: string, value: string) => { try { window.sessionStorage.setItem(key, value); } catch { /* Controls also work without storage. */ } };
function initiallyPaused() {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || readPreference(motionPreferenceKey) === 'true';
}

/** An illustrative home, never a household model or coordination signal. */
export function AtlasScene() {
  const captionId = useId();
  const helpId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => {});
  const rotationRef = useRef(initialRotation);
  const phaseRef = useRef(0);
  const spreadRef = useRef(0);
  const exploredRef = useRef(false);
  const focusRef = useRef<SceneFocus>('home');
  const pausedRef = useRef(initiallyPaused());
  const dragRef = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const [rotation, setRotation] = useState(initialRotation);
  const [paused, setPaused] = useState(initiallyPaused);
  const [quality, setQuality] = useState<Quality>(() => typeof window !== 'undefined' && readPreference(qualityPreferenceKey) === 'lite' ? 'lite' : 'full');
  const [rendererKind, setRendererKind] = useState<'loading' | 'webgl' | 'lite' | 'fallback'>(quality === 'lite' ? 'lite' : 'loading');
  const [explored, setExplored] = useState(false);
  const [sceneFocus, setSceneFocus] = useState<SceneFocus>('home');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => { if (preference.matches) setPaused(true); };
    onPreference(); preference.addEventListener('change', onPreference);
    return () => preference.removeEventListener('change', onPreference);
  }, []);

  useEffect(() => { pausedRef.current = paused; wakeRef.current(); }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    if (quality === 'lite') { setRendererKind('lite'); return; }
    let runtime: SpatialRenderer | null = null;
    let disposed = false;
    let frame = 0;
    let lastFrame = 0;
    let onscreen = true;
    let failed = false;
    let daylight = document.documentElement.dataset.theme === 'daylight';
    setRendererKind('loading');
    const draw = () => {
      if (!runtime || disposed || failed) return;
      try { runtime.render({ ...rotationRef.current, phase: phaseRef.current, spread: spreadRef.current, focus: focusRef.current, daylight }); }
      catch { fail(); }
    };
    function fail() {
      if (disposed || failed) return;
      failed = true;
      cancelAnimationFrame(frame);
      canvas!.removeEventListener('webglcontextlost', onContextLost);
      runtime?.dispose(); runtime = null;
      setRendererKind('fallback');
    }
    function tick(now: number) {
      if (!runtime || disposed || failed || pausedRef.current || !onscreen || document.hidden) return;
      // Rendering is capped at 30 fps and 1.5 DPR. There are no per-frame React
      // updates. Inactive, offscreen, paused and hidden views schedule no frames.
      if (now - lastFrame >= 1000 / 30) {
        const elapsed = lastFrame ? Math.min(now - lastFrame, 70) / 1000 : 0;
        if (!dragRef.current) phaseRef.current += elapsed;
        const target = exploredRef.current ? 1 : 0;
        spreadRef.current += (target - spreadRef.current) * Math.min(1, elapsed * 7);
        if (Math.abs(target - spreadRef.current) < .001) spreadRef.current = target;
        lastFrame = now;
        draw();
      }
      if (!failed) frame = requestAnimationFrame(tick);
    }
    function wake() {
      cancelAnimationFrame(frame);
      lastFrame = 0;
      if (pausedRef.current) spreadRef.current = exploredRef.current ? 1 : 0;
      draw();
      if (runtime && !disposed && !failed && !pausedRef.current && onscreen && !document.hidden) frame = requestAnimationFrame(tick);
    }
    function resize() {
      try { runtime?.resize(stage!.clientWidth, stage!.clientHeight); draw(); }
      catch { fail(); }
    }
    function onContextLost(event: Event) { event.preventDefault(); fail(); }
    wakeRef.current = wake;
    canvas.addEventListener('webglcontextlost', onContextLost);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    const intersectionObserver = new IntersectionObserver(entries => { onscreen = entries[0]?.isIntersecting ?? false; wake(); });
    intersectionObserver.observe(stage);
    const themeObserver = new MutationObserver(() => { daylight = document.documentElement.dataset.theme === 'daylight'; draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', wake);
    // The WebGL module is an optional, separately downloaded local chunk.
    // Navigation remains usable while it loads or if graphics are unavailable.
    void import('./spatial-renderer.js').then(({ createSpatialRenderer }) => {
      if (disposed || failed) return;
      runtime = createSpatialRenderer(canvas);
      resize();
      if (failed) return;
      setRendererKind('webgl');
      wake();
    }).catch(fail);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect(); intersectionObserver.disconnect(); themeObserver.disconnect();
      document.removeEventListener('visibilitychange', wake);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      runtime?.dispose();
      wakeRef.current = () => {};
    };
  }, [quality]);

  function rotate(yaw: number, pitch: number) {
    const next = { yaw, pitch: Math.max(-1.1, Math.min(1.1, pitch)) };
    rotationRef.current = next; setRotation(next); wakeRef.current();
  }
  function toggleMotion() {
    const next = !paused; storePreference(motionPreferenceKey, String(next)); setPaused(next);
  }
  function toggleStructure() {
    const next = !explored;
    exploredRef.current = next; setExplored(next); wakeRef.current();
  }
  function toggleQuality() {
    const next = quality === 'full' ? 'lite' : 'full';
    storePreference(qualityPreferenceKey, next);
    setQuality(next);
  }
  function chooseFocus(value: SceneFocus) {
    focusRef.current = value; setSceneFocus(value); wakeRef.current();
  }
  const full3D = rendererKind === 'webgl';

  return <section className="atlas-scene" aria-label="Care circle illustration" data-motion={paused || !full3D ? 'paused' : 'playing'} data-renderer={rendererKind} data-exploded={explored} data-focus={sceneFocus}>
    <p className="atlas-scene-caption" id={captionId}>Illustration only <span>· not your home or live status</span></p>
    <div className={`atlas-scene-stage${dragging ? ' is-dragging' : ''}`} ref={stageRef} role="group" tabIndex={0}
      aria-label="Rotate illustrative care scene" aria-describedby={`${captionId} ${helpId}`} data-rotation={`${rotation.yaw.toFixed(3)},${rotation.pitch.toFixed(3)}`}
      onKeyDown={event => {
        const change = { ArrowLeft: [-.16, 0], ArrowRight: [.16, 0], ArrowUp: [0, -.16], ArrowDown: [0, .16] }[event.key];
        if (!change) return; event.preventDefault(); rotate(rotationRef.current.yaw + change[0], rotationRef.current.pitch + change[1]);
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        dragRef.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => {
        const drag = dragRef.current; if (!drag || drag.pointer !== event.pointerId) return;
        rotate(rotationRef.current.yaw + (event.clientX - drag.x) * .007, rotationRef.current.pitch + (event.clientY - drag.y) * .007);
        drag.x = event.clientX; drag.y = event.clientY;
      }}
      onPointerUp={() => { dragRef.current = null; setDragging(false); }} onPointerCancel={() => { dragRef.current = null; setDragging(false); }} onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}>
      <canvas key={quality} ref={canvasRef} aria-hidden="true" hidden={!full3D}/>
      {!full3D && <div className={`atlas-scene-fallback${explored ? ' is-explored' : ''}`} aria-hidden="true" style={{ transform: `rotateX(${rotation.pitch * 25}deg) rotateY(${rotation.yaw * 25}deg)` }}><div className="fallback-home"><i className="fallback-roof"/><i className="fallback-window"/><i className="fallback-door"/></div><i className="fallback-plinth"/><span className={`fallback-task meal ${sceneFocus==='meal'?'selected':''}`}><Soup/></span><span className={`fallback-task visit ${sceneFocus==='visit'?'selected':''}`}><DoorOpen/></span><span className={`fallback-task ride ${sceneFocus==='ride'?'selected':''}`}><Car/></span></div>}
      <span className="atlas-scene-drag-hint" aria-hidden="true"><Move size={12}/>{full3D ? 'Drag to look around' : 'A lightweight home illustration'}</span>
    </div>
    <p id={helpId} className="atlas-scene-sr">Use the arrow keys or drag to rotate. Look inside the home lifts the illustrative roof. Meal, Visit and Ride highlight examples, not real requests or helpers. No home location, coverage or AI activity is shown.</p>
    {rendererKind === 'fallback' && <p className="atlas-scene-fallback-note" role="status">3D is unavailable here. The simple visual keeps the experience usable.</p>}
    <div className="atlas-scene-focus" role="group" aria-label="Explore kinds of help">{([{value:'meal',label:'Meal',Icon:Soup},{value:'visit',label:'Visit',Icon:DoorOpen},{value:'ride',label:'Ride',Icon:Car}] as const).map(({value,label,Icon})=><button type="button" key={value} aria-label={`Show ${value} illustration`} aria-pressed={sceneFocus===value} onClick={()=>chooseFocus(value)}><Icon size={15}/>{label}</button>)}</div>
    <p className="atlas-scene-focus-copy" role="status">{focusCopy[sceneFocus]}</p>
    <footer className="atlas-scene-footer"><button className="scene-home-control" type="button" aria-label="Look inside the home" aria-pressed={explored} onClick={toggleStructure}><House size={13}/>{explored ? 'Close the roof' : 'Look inside'}</button><div className="atlas-scene-controls">
      <button type="button" aria-label={quality === 'full' ? 'Simple visual' : 'Full 3D'} title={quality === 'full' ? 'Use a lightweight illustration' : 'Use full 3D'} onClick={toggleQuality}><Box size={13}/><span>{quality === 'full' ? 'Simple visual' : 'Full 3D'}</span></button>
      {full3D ? <button type="button" aria-label={paused ? 'Resume motion' : 'Pause motion'} aria-pressed={paused} onClick={toggleMotion}>{paused ? <Play size={12}/> : <Pause size={12}/>}<span>{paused ? 'Resume motion' : 'Pause motion'}</span></button> : <span className="atlas-scene-static">Static visual</span>}
      <button type="button" aria-label="Reset view" title="Reset view" onClick={() => { phaseRef.current = 0; exploredRef.current = false; spreadRef.current = 0; setExplored(false); chooseFocus('home'); rotate(initialRotation.yaw, initialRotation.pitch); }}><RotateCcw size={12}/></button>
    </div></footer>
  </section>;
}
