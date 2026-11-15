import { JOURNEY_DURATION_SECONDS, WINDOW_MAP } from './gameEngine';

const STAGES = [
  ['launch', 0, 'Launch'],
  ['departure', 20, 'Departure'],
  ['transit', 45, 'Transit'],
  ['approach', 75, 'Lunar approach'],
  ['arrival', 100, 'Arrival'],
];

function MissionJourney({ state, site }) {
  const elapsed = Math.max(0, state.elapsedSeconds - (state.launchInfo?.time || 0));
  const progress = state.phase === 'debrief' ? 100 : Math.min(100, (elapsed / JOURNEY_DURATION_SECONDS) * 100);
  const x = 104 + progress * 4.72;
  const currentStage = [...STAGES].reverse().find(([, at]) => progress >= at)?.[0] || 'launch';
  const window = WINDOW_MAP[state.launchInfo?.windowId];
  return (
    <section className="game-panel journey-panel">
      <div className="panel-heading"><div><span className="panel-step">MISSION JOURNEY · ILLUSTRATIVE</span><h2>{state.phase === 'debrief' ? 'Mission debrief' : 'Lunar transfer in progress'}</h2></div><span className={`outcome-badge ${state.phase === 'debrief' ? state.outcome.result : ''}`}>{state.phase === 'debrief' ? state.outcome.result.toUpperCase() : 'IN FLIGHT'}</span></div>
      <div className="journey-summary"><span>MISSION 001 · ROBOTIC LANDER</span><span>Destination: {site.name}</span><span>Launched during {window?.name}</span></div>
      <svg className="journey-svg" viewBox="0 0 680 160" role="img" aria-label={`Illustrative Earth to Moon journey, ${progress.toFixed(0)} percent complete.`}>
        <path className="journey-route-base" d="M105 78H580" />
        <path className="journey-route-complete" pathLength="100" d="M105 78H580" style={{ strokeDasharray: `${progress} 100` }} />
        <circle className="journey-earth" cx="65" cy="78" r="32" />
        <path className="journey-earth-grid" d="M38 78h54M65 48c-12 11-12 47 0 60M65 48c12 11 12 47 0 60M41 65h48M41 91h48" />
        <circle className="journey-moon" cx="620" cy="78" r="30" />
        <circle className="journey-crater" cx="612" cy="69" r="6" />
        <circle className="journey-crater" cx="629" cy="87" r="4" />
        <g className="journey-craft" transform={`translate(${x} 78)`}><path d="M-13 0 5-7 13 0 5 7Z"/><path d="m-6-5-5-7 1 10m4 7-5 7 1-10"/><circle cx="4" cy="0" r="2"/></g>
        <text x="65" y="132" textAnchor="middle">EARTH</text><text x="620" y="132" textAnchor="middle">MOON</text>
        <text x="342" y="57" textAnchor="middle">SCHEMATIC ROUTE · NOT AN ORBITAL TRAJECTORY</text>
      </svg>
      <div className="journey-stages">{STAGES.map(([id, at, label]) => <div key={id} className={`${progress >= at ? 'reached' : ''} ${id === currentStage ? 'current' : ''}`}><i />{label}</div>)}</div>
      {state.phase !== 'debrief' && <div className="journey-status"><strong>{currentStage === 'launch' ? 'Launch sequence complete' : currentStage === 'departure' ? 'Departing Earth' : currentStage === 'transit' ? 'Cruise stage' : 'Approaching lunar destination'}</strong><span>Journey progress {progress.toFixed(0)}% · estimated game time remaining {Math.ceil((JOURNEY_DURATION_SECONDS - elapsed) / 60)} min. Pause or change speed using mission controls.</span></div>}
      {state.phase === 'debrief' && <div className={`mission-debrief ${state.outcome.result}`}>
        <span>OUTCOME · {state.outcome.result.toUpperCase()}</span>
        <h3>{state.outcome.summary}</h3>
        <p>Selected opportunity: {window?.name} · {window?.condition}</p>
        <p>Scenario risk index: {state.outcome.baseRisk} starting risk − {state.outcome.optionalMitigation} optional preparation checks = {state.outcome.adjustedRisk} remaining.</p>
        <p>Mandatory launch requirements were met. This outcome is a deterministic game abstraction; it is not a real mission reliability estimate.</p>
      </div>}
      <p className="scientific-caveat">Journey duration and spacecraft position are illustrative game progression. Stargazer’s lunar Sun/Earth visibility calculations do not calculate an Earth-to-Moon launch window or transfer trajectory.</p>
    </section>
  );
}

export default MissionJourney;
