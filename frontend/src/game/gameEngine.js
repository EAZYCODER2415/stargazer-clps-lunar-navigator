export const GAME_SPEEDS = { slow: 1, normal: 2 };
export const DEFAULT_SPEED = 'slow';
export const SCENARIO_START = new Date('2026-12-01T00:00:00Z');
export const SCENARIO_END = 1710;
export const COUNTDOWN_SECONDS = 12;
export const COUNTDOWN_TOLERANCE = 3;
export const PROPELLANT_LOAD_SECONDS = 35;
export const TRANSIT_SECONDS = 180;
export const LANDING_DURATION_SECONDS = 90;
export const SURVEY_DURATION_SECONDS = 75;

export const ASSEMBLY_COMPONENTS = [
  { id: 'first-engine', name: 'First-stage engine', slot: 'first-engine', description: 'Provides thrust during the initial climb through the lower atmosphere.', color: '#e87943' },
  { id: 'first-tank', name: 'First-stage propellant tank', slot: 'first-tank', description: 'Stores the first-stage propellant. This generic vehicle does not represent one specific launch provider.', color: '#64748b' },
  { id: 'interstage', name: 'Interstage adapter', slot: 'interstage', description: 'Connects the first and upper stages and separates when the first stage is spent.', color: '#94a3b8' },
  { id: 'upper-engine', name: 'Upper-stage engine', slot: 'upper-engine', description: 'Continues accelerating the payload after the first stage is discarded.', color: '#f59e0b' },
  { id: 'upper-tank', name: 'Upper-stage propellant tank', slot: 'upper-tank', description: 'Stores propellant for the upper-stage engine.', color: '#475569' },
  { id: 'payload-adapter', name: 'Payload adapter', slot: 'payload-adapter', description: 'Provides the mechanical interface between the upper stage and the lander.', color: '#a78bfa' },
  { id: 'lander', name: 'Robotic lunar lander', slot: 'lander', description: 'Carries the robotic payload to the lunar surface.', color: '#38bdf8' },
  { id: 'fairing', name: 'Payload fairing', slot: 'fairing', description: 'Protects the lander from aerodynamic forces and heating during ascent.', color: '#cbd5e1' },
];

export const LAUNCH_WINDOWS = [
  { id: 'window-1', name: 'Window 1', openAt: 360, closeAt: 600, duration: '4 minutes', weather: 'go', risk: 2, condition: 'Clear range · stable scenario conditions', description: 'The first, relatively long launch opportunity. Baseline scenario risk is moderate.' },
  { id: 'window-2', name: 'Window 2', openAt: 900, closeAt: 1080, duration: '3 minutes', weather: 'caution', risk: 2, condition: 'Variable crosswind · caution indication', description: 'A shorter opportunity with a caution-rated scenario forecast.' },
  { id: 'window-3', name: 'Window 3', openAt: 1500, closeAt: 1650, duration: '2.5 minutes', weather: 'go', risk: 3, condition: 'Clear range · short opportunity', description: 'The last and shortest opportunity. Later does not automatically mean lower scenario risk.' },
];

export const WINDOW_BY_ID = Object.fromEntries(LAUNCH_WINDOWS.map((window) => [window.id, window]));

export const RADIO_QUESTIONS = [
  { id: 'moon-phases', due: 18, question: 'What causes the Moon to have phases?', choices: ['Earth’s shadow covers the Moon', 'We see changing portions of the Moon’s sunlit half', 'The Moon changes shape'], correct: 1, explanation: 'The Sun always illuminates half the Moon. As the Moon orbits Earth, we see different portions of that lit half.' },
  { id: 'gravity', due: 58, question: 'Why is the Moon’s surface gravity lower than Earth’s?', choices: ['The Moon has less mass', 'The Moon is farther from the Sun', 'The Moon has no atmosphere'], correct: 0, explanation: 'The Moon has much less mass than Earth, so its surface gravity is weaker.' },
  { id: 'stages', due: 98, question: 'Why do launch vehicles use multiple stages?', choices: ['To change the vehicle’s colour', 'To discard empty structures and improve vehicle performance', 'To make the vehicle heavier'], correct: 1, explanation: 'Discarding empty stages means later stages do not carry structures they no longer need.' },
  { id: 'fairing', due: 138, question: 'What does a payload fairing do during ascent?', choices: ['Protects the payload from aerodynamic forces and heating', 'Slows the rocket down', 'Generates electricity for the lander'], correct: 0, explanation: 'The fairing shields the payload during atmospheric flight and is discarded after it is no longer needed.' },
];

const initialPad = () => ({
  platformExtended: false,
  weatherChoice: {},
  weatherAssessment: {},
  fuelConnected: false,
  oxidizerConnected: false,
  propellantStartedAt: null,
  propellantLoaded: false,
  checks: { vehicle: false, spacecraft: false, site: false },
  platformRetracted: false,
  onboardPower: false,
  countdownStartedAt: null,
  feedback: '',
});

export function createInitialState() {
  return {
    elapsed: 0,
    paused: true,
    speed: DEFAULT_SPEED,
    briefingOpen: true,
    phase: 'planning',
    siteId: 'malapert',
    missionPlan: null,
    selectedPart: ASSEMBLY_COMPONENTS[0].id,
    draggedPart: null,
    installedParts: [],
    assemblyFeedback: '',
    pad: initialPad(),
    skippedWindows: [],
    openedWindows: [],
    closedWindows: [],
    usedWindowId: null,
    launch: null,
    ascent: null,
    transit: null,
    landing: { zone: '', descentStartedAt: null, thrustAdjusted: false, alignmentComplete: false, touchdown: false, result: null, feedback: '' },
    lunarOps: { startedAt: null, roverDeployed: false, surveyStartedAt: null, surveyComplete: false, surveyResult: null },
    educationScore: 0,
    activity: [{ time: 0, title: 'Mission control ready', detail: 'Mission 001 begins paused. Assemble the generic robotic lunar vehicle, prepare the launch pad, then manage the mission through landing and the first rover survey.' }],
  };
}

function logEvent(state, title, detail, time = state.elapsed) {
  return { ...state, activity: [{ time, title, detail }, ...state.activity] };
}

export function getWindowStatus(state, window) {
  if (state.usedWindowId === window.id) return 'used';
  if (state.skippedWindows.includes(window.id)) return 'skipped';
  if (state.phase !== 'assembly' && state.phase !== 'launchpad' && state.phase !== 'countdown') return 'closed';
  if (state.elapsed >= window.closeAt) return 'missed';
  if (state.elapsed >= window.openAt) return 'active';
  return 'upcoming';
}

export function getActiveWindow(state) {
  return LAUNCH_WINDOWS.find((window) => getWindowStatus(state, window) === 'active') || null;
}

export function getWeatherAssessment(state, windowId) {
  return state.pad.weatherAssessment[windowId] || null;
}

export function getLaunchReadiness(state) {
  const activeWindow = getActiveWindow(state);
  const assessment = activeWindow && getWeatherAssessment(state, activeWindow.id);
  const weatherReady = Boolean(assessment?.correct && assessment.choice !== 'noGo');
  const vehicleGo = state.installedParts.length === ASSEMBLY_COMPONENTS.length
    && state.pad.propellantLoaded && state.pad.checks.vehicle;
  const spacecraftGo = state.installedParts.length === ASSEMBLY_COMPONENTS.length
    && state.pad.checks.spacecraft && state.pad.onboardPower;
  const siteWeatherGo = state.pad.checks.site && state.pad.platformRetracted && weatherReady;
  const go = [vehicleGo, spacecraftGo, siteWeatherGo];
  const requirements = [
    ['Rocket and lander assembled', state.installedParts.length === ASSEMBLY_COMPONENTS.length],
    ['Scenario weather correctly assessed for active window', weatherReady],
    ['Propellant loading complete', state.pad.propellantLoaded],
    ['Vehicle check complete', state.pad.checks.vehicle],
    ['Spacecraft check and onboard power complete', state.pad.checks.spacecraft && state.pad.onboardPower],
    ['Service platform retracted and site check complete', state.pad.platformRetracted && state.pad.checks.site],
  ];
  return { activeWindow, assessment, weatherReady, vehicleGo, spacecraftGo, siteWeatherGo, go, allGo: go.every(Boolean), requirements };
}

function transition(state, phase, title, detail) {
  return logEvent({ ...state, phase }, title, detail);
}

function createDebugStageState(state, phase) {
  const phases = ['planning', 'assembly', 'assembly-complete', 'launchpad', 'countdown', 'ascent', 'transit', 'landing', 'lunar-operations', 'no-launch'];
  if (!phases.includes(phase)) return state;
  if (phase === 'planning') return createInitialState();

  const elapsedByPhase = { assembly: 0, 'assembly-complete': 30, launchpad: 120, countdown: 420, ascent: 450, transit: 620, landing: 820, 'lunar-operations': 920, 'no-launch': SCENARIO_END };
  const elapsed = elapsedByPhase[phase];
  const missionPlan = state.missionPlan || {
    siteId: state.siteId,
    siteName: 'Debug mission site',
    selectedWindow: {
      startTime: SCENARIO_START.toISOString(),
      endTime: new Date(SCENARIO_START.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    },
    preparationDeadlineSeconds: SCENARIO_END,
  };
  const allParts = ASSEMBLY_COMPONENTS.map((part) => part.id);
  const windowId = LAUNCH_WINDOWS[0].id;
  const padReady = {
    ...initialPad(),
    platformExtended: true,
    fuelConnected: true,
    oxidizerConnected: true,
    propellantStartedAt: 0,
    propellantLoaded: true,
    checks: { vehicle: true, spacecraft: true, site: true },
    platformRetracted: true,
    onboardPower: true,
    weatherChoice: { [windowId]: 'go' },
    weatherAssessment: { [windowId]: { choice: 'go', correct: true } },
    countdownStartedAt: phase === 'countdown' ? elapsed - COUNTDOWN_SECONDS + 8 : null,
  };
  const ascentStart = elapsed - 30;
  const transitStart = elapsed - 30;
  const landingStart = elapsed - 30;
  const questions = RADIO_QUESTIONS.map((item) => ({
    id: item.id,
    status: item.due <= 30 ? 'pending' : 'scheduled',
    answer: null,
    feedback: '',
  }));
  const next = {
    ...state,
    elapsed,
    paused: true,
    briefingOpen: false,
    phase,
    missionPlan,
    installedParts: phase === 'assembly' ? [] : allParts,
    assemblyFeedback: '',
    pad: phase === 'assembly' || phase === 'assembly-complete' || phase === 'launchpad' ? initialPad() : padReady,
    usedWindowId: ['ascent', 'transit', 'landing', 'lunar-operations'].includes(phase) ? windowId : null,
    launch: ['ascent', 'transit', 'landing', 'lunar-operations'].includes(phase) ? { time: ascentStart, windowId } : null,
    ascent: ['ascent', 'transit', 'landing', 'lunar-operations'].includes(phase) ? {
      launchedAt: ascentStart,
      separatedAt: phase === 'ascent' ? null : ascentStart + 25,
      separationPenalty: 0,
      recoveryUsed: false,
      fairingSeparated: phase !== 'ascent',
      payloadSeparated: ['transit', 'landing', 'lunar-operations'].includes(phase),
      separationWindowNotified: true,
      fairingNotified: true,
      payloadNotified: true,
    } : null,
    transit: ['transit', 'landing', 'lunar-operations'].includes(phase) ? { startedAt: transitStart, questions } : null,
    landing: ['landing', 'lunar-operations'].includes(phase) ? {
      zone: phase === 'lunar-operations' ? 'B' : '',
      descentStartedAt: phase === 'landing' ? null : landingStart,
      thrustAdjusted: phase === 'lunar-operations',
      alignmentComplete: phase === 'lunar-operations',
      touchdown: phase === 'lunar-operations',
      result: phase === 'lunar-operations' ? 'nominal' : null,
      feedback: '',
    } : { zone: '', descentStartedAt: null, thrustAdjusted: false, alignmentComplete: false, touchdown: false, result: null, feedback: '' },
    lunarOps: phase === 'lunar-operations'
      ? { startedAt: elapsed, roverDeployed: false, surveyStartedAt: null, surveyComplete: false, surveyResult: null, surveyReadyNotified: false }
      : { startedAt: null, roverDeployed: false, surveyStartedAt: null, surveyComplete: false, surveyResult: null, surveyReadyNotified: false },
  };
  return logEvent(next, 'Debug stage loaded', `Debug tools loaded the ${phase} stage with a paused mission clock.`);
}

function windowEvents(state, nextElapsed) {
  const events = [];
  let openedWindows = state.openedWindows;
  let closedWindows = state.closedWindows;
  for (const window of LAUNCH_WINDOWS) {
    if (state.elapsed < window.openAt && nextElapsed >= window.openAt && !openedWindows.includes(window.id)) {
      events.push({ time: window.openAt, title: `${window.name} opened`, detail: `${window.condition}. This deterministic scenario opportunity lasts ${window.duration}.` });
      openedWindows = [...openedWindows, window.id];
    }
    if (state.elapsed < window.closeAt && nextElapsed >= window.closeAt && !closedWindows.includes(window.id)) {
      const skipped = state.skippedWindows.includes(window.id);
      if (!skipped && state.usedWindowId !== window.id) events.push({ time: window.closeAt, title: `${window.name} missed`, detail: 'This scenario launch opportunity closed without a launch. Assembly and preparation progress are retained.' });
      closedWindows = [...closedWindows, window.id];
    }
  }
  let next = { ...state, openedWindows, closedWindows, elapsed: nextElapsed };
  if (events.length) next = { ...next, activity: [...events.reverse(), ...state.activity] };
  return next;
}

export function reducer(state, action) {
  switch (action.type) {
    case 'DEBUG_SET_STAGE':
      return createDebugStageState(state, action.phase);
    case 'COMMIT_MISSION_PLAN': {
      const plan = action.plan;
      if (state.phase !== 'planning' || !plan || !Array.isArray(plan.records) || plan.records.length !== 3) return state;
      const sites = new Set(plan.records.map((record) => record.siteId));
      if (sites.size !== 3 || plan.records.some((record) => !record.valid || !(record.durationMs > 0) || !Number.isFinite(Date.parse(record.startTime)) || !Number.isFinite(Date.parse(record.endTime)) || Date.parse(record.startTime) >= Date.parse(record.endTime)) || !plan.selectedWindow?.valid || !plan.records.some((record) => record.siteId === plan.siteId && record.startTime === plan.selectedWindow.startTime && record.endTime === plan.selectedWindow.endTime && record.durationMs === plan.selectedWindow.durationMs)) return state;
      return logEvent({ ...state, phase: 'assembly', siteId: plan.siteId, missionPlan: plan, elapsed: 0, paused: true, briefingOpen: true }, 'Mission plan committed', `Target: ${plan.siteName}. Candidate lunar operating window: ${plan.selectedWindow.startTime} to ${plan.selectedWindow.endTime} UTC. The preparation countdown uses a simplified scenario schedule; it is not an Earth-to-Moon launch time.`);
    }
    case 'BEGIN_BRIEFING':
      if (!state.briefingOpen) return state;
      return logEvent({ ...state, briefingOpen: false, paused: false }, 'Mission briefing acknowledged', 'The mission clock has started. Assembly, preparation and launch windows now share one mission time.');
    case 'TOGGLE_PAUSE':
      if (!['assembly', 'launchpad', 'countdown', 'ascent', 'transit', 'landing', 'lunar-operations'].includes(state.phase)) return state;
      return { ...state, paused: !state.paused };
    case 'SET_SPEED':
      return action.speed in GAME_SPEEDS ? { ...state, speed: action.speed } : state;
    case 'SELECT_SITE':
      if (!['assembly', 'launchpad'].includes(state.phase) || state.usedWindowId || state.missionPlan) return state;
      return logEvent({ ...state, siteId: action.siteId }, 'Destination selected', `Candidate landing site set to ${action.siteName}. Site ephemeris and horizon visibility will be shown during lunar operations.`);
    case 'SELECT_PART':
      return { ...state, selectedPart: action.partId };
    case 'DRAG_PART':
      return { ...state, draggedPart: action.partId };
    case 'INSTALL_PART': {
      const component = ASSEMBLY_COMPONENTS.find((part) => part.id === action.partId);
      if (!component || state.phase !== 'assembly' || state.installedParts.includes(component.id)) return state;
      if (component.slot !== action.slotId) return { ...state, draggedPart: null, assemblyFeedback: `That part does not fit this attachment point. ${component.name} belongs in its matching socket.` };
      const installedParts = [...state.installedParts, component.id];
      const completed = installedParts.length === ASSEMBLY_COMPONENTS.length;
      return logEvent({ ...state, installedParts, draggedPart: null, selectedPart: component.id, assemblyFeedback: `${component.name} snapped into place.`, ...(completed ? { phase: 'assembly-complete' } : {}) }, completed ? 'Vehicle assembly complete' : 'Vehicle component installed', completed ? 'All eight generic vehicle components are in place. Review the stack, then proceed to launch-pad preparation.' : `${component.name}: ${component.description}`);
    }
    case 'CLEAR_ASSEMBLY_FEEDBACK':
      return { ...state, assemblyFeedback: '' };
    case 'PROCEED_TO_PAD':
      if (state.phase !== 'assembly-complete') return state;
      return transition(state, 'launchpad', 'Launch-pad preparation started', 'Extend the access platform, review the scenario weather, connect both propellant lines and complete the pad procedure.');
    case 'EXTEND_PLATFORM':
      if (state.phase !== 'launchpad' || state.pad.platformExtended || state.pad.platformRetracted) return state;
      return logEvent({ ...state, pad: { ...state.pad, platformExtended: true } }, 'Service platform extended', 'Ground crews can now access the vehicle connection points.');
    case 'RETRACT_PLATFORM':
      if (state.phase !== 'launchpad' || !state.pad.platformExtended || !state.pad.propellantLoaded || !state.pad.checks.vehicle || !state.pad.checks.spacecraft) return { ...state, pad: { ...state.pad, feedback: 'Complete propellant loading and vehicle/spacecraft checks before retracting the service platform.' } };
      return logEvent({ ...state, pad: { ...state.pad, platformExtended: false, platformRetracted: true, feedback: '' } }, 'Service platform retracted', 'Ground access equipment is clear of the vehicle before terminal countdown.');
    case 'SET_WEATHER_CHOICE':
      return { ...state, pad: { ...state.pad, weatherChoice: { ...state.pad.weatherChoice, [action.windowId]: action.choice }, feedback: '' } };
    case 'ASSESS_WEATHER': {
      const window = LAUNCH_WINDOWS.find((item) => item.id === action.windowId);
      if (!window || !['assembly', 'launchpad'].includes(state.phase)) return state;
      const choice = state.pad.weatherChoice[window.id] || '';
      const correct = choice === window.weather;
      const weatherAssessment = { ...state.pad.weatherAssessment, [window.id]: { choice, correct } };
      const explanation = correct
        ? choice === 'noGo' ? 'Correct. Stand down for this scenario window; preparation progress remains.' : `Correct. The scenario forecast is ${choice.toUpperCase()} for this opportunity.`
        : 'That reading does not match this scenario forecast. Review the indicators and reassess; there is no penalty for a corrected assessment.';
      return logEvent({ ...state, pad: { ...state.pad, weatherAssessment, feedback: explanation } }, correct ? 'Scenario weather assessed' : 'Weather assessment needs review', `${window.name}: ${explanation}`);
    }
    case 'TOGGLE_PROPELLANT_LINE': {
      if (state.phase !== 'launchpad' || !state.pad.platformExtended || state.pad.propellantStartedAt !== null) return state;
      const key = action.line === 'fuel' ? 'fuelConnected' : 'oxidizerConnected';
      return logEvent({ ...state, pad: { ...state.pad, [key]: !state.pad[key], feedback: '' } }, `${action.line === 'fuel' ? 'Fuel' : 'Oxidiser'} umbilical ${state.pad[key] ? 'disconnected' : 'connected'}`, 'The generic training vehicle uses separately labelled fuel and oxidiser service lines. Real propellant systems vary by vehicle.');
    }
    case 'START_PROPELLANT_LOADING':
      if (state.phase !== 'launchpad' || !state.pad.platformExtended || !state.pad.fuelConnected || !state.pad.oxidizerConnected || state.pad.propellantStartedAt !== null) return state;
      return logEvent({ ...state, pad: { ...state.pad, propellantStartedAt: state.elapsed, feedback: '' } }, 'Propellant loading started', 'The simulated loading process is underway. It completes after 35 mission seconds while the global clock runs.');
    case 'CHECK_PAD_ITEM': {
      if (state.phase !== 'launchpad') return state;
      const allowed = action.key === 'vehicle'
        ? state.pad.propellantLoaded && state.pad.fuelConnected && state.pad.oxidizerConnected
        : action.key === 'spacecraft'
          ? state.installedParts.length === ASSEMBLY_COMPONENTS.length
          : action.key === 'site'
            ? state.pad.platformRetracted && Boolean(getWeatherAssessment(state, action.windowId)?.correct && getWeatherAssessment(state, action.windowId)?.choice !== 'noGo')
            : false;
      if (!allowed) return { ...state, pad: { ...state.pad, feedback: action.key === 'vehicle' ? 'Finish loading and verify both propellant lines first.' : action.key === 'site' ? 'Retract the service platform and correctly assess GO/CAUTION weather for this window first.' : 'Complete rocket assembly first.' } };
      const checks = { ...state.pad.checks, [action.key]: true };
      return logEvent({ ...state, pad: { ...state.pad, checks, feedback: '' } }, `${({ vehicle: 'Vehicle connections', spacecraft: 'Spacecraft', site: 'Launch site' })[action.key]} check complete`, 'This simplified checklist item now contributes to its corresponding GO indication.');
    }
    case 'SWITCH_ONBOARD_POWER':
      if (state.phase !== 'launchpad' || !state.pad.platformRetracted || state.pad.onboardPower) return { ...state, pad: { ...state.pad, feedback: 'Retract the service platform before switching the spacecraft to onboard power.' } };
      return logEvent({ ...state, pad: { ...state.pad, onboardPower: true, feedback: '' } }, 'Spacecraft switched to onboard power', 'The lander is no longer using the ground power connection.');
    case 'START_COUNTDOWN': {
      const readiness = getLaunchReadiness(state);
      if (state.phase !== 'launchpad' || !readiness.activeWindow || !readiness.allGo || state.pad.countdownStartedAt !== null) return { ...state, pad: { ...state.pad, feedback: 'Countdown requires all three GO indications and an active, assessed scenario window.' } };
      return logEvent({ ...state, phase: 'countdown', pad: { ...state.pad, countdownStartedAt: state.elapsed, feedback: '' } }, 'Terminal countdown started', `${readiness.activeWindow.name} is active. Press LAUNCH at T−0 within the displayed timing tolerance.`);
    }
    case 'LAUNCH': {
      const readiness = getLaunchReadiness(state);
      const start = state.pad.countdownStartedAt;
      const t0 = start + COUNTDOWN_SECONDS;
      if (state.phase !== 'countdown' || !readiness.activeWindow || !readiness.allGo) return { ...state, pad: { ...state.pad, feedback: 'Launch is locked until all GO conditions are valid inside an active window.' } };
      if (state.elapsed < t0 - COUNTDOWN_TOLERANCE) return { ...state, pad: { ...state.pad, feedback: 'Too early. Hold until the countdown reaches the launch cue.' } };
      if (state.elapsed > t0 + COUNTDOWN_TOLERANCE) return { ...state, phase: 'launchpad', pad: { ...state.pad, countdownStartedAt: null, feedback: 'The timing cue passed. Review the pad state and restart the terminal countdown if the window remains open.' }, activity: [{ time: state.elapsed, title: 'Countdown timing missed', detail: 'The vehicle was not launched. Preparation remains intact.' }, ...state.activity] };
      return logEvent({ ...state, phase: 'ascent', usedWindowId: readiness.activeWindow.id, launch: { time: state.elapsed, windowId: readiness.activeWindow.id }, ascent: { launchedAt: state.elapsed, separatedAt: null, separationPenalty: 0, recoveryUsed: false, fairingSeparated: false, payloadSeparated: false, separationWindowNotified: false, fairingNotified: false, payloadNotified: false } }, `Liftoff · ${readiness.activeWindow.name}`, `The generic robotic lander has launched during the active scenario window to ${action.siteName}. Begin monitoring ascent and stage separation.`);
    }
    case 'SKIP_WINDOW': {
      const window = LAUNCH_WINDOWS.find((item) => item.id === action.windowId);
      if (state.phase !== 'assembly' && state.phase !== 'launchpad' && state.phase !== 'countdown') return state;
      if (!window || getWindowStatus(state, window) !== 'active') return state;
      return logEvent({ ...state, skippedWindows: [...state.skippedWindows, window.id], phase: state.phase === 'countdown' ? 'launchpad' : state.phase, pad: { ...state.pad, countdownStartedAt: null, feedback: 'Window skipped. All assembly and preparation progress is retained.' } }, `${window.name} deliberately skipped`, 'No preparation progress was lost. The mission clock continues toward the next opportunity.');
    }
    case 'SEPARATE_FIRST_STAGE': {
      if (state.phase !== 'ascent' || !state.ascent || state.ascent.separatedAt !== null) return state;
      const sinceLiftoff = state.elapsed - state.ascent.launchedAt;
      if (sinceLiftoff < 20) return { ...state, ascent: { ...state.ascent, feedback: 'First-stage cutoff has not occurred yet. Wait for the separation cue.' } };
      const recovery = sinceLiftoff > 52;
      const penalty = recovery ? 1 : 0;
      return logEvent({ ...state, ascent: { ...state.ascent, separatedAt: state.elapsed, separationPenalty: penalty, recoveryUsed: recovery, feedback: recovery ? 'Contingency separation completed. The mission continues with a simulated performance penalty.' : 'Stage separation confirmed. Upper-stage ignition will follow.' } }, recovery ? 'Contingency stage separation' : 'First-stage separation confirmed', recovery ? 'The normal timing cue was missed; the backup sequence recovered the vehicle with a simulated performance penalty.' : 'The spent first stage has been released. Upper-stage ignition is next.');
    }
    case 'SEPARATE_FAIRING':
      if (state.phase !== 'ascent' || !state.ascent?.separatedAt || state.elapsed < state.ascent.launchedAt + 75 || state.ascent.fairingSeparated) return state;
      return logEvent({ ...state, ascent: { ...state.ascent, fairingSeparated: true, feedback: 'Payload fairing separated after atmospheric protection was no longer needed.' } }, 'Payload fairing separated', 'The lander is exposed after leaving the dense atmosphere.');
    case 'SEPARATE_PAYLOAD':
      if (state.phase !== 'ascent' || !state.ascent?.fairingSeparated || state.elapsed < state.ascent.launchedAt + 110 || state.ascent.payloadSeparated) return state;
      return logEvent({ ...state, phase: 'transit', transit: { startedAt: state.elapsed, questions: RADIO_QUESTIONS.map((item) => ({ id: item.id, status: 'scheduled', answer: null, feedback: '' })) }, ascent: { ...state.ascent, payloadSeparated: true, feedback: 'Spacecraft separation confirmed. The robotic lander is on its schematic lunar transit.' } }, 'Spacecraft separated from upper stage', 'Launch-vehicle ascent is complete. Mission control continues monitoring the robotic lander during transit.');
    case 'SET_TRANSIT_VIEW':
      return { ...state, transit: { ...state.transit, view: action.view } };
    case 'SET_ANSWER': {
      const question = state.transit?.questions.find((item) => item.id === action.questionId);
      if (!question || question.status !== 'pending') return state;
      return { ...state, transit: { ...state.transit, questions: state.transit.questions.map((item) => item.id === action.questionId ? { ...item, answer: action.answer, feedback: '' } : item) } };
    }
    case 'ANSWER_QUESTION': {
      const question = state.transit?.questions.find((item) => item.id === action.questionId);
      const bankItem = RADIO_QUESTIONS.find((item) => item.id === action.questionId);
      if (!question || !bankItem || question.status !== 'pending' || question.answer === null) return state;
      const correct = question.answer === bankItem.correct;
      const questions = state.transit.questions.map((item) => item.id === question.id ? { ...item, status: 'answered', correct, feedback: bankItem.explanation } : item);
      return logEvent({ ...state, transit: { ...state.transit, questions }, educationScore: state.educationScore + Number(correct) }, correct ? 'Science question correct' : 'Science question reviewed', `${correct ? 'Correct. ' : 'The answer has been reviewed. '}${bankItem.explanation}`);
    }
    case 'SELECT_LANDING_ZONE':
      if (state.phase !== 'landing' || state.landing.descentStartedAt !== null) return state;
      return { ...state, landing: { ...state.landing, zone: action.zone, feedback: '' } };
    case 'BEGIN_DESCENT':
      if (state.phase !== 'landing' || !state.landing.zone || state.landing.descentStartedAt !== null) return { ...state, landing: { ...state.landing, feedback: 'Select a schematic landing zone before beginning descent.' } };
      return logEvent({ ...state, landing: { ...state.landing, descentStartedAt: state.elapsed, feedback: '' } }, 'Powered descent started', `Lander is descending toward schematic zone ${state.landing.zone}. Terrain hazard labels are game scenario cues, not a landing-safety assessment.`);
    case 'ADJUST_THRUST':
      if (state.phase !== 'landing' || state.landing.descentStartedAt === null || state.landing.thrustAdjusted) return state;
      if (state.elapsed < state.landing.descentStartedAt + 20) return { ...state, landing: { ...state.landing, feedback: 'Wait for the lower-altitude thrust cue.' } };
      return logEvent({ ...state, landing: { ...state.landing, thrustAdjusted: true, feedback: 'Descent thrust adjusted. Continue monitoring altitude.' } }, 'Descent thrust adjusted', 'The player confirmed the simulated lower-altitude burn cue.');
    case 'ALIGN_LANDER':
      if (state.phase !== 'landing' || state.landing.descentStartedAt === null || state.landing.alignmentComplete || !state.landing.thrustAdjusted) return state;
      if (state.elapsed < state.landing.descentStartedAt + 48) return { ...state, landing: { ...state.landing, feedback: 'Complete the thrust adjustment before aligning over the landing zone.' } };
      return logEvent({ ...state, landing: { ...state.landing, alignmentComplete: true, feedback: 'Lander aligned with the selected schematic zone.' } }, 'Lander aligned over target zone', 'Final descent alignment is complete. Prepare to confirm touchdown.');
    case 'CONFIRM_TOUCHDOWN': {
      if (state.phase !== 'landing' || state.landing.descentStartedAt === null || state.elapsed < state.landing.descentStartedAt + LANDING_DURATION_SECONDS) return { ...state, landing: { ...state.landing, feedback: 'Touchdown confirmation is available after the descent reaches the surface.' } };
      const result = state.landing.zone === 'B' && state.landing.thrustAdjusted && state.landing.alignmentComplete ? 'nominal' : 'rough';
      return logEvent({ ...state, phase: 'lunar-operations', landing: { ...state.landing, touchdown: true, result, feedback: '' }, lunarOps: { ...state.lunarOps, startedAt: state.elapsed, roverDeployed: false } }, result === 'nominal' ? 'Lunar touchdown confirmed' : 'Lunar touchdown confirmed · rough landing', result === 'nominal' ? `The lander touched down at ${action.siteName || state.missionPlan?.siteName || 'the selected candidate site'}. The schematic safe-zone selection and both descent actions were completed.` : `The lander reached ${action.siteName || state.missionPlan?.siteName || 'the selected candidate site'}, but the scenario indicates a rough landing. The first robotic operation remains possible.`);
    }
    case 'DEPLOY_ROVER':
      if (state.phase !== 'lunar-operations' || state.lunarOps.roverDeployed) return state;
      return logEvent({ ...state, lunarOps: { ...state.lunarOps, roverDeployed: true } }, 'Robotic unit deployed', `Robot 01 was deployed at ${action.siteName}. The lunar site readout uses Stargazer's bundled ephemeris and terrain horizon.`);
    case 'START_SURVEY':
      if (state.phase !== 'lunar-operations' || !state.lunarOps.roverDeployed || state.lunarOps.surveyStartedAt !== null) return state;
      return logEvent({ ...state, lunarOps: { ...state.lunarOps, surveyStartedAt: state.elapsed } }, 'Initial terrain survey started', 'Robot 01 is collecting a simple site survey. Sun and Earth visibility will be checked from the existing Stargazer calculations when the survey is reviewed.');
    case 'COMPLETE_SURVEY': {
      if (state.phase !== 'lunar-operations' || state.lunarOps.surveyStartedAt === null || state.lunarOps.surveyComplete || state.elapsed < state.lunarOps.surveyStartedAt + SURVEY_DURATION_SECONDS) return state;
      const surveyResult = { sunVisible: Boolean(action.sunVisible), earthVisible: Boolean(action.earthVisible), completedAt: state.elapsed };
      const detail = `Survey complete. Sun was ${surveyResult.sunVisible ? 'geometrically visible' : 'below the terrain horizon'}; Earth was ${surveyResult.earthVisible ? 'geometrically visible' : 'below the terrain horizon'}. These are visibility results, not power or communications performance.`;
      return logEvent({ ...state, lunarOps: { ...state.lunarOps, surveyComplete: true, surveyResult } }, 'First robotic survey completed', detail);
    }
    case 'RESTART':
      return createInitialState();
    case 'TICK': {
      if (state.paused || !Number.isFinite(action.delta) || action.delta <= 0) return state;
      const elapsed = state.elapsed + action.delta;
      let next = { ...state, elapsed };
      const events = [];

      if (['assembly', 'assembly-complete', 'launchpad', 'countdown'].includes(state.phase)) {
        const windowState = windowEvents(state, Math.min(elapsed, SCENARIO_END));
        next = { ...next, openedWindows: windowState.openedWindows, closedWindows: windowState.closedWindows, activity: windowState.activity };
        if (state.phase === 'launchpad' && state.pad.propellantStartedAt !== null && !state.pad.propellantLoaded && elapsed >= state.pad.propellantStartedAt + PROPELLANT_LOAD_SECONDS) {
          next.pad = { ...next.pad, propellantLoaded: true };
          events.push({ time: state.pad.propellantStartedAt + PROPELLANT_LOAD_SECONDS, title: 'Simulated propellant loading complete', detail: 'Both labelled service lines remained connected through the training load sequence.' });
        }
        if (state.phase === 'countdown' && state.pad.countdownStartedAt !== null && elapsed > state.pad.countdownStartedAt + COUNTDOWN_SECONDS + COUNTDOWN_TOLERANCE) {
          next.phase = 'launchpad';
          next.pad = { ...next.pad, countdownStartedAt: null, feedback: 'Timing cue passed. The countdown was held; pad preparation remains complete.' };
          events.push({ time: state.pad.countdownStartedAt + COUNTDOWN_SECONDS + COUNTDOWN_TOLERANCE, title: 'Countdown held', detail: 'The launch cue passed without a launch command. The vehicle did not liftoff; the checklist remains available.' });
        }
        const preparationDeadline = state.missionPlan?.preparationDeadlineSeconds ?? SCENARIO_END;
        if (elapsed >= preparationDeadline && !state.usedWindowId) {
          next.phase = 'no-launch';
          next.paused = true;
          events.push({ time: preparationDeadline, title: 'Preparation schedule expired', detail: 'The selected operating-window scenario reached its simplified preparation deadline. Review the planning trade-offs and try again.' });
        }
      }

      if (state.phase === 'ascent' && state.ascent) {
        const ascentElapsed = elapsed - state.ascent.launchedAt;
        if (!state.ascent.separationWindowNotified && ascentElapsed >= 20) {
          next.ascent = { ...next.ascent, separationWindowNotified: true };
          events.push({ time: state.ascent.launchedAt + 20, title: 'First-stage cutoff · separation cue', detail: 'The first-stage engine is off. Trigger separation during the cue or use the recoverable backup sequence.' });
        }
        if (!state.ascent.separationWindowNotified && ascentElapsed < 20) next.ascent = { ...next.ascent, separationWindowNotified: false };
        if (state.ascent.separatedAt && !state.ascent.fairingNotified && elapsed >= state.ascent.launchedAt + 75) {
          next.ascent = { ...next.ascent, fairingNotified: true };
          events.push({ time: state.ascent.launchedAt + 75, title: 'Payload fairing separation available', detail: 'Atmospheric protection is no longer needed. Confirm fairing separation.' });
        }
        if (state.ascent.fairingSeparated && !state.ascent.payloadNotified && elapsed >= state.ascent.launchedAt + 110) {
          next.ascent = { ...next.ascent, payloadNotified: true };
          events.push({ time: state.ascent.launchedAt + 110, title: 'Spacecraft separation available', detail: 'The lander can now separate from the launch vehicle.' });
        }
      }

      if (state.phase === 'transit' && state.transit) {
        const transitElapsed = elapsed - state.transit.startedAt;
        const questions = state.transit.questions.map((question) => {
          const item = RADIO_QUESTIONS.find((radio) => radio.id === question.id);
          if (question.status === 'scheduled' && transitElapsed >= item.due && transitElapsed < item.due + 44) {
            events.push({ time: state.transit.startedAt + item.due, title: 'Science-team message received', detail: `A short educational question is waiting in Communications: “${item.question}”` });
            return { ...question, status: 'pending' };
          }
          if ((question.status === 'scheduled' || question.status === 'pending') && transitElapsed >= item.due + 44) {
            events.push({ time: state.transit.startedAt + item.due + 44, title: 'Science-team message timed out', detail: 'The question window expired. The mission continues; the answer and explanation remain available in the activity log.' });
            return { ...question, status: 'missed', feedback: item.explanation };
          }
          return question;
        });
        next.transit = { ...state.transit, questions };
        if (transitElapsed >= TRANSIT_SECONDS) {
          next.phase = 'landing';
          next.landing = { ...state.landing, startedAt: state.elapsed };
          events.push({ time: state.transit.startedAt + TRANSIT_SECONDS, title: 'Lunar approach', detail: `The spacecraft arrived in the Moon vicinity. Prepare the simplified descent to ${action.siteName || 'the selected candidate site'}.` });
        }
      }

      if (state.phase === 'landing' && state.landing.descentStartedAt !== null) {
        const sinceDescent = elapsed - state.landing.descentStartedAt;
        if (!state.landing.thrustAdjusted && sinceDescent >= 20 && state.landing.feedback !== 'thrust-prompted') {
          next.landing = { ...next.landing, feedback: 'thrust-prompted' };
          events.push({ time: state.landing.descentStartedAt + 20, title: 'Lower-altitude thrust cue', detail: 'Review the descent indicator and adjust thrust for the final approach.' });
        }
        if (state.landing.thrustAdjusted && !state.landing.alignmentComplete && sinceDescent >= 48 && state.landing.feedback !== 'alignment-prompted') {
          next.landing = { ...next.landing, feedback: 'alignment-prompted' };
          events.push({ time: state.landing.descentStartedAt + 48, title: 'Landing-zone alignment cue', detail: 'Confirm alignment over the selected schematic zone.' });
        }
        if (sinceDescent >= LANDING_DURATION_SECONDS && !state.landing.touchdown && state.landing.feedback !== 'touchdown-prompted') {
          next.landing = { ...next.landing, feedback: 'touchdown-prompted' };
          events.push({ time: state.landing.descentStartedAt + LANDING_DURATION_SECONDS, title: 'Touchdown confirmation available', detail: 'The descent indicator has reached the surface. Confirm touchdown when ready.' });
        }
      }

      if (state.phase === 'lunar-operations' && state.lunarOps.surveyStartedAt !== null && !state.lunarOps.surveyComplete && elapsed >= state.lunarOps.surveyStartedAt + SURVEY_DURATION_SECONDS && !state.lunarOps.surveyReadyNotified) {
        next.lunarOps = { ...state.lunarOps, surveyReadyNotified: true };
        events.push({ time: state.lunarOps.surveyStartedAt + SURVEY_DURATION_SECONDS, title: 'Initial survey ready for review', detail: 'Review the actual terrain-aware Sun and Earth visibility at this site and complete the mission log.' });
      }

      const preparationDeadline = state.missionPlan?.preparationDeadlineSeconds ?? SCENARIO_END;
      if (elapsed >= preparationDeadline && state.phase !== 'ascent' && state.phase !== 'transit' && state.phase !== 'landing' && state.phase !== 'lunar-operations' && !state.usedWindowId) {
        next.phase = 'no-launch';
        next.paused = true;
      }
      if (events.length) next = { ...next, activity: [...events.sort((a, b) => b.time - a.time), ...next.activity] };
      return next;
    }
    default:
      return state;
  }
}
