import {
  calculateEarthPosition,
  calculateSunPosition,
  getBestOverlap,
  getVisibilitySummary
} from '../utils/ephemerisRuntime';
import landingSites from '../data/landingSites.json';

const ComparisonPanel = ({ selectedDate, onClose }) => {
  return (
    <aside className="comparison-panel" aria-label="Site comparison">
      <div className="comparison-panel-header">
        <div>
          <span className="panel-kicker">MISSION PLANNING</span>
          <h2>Site comparison</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close comparison">×</button>
      </div>
      <p className="comparison-panel-note">Sun and Earth positions from JPL Horizons, skylines from LOLA terrain, over this 29.53-day lunar day. Geometric visibility only.</p>
      <div className="comparison-grid">
        {landingSites.map((site) => {
          const sun = getVisibilitySummary(selectedDate, calculateSunPosition, site.latitude, site.longitude);
          const earth = getVisibilitySummary(selectedDate, calculateEarthPosition, site.latitude, site.longitude);
          const bestOverlap = getBestOverlap(site.latitude, site.longitude, selectedDate);
          return (
            <section key={site.name} className="comparison-card">
              <strong>{site.name}</strong>
              <span>{Math.abs(site.latitude).toFixed(2)}° S · {Math.abs(site.longitude).toFixed(2)}° E</span>
              <div><b>{sun.visibleHours.toFixed(0)} h</b> Sun visible</div>
              <div><b>{earth.visibleHours.toFixed(0)} h</b> Earth visible</div>
              <small>Best overlap: {bestOverlap?.hours.toFixed(1) || '0.0'} h</small>
            </section>
          );
        })}
      </div>
    </aside>
  );
};

export default ComparisonPanel;
