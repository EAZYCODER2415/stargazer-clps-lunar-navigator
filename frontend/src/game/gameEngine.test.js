import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialGameState,
  gameReducer,
  getActiveWindow,
  getReadiness,
  getWindowStatus,
  LAUNCH_WINDOWS,
} from './gameEngine.js';

const send = (state, type, fields = {}) => gameReducer(state, { type, ...fields });
const tickTo = (state, time) => send(state, 'TICK', { deltaSeconds: time - state.elapsedSeconds });

function prepareFirstWindow() {
  let state = createInitialGameState();
  state = send(state, 'SET_ENGINEERING_COMPONENT', { component: 'landing-sensor' });
  state = send(state, 'SET_ENGINEERING_REPAIR', { repair: 'recalibrate' });
  state = send(state, 'APPLY_ENGINEERING_REPAIR');
  state = send(state, 'TOGGLE_LAUNCH_CHECK', { key: 'flightTermination' });
  state = send(state, 'TOGGLE_LAUNCH_CHECK', { key: 'payloadRestraint' });
  state = send(state, 'SET_COMMS_PRESET', { preset: 'S2' });
  state = send(state, 'VERIFY_COMMS');
  state = send(state, 'SET_WEATHER_CHOICE', { windowId: 'window-1', choice: 'go' });
  state = send(state, 'ASSESS_WEATHER', { windowId: 'window-1' });
  return state;
}

test('pause freezes the shared mission clock and speed is configurable', () => {
  let state = createInitialGameState();
  state = send(state, 'TOGGLE_PAUSE');
  const paused = send(state, 'TICK', { deltaSeconds: 120 });
  assert.equal(paused.elapsedSeconds, 0);
  state = send(state, 'SET_SPEED', { speed: 240 });
  assert.equal(state.speed, 240);
  state = send(state, 'TOGGLE_PAUSE');
  state = send(state, 'TICK', { deltaSeconds: 1.5 });
  assert.equal(state.elapsedSeconds, 1.5);
});

test('department work persists in shared state when switching departments', () => {
  let state = createInitialGameState();
  state = send(state, 'SET_ENGINEERING_COMPONENT', { component: 'landing-sensor' });
  state = send(state, 'SET_ENGINEERING_REPAIR', { repair: 'recalibrate' });
  state = send(state, 'SET_DEPARTMENT', { department: 'weather' });
  assert.equal(state.engineering.repair, 'recalibrate');
  assert.equal(state.department, 'weather');
});

test('launch windows open, can be skipped, and are not reused', () => {
  let state = tickTo(createInitialGameState(), LAUNCH_WINDOWS[0].openAt);
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'active');
  state = send(state, 'SKIP_WINDOW', { windowId: LAUNCH_WINDOWS[0].id });
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'skipped');
  state = tickTo(state, LAUNCH_WINDOWS[0].closeAt);
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'skipped');
  state = tickTo(state, LAUNCH_WINDOWS[1].openAt);
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'skipped');
  assert.equal(getActiveWindow(state)?.id, 'window-2');
  assert.equal(state.activity.filter((item) => item.title === 'Window 1 missed').length, 0);
});

test('an unattended window is missed and cannot be launched retroactively', () => {
  let state = tickTo(prepareFirstWindow(), LAUNCH_WINDOWS[0].openAt);
  assert.equal(getReadiness(state).launchAllowed, true);
  state = tickTo(state, LAUNCH_WINDOWS[0].closeAt);
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'missed');
  assert.equal(getReadiness(state).launchAllowed, false);
  assert.equal(state.activity.some((item) => item.title === 'Window 1 missed'), true);
});

test('launch is blocked outside a window and succeeds only after mandatory checks inside one', () => {
  let state = prepareFirstWindow();
  const initial = state;
  state = send(state, 'LAUNCH', { windowId: 'window-1', siteName: 'Malapert Mountain / Massif' });
  assert.equal(state, initial);
  state = tickTo(state, LAUNCH_WINDOWS[0].openAt);
  assert.equal(getReadiness(state).launchAllowed, true);
  state = send(state, 'LAUNCH', { windowId: 'window-1', siteName: 'Malapert Mountain / Massif' });
  assert.equal(state.phase, 'journey');
  assert.equal(state.usedWindowId, 'window-1');
  state = send(state, 'TICK', { deltaSeconds: 600 });
  assert.equal(state.phase, 'debrief');
  assert.equal(state.outcome.result, 'delayed');
});

test('weather no-go assessment blocks launch in the second window', () => {
  let state = prepareFirstWindow();
  state = send(state, 'SET_WEATHER_CHOICE', { windowId: 'window-2', choice: 'noGo' });
  state = send(state, 'ASSESS_WEATHER', { windowId: 'window-2' });
  state = tickTo(state, LAUNCH_WINDOWS[1].openAt);
  assert.equal(getActiveWindow(state)?.id, 'window-2');
  assert.equal(getReadiness(state).launchAllowed, false);
});

test('optional preparation transparently improves the deterministic outcome', () => {
  let state = prepareFirstWindow();
  state = send(state, 'TOGGLE_POWER_CHECK');
  state = send(state, 'TOGGLE_LAUNCH_CHECK', { key: 'redundantCheck' });
  state = send(state, 'TOGGLE_BACKUP_COMMS');
  state = tickTo(state, LAUNCH_WINDOWS[0].openAt);
  state = send(state, 'LAUNCH', { windowId: 'window-1', siteName: 'Malapert Mountain / Massif' });
  assert.equal(state.outcome.optionalMitigation, 3);
  assert.equal(state.outcome.adjustedRisk, 0);
  assert.equal(state.outcome.result, 'successful');
});
