import { useState } from 'react';
import { ChevronDown, RotateCcw, Settings } from 'lucide-react';
import { calculateEarthPosition, calculateSunPosition } from '../utils/ephemerisRuntime';
import landingSites from '../data/landingSites.json';

const Header = ({
  time,
  selectedSite,
  onSiteChange,
  viewMode,
  onViewModeChange,
  onSettingsClick
}) => {
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const sun = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
  const earth = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
  const utcTime = time.toISOString().replace('T', ' ').replace('Z', ' UTC');

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
            <small>TARGET</small>
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

      <div className="mission-header-telemetry">
        <div className="mission-header-reading mission-header-utc">
          <span>UTC / MET</span>
          <strong>{utcTime}</strong>
        </div>
        <div className="mission-header-reading">
          <span>SOLAR ELEV</span>
          <strong className="solar">{sun.elevation >= 0 ? '+' : ''}{sun.elevation.toFixed(2)}° ({sun.elevation >= 0 ? 'Illuminated' : 'Night'})</strong>
        </div>
        <div className="mission-header-reading">
          <span>DTE LINK</span>
          <strong className="dte">{earth.elevation > 0 ? 'NOMINAL' : 'BELOW HORIZON'} ({earth.elevation >= 0 ? '+' : ''}{earth.elevation.toFixed(1)}° Elev)</strong>
        </div>
      </div>

      <div className="mission-header-actions">
        <button
          type="button"
          className="mission-header-pov"
          onClick={() => onViewModeChange(viewMode === 'surface' ? 'free' : 'surface')}
          aria-label={`Switch to ${viewMode === 'surface' ? 'free' : 'surface'} view`}
        >
          <span>{viewMode === 'surface' ? '1st POV' : 'FREE VIEW'}</span>
          <small>{viewMode === 'surface' ? 'Surface Cam' : 'Camera'}</small>
        </button>
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
          onClick={onSettingsClick}
          aria-label="Open canvas settings"
          title="Canvas settings"
        >
          <Settings aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

export default Header;
