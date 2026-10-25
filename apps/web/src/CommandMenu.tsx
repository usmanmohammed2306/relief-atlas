import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Command, Search, X } from 'lucide-react';

export type Tab = 'today' | 'plan' | 'ask' | 'offers' | 'circle' | 'task' | 'tools';
type Props = { organizer: boolean; onNavigate: (tab: Tab) => void; onMap: () => void; onTheme: () => void; theme: 'night' | 'daylight'; hideTrigger?: boolean; openSignal?: number };

export function CommandMenu({ organizer, onNavigate, onMap, onTheme, theme, hideTrigger=false, openSignal=0 }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close(); else setOpen(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => { if (open && !dialog.current?.open) { dialog.current?.showModal(); input.current?.focus(); } }, [open]);
  useEffect(()=>{if(openSignal)setOpen(true);},[openSignal]);
  function run(action: () => void) { dialog.current?.close(); action(); }
  const commands = [
    { name: 'Home', hint: 'Your next action', action: () => onNavigate('today') },
    ...(organizer ? [
      { name: 'Prepare an outreach draft', hint: 'Review first. Nothing sent.', action: () => onNavigate('ask') },
      { name: 'Your plan', hint: 'View all requests', action: () => onNavigate('plan') },
      { name: 'Open coverage map', hint: 'Inspect task and helper records', action: onMap }
    ] : []),
    { name: 'My offers', hint: 'Respond from the offer screen', action: () => onNavigate('offers') },
    { name: 'Circle preferences', hint: 'Review people and settings', action: () => onNavigate('circle') },
    { name: `Switch to ${theme === 'night' ? 'daylight' : 'night shift'}`, hint: 'Appearance only', action: onTheme }
  ].filter(command => `${command.name} ${command.hint}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    {!hideTrigger&&<button className="command-trigger" ref={trigger} aria-label="Open quick navigation" aria-haspopup="dialog" onClick={() => setOpen(true)}><Command size={15}/><span>Navigate</span><kbd>⌘ K</kbd></button>}
    <dialog className="command-dialog" ref={dialog} aria-labelledby="command-title" onClose={() => { setOpen(false); setQuery(''); }} onCancel={() => { trigger.current?.focus(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><div><span className="eyebrow">RELIEF ATLAS</span><h2 id="command-title">Where would you like to go?</h2></div><button aria-label="Close quick navigation" onClick={() => { dialog.current?.close(); trigger.current?.focus(); }}><X size={18}/></button></header>
      <label className="command-search"><Search size={18}/><input ref={input} aria-label="Search navigation" placeholder="Find a screen or change appearance" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && commands.length === 1) { event.preventDefault(); run(commands[0].action); } }}/></label>
      <div className="command-options">{commands.map(command => <button key={command.name} onClick={() => run(command.action)}><span><strong>{command.name}</strong><small>{command.hint}</small></span><ArrowUpRight size={17}/></button>)}{!commands.length && <p role="status">No navigation matches. Try “map”, “offers” or “daylight”.</p>}</div>
      <footer>Navigation only. No approval, dispatch or external contact. <kbd>Esc</kbd> to close.</footer>
    </dialog>
  </>;
}
