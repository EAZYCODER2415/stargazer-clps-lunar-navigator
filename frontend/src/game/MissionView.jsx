import { ROBOT_TRANSIT_HOURS } from './gameModel';

function MissionView({ mission, now, robotState, selectedSite }) {
  const elapsed = mission ? Math.max(0, (now.getTime() - mission.launchedAt.getTime()) / 3600000) : 0;
  const progress = mission?.status === 'arrived'
    ? 100
    : Math.max(0, Math.min(100, (elapsed / ROBOT_TRANSIT_HOURS) * 100));
  const stage = !mission
    ? 'Awaiting launch'
    : progress >= 100
      ? 'Arrived at lunar site'
      : progress < 25
        ? 'Launch and departure'
        : progress < 70
          ? 'In transit'
          : progress < 90
            ? 'Approaching the Moon'
            : 'Lunar insertion';
  const remaining = Math.max(0, ROBOT_TRANSIT_HOURS - elapsed);
  const x = 102 + (progress / 100) * 476;
  const status = mission?.status === 'arrived'
    ? 'Robot deployed'
    : mission
      ? 'Mission in transit'
      : 'Mission not launched';

  return (
    <div className="mission-view">
      <div className="mission-view-copy">
        <span className="view-overline">ROBOTIC DEPLOYMENT · ILLUSTRATIVE TRANSIT</span>
        <h3>Earth to Moon</h3>
        <p>Mission 001 · Destination: {selectedSite.name}</p>
        <dl className="mission-facts">
          <div><dt>Status</dt><dd>{status}</dd></div>
          <div><dt>Stage</dt><dd>{stage}</dd></div>
          <div><dt>Progress</dt><dd>{progress.toFixed(0)}%</dd></div>
          <div><dt>Estimated game time remaining</dt><dd>{mission?.status === 'arrived' ? '0 h' : mission ? `${remaining.toFixed(1)} h` : '6 h after launch'}</dd></div>
        </dl>
        {mission && <div className="mission-progress-track" aria-label={`Mission transit ${progress.toFixed(0)} percent`}><span style={{ width: `${progress}%` }} /></div>}
      </div>
      <svg className="mission-svg" viewBox="0 0 680 190" role="img" aria-label={`Illustrative spacecraft route from Earth to the Moon. ${progress.toFixed(0)} percent complete.`}>
        <defs>
          <linearGradient id="routeGradient" x1="0" x2="1"><stop offset="0%" stopColor="#3989b4" /><stop offset="100%" stopColor="#7ecdb1" /></linearGradient>
        </defs>
        <path className="route-base" d="M105 96 H580" />
        <path className="route-progress" d="M105 96 H580" pathLength="100" style={{ strokeDasharray: `${progress} 100` }} />
        <circle className="route-stop" cx="342" cy="96" r="4" />
        <circle className="earth-disc" cx="65" cy="96" r="34" />
        <path className="earth-grid" d="M35 96h60M65 63c-13 12-13 53 0 66M65 63c13 12 13 53 0 66M38 80h54M38 112h54" />
        <circle className="moon-disc" cx="620" cy="96" r="32" />
        <circle className="moon-crater" cx="610" cy="87" r="7" />
        <circle className="moon-crater" cx="630" cy="106" r="4" />
        <g className="craft-marker" transform={`translate(${x} 96)`}>
          <path d="M-13 0 5-7 13 0 5 7Z" />
          <path className="craft-fin" d="m-6-5-5-7 1 10m4 7-5 7 1-10" />
          <circle cx="4" cy="0" r="2" />
        </g>
        <text className="space-label" x="65" y="152" textAnchor="middle">EARTH</text>
        <text className="space-label" x="620" y="152" textAnchor="middle">MOON</text>
        <text className="route-label" x="342" y="74" textAnchor="middle">GAME TRANSIT · {ROBOT_TRANSIT_HOURS} H</text>
      </svg>
      <p className="illustration-note">Schematic route and fixed six-hour game transit. Position advances only when you advance mission time; this is not an orbital trajectory or real transfer duration.</p>
      {robotState === 'operational' && mission?.status === 'arrived' && <p className="arrival-note">✓ Robot 01 arrived at {selectedSite.name} and is ready for surface operations.</p>}
    </div>
  );
}

export default MissionView;
