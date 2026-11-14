function GameGuide({ onClose }) {
  return (
    <div className="guide-backdrop" role="presentation">
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <span className="view-overline">STARGAZER · MISSION CONTROL BRIEFING</span>
        <h2 id="guide-title">Your objective: establish a robotic outpost</h2>
        <p>Compare the candidate locations, commit to one, send Robot 01 to the Moon, survey the site, then deploy the outpost beacon.</p>
        <ol>
          <li><strong>Choose a site.</strong> Review Sun and Earth visibility before committing. After launch, the destination is fixed.</li>
          <li><strong>Manage supplies.</strong> Energy and materials are abstract game units. Sun-visible hours recharge one energy unit per hour at the site.</li>
          <li><strong>Advance mission time.</strong> The robot’s schematic Earth-to-Moon marker moves only when you advance time. Arrival takes six game hours.</li>
          <li><strong>Run surface operations.</strong> Survey is required; exploration is optional. Survey detail depends on Sun visibility, and Earth visibility indicates a geometric reporting opportunity.</li>
          <li><strong>Service the robot.</strong> After two completed operations service is recommended; after three it is required. This deterministic counter is only a game abstraction.</li>
          <li><strong>Switch views.</strong> Mission View shows illustrative transit. Lunar Surface View shows a schematic of the actual candidate site coordinates.</li>
        </ol>
        <p className="guide-caveat">Sun visibility is not a power-system model. Earth visibility is not a communications link budget. Nothing shown here validates landing safety or real spacecraft trajectories.</p>
        <button className="game-button primary" onClick={onClose}>Enter Mission Control</button>
      </section>
    </div>
  );
}

export default GameGuide;
