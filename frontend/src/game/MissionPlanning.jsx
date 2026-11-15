import { lazy, Suspense, useMemo, useState } from 'react';
import landingSites from '../data/landingSites.json';
import { findJointVisibilityWindows, getEphemerisRange, getLunarSiteConditions } from '../utils/ephemerisRuntime';
import MissionHeader from './MissionHeader';
import './planning.css';

const LunarScene3D = lazy(() => import('../components/LunarScene3D'));
const STEP = 10 * 60 * 1000;
const LATE_START_TOLERANCE = 60 * 60 * 1000;
const DAY = 86400000;
const PLANNING_REFERENCE_TIME = getEphemerisRange(landingSites[0].latitude, landingSites[0].longitude).start;

function formatUtc(value) {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  return days ? `${days}d ${hours}h ${remaining}m` : `${hours}h ${remaining}m`;
}

function formatAngle(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`;
}

function formatDetailedDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  return [days && `${days} ${days === 1 ? 'day' : 'days'}`, hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`, remaining && `${remaining} ${remaining === 1 ? 'minute' : 'minutes'}`].filter(Boolean).join(' ') || 'Less than a minute';
}

function preparationAllowance(record) {
  return Math.max(0, Date.parse(record.startTime) - PLANNING_REFERENCE_TIME.getTime());
}

function preparationSeconds(record) {
  const daysUntil = preparationAllowance(record) / DAY;
  return Math.max(360, Math.min(1600, Math.round(daysUntil * 60)));
}

function SkyInstrument({ site, conditions }) {
  const cx = 180;
  const cy = 150;
  const radius = 111;
  const point = (azimuth, clearance) => {
    const radial = Math.max(35, Math.min(155, radius - Math.max(-32, Math.min(55, clearance)) * 1.35));
    const angle = (azimuth - 90) * Math.PI / 180;
    return { x: cx + Math.cos(angle) * radial, y: cy + Math.sin(angle) * radial };
  };
  const sun = point(conditions.sun.azimuth, conditions.sunClearance);
  const earth = point(conditions.earth.azimuth, conditions.earthClearance);
  return <svg className="planner-sky-instrument" viewBox="0 0 360 300" role="img" aria-label={`Local sky direction plot for ${site.name}. Sun azimuth ${conditions.sun.azimuth.toFixed(1)} degrees. Earth azimuth ${conditions.earth.azimuth.toFixed(1)} degrees.`}>
    <circle className="sky-ring outer" cx={cx} cy={cy} r="137" />
    <circle className="sky-ring horizon" cx={cx} cy={cy} r={radius} />
    <circle className="sky-ring inner" cx={cx} cy={cy} r="58" />
    <path className="sky-axis" d={`M ${cx - 147} ${cy} H ${cx + 147} M ${cx} ${cy - 147} V ${cy + 147}`} />
    <text x={cx} y="7" textAnchor="middle">N</text><text x="352" y={cy + 4} textAnchor="end">E</text><text x={cx} y="294" textAnchor="middle">S</text><text x="7" y={cy + 4}>W</text>
    <line className={`sky-ray sun-ray ${conditions.sunVisible ? 'visible' : ''}`} x1={cx} y1={cy} x2={sun.x} y2={sun.y} />
    <line className={`sky-ray earth-ray ${conditions.earthVisible ? 'visible' : ''}`} x1={cx} y1={cy} x2={earth.x} y2={earth.y} />
    <circle className="sky-site" cx={cx} cy={cy} r="7" />
    <circle className={`sky-body sun-body ${conditions.sunVisible ? 'visible' : ''}`} cx={sun.x} cy={sun.y} r="9" />
    <circle className={`sky-body earth-body ${conditions.earthVisible ? 'visible' : ''}`} cx={earth.x} cy={earth.y} r="9" />
    <text className="body-label" x={sun.x + 12} y={sun.y - 9}>SUN</text><text className="body-label" x={earth.x + 12} y={earth.y - 9}>EARTH</text>
  </svg>;
}

function LunarSiteMap({ sites, records, selectedSiteId, onSelect, onConfirm, onBack }) {
  const [hoveredSiteId, setHoveredSiteId] = useState(null);
  const center = { x: 450, y: 345 };
  const mapRadius = 235;
  const maxColatitude = 5.5;
  const points = sites.map((site) => {
    const colatitude = 90 + site.latitude;
    const radial = Math.tan(colatitude * Math.PI / 360) / Math.tan(maxColatitude * Math.PI / 360) * 205;
    const longitude = site.longitude * Math.PI / 180;
    return { site, x: center.x + radial * Math.sin(longitude), y: center.y - radial * Math.cos(longitude) };
  });
  const active = points.find((point) => point.site.id === (hoveredSiteId || selectedSiteId));
  const tooltipX = active ? Math.max(18, Math.min(552, active.x > center.x + 35 ? active.x - 342 : active.x + 24)) : 0;
  const tooltipY = active ? Math.max(18, Math.min(552, active.y < 170 ? active.y + 20 : active.y - 112)) : 0;
  const shortNames = { malapert: 'MALAPERT', shackleton: 'SHACKLETON', 'mons-mouton': 'MONS MOUTON' };

  return <div className="planner-site-map-overlay"><section className="planner-site-map-shell" role="dialog" aria-label="Choose a lunar landing site">
    <header className="planner-map-heading"><div><span>STAGE 00 · MISSION PLANNING</span><h1>Choose your landing site</h1><p>Longer operating windows can provide more time for planned lunar surface activities, while a larger preparation allowance gives your team more time to prepare before the selected opportunity begins. The best choice depends on your mission priorities.</p><small>Operating window represents geometric Sun and Earth visibility. It does not guarantee continuous electrical power or a working communications link.</small><small>Preparation allowance is a simplified game-planning interval from the shared ephemeris reference, not an Earth-to-Moon launch window.</small></div><b>SOUTH POLAR REGION<br />POLAR MAP PROJECTION</b></header>
    <svg className="planner-lunar-map" viewBox="0 0 900 690" role="group" aria-label="South polar lunar map showing all three candidate sites at their project coordinates">
      <defs><radialGradient id="lunar-map-fill" cx="42%" cy="37%"><stop offset="0" stopColor="#30394a" /><stop offset=".76" stopColor="#141a27" /><stop offset="1" stopColor="#090d15" /></radialGradient><clipPath id="lunar-map-clip"><circle cx={center.x} cy={center.y} r={mapRadius} /></clipPath></defs>
      <circle className="lunar-map-disc" cx={center.x} cy={center.y} r={mapRadius} />
      <g clipPath="url(#lunar-map-clip)"><circle cx={center.x} cy={center.y} r={mapRadius} fill="url(#lunar-map-fill)" />
        {[55, 105, 155, 205].map((radius) => <circle key={radius} className="lunar-map-graticule" cx={center.x} cy={center.y} r={radius} />)}
        {[0, 30, 60, 90, 120, 150].map((longitude) => { const angle = longitude * Math.PI / 180; const dx = Math.sin(angle) * mapRadius; const dy = Math.cos(angle) * mapRadius; return <line key={longitude} className="lunar-map-graticule" x1={center.x - dx} y1={center.y + dy} x2={center.x + dx} y2={center.y - dy} />; })}
        <circle className="lunar-map-pole" cx={center.x} cy={center.y} r="3" />
      </g>
      <circle className="lunar-map-limb" cx={center.x} cy={center.y} r={mapRadius} />
      <text className="lunar-map-pole-label" x={center.x + 10} y={center.y + 15}>SOUTH POLE</text>
      {points.map(({ site, x, y }) => {
        const selected = selectedSiteId === site.id;
        const record = records[site.id];
        const isRight = x > center.x;
        return <g key={site.id} className={`lunar-map-marker ${selected ? 'selected' : ''}`} role="button" tabIndex="0" aria-pressed={selected} aria-label={`${site.name}, latitude ${site.latitude}, longitude ${site.longitude}. Operating window ${formatDetailedDuration(record.durationMs)}. Preparation allowance ${formatDetailedDuration(preparationAllowance(record))}.`} transform={`translate(${x} ${y})`} onMouseEnter={() => setHoveredSiteId(site.id)} onMouseLeave={() => setHoveredSiteId(null)} onFocus={() => setHoveredSiteId(site.id)} onBlur={() => setHoveredSiteId(null)} onClick={() => onSelect(site.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(site.id); } }}>
          <circle className="lunar-map-marker-halo" r={selected ? 15 : 11} /><circle className="lunar-map-marker-dot" r="5" />
          <text className="lunar-map-site-label" x={isRight ? 12 : -12} y="-11" textAnchor={isRight ? 'start' : 'end'}>{shortNames[site.id]}</text>
        </g>;
      })}
      {active && <g className="lunar-map-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none"><rect width="330" height="126" rx="5" /><text className="lunar-map-tooltip-title" x="13" y="21">{active.site.name.toUpperCase()}</text><text className="lunar-map-tooltip-label" x="13" y="45">OPERATING WINDOW</text><text className="lunar-map-tooltip-value" x="13" y="62">{formatDetailedDuration(records[active.site.id].durationMs)}</text><text className="lunar-map-tooltip-label" x="13" y="87">PREPARATION ALLOWANCE</text><text className="lunar-map-tooltip-value" x="13" y="105">{formatDetailedDuration(preparationAllowance(records[active.site.id]))} available</text></g>}
      <text className="lunar-map-scale" x="450" y="626" textAnchor="middle">MARKER POSITIONS USE THE RECORDED PROJECT COORDINATES · SOUTH POLAR PROJECTION</text>
    </svg>
    <div className="planner-map-actions"><button type="button" className="planner-back-to-windows" onClick={onBack}>BACK TO WINDOW REVIEW</button><button type="button" className="planner-commit" disabled={!selectedSiteId} onClick={onConfirm}>CONFIRM SITE</button></div>
  </section></div>;
}

function MissionPlanning({ onCommit, onDebugTap }) {
  const firstSite = landingSites[0];
  const [siteId, setSiteId] = useState(firstSite.id);
  const [planTime, setPlanTime] = useState(() => getEphemerisRange(firstSite.latitude, firstSite.longitude).start.getTime());
  const [records, setRecords] = useState({});
  const [recording, setRecording] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [selectedMissionSiteId, setSelectedMissionSiteId] = useState('');
  const [choosingSite, setChoosingSite] = useState(false);
  const [camera, setCamera] = useState({ yaw: 0, pitch: 0 });
  const site = landingSites.find((item) => item.id === siteId) || firstSite;
  const range = useMemo(() => getEphemerisRange(site.latitude, site.longitude), [site]);
  const conditions = useMemo(() => getLunarSiteConditions(new Date(planTime), site.latitude, site.longitude), [planTime, site]);
  const intervals = useMemo(() => findJointVisibilityWindows(site.latitude, site.longitude), [site]);
  const interval = recording?.siteId === siteId
    ? recording.interval
    : intervals.find((item) => planTime >= item.start.getTime() && planTime < item.end.getTime());
  const activeRecord = records[siteId];
  const allRecorded = landingSites.every((item) => records[item.id]?.valid === true && records[item.id].durationMs > 0);
  const selectedRecord = records[selectedMissionSiteId];
  const selectedSite = landingSites.find((item) => item.id === selectedMissionSiteId);
  const windowDetected = conditions.operatingWindow;
  const recordingEnded = Boolean(recording && planTime >= recording.interval.end.getTime() && !windowDetected);
  const currentDate = new Date(planTime);
  const progress = (planTime - range.start.getTime()) / (range.end.getTime() - range.start.getTime());

  function selectSite(nextSite) {
    if (recording && recording.siteId !== nextSite.id) {
      setFeedback(`Finish or cancel the ${recording.siteName || landingSites.find((item) => item.id === recording.siteId)?.name} recording before switching sites.`);
      return;
    }
    const nextRange = getEphemerisRange(nextSite.latitude, nextSite.longitude);
    setSiteId(nextSite.id);
    const savedRecording = recording?.siteId === nextSite.id ? recording : null;
    setPlanTime(savedRecording ? savedRecording.interval.start.getTime() : nextRange.start.getTime());
    setFeedback('');
  }

  function scrub(nextValue) {
    const value = Number(nextValue);
    if (recording?.siteId === siteId && value < recording.interval.start.getTime()) {
      setFeedback('A recording runs forward from its discovered start. Continue scrubbing forward, or cancel and investigate again.');
      return;
    }
    setPlanTime(Math.max(range.start.getTime(), Math.min(range.end.getTime(), value)));
    setFeedback('');
  }

  function startRecording() {
    if (!windowDetected || !interval) {
      setFeedback('Both the Sun and Earth must clear the local terrain horizon before a candidate window can be recorded.');
      return;
    }
    const lateBy = planTime - interval.start.getTime();
    if (lateBy > LATE_START_TOLERANCE) {
      setFeedback(`You found the overlap ${formatDuration(lateBy)} after it began. Scrub back to within 1 hour of the detected start and record again.`);
      return;
    }
    setRecording({ siteId, interval });
    setPlanTime(interval.start.getTime());
    setFeedback('Recording started at the interpolated joint-visibility boundary. Scrub forward until either body drops below the terrain skyline.');
  }

  function endRecording() {
    if (!recording || recording.siteId !== siteId) return;
    if (planTime < recording.interval.end.getTime() || conditions.operatingWindow) {
      setFeedback('The candidate window is still open here. Continue scrubbing until Sun or Earth drops below the local terrain skyline.');
      return;
    }
    const start = recording.interval.start;
    const end = recording.interval.end;
    const startConditions = recording.interval.startConditions;
    const endConditions = recording.interval.endConditions;
    const record = {
      siteId,
      siteName: site.name,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMs: end.getTime() - start.getTime(),
      startSunElevation: startConditions.sun.elevation,
      startEarthElevation: startConditions.earth.elevation,
      endSunElevation: endConditions.sun.elevation,
      endEarthElevation: endConditions.earth.elevation,
      startSunClearance: startConditions.sunClearance,
      startEarthClearance: startConditions.earthClearance,
      endSunClearance: endConditions.sunClearance,
      endEarthClearance: endConditions.earthClearance,
      valid: true,
      basis: 'Hourly JPL Horizons samples, interpolated at the site; LOLA-derived 360-direction terrain horizon mask.'
    };
    setRecords((previous) => ({ ...previous, [siteId]: record }));
    setRecording(null);
    setFeedback(`Window recorded for ${site.name}. The saved interval is bounded by the calculated Sun-and-Earth overlap.`);
  }

  function revisitRecord(item) {
    if (recording && recording.siteId !== item.id) {
      setFeedback('Finish or cancel the active recording before revisiting another site.');
      return;
    }
    const record = records[item.id];
    if (!record) return;
    setSiteId(item.id);
    setPlanTime(Date.parse(record.startTime));
    setFeedback(`Revisiting the recorded window for ${item.name}.`);
  }

  function commitPlan() {
    if (!choosingSite || !allRecorded || !selectedRecord?.valid || !selectedSite) return;
    const preparationAllowanceMs = preparationAllowance(selectedRecord);
    const preparationDeadlineSeconds = preparationSeconds(selectedRecord);
    const missionPlan = {
      siteId: selectedSite.id,
      siteName: selectedSite.name,
      selectedWindow: selectedRecord,
      records: landingSites.map((item) => records[item.id]),
      planningReferenceTime: PLANNING_REFERENCE_TIME.toISOString(),
      preparationAllowanceMs,
      preparationDeadlineSeconds,
      schedulingNote: 'Simplified scenario mapping: one day of preparation allowance from the shared planning reference grants one mission-preparation minute, capped at 26m40s. It is not a transfer-trajectory calculation.'
    };
    onCommit(missionPlan);
  }

  function glanceAt(body) {
    const position = conditions[body];
    setCamera({
      yaw: -position.azimuth,
      pitch: Math.max(-80, Math.min(80, position.elevation))
    });
  }

  return <main className={`mission-planner ${choosingSite ? 'choosing-site' : ''}`} aria-label="Lunar mission planning">
    <div className="planner-environment"><Suspense fallback={<div className="planner-scene-loading">LOADING SITE HORIZON…</div>}><LunarScene3D time={currentDate} windowStart={range.start} selectedSite={site} showSolarFlux showDTELink showGrid showHorizonMask useTerrain cameraYaw={camera.yaw} cameraPitch={camera.pitch} viewMode="surface" viewResetCount={0} invertLook={false} onLookDrag={(dx, dy) => setCamera((current) => ({ yaw: current.yaw + dx, pitch: Math.max(-80, Math.min(80, current.pitch + dy)) }))} onCameraInfo={() => {}} cameraInfo={null} showInterface={false} /></Suspense></div>
    <MissionHeader className="planning-header" stageLabel="STAGE 00 · LUNAR OPERATING WINDOW DISCOVERY" stageTitle={choosingSite ? 'Compare your three recorded opportunities' : 'Find your surface opportunity'} timeLabel={choosingSite ? 'SHARED PLANNING REFERENCE' : 'PLANNING TIME · MANUAL SCRUB'} timeValue={formatUtc(choosingSite ? PLANNING_REFERENCE_TIME : planTime)} onStageLabelClick={onDebugTap} />

    <aside className="planner-record-board" aria-label="Candidate landing sites and window records"><div className="planner-panel-title"><span>{choosingSite ? 'RECORDED WINDOWS' : 'MISSION CLIPBOARD'}</span><b>0{Object.keys(records).length} / 03 RECORDED</b></div><p className="planner-short-instruction">{choosingSite ? 'Compare the three actual visibility windows on the lunar map, then confirm one site.' : 'Investigate each site. Record one interval where sunlight and direct Earth visibility overlap.'}</p>{landingSites.map((item, index) => {
      const record = records[item.id];
      return <div key={item.id} className={`planner-site-row ${choosingSite ? (selectedMissionSiteId === item.id ? 'selected' : '') : (item.id === siteId ? 'selected' : '')} ${record ? 'recorded' : ''}`}><button type="button" className="planner-site-select" disabled={choosingSite} onClick={() => selectSite(item)}><span className="site-index">0{index + 1}</span><span><b>{item.name}</b><small>{item.latitude.toFixed(4)}° · {item.longitude.toFixed(4)}° E</small></span><i>{record ? (choosingSite && selectedMissionSiteId === item.id ? 'SELECTED' : 'RECORDED') : 'TO INVESTIGATE'}</i></button>{record && !choosingSite && <div className="planner-record-summary"><span>{formatUtc(record.startTime)}</span><span>→ {formatUtc(record.endTime)}</span><b>{formatDuration(record.durationMs)}</b><button type="button" onClick={() => revisitRecord(item)}>REVISIT</button></div>}</div>;
    })}
      {feedback && !feedback.startsWith('You found the overlap ') && <p className="planner-feedback" role="status">{feedback}</p>}
      {allRecorded && !choosingSite && <button type="button" className="planner-commit planner-choose-site" onClick={() => { setChoosingSite(true); setSelectedMissionSiteId(''); setFeedback(''); }}>CHOOSE SITE</button>}
      {choosingSite && <div className="planner-site-confirm"><p>{selectedSite ? <>Selected site: <b>{selectedSite.name}</b></> : 'Select a map marker to compare its recorded measurements.'}</p><button type="button" className="planner-back-to-windows" onClick={() => { setChoosingSite(false); setSelectedMissionSiteId(''); }}>BACK TO WINDOW REVIEW</button><button type="button" className="planner-commit" disabled={!selectedSite || !selectedRecord?.valid} onClick={commitPlan}>CONFIRM SITE</button></div>}
    </aside>

    <section className="planner-instrument" aria-label="Site visibility analysis"><div className="instrument-heading"><span>LOCAL SKY GEOMETRY</span><b>{site.name.toUpperCase()}</b></div><SkyInstrument site={site} conditions={conditions} /><div className="visibility-readout"><div className="visibility-line"><i className="sun-led" /><span>SUN · {formatAngle(conditions.sun.elevation)} EL / {conditions.sun.azimuth.toFixed(1)}° AZ</span><b className={conditions.sunVisible ? 'is-visible' : 'is-hidden'}>{conditions.sunVisible ? 'VISIBLE' : 'BELOW SKYLINE'}</b></div><div className="visibility-line"><i className="earth-led" /><span>EARTH · {formatAngle(conditions.earth.elevation)} EL / {conditions.earth.azimuth.toFixed(1)}° AZ</span><b className={conditions.earthVisible ? 'is-visible' : 'is-hidden'}>{conditions.earthVisible ? 'VISIBLE' : 'BELOW SKYLINE'}</b></div></div><small className="instrument-note">Azimuth sets direction. Radial offset shows clearance from the terrain skyline; body distances and sizes are schematic.</small>
      <div className="glance-actions" aria-label="Look toward a body"><button type="button" className="glance-button earth-glance" onClick={() => glanceAt('earth')}>Glance at Earth</button><button type="button" className="glance-button sun-glance" onClick={() => glanceAt('sun')}>Glance at Sun</button></div>
      <div className={`window-signal ${windowDetected ? 'detected' : ''} ${recordingEnded ? 'ended' : ''}`}><i />{recordingEnded ? 'WINDOW ENDED' : windowDetected ? recording ? 'RECORDING · WINDOW OPEN' : 'WINDOW DETECTED' : recording ? 'RECORDING · SCRUB TO WINDOW END' : 'NO JOINT WINDOW AT THIS TIME'}</div>
      {!recording && !activeRecord && <button type="button" className="record-window-button" disabled={!windowDetected} onClick={startRecording}>● &nbsp; RECORD WINDOW</button>}
      {feedback.startsWith('You found the overlap ') && <p className="planner-feedback planner-instrument-feedback" role="status">{feedback}</p>}
      {recording && recording.siteId === siteId && <><button type="button" className={`record-window-button end-button ${recordingEnded ? 'can-end' : ''}`} onClick={endRecording}>■ &nbsp; END WINDOW{!recordingEnded && <small>Continue scrubbing until the overlap ends</small>}</button><button type="button" className="cancel-recording" onClick={() => { setRecording(null); setFeedback('Recording cancelled. No interval was saved.'); }}>CANCEL RECORDING</button></>}
      {activeRecord && !recording && <button type="button" className="record-window-button" onClick={() => { setRecords((previous) => { const next = { ...previous }; delete next[siteId]; return next; }); setPlanTime(range.start.getTime()); setFeedback('Previous record cleared. Investigate and record a candidate interval again.'); }}>↺ &nbsp; RE-RECORD THIS SITE</button>}
      {!interval && !windowDetected && <p className="window-help">Scrub through the bundled ephemeris. Only a simultaneous Sun-and-Earth clearance can be recorded.</p>}
    </section>

    {choosingSite && <LunarSiteMap sites={landingSites} records={records} selectedSiteId={selectedMissionSiteId} onSelect={setSelectedMissionSiteId} onConfirm={commitPlan} onBack={() => { setChoosingSite(false); setSelectedMissionSiteId(''); }} />}

    <div className="planner-scene-caption"><b>SITE-SURFACE VIEW</b><span>Sun and Earth directions use this site’s sampled ephemeris and terrain horizon. Drag to look around.</span></div>
    <footer className="planner-timeline"><div className="timeline-labels"><span>SUPPORTED DATA RANGE · {range.sampleCount.toLocaleString()} HOURLY SAMPLES</span><b>{formatUtc(planTime)}</b><span>{Math.round(progress * 100)}%</span></div><input aria-label="Scrub supported ephemeris time" type="range" min={range.start.getTime()} max={range.end.getTime()} step={STEP} value={planTime} onChange={(event) => scrub(event.target.value)} /><div className="timeline-ends"><span>{formatUtc(range.start)}</span><span>{formatUtc(range.end)}</span></div><div className="timeline-controls"><button type="button" onClick={() => scrub(planTime - DAY)}>− 1 DAY</button><button type="button" onClick={() => scrub(planTime - 3600000)}>− 1 HOUR</button><button type="button" onClick={() => scrub(planTime + 3600000)}>+ 1 HOUR</button><button type="button" onClick={() => scrub(planTime + DAY)}>+ 1 DAY</button><small>Planning scrub is independent from the mission countdown. Supported interval: {formatDuration(range.end.getTime() - range.start.getTime())}.</small></div></footer>

    <div className="planner-science-note">Candidate surface operating window = Sun and Earth both geometrically above the local terrain skyline. This dataset contains site-level azimuth/elevation, not a global Earth–Moon–Sun orbit, so the scene shows local sky directions; body distances and sizes are schematic. Ephemeris samples are hourly and boundaries use interpolation. After commitment, the prep schedule maps one dataset day to one gameplay minute (capped at 26m40s); it is not a launch-time or transfer calculation.</div>
  </main>;
}

export default MissionPlanning;
