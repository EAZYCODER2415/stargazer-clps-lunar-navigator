import { MAINTENANCE_RECOMMENDED_AFTER, MAINTENANCE_REQUIRED_AFTER } from './gameModel';

function sitePosition(site) {
  return {
    x: 38 + (site.longitude / 360) * 624,
    y: 74 + (90 + site.latitude) * 37,
  };
}

function LunarMapView({ sites, selectedSite, inspectedSite, onInspectSite, committed, robotState, progress, operationsSinceMaintenance, maintenanceStatus, activeOperation }) {
  return (
    <div className="lunar-map-layout">
      <div>
        <div className="site-map-wrap">
          <span className="map-label">SCHEMATIC SITE MAP · STORED COORDINATES · NOT A TERRAIN MAP</span>
          <svg className="site-map" viewBox="0 0 700 300" role="img" aria-label="Schematic map showing the three Stargazer candidate sites at relative positions derived from their stored coordinates.">
            <path className="map-graticule" d="M25 110H675M25 190H675M175 35V265M350 35V265M525 35V265" />
            <path className="map-outline" d="M42 56 Q350 22 658 56 V252 Q350 280 42 252Z" />
            {sites.map((site) => {
              const pos = sitePosition(site);
              const isSelected = selectedSite.id === site.id;
              const isInspected = inspectedSite.id === site.id;
              const surveyed = site.id === selectedSite.id && progress.surveys > 0;
              const hasRobot = site.id === selectedSite.id && robotState === 'operational';
              const hasBeacon = site.id === selectedSite.id && progress.beaconDeployed;
              return (
                <g key={site.id} className={`map-site ${isSelected ? 'selected' : ''} ${isInspected ? 'inspected' : ''}`} onClick={() => onInspectSite(site)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspectSite(site); } }} role="button" tabIndex={0} aria-label={`Inspect ${site.name}${isSelected ? ', mission destination' : ''}${surveyed ? ', surveyed' : ''}${hasBeacon ? ', beacon deployed' : ''}`}>
                  <circle className="map-hit-area" cx={pos.x} cy={pos.y} r="25" />
                  <circle className="map-site-dot" cx={pos.x} cy={pos.y} r="7" />
                  {surveyed && <path className="map-check" d={`M${pos.x - 3} ${pos.y + 2}l3 3 6-7`} />}
                  {hasRobot && <g className="map-robot" transform={`translate(${pos.x + 13} ${pos.y - 16})`}><rect x="-7" y="-5" width="14" height="11" rx="2"/><circle cx="-4" cy="8" r="2"/><circle cx="4" cy="8" r="2"/><path d="M0-5v-5m-3 0h6"/></g>}
                  {hasBeacon && <g className="map-beacon" transform={`translate(${pos.x - 12} ${pos.y - 14})`}><path d="M-5 7h10M-3 7V-8h6v15M-3-7h10l-3 4h-7"/></g>}
                  {isSelected && maintenanceStatus !== 'healthy' && hasRobot && <path className={`map-warning ${maintenanceStatus}`} d={`m${pos.x + 18} ${pos.y - 27} 8 14h-16z`} />}
                  <text className="map-site-name" x={pos.x} y={pos.y + 23} textAnchor="middle">{site.name.split(' (')[0]}</text>
                </g>
              );
            })}
            {robotState === 'inTransit' && <text className="map-transit" x="350" y="286" textAnchor="middle">◷ ROBOT IN TRANSIT TO {selectedSite.name.toUpperCase()}</text>}
          </svg>
          <div className="map-legend"><span>● Candidate site</span><span>✓ Surveyed</span><span>▣ Robot deployed</span><span>⚑ Beacon established</span><span>△ Maintenance alert</span></div>
        </div>
      </div>
      <aside className="map-info-card">
        <span className="view-overline">SELECTED DESTINATION</span>
        <h3>{inspectedSite.name}</h3>
        <p>{inspectedSite.latitude.toFixed(4)}°, {inspectedSite.longitude.toFixed(4)}° east</p>
        <dl className="mission-facts">
          <div><dt>Mission role</dt><dd>{committed && selectedSite.id === inspectedSite.id ? 'Committed destination' : 'Candidate site'}</dd></div>
          <div><dt>Robot</dt><dd>{selectedSite.id !== inspectedSite.id ? 'Not deployed here' : robotState === 'operational' ? activeOperation ? 'On surface operation' : 'Operational' : robotState === 'inTransit' ? 'In transit' : 'Not yet launched'}</dd></div>
          <div><dt>Terrain survey</dt><dd>{selectedSite.id === inspectedSite.id && progress.surveys ? `${progress.surveys} completed` : 'Not completed'}</dd></div>
          <div><dt>Infrastructure</dt><dd>{selectedSite.id === inspectedSite.id && progress.beaconDeployed ? 'Outpost beacon deployed' : 'None yet'}</dd></div>
        </dl>
        {robotState === 'operational' && <div className={`maintenance-status ${maintenanceStatus}`}><strong>{maintenanceStatus === 'healthy' ? '● Robot operational' : maintenanceStatus === 'recommended' ? '△ Service recommended' : '▲ Service required'}</strong><span>{maintenanceStatus === 'healthy' ? `${operationsSinceMaintenance} completed operation(s) since last service.` : maintenanceStatus === 'recommended' ? `After ${operationsSinceMaintenance} completed operations, service is recommended at ${MAINTENANCE_RECOMMENDED_AFTER}.` : `The robot reached ${MAINTENANCE_REQUIRED_AFTER} operations without service. Service it before further work.`}</span></div>}
        <small>Click a marker to inspect its status. Marker positions are schematic, using stored coordinates.</small>
      </aside>
    </div>
  );
}

export default LunarMapView;
