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
  telemetry
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
            FREE VIEW
          </button>

          <div className="timeline-deck-meta">
            <span>FOV:</span>
            <strong>62° Wide</strong>
          </div>

          <div className="timeline-deck-meta">
            <span>Center Az:</span>
            <strong>180.0° S</strong>
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
              <option value={1}>1x (1h/sec)</option>
              <option value={2}>2x (2h/sec)</option>
              <option value={4}>4x (4h/sec)</option>
              <option value={6}>6x (6h/sec)</option>
              <option value={12}>12x (12h/sec)</option>
              <option value={24}>24x (24h/sec)</option>
              <option value={3600}>3600x (1h / sec)</option>
              <option value={86400}>86400x (1d / sec)</option>
            </select>
          </div>
        </div>

        {/* Interactive Date Slider (Scrub Bar) */}
        <div className="timeline-deck-scrubber">
          <div className="timeline-deck-time">
            <span>MISSION TIME</span>
            <span>{timeString}</span>
          </div>

          <div className="timeline-slider-wrap">
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
            <span>{telemetry.isSunVisible ? 'Next sunset' : 'Sunrise'}: {Math.round(nextSunTransition?.hours || 0)} h</span>
            <span>{telemetry.isEarthVisible ? 'Earth visible' : 'Earth hidden'}: {Math.round(nextEarthTransition?.hours || 0)} h transition</span>
          </div>
          <div className="timeline-jump-actions">
            <button type="button" onClick={() => onJumpTo('sun')}>Next sunrise</button>
            <button type="button" onClick={() => onJumpTo('earth')}>Next Earth rise</button>
            <button type="button" onClick={() => onJumpTo('best')}>Best overlap</button>
            <span>{bestWindow ? `Best overlap ${bestWindow.hours.toFixed(1)} h` : 'No overlap found'}</span>
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