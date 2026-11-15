import { useEffect, useRef, useState } from 'react';
import { CORRIDOR_CLEARANCE, getCorridorStatus } from './gameEngine';

// Flight corridor clearance: a cutaway of the ascent path from the pad to space.
// The player grabs each obstacle and throws it past a clearance line. Weather is never
// dragged: it is inspected and waited on. Which obstacles are cleared, the weather and
// RANGE CLEAR all live in the mission reducer; this component only animates the throw and
// reports where each obstacle ended up. It is a game, not a real launch-safety assessment.

const W = 300;
const H = 380;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const GROUND_Y = 0.9;
const LEFT_LINE = (0.5 - CORRIDOR_CLEARANCE) * W;
const RIGHT_LINE = (0.5 + CORRIDOR_CLEARANCE) * W;
const LAYERS = [
  { name: 'SPACE', top: 0, fill: '#04070f' },
  { name: 'UPPER ATMOSPHERE', top: 0.14, fill: '#081526' },
  { name: 'STRATOSPHERE', top: 0.36, fill: '#0c2238' },
  { name: 'TROPOSPHERE', top: 0.6, fill: '#11304a' },
];
const NAMES = { bird: 'Bird', kite: 'Kite', drone: 'Drone', balloon: 'Weather balloon' };
// How each kind flies once thrown: air drag, spin in degrees per second, and a speed boost.
const FLIGHT = {
  bird: { drag: 0.5, spin: 0, boost: 1.35 },
  kite: { drag: 1.1, spin: 260, boost: 1 },
  drone: { drag: 0.9, spin: 900, boost: 1 },
  balloon: { drag: 1.5, spin: 70, boost: 0.9 },
};

function ObstacleArt({ kind }) {
  if (kind === 'bird') return <g className="art-bird"><path className="wing" d="M-13 3 Q-7 -9 0 0 Q7 -9 13 3" /><circle r="2.6" cy="1" /></g>;
  if (kind === 'kite') return <g className="art-kite"><path d="M0 -13 L9 0 L0 13 L-9 0 Z" /><path className="tail" d="M0 13 q5 5 0 9 q-5 4 0 8" /></g>;
  if (kind === 'drone') return <g className="art-drone"><path className="arm" d="M-11 -5 L11 5 M-11 5 L11 -5" /><rect x="-5" y="-3.5" width="10" height="7" rx="2" /><ellipse className="rotor" cx="-11" cy="-5" rx="5" ry="1.6" /><ellipse className="rotor" cx="11" cy="-5" rx="5" ry="1.6" /><ellipse className="rotor" cx="-11" cy="5" rx="5" ry="1.6" /><ellipse className="rotor" cx="11" cy="5" rx="5" ry="1.6" /></g>;
  return <g className="art-balloon"><ellipse rx="9" ry="11" cy="-4" /><path d="M-3 7 L3 7 L0 10 Z" /><path className="tail" d="M0 10 q3 5 0 9" /></g>;
}

export default function FlightCorridor({ state, dispatch }) {
  const status = getCorridorStatus(state);
  const { weather } = status;
  const svgRef = useRef(null);
  // Obstacles the player is holding or that are in flight. The ref is the working copy for
  // the animation; `inHand` is the snapshot that gets drawn. Everything else is drawn from mission state.
  const bodies = useRef({});
  const weatherPress = useRef(null);
  const [inHand, setInHand] = useState({});
  const [shakes, setShakes] = useState(0);
  const redraw = () => setInHand(Object.fromEntries(Object.entries(bodies.current).map(([id, body]) => [id, { x: body.x, y: body.y, rot: body.rot, mode: body.mode }])));

  const toLocal = (event) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x / W, y: point.y / H };
  };

  // Throw animation only. It never decides an outcome: when an obstacle crosses a clearance
  // line or comes to rest, its position goes to the reducer, which rules on it.
  useEffect(() => {
    let frame = 0;
    let last = null;
    const step = (now) => {
      const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      let moving = false;
      for (const [id, body] of Object.entries(bodies.current)) {
        if (body.mode !== 'flying') continue;
        moving = true;
        const flight = FLIGHT[body.kind] || FLIGHT.kite;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        const slow = Math.exp(-(body.out ? 0.15 : flight.drag) * dt);
        body.vx *= slow;
        body.vy *= slow;
        if (body.kind === 'balloon') body.vy -= 0.12 * dt;
        body.rot += body.spin * dt;
        if (!body.out && (body.y < 0.05 || body.y > 0.84)) { body.y = clamp(body.y, 0.05, 0.84); body.vy *= -0.65; }
        if (!body.out && Math.abs(body.x - 0.5) >= CORRIDOR_CLEARANCE) {
          body.out = true;
          const away = Math.sign(body.x - 0.5) || 1;
          body.vx = away * Math.max(Math.abs(body.vx), 0.9);
          dispatch({ type: 'RELEASE_OBSTACLE', id, x: body.x, y: body.y });
          setShakes((count) => count + 1);
        } else if (!body.out && Math.hypot(body.vx, body.vy) < 0.07) {
          dispatch({ type: 'RELEASE_OBSTACLE', id, x: body.x, y: body.y });
          delete bodies.current[id];
        } else if (body.out && (body.x < -0.2 || body.x > 1.2 || body.y < -0.3 || body.y > 1.3)) delete bodies.current[id];
      }
      if (moving) setInHand(Object.fromEntries(Object.entries(bodies.current).map(([id, body]) => [id, { x: body.x, y: body.y, rot: body.rot, mode: body.mode }])));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dispatch]);

  const grab = (event, obstacle) => {
    if (event.button !== 0) return;
    const point = toLocal(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const from = bodies.current[obstacle.id] || obstacle;
    bodies.current[obstacle.id] = { kind: obstacle.kind, mode: 'held', pointerId: event.pointerId, x: from.x, y: from.y, dx: from.x - point.x, dy: from.y - point.y, vx: 0, vy: 0, rot: 0, spin: 0, out: false, samples: [{ t: event.timeStamp, x: from.x, y: from.y }] };
    event.preventDefault();
    redraw();
  };
  const move = (event, obstacle) => {
    const body = bodies.current[obstacle.id];
    const point = body?.mode === 'held' && event.pointerId === body.pointerId ? toLocal(event) : null;
    if (!point) return;
    body.x = clamp(point.x + body.dx, 0.03, 0.97);
    body.y = clamp(point.y + body.dy, 0.05, 0.84);
    const now = event.timeStamp;
    body.samples.push({ t: now, x: body.x, y: body.y });
    while (body.samples.length > 2 && now - body.samples[0].t > 110) body.samples.shift();
    redraw();
  };
  const release = (event, obstacle) => {
    const body = bodies.current[obstacle.id];
    if (body?.mode !== 'held' || event.pointerId !== body.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const first = body.samples[0];
    const lastSample = body.samples[body.samples.length - 1];
    const seconds = Math.max(0.016, (lastSample.t - first.t) / 1000);
    const flight = FLIGHT[body.kind] || FLIGHT.kite;
    let vx = ((lastSample.x - first.x) / seconds) * flight.boost;
    let vy = ((lastSample.y - first.y) / seconds) * flight.boost;
    // A stale last sample means the player stopped before letting go: a drop, not a throw.
    if (event.type === 'pointercancel' || event.timeStamp - lastSample.t > 150) { vx = 0; vy = 0; }
    const speed = Math.hypot(vx, vy);
    if (speed > 3.2) { vx *= 3.2 / speed; vy *= 3.2 / speed; }
    Object.assign(body, { mode: 'flying', vx, vy, spin: flight.spin * (vx < 0 ? -1 : 1) * Math.min(1, speed + 0.25) });
    redraw();
  };
  // Keyboard: an obstacle in focus can be pushed sideways with the arrow keys, by the same rule.
  const push = (event, obstacle) => {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!direction || bodies.current[obstacle.id]) return;
    event.preventDefault();
    const x = obstacle.x + direction * 0.07;
    if (Math.abs(x - 0.5) >= CORRIDOR_CLEARANCE) bodies.current[obstacle.id] = { kind: obstacle.kind, mode: 'flying', x, y: obstacle.y, vx: direction * 0.9, vy: 0, rot: 0, spin: (FLIGHT[obstacle.kind]?.spin || 0) * direction, out: false, samples: [] };
    else dispatch({ type: 'RELEASE_OBSTACLE', id: obstacle.id, x, y: obstacle.y });
    redraw();
  };

  const inspectWeather = () => dispatch({ type: 'ASSESS_WEATHER' });
  // The press is captured so a drag that ends anywhere still reports back here.
  const weatherDown = (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); weatherPress.current = { x: event.clientX, y: event.clientY }; };
  const weatherUp = (event) => {
    const press = weatherPress.current;
    weatherPress.current = null;
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) dispatch({ type: 'RANGE_FEEDBACK', message: 'Weather cannot be moved out of the way. Inspect it, and wait for the winds to ease.' });
    else inspectWeather();
  };

  const shown = status.obstacles.filter((item) => !item.cleared || inHand[item.id]);
  const hint = status.feedback
    || (status.remaining ? 'Grab each obstacle and throw it past a dashed clearance line.' : !weather.clear ? 'Winds are above limits. They ease on their own: wait, then inspect the weather.' : !status.weatherReady ? 'Winds have eased. Click the clouds to inspect the weather.' : 'Range clear.');
  const windText = status.weatherReady ? 'WITHIN LIMITS · INSPECTED ✓' : weather.clear ? 'WITHIN LIMITS · NOT INSPECTED' : `ABOVE LIMITS · EASES IN ${Math.ceil(weather.remaining)} S`;
  const coneHalf = (y) => (0.045 + clamp((0.88 - y) / 0.85, 0, 1) * 0.105) * W;

  return <div className="corridor">
    <div className="corridor-title"><span className="eyebrow">FLIGHT CORRIDOR CLEARANCE</span><b className={`range-badge ${status.rangeClear ? 'clear' : ''}`} role="status">{status.rangeClear ? 'RANGE CLEAR' : 'RANGE NOT CLEAR'}</b></div>
    <div className="corridor-monitor" style={shakes ? { animationName: shakes % 2 ? 'corridor-shake-a' : 'corridor-shake-b' } : undefined}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Cutaway of the ascent corridor from the launch pad to space. ${status.remaining} of ${status.total} obstacles are still inside the clearance lines.`}>
        <defs>
          <linearGradient id="corridor-glow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#4cc9f0" stopOpacity=".34" /><stop offset="1" stopColor="#4cc9f0" stopOpacity=".1" /></linearGradient>
        </defs>
        {LAYERS.map((layer, index) => <g key={layer.name}><rect x="0" y={layer.top * H} width={W} height={((LAYERS[index + 1]?.top ?? GROUND_Y) - layer.top) * H} fill={layer.fill} /><line className="layer-line" x1="0" x2={W} y1={layer.top * H} y2={layer.top * H} /><text className="layer-name" x="5" y={layer.top * H + 10}>{layer.name}</text></g>)}
        {[[22, 12], [70, 30], [118, 9], [208, 22], [262, 38], [286, 11], [180, 44]].map(([x, y]) => <circle key={`${x}-${y}`} className="star" cx={x} cy={y} r=".9" />)}
        <rect className="clear-zone" x="0" y="0" width={LEFT_LINE} height={GROUND_Y * H} /><rect className="clear-zone" x={RIGHT_LINE} y="0" width={W - RIGHT_LINE} height={GROUND_Y * H} />
        <rect className="ground" x="0" y={GROUND_Y * H} width={W} height={(1 - GROUND_Y) * H} />
        <polygon className={`corridor-cone ${status.rangeClear ? 'clear' : ''}`} fill="url(#corridor-glow)" points={`${W / 2 - coneHalf(0.88)},${0.88 * H} ${W / 2 - coneHalf(0.03)},${0.03 * H} ${W / 2 + coneHalf(0.03)},${0.03 * H} ${W / 2 + coneHalf(0.88)},${0.88 * H}`} />
        <line className="trajectory" x1={W / 2} x2={W / 2} y1={0.86 * H} y2={0.05 * H} /><path className="trajectory-head" d={`M${W / 2 - 5} ${0.05 * H + 8} L${W / 2} ${0.05 * H - 2} L${W / 2 + 5} ${0.05 * H + 8}`} />
        {[LEFT_LINE, RIGHT_LINE].map((x) => <g key={x}><line className="clearance-line" x1={x} x2={x} y1="4" y2={GROUND_Y * H} /><text className="clearance-name" transform={`translate(${x < W / 2 ? x - 5 : x + 11} ${0.5 * H}) rotate(-90)`} textAnchor="middle">CLEARANCE LINE</text></g>)}
        <rect className="pad" x={W / 2 - 22} y={GROUND_Y * H - 4} width="44" height="6" /><path className="rocket" d={`M${W / 2} ${GROUND_Y * H - 34} l5 9 v19 h-10 v-19 z`} />
        <g className={`weather-band ${weather.clear ? 'eased' : 'hold'} ${status.weatherReady ? 'inspected' : ''}`} onPointerDown={weatherDown} onPointerUp={weatherUp} onPointerCancel={() => { weatherPress.current = null; }} aria-hidden="true">
          <rect className="weather-hit" x="0" y={0.2 * H} width={W} height={0.12 * H} />
          {[[40, 0.26, 34], [96, 0.24, 28], [150, 0.27, 38], [212, 0.245, 30], [264, 0.265, 32]].map(([x, y, r]) => <ellipse key={x} className="cloud" cx={x} cy={y * H} rx={r} ry={r * 0.36} />)}
          {[0.225, 0.255, 0.285].map((y, index) => <path key={y} className="wind" style={{ animationDelay: `${index * -0.5}s` }} d={`M${-40 + index * 26} ${y * H} h70 M${90 + index * 20} ${y * H} h54 M${205 - index * 14} ${y * H} h62`} />)}
          <text className="weather-name" x={W - 6} y={0.2 * H - 3} textAnchor="end">{status.weatherReady ? 'UPPER-LEVEL WIND · OK' : weather.clear ? 'UPPER-LEVEL WIND · INSPECT' : 'UPPER-LEVEL WIND · HOLD'}</text>
        </g>
        {shown.map((item) => {
          const body = inHand[item.id];
          const x = (body ? body.x : item.x) * W;
          const y = (body ? body.y : item.y) * H;
          const held = body?.mode === 'held';
          const beyond = Math.abs((body ? body.x : item.x) - 0.5) >= CORRIDOR_CLEARANCE;
          return <g key={item.id} className={`obstacle obstacle-${item.kind} ${held ? 'held' : body ? 'flying' : 'idle'} ${held && beyond ? 'beyond' : ''}`} transform={`translate(${x} ${y}) rotate(${body ? body.rot : 0})`} tabIndex={item.cleared ? -1 : 0} role="button" aria-label={`${NAMES[item.kind]} inside the clearance lines. Drag and throw it past a dashed line, or push it with the left and right arrow keys.`} data-obstacle={item.id} onPointerDown={(event) => grab(event, item)} onPointerMove={(event) => move(event, item)} onPointerUp={(event) => release(event, item)} onPointerCancel={(event) => release(event, item)} onKeyDown={(event) => push(event, item)}>
            <circle className="grab-area" r="18" /><g className="obstacle-art"><ObstacleArt kind={item.kind} /></g>
          </g>;
        })}
        <text className="scale-note" x={W / 2} y={H - 6} textAnchor="middle">SCHEMATIC · NOT TO SCALE · GAME DATA</text>
      </svg>
    </div>
    <div className="corridor-readout">
      <div><small>OBSTACLES CLEARED</small><b>{status.total - status.remaining} / {status.total}</b></div>
      <div><small>UPPER-LEVEL WIND</small><b className={weather.clear ? 'ok' : 'hold'}>{windText}</b></div>
      <button type="button" className="game-button" onClick={inspectWeather} disabled={status.weatherReady}>{status.weatherReady ? 'Weather inspected ✓' : 'Inspect weather'}</button>
    </div>
    <p className="corridor-note" role="status">{hint}</p>
  </div>;
}
