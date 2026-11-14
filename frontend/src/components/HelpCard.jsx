import '../styles/helpCard.css';

const TERMS = [
  ['Elevation', 'How high something is above the horizon, in degrees. 0° is the horizon.'],
  ['Azimuth', 'Compass direction. 0° is north, 90° east, 180° south, 270° west.'],
  ['DTE', 'Direct-to-Earth: talking to Earth by radio with no relay. It needs Earth above the horizon.'],
  ['Lunar day', 'One full cycle of day and night on the Moon: 29.5 Earth days.'],
  ['Array power', 'Electricity from the solar panels. It needs the Sun above the horizon.']
];

const HelpCard = ({ onClose }) => (
  <aside className="help-card" aria-label="How to use Stargazer">
    <div className="help-card-header">
      <h2>Start here</h2>
      <button type="button" onClick={onClose} aria-label="Close help">×</button>
    </div>
    <ol>
      <li><b>Pick a landing site</b> in the Landing site menu at the top.</li>
      <li><b>Press play or drag the timeline</b> to move through the lunar day. Gold bars show when the Sun is up, blue bars when Earth is in view.</li>
      <li><b>Drag the scene to look around</b>, scroll to zoom, or use Look at Sun / Look at Earth. Then open <b>Compare sites</b>.</li>
    </ol>
    <dl>
      {TERMS.map(([term, meaning]) => (
        <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>
      ))}
    </dl>
    <button type="button" className="help-card-done" onClick={onClose}>Got it</button>
  </aside>
);

export default HelpCard;
