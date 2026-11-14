import { useMemo, useState } from 'react';
import landingSites from '../data/landingSites.json';
import {
  CAMPAIGN_HOURS,
  CAMPAIGN_START,
  conditionsAt,
  ENERGY_CAP,
  forecastOperation,
  makeOutcome,
  OPERATIONS,
} from './gameModel';
import './game.css';

const initialResources = { energy: 40, materials: 12 };
const initialProgress = { surveys: 0, areas: 0, maintenance: 0, beaconDeployed: false };

function formatTime(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function GamePage() {
  const [time, setTime] = useState(CAMPAIGN_START);
  const [selectedSite, setSelectedSite] = useState(landingSites[0]);
  const [committed, setCommitted] = useState(false);
  const [resources, setResources] = useState(initialResources);
  const [robotAvailable, setRobotAvailable] = useState(true);
  const [operationId, setOperationId] = useState('survey');
  const [activeOperation, setActiveOperation] = useState(null);
  const [progress, setProgress] = useState(initialProgress);
  const [log, setLog] = useState([]);

  const current = useMemo(() => conditionsAt(selectedSite, time), [selectedSite, time]);
  const operation = OPERATIONS[operationId];
  const operationForecast = useMemo(
    () => forecastOperation(selectedSite, time, operation.durationHours),
    [selectedSite, time, operation.durationHours],
  );
  const endTime = new Date(CAMPAIGN_START.getTime() + CAMPAIGN_HOURS * 3600000);
  const hoursLeft = Math.max(0, (endTime.getTime() - time.getTime()) / 3600000);
  const affordable = resources.energy >= operation.energy && resources.materials >= operation.materials;
  const fitsCampaign = operation.durationHours <= hoursLeft;
  const canStart = committed && robotAvailable && !activeOperation && affordable && fitsCampaign;
  const missionDay = ((time.getTime() - CAMPAIGN_START.getTime()) / 86400000) + 1;

  function advanceHours(requestedHours) {
    if (activeOperation) {
      const hoursUntilFinish = (activeOperation.finishTime.getTime() - time.getTime()) / 3600000;
      if (hoursUntilFinish <= requestedHours) {
        const actualHours = Math.max(0, hoursUntilFinish);
        const finishTime = new Date(activeOperation.finishTime);
        const lightHours = forecastOperation(selectedSite, time, Math.max(1, Math.ceil(actualHours))).sunVisibleHours;
        const charged = Math.min(ENERGY_CAP, resources.energy + lightHours);
        setResources((currentResources) => ({ ...currentResources, energy: charged }));
        setTime(finishTime);
        setProgress((currentProgress) => ({
          ...currentProgress,
          surveys: currentProgress.surveys + (activeOperation.operation.id === 'survey' ? 1 : 0),
          areas: currentProgress.areas + (activeOperation.operation.id === 'explore' ? 1 : 0),
          maintenance: currentProgress.maintenance + (activeOperation.operation.id === 'maintenance' ? 1 : 0),
          beaconDeployed: currentProgress.beaconDeployed || activeOperation.operation.id === 'beacon',
        }));
        setRobotAvailable(true);
        setLog((entries) => [
          { time: finishTime, ...activeOperation.outcome },
          ...entries,
        ]);
        setActiveOperation(null);
        return;
      }
    }

    const nextTime = new Date(Math.min(endTime.getTime(), time.getTime() + requestedHours * 3600000));
    const elapsed = Math.max(0, (nextTime.getTime() - time.getTime()) / 3600000);
    let lightHours = 0;
    for (let hour = 0; hour < Math.floor(elapsed); hour += 1) {
      const sampleTime = new Date(time.getTime() + (hour + 0.5) * 3600000);
      if (conditionsAt(selectedSite, sampleTime).sunVisible) lightHours += 1;
    }
    setResources((currentResources) => ({
      ...currentResources,
      energy: Math.min(ENERGY_CAP, currentResources.energy + lightHours),
    }));
    setTime(nextTime);
  }

  function startOperation() {
    if (!canStart) return;
    const forecast = operationForecast;
    const finishTime = new Date(time.getTime() + operation.durationHours * 3600000);
    setResources((currentResources) => ({
      energy: currentResources.energy - operation.energy,
      materials: currentResources.materials - operation.materials,
    }));
    setRobotAvailable(false);
    setActiveOperation({
      operation,
      finishTime,
      outcome: makeOutcome(operation, forecast),
    });
  }

  function chooseSite(event) {
    const site = landingSites.find((candidate) => candidate.id === event.target.value);
    if (site) setSelectedSite(site);
  }

  const sunHorizon = current.sun.elevation - current.sunClearance;
  const earthHorizon = current.earth.elevation - current.earthClearance;

  return (
    <main className="game-page">
      <header className="game-header">
        <div>
          <p className="game-kicker">STARGAZER · MISSION 001</p>
          <h1>Establish a Robotic Outpost</h1>
          <p>Choose a site, plan a robot shift, and see how local terrain and time shape the work.</p>
        </div>
        <div className="game-clock">
          <span>MISSION CLOCK · DAY {missionDay.toFixed(1)}</span>
          <strong>{formatTime(time)}</strong>
          <span>{Math.max(0, hoursLeft).toFixed(0)} hours remain in the 29.53-day campaign</span>
        </div>
      </header>

      <section className="game-resources" aria-label="Mission resources">
        <div><span>Energy</span><strong>{resources.energy} / {ENERGY_CAP}</strong><small>abstract game units</small></div>
        <div><span>Materials</span><strong>{resources.materials}</strong><small>abstract game units</small></div>
        <div><span>Robotic unit</span><strong>{robotAvailable ? 'Available' : 'Working'}</strong><small>1 unit assigned to this mission</small></div>
        <div><span>Outpost progress</span><strong>{progress.beaconDeployed ? 'Beacon deployed' : 'Site survey'}</strong><small>{progress.surveys} surveys · {progress.areas} areas explored</small></div>
      </section>

      <div className="game-columns">
        <section className="game-panel site-panel">
          <div className="panel-heading"><div><span className="panel-step">01 · RECONNAISSANCE</span><h2>Compare candidate sites</h2></div></div>
          <label className="field-label" htmlFor="game-site">Candidate site</label>
          <select id="game-site" value={selectedSite.id} onChange={chooseSite} disabled={committed}>
            {landingSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <p className="site-coordinates">{selectedSite.latitude.toFixed(4)}° latitude · {selectedSite.longitude.toFixed(4)}° east</p>
          <div className="condition-grid">
            <div className="condition-card">
              <span>Sun · {current.sunVisible ? 'terrain visible' : 'terrain blocked'}</span>
              <strong>{current.sun.elevation.toFixed(2)}° elevation</strong>
              <small>{current.sun.azimuth.toFixed(1)}° azimuth · skyline {sunHorizon.toFixed(2)}°</small>
              <small>Clearance {current.sunClearance.toFixed(2)}°</small>
            </div>
            <div className="condition-card">
              <span>Earth · {current.earthVisible ? 'terrain visible' : 'terrain blocked'}</span>
              <strong>{current.earth.elevation.toFixed(2)}° elevation</strong>
              <small>{current.earth.azimuth.toFixed(1)}° azimuth · skyline {earthHorizon.toFixed(2)}°</small>
              <small>Clearance {current.earthClearance.toFixed(2)}°</small>
            </div>
          </div>
          {!committed ? (
            <button className="game-button primary" onClick={() => setCommitted(true)}>Commit to this site</button>
          ) : <p className="commit-note">Site committed for this campaign. Conditions update as mission time advances.</p>}
          <p className="science-note">Visibility is geometric: interpolated JPL Horizons directions are compared with the bundled LOLA terrain horizon. Visibility alone does not establish power, link performance, or landing safety.</p>
        </section>

        <section className="game-panel operations-panel">
          <div className="panel-heading"><div><span className="panel-step">02 · OPERATIONS</span><h2>Assign the robotic unit</h2></div></div>
          <label className="field-label" htmlFor="game-operation">Operation</label>
          <select id="game-operation" value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={!robotAvailable || Boolean(activeOperation)}>
            {Object.values(OPERATIONS).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p className="operation-description">{operation.description}</p>
          <div className="operation-costs">
            <span>Duration <strong>{operation.durationHours} h</strong></span>
            <span>Energy <strong>{operation.energy} units</strong></span>
            <span>Materials <strong>{operation.materials} units</strong></span>
          </div>
          <div className="forecast-box">
            <strong>Forecast for this shift</strong>
            <span>Sun clears local terrain for {operationForecast.sunVisibleHours}/{operation.durationHours} hours</span>
            <span>Earth clears local terrain for {operationForecast.earthVisibleHours}/{operation.durationHours} hours</span>
            <span>Mean interpolated Sun elevation: {operationForecast.meanSunElevation.toFixed(2)}°</span>
          </div>
          <button className="game-button primary" onClick={startOperation} disabled={!canStart}>Confirm and assign operation</button>
          {!committed && <p className="action-hint">Commit to a site before assigning a robot.</p>}
          {committed && !robotAvailable && <p className="action-hint">The robotic unit is already on an operation.</p>}
          {committed && robotAvailable && !affordable && <p className="action-hint">Insufficient resources for this operation.</p>}
          {committed && robotAvailable && affordable && !fitsCampaign && <p className="action-hint">There is not enough campaign time for this shift.</p>}
          {activeOperation && <div className="active-operation"><strong>In progress: {activeOperation.operation.name}</strong><span>Scheduled to finish {formatTime(activeOperation.finishTime)}</span></div>}
        </section>
      </div>

      <section className="game-panel time-panel">
        <div className="panel-heading"><div><span className="panel-step">03 · MISSION TIME</span><h2>Advance the lunar timeline</h2></div></div>
        <div className="timeline-track"><span style={{ width: `${Math.min(100, ((time - CAMPAIGN_START) / (endTime - CAMPAIGN_START)) * 100)}%` }} /></div>
        <div className="time-controls">
          <button className="game-button" onClick={() => advanceHours(1)} disabled={time >= endTime}>Advance 1 hour</button>
          <button className="game-button" onClick={() => advanceHours(6)} disabled={time >= endTime}>Advance 6 hours</button>
          <button className="game-button" onClick={() => advanceHours(24)} disabled={time >= endTime}>Advance 24 hours</button>
          <span>Energy recharges by 1 abstract unit per hour when the Sun clears the terrain horizon (capped at {ENERGY_CAP}).</span>
        </div>
        {log.length > 0 && <div className="outcome-log"><h3>Mission log</h3>{log.map((entry, index) => <article key={`${entry.time.toISOString()}-${index}`}><strong>{entry.title}</strong><span>{formatTime(entry.time)}</span><p>{entry.detail}</p></article>)}</div>}
      </section>

      <footer className="game-footer">Prototype game abstractions are separate from the scientific outputs. Ephemeris samples are hourly and interpolate in time; visibility uses a 360-direction LOLA-derived horizon mask. These data and calculations have not been independently validated for mission planning.</footer>
    </main>
  );
}

export default GamePage;
