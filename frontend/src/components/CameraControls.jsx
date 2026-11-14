import { useEffect } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';

const CONSTANT_PAN_SPEED_AFTER_ONE_SECOND = 3.3 * 1.75;

const CameraControls = ({
  viewMode,
  onViewModeChange,
  onPan,
  onFreeMoveKeys,
  onResetPan,
  invertLook,
  onInvertLookChange,
  onLookAt,
  sensitivity = 1.8,
  isHidden = false
}) => {
  useEffect(() => {
    const pressed = new Set();
    const velocity = { up: 0, down: 0, left: 0, right: 0 };
    const lastFrame = { value: performance.now() };
    const directionByKey = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right'
    };
    const wasd = { w: 'up', s: 'down', a: 'left', d: 'right' };
    const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
    let frameId;
    // Free View: the keys fly the camera. Instead of panning, tell the app which keys are held
    // (and whether Shift is down); the 3D scene turns that into smooth movement.
    const isFreeView = viewMode === 'free';
    let shiftHeld = false;
    const reportFreeMove = () => onFreeMoveKeys?.(
      { up: pressed.has('up'), down: pressed.has('down'), left: pressed.has('left'), right: pressed.has('right') },
      shiftHeld
    );
    const releaseAll = () => {
      if (!isFreeView) return;
      pressed.clear(); shiftHeld = false;
      reportFreeMove();
    };
    const handleKeyDown = (event) => {
      if (isFreeView && event.key === 'Shift') { shiftHeld = true; reportFreeMove(); return; }
      const direction = directionByKey[event.key] || wasd[event.key.toLowerCase()];
      if (!direction) return;
      event.preventDefault();
      if (isFreeView) {
        pressed.delete(opposite[direction]);
        pressed.add(direction);
        reportFreeMove();
        return;
      }
      pressed.delete(opposite[direction]);
      velocity[opposite[direction]] = 0;
      velocity[direction] = 0;
      pressed.add(direction);
    };
    const handleKeyUp = (event) => {
      if (isFreeView && event.key === 'Shift') { shiftHeld = false; reportFreeMove(); return; }
      const direction = directionByKey[event.key] || wasd[event.key.toLowerCase()];
      if (direction) pressed.delete(direction);
      if (isFreeView && direction) reportFreeMove();
    };
    const animatePan = (now) => {
      const deltaSeconds = Math.min((now - lastFrame.value) / 1000, 0.05);
      lastFrame.value = now;
      if (!isFreeView) ['up', 'down', 'left', 'right'].forEach((direction) => {
        const target = pressed.has(direction) ? CONSTANT_PAN_SPEED_AFTER_ONE_SECOND * sensitivity : 0;
        const rate = (pressed.has(direction) ? 20 : 24) * sensitivity;
        velocity[direction] += (target - velocity[direction]) * Math.min(1, rate * deltaSeconds);
        if (velocity[direction] > 0.01) {
          onPan(direction, velocity[direction] * deltaSeconds);
        } else if (!pressed.has(direction)) {
          velocity[direction] = 0;
        }
      });
      frameId = requestAnimationFrame(animatePan);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAll);       // a key held while the window loses focus must not keep flying
    frameId = requestAnimationFrame(animatePan);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [onPan, sensitivity, viewMode, onFreeMoveKeys]);

  return (
    <div className={`camera-controls${isHidden ? ' is-hidden' : ''}`}>
      <div className="control-group">
        <label htmlFor="view-mode">Camera View:</label>
        <select
          id="view-mode"
          value={viewMode}
          onChange={(e) => onViewModeChange(e.target.value)}
          className="control-select"
        >
          <option value="surface">POV / Surface Cam</option>
          <option value="free">Free View</option>
        </select>
      </div>
      <div className="control-group camera-pan-group">
        <span className="camera-pan-label">POV Pan</span>
        <div className="camera-pan-pad" aria-label="POV camera pan controls">
          <button type="button" aria-label="Pan camera up" onClick={() => onPan('up')}>
            <ChevronUp size={15} />
          </button>
          <button type="button" aria-label="Pan camera left" onClick={() => onPan('left')}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" aria-label="Reset camera pan" onClick={onResetPan}>
            <RotateCcw size={13} />
          </button>
          <button type="button" aria-label="Pan camera right" onClick={() => onPan('right')}>
            <ChevronRight size={15} />
          </button>
          <button type="button" aria-label="Pan camera down" onClick={() => onPan('down')}>
            <ChevronDown size={15} />
          </button>
        </div>
        <span className="camera-pan-hint">
          {viewMode === 'free'
            ? 'Click or press a move key · mouse looks · Shift faster · Esc frees the mouse'
            : `Arrows / WASD · direction ${invertLook ? 'inverted' : 'normal'}`}
        </span>
        <div className="camera-look-actions">
          <button type="button" onClick={() => onLookAt('sun')}>Look at Sun</button>
          <button type="button" onClick={() => onLookAt('earth')}>Look at Earth</button>
        </div>
        <label className="camera-invert-toggle">
          <input type="checkbox" checked={invertLook} onChange={(event) => onInvertLookChange(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
          <span>Invert look direction</span>
        </label>
      </div>
    </div>
  );
};

export default CameraControls;