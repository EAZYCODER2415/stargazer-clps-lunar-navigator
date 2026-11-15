import { useState } from 'react';
import { ASSEMBLY_COMPONENTS, COUNTDOWN_SECONDS, RADIO_QUESTIONS } from './gameEngine';

// Stage panels for the stages that share the 3D mission scene. Each one leaves a clear
// "scene window" ([data-scene-window]) that MissionScene3D frames its subject inside,
// so a panel never sits on top of the thing the player is meant to watch.

const STACK_BOTTOM_TO_TOP = ['first-engine', 'first-tank', 'interstage', 'upper-engine', 'upper-tank', 'payload-adapter', 'lander', 'fairing'];

export function Button({ children, className = '', ...props }) { return <button type="button" {...props} className={`game-button ${className}`.trim()}>{children}</button>; }

function SceneWindow() { return <div className="scene-window" data-scene-window aria-hidden="true" />; }

export function Assembly({ state, dispatch, ui }) {
  const installed = new Set(state.installedParts);
  const complete = state.phase === 'assembly-complete';
  const selected = ui.selected && !installed.has(ui.selected) ? ui.selected : null;
  const shownId = selected || (installed.has(state.selectedPart) ? state.selectedPart : null);
  const shown = ASSEMBLY_COMPONENTS.find((part) => part.id === shownId);
  const message = ui.note || state.assemblyFeedback;
  return <section className="game-panel phase-panel assembly-phase stage-split stage-assembly">
    <aside className="stage-console assembly-guide">
      <span className="eyebrow">HOW TO BUILD</span>
      <p><b>Drag a part</b> from the rack onto the vehicle. Its outline lights up green when the part is close: let go and it snaps in.</p>
      <p>Prefer not to drag? <b>Click a part, then click its outline</b> on the vehicle. With a keyboard, use Tab and Enter the same way.</p>
      <span className="eyebrow">PARTS INSTALLED · {installed.size}/{ASSEMBLY_COMPONENTS.length}</span>
      <ul className="assembly-checklist">{ASSEMBLY_COMPONENTS.map((part) => <li key={part.id} className={installed.has(part.id) ? 'done' : selected === part.id ? 'current' : ''}><i style={{ background: part.color }} /><span>{part.name}</span><b>{installed.has(part.id) ? '✓' : ''}</b></li>)}</ul>
    </aside>
    <SceneWindow />
    <aside className="stage-console assembly-info">
      <span className="eyebrow">{complete ? 'VEHICLE COMPLETE' : selected ? 'PART IN HAND' : shown ? 'LAST PART INSTALLED' : 'PART INFO'}</span>
      {shown ? <><h3><i style={{ background: shown.color }} />{shown.name}</h3><p>{shown.description}</p>{selected && <p className="assembly-next">Drop it on the vehicle, or click the outline where it belongs.</p>}</> : <p>Pick up a part to see what it does. This training vehicle is generic and does not represent a specific launch provider.</p>}
      {message && <p className="feedback" role="status">{message}</p>}
      {complete && <div className="assembly-done"><p>All eight vehicle components are installed.</p><Button className="primary-action" onClick={() => dispatch({ type: 'PROCEED_TO_PAD' })}>Continue to launch pad →</Button></div>}
    </aside>
  </section>;
}

// Invisible, focusable stand-ins for the 3D parts and vehicle spaces. The mouse talks to
// the 3D scene directly; these give keyboard and screen-reader users the same two steps.
export function AssemblyHotspots({ state, ui, layout, actions }) {
  if (!layout || state.phase !== 'assembly') return null;
  const installed = new Set(state.installedParts);
  const selected = ui.selected && !installed.has(ui.selected) ? ui.selected : null;
  const selectedName = ASSEMBLY_COMPONENTS.find((part) => part.id === selected)?.name;
  const place = (rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  return <div className="assembly-hotspots">
    {ASSEMBLY_COMPONENTS.filter((part) => !installed.has(part.id) && layout.parts[part.id]).map((part) => <button key={part.id} type="button" className={`part-hotspot ${ui.hoverPart === part.id && !ui.dragging ? 'show-label' : ''}`} style={place(layout.parts[part.id])} aria-pressed={selected === part.id} aria-label={`${part.name}. ${part.description}`} onFocus={() => actions.focus('focusPart', part.id)} onBlur={() => actions.focus('focusPart', null)} onClick={() => actions.select(part.id)}><span className="hotspot-label">{part.name}</span></button>)}
    {STACK_BOTTOM_TO_TOP.filter((slot) => layout.slots[slot]).map((slot, index) => {
      const filled = state.installedParts.some((id) => ASSEMBLY_COMPONENTS.find((part) => part.id === id)?.slot === slot);
      return <button key={slot} type="button" className="slot-hotspot" style={place(layout.slots[slot])} disabled={filled} aria-label={`Vehicle space ${index + 1} of ${STACK_BOTTOM_TO_TOP.length}, counting up from the bottom${filled ? ', filled' : selectedName ? `. Press Enter to fit the ${selectedName} here` : ''}`} onFocus={() => actions.focus('focusSlot', slot)} onBlur={() => actions.focus('focusSlot', null)} onClick={() => (selected ? actions.install(selected, slot) : actions.miss('no-part'))} />;
    })}
  </div>;
}

export function Countdown({ state, dispatch, siteName }) {
  const t = COUNTDOWN_SECONDS - (state.elapsed - state.pad.countdownStartedAt);
  return <section className="game-panel phase-panel countdown-phase stage-split stage-bottom">
    <SceneWindow />
    <div className="stage-console countdown-console">
      <div className="countdown-readout"><span className="eyebrow">TERMINAL COUNTDOWN</span><div className="countdown-number">T−{Math.max(0, t).toFixed(1)}</div></div>
      <div className="countdown-guide"><h2>Vehicle is on internal power</h2><p>Wait for the launch cue. The valid command window is T−0 ±3 seconds; a missed cue holds the vehicle for another attempt.</p><div className="countdown-track"><i style={{ width: `${Math.max(0, Math.min(100, (1 - t / COUNTDOWN_SECONDS) * 100))}%` }} /></div>{state.pad.feedback && <p className="feedback" role="status">{state.pad.feedback}</p>}</div>
      <Button className="primary-action" onClick={() => dispatch({ type: 'LAUNCH', siteName })}>LAUNCH</Button>
    </div>
  </section>;
}

export function Ascent({ state, dispatch }) {
  const a = state.ascent; const since = state.elapsed - a.launchedAt;
  return <section className="game-panel phase-panel ascent-phase stage-split stage-right">
    <SceneWindow />
    <aside className="stage-console">
      <span className="eyebrow">ILLUSTRATIVE ASCENT · NOT A FLIGHT SIMULATION</span><h2>Monitor the vehicle stack</h2>
      <p>Watch the vehicle climb. Each button below unlocks when its cue arrives.</p>
      <div className="flight-readouts"><div><small>MISSION ELAPSED</small><b>{Math.floor(since)} s</b></div><div><small>FIRST STAGE</small><b>{a.separatedAt ? 'SEPARATED' : since >= 20 ? 'CUTOFF · SEPARATE' : 'POWERED FLIGHT'}</b></div><div><small>PAYLOAD FAIRING</small><b>{a.fairingSeparated ? 'SEPARATED' : since >= 75 ? 'SEPARATION AVAILABLE' : 'ATTACHED'}</b></div></div>
      <div className="action-row">{!a.separatedAt && <Button className="primary-action" onClick={() => dispatch({ type: 'SEPARATE_FIRST_STAGE' })} disabled={since < 20}>Separate first stage</Button>}{a.separatedAt && !a.fairingSeparated && <Button className="primary-action" onClick={() => dispatch({ type: 'SEPARATE_FAIRING' })} disabled={since < 75}>Separate payload fairing</Button>}{a.fairingSeparated && !a.payloadSeparated && <Button className="primary-action" onClick={() => dispatch({ type: 'SEPARATE_PAYLOAD' })} disabled={since < 110}>Separate lander into transit</Button>}</div>
      {a.feedback && <p className="feedback" role="status">{a.feedback}</p>}
      <p className="phase-explainer">The ascent timeline is a gameplay sequence with illustrative altitude. Real launch profiles depend on the vehicle and mission.</p>
    </aside>
  </section>;
}

export function Transit({ state, dispatch }) {
  const [tab, setTab] = useState('monitoring');
  const [open, setOpen] = useState(true);
  const transit = state.transit; const elapsed = state.elapsed - transit.startedAt;
  const waiting = transit.questions.filter((q) => q.status === 'pending').length;
  const show = (next) => { setTab(next); setOpen(true); };
  return <section className="game-panel phase-panel transit-phase stage-split stage-bottom">
    <SceneWindow />
    <div className={`stage-console transit-console ${open ? '' : 'collapsed'}`}>
      <div className="console-bar">
        <div><span className="eyebrow">SCHEMATIC TRANSIT · NO TRAJECTORY MODEL</span><h2>Monitor the lunar spacecraft</h2></div>
        <div className="tab-row"><Button className={open && tab === 'monitoring' ? 'selected' : ''} onClick={() => show('monitoring')}>Vehicle monitoring</Button><Button className={`${open && tab === 'communications' ? 'selected' : ''} ${waiting ? 'has-news' : ''}`} onClick={() => show('communications')}>Communications{waiting ? ` · ${waiting} new` : ''}</Button><Button className="panel-toggle" aria-expanded={open} aria-controls="transit-panel-body" onClick={() => setOpen(!open)}>{open ? 'Hide panel ▾' : 'Show panel ▴'}</Button></div>
      </div>
      {open && <div id="transit-panel-body">{tab === 'monitoring' ? <div className="transit-monitor"><div className="transit-data"><div><small>TRANSIT ELAPSED</small><b>{Math.floor(elapsed)} / 180 s</b></div><div><small>MISSION LINK</small><b>SIMULATED · NOMINAL</b></div><div><small>QUESTIONS REVIEWED</small><b>{transit.questions.filter((q) => q.status === 'answered').length} / {RADIO_QUESTIONS.length}</b></div></div><p>Distance and vehicle position are illustrative. This view does not solve an orbit or communications link budget.</p></div> : <div className="comms-list">{RADIO_QUESTIONS.map((item) => { const q = transit.questions.find((x) => x.id === item.id); return <article key={item.id} className={`comms-question ${q.status}`}><span className="eyebrow">{q.status === 'scheduled' ? `MESSAGE AT +${item.due} S` : q.status.toUpperCase()}</span><h3>{item.question}</h3>{q.status === 'pending' ? <><div className="answer-list">{item.choices.map((choice, i) => <label key={choice}><input type="radio" name={item.id} checked={q.answer === i} onChange={() => dispatch({ type: 'SET_ANSWER', questionId: item.id, answer: i })} />{choice}</label>)}</div><Button onClick={() => dispatch({ type: 'ANSWER_QUESTION', questionId: item.id })} disabled={q.answer === null}>Submit answer</Button></> : q.status === 'answered' || q.status === 'missed' ? <p>{q.feedback}</p> : <p>Waiting for this message. The mission clock continues while you use the monitoring view.</p>}</article>; })}</div>}</div>}
    </div>
  </section>;
}

export function Landing({ state, dispatch }) {
  const landing = state.landing; const since = landing.descentStartedAt === null ? 0 : state.elapsed - landing.descentStartedAt;
  const zones = [{ id: 'A', label: 'Rough ground · training cue' }, { id: 'B', label: 'Clear patch · training cue' }, { id: 'C', label: 'Slope · training cue' }];
  // The engine also uses the feedback field for internal "-prompted" markers; those are not messages.
  const feedback = landing.feedback && !landing.feedback.endsWith('-prompted') ? landing.feedback : '';
  return <section className="game-panel phase-panel landing-phase stage-split stage-right">
    <SceneWindow />
    <aside className="stage-console">
      <span className="eyebrow">SIMPLIFIED POWERED DESCENT · TRAINING CUES ONLY</span><h2>Choose a landing zone</h2><p>Zone labels are fictional game cues. They are not terrain-hazard classifications or engineering safety advice.</p>
      <div className="landing-grid">{zones.map((z) => <button type="button" key={z.id} className={`zone-card zone-${z.id} ${landing.zone === z.id ? 'selected' : ''}`} onClick={() => dispatch({ type: 'SELECT_LANDING_ZONE', zone: z.id })} disabled={landing.descentStartedAt !== null}><b>ZONE {z.id}</b><span>{z.label}</span></button>)}</div>
      {landing.descentStartedAt === null ? <Button className="primary-action" disabled={!landing.zone} onClick={() => dispatch({ type: 'BEGIN_DESCENT' })}>Begin powered descent</Button> : <><div className="descent-meter"><div><span>DESCENT SEQUENCE</span><b>{Math.min(100, Math.floor(since / 90 * 100))}%</b></div><progress max="90" value={Math.min(90, since)} /></div><div className="action-row">{!landing.thrustAdjusted && <Button className="primary-action" onClick={() => dispatch({ type: 'ADJUST_THRUST' })} disabled={since < 20}>Adjust descent thrust</Button>}{landing.thrustAdjusted && !landing.alignmentComplete && <Button className="primary-action" onClick={() => dispatch({ type: 'ALIGN_LANDER' })} disabled={since < 48}>Align over zone {landing.zone}</Button>}{landing.alignmentComplete && !landing.touchdown && <Button className="primary-action" onClick={() => dispatch({ type: 'CONFIRM_TOUCHDOWN' })} disabled={since < 90}>Confirm touchdown</Button>}</div></>}
      {feedback && <p className="feedback" role="status">{feedback}</p>}
    </aside>
  </section>;
}
