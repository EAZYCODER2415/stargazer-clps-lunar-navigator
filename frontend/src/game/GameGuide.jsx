function GameGuide({ onClose }) {
  return (
    <div className="guide-backdrop" role="presentation">
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <span className="view-overline">STARGAZER · MISSION CONTROL BRIEFING</span>
        <h2 id="guide-title">Prepare the lander. Choose when to launch.</h2>
        <p>Mission 001 gives you four departments, three scheduled scenario windows, and one robotic lander to send to the Moon.</p>
        <ol>
          <li><strong>Work any department.</strong> Engineering, Launch Operations, Weather and Communications share one mission state. Switching departments does not pause the clock.</li>
          <li><strong>Complete mandatory tasks.</strong> Repair the diagnosed sensor fault, check both critical launch items, configure the simulated receiver, and make a correct weather assessment for the active window.</li>
          <li><strong>Optional checks reduce scenario risk.</strong> The power bus, independent launch review and backup receiver are optional; each subtracts one point from the game risk index.</li>
          <li><strong>Watch the launch timeline.</strong> Three deterministic windows appear. Window 2 has a no-go forecast. You may skip an active window; preparation carries forward.</li>
          <li><strong>Launch only when ready.</strong> Launch is enabled only during an active, assessed GO or CAUTION window after every mandatory gate is met.</li>
          <li><strong>Use pause and speed controls.</strong> At 1×, one game minute passes per real second. Pause freezes the scenario clock and all window transitions.</li>
        </ol>
        <p className="guide-caveat">Window timing, weather, risk and mission outcomes are classroom game scenarios—not real launch forecasts. Stargazer's lunar visibility data is separate from Earth-to-Moon launch planning.</p>
        <button className="game-button primary" onClick={onClose}>Enter Mission Control</button>
      </section>
    </div>
  );
}

export default GameGuide;
