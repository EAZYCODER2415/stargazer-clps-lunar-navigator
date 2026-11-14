import { useState } from 'react';
import { ChevronDown, CircleQuestionMark, RotateCcw } from 'lucide-react';
import { calculateEarthPosition, calculateSunPosition, clearanceOf } from '../utils/ephemerisRuntime';
import landingSites from '../data/landingSites.json';

const Header = ({
  time,
  selectedSite,
  onSiteChange,
  viewMode,
  onViewModeChange,
  onHelpClick,
  verdict,
  sunVisibleHours,
  earthVisibleHours
}) => {
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const [isVerdictOpen, setIsVerdictOpen] = useState(false);
  const sun = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
  const earth = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
  // Visible = above the real LOLA skyline, not just above 0°
  const sunUp = clearanceOf(sun, selectedSite.latitude, selectedSite.longitude) > 0;
  const earthUp = clearanceOf(earth, selectedSite.latitude, selectedSite.longitude) > 0;
  // To the minute: the header has to fit a 1366 px wide screen, and the timeline shows the full time.
  const utcTime = `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  const handleSiteChange = (site) => {
    onSiteChange(site);
    setIsSiteMenuOpen(false);
  };

  return (
    <header className="mission-header">
      <div className="mission-header-brand">
        <div>
          <h1>Stargazer</h1>
          <span className="mission-header-subtitle">NASA CLPS · ARTEMIS</span>
        </div>
        <span className="mission-header-badge">CLASS SIM</span>
      </div>

      <div className="mission-header-site">
        <button
          type="button"
          className="mission-header-site-button"
          onClick={() => setIsSiteMenuOpen((isOpen) => !isOpen)}
          aria-expanded={isSiteMenuOpen}
          aria-haspopup="listbox"
        >
          <span>
            <small>LANDING SITE</small>
            {selectedSite.name} ({Math.abs(selectedSite.latitude).toFixed(2)}° S, {Math.abs(selectedSite.longitude).toFixed(2)}° E)
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
        {isSiteMenuOpen && (
          <div className="mission-header-site-menu" role="listbox" aria-label="Landing site">
            {landingSites.map((site) => (
              <button
                type="button"
                key={site.name}
                role="option"
                aria-selected={site.name === selectedSite.name}
                onClick={() => handleSiteChange(site)}
              >
                {site.name}
                <small>
                  {Math.abs(site.latitude).toFixed(2)}° S, {Math.abs(site.longitude).toFixed(2)}° E
                </small>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="mission-verdict mission-header-verdict"
        onClick={() => setIsVerdictOpen((isOpen) => !isOpen)}
        aria-expanded={isVerdictOpen}
        aria-haspopup="dialog"
        title="see verdict message"
      >
        <strong>🌍 Direct radio contact is {sunUp && earthUp ? 'possible' : 'impossible'}</strong>
      </button>
      {isVerdictOpen && (
        <div className="mission-verdict-popup" role="dialog" aria-label="Verdict message">
          <strong>{verdict}</strong>
          <span>
            {sunVisibleHours.toFixed(0)} h Sun / {earthVisibleHours.toFixed(0)} h Earth visible in this 29.53-day lunar day
            {' · '}Celestial disc sizes exaggerated for visibility
          </span>
        </div>
      )}

      <div className="mission-header-telemetry">
        <div className="mission-header-reading mission-header-utc">
          <span>UTC / MET</span>
          <strong>{utcTime}</strong>
        </div>
        <div className="mission-header-reading">
          <span>SOLAR ELEV</span>
          <strong className="solar">{sun.elevation >= 0 ? '+' : ''}{sun.elevation.toFixed(2)}° ({sunUp ? 'Illuminated' : 'Night'})</strong>
        </div>
        <div className="mission-header-reading">
          <span>DTE LINK</span>
          <strong className="dte">{earthUp ? 'NOMINAL' : 'BELOW HORIZON'} ({earth.elevation >= 0 ? '+' : ''}{earth.elevation.toFixed(1)}° Elev)</strong>
        </div>
      </div>

      <div className="mission-header-actions">
        <button
          type="button"
          className="mission-header-icon-button"
          onClick={() => onViewModeChange('surface')}
          aria-label="Reset to surface view"
          title="Reset to surface view"
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mission-header-icon-button"
          onClick={onHelpClick}
          aria-label="Help and glossary"
          title="Help and glossary"
        >
          <CircleQuestionMark aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

export default Header;
