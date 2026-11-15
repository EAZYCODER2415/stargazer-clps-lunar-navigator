import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LunarScene3D from './components/LunarScene3D';
import Header from './components/Header';
import CameraControls from './components/CameraControls';
import ToolDock from './components/ToolDock';
import TimelineDeck from './components/TimelineDeck';
import {
  calculateSunPosition,
  calculateEarthPosition,
  findNextHorizonTransition,
  getVisibilityBands,
  getVisibilitySummary,
  clearanceOf,
  getBestOverlap
} from './utils/ephemerisRuntime';
import './styles/horizonTracker.css';
import ComparisonPanel from './components/ComparisonPanel';
import HelpCard from './components/HelpCard';
import landingSites from './data/landingSites.json';

const LUNAR_DAY_MS = 29.53 * 86400000;

function App() {
  const initialTime = new Date('2026-12-01T00:00:00Z');
  const [time, setTime] = useState(initialTime);
  const [windowStart] = useState(initialTime);
  // Mission time never leaves the one lunar day shown on the seek bar.
  const windowEnd = useMemo(() => new Date(windowStart.getTime() + LUNAR_DAY_MS), [windowStart]);
  const setClampedTime = useCallback((nextTime) => {
    const clamped = Math.max(windowStart.getTime(), Math.min(windowEnd.getTime(), nextTime.getTime()));
    setTime(new Date(clamped));
  }, [windowStart, windowEnd]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeWarp, setTimeWarp] = useState(1); // 1x speed
  const [activeTool, setActiveTool] = useState('view-modes');
  const [selectedSite, setSelectedSite] = useState(landingSites[0]);
  const [viewMode, setViewMode] = useState('surface'); // 'surface' or 'free'
  const [cameraPan, setCameraPan] = useState({ yaw: 0, pitch: 0 });
  const [showSolarFlux, setShowSolarFlux] = useState(true);
  const [showDTELink, setShowDTELink] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showHorizonMask, setShowHorizonMask] = useState(false);   // survey grid over the ground: off until asked for
  const [invertLook, setInvertLook] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showInterface, setShowInterface] = useState(true);
  const [cameraSensitivity, setCameraSensitivity] = useState(1.8);
  const [cameraInfo, setCameraInfo] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  // Free View flying. The 3D scene reads this every frame: `forward` / `right` are -1, 0 or 1 while
  // move keys are held, `boost` is Shift, and `stepForward` / `stepRight` count clicks on the on-screen pad.
  const freeMoveRef = useRef({ forward: 0, right: 0, boost: false, stepForward: 0, stepRight: 0 });
  const handleFreeMoveKeys = useCallback((held, boost) => {
    const moves = freeMoveRef.current;
    moves.forward = (held.up ? 1 : 0) - (held.down ? 1 : 0);
    moves.right = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    moves.boost = boost;
  }, []);
  const handleLookDrag = useCallback((yawDegrees, pitchDegrees) => {
    setCameraPan((current) => ({
      yaw: current.yaw + yawDegrees,
      pitch: Math.max(-60, Math.min(80, current.pitch + pitchDegrees))
    }));
  }, []);

  // Calculate telemetry values using proper ephemeris
  const calculateTelemetry = () => {
    const sunPos = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
    const earthPos = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);

    // Simplified power calculation based on Sun elevation
    // In reality, this would involve atmospheric extinction, solar panel orientation, etc.
    const sunElevationFactor = Math.max(0, Math.sin(sunPos.elevation * Math.PI / 180));
    const solarPower = sunElevationFactor * 400; // Max 400W when Sun at zenith

    // Simplified DTE SNR based on Earth elevation and distance
    // In reality, this would involve link budget calculations
    const earthElevationFactor = Math.max(0, Math.sin(earthPos.elevation * Math.PI / 180));
    const dteSnr = earthElevationFactor * 20 - 5; // Range from -5 to +15 dB

    return {
      solarPower: Math.max(0, solarPower),
      dteSnr: dteSnr,
      isSunVisible: clearanceOf(sunPos, selectedSite.latitude, selectedSite.longitude) > 0,
      isEarthVisible: clearanceOf(earthPos, selectedSite.latitude, selectedSite.longitude) > 0
    };
  };

  const telemetry = calculateTelemetry();

  const handleCameraPan = useCallback((direction, amount = 1) => {
    const increments = {
      up: { yaw: 0, pitch: 6 },
      down: { yaw: 0, pitch: -6 },
      left: { yaw: 8, pitch: 0 },
      right: { yaw: -8, pitch: 0 }
    };
    const increment = increments[direction];
    if (!increment) return;
    if (viewMode === 'free') {
      // In Free View the on-screen pad moves the camera a short hop instead of turning it.
      // (Held keys are reported separately, through handleFreeMoveKeys.)
      const steps = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] }[direction];
      freeMoveRef.current.stepForward += steps[0] * amount;
      freeMoveRef.current.stepRight += steps[1] * amount;
      return;
    }
    const sign = invertLook ? -1 : 1;

    setCameraPan((current) => ({
      yaw: current.yaw + increment.yaw * sign * amount,
      pitch: Math.max(-35, Math.min(35, current.pitch + increment.pitch * sign * amount))
    }));
  }, [invertLook, viewMode]);

  const resetCameraPan = useCallback(() => setCameraPan({ yaw: 0, pitch: 0 }), []);
  const lookAt = useCallback((body) => {
    const position = body === 'sun'
      ? calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude)
      : calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
    setCameraPan({
      yaw: -(position.azimuth > 180 ? position.azimuth - 360 : position.azimuth),
      pitch: Math.max(-35, Math.min(35, position.elevation))
    });
  }, [selectedSite, time]);

  const timeInterval = useRef(null);
  const timeRef = useRef(time);     // latest time, for the playback timer
  useEffect(() => { timeRef.current = time; }, [time]);

  useEffect(() => () => clearInterval(timeInterval.current), []);

  useEffect(() => {
    clearInterval(timeInterval.current);
    if (!isPlaying) return undefined;

    timeInterval.current = setInterval(() => {
      // Playback stops at the end of the lunar day and holds the final positions.
      const next = Math.min(timeRef.current.getTime() + timeWarp * 3600000, windowEnd.getTime());
      setTime(new Date(next));
      if (next >= windowEnd.getTime()) setIsPlaying(false);
    }, 1000);

    return () => clearInterval(timeInterval.current);
  }, [isPlaying, timeWarp, windowEnd]);

  const togglePlay = () => {
    // Pressing play at the very end starts the lunar day again from the beginning.
    if (!isPlaying && time.getTime() >= windowEnd.getTime()) setTime(windowStart);
    setIsPlaying((playing) => !playing);
  };
  const handleTimeChange = (nextTime) => setClampedTime(nextTime);
  const handleStep = (hours) => setClampedTime(new Date(time.getTime() + hours * 3600000));

  // Both searches stop at the end of the lunar day; null means no more rises or sets before then.
  // They walk the ephemeris in half-hour steps, so they are redone only when the time or site changes,
  // not every time the camera turns and this component re-renders.
  const nextSunTransition = useMemo(
    () => findNextHorizonTransition(time, calculateSunPosition, selectedSite.latitude, selectedSite.longitude, windowEnd),
    [time, selectedSite, windowEnd]
  );
  const nextEarthTransition = useMemo(
    () => findNextHorizonTransition(time, calculateEarthPosition, selectedSite.latitude, selectedSite.longitude, windowEnd),
    [time, selectedSite, windowEnd]
  );
  const sunSummary = useMemo(
    () => getVisibilitySummary(windowStart, calculateSunPosition, selectedSite.latitude, selectedSite.longitude),
    [windowStart, selectedSite]
  );
  const earthSummary = useMemo(
    () => getVisibilitySummary(windowStart, calculateEarthPosition, selectedSite.latitude, selectedSite.longitude),
    [windowStart, selectedSite]
  );
  const sunBands = useMemo(
    () => getVisibilityBands(windowStart, calculateSunPosition, selectedSite.latitude, selectedSite.longitude),
    [windowStart, selectedSite]
  );
  const earthBands = useMemo(
    () => getVisibilityBands(windowStart, calculateEarthPosition, selectedSite.latitude, selectedSite.longitude),
    [windowStart, selectedSite]
  );
  const bestWindow = useMemo(
    () => getBestOverlap(selectedSite.latitude, selectedSite.longitude, windowStart),
    [selectedSite, windowStart]
  );
  const handleJumpTo = (target) => {
    if (target === 'best' && bestWindow) return setClampedTime(bestWindow.time);
    const transition = target === 'sun' ? nextSunTransition : nextEarthTransition;
    if (transition) setClampedTime(transition.time);
  };
  // Radio contact depends on Earth being visible; power depends on the Sun. Four cases.
  const sunReturns = nextSunTransition
    ? `The Sun rises in ${Math.round(nextSunTransition.hours)} hours.`
    : 'The Sun stays down for the rest of this lunar day.';
  const earthReturns = nextEarthTransition
    ? `Earth rises in ${Math.round(nextEarthTransition.hours)} hours.`
    : 'Earth stays hidden for the rest of this lunar day.';
  let verdict;
  if (telemetry.isSunVisible && telemetry.isEarthVisible) {
    verdict = 'Sun and Earth are both visible: solar power and direct radio contact are available.';
  } else if (telemetry.isEarthVisible) {
    verdict = `Earth is visible, so the direct radio link is open. The Sun is hidden, so there is no solar power. ${sunReturns}`;
  } else if (telemetry.isSunVisible) {
    verdict = `The Sun is visible, so there is solar power. Earth is hidden, so there is no direct radio contact. ${earthReturns}`;
  } else {
    verdict = `Neither the Sun nor Earth is visible: no solar power and no direct radio contact. ${sunReturns} ${earthReturns}`;
  }

  return (
    <div className="app">
      <LunarScene3D
        time={time}
        windowStart={windowStart}
        selectedSite={selectedSite}
        showSolarFlux={showSolarFlux}
        showDTELink={showDTELink}
        showGrid={showGrid}
        showHorizonMask={showHorizonMask}
        cameraYaw={cameraPan.yaw}
        cameraPitch={cameraPan.pitch}
        useTerrain
        viewMode={viewMode}
        viewResetCount={0}
        invertLook={invertLook}
        onLookDrag={handleLookDrag}
        onCameraInfo={setCameraInfo}
        cameraInfo={cameraInfo}
        showInterface={showInterface}
        freeMoveRef={freeMoveRef}
        lookSensitivity={cameraSensitivity}
      />

      <div className="overlay-container">
        <div className="azimuth-layer" aria-label="Azimuth map layer" />
        {showInterface && (
          <>
            <Header
              time={time}
              selectedSite={selectedSite}
              onSiteChange={setSelectedSite}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onHelpClick={() => setShowHelp((visible) => !visible)}
              verdict={verdict}
              sunVisibleHours={sunSummary.visibleHours}
              earthVisibleHours={earthSummary.visibleHours}
            />
            {showHelp && <HelpCard onClose={() => setShowHelp(false)} />}
          </>
        )}
        <CameraControls
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onPan={handleCameraPan}
          onFreeMoveKeys={handleFreeMoveKeys}
          onResetPan={resetCameraPan}
          invertLook={invertLook}
          onInvertLookChange={setInvertLook}
          onLookAt={lookAt}
          sensitivity={cameraSensitivity}
          isHidden={!showInterface}
        />
        {/* Right Vertical Tool Dock */}
        <ToolDock
          activeTool={activeTool}
          onToolChange={setActiveTool}
          showSolarFlux={showSolarFlux}
          onShowSolarFluxChange={setShowSolarFlux}
          showDTELink={showDTELink}
          onShowDTELinkChange={setShowDTELink}
          showGrid={showGrid}
          onShowGridChange={setShowGrid}
          showHorizonMask={showHorizonMask}
          onShowHorizonMaskChange={setShowHorizonMask}
          showInterface={showInterface}
          onToggleInterface={() => setShowInterface((visible) => !visible)}
          cameraSensitivity={cameraSensitivity}
          onCameraSensitivityChange={setCameraSensitivity}
        />

        {showInterface && (
          <>
            <TimelineDeck
              time={time}
              isPlaying={isPlaying}
              timeWarp={timeWarp}
              onTimeWarpChange={setTimeWarp}
              onTogglePlay={togglePlay}
              onTimeChange={handleTimeChange}
              onStep={handleStep}
              windowStart={windowStart}
              nextSunTransition={nextSunTransition}
              nextEarthTransition={nextEarthTransition}
              sunSummary={sunSummary}
              earthSummary={earthSummary}
              sunBands={sunBands}
              earthBands={earthBands}
              onJumpTo={handleJumpTo}
              bestWindow={bestWindow}
              telemetry={telemetry}
              viewMode={viewMode}
              cameraInfo={cameraInfo}
            />
            {showComparison && (
              <ComparisonPanel selectedSite={selectedSite} selectedDate={windowStart} onClose={() => setShowComparison(false)} />
            )}
            {!showComparison && (
              <button type="button" className="compare-launch-button" onClick={() => setShowComparison(true)}>
                Compare sites
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;