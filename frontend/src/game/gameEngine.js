// Six fixed clock multipliers. The value in state.speed is the multiplier itself.
export const GAME_SPEEDS = [0.5, 1, 1.5, 2, 2.5, 3];
export const DEFAULT_SPEED = 1;
export const SCENARIO_START = new Date('2026-12-01T00:00:00Z');
export const SCENARIO_END = 1710;
export const COUNTDOWN_SECONDS = 12;
export const COUNTDOWN_TOLERANCE = 3;
export const PROPELLANT_LOAD_SECONDS = 35;
// Range weather is one fixed scenario condition: unsuitable upper-level winds that always
// ease this many mission seconds after pad preparation starts. Never random.
export const WEATHER_HOLD_SECONDS = 60;
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

export const RADIO_QUESTIONS = [
  { id: 'moon-phases', due: 18, question: 'What causes the Moon to have phases?', choices: ['Earth’s shadow covers the Moon', 'We see changing portions of the Moon’s sunlit half', 'The Moon changes shape'], correct: 1, explanation: 'The Sun always illuminates half the Moon. As the Moon orbits Earth, we see different portions of that lit half.' },
  { id: 'gravity', due: 58, question: 'Why is the Moon’s surface gravity lower than Earth’s?', choices: ['The Moon has less mass', 'The Moon is farther from the Sun', 'The Moon has no atmosphere'], correct: 0, explanation: 'The Moon has much less mass than Earth, so its surface gravity is weaker.' },
  { id: 'stages', due: 98, question: 'Why do launch vehicles use multiple stages?', choices: ['To change the vehicle’s colour', 'To discard empty structures and improve vehicle performance', 'To make the vehicle heavier'], correct: 1, explanation: 'Discarding empty stages means later stages do not carry structures they no longer need.' },
  { id: 'fairing', due: 138, question: 'What does a payload fairing do during ascent?', choices: ['Protects the payload from aerodynamic forces and heating', 'Slows the rocket down', 'Generates electricity for the lander'], correct: 0, explanation: 'The fairing shields the payload during atmospheric flight and is discarded after it is no longer needed.' },
];

const initialPad = () => ({
  startedAt: null,
  platformExtended: false,
  weatherAssessed: false,
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
    launch: null,
    debug: null,
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

export function getPreparationDeadline(state) {
  return state.missionPlan?.preparationDeadlineSeconds ?? SCENARIO_END;
}

// The one scenario weather condition, read from the mission clock.
export function getWeather(state) {
  const startedAt = state.pad.startedAt;
  if (startedAt === null || startedAt === undefined) return { clear: false, clearsAt: null, remaining: WEATHER_HOLD_SECONDS, condition: 'Range weather is reviewed once pad preparation starts' };
  const clearsAt = startedAt + WEATHER_HOLD_SECONDS;
  const clear = state.elapsed >= clearsAt;
  return { clear, clearsAt, remaining: Math.max(0, clearsAt - state.elapsed), condition: clear ? 'Upper-level winds within limits · range sky clear' : 'Upper-level winds above limits · easing' };
}

export function getLaunchReadiness(state) {
  const weather = getWeather(state);
  const weatherReady = weather.clear && state.pad.weatherAssessed;
  const deadline = getPreparationDeadline(state);
  const deadlineOpen = state.elapsed < deadline;
  const vehicleGo = state.installedParts.length === ASSEMBLY_COMPONENTS.length
    && state.pad.propellantLoaded && state.pad.checks.vehicle;
  const spacecraftGo = state.installedParts.length === ASSEMBLY_COMPONENTS.length
    && state.pad.checks.spacecraft && state.pad.onboardPower;
  const siteWeatherGo = state.pad.checks.site && state.pad.platformRetracted && weatherReady;
  const go = [vehicleGo, spacecraftGo, siteWeatherGo];
  const requirements = [
    ['Rocket and lander assembled', state.installedParts.length === ASSEMBLY_COMPONENTS.length],
    ['Scenario weather inspected and suitable', weatherReady],
    ['Propellant loading complete', state.pad.propellantLoaded],
    ['Vehicle check complete', state.pad.checks.vehicle],
    ['Spacecraft check and onboard power complete', state.pad.checks.spacecraft && state.pad.onboardPower],
    ['Service platform retracted and site check complete', state.pad.platformRetracted && state.pad.checks.site],
  ];
  return { weather, weatherReady, deadline, deadlineOpen, vehicleGo, spacecraftGo, siteWeatherGo, go, allGo: go.every(Boolean), canLaunch: go.every(Boolean) && deadlineOpen, requirements };
}

function transition(state, phase, title, detail) {
  return logEvent({ ...state, phase }, title, detail);
}

// The pad procedure as the clipboard shows it. Status comes only from pad state, so the
// clipboard, the launch-pad scene and the readiness lights can never disagree.
export function getPadProcedure(state) {
  const pad = state.pad;
  const status = (done, started) => (done ? 'done' : started ? 'active' : 'pending');
  const loading = pad.propellantStartedAt !== null && !pad.propellantLoaded;
  const steps = [
    { id: 'extend', title: 'Extend vehicle access platform', how: 'Drag the yellow access platform across to the vehicle.', status: status(pad.platformExtended || pad.platformRetracted, false) },
    { id: 'lines', title: 'Connect fuel and oxidiser lines', how: 'Drag each hose end to the port ringed in the same colour.', status: status(pad.fuelConnected && pad.oxidizerConnected, pad.fuelConnected || pad.oxidizerConnected), parts: [['Fuel line', pad.fuelConnected], ['Oxidiser line', pad.oxidizerConnected]] },
    { id: 'load', title: 'Load propellant', how: loading ? 'Loading is running on the mission clock. Inspect the spacecraft while you wait.' : 'Slide the loading valve open.', status: status(pad.propellantLoaded, loading), percent: pad.propellantLoaded ? 100 : loading ? Math.min(99, Math.floor((state.elapsed - pad.propellantStartedAt) / PROPELLANT_LOAD_SECONDS * 100)) : 0 },
    { id: 'inspect', title: 'Complete vehicle and spacecraft inspections', how: 'Click the two inspection points on the vehicle.', status: status(pad.checks.vehicle && pad.checks.spacecraft, pad.checks.vehicle || pad.checks.spacecraft), parts: [['Vehicle', pad.checks.vehicle], ['Spacecraft', pad.checks.spacecraft]] },
    { id: 'retract', title: 'Retract access platform', how: 'Drag the access platform back to the tower.', status: status(pad.platformRetracted, false) },
    { id: 'power', title: 'Switch spacecraft to onboard power', how: 'Flip the power switch to ONBOARD.', status: status(pad.onboardPower, false) },
  ];
  const nextIndex = steps.findIndex((step) => step.status !== 'done');
  return steps.map((step, index) => ({ ...step, next: index === nextIndex }));
}

// The seven mission stages shown in the header progress bar and the debug menu.
export const MISSION_STAGES = [
  { id: 'planning', short: 'Planning', label: 'Stage 0 — Mission Planning' },
  { id: 'assembly', short: 'Assembly', label: 'Stage 1 — Assembly' },
  { id: 'launchpad', short: 'Launch prep', label: 'Stage 2 — Launch Preparation' },
  { id: 'ascent', short: 'Ascent', label: 'Stage 3 — Ascent' },
  { id: 'transit', short: 'Transit', label: 'Stage 4 — Transit' },
  { id: 'landing', short: 'Landing', label: 'Stage 5 — Lunar Landing' },
  { id: 'lunar-operations', short: 'Lunar ops', label: 'Stage 6 — Lunar Operations' },
];
const STAGE_OF_PHASE = { planning: 0, assembly: 1, 'assembly-complete': 1, launchpad: 2, countdown: 2, 'no-launch': 2, ascent: 3, transit: 4, landing: 5, 'lunar-operations': 6 };

export function getStageIndex(phase) {
  return STAGE_OF_PHASE[phase] ?? 0;
}

const initialLanding = () => ({ zone: '', descentStartedAt: null, thrustAdjusted: false, alignmentComplete: false, touchdown: false, result: null, feedback: '' });
const initialLunarOps = () => ({ startedAt: null, roverDeployed: false, surveyStartedAt: null, surveyComplete: false, surveyResult: null });

// A clearly labelled stand-in for a Stage 0 plan. Fixed values so every debug run is the same.
function createDebugMissionPlan(siteId, siteName) {
  const start = new Date(SCENARIO_START.getTime() + 10 * 86400000);
  const end = new Date(start.getTime() + 6 * 3600000);
  const record = { siteId, siteName: siteName || siteId, startTime: start.toISOString(), endTime: end.toISOString(), durationMs: end.getTime() - start.getTime(), valid: true, debug: true, basis: 'DEBUG TEST DATA. Not a calculated visibility window.' };
  return { debug: true, siteId, siteName: siteName || siteId, selectedWindow: record, records: [record], planningReferenceTime: SCENARIO_START.toISOString(), preparationAllowanceMs: start.getTime() - SCENARIO_START.getTime(), preparationDeadlineSeconds: SCENARIO_END, schedulingNote: 'DEBUG TEST DATA generated by the developer debug menu. Not a recorded Stage 0 result.' };
}

// Developer debug jump. Builds whatever earlier-stage state the target stage needs, in
// dependency order. Real progress that already satisfies a prerequisite is kept; anything
// invented is listed in state.debug.generated. The target stage itself always starts fresh.
// The mission clock keeps its value on a jump, except when the target is before launch and
// the clock could not be valid there (after a real launch, or past the preparation deadline).
export function createDebugStageState(state, stageId, siteName) {
  const target = MISSION_STAGES.findIndex((stage) => stage.id === stageId);
  if (target < 0) return state;
  if (target === 0) return createInitialState();
  const generated = [];
  const missionPlan = state.missionPlan || createDebugMissionPlan(state.siteId, siteName);
  if (!state.missionPlan) generated.push('Stage 0 mission plan (site and operating window)');
  const deadline = missionPlan.preparationDeadlineSeconds ?? SCENARIO_END;
  let elapsed = state.elapsed;
  if (target === 1) elapsed = 0;
  else if (target === 2 && (state.launch || state.phase === 'no-launch' || elapsed >= deadline - 150)) elapsed = 0;
  const allParts = ASSEMBLY_COMPONENTS.map((part) => part.id);
  let next = { ...state, elapsed, paused: true, briefingOpen: false, phase: stageId, missionPlan, siteId: missionPlan.siteId, draggedPart: null, assemblyFeedback: '', launch: null, ascent: null, transit: null, landing: initialLanding(), lunarOps: initialLunarOps() };

  if (target === 1) next = { ...next, installedParts: [], selectedPart: ASSEMBLY_COMPONENTS[0].id, pad: initialPad() };
  if (target >= 2) {
    if (state.installedParts.length !== allParts.length) generated.push('Completed vehicle assembly');
    next.installedParts = allParts;
  }
  if (target === 2) next.pad = { ...initialPad(), startedAt: elapsed };
  if (target >= 3) {
    const realPad = getLaunchReadiness(state).allGo && Boolean(state.launch);
    if (!realPad) generated.push('Completed launch preparation and liftoff');
    next.pad = realPad ? { ...state.pad, feedback: '' } : { ...initialPad(), startedAt: elapsed, platformRetracted: true, weatherAssessed: true, fuelConnected: true, oxidizerConnected: true, propellantStartedAt: elapsed, propellantLoaded: true, checks: { vehicle: true, spacecraft: true, site: true }, onboardPower: true, countdownStartedAt: elapsed, debug: true };
    next.launch = realPad ? state.launch : { time: elapsed, debug: true };
  }
  const freshAscent = { launchedAt: elapsed, separatedAt: null, separationPenalty: 0, recoveryUsed: false, fairingSeparated: false, payloadSeparated: false, separationWindowNotified: false, fairingNotified: false, payloadNotified: false };
  if (target === 3) { next.ascent = freshAscent; next.launch = { ...next.launch, time: elapsed }; }
  if (target >= 4) {
    const realAscent = Boolean(state.launch && state.ascent?.payloadSeparated);
    if (!realAscent) generated.push('Completed ascent and stage separation');
    next.ascent = realAscent ? state.ascent : { ...freshAscent, separatedAt: elapsed, fairingSeparated: true, payloadSeparated: true, separationWindowNotified: true, fairingNotified: true, payloadNotified: true, debug: true };
  }
  if (target === 4) next.transit = { startedAt: elapsed, questions: RADIO_QUESTIONS.map((item) => ({ id: item.id, status: 'scheduled', answer: null, feedback: '' })) };
  if (target >= 5) {
    const realTransit = Boolean(state.transit && getStageIndex(state.phase) >= 5);
    if (!realTransit) generated.push('Completed transit and lunar arrival');
    next.transit = realTransit ? state.transit : { startedAt: elapsed, debug: true, questions: RADIO_QUESTIONS.map((item) => ({ id: item.id, status: 'missed', answer: null, feedback: item.explanation })) };
  }
  if (target === 5) next.landing = { ...initialLanding(), startedAt: elapsed };
  if (target === 6) {
    const realLanding = Boolean(state.landing?.touchdown);
    if (!realLanding) generated.push('Landing outcome (nominal touchdown, zone B)');
    next.landing = realLanding ? state.landing : { ...initialLanding(), zone: 'B', descentStartedAt: elapsed, thrustAdjusted: true, alignmentComplete: true, touchdown: true, result: 'nominal', debug: true };
    next.lunarOps = { ...initialLunarOps(), startedAt: elapsed };
  }
  next.debug = { stage: stageId, generated: [...new Set([...(state.debug?.generated || []).filter((item) => missionPlan.debug || !item.startsWith('Stage 0')), ...generated])] };
  return logEvent(next, 'DEBUG · stage loaded', `Developer debug mode loaded ${MISSION_STAGES[target].label} with a paused clock. ${generated.length ? `Debug test data generated for: ${generated.join('; ')}.` : 'No test data was needed; existing progress was kept.'} Debug data is not real mission or NASA data.`);
}

export function reducer(state, action) {
  switch (action.type) {
    case 'COMMIT_MISSION_PLAN': {
      const plan = action.plan;
      if (state.phase !== 'planning' || !plan || !Array.isArray(plan.records) || plan.records.length !== 3) return state;
      const sites = new Set(plan.records.map((record) => record.siteId));
      if (sites.size !== 3 || plan.records.some((record) => !record.valid || !(record.durationMs > 0) || !Number.isFinite(Date.parse(record.startTime)) || !Number.isFinite(Date.parse(record.endTime)) || Date.parse(record.startTime) >= Date.parse(record.endTime)) || !plan.selectedWindow?.valid || !plan.records.some((record) => record.siteId === plan.siteId && record.startTime === plan.selectedWindow.startTime && record.endTime === plan.selectedWindow.endTime && record.durationMs === plan.selectedWindow.durationMs)) return state;
      return logEvent({ ...state, phase: 'assembly', siteId: plan.siteId, missionPlan: plan, elapsed: 0, paused: true, briefingOpen: true }, 'Mission plan committed', `Target: ${plan.siteName}. Candidate lunar operating window: ${plan.selectedWindow.startTime} to ${plan.selectedWindow.endTime} UTC. The preparation countdown uses a simplified scenario schedule; it is not an Earth-to-Moon launch time.`);
    }
    case 'BEGIN_BRIEFING':
      if (!state.briefingOpen) return state;
      return logEvent({ ...state, briefingOpen: false, paused: false }, 'Mission briefing acknowledged', 'The mission clock has started. Assembly, launch preparation and flight all share one mission time.');
    case 'TOGGLE_PAUSE':
      if (!['assembly', 'launchpad', 'countdown', 'ascent', 'transit', 'landing', 'lunar-operations'].includes(state.phase)) return state;
      return { ...state, paused: !state.paused };
    case 'SET_SPEED':
      return GAME_SPEEDS.includes(action.speed) ? { ...state, speed: action.speed } : state;
    case 'SELECT_SITE':
      if (!['assembly', 'launchpad'].includes(state.phase) || state.launch || state.missionPlan) return state;
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
      return transition({ ...state, pad: { ...state.pad, startedAt: state.elapsed } }, 'launchpad', 'Launch-pad preparation started', 'Extend the access platform, connect both propellant lines and complete the pad procedure. Scenario range weather is above limits for now and eases on a fixed schedule.');
    case 'EXTEND_PLATFORM':
      if (state.phase !== 'launchpad' || state.pad.platformExtended || state.pad.platformRetracted) return state;
      return logEvent({ ...state, pad: { ...state.pad, platformExtended: true } }, 'Service platform extended', 'Ground crews can now access the vehicle connection points.');
    case 'RETRACT_PLATFORM':
      if (state.phase !== 'launchpad' || !state.pad.platformExtended || !state.pad.propellantLoaded || !state.pad.checks.vehicle || !state.pad.checks.spacecraft) return { ...state, pad: { ...state.pad, feedback: 'Complete propellant loading and vehicle/spacecraft checks before retracting the service platform.' } };
      return logEvent({ ...state, pad: { ...state.pad, platformExtended: false, platformRetracted: true, feedback: '' } }, 'Service platform retracted', 'Ground access equipment is clear of the vehicle before terminal countdown.');
    case 'ASSESS_WEATHER': {
      if (state.phase !== 'launchpad') return state;
      const weather = getWeather(state);
      if (!weather.clear) return logEvent({ ...state, pad: { ...state.pad, weatherAssessed: false, feedback: `Weather inspected: upper-level winds are still above limits. They ease in about ${Math.ceil(weather.remaining)} mission seconds. Wait, then inspect again.` } }, 'Range weather inspected · hold', 'Scenario upper-level winds are above limits. The condition eases on a fixed schedule; no preparation progress is lost while waiting.');
      if (state.pad.weatherAssessed) return state;
      return logEvent({ ...state, pad: { ...state.pad, weatherAssessed: true, feedback: 'Weather inspected: conditions are suitable for launch in this scenario.' } }, 'Range weather inspected · suitable', 'Scenario upper-level winds are within limits. This is fixed game data, not a forecast.');
    }
    case 'TOGGLE_PROPELLANT_LINE': {
      if (state.phase !== 'launchpad' || state.pad.propellantStartedAt !== null) return state;
      if (!state.pad.platformExtended) return { ...state, pad: { ...state.pad, feedback: 'Extend the access platform to the vehicle first. Crews need it to reach the connection points.' } };
      const key = action.line === 'fuel' ? 'fuelConnected' : 'oxidizerConnected';
      return logEvent({ ...state, pad: { ...state.pad, [key]: !state.pad[key], feedback: '' } }, `${action.line === 'fuel' ? 'Fuel' : 'Oxidiser'} umbilical ${state.pad[key] ? 'disconnected' : 'connected'}`, 'The generic training vehicle uses separately labelled fuel and oxidiser service lines. Real propellant systems vary by vehicle.');
    }
    case 'START_PROPELLANT_LOADING':
      if (state.phase !== 'launchpad' || state.pad.propellantStartedAt !== null) return state;
      if (!state.pad.platformExtended || !state.pad.fuelConnected || !state.pad.oxidizerConnected) return { ...state, pad: { ...state.pad, feedback: 'The loading valve stays shut until both the fuel and oxidiser lines are connected.' } };
      return logEvent({ ...state, pad: { ...state.pad, propellantStartedAt: state.elapsed, feedback: '' } }, 'Propellant loading started', 'The simulated loading process is underway. It completes after 35 mission seconds while the global clock runs.');
    case 'CHECK_PAD_ITEM': {
      if (state.phase !== 'launchpad') return state;
      const allowed = action.key === 'vehicle'
        ? state.pad.propellantLoaded && state.pad.fuelConnected && state.pad.oxidizerConnected
        : action.key === 'spacecraft'
          ? state.installedParts.length === ASSEMBLY_COMPONENTS.length
          : action.key === 'site'
            ? state.pad.platformRetracted && getWeather(state).clear && state.pad.weatherAssessed
            : false;
      if (!allowed) return { ...state, pad: { ...state.pad, feedback: action.key === 'vehicle' ? 'Finish loading and verify both propellant lines first.' : action.key === 'site' ? 'Retract the service platform and inspect the weather once it is suitable first.' : 'Complete rocket assembly first.' } };
      const checks = { ...state.pad.checks, [action.key]: true };
      return logEvent({ ...state, pad: { ...state.pad, checks, feedback: '' } }, `${({ vehicle: 'Vehicle connections', spacecraft: 'Spacecraft', site: 'Launch site' })[action.key]} check complete`, 'This simplified checklist item now contributes to its corresponding GO indication.');
    }
    case 'PAD_FEEDBACK':
      // A hands-on attempt in the pad scene that changed nothing, for example a hose dropped on the wrong port.
      if (state.phase !== 'launchpad' || typeof action.message !== 'string') return state;
      return { ...state, pad: { ...state.pad, feedback: action.message } };
    case 'SWITCH_ONBOARD_POWER':
      if (state.phase !== 'launchpad' || !state.pad.platformRetracted || state.pad.onboardPower) return { ...state, pad: { ...state.pad, feedback: 'Retract the service platform before switching the spacecraft to onboard power.' } };
      return logEvent({ ...state, pad: { ...state.pad, onboardPower: true, feedback: '' } }, 'Spacecraft switched to onboard power', 'The lander is no longer using the ground power connection.');
    case 'START_COUNTDOWN': {
      const readiness = getLaunchReadiness(state);
      if (state.phase !== 'launchpad' || !readiness.canLaunch || state.pad.countdownStartedAt !== null) return { ...state, pad: { ...state.pad, feedback: 'Countdown requires all three GO indications before the preparation deadline.' } };
      return logEvent({ ...state, phase: 'countdown', pad: { ...state.pad, countdownStartedAt: state.elapsed, feedback: '' } }, 'Terminal countdown started', 'All three GO indications are green. Press LAUNCH at T−0 within the displayed timing tolerance.');
    }
    case 'LAUNCH': {
      const readiness = getLaunchReadiness(state);
      const start = state.pad.countdownStartedAt;
      const t0 = start + COUNTDOWN_SECONDS;
      if (state.phase !== 'countdown' || !readiness.canLaunch) return { ...state, pad: { ...state.pad, feedback: 'Launch is locked until all three GO conditions are valid before the preparation deadline.' } };
      if (state.elapsed < t0 - COUNTDOWN_TOLERANCE) return { ...state, pad: { ...state.pad, feedback: 'Too early. Hold until the countdown reaches the launch cue.' } };
      if (state.elapsed > t0 + COUNTDOWN_TOLERANCE) return { ...state, phase: 'launchpad', pad: { ...state.pad, countdownStartedAt: null, feedback: 'The timing cue passed. Review the pad state and restart the terminal countdown if preparation time remains.' }, activity: [{ time: state.elapsed, title: 'Countdown timing missed', detail: 'The vehicle was not launched. Preparation remains intact.' }, ...state.activity] };
      return logEvent({ ...state, phase: 'ascent', launch: { time: state.elapsed }, ascent: { launchedAt: state.elapsed, separatedAt: null, separationPenalty: 0, recoveryUsed: false, fairingSeparated: false, payloadSeparated: false, separationWindowNotified: false, fairingNotified: false, payloadNotified: false } }, 'Liftoff', `The generic robotic lander has launched toward ${action.siteName || state.missionPlan?.siteName || 'the selected site'}. Begin monitoring ascent and stage separation.`);
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
    case 'DEBUG_JUMP':
      return createDebugStageState(state, action.stage, action.siteName);
    case 'TICK': {
      if (state.paused || !Number.isFinite(action.delta) || action.delta <= 0) return state;
      const elapsed = state.elapsed + action.delta;
      let next = { ...state, elapsed };
      const events = [];

      if (['assembly', 'assembly-complete', 'launchpad', 'countdown'].includes(state.phase)) {
        if (state.phase === 'launchpad' && state.pad.propellantStartedAt !== null && !state.pad.propellantLoaded && elapsed >= state.pad.propellantStartedAt + PROPELLANT_LOAD_SECONDS) {
          next.pad = { ...next.pad, propellantLoaded: true };
          events.push({ time: state.pad.propellantStartedAt + PROPELLANT_LOAD_SECONDS, title: 'Simulated propellant loading complete', detail: 'Both labelled service lines remained connected through the training load sequence.' });
        }
        if (state.phase === 'countdown' && state.pad.countdownStartedAt !== null && elapsed > state.pad.countdownStartedAt + COUNTDOWN_SECONDS + COUNTDOWN_TOLERANCE) {
          next.phase = 'launchpad';
          next.pad = { ...next.pad, countdownStartedAt: null, feedback: 'Timing cue passed. The countdown was held; pad preparation remains complete.' };
          events.push({ time: state.pad.countdownStartedAt + COUNTDOWN_SECONDS + COUNTDOWN_TOLERANCE, title: 'Countdown held', detail: 'The launch cue passed without a launch command. The vehicle did not liftoff; the checklist remains available.' });
        }
        const preparationDeadline = getPreparationDeadline(state);
        if (elapsed >= preparationDeadline && !state.launch) {
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

      if (elapsed >= getPreparationDeadline(state) && state.phase !== 'ascent' && state.phase !== 'transit' && state.phase !== 'landing' && state.phase !== 'lunar-operations' && !state.launch) {
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
