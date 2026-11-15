import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import landingSites from '../data/landingSites.json';
import { calculateEarthPosition, calculateSunPosition, clearanceOf } from '../utils/ephemerisRuntime';
import { ASSEMBLY_COMPONENTS, COUNTDOWN_SECONDS, GAME_SPEEDS, LAUNCH_WINDOWS, PROPELLANT_LOAD_SECONDS, RADIO_QUESTIONS, SCENARIO_START, SURVEY_DURATION_SECONDS, createInitialState, getActiveWindow, getLaunchReadiness, getWindowStatus, reducer } from './gameEngine';
import GameGuide from './GameGuide';
import MissionPlanning from './MissionPlanning';
import './game.css';

const LunarScene3D = lazy(() => import('../components/LunarScene3D'));

const phaseInfo = {
  assembly: ['01 · ASSEMBLY', 'Build the launch stack', 'Match each vehicle component to its attachment point.'],
  'assembly-complete': ['01 · ASSEMBLY', 'Vehicle assembled', 'Review the stack, then move to pad preparation.'],
  launchpad: ['02 · LAUNCH PAD', 'Prepare for launch', 'Complete the pad procedure and watch for a scenario launch window.'],
  countdown: ['03 · COUNTDOWN', 'Terminal countdown', 'Hold the launch command until the T−0 cue.'],
  ascent: ['04 · ASCENT', 'Manage ascent and staging', 'Separate spent stages at the cues, then release the lander.'],
  transit: ['05 · TRANSIT', 'Monitor the lunar transit', 'Switch between vehicle monitoring and Communications as the mission clock continues.'],
  landing: ['06 · LANDING', 'Guide the powered descent', 'Choose a training zone, manage thrust, and confirm touchdown.'],
  'lunar-operations': ['07 · LUNAR OPERATIONS', 'Complete the first rover survey', 'Review local illumination and Earth visibility using the site’s existing lunar data.'],
  'no-launch': ['PREPARATION DEADLINE', 'The planned schedule expired', 'The selected lunar operating window and the game launch opportunities are separate. Review the plan and choose a later opportunity for more preparation time.'],
};

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `T+${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function Button({ children, ...props }) { return <button type="button" className="game-button" {...props}>{children}</button>; }

function MissionTimeline({ state, dispatch }) {
  const active = getActiveWindow(state);
  return <section className="game-panel mission-timeline" aria-label="Scenario launch windows">
    <div className="timeline-title"><span className="eyebrow">SCENARIO OPPORTUNITIES</span><span>Illustrative launch windows · not a real launch forecast</span></div>
    <div className="window-track">{LAUNCH_WINDOWS.map((w) => {
      const status = getWindowStatus(state, w);
      return <article key={w.id} className={`window-card ${status}`}><div><b>{w.name}</b><span>{status === 'active' ? 'OPEN NOW' : status.toUpperCase()}</span></div><p>{w.condition}</p><small>{Math.floor(w.openAt / 60)}–{Math.floor(w.closeAt / 60)} min · {w.duration}</small>{status === 'active' && <Button className="text-button" onClick={() => dispatch({ type: 'SKIP_WINDOW', windowId: w.id })}>Skip this window</Button>}</article>;
    })}</div>
    {active && <p className="window-note">{active.description}</p>}
  </section>;
}

function Assembly({ state, dispatch }) {
  const installed = new Set(state.installedParts);
  const slots = ['fairing', 'lander', 'payload-adapter', 'upper-tank', 'upper-engine', 'interstage', 'first-tank', 'first-engine'];
  const [selected, setSelected] = useState(state.selectedPart);
  const itemFor = (slot) => ASSEMBLY_COMPONENTS.find((item) => item.slot === slot);
  function install(part, slot) { dispatch({ type: 'INSTALL_PART', partId: part, slotId: slot }); }
  return <section className="game-panel phase-panel assembly-phase">
    <div className="phase-copy"><span className="eyebrow">HANDS-ON · VEHICLE INTEGRATION</span><h2>Assemble the generic robotic lander vehicle</h2><p>Place each part into its matching socket. This training stack is generic and does not represent a specific launch provider.</p></div>
    <div className="assembly-layout"><div className="rocket-stack" aria-label="Vehicle stack component sockets">{slots.map((slot, index) => {
      const part = itemFor(slot); const done = installed.has(part.id);
      return <button key={slot} type="button" className={`rocket-slot slot-${slot} ${done ? 'installed' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); install(e.dataTransfer.getData('text/plain'), slot); }} onClick={() => install(selected, slot)} aria-label={`${part.name} socket${done ? ', installed' : ''}`}>
        {done ? <><i style={{ background: part.color }} />{part.name}</> : <><span>{String(index + 1).padStart(2, '0')}</span>DROP {part.name.toUpperCase()} HERE</>}
      </button>;
    })}</div>
      <div className="parts-panel"><span className="eyebrow">COMPONENTS · {installed.size}/{ASSEMBLY_COMPONENTS.length}</span><div className="parts-list">{ASSEMBLY_COMPONENTS.map((part) => <button key={part.id} draggable={!installed.has(part.id)} type="button" className={`part-card ${installed.has(part.id) ? 'done' : selected === part.id ? 'selected' : ''}`} onDragStart={(e) => { e.dataTransfer.setData('text/plain', part.id); dispatch({ type: 'DRAG_PART', partId: part.id }); }} onClick={() => { setSelected(part.id); dispatch({ type: 'SELECT_PART', partId: part.id }); }} disabled={installed.has(part.id)}><b><i style={{ background: part.color }} />{part.name}</b><small>{part.description}</small></button>)}</div>{state.assemblyFeedback && <p className="feedback" role="status">{state.assemblyFeedback}</p>}</div>
    </div>
    {state.phase === 'assembly-complete' && <div className="phase-action"><p>All eight vehicle components are installed.</p><Button onClick={() => dispatch({ type: 'PROCEED_TO_PAD' })}>Continue to launch pad →</Button></div>}
  </section>;
}

function LaunchPad({ state, dispatch }) {
  const readiness = getLaunchReadiness(state);
  const active = readiness.activeWindow;
  const assessWindow = active || LAUNCH_WINDOWS.find((w) => getWindowStatus(state, w) === 'upcoming');
  const assessment = assessWindow && state.pad.weatherAssessment[assessWindow.id];
  const statuses = readiness.go.map((go, index) => ({ name: ['VEHICLE', 'SPACECRAFT', 'SITE / WEATHER'][index], go }));
  return <section className="game-panel phase-panel pad-phase">
    <div className="phase-copy"><span className="eyebrow">GROUND OPERATIONS</span><h2>Prepare the rocket and lander</h2><p>These are simplified training procedures. Scenario weather is deterministic game data, not a live forecast.</p></div>
    <div className="pad-illustration" aria-label="Schematic launch pad"><div className="pad-tower"><i /><i /><i /></div><div className={`pad-rocket ${state.pad.platformRetracted ? 'clear' : ''}`}><span className="rocket-tip" /><span className="rocket-body" /><span className="rocket-engine" /></div><div className={`pad-platform ${state.pad.platformExtended ? 'extended' : ''}`} /><div className="pad-ground" /></div>
    <div className="pad-columns">
      <div className="pad-checklist"><span className="eyebrow">PAD PROCEDURE</span>
        <div className="procedure-row"><b>01</b><span>Extend vehicle access platform</span><Button onClick={() => dispatch({ type: 'EXTEND_PLATFORM' })} disabled={state.pad.platformExtended || state.pad.platformRetracted}>{state.pad.platformExtended ? 'EXTENDED' : 'Extend'}</Button></div>
        <div className="procedure-row"><b>02</b><span>Connect fuel and oxidiser lines</span><div className="inline-actions"><Button onClick={() => dispatch({ type: 'TOGGLE_PROPELLANT_LINE', line: 'fuel' })} disabled={!state.pad.platformExtended || state.pad.propellantStartedAt !== null}>{state.pad.fuelConnected ? 'Fuel ✓' : 'Fuel'}</Button><Button onClick={() => dispatch({ type: 'TOGGLE_PROPELLANT_LINE', line: 'oxidizer' })} disabled={!state.pad.platformExtended || state.pad.propellantStartedAt !== null}>{state.pad.oxidizerConnected ? 'Oxidiser ✓' : 'Oxidiser'}</Button></div></div>
        <div className="procedure-row"><b>03</b><span>Load propellant · {state.pad.propellantLoaded ? 'complete' : state.pad.propellantStartedAt !== null ? 'in progress' : 'ready'}</span><Button onClick={() => dispatch({ type: 'START_PROPELLANT_LOADING' })} disabled={!state.pad.platformExtended || !state.pad.fuelConnected || !state.pad.oxidizerConnected || state.pad.propellantStartedAt !== null}>{state.pad.propellantLoaded ? 'Loaded' : state.pad.propellantStartedAt !== null ? 'Loading…' : 'Start load'}</Button></div>
        <div className="procedure-row"><b>04</b><span>Complete vehicle and spacecraft checks</span><div className="inline-actions"><Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'vehicle' })} disabled={state.pad.checks.vehicle}>{state.pad.checks.vehicle ? 'Vehicle ✓' : 'Vehicle check'}</Button><Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'spacecraft' })} disabled={state.pad.checks.spacecraft}>{state.pad.checks.spacecraft ? 'Spacecraft ✓' : 'Spacecraft check'}</Button></div></div>
        <div className="procedure-row"><b>05</b><span>Retract access platform</span><Button onClick={() => dispatch({ type: 'RETRACT_PLATFORM' })} disabled={state.pad.platformRetracted}>{state.pad.platformRetracted ? 'Clear ✓' : 'Retract'}</Button></div>
        <div className="procedure-row"><b>06</b><span>Switch spacecraft to onboard power</span><Button onClick={() => dispatch({ type: 'SWITCH_ONBOARD_POWER' })} disabled={state.pad.onboardPower}>{state.pad.onboardPower ? 'Onboard ✓' : 'Switch power'}</Button></div>
      </div>
      <div className="window-review"><span className="eyebrow">{active ? `${active.name} · OPEN` : assessWindow?.name || 'NO UPCOMING WINDOW'}</span><h3>Assess scenario weather</h3><p>{assessWindow?.description || 'No more launch windows are available in this scenario period.'}</p>{assessWindow && <><div className="weather-meter"><span>WIND</span><b>{assessWindow.weather === 'caution' ? 'VARIABLE · CAUTION' : 'STABLE · GO'}</b><i className={assessWindow.weather === 'caution' ? 'caution' : ''} /></div><div className="inline-actions weather-choice">{['go', 'caution', 'noGo'].map((choice) => <Button key={choice} className={state.pad.weatherChoice[assessWindow.id] === choice ? 'selected' : ''} onClick={() => dispatch({ type: 'SET_WEATHER_CHOICE', windowId: assessWindow.id, choice })}>{choice === 'noGo' ? 'NO-GO' : choice.toUpperCase()}</Button>)}</div><Button onClick={() => dispatch({ type: 'ASSESS_WEATHER', windowId: assessWindow.id })}>Record assessment</Button>{assessment && <p className="feedback" role="status">{state.pad.feedback || (assessment.correct ? `Assessment recorded: ${assessment.choice.toUpperCase()}.` : 'Review the indicator and reassess.')}</p>}</>}
        {assessWindow && <Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'site', windowId: assessWindow.id })} disabled={state.pad.checks.site}>Complete launch-site check</Button>}
        <div className="go-lights">{statuses.map((item) => <div key={item.name}><i className={item.go ? 'on' : ''} /><b>{item.name}</b><span>{item.go ? 'GO' : 'WAIT'}</span></div>)}</div>
        {state.pad.feedback && <p className="feedback" role="status">{state.pad.feedback}</p>}
        <Button className="primary-action" disabled={!readiness.allGo || !active} onClick={() => dispatch({ type: 'START_COUNTDOWN' })}>{active ? readiness.allGo ? 'Begin terminal countdown' : 'Complete pad gates to continue' : 'Waiting for launch window'}</Button>
      </div>
    </div>
    {state.pad.propellantStartedAt !== null && !state.pad.propellantLoaded && <div className="progress-wrap"><div><span>SIMULATED LOADING</span><b>{Math.min(100, Math.floor((state.elapsed - state.pad.propellantStartedAt) / PROPELLANT_LOAD_SECONDS * 100))}%</b></div><progress max="100" value={Math.min(100, (state.elapsed - state.pad.propellantStartedAt) / PROPELLANT_LOAD_SECONDS * 100)} /></div>}
  </section>;
}

function Countdown({ state, dispatch }) {
  const t = COUNTDOWN_SECONDS - (state.elapsed - state.pad.countdownStartedAt);
  return <section className="game-panel phase-panel countdown-phase"><span className="eyebrow">TERMINAL COUNTDOWN · {getActiveWindow(state)?.name}</span><h2>Vehicle is on internal power</h2><div className="countdown-number">T−{Math.max(0, t).toFixed(1)}</div><p>Wait for the launch cue. The valid command window is T−0 ±3 seconds; a missed cue holds the vehicle for another attempt.</p><div className="countdown-track"><i style={{ width: `${Math.max(0, Math.min(100, (1 - t / COUNTDOWN_SECONDS) * 100))}%` }} /></div><Button className="primary-action" onClick={() => dispatch({ type: 'LAUNCH', siteName: landingSites.find((s) => s.id === state.siteId)?.name })}>LAUNCH</Button>{state.pad.feedback && <p className="feedback" role="status">{state.pad.feedback}</p>}</section>;
}

function Ascent({ state, dispatch }) {
  const a = state.ascent; const since = state.elapsed - a.launchedAt;
  return <section className="game-panel phase-panel ascent-phase"><span className="eyebrow">ILLUSTRATIVE ASCENT · NOT A FLIGHT SIMULATION</span><h2>Monitor the vehicle stack</h2><div className="flight-schematic"><div className="flight-line"><i style={{ bottom: `${Math.min(90, since / 160 * 90)}%` }} /></div><div className="ascent-rocket"><span /><i /><b /></div><div className="flight-readouts"><div><small>MISSION ELAPSED</small><b>{Math.floor(since)} s</b></div><div><small>FIRST STAGE</small><b>{a.separatedAt ? 'SEPARATED' : since >= 20 ? 'CUTOFF · SEPARATE' : 'POWERED FLIGHT'}</b></div><div><small>PAYLOAD FAIRING</small><b>{a.fairingSeparated ? 'SEPARATED' : since >= 75 ? 'SEPARATION AVAILABLE' : 'ATTACHED'}</b></div></div></div><p className="phase-explainer">The ascent timeline is a gameplay sequence with illustrative altitude. Real launch profiles depend on the vehicle and mission.</p><div className="action-row">{!a.separatedAt && <Button onClick={() => dispatch({ type: 'SEPARATE_FIRST_STAGE' })} disabled={since < 20}>Separate first stage</Button>}{a.separatedAt && !a.fairingSeparated && <Button onClick={() => dispatch({ type: 'SEPARATE_FAIRING' })} disabled={since < 75}>Separate payload fairing</Button>}{a.fairingSeparated && !a.payloadSeparated && <Button onClick={() => dispatch({ type: 'SEPARATE_PAYLOAD' })} disabled={since < 110}>Separate lander into transit</Button>}</div>{a.feedback && <p className="feedback" role="status">{a.feedback}</p>}</section>;
}

function Transit({ state, dispatch }) {
  const [tab, setTab] = useState('monitoring');
  const transit = state.transit; const elapsed = state.elapsed - transit.startedAt;
  return <section className="game-panel phase-panel transit-phase"><span className="eyebrow">SCHEMATIC TRANSIT · NO TRAJECTORY MODEL</span><h2>Monitor the lunar spacecraft</h2><div className="tab-row"><Button className={tab === 'monitoring' ? 'selected' : ''} onClick={() => setTab('monitoring')}>Vehicle monitoring</Button><Button className={tab === 'communications' ? 'selected' : ''} onClick={() => setTab('communications')}>Communications</Button></div>{tab === 'monitoring' ? <div className="transit-monitor"><div className="earth-moon"><span>EARTH</span><i style={{ left: `${Math.min(85, 8 + elapsed / 180 * 77)}%` }}>◈</i><b>MOON</b></div><div className="transit-data"><div><small>TRANSIT ELAPSED</small><b>{Math.floor(elapsed)} / 180 s</b></div><div><small>MISSION LINK</small><b>SIMULATED · NOMINAL</b></div><div><small>QUESTIONS REVIEWED</small><b>{transit.questions.filter((q) => q.status === 'answered').length} / {RADIO_QUESTIONS.length}</b></div></div><p>Distance and vehicle position are illustrative. This view does not solve an orbit or communications link budget.</p></div> : <div className="comms-list">{RADIO_QUESTIONS.map((item) => { const q = transit.questions.find((x) => x.id === item.id); return <article key={item.id} className={`comms-question ${q.status}`}><span className="eyebrow">{q.status === 'scheduled' ? `MESSAGE AT +${item.due} S` : q.status.toUpperCase()}</span><h3>{item.question}</h3>{q.status === 'pending' ? <><div className="answer-list">{item.choices.map((choice, i) => <label key={choice}><input type="radio" name={item.id} checked={q.answer === i} onChange={() => dispatch({ type: 'SET_ANSWER', questionId: item.id, answer: i })} />{choice}</label>)}</div><Button onClick={() => dispatch({ type: 'ANSWER_QUESTION', questionId: item.id })} disabled={q.answer === null}>Submit answer</Button></> : q.status === 'answered' || q.status === 'missed' ? <p>{q.feedback}</p> : <p>Waiting for this message. The mission clock continues while you use the monitoring view.</p>}</article>; })}</div>}</section>;
}

function Landing({ state, dispatch }) {
  const landing = state.landing; const since = landing.descentStartedAt === null ? 0 : state.elapsed - landing.descentStartedAt;
  const zones = [{ id: 'A', label: 'Rough ground · training cue' }, { id: 'B', label: 'Clear patch · training cue' }, { id: 'C', label: 'Slope · training cue' }];
  return <section className="game-panel phase-panel landing-phase"><span className="eyebrow">SIMPLIFIED POWERED DESCENT · TRAINING CUES ONLY</span><h2>Choose a landing zone</h2><p>Zone labels are fictional game cues. They are not terrain-hazard classifications or engineering safety advice.</p><div className="landing-grid">{zones.map((z) => <button type="button" key={z.id} className={`zone-card zone-${z.id} ${landing.zone === z.id ? 'selected' : ''}`} onClick={() => dispatch({ type: 'SELECT_LANDING_ZONE', zone: z.id })} disabled={landing.descentStartedAt !== null}><b>ZONE {z.id}</b><span>{z.label}</span></button>)}</div>{landing.descentStartedAt === null ? <Button className="primary-action" disabled={!landing.zone} onClick={() => dispatch({ type: 'BEGIN_DESCENT' })}>Begin powered descent</Button> : <><div className="descent-meter"><div><span>DESCENT SEQUENCE</span><b>{Math.min(100, Math.floor(since / 90 * 100))}%</b></div><progress max="90" value={Math.min(90, since)} /></div><div className="action-row">{!landing.thrustAdjusted && <Button onClick={() => dispatch({ type: 'ADJUST_THRUST' })} disabled={since < 20}>Adjust descent thrust</Button>}{landing.thrustAdjusted && !landing.alignmentComplete && <Button onClick={() => dispatch({ type: 'ALIGN_LANDER' })} disabled={since < 48}>Align over zone {landing.zone}</Button>}{landing.alignmentComplete && !landing.touchdown && <Button onClick={() => dispatch({ type: 'CONFIRM_TOUCHDOWN' })} disabled={since < 90}>Confirm touchdown</Button>}</div></>}{landing.feedback && <p className="feedback" role="status">{landing.feedback}</p>}</section>;
}

function LunarOperations({ state, dispatch, site, conditions, simTime }) {
  const [camera, setCamera] = useState({ yaw: 0, pitch: 0 });
  const ops = state.lunarOps; const surveyElapsed = ops.surveyStartedAt === null ? 0 : state.elapsed - ops.surveyStartedAt;
  return <section className="game-panel phase-panel lunar-phase"><span className="eyebrow">SURFACE MISSION · EXISTING SITE DATA</span><h2>First rover survey at {site.name}</h2><p className="science-caveat">Sun and Earth visibility below use Stargazer’s existing lunar ephemeris and terrain-horizon data at the selected coordinates and simulated UTC. The selected operating window advances across the 75-second survey for gameplay. Visibility does not establish usable power or communications performance. Launch windows and weather remain scenario-only.</p>
    <div className="lunar-scene-frame"><Suspense fallback={<div className="scene-loading">Preparing lunar horizon…</div>}><LunarScene3D time={simTime} windowStart={SCENARIO_START} selectedSite={site} showSolarFlux showDTELink showGrid showHorizonMask useTerrain cameraYaw={camera.yaw} cameraPitch={camera.pitch} viewMode="surface" viewResetCount={0} invertLook={false} onLookDrag={(dx, dy) => setCamera((current) => ({ yaw: current.yaw + dx, pitch: Math.max(-80, Math.min(80, current.pitch + dy)) }))} onCameraInfo={() => {}} cameraInfo={null} showInterface={false} /></Suspense><span className="scene-caption">Terrain skyline uses the existing horizon mask; nearby ground is illustrative. Drag to look around.</span></div>
    <div className="science-grid"><article><span className="eyebrow sun-color">SUN · GEOMETRIC VISIBILITY</span><b>{conditions.sunVisible ? 'ABOVE LOCAL HORIZON' : 'BELOW LOCAL HORIZON'}</b><small>{conditions.sun.elevation.toFixed(2)}° elevation · {conditions.sun.azimuth.toFixed(1)}° azimuth</small><small>{conditions.sunClearance.toFixed(2)}° clearance from terrain mask</small></article><article><span className="eyebrow earth-color">EARTH · GEOMETRIC VISIBILITY</span><b>{conditions.earthVisible ? 'ABOVE LOCAL HORIZON' : 'BELOW LOCAL HORIZON'}</b><small>{conditions.earth.elevation.toFixed(2)}° elevation · {conditions.earth.azimuth.toFixed(1)}° azimuth</small><small>{conditions.earthClearance.toFixed(2)}° clearance from terrain mask</small></article></div><small className="sim-time">SIMULATED SITE TIME · {simTime.toISOString().replace('T', ' ').slice(0, 19)} UTC</small>
    {!ops.roverDeployed && <Button className="primary-action" onClick={() => dispatch({ type: 'DEPLOY_ROVER' })}>Deploy rover</Button>}{ops.roverDeployed && ops.surveyStartedAt === null && <Button className="primary-action" onClick={() => dispatch({ type: 'START_SURVEY' })}>Start 75-second survey</Button>}{ops.surveyStartedAt !== null && !ops.surveyComplete && <><div className="descent-meter"><div><span>ROVER SURVEY</span><b>{Math.min(100, Math.floor(surveyElapsed / SURVEY_DURATION_SECONDS * 100))}%</b></div><progress max="100" value={Math.min(100, surveyElapsed / SURVEY_DURATION_SECONDS * 100)} /></div><Button className="primary-action" disabled={surveyElapsed < SURVEY_DURATION_SECONDS} onClick={() => dispatch({ type: 'COMPLETE_SURVEY', sunVisible: conditions.sunVisible, earthVisible: conditions.earthVisible })}>Complete survey and review</Button></>}{ops.surveyComplete && <div className="mission-complete"><span className="eyebrow">MISSION 001 COMPLETE</span><h3>Robotic lander reached the surface and completed its first survey.</h3><p>Sun: {ops.surveyResult?.sunVisible ? 'above' : 'below'} the local terrain horizon. Earth: {ops.surveyResult?.earthVisible ? 'above' : 'below'} the local terrain horizon.</p><Button onClick={() => dispatch({ type: 'RESTART' })}>Play mission again</Button></div>}</section>;
}

function GamePage() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [showGuide, setShowGuide] = useState(false);
  const lastTickRef = useRef(null);
  useEffect(() => {
    if (state.paused || state.phase === 'no-launch') { lastTickRef.current = null; return undefined; }
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(); const previous = lastTickRef.current ?? now; lastTickRef.current = now;
      dispatch({ type: 'TICK', delta: ((now - previous) / 1000) * GAME_SPEEDS[state.speed], siteName: landingSites.find((s) => s.id === state.siteId)?.name });
    }, 100);
    return () => { window.clearInterval(timer); lastTickRef.current = null; };
  }, [state.paused, state.phase, state.speed, state.siteId]);
  const site = landingSites.find((item) => item.id === state.siteId) || landingSites[0];
  const simTime = useMemo(() => {
    const target = state.missionPlan?.selectedWindow;
    if (state.phase === 'lunar-operations' && target) {
      const startMs = Date.parse(target.startTime);
      const durationMs = Date.parse(target.endTime) - startMs;
      const progress = state.lunarOps.surveyStartedAt === null ? 0 : Math.min(0.999, Math.max(0, (state.elapsed - state.lunarOps.surveyStartedAt) / SURVEY_DURATION_SECONDS));
      return new Date(startMs + durationMs * progress);
    }
    return new Date(SCENARIO_START.getTime() + state.elapsed * 1000);
  }, [state.elapsed, state.phase, state.lunarOps.surveyStartedAt, state.missionPlan]);
  const conditions = useMemo(() => {
    const sun = calculateSunPosition(simTime, site.latitude, site.longitude); const earth = calculateEarthPosition(simTime, site.latitude, site.longitude);
    const sunClearance = clearanceOf(sun, site.latitude, site.longitude); const earthClearance = clearanceOf(earth, site.latitude, site.longitude);
    return { sun, earth, sunClearance, earthClearance, sunVisible: sunClearance > 0, earthVisible: earthClearance > 0 };
  }, [simTime, site]);
  const info = phaseInfo[state.phase] || phaseInfo.assembly;
  if (state.phase === 'planning') {
    return <MissionPlanning onCommit={(plan) => { dispatch({ type: 'COMMIT_MISSION_PLAN', plan }); setShowGuide(true); }} />;
  }
  const openGuide = () => { if (!state.paused && !state.briefingOpen) dispatch({ type: 'TOGGLE_PAUSE' }); setShowGuide(true); };
  const closeGuide = () => { setShowGuide(false); if (state.briefingOpen) dispatch({ type: 'BEGIN_BRIEFING' }); };
  return <main className="game-page lunar-game">
    {showGuide && <GameGuide onClose={closeGuide} />}
    <header className="mission-topbar"><a className="mission-brand" href="/"><img src="/favicon.svg" alt="" /><div><span>STARGAZER · LUNAR MISSION SIMULATOR</span><h1>MISSION 001 <i>GET A ROBOTIC LANDER TO THE MOON</i></h1></div></a><div className="clock-console"><div><small>MISSION ELAPSED TIME</small><strong>{clock(state.elapsed)}</strong></div><div className="clock-controls"><Button onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })} disabled={state.phase === 'no-launch'}>{state.paused ? 'Resume clock' : 'Pause clock'}</Button><label>Speed<select value={state.speed} onChange={(event) => dispatch({ type: 'SET_SPEED', speed: event.target.value })}><option value="slow">Slow</option><option value="normal">Normal</option></select></label><Button onClick={openGuide}>Mission guide</Button></div></div></header>
    {['assembly', 'assembly-complete', 'launchpad', 'countdown'].includes(state.phase) && <MissionTimeline state={state} dispatch={dispatch} />}
    <div className="phase-heading"><div><span className="eyebrow">{info[0]}</span><h2>{info[1]}</h2><p>{info[2]}</p></div>{state.missionPlan ? <div className="mission-target"><span>PLANNED SURFACE OPPORTUNITY · NOT A LAUNCH WINDOW</span><b>{state.missionPlan.siteName}</b><small>{state.missionPlan.selectedWindow.startTime.slice(0, 16).replace('T', ' ')} UTC → {state.missionPlan.selectedWindow.endTime.slice(0, 16).replace('T', ' ')} UTC</small>{['assembly', 'launchpad', 'countdown'].includes(state.phase) && <small>PREPARATION DEADLINE {clock(state.missionPlan.preparationDeadlineSeconds)} · REMAINING {clock(Math.max(0, state.missionPlan.preparationDeadlineSeconds - state.elapsed)).replace('T+', '')}</small>}</div> : <label className="site-picker">DESTINATION<select value={site.id} onChange={(e) => dispatch({ type: 'SELECT_SITE', siteId: e.target.value, siteName: landingSites.find((s) => s.id === e.target.value)?.name })} disabled={!['assembly', 'assembly-complete', 'launchpad'].includes(state.phase)}>{landingSites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
    {state.phase === 'assembly' || state.phase === 'assembly-complete' ? <Assembly state={state} dispatch={dispatch} /> : state.phase === 'launchpad' ? <LaunchPad state={state} dispatch={dispatch} /> : state.phase === 'countdown' ? <Countdown state={state} dispatch={dispatch} /> : state.phase === 'ascent' ? <Ascent state={state} dispatch={dispatch} /> : state.phase === 'transit' ? <Transit state={state} dispatch={dispatch} /> : state.phase === 'landing' ? <Landing state={state} dispatch={dispatch} /> : state.phase === 'lunar-operations' ? <LunarOperations state={state} dispatch={dispatch} site={site} conditions={conditions} simTime={simTime} /> : <section className="game-panel phase-panel no-launch-phase"><span className="eyebrow">MISSION SCHEDULE</span><h2>Preparation period ended</h2><p>The planned schedule reached its simplified preparation deadline before a launch. Return to planning to compare another recorded surface opportunity. This deadline is game scheduling only, not a real rocket launch time.</p><Button onClick={() => { dispatch({ type: 'RESTART' }); setShowGuide(false); }}>Return to planning</Button></section>}
  </main>;
}

export default GamePage;
