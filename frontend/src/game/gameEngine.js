export const CLOCK_SPEEDS = [60, 120, 240]; // simulated seconds per real second
export const DEFAULT_SPEED = 60; // one simulated minute per real second
export const SCENARIO_END_SECONDS = 24.5 * 60;
export const JOURNEY_DURATION_SECONDS = 10 * 60;
export const SCENARIO_START = new Date('2026-12-01T00:00:00Z');

export const LAUNCH_WINDOWS = [
  {
    id: 'window-1', name: 'Window 1', openAt: 4 * 60, closeAt: 8 * 60,
    condition: 'Clear range · stable scenario conditions', weatherDecision: 'go', risk: 2,
    durationLabel: '4 minutes', summary: 'The first opportunity is relatively long. Scenario risk is moderate.',
  },
  {
    id: 'window-2', name: 'Window 2', openAt: 14 * 60, closeAt: 16.5 * 60,
    condition: 'Rising gust warning · scenario limit exceeded', weatherDecision: 'noGo', risk: 4,
    durationLabel: '2.5 minutes', summary: 'The forecast calls for a no-go. Use this interval to practise a deliberate stand-down and prepare for the final opportunity.',
  },
  {
    id: 'window-3', name: 'Window 3', openAt: 22 * 60, closeAt: 23 * 60,
    condition: 'Variable crosswind · visibility clear', weatherDecision: 'caution', risk: 4,
    durationLabel: '1 minute', summary: 'The final opportunity is short and caution-rated. Optional preparation can reduce the simulated outcome risk.',
  },
];

export const WINDOW_MAP = Object.fromEntries(LAUNCH_WINDOWS.map((window) => [window.id, window]));

export function createInitialGameState() {
  return {
    elapsedSeconds: 0,
    paused: false,
    speed: DEFAULT_SPEED,
    phase: 'preparation',
    department: 'engineering',
    selectedWindowId: LAUNCH_WINDOWS[0].id,
    skippedWindows: [],
    loggedOpenedWindows: [],
    loggedClosedWindows: [],
    usedWindowId: null,
    siteId: 'malapert',
    engineering: { component: '', repair: '', faultResolved: false, powerBusChecked: false, feedback: '' },
    launchOps: { flightTermination: false, payloadRestraint: false, redundantCheck: false },
    communications: { preset: '', verified: false, backupChecked: false, feedback: '' },
    weatherChoices: {},
    weatherAssessments: {},
    launchInfo: null,
    outcome: null,
    activity: [{ time: 0, title: 'Mission control opened', detail: 'Mission 001 is in preparation. The scenario clock is running.' }],
  };
}

function event(time, title, detail) {
  return { time, title, detail };
}

function pushEvents(state, events) {
  return { ...state, activity: [...events, ...state.activity] };
}

export function getWindowStatus(state, window) {
  if (state.usedWindowId === window.id) return 'used';
  if (state.skippedWindows.includes(window.id)) return 'skipped';
  if (state.usedWindowId && state.phase !== 'preparation') {
    return state.launchInfo?.time >= window.closeAt && state.loggedClosedWindows.includes(window.id) ? 'missed' : 'closed';
  }
  if (state.elapsedSeconds >= window.closeAt) return 'missed';
  if (state.elapsedSeconds >= window.openAt) return 'active';
  return 'upcoming';
}

export function getActiveWindow(state) {
  return LAUNCH_WINDOWS.find((window) => getWindowStatus(state, window) === 'active') || null;
}

export function getWindowAssessment(state, windowId) {
  const assessment = state.weatherAssessments[windowId];
  if (!assessment) return 'not assessed';
  if (!assessment.correct) return 'incorrect assessment';
  return assessment.choice === 'noGo' ? 'NO-GO · stand down' : `${assessment.choice === 'caution' ? 'CAUTION' : 'GO'} · assessed`;
}

export function getDepartmentStatuses(state) {
  const activeWindow = getActiveWindow(state);
  const weatherWindowId = activeWindow?.id || state.selectedWindowId;
  const weatherAssessment = state.weatherAssessments[weatherWindowId];
  const weatherWindow = WINDOW_MAP[weatherWindowId];
  return {
    engineering: state.engineering.faultResolved ? 'ready' : state.engineering.feedback === 'wrong' ? 'needs attention' : state.engineering.component || state.engineering.repair ? 'in progress' : 'not started',
    launchOps: state.launchOps.flightTermination && state.launchOps.payloadRestraint ? 'ready' : (!state.launchOps.flightTermination && !state.launchOps.payloadRestraint && !state.launchOps.redundantCheck ? 'not started' : 'in progress'),
    communications: state.communications.verified ? 'ready' : state.communications.feedback === 'wrong' ? 'needs attention' : state.communications.preset ? 'in progress' : 'not started',
    weather: !weatherAssessment
      ? 'assessment needed'
      : !weatherAssessment.correct
        ? 'check assessment'
        : weatherAssessment.choice === 'noGo'
          ? 'NO-GO · stand down'
          : `${weatherAssessment.choice === 'caution' ? 'CAUTION' : 'GO'} · assessed`,
    weatherCanLaunch: Boolean(activeWindow && weatherWindow?.id === activeWindow.id && weatherAssessment?.correct && weatherAssessment.choice !== 'noGo'),
  };
}

export function getReadiness(state) {
  const statuses = getDepartmentStatuses(state);
  const activeWindow = getActiveWindow(state);
  const mandatory = [
    ['Engineering fault resolved', state.engineering.faultResolved],
    ['Flight termination checked', state.launchOps.flightTermination],
    ['Payload restraint checked', state.launchOps.payloadRestraint],
    ['Communications configured', state.communications.verified],
    ['Active window weather assessed GO/CAUTION', statuses.weatherCanLaunch],
  ];
  const mandatoryComplete = mandatory.every(([, complete]) => complete);
  const optionalCount = Number(state.engineering.powerBusChecked)
    + Number(state.launchOps.redundantCheck)
    + Number(state.communications.backupChecked);
  const launchAllowed = Boolean(state.phase === 'preparation' && activeWindow && mandatoryComplete);
  return { statuses, activeWindow, mandatory, mandatoryComplete, optionalCount, launchAllowed };
}

export function getMissionRisk(state, window) {
  const readiness = getReadiness(state);
  const adjustedRisk = Math.max(0, window.risk - readiness.optionalCount);
  const result = adjustedRisk >= 4 ? 'failed' : adjustedRisk >= 2 ? 'delayed' : 'successful';
  const summary = result === 'successful'
    ? 'The lander reached the Moon and deployed the robotic payload.'
    : result === 'delayed'
      ? 'The lander reached the Moon, but the robotic payload deployment was delayed by scenario risk.'
      : 'The lander reached the Moon, but the payload could not be deployed in this scenario. The debrief identifies the remaining risk.';
  return {
    result,
    baseRisk: window.risk,
    optionalMitigation: readiness.optionalCount,
    adjustedRisk,
    summary,
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'TICK': {
      if (state.paused || !['preparation', 'journey'].includes(state.phase)) return state;
      const oldTime = state.elapsedSeconds;
      const journeyEnd = state.launchInfo ? state.launchInfo.time + JOURNEY_DURATION_SECONDS : Infinity;
      const phaseEnd = state.phase === 'journey' ? journeyEnd : SCENARIO_END_SECONDS;
      const nextTime = Math.min(phaseEnd, oldTime + action.deltaSeconds);
      const next = { ...state, elapsedSeconds: nextTime };
      const events = [];

      if (state.phase === 'preparation') {
        for (const window of LAUNCH_WINDOWS) {
          if (oldTime < window.openAt && nextTime >= window.openAt && !state.loggedOpenedWindows.includes(window.id)) {
            events.push(event(window.openAt, `${window.name} opened`, `Scenario conditions: ${window.condition}. Window duration: ${window.durationLabel}.`));
            next.loggedOpenedWindows = [...next.loggedOpenedWindows, window.id];
            next.selectedWindowId = window.id;
          }
          if (oldTime < window.closeAt && nextTime >= window.closeAt && !state.loggedClosedWindows.includes(window.id)) {
            const skipped = state.skippedWindows.includes(window.id);
            if (!skipped) events.push(event(window.closeAt, `${window.name} missed`, 'The launch opportunity closed before launch. Preparation progress is retained.'));
            next.loggedClosedWindows = [...next.loggedClosedWindows, window.id];
          }
        }
        if (nextTime >= SCENARIO_END_SECONDS) {
          next.phase = 'no-launch';
          next.paused = true;
          events.push(event(SCENARIO_END_SECONDS, 'Launch period ended', 'No launch occurred during the three scenario-defined opportunities. Review the mission timeline and preparation tasks.'));
        }
      }
      if (state.phase === 'journey' && nextTime >= journeyEnd) {
        next.phase = 'debrief';
        next.paused = true;
        events.push(event(journeyEnd, 'Lunar arrival', state.outcome.summary));
      }
      return events.length ? pushEvents(next, events.reverse()) : next;
    }
    case 'TOGGLE_PAUSE':
      if (!['preparation', 'journey'].includes(state.phase)) return state;
      return { ...state, paused: !state.paused };
    case 'SET_SPEED':
      return CLOCK_SPEEDS.includes(action.speed) ? { ...state, speed: action.speed } : state;
    case 'SET_DEPARTMENT':
      return { ...state, department: action.department };
    case 'SELECT_SITE':
      if (state.phase !== 'preparation') return state;
      return pushEvents({ ...state, siteId: action.siteId }, [event(state.elapsedSeconds, 'Candidate site selected', `Mission destination set to ${action.siteName}.`)]);
    case 'SELECT_WINDOW':
      return { ...state, selectedWindowId: action.windowId };
    case 'SKIP_WINDOW': {
      const window = WINDOW_MAP[action.windowId];
      if (!window || getWindowStatus(state, window) !== 'active') return state;
      return pushEvents({ ...state, skippedWindows: [...state.skippedWindows, window.id] }, [event(state.elapsedSeconds, `${window.name} deliberately skipped`, 'More time remains to prepare. No readiness or resources were changed by skipping.')]);
    }
    case 'SET_ENGINEERING_COMPONENT':
      return { ...state, engineering: { ...state.engineering, component: action.component, feedback: '' } };
    case 'SET_ENGINEERING_REPAIR':
      return { ...state, engineering: { ...state.engineering, repair: action.repair, feedback: '' } };
    case 'APPLY_ENGINEERING_REPAIR': {
      if (state.engineering.faultResolved) return state;
      if (state.engineering.component === 'landing-sensor' && state.engineering.repair === 'recalibrate') {
        return pushEvents({ ...state, engineering: { ...state.engineering, faultResolved: true, feedback: 'correct' } }, [event(state.elapsedSeconds, 'Engineering fault resolved', 'Landing-leg telemetry sensor recalibrated. Mandatory spacecraft preparation is complete.')]);
      }
      return pushEvents({ ...state, engineering: { ...state.engineering, feedback: 'wrong' } }, [event(state.elapsedSeconds, 'Engineering diagnostic inconclusive', 'That combination did not resolve the landing-leg sensor fault. Review the component indications and try again.')]);
    }
    case 'TOGGLE_POWER_CHECK': {
      const checked = !state.engineering.powerBusChecked;
      return pushEvents({ ...state, engineering: { ...state.engineering, powerBusChecked: checked } }, [event(state.elapsedSeconds, checked ? 'Optional power bus cross-check complete' : 'Optional power bus cross-check withdrawn', checked ? 'Independent status indicators agree with nominal scenario readings.' : 'The optional cross-check no longer counts toward risk mitigation.')]);
    }
    case 'TOGGLE_LAUNCH_CHECK': {
      const nextValue = !state.launchOps[action.key];
      const nextOps = { ...state.launchOps, [action.key]: nextValue };
      const title = action.key === 'flightTermination' ? 'Flight termination system' : action.key === 'payloadRestraint' ? 'Payload restraint' : 'Redundant launch check';
      return pushEvents({ ...state, launchOps: nextOps }, [event(state.elapsedSeconds, `${title} ${nextValue ? 'verified' : 'unchecked'}`, action.key === 'redundantCheck' ? 'Optional independent checklist cross-check.' : 'Launch checklist state updated.')]);
    }
    case 'SET_WEATHER_CHOICE':
      return { ...state, weatherChoices: { ...state.weatherChoices, [action.windowId]: action.choice } };
    case 'ASSESS_WEATHER': {
      const window = WINDOW_MAP[action.windowId];
      if (!window) return state;
      const choice = state.weatherChoices[window.id] || '';
      const correct = choice === window.weatherDecision;
      const assessment = { choice, correct };
      const detail = correct
        ? choice === 'noGo' ? 'Correct assessment. Stand down for this scenario window and preserve the mission.' : 'Correct assessment. This scenario window is acceptable for launch under the stated conditions.'
        : 'That reading does not match the scenario forecast. Review the forecast and reassess; there is no penalty for correcting the assessment.';
      return pushEvents({ ...state, weatherAssessments: { ...state.weatherAssessments, [window.id]: assessment } }, [event(state.elapsedSeconds, correct ? 'Weather assessment recorded' : 'Weather assessment needs review', `${window.name}: ${detail}`)]);
    }
    case 'SET_COMMS_PRESET':
      return { ...state, communications: { ...state.communications, preset: action.preset, feedback: '' } };
    case 'VERIFY_COMMS': {
      const verified = state.communications.preset === 'S2';
      const feedback = verified ? 'correct' : 'wrong';
      const detail = verified ? 'Simulated transponder and ground receiver presets match.' : 'Preset mismatch. The scenario transponder code is S2; adjust the receiver and retry.';
      return pushEvents({ ...state, communications: { ...state.communications, verified, feedback } }, [event(state.elapsedSeconds, verified ? 'Simulated communications verified' : 'Communications configuration mismatch', detail)]);
    }
    case 'TOGGLE_BACKUP_COMMS': {
      const checked = !state.communications.backupChecked;
      return pushEvents({ ...state, communications: { ...state.communications, backupChecked: checked } }, [event(state.elapsedSeconds, checked ? 'Optional backup communications path checked' : 'Optional backup check withdrawn', 'This is a game checklist item, not a radio link-budget result.')]);
    }
    case 'LAUNCH': {
      const readiness = getReadiness(state);
      if (!readiness.launchAllowed || readiness.activeWindow?.id !== action.windowId) return state;
      const window = readiness.activeWindow;
      const outcome = getMissionRisk(state, window);
      return pushEvents({
        ...state,
        phase: 'journey',
        paused: false,
        usedWindowId: window.id,
        launchInfo: { time: state.elapsedSeconds, windowId: window.id, siteId: state.siteId },
        outcome,
      }, [event(state.elapsedSeconds, `Mission launched · ${window.name}`, `Destination: ${action.siteName}. ${outcome.summary} Scenario risk index ${outcome.adjustedRisk} after ${outcome.optionalMitigation} optional preparation checks.`)]);
    }
    default:
      return state;
  }
}
