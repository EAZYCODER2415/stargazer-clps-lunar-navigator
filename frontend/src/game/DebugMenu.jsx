import { useEffect } from 'react';
import { MISSION_STAGES, getStageIndex } from './gameEngine';

// The developer debug window. How it is opened and switched off lives in debugMode.js.
export default function DebugMenu({ state, onJump, onRestart, onClose }) {
  const currentIndex = getStageIndex(state.phase);
  const generated = state.debug?.generated || [];
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="stage-debug-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="stage-debug-window" role="dialog" aria-modal="true" aria-labelledby="stage-debug-title">
      <div className="stage-debug-heading">
        <div><span>DEVELOPER DEBUG MODE</span><h2 id="stage-debug-title">Jump to a mission stage</h2><p>The chosen stage loads paused and starts fresh. Earlier stages you have really finished are kept; anything missing is filled with fixed test data and labelled as debug data. The mission clock keeps its value, except when jumping back to before launch.</p></div>
        <button type="button" className="stage-debug-close" onClick={onClose} aria-label="Close debug menu">×</button>
      </div>
      <div className="stage-debug-options">{MISSION_STAGES.map((stage, index) => <button type="button" key={stage.id} className={index === currentIndex ? 'current' : ''} onClick={() => onJump(stage.id)}><span>{String(index).padStart(2, '0')}</span><b>{stage.label}</b><i>{index === currentIndex ? 'CURRENT · RELOAD' : 'LOAD STAGE →'}</i></button>)}</div>
      {generated.length > 0 && <p className="stage-debug-note"><b>DEBUG TEST DATA IN THIS MISSION:</b> {generated.join('; ')}. Not real mission results or NASA data.</p>}
      <div className="stage-debug-actions">
        <button type="button" onClick={() => onJump(MISSION_STAGES[currentIndex].id)}>Reset current stage</button>
        <button type="button" onClick={onRestart}>Restart entire mission</button>
        <button type="button" className="primary" onClick={onClose}>Close debug menu</button>
      </div>
    </section>
  </div>;
}
