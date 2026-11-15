import { useState, useEffect, useRef } from 'react';

const TimelineDeck = ({
  time,
  isPlaying,
  timeWarp,
  onTimeWarpChange,
  onTogglePlay,
  onTimeChange,
  onStep,
  windowStart,
  nextSunTransition,
  nextEarthTransition,
  sunBands,
  earthBands,
  onJumpTo,
  bestWindow,
  telemetry,
  viewMode,
  cameraInfo
}) => {
  const [timeString, setTimeString] = useState(time.toISOString().replace('T', ' ').replace('Z', ' UTC'));
  const [dateSliderValue, setDateSliderValue] = useState(time.getTime());
  const scrubRef = useRef(null);
  const isScrubbingRef = useRef(false);

  // Update time display when time prop changes
  useEffect(() => {
    setTimeString(time.toISOString().replace('T', ' ').replace('Z', ' UTC'));
    if (!isScrubbingRef.current) {
      setDateSliderValue(time.getTime());
    }
  }, [time]);

  const handlePlayPause = () => {
    onTogglePlay(!isPlaying);
  };

  const handleStepBack = () => {
    onStep(-timeWarp);
  };

  const handleStepForward = () => {
    onStep(timeWarp);
  };

  const handleTimeWarpChange = (e) => {
    onTimeWarpChange(parseInt(e.target.value));
  };

  const handleDateChange = (event) => {
    const newTime = new Date(Number(event.currentTarget.value));
    if (!isNaN(newTime.getTime())) {
      setDateSliderValue(newTime.getTime());
      onTimeChange(newTime);
    }
  };

  const handleScrubStart = (event) => {
    isScrubbingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleScrubEnd = (event) => {
    isScrubbingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const updateTimeFromPointer = (event) => {
    const slider = scrubRef.current;
    if (!slider) return;
    const rect = slider.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const min = windowStart.getTime();
    const max = min + 29.53 * 86400000;
    const nextTime = new Date(min + ratio * (max - min));
    setDateSliderValue(nextTime.getTime());
    onTimeChange(nextTime);
  };

  const handleMarkerPointerDown = (event) => {
    isScrubbingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateTimeFromPointer(event);
  };

  const handleMarkerPointerMove = (event) => {
    if (isScrubbingRef.current) updateTimeFromPointer(event);
  };

  const handleMarkerPointerUp = (event) => {
    isScrubbingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // Format values for telemetry gauges
  const formatArrayFlux = (power) => {
    // Simplified conversion from solar power to array flux
    const flux = power * 0.795; // Arbitrary conversion factor
    return `${Math.round(flux)} W`;
  };

  const formatDteSnr = (snr) => {
    if (snr < 0) return 'N/A dB';
    return `${snr.toFixed(1)} dB`;
  };

  // Footer readouts of the live camera: which view, how wide, and which way it is pointing.
  const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const viewLabel = viewMode === 'free' ? 'FREE VIEW' : 'POV / SURFACE CAM';
  const fovLabel = cameraInfo ? `${cameraInfo.fov.toFixed(0)}°` : '—';
  const centerAzLabel = cameraInfo
    ? `${cameraInfo.centerAz.toFixed(1)}° ${COMPASS_POINTS[Math.round(cameraInfo.centerAz / 45) % 8]}`
    : '—';

  const timelineDuration = 29.53 * 86400000;
  const timelineProgress = Math.max(
    0,
    Math.min(100, ((dateSliderValue - windowStart.getTime()) / timelineDuration) * 100)
  );

  return (
    <div className="timeline-deck">
      {/* Top Sub-Bar */}
      <div className="timeline-deck-top">
        {/* Left Section */}
        <div className="timeline-deck-view">
          <button
            type="button"
            className="timeline-deck-pill"
            aria-label="Current camera view"
          >
            {viewLabel}
          </button>

          <div className="timeline-deck-meta">
            <span>FOV:</span>
            <strong>{fovLabel}</strong>
          </div>

          <div className="timeline-deck-meta">
            <span>Center Az:</span>
            <strong>{centerAzLabel}</strong>
          </div>
        </div>

        {/* Center: Interactive Legend toggles */}
        <div className="timeline-deck-legend">
          <div><span className="timeline-legend-swatch sun" />Sun Trajectory</div>
          <div><span className="timeline-legend-swatch earth" />Earth Trajectory</div>
          <div><span className="timeline-legend-swatch terrain" />Crater Rim</div>
        </div>

        {/* Right Section (hidden on small screens) */}
        <div className="timeline-deck-top-right">
          {/* Would contain additional controls if needed */}
        </div>
      </div>

      {/* Time Warp & Scrubbing Controls */}
      <div className="timeline-deck-middle">
        <div className="timeline-deck-controls">
          {/* Media Controls */}
          <div className="timeline-deck-media">
            <button
              type="button"
              onClick={handleStepBack}
              className="timeline-media-button timeline-step-button"
              aria-label="Step back"
            >
              ◀
            </button>

            <button
              type="button"
              onClick={handlePlayPause}
              className={`timeline-media-button timeline-play-button${isPlaying ? ' is-playing' : ''}`}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>

            <button
              type="button"
              onClick={handleStepForward}
              className="timeline-media-button timeline-step-button"
              aria-label="Step forward"
            >
              ▶
            </button>
          </div>

          {/* Speed Multiplier Dropdown */}
          <div className="timeline-deck-speed">
            <span>Speed</span>
            <select
              value={timeWarp}
              onChange={handleTimeWarpChange}
              className="timeline-deck-select"
              aria-label="Time speed"
            >
              {/* The value is hours of mission time added per second of playback (and per step click). */}
              <option value={1}>1x (1 h/sec)</option>
              <option value={2}>2x (2 h/sec)</option>
              <option value={4}>4x (4 h/sec)</option>
              <option value={6}>6x (6 h/sec)</option>
              <option value={12}>12x (12 h/sec)</option>
              <option value={24}>24x (1 day/sec)</option>
              <option value={3600}>3600x (150 days/sec)</option>
              <option value={86400}>86400x (3600 days/sec)</option>
            </select>
          </div>
          <div className="timeline-jump-actions">
            <button type="button" onClick={() => onJumpTo('sun')} disabled={!nextSunTransition}>
              {nextSunTransition ? 'Next sunrise' : 'Sunrise: none left this lunar day'}
            </button>
            <button type="button" onClick={() => onJumpTo('earth')} disabled={!nextEarthTransition}>
              {nextEarthTransition ? 'Next Earth rise' : 'Earth rise: none left this lunar day'}
            </button>
            <button type="button" onClick={() => onJumpTo('best')}>Best overlap</button>
            <span>{bestWindow ? `Best overlap ${bestWindow.hours.toFixed(1)} h` : 'No overlap found'}</span>
          </div>
        </div>

        {/* Interactive Date Slider (Scrub Bar) */}
        <div className="timeline-deck-scrubber">
          <div className="timeline-deck-time">
            <span>MISSION TIME</span>
            <span>{timeString}</span>
          </div>

          <div className="timeline-slider-wrap">
            <div
              className="timeline-scrub-progress"
              style={{ width: `${timelineProgress}%` }}
              aria-hidden="true"
            />
            <div
              className="timeline-current-marker"
              style={{ left: `${timelineProgress}%` }}
              role="slider"
              aria-label="Mission timeline position"
              aria-valuemin={windowStart.getTime()}
              aria-valuemax={windowStart.getTime() + 29.53 * 86400000}
              aria-valuenow={dateSliderValue}
              tabIndex={0}
              onPointerDown={handleMarkerPointerDown}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={handleMarkerPointerUp}
              onPointerCancel={handleMarkerPointerUp}
            />
            <input
              type="range"
              min={windowStart.getTime()}
              max={windowStart.getTime() + 29.53 * 86400000}
              step={3600000} // 1 hour steps
              value={dateSliderValue}
              onChange={handleDateChange}
              onInput={handleDateChange}
              onPointerDown={handleScrubStart}
              onPointerUp={handleScrubEnd}
              onPointerCancel={handleScrubEnd}
              ref={scrubRef}
              className="timeline-deck-slider"
              aria-label="Mission timeline"
            />

            {/* Milestone markers */}
            <div className="timeline-deck-milestones" aria-hidden="true">
              <span>{windowStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span>{new Date(windowStart.getTime() + 7.38 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <strong>29.53 DAYS</strong>
              <span>{new Date(windowStart.getTime() + 22.15 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span>{new Date(windowStart.getTime() + 29.53 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="timeline-visibility-bands" aria-hidden="true">
              {sunBands.map((band) => (
                <span
                  key={`sun-${band.left}`}
                  className="timeline-band-sun"
                  style={{ left: `${band.left}%`, width: `${band.width}%` }}
                />
              ))}
              {earthBands.map((band) => (
                <span
                  key={`earth-${band.left}`}
                  className="timeline-band-earth"
                  style={{ left: `${band.left}%`, width: `${band.width}%` }}
                />
              ))}
            </div>
          </div>

          {/* Real-time status indicators */}
          <div className="timeline-deck-status">
            <span>{telemetry.isSunVisible ? 'Next sunset' : 'Sunrise'}: {nextSunTransition ? `${Math.round(nextSunTransition.hours)} h` : 'none left this lunar day'}</span>
            <span>{telemetry.isEarthVisible ? 'Earth visible' : 'Earth hidden'}: {nextEarthTransition ? `${Math.round(nextEarthTransition.hours)} h transition` : 'no change left this lunar day'}</span>
          </div>
        </div>
      </div>

      {/* Right Telemetry Gauges (SVG / Recharts) */}
      <div className="timeline-deck-bottom">
        {/* Array Flux Gauge */}
        <div className="timeline-gauge">
          <span className="timeline-gauge-icon solar">⚡</span>
          <div>
            <span>Array Flux</span>
            <strong>{formatArrayFlux(telemetry.solarPower)}</strong>
          </div>
        </div>

        {/* DTE SNR Gauge */}
        <div className="timeline-gauge">
          <span className="timeline-gauge-icon radio">⌁</span>
          <div>
            <span>DTE SNR</span>
            <strong>{formatDteSnr(telemetry.dteSnr)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelineDeck;