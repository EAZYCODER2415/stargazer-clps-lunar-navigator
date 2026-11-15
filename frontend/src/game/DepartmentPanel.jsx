import { LAUNCH_WINDOWS, WINDOW_MAP, getActiveWindow, getWindowStatus } from './gameEngine';

const DEPARTMENTS = [
  ['engineering', 'Engineering'],
  ['launchOps', 'Launch Operations'],
  ['weather', 'Weather'],
  ['communications', 'Communications'],
];

function DepartmentNavigation({ active, statuses, dispatch, disabled }) {
  return (
    <nav className="department-tabs" aria-label="Mission departments">
      {DEPARTMENTS.map(([id, name]) => <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => dispatch({ type: 'SET_DEPARTMENT', department: id })} disabled={disabled}>{name}<small>{statuses[id]}</small></button>)}
    </nav>
  );
}

function Engineering({ state, dispatch, disabled }) {
  const { engineering } = state;
  return (
    <div className="minigame-content">
      <span className="panel-step">SPACECRAFT PREPARATION · MANDATORY REPAIR</span>
      <h2>Find and clear the sensor fault</h2>
      <p className="task-instructions">Read the diagnostic panel, select the component reporting a fault, choose the matching repair, then apply it. This fault is part of the fictional training scenario.</p>
      <div className="diagnostic-board">
        <div><span>Flight computer</span><b className="status-ok">NOMINAL</b><small>Self-test passed</small></div>
        <div className="diagnostic-fault"><span>Landing-leg sensor</span><b>FAULT</b><small>Intermittent deployment telemetry</small></div>
        <div><span>Radio reflector</span><b className="status-ok">NOMINAL</b><small>Continuity check passed</small></div>
      </div>
      <div className="minigame-controls">
        <label>Component to inspect<select value={engineering.component} onChange={(event) => dispatch({ type: 'SET_ENGINEERING_COMPONENT', component: event.target.value })} disabled={disabled || engineering.faultResolved}><option value="">Choose component</option><option value="landing-sensor">Landing-leg sensor</option><option value="flight-computer">Flight computer</option><option value="radio-reflector">Radio reflector</option></select></label>
        <label>Repair action<select value={engineering.repair} onChange={(event) => dispatch({ type: 'SET_ENGINEERING_REPAIR', repair: event.target.value })} disabled={disabled || engineering.faultResolved}><option value="">Choose repair</option><option value="recalibrate">Recalibrate sensor</option><option value="cycle-power">Cycle power</option><option value="replace-relay">Replace relay</option></select></label>
        <button type="button" className="game-button primary" onClick={() => dispatch({ type: 'APPLY_ENGINEERING_REPAIR' })} disabled={disabled || engineering.faultResolved || !engineering.component || !engineering.repair}>{engineering.faultResolved ? 'Fault resolved' : 'Apply repair and verify'}</button>
      </div>
      {engineering.feedback && <p className={`minigame-feedback ${engineering.feedback}`}>{engineering.feedback === 'correct' ? 'Verified. Landing-leg telemetry is restored.' : 'Not resolved. Use the diagnostic readings and try another repair.'}</p>}
      <label className="optional-check"><input type="checkbox" checked={engineering.powerBusChecked} onChange={() => dispatch({ type: 'TOGGLE_POWER_CHECK' })} disabled={disabled || engineering.powerBusChecked} /> Optional: complete an independent power-bus cross-check <em>Outcome mitigation</em></label>
    </div>
  );
}

function LaunchOperations({ state, dispatch, disabled }) {
  const { launchOps } = state;
  return (
    <div className="minigame-content">
      <span className="panel-step">PAD OPERATIONS · TWO REQUIRED ITEMS</span>
      <h2>Complete the launch checklist</h2>
      <p className="task-instructions">Verify the critical launch-vehicle items. Both mandatory checks must be complete before launch; the independent review is optional.</p>
      <div className="checklist-grid">
        <label className="checklist-item"><input type="checkbox" checked={launchOps.flightTermination} onChange={() => dispatch({ type: 'TOGGLE_LAUNCH_CHECK', key: 'flightTermination' })} disabled={disabled} /><span><b>Flight termination system armed</b><small>Ground safety scenario check · mandatory</small></span><em>{launchOps.flightTermination ? 'VERIFIED' : 'PENDING'}</em></label>
        <label className="checklist-item"><input type="checkbox" checked={launchOps.payloadRestraint} onChange={() => dispatch({ type: 'TOGGLE_LAUNCH_CHECK', key: 'payloadRestraint' })} disabled={disabled} /><span><b>Payload restraint pins verified</b><small>Robotic lander secured for launch · mandatory</small></span><em>{launchOps.payloadRestraint ? 'VERIFIED' : 'PENDING'}</em></label>
      </div>
      <label className="optional-check"><input type="checkbox" checked={launchOps.redundantCheck} onChange={() => dispatch({ type: 'TOGGLE_LAUNCH_CHECK', key: 'redundantCheck' })} disabled={disabled || launchOps.redundantCheck} /> Optional: request an independent checklist review <em>Outcome mitigation</em></label>
      {launchOps.flightTermination && launchOps.payloadRestraint && <p className="minigame-feedback correct">Critical launch checklist complete.</p>}
    </div>
  );
}

function Weather({ state, dispatch, disabled }) {
  const window = WINDOW_MAP[state.selectedWindowId] || getActiveWindow(state) || LAUNCH_WINDOWS[0];
  const assessment = state.weatherAssessments[window.id];
  const choice = state.weatherChoices[window.id] || '';
  const windowStatus = getWindowStatus(state, window);
  return (
    <div className="minigame-content">
      <span className="panel-step">SCENARIO WEATHER · WINDOW-SPECIFIC</span>
      <h2>Read the forecast and make a go / no-go call</h2>
      <p className="task-instructions">This fictional forecast belongs to {window.name}. Review the scenario indication, classify it, and record your decision. You can assess future windows ahead of time.</p>
      <div className={`weather-readout ${window.weatherDecision}`}><span>{window.name} · {window.condition}</span><strong>{window.weatherDecision === 'go' ? 'GO CONDITIONS' : window.weatherDecision === 'caution' ? 'CAUTION CONDITIONS' : 'NO-GO CONDITIONS'}</strong><small>{window.summary}</small></div>
      <fieldset className="weather-options" disabled={disabled || windowStatus === 'missed' || windowStatus === 'skipped' || windowStatus === 'used'}>
        <legend>Classify this window</legend>
        {[
          ['go', 'GO · acceptable for launch'],
          ['caution', 'CAUTION · launch with scenario risk'],
          ['noGo', 'NO-GO · stand down'],
        ].map(([value, label]) => <label key={value}><input type="radio" name={`weather-${window.id}`} value={value} checked={choice === value} onChange={() => dispatch({ type: 'SET_WEATHER_CHOICE', windowId: window.id, choice: value })} />{label}</label>)}
      </fieldset>
      <button type="button" className="game-button primary" onClick={() => dispatch({ type: 'ASSESS_WEATHER', windowId: window.id })} disabled={disabled || !choice || ['missed', 'skipped', 'used'].includes(windowStatus)}>Record weather assessment</button>
      {assessment && <p className={`minigame-feedback ${assessment.correct ? 'correct' : 'wrong'}`}>{assessment.correct ? `Assessment recorded: ${assessment.choice === 'noGo' ? 'stand down for this window.' : `${assessment.choice.toUpperCase()} for this scenario window.`}` : 'Assessment does not match the scenario forecast. Review the reading and try again; no preparation progress is lost.'}</p>}
      <small className="scientific-caveat">Scenario-only weather. No real weather feed or launch-weather model is connected.</small>
    </div>
  );
}

function Communications({ state, dispatch, disabled }) {
  const { communications } = state;
  return (
    <div className="minigame-content">
      <span className="panel-step">COMMUNICATIONS · SIMULATED CONFIGURATION</span>
      <h2>Match the mission transponder preset</h2>
      <p className="task-instructions">The mission card shows transponder preset <b>S2</b>. Select the matching receiver channel and verify the simulated configuration. This is a matching task, not a radio-link calculation.</p>
      <div className="signal-card"><span>MISSION TRANSPONDER</span><strong>S2</strong><small>Receiver channel must match</small></div>
      <fieldset className="channel-options" disabled={disabled || communications.verified}>
        <legend>Receiver preset</legend>
        {['S1', 'S2', 'S3'].map((preset) => <label key={preset} className={communications.preset === preset ? 'selected' : ''}><input type="radio" name="receiver-preset" value={preset} checked={communications.preset === preset} onChange={() => dispatch({ type: 'SET_COMMS_PRESET', preset })} />{preset}</label>)}
      </fieldset>
      <button type="button" className="game-button primary" onClick={() => dispatch({ type: 'VERIFY_COMMS' })} disabled={disabled || communications.verified || !communications.preset}>{communications.verified ? 'Configuration verified' : 'Verify receiver configuration'}</button>
      {communications.feedback && <p className={`minigame-feedback ${communications.feedback}`}>{communications.verified ? 'The simulated receiver and mission presets match.' : 'Preset mismatch. Check the mission card and retry.'}</p>}
      <label className="optional-check"><input type="checkbox" checked={communications.backupChecked} onChange={() => dispatch({ type: 'TOGGLE_BACKUP_COMMS' })} disabled={disabled || communications.backupChecked} /> Optional: check the simulated backup receiver <em>Outcome mitigation</em></label>
      <small className="scientific-caveat">This minigame does not model antenna gain, signal strength or a communications link budget.</small>
    </div>
  );
}

function DepartmentPanel({ state, dispatch, statuses }) {
  const disabled = state.phase !== 'preparation';
  const page = {
    engineering: <Engineering state={state} dispatch={dispatch} disabled={disabled} />,
    launchOps: <LaunchOperations state={state} dispatch={dispatch} disabled={disabled} />,
    weather: <Weather state={state} dispatch={dispatch} disabled={disabled} />,
    communications: <Communications state={state} dispatch={dispatch} disabled={disabled} />,
  }[state.department];
  return (
    <section className="game-panel department-panel">
      <DepartmentNavigation active={state.department} statuses={statuses} dispatch={dispatch} disabled={disabled} />
      {page}
    </section>
  );
}

export { DEPARTMENTS, DepartmentNavigation };
export default DepartmentPanel;
