import {
  calculateEarthPosition,
  calculateSunPosition,
  clearanceOf,
} from '../utils/ephemerisRuntime';

export const CAMPAIGN_START = new Date('2026-12-01T00:00:00Z');
export const CAMPAIGN_HOURS = 29.53 * 24;
export const ENERGY_CAP = 60;
export const ROBOT_TRANSIT_HOURS = 6;
export const ROBOT_LAUNCH_COST = { energy: 8, materials: 2 };
export const MAINTENANCE_RECOMMENDED_AFTER = 2;
export const MAINTENANCE_REQUIRED_AFTER = 3;

export const OPERATIONS = {
  survey: {
    id: 'survey', name: 'Survey terrain', durationHours: 6, energy: 12, materials: 1,
    description: 'Map one local terrain sector. Better lighting supports a more detailed survey.',
  },
  explore: {
    id: 'explore', name: 'Explore assigned area', durationHours: 8, energy: 15, materials: 2,
    description: 'Traverse and map one nearby area. An Earth-visible window allows an immediate report.',
  },
  maintenance: {
    id: 'maintenance', name: 'Service robotic unit', durationHours: 4, energy: 4, materials: 1,
    description: 'Reset the simulated usage counter and return the unit to healthy status. Recommended after 2 operations; required after 3.',
  },
  beacon: {
    id: 'beacon', name: 'Deploy outpost beacon', durationHours: 10, energy: 20, materials: 4,
    description: 'Deploy the first fixed outpost marker after surveying the site. Earth visibility during the work allows a check-in.',
  },
};

export function conditionsAt(site, time) {
  const sun = calculateSunPosition(time, site.latitude, site.longitude);
  const earth = calculateEarthPosition(time, site.latitude, site.longitude);
  const sunClearance = clearanceOf(sun, site.latitude, site.longitude);
  const earthClearance = clearanceOf(earth, site.latitude, site.longitude);
  return {
    sun,
    earth,
    sunClearance,
    earthClearance,
    sunVisible: sunClearance > 0,
    earthVisible: earthClearance > 0,
  };
}

export function forecastOperation(site, start, durationHours) {
  let sunVisibleHours = 0;
  let earthVisibleHours = 0;
  let sunElevationSum = 0;
  for (let hour = 0; hour < durationHours; hour += 1) {
    const sampleTime = new Date(start.getTime() + (hour + 0.5) * 3600000);
    const conditions = conditionsAt(site, sampleTime);
    if (conditions.sunVisible) sunVisibleHours += 1;
    if (conditions.earthVisible) earthVisibleHours += 1;
    sunElevationSum += conditions.sun.elevation;
  }
  return {
    sunVisibleHours,
    earthVisibleHours,
    meanSunElevation: sunElevationSum / durationHours,
  };
}

export function makeOutcome(operation, forecast) {
  const solarShare = forecast.sunVisibleHours / operation.durationHours;
  const contact = forecast.earthVisibleHours > 0;
  switch (operation.id) {
    case 'survey':
      return {
        title: solarShare >= 0.5 ? 'Detailed terrain survey completed' : 'Low-light terrain survey completed',
        detail: `${forecast.sunVisibleHours} of ${operation.durationHours} operating hours had the Sun above the local terrain horizon. ${solarShare >= 0.5 ? 'The team recorded a detailed sector map.' : 'The team recorded a basic sector map; strong illumination would improve surface detail.'}`,
      };
    case 'explore':
      return {
        title: 'Exploration traverse completed',
        detail: `One nearby area was traversed. ${forecast.sunVisibleHours} operating hours had terrain-clear sunlight. ${contact ? `An Earth-visible opportunity occurred for ${forecast.earthVisibleHours} hour(s), so the report was marked sent.` : 'Earth stayed below the terrain horizon throughout; the report is marked stored onboard.'}`,
      };
    case 'maintenance':
      return {
        title: 'Robotic unit serviced',
        detail: 'The deterministic game usage counter was reset. This is a gameplay abstraction, not a real reliability or maintenance model.',
      };
    case 'beacon':
      return {
        title: 'Outpost beacon deployed',
        detail: `The first outpost marker is in place. ${contact ? 'An Earth-visible opportunity allowed a check-in during deployment.' : 'No Earth-visible opportunity occurred during deployment; the beacon is awaiting a later check-in.'}`,
      };
    default:
      return { title: 'Operation completed', detail: '' };
  }
}

