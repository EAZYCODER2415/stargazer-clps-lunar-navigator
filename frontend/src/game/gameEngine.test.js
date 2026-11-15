import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSEMBLY_COMPONENTS, GAME_SPEEDS, MISSION_STAGES, WEATHER_HOLD_SECONDS, createInitialState, getCorridorStatus, getLaunchReadiness, getPadProcedure, getStageIndex, getWeather, reducer } from './gameEngine.js';

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

function clearCorridor(state) {
  for (const obstacle of state.pad.corridor.obstacles) state = send(state, 'RELEASE_OBSTACLE', { id: obstacle.id, x: 0.95, y: obstacle.y });
  return state;
}

function preparedOnPad() {
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
  state = send(state, 'RETRACT_PLATFORM');
  state = send(state, 'SWITCH_ONBOARD_POWER');
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
});

test('six clock speeds, 1.0x by default, and speed changes keep elapsed time', () => {
  assert.deepEqual(GAME_SPEEDS, [0.5, 1, 1.5, 2, 2.5, 3]);
  let state = createInitialState();
  assert.equal(state.speed, 1);
  state = enterMission();
  state = tick(state, 10);
  for (const speed of GAME_SPEEDS) {
    state = send(state, 'SET_SPEED', { speed });
    assert.equal(state.speed, speed);
    assert.equal(state.elapsed, 10);
  }
  assert.equal(send(state, 'SET_SPEED', { speed: 4 }).speed, 3);
  assert.equal(send(state, 'SET_SPEED', { speed: 'normal' }).speed, 3);
  assert.equal(send(state, 'RESTART').speed, 1);
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

test('pad procedure status follows pad state, with feedback for attempts out of order', () => {
  let state = enterMission();
  for (const part of ASSEMBLY_COMPONENTS) state = send(state, 'INSTALL_PART', { partId: part.id, slotId: part.slot });
  state = send(state, 'PROCEED_TO_PAD');
  const statuses = () => getPadProcedure(state).slice(0, 6).map((step) => step.status);
  assert.deepEqual(statuses(), ['pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(getPadProcedure(state)[0].next, true);
  state = send(state, 'TOGGLE_PROPELLANT_LINE', { line: 'fuel' });
  assert.equal(state.pad.fuelConnected, false);
  assert.match(state.pad.feedback, /Extend the access platform/);
  state = send(state, 'RETRACT_PLATFORM');
  assert.equal(state.pad.platformRetracted, false);
  state = send(state, 'EXTEND_PLATFORM');
  state = send(state, 'TOGGLE_PROPELLANT_LINE', { line: 'fuel' });
  assert.deepEqual(statuses(), ['done', 'active', 'pending', 'pending', 'pending', 'pending']);
  state = send(state, 'START_PROPELLANT_LOADING');
  assert.equal(state.pad.propellantStartedAt, null);
  assert.match(state.pad.feedback, /valve stays shut/);
  state = send(state, 'PAD_FEEDBACK', { message: 'Wrong port.' });
  assert.equal(state.pad.feedback, 'Wrong port.');
  state = send(state, 'TOGGLE_PROPELLANT_LINE', { line: 'oxidizer' });
  state = send(state, 'START_PROPELLANT_LOADING');
  state = send(state, 'CHECK_PAD_ITEM', { key: 'vehicle' });
  assert.equal(state.pad.checks.vehicle, false);
  state = send(state, 'CHECK_PAD_ITEM', { key: 'spacecraft' });
  assert.deepEqual(statuses(), ['done', 'done', 'active', 'active', 'pending', 'pending']);
  state = send(state, 'SWITCH_ONBOARD_POWER');
  assert.equal(state.pad.onboardPower, false);
  state = tick(state, 35);
  state = send(state, 'CHECK_PAD_ITEM', { key: 'vehicle' });
  state = send(state, 'RETRACT_PLATFORM');
  state = send(state, 'SWITCH_ONBOARD_POWER');
  assert.deepEqual(statuses(), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, false]);
});

test('corridor obstacles only clear past a clearance line, and RANGE CLEAR needs weather too', () => {
  let state = preparedOnPad();
  const start = getCorridorStatus(state);
  assert.equal(start.total, 5);
  assert.equal(start.remaining, 5);
  assert.deepEqual(state.pad.corridor, send(send(createInitialState(), 'DEBUG_JUMP', { stage: 'launchpad' }), 'TOGGLE_PAUSE').pad.corridor);
  assert.equal(getPadProcedure(state)[6].status, 'pending');
  // Released inside the corridor, or short of the line: moved but not cleared.
  state = send(state, 'RELEASE_OBSTACLE', { id: 'bird-1', x: 0.5, y: 0.4 });
  state = send(state, 'RELEASE_OBSTACLE', { id: 'drone-1', x: 0.5 + 0.33, y: 0.6 });
  assert.equal(getCorridorStatus(state).remaining, 5);
  assert.match(state.pad.corridor.feedback, /still inside the clearance lines/);
  assert.equal(state.pad.corridor.obstacles.find((item) => item.id === 'bird-1').y, 0.4);
  // Unknown obstacles and bad coordinates do nothing.
  assert.equal(send(state, 'RELEASE_OBSTACLE', { id: 'nope', x: 0.99, y: 0.5 }), state);
  assert.equal(send(state, 'RELEASE_OBSTACLE', { id: 'bird-1', x: NaN, y: 0.5 }), state);
  state = send(state, 'RELEASE_OBSTACLE', { id: 'bird-1', x: 0.1, y: 0.4 });
  assert.equal(getCorridorStatus(state).remaining, 4);
  assert.equal(getPadProcedure(state)[6].status, 'active');
  assert.equal(send(state, 'RELEASE_OBSTACLE', { id: 'bird-1', x: 0.5, y: 0.4 }), state);
  state = clearCorridor(state);
  assert.equal(getCorridorStatus(state).obstaclesClear, true);
  assert.equal(getCorridorStatus(state).rangeClear, false);
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, false]);
  state = send(tick(state, WEATHER_HOLD_SECONDS), 'ASSESS_WEATHER');
  assert.equal(getCorridorStatus(state).rangeClear, true);
  assert.equal(getPadProcedure(state)[6].status, 'done');
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, true]);
});

test('weather is one fixed condition that clears on the mission clock and must be inspected', () => {
  let state = preparedOnPad();
  assert.equal(state.elapsed, 35);
  assert.equal(getWeather(state).clear, false);
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, false]);
  state = send(state, 'ASSESS_WEATHER');
  assert.equal(state.pad.weatherAssessed, false);
  assert.match(state.pad.corridor.feedback, /still above limits/);
  state = clearCorridor(state);
  assert.equal(getCorridorStatus(state).obstaclesClear, true);
  assert.equal(getCorridorStatus(state).rangeClear, false);
  assert.equal(send(state, 'START_COUNTDOWN').phase, 'launchpad');
  state = tick(state, WEATHER_HOLD_SECONDS - 35);
  assert.equal(getWeather(state).clear, true);
  assert.equal(getLaunchReadiness(state).weatherReady, false);
  state = send(state, 'ASSESS_WEATHER');
  assert.equal(state.pad.weatherAssessed, true);
  state = clearCorridor(state);
  assert.deepEqual(getLaunchReadiness(state).go, [true, true, true]);
});

test('launch needs all three lights before the preparation deadline, with no launch windows', () => {
  let state = tick(preparedOnPad(), WEATHER_HOLD_SECONDS);
  state = send(state, 'ASSESS_WEATHER');
  state = clearCorridor(state);
  assert.equal(getLaunchReadiness(state).canLaunch, true);
  const late = tick(state, 1710);
  assert.equal(late.phase, 'no-launch');
  assert.equal(send(late, 'START_COUNTDOWN').phase, 'no-launch');
  state = send(state, 'START_COUNTDOWN');
  assert.equal(state.phase, 'countdown');
  const tooEarly = send(state, 'LAUNCH', { siteName: 'Malapert' });
  assert.equal(tooEarly.phase, 'countdown');
  const launched = send(tick(state, 12), 'LAUNCH', { siteName: 'Malapert' });
  assert.equal(launched.phase, 'ascent');
  assert.equal(launched.launch.time, launched.elapsed);
  assert.equal(tick(launched, 5000).phase, 'ascent');
});

test('debug jump builds valid, labelled prerequisite state for every stage', () => {
  assert.equal(MISSION_STAGES.length, 7);
  for (const stage of MISSION_STAGES) {
    const state = send(createInitialState(), 'DEBUG_JUMP', { stage: stage.id, siteName: 'Test site' });
    assert.equal(state.phase, stage.id);
    assert.deepEqual(state, send(createInitialState(), 'DEBUG_JUMP', { stage: stage.id, siteName: 'Test site' }));
    if (stage.id === 'planning') { assert.equal(state.missionPlan, null); continue; }
    assert.equal(state.missionPlan.debug, true);
    assert.ok(state.missionPlan.selectedWindow.durationMs > 0);
    assert.ok(state.debug.generated.length >= 1);
    assert.equal(state.paused, true);
    assert.equal(tick(send(state, 'TOGGLE_PAUSE'), 1).phase, stage.id);
  }
  // Each jumped-into stage can be played on with the normal actions.
  let state = send(createInitialState(), 'DEBUG_JUMP', { stage: 'launchpad' });
  assert.equal(state.installedParts.length, ASSEMBLY_COMPONENTS.length);
  assert.equal(send(state, 'EXTEND_PLATFORM').pad.platformExtended, true);
  state = send(send(createInitialState(), 'DEBUG_JUMP', { stage: 'ascent' }), 'TOGGLE_PAUSE');
  assert.equal(send(tick(state, 20), 'SEPARATE_FIRST_STAGE').ascent.separatedAt, 20);
  state = send(send(createInitialState(), 'DEBUG_JUMP', { stage: 'transit' }), 'TOGGLE_PAUSE');
  assert.equal(tick(state, 18).transit.questions[0].status, 'pending');
  state = send(createInitialState(), 'DEBUG_JUMP', { stage: 'landing' });
  assert.equal(send(send(state, 'SELECT_LANDING_ZONE', { zone: 'B' }), 'BEGIN_DESCENT').landing.descentStartedAt, state.elapsed);
  state = send(createInitialState(), 'DEBUG_JUMP', { stage: 'lunar-operations' });
  assert.equal(send(state, 'DEPLOY_ROVER', { siteName: 'x' }).lunarOps.roverDeployed, true);
});

test('debug jump keeps a real mission plan and real progress', () => {
  let state = enterMission();
  state = tick(state, 40);
  state = send(state, 'DEBUG_JUMP', { stage: 'launchpad' });
  assert.equal(state.missionPlan.debug, undefined);
  assert.equal(state.missionPlan.siteId, 'malapert');
  assert.equal(state.elapsed, 40);
  assert.deepEqual(state.debug.generated, ['Completed vehicle assembly']);
  assert.equal(getStageIndex(state.phase), 2);
  assert.equal(send(state, 'RESTART').debug, null);
});

test('ascent cues lead to persisted transit questions, landing, and a completed lunar survey', () => {
  let state = tick(preparedOnPad(), WEATHER_HOLD_SECONDS);
  state = send(state, 'ASSESS_WEATHER');
  state = clearCorridor(state);
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
