import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSEMBLY_COMPONENTS, LAUNCH_WINDOWS, createInitialState, getActiveWindow, getLaunchReadiness, getWindowStatus, reducer } from './gameEngine.js';

const send = (state, type, fields = {}) => reducer(state, { type, ...fields });
const tick = (state, delta) => send(state, 'TICK', { delta });

function testPlan() {
  const records = ['malapert', 'shackleton', 'mons-mouton'].map((siteId, index) => ({
    siteId, siteName: siteId, startTime: `2027-01-0${index + 1}T00:00:00.000Z`, endTime: `2027-01-0${index + 1}T06:00:00.000Z`, durationMs: 21600000, valid: true
  }));
  return { siteId: 'malapert', siteName: 'Malapert', selectedWindow: records[0], records, preparationDeadlineSeconds: 1710 };
}

function enterMission() {
  let state = send(createInitialState(), 'COMMIT_MISSION_PLAN', { plan: testPlan() });
  state = send(state, 'BEGIN_BRIEFING');
  return state;
}

function preparedAtFirstWindow() {
  let state = enterMission();
  for (const part of ASSEMBLY_COMPONENTS) state = send(state, 'INSTALL_PART', { partId: part.id, slotId: part.slot });
  state = send(state, 'PROCEED_TO_PAD');
  state = send(state, 'EXTEND_PLATFORM');
  state = send(state, 'TOGGLE_PROPELLANT_LINE', { line: 'fuel' });
  state = send(state, 'TOGGLE_PROPELLANT_LINE', { line: 'oxidizer' });
  state = send(state, 'START_PROPELLANT_LOADING');
  state = tick(state, 35);
  state = send(state, 'CHECK_PAD_ITEM', { key: 'vehicle' });
  state = send(state, 'CHECK_PAD_ITEM', { key: 'spacecraft' });
  state = send(state, 'SET_WEATHER_CHOICE', { windowId: 'window-1', choice: 'go' });
  state = send(state, 'ASSESS_WEATHER', { windowId: 'window-1' });
  state = send(state, 'RETRACT_PLATFORM');
  state = send(state, 'SWITCH_ONBOARD_POWER');
  state = send(state, 'CHECK_PAD_ITEM', { key: 'site', windowId: 'window-1' });
  return state;
}

test('mission planning is manual and committing starts a paused, configurable mission clock', () => {
  let state = createInitialState();
  assert.equal(state.phase, 'planning');
  assert.equal(state.paused, true);
  assert.equal(tick(state, 60).elapsed, 0);
  state = send(state, 'COMMIT_MISSION_PLAN', { plan: testPlan() });
  assert.equal(state.phase, 'assembly');
  assert.equal(state.missionPlan.siteId, 'malapert');
  assert.equal(state.siteId, 'malapert');
  assert.equal(state.paused, true);
  state = send(state, 'BEGIN_BRIEFING');
  assert.equal(state.paused, false);
  state = send(state, 'TOGGLE_PAUSE');
  assert.equal(tick(state, 60).elapsed, 0);
  state = send(state, 'SET_SPEED', { speed: 'normal' });
  assert.equal(state.speed, 'normal');
});

test('committed site is locked and its selected window sets the preparation deadline', () => {
  const plan = { ...testPlan(), preparationDeadlineSeconds: 120 };
  let state = send(createInitialState(), 'COMMIT_MISSION_PLAN', { plan });
  state = send(state, 'SELECT_SITE', { siteId: 'shackleton', siteName: 'Shackleton' });
  assert.equal(state.siteId, 'malapert');
  state = send(state, 'BEGIN_BRIEFING');
  state = tick(state, 120);
  assert.equal(state.phase, 'no-launch');
  assert.equal(state.paused, true);
  assert.equal(state.activity[0].title, 'Preparation schedule expired');
});

test('assembly requires matching sockets and persists through pad preparation', () => {
  let state = enterMission();
  const part = ASSEMBLY_COMPONENTS[0];
  state = send(state, 'INSTALL_PART', { partId: part.id, slotId: 'wrong-slot' });
  assert.equal(state.installedParts.length, 0);
  assert.match(state.assemblyFeedback, /does not fit/);
  state = send(state, 'INSTALL_PART', { partId: part.id, slotId: part.slot });
  assert.equal(state.installedParts.length, 1);
  for (const next of ASSEMBLY_COMPONENTS.slice(1)) state = send(state, 'INSTALL_PART', { partId: next.id, slotId: next.slot });
  assert.equal(state.phase, 'assembly-complete');
  state = send(state, 'PROCEED_TO_PAD');
  assert.equal(state.phase, 'launchpad');
  assert.equal(state.installedParts.length, ASSEMBLY_COMPONENTS.length);
});

test('windows retain preparation progress and only the active window can start countdown', () => {
  let state = enterMission();
  state = tick(state, LAUNCH_WINDOWS[0].openAt);
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'active');
  assert.equal(getActiveWindow(state).id, 'window-1');
  state = send(state, 'SKIP_WINDOW', { windowId: 'window-1' });
  assert.equal(getWindowStatus(state, LAUNCH_WINDOWS[0]), 'skipped');
  state = tick(state, LAUNCH_WINDOWS[1].openAt - state.elapsed);
  assert.equal(getActiveWindow(state).id, 'window-2');
  assert.equal(state.phase, 'assembly');
});

test('pad readiness gates propellant, checks, site clearance, and active assessed weather', () => {
  const state = preparedAtFirstWindow();
  assert.equal(state.elapsed, 35);
  assert.equal(state.pad.propellantLoaded, true);
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, false]);
  let atWindow = tick(state, LAUNCH_WINDOWS[0].openAt - state.elapsed);
  assert.equal(getLaunchReadiness(atWindow).allGo, true);
  atWindow = send(atWindow, 'START_COUNTDOWN');
  assert.equal(atWindow.phase, 'countdown');
  const tooEarly = send(atWindow, 'LAUNCH', { siteName: 'Malapert' });
  assert.equal(tooEarly.phase, 'countdown');
  const atCue = tick(atWindow, 12);
  const launched = send(atCue, 'LAUNCH', { siteName: 'Malapert' });
  assert.equal(launched.phase, 'ascent');
  assert.equal(launched.usedWindowId, 'window-1');
});

test('ascent cues lead to persisted transit questions, landing, and a completed lunar survey', () => {
  let state = tick(preparedAtFirstWindow(), LAUNCH_WINDOWS[0].openAt - 35);
  state = send(state, 'START_COUNTDOWN');
  state = tick(state, 12);
  state = send(state, 'LAUNCH', { siteName: 'Malapert' });
  state = tick(state, 20);
  state = send(state, 'SEPARATE_FIRST_STAGE');
  state = tick(state, 55);
  state = send(state, 'SEPARATE_FAIRING');
  state = tick(state, 35);
  state = send(state, 'SEPARATE_PAYLOAD');
  assert.equal(state.phase, 'transit');
  state = tick(state, 18);
  assert.equal(state.transit.questions[0].status, 'pending');
  state = send(state, 'SET_ANSWER', { questionId: 'moon-phases', answer: 1 });
  state = send(state, 'ANSWER_QUESTION', { questionId: 'moon-phases' });
  assert.equal(state.educationScore, 1);
  state = tick(state, 162);
  assert.equal(state.phase, 'landing');
  state = send(state, 'SELECT_LANDING_ZONE', { zone: 'B' });
  state = send(state, 'BEGIN_DESCENT');
  state = tick(state, 20);
  state = send(state, 'ADJUST_THRUST');
  state = tick(state, 28);
  state = send(state, 'ALIGN_LANDER');
  state = tick(state, 42);
  state = send(state, 'CONFIRM_TOUCHDOWN', { siteName: 'Malapert' });
  assert.equal(state.phase, 'lunar-operations');
  assert.equal(state.landing.result, 'nominal');
  state = send(state, 'DEPLOY_ROVER', { siteName: 'Malapert' });
  state = send(state, 'START_SURVEY');
  state = tick(state, 75);
  state = send(state, 'COMPLETE_SURVEY', { sunVisible: true, earthVisible: false });
  assert.equal(state.lunarOps.surveyComplete, true);
  assert.deepEqual(state.lunarOps.surveyResult, { sunVisible: true, earthVisible: false, completedAt: state.elapsed });
});
