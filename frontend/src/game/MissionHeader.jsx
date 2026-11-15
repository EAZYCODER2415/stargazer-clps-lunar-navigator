export default function MissionHeader({ stageLabel, stageTitle, timeLabel, timeValue, controls, onStageLabelClick, className = '' }) {
  return <header className={`stargazer-header ${className}`}>
    <a className="stargazer-header-brand" href="/">
      <img src="/favicon.svg" alt="" />
      <span><b>STARGAZER · LUNAR MISSION SIMULATOR</b><strong>MISSION 001 <i>GET A ROBOTIC LANDER TO THE MOON</i></strong></span>
    </a>
    <div className="stargazer-header-stage">
      <button type="button" className="stargazer-stage-trigger" onClick={onStageLabelClick} aria-label="Click three times to open the debug stage selector">{stageLabel}</button>
      <strong>{stageTitle}</strong>
    </div>
    <div className="stargazer-header-status">
      <div className="stargazer-header-time"><small>{timeLabel}</small><b>{timeValue}</b></div>
      {controls && <div className="stargazer-header-controls">{controls}</div>}
    </div>
  </header>;
}
