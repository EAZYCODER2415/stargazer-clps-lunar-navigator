import { GAME_SPEEDS, MISSION_STAGES, getPreparationDeadline, getStageIndex } from './gameEngine';

// Mission header in three areas (identity, status, controls) plus the stage progress bar.
// Everything shown here is read from the one mission state; nothing is kept locally.

function missionClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `T+${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutesSeconds(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function utc(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') : '—';
}

function span(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h ${minutes % 60}m` : `${hours}h ${minutes % 60}m`;
}

function SelectedOpportunity({ state }) {
  const plan = state.missionPlan;
  if (!plan) return null;
  const selected = plan.selectedWindow;
  const startMs = Date.parse(selected.startTime);
  const endMs = Date.parse(selected.endTime);
  const durationMs = selected.durationMs ?? endMs - startMs;
  const allowanceMs = plan.preparationAllowanceMs ?? (plan.planningReferenceTime ? startMs - Date.parse(plan.planningReferenceTime) : NaN);
  const deadline = getPreparationDeadline(state);
  const preparing = !state.launch && ['assembly', 'assembly-complete', 'launchpad', 'countdown'].includes(state.phase);
  const remaining = deadline - state.elapsed;
  return <div className="header-opportunity" title="Planned lunar surface operating opportunity from Stage 0 (Sun and Earth both geometrically visible). It is not an Earth-to-Moon launch window.">
    <div className="header-fact header-site"><small>SELECTED LANDING SITE{plan.debug && <em className="debug-flag">DEBUG TEST DATA</em>}</small><b>{plan.siteName}</b></div>
    <div className="header-fact"><small>SURFACE OPERATING WINDOW · UTC</small><b>{utc(selected.startTime)} <i>→</i> {utc(selected.endTime)}</b><span>{span(durationMs)} long · not a launch window</span></div>
    <div className="header-fact"><small>PREPARATION ALLOWANCE</small><b>{span(allowanceMs)}</b>{preparing ? <span className={remaining <= 60 ? 'warn' : ''}>{minutesSeconds(remaining)} left of {minutesSeconds(deadline)} on the game clock</span> : state.phase === 'no-launch' ? <span className="warn">Game-clock deadline passed</span> : <span>Launched at {missionClock(state.launch?.time ?? 0)}</span>}</div>
  </div>;
}

function SpeedSelector({ speed, onChange }) {
  return <div className="speed-selector" role="radiogroup" aria-label="Mission clock speed">
    <small>SPEED</small>
    {GAME_SPEEDS.map((option) => <button key={option} type="button" role="radio" aria-checked={speed === option} className={speed === option ? 'active' : ''} onClick={() => onChange(option)}>{option.toFixed(1)}x</button>)}
  </div>;
}

export function StageProgress({ phase }) {
  const current = getStageIndex(phase);
  return <nav className="stage-progress" aria-label="Mission stage progress" style={{ '--stage': current }}>
    <div className="stage-progress-track" aria-hidden="true"><i className="stage-progress-fill" /><i className="stage-progress-marker" /></div>
    <ol>{MISSION_STAGES.map((stage, index) => <li key={stage.id} className={index < current ? 'done' : index === current ? 'current' : 'future'} aria-current={index === current ? 'step' : undefined}><i aria-hidden="true" /><span><b>{index}</b> {stage.short}</span><em className="sr-only">{index < current ? 'completed' : index === current ? 'current stage' : 'not started'}</em></li>)}</ol>
  </nav>;
}

export default function MissionHeader({ state, onTogglePause, onSpeed, onGuide }) {
  return <header className="mission-header">
    <a className="mission-identity" href="/">
      <img src="/favicon.svg" alt="" />
      <div><span>STARGAZER · LUNAR MISSION SIMULATOR</span><h1>MISSION 001 <i>GET A ROBOTIC LANDER TO THE MOON</i></h1></div>
    </a>
    <div className="mission-status">
      <div className="header-clock"><small>MISSION ELAPSED TIME{state.paused ? ' · PAUSED' : ''}</small><strong>{missionClock(state.elapsed)}</strong></div>
      <SelectedOpportunity state={state} />
    </div>
    <div className="mission-controls">
      <button type="button" className="game-button pause-button" onClick={onTogglePause} disabled={state.phase === 'no-launch'} aria-pressed={state.paused}>{state.paused ? 'Resume clock' : 'Pause clock'}</button>
      <SpeedSelector speed={state.speed} onChange={onSpeed} />
      <button type="button" className="game-button" onClick={onGuide}>Mission guide</button>
    </div>
  </header>;
}
