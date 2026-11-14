import { getWindowStatus, LAUNCH_WINDOWS, SCENARIO_END_SECONDS } from './gameEngine';

function formatCountdown(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function MissionTimeline({ state, onSelectWindow, onSkipWindow }) {
  const nextWindow = LAUNCH_WINDOWS.find((window) => getWindowStatus(state, window) === 'upcoming');
  const activeWindow = LAUNCH_WINDOWS.find((window) => getWindowStatus(state, window) === 'active');
  const selectedWindow = LAUNCH_WINDOWS.find((window) => window.id === state.selectedWindowId) || LAUNCH_WINDOWS[0];
  const status = getWindowStatus(state, selectedWindow);
  const left = (state.elapsedSeconds / SCENARIO_END_SECONDS) * 100;
  return (
    <section className="game-panel launch-timeline-panel" aria-label="Mission launch timeline">
      <div className="timeline-topline">
        <div><span className="panel-step">SCENARIO WINDOWS · ILLUSTRATIVE</span><h2>Launch opportunities</h2></div>
        <div className="window-countdown">
          {activeWindow
            ? <><b className="countdown-active">{activeWindow.name} ACTIVE</b><span>Closes in {formatCountdown(activeWindow.closeAt - state.elapsedSeconds)}</span></>
          : state.usedWindowId
            ? <><b>Launch period closed</b><span>Journey in progress</span></>
            : nextWindow
              ? <><b>Next: {nextWindow.name}</b><span>Opens in {formatCountdown(nextWindow.openAt - state.elapsedSeconds)}</span></>
              : <><b>No upcoming windows</b><span>Scenario launch period ends</span></>}
        </div>
      </div>
      <div className={`window-track ${state.paused ? 'paused' : ''}`}>
        <div className="window-track-base" />
        {LAUNCH_WINDOWS.map((window, index) => {
          const windowStatus = getWindowStatus(state, window);
          const segmentLeft = (window.openAt / SCENARIO_END_SECONDS) * 100;
          const segmentWidth = ((window.closeAt - window.openAt) / SCENARIO_END_SECONDS) * 100;
          return (
            <button
              type="button"
              key={window.id}
              className={`window-segment ${windowStatus} ${state.selectedWindowId === window.id ? 'selected' : ''}`}
              style={{ left: `${segmentLeft}%`, width: `${segmentWidth}%` }}
              onClick={() => onSelectWindow(window.id)}
              title={`${window.name}: ${window.summary}`}
              aria-label={`${window.name}, ${windowStatus}, opens at ${formatCountdown(window.openAt)}, closes at ${formatCountdown(window.closeAt)}`}
              aria-pressed={state.selectedWindowId === window.id}
            ><span>W{index + 1}</span></button>
          );
        })}
        <span className="game-time-ball" style={{ left: `${left}%` }} aria-label={`Current mission time ${formatCountdown(state.elapsedSeconds)}`} />
        <span className="timeline-start">T+00:00</span><span className="timeline-end">T+24:30</span>
      </div>
      <div className="window-strip-legend"><span><i className="upcoming-key" /> Upcoming</span><span><i className="active-key" /> Active</span><span><i className="passed-key" /> Passed / skipped</span><span><i className="closed-key" /> Closed after launch</span><span><i className="ball-key" /> Mission time</span></div>
      <div className="window-review">
        <div><strong>{selectedWindow.name} · {status.toUpperCase()}</strong><span>{formatCountdown(selectedWindow.openAt)}–{formatCountdown(selectedWindow.closeAt)} · {selectedWindow.durationLabel}</span><p>{selectedWindow.summary}</p><small>Scenario condition: {selectedWindow.condition}. This is a deterministic game scenario, not a NASA launch window.</small></div>
        {activeWindow && <button type="button" className="game-button" onClick={() => onSkipWindow(activeWindow.id)}>Skip active window</button>}
      </div>
    </section>
  );
}

export default MissionTimeline;
