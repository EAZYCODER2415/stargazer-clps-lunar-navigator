function GameGuide({ onClose }) {
  return <div className="guide-backdrop" role="presentation"><section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
    <span className="eyebrow">STARGAZER · MISSION BRIEFING</span>
    <h2 id="guide-title">Get a robotic lander to the Moon</h2>
    <p>Your goal is to complete one guided mission: assemble the vehicle, prepare and launch it, separate the stages, manage a simplified descent, then complete the rover’s first survey.</p>
    <ol><li><b>Build the vehicle.</b> Match eight generic components to their sockets.</li><li><b>Prepare and launch.</b> Complete the pad sequence and assess deterministic training weather during one of three scenario windows.</li><li><b>Manage the mission.</b> Act on staging and descent cues; answer optional science-team questions during transit.</li><li><b>Finish on the Moon.</b> Deploy the rover and review actual local Sun/Earth visibility from existing site data.</li></ol>
    <p className="guide-caveat">The mission starts paused. Slow mode advances one game second per real second; Normal mode advances two. Pause anytime. Launch windows and weather are fictional scenario data. Transit, ascent and landing cues are simplified gameplay, not flight simulations.</p>
    <button type="button" className="game-button primary-action" onClick={onClose}>Begin mission</button>
  </section></div>;
}
export default GameGuide;
