import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import landingSites from '../data/landingSites.json';
import { calculateEarthPosition, calculateSunPosition, clearanceOf } from '../utils/ephemerisRuntime';
import { createInitialGameState, gameReducer, getActiveWindow, getDepartmentStatuses, getReadiness, SCENARIO_START, WINDOW_MAP } from './gameEngine';
import DepartmentPanel from './DepartmentPanel';
import GameGuide from './GameGuide';
import MissionJourney from './MissionJourney';
import MissionTimeline from './MissionTimeline';
import './game.css';

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return `T+${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function MissionControl({ state, site, conditions, dispatch, readiness, statuses }) {
  const activeWindow = getActiveWindow(state);
  const selectedWindow = WINDOW_MAP[state.selectedWindowId];
  const windowForSummary = activeWindow || selectedWindow;
  const outstanding = readiness.mandatory.filter(([, complete]) => !complete).map(([name]) => name);
  const assessment = windowForSummary && state.weatherAssessments[windowForSummary.id];
  const scenarioNoGo = activeWindow?.weatherDecision === 'noGo';
  const missionStatus = state.phase === 'journey'
    ? 'Mission in flight'
    : state.phase === 'debrief'
      ? `Mission ${state.outcome.result}`
      : state.phase === 'no-launch'
        ? 'Launch period ended'
        : readiness.launchAllowed
          ? 'Ready to launch'
          : activeWindow
            ? 'Window active · preparation incomplete'
            : 'Preparing for launch';

  return (
    <aside className="mission-sidebar">
      <section className="game-panel sidebar-panel">
        <div className="sidebar-heading"><span className="panel-step">MISSION STATUS</span><b className={`status-pill ${readiness.launchAllowed ? 'ready' : activeWindow ? 'warning' : ''}`}>{missionStatus}</b></div>
        <label className="field-label" htmlFor="destination-site">Lunar destination</label>
        <select id="destination-site" value={site.id} onChange={(event) => dispatch({ type: 'SELECT_SITE', siteId: event.target.value, siteName: landingSites.find((item) => item.id === event.target.value)?.name })} disabled={state.phase !== 'preparation' || Boolean(state.usedWindowId)}>
          {landingSites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <small className="site-coordinates">{site.latitude.toFixed(4)}° · {site.longitude.toFixed(4)}° E</small>
        <div className="science-readout">
          <div className="sun-data"><span>Sun visibility</span><b>{conditions.sunVisible ? 'ABOVE HORIZON' : 'BELOW HORIZON'}</b><small>{conditions.sun.elevation.toFixed(2)}° elevation · {conditions.sun.azimuth.toFixed(1)}° azimuth</small></div>
          <div className="earth-data"><span>Earth visibility</span><b>{conditions.earthVisible ? 'ABOVE HORIZON' : 'BELOW HORIZON'}</b><small>{conditions.earth.elevation.toFixed(2)}° elevation · {conditions.earth.azimuth.toFixed(1)}° azimuth</small></div>
        </div>
        <p className="scientific-caveat">Geometric visibility only. It is not a power model, link budget, or launch-window calculation.</p>
      </section>

      <section className="game-panel sidebar-panel readiness-panel">
        <div className="sidebar-heading"><div><span className="panel-step">PRE-LAUNCH REVIEW</span><h2>Mission readiness</h2></div><b>{readiness.mandatory.filter(([, done]) => done).length}/{readiness.mandatory.length} mandatory</b></div>
        <ul className="readiness-list">
          {Object.entries(statuses).filter(([key]) => key !== 'weatherCanLaunch').map(([key, value]) => <li key={key}><span>{({ engineering: 'Engineering', launchOps: 'Launch operations', weather: 'Weather', communications: 'Communications' })[key]}</span><b className={`readiness-state ${value === 'ready' || value.includes('assessed') ? 'ok' : value.includes('NO-GO') || value.includes('attention') ? 'warning' : ''}`}>{value}</b></li>)}
        </ul>
        <div className="optional-readiness">Optional outcome checks <b>{readiness.optionalCount}/3</b><small>Each completed optional check reduces the scenario risk index by one.</small></div>
        <div className="launch-summary">
          <h3>Launch summary</h3>
          <p><span>Spacecraft</span><b>{state.engineering.faultResolved ? 'Sensor fault resolved' : 'Fault unresolved'}</b></p>
          <p><span>Launch vehicle</span><b>{state.launchOps.flightTermination && state.launchOps.payloadRestraint ? 'Critical checks complete' : 'Checklist incomplete'}</b></p>
          <p><span>Weather</span><b>{assessment?.correct ? assessment.choice.toUpperCase() : 'Assessment needed'}</b></p>
          <p><span>Communications</span><b>{state.communications.verified ? 'Preset verified' : 'Not configured'}</b></p>
          <p><span>Selected window</span><b>{windowForSummary?.name || 'None'} · {windowForSummary?.durationLabel || ''}</b></p>
          {windowForSummary && <p><span>Expected scenario outcome</span><b>{(() => { const score = Math.max(0, windowForSummary.risk - readiness.optionalCount); return score >= 4 ? `Failure risk · index ${score}` : score >= 2 ? `Deployment delay · index ${score}` : `Successful deployment · index ${score}`; })()}</b></p>}
          {scenarioNoGo && <div className="launch-blocker">NO-GO forecast. Do not launch during this scenario window.</div>}
          {!scenarioNoGo && outstanding.length > 0 && <div className="launch-blocker">Outstanding: {outstanding.join('; ')}.</div>}
          {readiness.launchAllowed && <div className="launch-permitted">All mandatory launch gates are satisfied for this active window.</div>}
          {activeWindow && <button type="button" className="game-button launch-button" disabled={!readiness.launchAllowed} onClick={() => dispatch({ type: 'LAUNCH', windowId: activeWindow.id, siteName: site.name })}>{readiness.launchAllowed ? `LAUNCH · ${activeWindow.name}` : 'Complete mandatory gates to launch'}</button>}
        </div>
      </section>

      <section className="game-panel sidebar-panel activity-panel">
        <div className="sidebar-heading"><div><span className="panel-step">LIVE RECORD</span><h2>Mission activity</h2></div></div>
        <div className="activity-feed" aria-live="polite">
          {state.activity.map((entry, index) => <article key={`${entry.time}-${index}`}><time>{formatClock(entry.time)}</time><b>{entry.title}</b><p>{entry.detail}</p></article>)}
        </div>
      </section>
    </aside>
  );
}

function GamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialGameState);
  const [showGuide, setShowGuide] = useState(() => !sessionStorage.getItem('stargazer-realtime-guide-seen'));
  const lastTickRef = useRef(null);

  useEffect(() => {
    if (state.paused || !['preparation', 'journey'].includes(state.phase)) {
      lastTickRef.current = null;
      return undefined;
    }
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const currentTick = performance.now();
      const lastTick = lastTickRef.current ?? currentTick;
      lastTickRef.current = currentTick;
      const elapsedRealSeconds = (currentTick - lastTick) / 1000;
      dispatch({ type: 'TICK', deltaSeconds: elapsedRealSeconds * state.speed });
    }, 100);
    return () => {
      window.clearInterval(timer);
      lastTickRef.current = null;
    };
  }, [state.paused, state.phase, state.speed]);

  const site = landingSites.find((item) => item.id === state.siteId) || landingSites[0];
  const simTime = useMemo(() => new Date(SCENARIO_START.getTime() + state.elapsedSeconds * 1000), [state.elapsedSeconds]);
  const conditions = useMemo(() => {
    const sun = calculateSunPosition(simTime, site.latitude, site.longitude);
    const earth = calculateEarthPosition(simTime, site.latitude, site.longitude);
    const sunClearance = clearanceOf(sun, site.latitude, site.longitude);
    const earthClearance = clearanceOf(earth, site.latitude, site.longitude);
    return { sun, earth, sunVisible: sunClearance > 0, earthVisible: earthClearance > 0 };
  }, [site, simTime]);
  const readiness = getReadiness(state);
  const statuses = getDepartmentStatuses(state);
  function closeGuide() {
    sessionStorage.setItem('stargazer-realtime-guide-seen', 'true');
    setShowGuide(false);
  }

  return (
    <main className="game-page realtime-game">
      {showGuide && <GameGuide onClose={closeGuide} />}
      <header className="mission-topbar">
        <div className="mission-brand"><img src="/favicon.svg" alt="" /><div><span>STARGAZER · NASA CLPS / ARTEMIS CONTEXT</span><h1>MISSION 001 <i>GET THE ROBOTIC LANDER TO THE MOON</i></h1></div></div>
        <div className="clock-console"><div><small>MISSION ELAPSED TIME</small><strong>{formatClock(state.elapsedSeconds)}</strong></div><div className="clock-controls"><button type="button" className="game-button" onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })} disabled={state.phase === 'debrief' || state.phase === 'no-launch'}>{state.paused ? 'Resume clock' : 'Pause clock'}</button><label>Speed<select value={state.speed} onChange={(event) => dispatch({ type: 'SET_SPEED', speed: Number(event.target.value) })} disabled={state.phase === 'debrief' || state.phase === 'no-launch'}><option value={60}>1×</option><option value={120}>2×</option><option value={240}>4×</option></select></label><button type="button" className="guide-open" onClick={() => setShowGuide(true)}>Guide</button></div></div>
      </header>

      <MissionTimeline state={state} onSelectWindow={(windowId) => dispatch({ type: 'SELECT_WINDOW', windowId })} onSkipWindow={(windowId) => dispatch({ type: 'SKIP_WINDOW', windowId })} />

      {state.phase === 'journey' || state.phase === 'debrief'
        ? <MissionJourney state={state} site={site} />
        : state.phase === 'no-launch'
          ? <section className="game-panel no-launch-panel"><span className="panel-step">SCENARIO COMPLETE</span><h2>No launch this mission period</h2><p>The three deterministic scenario windows passed without a launch. Review the activity log to see which preparation gates were still open and how each window was assessed. This scenario can be reset by reloading the page.</p><b>Scientific visibility estimates did not determine these scenario launch windows.</b></section>
          : <div className="mission-workspace">
            <section className="department-main">
              <DepartmentPanel state={state} dispatch={dispatch} statuses={statuses} />
              <div className="department-footnote">Switch departments at any time. The shared mission clock continues in real time; each minigame’s selections remain in mission state.</div>
            </section>
            <MissionControl state={state} site={site} conditions={conditions} dispatch={dispatch} readiness={readiness} statuses={statuses} />
          </div>}

      {state.phase === 'journey' && <div className="journey-controls"><button type="button" className="game-button" onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })}>{state.paused ? 'Resume journey' : 'Pause journey'}</button><span>Journey advances on the same mission clock. This is illustrative, not an orbital simulation.</span></div>}
      <footer className="game-footer realtime-footer">Scenario launch windows, weather, checklist outcomes and risk index are deterministic gameplay data. Stargazer Sun/Earth outputs describe local lunar geometric visibility only; they do not calculate Earth-to-Moon windows, launch weather, radio links or transfer trajectories. No scientific validation is implied.</footer>
    </main>
  );
}

export default GamePage;
