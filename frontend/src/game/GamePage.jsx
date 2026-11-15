import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import landingSites from '../data/landingSites.json';
import { calculateEarthPosition, calculateSunPosition, clearanceOf } from '../utils/ephemerisRuntime';
import { PROPELLANT_LOAD_SECONDS, SCENARIO_START, SURVEY_DURATION_SECONDS, createInitialState, getLaunchReadiness, reducer } from './gameEngine';
import DebugMenu from './DebugMenu';
import { DEBUG_ENABLED, useKonamiCode } from './debugMode';
import GameGuide from './GameGuide';
import MissionHeader, { StageProgress } from './MissionHeader';
import MissionPlanning from './MissionPlanning';
import { Ascent, Assembly, AssemblyHotspots, Button, Countdown, Landing, Transit } from './StagePanels';
import './game.css';

const LunarScene3D = lazy(() => import('../components/LunarScene3D'));
const MissionScene3D = lazy(() => import('./MissionScene3D'));

const ASSEMBLY_UI = { selected: null, hoverPart: null, focusPart: null, focusSlot: null, dragging: false, note: '' };
const ASSEMBLY_NOTES = {
  'no-part': 'Pick up a part first: click or drag one from the rack on the left.',
  outside: 'That is not on the vehicle. Drop the part on one of the outlined spaces.',
};

const phaseInfo = {
  assembly: ['STAGE 1 · ASSEMBLY', 'Build the launch stack', 'Drag each part from the rack onto the vehicle, or click a part and then click where it goes.'],
  'assembly-complete': ['STAGE 1 · ASSEMBLY', 'Vehicle assembled', 'Review the stack, then move to pad preparation.'],
  launchpad: ['STAGE 2 · LAUNCH PREPARATION', 'Prepare for launch', 'Complete the pad procedure and get all three lights green before the preparation deadline.'],
  countdown: ['STAGE 2 · LAUNCH PREPARATION · COUNTDOWN', 'Terminal countdown', 'Hold the launch command until the T−0 cue.'],
  ascent: ['STAGE 3 · ASCENT', 'Manage ascent and staging', 'Separate spent stages at the cues, then release the lander.'],
  transit: ['STAGE 4 · TRANSIT', 'Monitor the lunar transit', 'Switch between vehicle monitoring and Communications as the mission clock continues.'],
  landing: ['STAGE 5 · LUNAR LANDING', 'Guide the powered descent', 'Choose a training zone, manage thrust, and confirm touchdown.'],
  'lunar-operations': ['STAGE 6 · LUNAR OPERATIONS', 'Complete the first rover survey', 'Review local illumination and Earth visibility using the site’s existing lunar data.'],
  'no-launch': ['PREPARATION DEADLINE', 'The planned schedule expired', 'The vehicle was not ready before the game-clock preparation deadline. Return to planning and choose an opportunity that leaves more preparation time.'],
};

function LaunchPad({ state, dispatch }) {
  const [dropActive, setDropActive] = useState(false);
  const [dropMessage, setDropMessage] = useState('');
  const readiness = getLaunchReadiness(state);
  const weather = readiness.weather;
  const statuses = readiness.go.map((go, index) => ({ name: ['VEHICLE', 'SPACECRAFT', 'SITE / WEATHER'][index], go }));
  function makeEquipmentDraggable(event, action) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', action);
  }
  function dropEquipment(event) {
    event.preventDefault();
    setDropActive(false);
    const action = event.dataTransfer.getData('text/plain');
    const actions = {
      'platform-extend': ['EXTEND_PLATFORM', 'Access platform moved into position on the launch monitor.'],
      'platform-retract': ['RETRACT_PLATFORM', 'Access platform cleared the vehicle on the launch monitor.'],
      'fuel-connect': ['TOGGLE_PROPELLANT_LINE', 'Fuel umbilical moved to the vehicle.'],
      'oxidizer-connect': ['TOGGLE_PROPELLANT_LINE', 'Oxidiser umbilical moved to the vehicle.'],
    };
    const mapped = actions[action];
    if (!mapped) return;
    dispatch(action === 'fuel-connect' ? { type: mapped[0], line: 'fuel' } : action === 'oxidizer-connect' ? { type: mapped[0], line: 'oxidizer' } : { type: mapped[0] });
    setDropMessage(mapped[1]);
  }
  return <section className="game-panel phase-panel pad-phase">
    <div className="pad-checklist"><span className="eyebrow">PAD PROCEDURE</span>
        <div className="procedure-row"><b>01</b><span>Extend vehicle access platform</span><Button draggable={!state.pad.platformExtended && !state.pad.platformRetracted} onDragStart={(event) => makeEquipmentDraggable(event, 'platform-extend')} onClick={() => dispatch({ type: 'EXTEND_PLATFORM' })} disabled={state.pad.platformExtended || state.pad.platformRetracted}>{state.pad.platformExtended ? 'EXTENDED' : 'Extend · drag'}</Button></div>
        <div className="procedure-row"><b>02</b><span>Connect fuel and oxidiser lines</span><div className="inline-actions"><Button draggable={state.pad.platformExtended && state.pad.propellantStartedAt === null} onDragStart={(event) => makeEquipmentDraggable(event, 'fuel-connect')} onClick={() => dispatch({ type: 'TOGGLE_PROPELLANT_LINE', line: 'fuel' })} disabled={!state.pad.platformExtended || state.pad.propellantStartedAt !== null}>{state.pad.fuelConnected ? 'Fuel ✓' : 'Fuel · drag'}</Button><Button draggable={state.pad.platformExtended && state.pad.propellantStartedAt === null} onDragStart={(event) => makeEquipmentDraggable(event, 'oxidizer-connect')} onClick={() => dispatch({ type: 'TOGGLE_PROPELLANT_LINE', line: 'oxidizer' })} disabled={!state.pad.platformExtended || state.pad.propellantStartedAt !== null}>{state.pad.oxidizerConnected ? 'Oxidiser ✓' : 'Oxidiser · drag'}</Button></div></div>
        <div className="procedure-row"><b>03</b><span>Load propellant · {state.pad.propellantLoaded ? 'complete' : state.pad.propellantStartedAt !== null ? 'in progress' : 'ready'}</span><Button onClick={() => dispatch({ type: 'START_PROPELLANT_LOADING' })} disabled={!state.pad.platformExtended || !state.pad.fuelConnected || !state.pad.oxidizerConnected || state.pad.propellantStartedAt !== null}>{state.pad.propellantLoaded ? 'Loaded' : state.pad.propellantStartedAt !== null ? 'Loading…' : 'Start load'}</Button></div>
        <div className="procedure-row"><b>04</b><span>Complete vehicle and spacecraft checks</span><div className="inline-actions"><Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'vehicle' })} disabled={state.pad.checks.vehicle}>{state.pad.checks.vehicle ? 'Vehicle ✓' : 'Vehicle check'}</Button><Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'spacecraft' })} disabled={state.pad.checks.spacecraft}>{state.pad.checks.spacecraft ? 'Spacecraft ✓' : 'Spacecraft check'}</Button></div></div>
        <div className="procedure-row"><b>05</b><span>Retract access platform</span><Button draggable={state.pad.platformExtended && state.pad.propellantLoaded && state.pad.checks.vehicle && state.pad.checks.spacecraft} onDragStart={(event) => makeEquipmentDraggable(event, 'platform-retract')} onClick={() => dispatch({ type: 'RETRACT_PLATFORM' })} disabled={state.pad.platformRetracted}>{state.pad.platformRetracted ? 'Clear ✓' : 'Retract · drag'}</Button></div>
        <div className="procedure-row"><b>06</b><span>Switch spacecraft to onboard power</span><Button onClick={() => dispatch({ type: 'SWITCH_ONBOARD_POWER' })} disabled={state.pad.onboardPower}>{state.pad.onboardPower ? 'Onboard ✓' : 'Switch power'}</Button></div>
    </div>
    <div className="pad-centre">
      <div data-scene-window className={`pad-monitor-dropzone ${dropActive ? 'ready' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={dropEquipment}><p className="dropzone-caption"><span>MAIN LAUNCH MONITOR</span>{dropMessage || 'Click the steps on the left, or drag a “drag” button onto this monitor.'}</p></div>
      {state.pad.propellantStartedAt !== null && !state.pad.propellantLoaded && <div className="progress-wrap"><div><span>SIMULATED LOADING</span><b>{Math.min(100, Math.floor((state.elapsed - state.pad.propellantStartedAt) / PROPELLANT_LOAD_SECONDS * 100))}%</b></div><progress max="100" value={Math.min(100, (state.elapsed - state.pad.propellantStartedAt) / PROPELLANT_LOAD_SECONDS * 100)} /></div>}
      <p className="stage-caveat">These are simplified training procedures. Scenario weather is deterministic game data, not a live forecast.</p>
    </div>
    <div className="window-review"><span className="eyebrow">RANGE WEATHER · FIXED SCENARIO DATA</span><h3>Inspect the weather</h3><p>One training condition on the mission clock: upper-level winds start above limits and ease {Math.ceil(weather.remaining) > 0 ? `in about ${Math.ceil(weather.remaining)} mission seconds` : 'early in pad preparation'}. It is not a forecast.</p>
        <div className="weather-meter"><span>UPPER-LEVEL WIND</span><b>{weather.clear ? 'WITHIN LIMITS · SUITABLE' : `ABOVE LIMITS · EASES IN ${Math.ceil(weather.remaining)} S`}</b><i className={weather.clear ? '' : 'caution'} /></div>
        <div className="inline-actions weather-choice"><Button onClick={() => dispatch({ type: 'ASSESS_WEATHER' })} disabled={state.pad.weatherAssessed}>{state.pad.weatherAssessed ? 'Weather inspected ✓' : 'Inspect weather'}</Button><Button onClick={() => dispatch({ type: 'CHECK_PAD_ITEM', key: 'site' })} disabled={state.pad.checks.site}>{state.pad.checks.site ? 'Launch site ✓' : 'Complete launch-site check'}</Button></div>
        <div className="go-lights">{statuses.map((item) => <div key={item.name}><i className={item.go ? 'on' : ''} /><b>{item.name}</b><span>{item.go ? 'GO' : 'WAIT'}</span></div>)}</div>
        {state.pad.feedback && <p className="feedback" role="status">{state.pad.feedback}</p>}
        <Button className="primary-action" disabled={!readiness.canLaunch} onClick={() => dispatch({ type: 'START_COUNTDOWN' })}>{readiness.allGo ? 'Begin terminal countdown' : 'Get all three lights green to continue'}</Button>
    </div>
  </section>;
}

function LunarOperations({ state, dispatch, site, conditions, simTime }) {
  const [camera, setCamera] = useState({ yaw: 0, pitch: 0 });
  const ops = state.lunarOps; const surveyElapsed = ops.surveyStartedAt === null ? 0 : state.elapsed - ops.surveyStartedAt;
  return <section className="game-panel phase-panel lunar-phase"><span className="eyebrow">SURFACE MISSION · EXISTING SITE DATA</span><h2>First rover survey at {site.name}</h2><p className="science-caveat">Sun and Earth visibility below use Stargazer’s existing lunar ephemeris and terrain-horizon data at the selected coordinates and simulated UTC. The selected operating window advances across the 75-second survey for gameplay. Visibility does not establish usable power or communications performance. Launch timing and weather remain scenario-only.</p>
    <div className="lunar-scene-frame"><Suspense fallback={<div className="scene-loading">Preparing lunar horizon…</div>}><LunarScene3D time={simTime} windowStart={SCENARIO_START} selectedSite={site} showSolarFlux showDTELink showGrid showHorizonMask useTerrain cameraYaw={camera.yaw} cameraPitch={camera.pitch} viewMode="surface" viewResetCount={0} invertLook={false} onLookDrag={(dx, dy) => setCamera((current) => ({ yaw: current.yaw + dx, pitch: Math.max(-80, Math.min(80, current.pitch + dy)) }))} onCameraInfo={() => {}} cameraInfo={null} showInterface={false} /></Suspense><span className="scene-caption">Terrain skyline uses the existing horizon mask; nearby ground is illustrative. Drag to look around.</span></div>
    <div className="science-grid"><article><span className="eyebrow sun-color">SUN · GEOMETRIC VISIBILITY</span><b>{conditions.sunVisible ? 'ABOVE LOCAL HORIZON' : 'BELOW LOCAL HORIZON'}</b><small>{conditions.sun.elevation.toFixed(2)}° elevation · {conditions.sun.azimuth.toFixed(1)}° azimuth</small><small>{conditions.sunClearance.toFixed(2)}° clearance from terrain mask</small></article><article><span className="eyebrow earth-color">EARTH · GEOMETRIC VISIBILITY</span><b>{conditions.earthVisible ? 'ABOVE LOCAL HORIZON' : 'BELOW LOCAL HORIZON'}</b><small>{conditions.earth.elevation.toFixed(2)}° elevation · {conditions.earth.azimuth.toFixed(1)}° azimuth</small><small>{conditions.earthClearance.toFixed(2)}° clearance from terrain mask</small></article></div><small className="sim-time">SIMULATED SITE TIME · {simTime.toISOString().replace('T', ' ').slice(0, 19)} UTC</small>
    {!ops.roverDeployed && <Button className="primary-action" onClick={() => dispatch({ type: 'DEPLOY_ROVER' })}>Deploy rover</Button>}{ops.roverDeployed && ops.surveyStartedAt === null && <Button className="primary-action" onClick={() => dispatch({ type: 'START_SURVEY' })}>Start 75-second survey</Button>}{ops.surveyStartedAt !== null && !ops.surveyComplete && <><div className="descent-meter"><div><span>ROVER SURVEY</span><b>{Math.min(100, Math.floor(surveyElapsed / SURVEY_DURATION_SECONDS * 100))}%</b></div><progress max="100" value={Math.min(100, surveyElapsed / SURVEY_DURATION_SECONDS * 100)} /></div><Button className="primary-action" disabled={surveyElapsed < SURVEY_DURATION_SECONDS} onClick={() => dispatch({ type: 'COMPLETE_SURVEY', sunVisible: conditions.sunVisible, earthVisible: conditions.earthVisible })}>Complete survey and review</Button></>}{ops.surveyComplete && <div className="mission-complete"><span className="eyebrow">MISSION 001 COMPLETE</span><h3>Robotic lander reached the surface and completed its first survey.</h3><p>Sun: {ops.surveyResult?.sunVisible ? 'above' : 'below'} the local terrain horizon. Earth: {ops.surveyResult?.earthVisible ? 'above' : 'below'} the local terrain horizon.</p><Button onClick={() => dispatch({ type: 'RESTART' })}>Play mission again</Button></div>}</section>;
}

function GamePage() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [showGuide, setShowGuide] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [planningRun, setPlanningRun] = useState(0);
  useKonamiCode(useCallback(() => setShowDebug(true), []));
  const closeDebug = useCallback(() => setShowDebug(false), []);
  // Assembly-only interface state shared by the 3D scene, the keyboard hotspots and the panel.
  const [assemblyUi, setAssemblyUi] = useState(ASSEMBLY_UI);
  const [assemblyLayout, setAssemblyLayout] = useState(null);
  const assemblyActions = useMemo(() => ({
    select: (partId) => { setAssemblyUi((ui) => ({ ...ui, selected: partId, note: '' })); dispatch({ type: 'SELECT_PART', partId }); },
    drag: (partId) => { setAssemblyUi((ui) => ({ ...ui, dragging: true })); dispatch({ type: 'DRAG_PART', partId }); },
    install: (partId, slotId) => { setAssemblyUi((ui) => ({ ...ui, dragging: false, note: '' })); dispatch({ type: 'INSTALL_PART', partId, slotId }); },
    miss: (reason) => setAssemblyUi((ui) => ({ ...ui, dragging: false, note: ASSEMBLY_NOTES[reason] || '' })),
    hover: (partId) => setAssemblyUi((ui) => (ui.hoverPart === partId ? ui : { ...ui, hoverPart: partId })),
    focus: (key, value) => setAssemblyUi((ui) => (ui[key] === value ? ui : { ...ui, [key]: value })),
  }), []);
  const onAssemblyLayout = useCallback((layout) => setAssemblyLayout(layout), []);
  const lastTickRef = useRef(null);
  useEffect(() => {
    if (state.paused || state.phase === 'no-launch') { lastTickRef.current = null; return undefined; }
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(); const previous = lastTickRef.current ?? now; lastTickRef.current = now;
      dispatch({ type: 'TICK', delta: ((now - previous) / 1000) * state.speed, siteName: landingSites.find((s) => s.id === state.siteId)?.name });
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
  const usesMissionScene = ['assembly', 'assembly-complete', 'launchpad', 'countdown', 'ascent', 'transit', 'landing'].includes(state.phase);
  const transitElapsed = state.transit ? state.elapsed - state.transit.startedAt : 0;
  const info = phaseInfo[state.phase] || phaseInfo.assembly;
  const resetLocalUi = () => { setAssemblyUi(ASSEMBLY_UI); setShowGuide(false); setShowDebug(false); setPlanningRun((run) => run + 1); };
  const debugMenu = DEBUG_ENABLED && showDebug ? <DebugMenu state={state} onClose={closeDebug} onJump={(stage) => { dispatch({ type: 'DEBUG_JUMP', stage, siteName: site.name }); resetLocalUi(); }} onRestart={() => { dispatch({ type: 'RESTART' }); resetLocalUi(); }} /> : null;
  if (state.phase === 'planning') {
    return <><MissionPlanning key={planningRun} onCommit={(plan) => { dispatch({ type: 'COMMIT_MISSION_PLAN', plan }); setAssemblyUi(ASSEMBLY_UI); setShowGuide(true); }} />{debugMenu}</>;
  }
  const openGuide = () => { if (!state.paused && !state.briefingOpen) dispatch({ type: 'TOGGLE_PAUSE' }); setShowGuide(true); };
  const closeGuide = () => { setShowGuide(false); if (state.briefingOpen) dispatch({ type: 'BEGIN_BRIEFING' }); };
  return <main className={`game-page lunar-game game-phase-${state.phase}`}>
    {showGuide && <GameGuide onClose={closeGuide} />}
    {debugMenu}
    {usesMissionScene && <Suspense fallback={<div className="mission-scene-background scene-loading" aria-hidden="true" />}><MissionScene3D phase={state.phase} elapsed={state.elapsed} installedParts={state.installedParts} pad={state.pad} ascent={state.ascent} landing={state.landing} transitElapsed={transitElapsed} assembly={assemblyUi} onInstall={assemblyActions.install} onSelectPart={assemblyActions.select} onHoverPart={assemblyActions.hover} onDragPart={assemblyActions.drag} onMiss={assemblyActions.miss} onLayout={onAssemblyLayout} /></Suspense>}
    <MissionHeader state={state} onTogglePause={() => dispatch({ type: 'TOGGLE_PAUSE' })} onSpeed={(speed) => dispatch({ type: 'SET_SPEED', speed })} onGuide={openGuide} />
    <StageProgress phase={state.phase} />
    <div className="phase-heading"><div><span className="eyebrow">{info[0]}</span><h2>{info[1]}</h2><p>{info[2]}</p></div></div>
    {usesMissionScene && <AssemblyHotspots state={state} ui={assemblyUi} layout={assemblyLayout} actions={assemblyActions} />}
    {state.phase === 'assembly' || state.phase === 'assembly-complete' ? <Assembly state={state} dispatch={dispatch} ui={assemblyUi} /> : state.phase === 'launchpad' ? <LaunchPad state={state} dispatch={dispatch} /> : state.phase === 'countdown' ? <Countdown state={state} dispatch={dispatch} siteName={site.name} /> : state.phase === 'ascent' ? <Ascent state={state} dispatch={dispatch} /> : state.phase === 'transit' ? <Transit state={state} dispatch={dispatch} /> : state.phase === 'landing' ? <Landing state={state} dispatch={dispatch} /> : state.phase === 'lunar-operations' ? <LunarOperations state={state} dispatch={dispatch} site={site} conditions={conditions} simTime={simTime} /> : <section className="game-panel phase-panel no-launch-phase"><span className="eyebrow">MISSION SCHEDULE</span><h2>Preparation period ended</h2><p>The planned schedule reached its simplified preparation deadline before a launch. Return to planning to compare another recorded surface opportunity. This deadline is game scheduling only, not a real rocket launch time.</p><Button onClick={() => { dispatch({ type: 'RESTART' }); setShowGuide(false); setPlanningRun((run) => run + 1); }}>Return to planning</Button></section>}
  </main>;
}

export default GamePage;
