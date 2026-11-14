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
  createEphemerisTable,
  isAboveHorizon
} from './utils/ephemeris';
import './styles/horizonTracker.css';
import ComparisonPanel from './components/ComparisonPanel';

function App() {
  const initialTime = new Date('2026-10-18T14:19:59Z');
  const [time, setTime] = useState(initialTime);
  const [windowStart] = useState(initialTime);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeWarp, setTimeWarp] = useState(1); // 1x speed
  const [activeTool, setActiveTool] = useState('view-modes');
  const [selectedSite, setSelectedSite] = useState({
    name: 'Malapert Mountain / Massif',
    latitude: -85.99,
    longitude: 2.93
  });
  const [viewMode, setViewMode] = useState('surface'); // 'surface' or 'free'
  const [cameraPan, setCameraPan] = useState({ yaw: 0, pitch: 0 });
  const [showSolarFlux, setShowSolarFlux] = useState(true);
  const [showDTELink, setShowDTELink] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showHorizonMask, setShowHorizonMask] = useState(true);
  const [invertLook, setInvertLook] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showInterface, setShowInterface] = useState(true);
  const [cameraSensitivity, setCameraSensitivity] = useState(1.8);

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
      isSunVisible: isAboveHorizon(sunPos.elevation),
      isEarthVisible: isAboveHorizon(earthPos.elevation)
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
    const sign = invertLook ? -1 : 1;

    setCameraPan((current) => ({
      yaw: current.yaw + increment.yaw * sign * amount,
      pitch: Math.max(-35, Math.min(35, current.pitch + increment.pitch * sign * amount))
    }));
  }, [invertLook]);

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

  useEffect(() => () => clearInterval(timeInterval.current), []);

  useEffect(() => {
    clearInterval(timeInterval.current);
    if (!isPlaying) return undefined;

    timeInterval.current = setInterval(() => {
      setTime((current) => {
        const next = new Date(current.getTime() + timeWarp * 3600000);
        const windowEnd = new Date(windowStart.getTime() + 29.53 * 86400000);
        return next > windowEnd ? windowStart : next;
      });
    }, 1000);

    return () => clearInterval(timeInterval.current);
  }, [isPlaying, timeWarp, windowStart]);

  const togglePlay = () => setIsPlaying((playing) => !playing);
  const handleTimeChange = (nextTime) => setTime(nextTime);
  const handleStep = (hours) => {
    const next = new Date(time.getTime() + hours * 3600000);
    const windowEnd = new Date(windowStart.getTime() + 29.53 * 86400000);
    setTime(next < windowStart ? windowStart : next > windowEnd ? windowEnd : next);
  };

  const nextSunTransition = findNextHorizonTransition(
    time,
    calculateSunPosition,
    selectedSite.latitude,
    selectedSite.longitude
  );
  const nextEarthTransition = findNextHorizonTransition(
    time,
    calculateEarthPosition,
    selectedSite.latitude,
    selectedSite.longitude
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
  const sunTable = useMemo(() => createEphemerisTable(windowStart, calculateSunPosition, selectedSite.latitude, selectedSite.longitude), [windowStart, selectedSite]);
  const earthTable = useMemo(() => createEphemerisTable(windowStart, calculateEarthPosition, selectedSite.latitude, selectedSite.longitude), [windowStart, selectedSite]);
  const bestWindow = useMemo(() => {
    let best = null;
    sunTable.forEach((sample, index) => {
      const earth = earthTable[index];
      if (sample.elevation >= 0 && earth.elevation >= 0) {
        const next = sunTable[index + 1];
        const hours = next ? (next.time - sample.time) / 3600000 : 0;
        if (!best || hours > best.hours) best = { time: sample.time, hours };
      }
    });
    return best;
  }, [sunTable, earthTable]);
  const handleJumpTo = (target) => {
    if (target === 'best' && bestWindow) return setTime(bestWindow.time);
    const transition = target === 'sun' ? nextSunTransition : nextEarthTransition;
    if (transition) setTime(transition.time);
  };
  const verdict = telemetry.isSunVisible
    ? `Sun is visible. Array power is available. Earth is ${telemetry.isEarthVisible ? 'visible, so direct radio contact is possible.' : 'below the horizon.'}`
    : `Sun is down. Rises in ${Math.round(nextSunTransition?.hours || 0)} hours. Earth is ${telemetry.isEarthVisible ? 'visible, so direct radio contact is possible.' : 'below the horizon.'}`;

  return (
    <div className="app">
      <LunarScene3D
        time={time}
        selectedSite={selectedSite}
        showSolarFlux={showSolarFlux}
        showDTELink={showDTELink}
        showGrid={showGrid}
        showHorizonMask={showHorizonMask}
        cameraYaw={cameraPan.yaw}
        cameraPitch={cameraPan.pitch}
        showInterface={showInterface}
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
              onSettingsClick={() => setActiveTool('canvas-settings')}
            />
            <div className="mission-verdict" role="status">
              <strong>{verdict}</strong>
              <span>
                {sunSummary.visibleHours.toFixed(0)} h Sun / {earthSummary.visibleHours.toFixed(0)} h Earth visible in this 29.53-day lunar day
                {' · '}Celestial disc sizes exaggerated for visibility
              </span>
            </div>
          </>
        )}
        <CameraControls
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onPan={handleCameraPan}
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