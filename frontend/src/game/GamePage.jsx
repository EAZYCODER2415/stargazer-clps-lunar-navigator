import { useMemo, useState } from 'react';
import landingSites from '../data/landingSites.json';
import {
  CAMPAIGN_HOURS,
  CAMPAIGN_START,
  conditionsAt,
  ENERGY_CAP,
  forecastOperation,
  makeOutcome,
  MAINTENANCE_RECOMMENDED_AFTER,
  MAINTENANCE_REQUIRED_AFTER,
  OPERATIONS,
  ROBOT_LAUNCH_COST,
  ROBOT_TRANSIT_HOURS,
} from './gameModel';
import GameGuide from './GameGuide';
import LunarMapView from './LunarMapView';
import MissionView from './MissionView';
import './game.css';

const initialResources = { energy: 40, materials: 12 };
const initialProgress = { surveys: 0, areas: 0, beaconDeployed: false, operationsSinceMaintenance: 0 };

function formatTime(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function GamePage() {
  const [time, setTime] = useState(CAMPAIGN_START);
  const [selectedSite, setSelectedSite] = useState(landingSites[0]);
  const [inspectedSite, setInspectedSite] = useState(landingSites[0]);
  const [committed, setCommitted] = useState(false);
  const [resources, setResources] = useState(initialResources);
  const [robotState, setRobotState] = useState('atBase');
  const [mission, setMission] = useState(null);
  const [operationId, setOperationId] = useState('survey');
  const [robotAvailable, setRobotAvailable] = useState(false);
  const [activeOperation, setActiveOperation] = useState(null);
  const [progress, setProgress] = useState(initialProgress);
  const [view, setView] = useState('mission');
  const [showGuide, setShowGuide] = useState(() => !sessionStorage.getItem('stargazer-game-guide-seen'));
  const [log, setLog] = useState([]);

  const current = useMemo(() => conditionsAt(selectedSite, time), [selectedSite, time]);
  const operation = OPERATIONS[operationId];
  const operationForecast = useMemo(
    () => forecastOperation(selectedSite, time, operation.durationHours),
    [selectedSite, time, operation.durationHours],
  );
  const endTime = new Date(CAMPAIGN_START.getTime() + CAMPAIGN_HOURS * 3600000);
  const hoursLeft = Math.max(0, (endTime.getTime() - time.getTime()) / 3600000);
  const missionDay = ((time.getTime() - CAMPAIGN_START.getTime()) / 86400000) + 1;
  const missionComplete = progress.beaconDeployed;
  const surveyComplete = progress.surveys > 0;
  const usageCount = progress.operationsSinceMaintenance;
  const maintenanceStatus = usageCount >= MAINTENANCE_REQUIRED_AFTER
    ? 'required'
    : usageCount >= MAINTENANCE_RECOMMENDED_AFTER
      ? 'recommended'
      : 'healthy';
  const maintenanceRequired = maintenanceStatus === 'required' && operation.id !== 'maintenance';
  const surveyAlreadyDone = operation.id === 'survey' && surveyComplete;
  const operationNeedsSurvey = operation.id !== 'survey' && !surveyComplete;
  const operationAffordable = resources.energy >= operation.energy && resources.materials >= operation.materials;
  const operationFits = operation.durationHours <= hoursLeft;
  const protectsBeaconSupplies = operation.id === 'beacon'
    || (resources.energy - operation.energy >= OPERATIONS.beacon.energy
      && resources.materials - operation.materials >= OPERATIONS.beacon.materials);
  const canStartOperation = committed && robotState === 'operational' && robotAvailable
    && !activeOperation && !missionComplete && !maintenanceRequired && !surveyAlreadyDone
    && !operationNeedsSurvey && operationAffordable && operationFits && protectsBeaconSupplies
    && (operation.id !== 'maintenance' || maintenanceStatus !== 'healthy');
  const canLaunch = committed && robotState === 'atBase' && !missionComplete
    && resources.energy >= ROBOT_LAUNCH_COST.energy
    && resources.materials >= ROBOT_LAUNCH_COST.materials
    && ROBOT_TRANSIT_HOURS <= hoursLeft;

  function addLog(entryTime, title, detail) {
    setLog((entries) => [{ time: new Date(entryTime), title, detail }, ...entries]);
  }

  function commitSite(site = selectedSite) {
    if (committed) return;
    setSelectedSite(site);
    setCommitted(true);
    addLog(time, 'Candidate site selected', `${site.name} committed for Mission 001.`);
  }

  function launchRobot() {
    if (!canLaunch) return;
    const arrivalTime = new Date(time.getTime() + ROBOT_TRANSIT_HOURS * 3600000);
    setResources((currentResources) => ({
      energy: currentResources.energy - ROBOT_LAUNCH_COST.energy,
      materials: currentResources.materials - ROBOT_LAUNCH_COST.materials,
    }));
    setRobotState('inTransit');
    setMission({ launchedAt: new Date(time), arrivalTime, status: 'inTransit' });
    addLog(time, 'Robotic deployment mission launched', `Robot 01 is travelling to ${selectedSite.name}. Energy −${ROBOT_LAUNCH_COST.energy}; materials −${ROBOT_LAUNCH_COST.materials}. Six game hours of schematic transit remain.`);
  }

  function solarRechargeHours(fromTime, toTime) {
    const elapsedHours = Math.floor((toTime.getTime() - fromTime.getTime()) / 3600000);
    let visibleHours = 0;
    for (let hour = 0; hour < elapsedHours; hour += 1) {
      const sampleTime = new Date(fromTime.getTime() + (hour + 0.5) * 3600000);
      if (conditionsAt(selectedSite, sampleTime).sunVisible) visibleHours += 1;
    }
    return visibleHours;
  }

  function advanceHours(requestedHours) {
    const requestedTarget = new Date(Math.min(endTime.getTime(), time.getTime() + requestedHours * 3600000));
    if (requestedTarget <= time) return;

    if (activeOperation && activeOperation.finishTime <= requestedTarget) {
      const finishTime = activeOperation.finishTime;
      const recharge = robotState === 'operational' ? solarRechargeHours(time, finishTime) : 0;
      const energyGained = Math.min(recharge, Math.max(0, ENERGY_CAP - resources.energy));
      const nextUsageCount = activeOperation.operation.id === 'maintenance' ? 0 : usageCount + 1;
      setResources((currentResources) => ({ ...currentResources, energy: Math.min(ENERGY_CAP, currentResources.energy + recharge) }));
      setTime(finishTime);
      setProgress((currentProgress) => ({
        ...currentProgress,
        surveys: currentProgress.surveys + (activeOperation.operation.id === 'survey' ? 1 : 0),
        areas: currentProgress.areas + (activeOperation.operation.id === 'explore' ? 1 : 0),
        beaconDeployed: currentProgress.beaconDeployed || activeOperation.operation.id === 'beacon',
        operationsSinceMaintenance: activeOperation.operation.id === 'maintenance'
          ? 0
          : currentProgress.operationsSinceMaintenance + 1,
      }));
      setRobotAvailable(true);
      if (activeOperation.operation.id === 'survey' || activeOperation.operation.id === 'maintenance') setOperationId('beacon');
      setLog((entries) => [
        { time: finishTime, title: activeOperation.outcome.title, detail: activeOperation.outcome.detail },
        ...(activeOperation.operation.id === 'beacon' ? [{ time: finishTime, title: 'Mission objective complete', detail: `The first robotic outpost beacon is established at ${selectedSite.name}.` }] : []),
        ...(activeOperation.operation.id !== 'maintenance' && nextUsageCount === MAINTENANCE_REQUIRED_AFTER ? [{ time: finishTime, title: 'Maintenance required', detail: `Robot 01 has completed ${nextUsageCount} operations since service. Complete the service operation before more surface work.` }] : []),
        ...(activeOperation.operation.id !== 'maintenance' && nextUsageCount === MAINTENANCE_RECOMMENDED_AFTER ? [{ time: finishTime, title: 'Maintenance recommended', detail: `Robot 01 has completed ${nextUsageCount} operations since service. A service cycle is now recommended.` }] : []),
        ...(energyGained > 0 ? [{ time: finishTime, title: `Energy +${energyGained}`, detail: 'Abstract energy units recharged during hours when the Sun cleared the local terrain horizon.' }] : []),
        ...entries,
      ]);
      setActiveOperation(null);
      return;
    }

    if (mission?.status === 'inTransit' && mission.arrivalTime <= requestedTarget) {
      const approachTime = new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.7 * 3600000);
      const insertionTime = new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.9 * 3600000);
      const transitTime = new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.25 * 3600000);
      const previousProgress = (time.getTime() - mission.launchedAt.getTime()) / (mission.arrivalTime.getTime() - mission.launchedAt.getTime());
      const milestones = [];
      if (previousProgress < 0.25) milestones.push({ time: transitTime, title: 'Robot 01 entered transit', detail: 'Illustrative mission animation passed its 25% transit milestone.' });
      if (previousProgress < 0.7) milestones.push({ time: approachTime, title: 'Robot 01 approaching the Moon', detail: 'Illustrative mission animation passed its 70% transit milestone.' });
      if (previousProgress < 0.9) milestones.push({ time: insertionTime, title: 'Robot 01 entered lunar insertion stage', detail: 'Illustrative mission animation passed its 90% transit milestone.' });
      setTime(mission.arrivalTime);
      setRobotState('operational');
      setRobotAvailable(true);
      setMission((currentMission) => ({ ...currentMission, status: 'arrived' }));
      setLog((entries) => [
        { time: mission.arrivalTime, title: 'Robot 01 arrived at the lunar site', detail: `${selectedSite.name} is now available for surface operations.` },
        ...milestones.reverse(),
        ...entries,
      ]);
      return;
    }

    if (mission?.status === 'inTransit') {
      const previousProgress = (time.getTime() - mission.launchedAt.getTime()) / (mission.arrivalTime.getTime() - mission.launchedAt.getTime());
      const nextProgress = (requestedTarget.getTime() - mission.launchedAt.getTime()) / (mission.arrivalTime.getTime() - mission.launchedAt.getTime());
      const events = [];
      if (previousProgress < 0.25 && nextProgress >= 0.25) events.push({ time: new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.25 * 3600000), title: 'Robot 01 entered transit', detail: 'Illustrative mission animation passed its 25% transit milestone.' });
      if (previousProgress < 0.7 && nextProgress >= 0.7) events.push({ time: new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.7 * 3600000), title: 'Robot 01 approaching the Moon', detail: 'Illustrative mission animation passed its 70% transit milestone.' });
      if (previousProgress < 0.9 && nextProgress >= 0.9) events.push({ time: new Date(mission.launchedAt.getTime() + ROBOT_TRANSIT_HOURS * 0.9 * 3600000), title: 'Robot 01 entered lunar insertion stage', detail: 'Illustrative mission animation passed its 90% transit milestone.' });
      if (events.length) setLog((entries) => [...events.reverse(), ...entries]);
    }

    const recharge = robotState === 'operational' ? solarRechargeHours(time, requestedTarget) : 0;
    const energyGained = Math.min(recharge, Math.max(0, ENERGY_CAP - resources.energy));
    if (energyGained > 0) {
      setResources((currentResources) => ({ ...currentResources, energy: Math.min(ENERGY_CAP, currentResources.energy + recharge) }));
      addLog(requestedTarget, `Energy +${energyGained}`, 'Abstract energy units recharged during hours when the Sun cleared the local terrain horizon.');
    }
    setTime(requestedTarget);
  }

  function startOperation() {
    if (!canStartOperation) return;
    const finishTime = new Date(time.getTime() + operation.durationHours * 3600000);
    setResources((currentResources) => ({
      energy: currentResources.energy - operation.energy,
      materials: currentResources.materials - operation.materials,
    }));
    setRobotAvailable(false);
    setActiveOperation({ operation, finishTime, outcome: makeOutcome(operation, operationForecast) });
    addLog(time, `${operation.name} started`, `${operation.durationHours} hours scheduled. Energy −${operation.energy}; materials −${operation.materials}.`);
  }

  function selectSite(site) {
    if (!site) return;
    setInspectedSite(site);
    if (!committed) setSelectedSite(site);
  }

  function closeGuide() {
    sessionStorage.setItem('stargazer-game-guide-seen', 'true');
    setShowGuide(false);
  }

  const sunHorizon = current.sun.elevation - current.sunClearance;
  const earthHorizon = current.earth.elevation - current.earthClearance;
  const nextTask = missionComplete
    ? 'Mission complete — the robotic outpost beacon is established.'
    : !committed
      ? 'Compare the candidates, then commit to a site.'
      : robotState === 'atBase'
        ? 'Launch Robot 01 to the selected site.'
        : robotState === 'inTransit'
          ? 'Advance mission time until Robot 01 arrives.'
          : activeOperation
            ? `Advance time to complete ${activeOperation.operation.name.toLowerCase()}.`
            : maintenanceRequired
              ? 'Service the robot before its next surface operation.'
              : !surveyComplete
                ? 'Complete the required terrain survey.'
                : 'Deploy the outpost beacon to complete the mission.';

  return (
    <main className="game-page">
      {showGuide && <GameGuide onClose={closeGuide} />}
      <header className="game-header">
        <div>
          <p className="game-kicker"><img src="/favicon.svg" alt="" /> STARGAZER <span>NASA CLPS · ARTEMIS</span></p>
          <h1>Mission 001 · Establish a Robotic Outpost</h1>
          <p>Mission day {missionDay.toFixed(1)} · {missionComplete ? 'Outpost established' : robotState === 'inTransit' ? 'Robot in transit' : robotState === 'operational' ? 'Surface operations' : 'Site reconnaissance'}</p>
        </div>
        <div className="header-actions">
          <button className="game-button" onClick={() => setShowGuide(true)}>Mission guide</button>
          <div className="game-clock">
            <span>MISSION CLOCK · DAY {missionDay.toFixed(1)}</span>
            <strong>{formatTime(time)}</strong>
            <span>{hoursLeft.toFixed(0)} hours remain in the 29.53-day campaign</span>
          </div>
        </div>
      </header>

      <section className="game-objective" aria-label="Mission objective and next task">
        <span className="view-overline">MISSION OBJECTIVE</span>
        <strong>Establish an operational robotic outpost at one lunar candidate site.</strong>
        <span className="next-task"><b>NEXT TASK</b> {nextTask}</span>
        <div className="objective-steps">
          <span className={committed ? 'done' : 'current'}>{committed ? '✓' : '1'} Choose a site</span>
          <span className={robotState === 'operational' ? 'done' : robotState === 'inTransit' ? 'current' : ''}>{robotState === 'operational' ? '✓' : '2'} Send Robot 01</span>
          <span className={surveyComplete ? 'done' : robotState === 'operational' ? 'current' : ''}>{surveyComplete ? '✓' : '3'} Survey the site</span>
          <span className={missionComplete ? 'done' : surveyComplete ? 'current' : ''}>{missionComplete ? '✓' : '4'} Deploy the beacon</span>
        </div>
      </section>

      <section className="game-resources" aria-label="Mission resources and equipment condition">
        <div><span>Energy</span><strong>{resources.energy} / {ENERGY_CAP}</strong><small>abstract game units</small></div>
        <div><span>Materials</span><strong>{resources.materials}</strong><small>abstract game units</small></div>
        <div><span>Robot 01</span><strong>{robotState === 'operational' ? robotAvailable ? 'Operational' : 'On task' : robotState === 'inTransit' ? 'In transit' : 'At mission base'}</strong><small>{activeOperation ? activeOperation.operation.name : robotState === 'inTransit' ? 'Six-hour game transit' : 'One robotic unit'}</small></div>
        <div className={`resource-condition ${maintenanceStatus}`}><span>Equipment condition</span><strong>{robotState !== 'operational' ? 'Not deployed' : maintenanceStatus === 'healthy' ? 'Healthy' : maintenanceStatus === 'recommended' ? 'Service recommended' : 'Service required'}</strong><small>{robotState === 'operational' ? `${usageCount} completed operation(s) since service` : 'No equipment condition simulated before arrival'}</small></div>
      </section>

      <section className="game-panel visualization-panel">
        <div className="panel-heading visualization-heading">
          <div><span className="panel-step">MISSION SITUATION</span><h2>Programme overview</h2></div>
          <div className="view-tabs" role="tablist" aria-label="Mission visualisation">
            <button role="tab" aria-selected={view === 'mission'} className={view === 'mission' ? 'active' : ''} onClick={() => setView('mission')}>Mission View</button>
            <button role="tab" aria-selected={view === 'surface'} className={view === 'surface' ? 'active' : ''} onClick={() => setView('surface')}>Lunar Surface View</button>
          </div>
        </div>
        {view === 'mission'
          ? <MissionView mission={mission} now={time} robotState={robotState} selectedSite={selectedSite} />
          : <LunarMapView sites={landingSites} selectedSite={selectedSite} inspectedSite={inspectedSite} onInspectSite={selectSite} committed={committed} robotState={robotState} progress={progress} operationsSinceMaintenance={usageCount} maintenanceStatus={maintenanceStatus} activeOperation={activeOperation} />}
        <div className="live-conditions">
          <span className="sun-data"><b>Sun at selected site</b> {current.sunVisible ? 'Visible' : 'Below terrain horizon'} · {current.sun.elevation.toFixed(1)}° elevation</span>
          <span className="earth-data"><b>Earth at selected site</b> {current.earthVisible ? 'Visible' : 'Below terrain horizon'} · {current.earth.elevation.toFixed(1)}° elevation</span>
          <span>{formatTime(time)}</span>
        </div>
      </section>

      <div className="game-columns">
        <section className="game-panel site-panel">
          <div className="panel-heading"><div><span className="panel-step">01 · RECONNAISSANCE</span><h2>Choose a candidate site</h2></div></div>
          <label className="field-label" htmlFor="game-site">Candidate site</label>
          <select id="game-site" value={selectedSite.id} onChange={(event) => selectSite(landingSites.find((site) => site.id === event.target.value))} disabled={committed}>
            {landingSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <p className="site-coordinates">{selectedSite.latitude.toFixed(4)}° latitude · {selectedSite.longitude.toFixed(4)}° east</p>
          <div className="condition-grid">
            <div className="condition-card sun-data"><span>Sun · {current.sunVisible ? 'terrain visible' : 'terrain blocked'}</span><strong>{current.sun.elevation.toFixed(2)}° elevation</strong><small>{current.sun.azimuth.toFixed(1)}° azimuth · skyline {sunHorizon.toFixed(2)}°</small><small>Clearance {current.sunClearance.toFixed(2)}°</small></div>
            <div className="condition-card earth-data"><span>Earth · {current.earthVisible ? 'terrain visible' : 'terrain blocked'}</span><strong>{current.earth.elevation.toFixed(2)}° elevation</strong><small>{current.earth.azimuth.toFixed(1)}° azimuth · skyline {earthHorizon.toFixed(2)}°</small><small>Clearance {current.earthClearance.toFixed(2)}°</small></div>
          </div>
          {!committed ? <button className="game-button primary" onClick={() => commitSite()}>Commit to this site</button> : <p className="commit-note">Destination committed. The site cannot be changed after the mission begins.</p>}
          <p className="science-note">Geometric visibility compares interpolated ephemeris directions with the site's bundled terrain horizon. It does not establish power, link performance or landing safety.</p>
        </section>

        <section className="game-panel actions-panel">
          <div className="panel-heading"><div><span className="panel-step">02 · MISSION ACTION</span><h2>{robotState === 'atBase' ? 'Deploy the robotic unit' : 'Surface operations'}</h2></div></div>
          {robotState === 'atBase' && (
            <>
              <p className="operation-description">Launch Robot 01 from mission base to {selectedSite.name}. The six-hour trip is an illustrative game transit, not a real transfer trajectory.</p>
              <div className="operation-costs"><span>Transit <strong>{ROBOT_TRANSIT_HOURS} game hours</strong></span><span>Energy <strong>{ROBOT_LAUNCH_COST.energy} units</strong></span><span>Materials <strong>{ROBOT_LAUNCH_COST.materials} units</strong></span></div>
              <button className="game-button primary" onClick={launchRobot} disabled={!canLaunch}>{committed ? 'Launch Robot 01' : 'Commit to a site first'}</button>
              {committed && resources.energy < ROBOT_LAUNCH_COST.energy && <p className="action-hint">Advance time to recharge the mission energy budget.</p>}
              {committed && resources.materials < ROBOT_LAUNCH_COST.materials && <p className="action-hint">Insufficient materials for deployment.</p>}
            </>
          )}
          {robotState === 'inTransit' && <div className="active-operation"><strong>Mission in transit to {selectedSite.name}</strong><span>Advance time in 1, 6 or 24-hour steps. The route marker moves with the mission clock.</span></div>}
          {robotState === 'operational' && !missionComplete && (
            <>
              <label className="field-label" htmlFor="game-operation">Assign Robot 01</label>
              <select id="game-operation" value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={!robotAvailable || Boolean(activeOperation)}>
                {Object.values(OPERATIONS).map((item) => <option key={item.id} value={item.id} disabled={(item.id === 'survey' && surveyComplete) || (item.id !== 'survey' && !surveyComplete) || (item.id === 'maintenance' && maintenanceStatus === 'healthy')}>{item.name}{item.id === 'explore' ? ' · optional' : item.id === 'maintenance' ? ' · condition-based' : ''}</option>)}
              </select>
              <p className="operation-description">{operation.description}</p>
              <div className="operation-costs"><span>Duration <strong>{operation.durationHours} h</strong></span><span>Energy <strong>{operation.energy} units</strong></span><span>Materials <strong>{operation.materials} units</strong></span></div>
              <div className="forecast-box"><strong>Forecast for this shift</strong><span className="sun-data">Sun clears local terrain for {operationForecast.sunVisibleHours}/{operation.durationHours} hours</span><span className="earth-data">Earth clears local terrain for {operationForecast.earthVisibleHours}/{operation.durationHours} hours</span><span>Mean interpolated Sun elevation: {operationForecast.meanSunElevation.toFixed(2)}°</span></div>
              <button className="game-button primary" onClick={startOperation} disabled={!canStartOperation}>{activeOperation ? 'Operation in progress' : 'Confirm and start operation'}</button>
              {activeOperation && <div className="active-operation"><strong>In progress: {activeOperation.operation.name}</strong><span>Scheduled to finish {formatTime(activeOperation.finishTime)}</span></div>}
              {!robotAvailable && !activeOperation && <p className="action-hint">Robot 01 is unavailable.</p>}
              {maintenanceRequired && <p className="action-hint warning-critical">Service is required before another surface operation.</p>}
              {operationNeedsSurvey && <p className="action-hint">Complete the required terrain survey first.</p>}
              {surveyAlreadyDone && <p className="action-hint">The required survey is complete. Choose the optional exploration, service, or beacon operation.</p>}
              {robotAvailable && !operationAffordable && <p className="action-hint">Insufficient resources for this operation.</p>}
              {robotAvailable && operationAffordable && !operationFits && <p className="action-hint">There is not enough campaign time for this shift.</p>}
              {robotAvailable && surveyComplete && !protectsBeaconSupplies && operation.id !== 'beacon' && <p className="action-hint">Keep at least 20 energy and 4 materials for the required beacon deployment.</p>}
              {maintenanceStatus === 'recommended' && <p className="action-hint">Maintenance is recommended after {MAINTENANCE_RECOMMENDED_AFTER} completed operations. You may service the robot now or continue.</p>}
              {maintenanceStatus === 'required' && <p className="action-hint warning-critical">Maintenance is required after {MAINTENANCE_REQUIRED_AFTER} completed operations. Other operations are paused until service is complete.</p>}
            </>
          )}
          {missionComplete && <div className="mission-success"><strong>✓ Robotic outpost established</strong><span>Mission objective complete at {selectedSite.name}.</span></div>}
        </section>
      </div>

      <section className="game-panel time-panel">
        <div className="panel-heading"><div><span className="panel-step">03 · MISSION TIME</span><h2>Advance the campaign</h2></div></div>
        <div className="timeline-track"><span style={{ width: `${Math.min(100, ((time - CAMPAIGN_START) / (endTime - CAMPAIGN_START)) * 100)}%` }} /></div>
        <div className="time-controls">
          <button className="game-button" onClick={() => advanceHours(1)} disabled={!committed || time >= endTime || missionComplete}>Advance 1 hour</button>
          <button className="game-button" onClick={() => advanceHours(6)} disabled={!committed || time >= endTime || missionComplete}>Advance 6 hours</button>
          <button className="game-button" onClick={() => advanceHours(24)} disabled={!committed || time >= endTime || missionComplete}>Advance 24 hours</button>
          <span>{committed ? `Time advances only when you choose a step. At the site, each Sun-visible hour adds 1 abstract energy unit (cap ${ENERGY_CAP}).` : 'Commit to a candidate site to start the mission clock.'}</span>
        </div>
        <div className="outcome-log"><div className="log-heading"><h3>Mission activity</h3><span>{log.length} recorded events</span></div>{log.length === 0 ? <p className="empty-log">No activity yet. Choose a site to begin the mission.</p> : log.map((entry, index) => <article key={`${entry.time.toISOString()}-${index}`}><strong>{entry.title}</strong><span>DAY {(((entry.time.getTime() - CAMPAIGN_START.getTime()) / 86400000) + 1).toFixed(1)} · {formatTime(entry.time)}</span><p>{entry.detail}</p></article>)}</div>
      </section>

      <footer className="game-footer">Scientific inputs are the existing hourly ephemeris samples and LOLA-derived horizon masks. Transit duration, energy units and operation-count maintenance are simplified game abstractions, not mission engineering models. These scientific outputs have not been independently validated for mission planning.</footer>
    </main>
  );
}

export default GamePage;
