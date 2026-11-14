import malapert from '../data/ephemeris/malapert.json';
import monsMouton from '../data/ephemeris/mons-mouton.json';
import shackleton from '../data/ephemeris/shackleton.json';
// Real skylines from NASA LOLA elevation data (written by lola_terrain.py)
import malapertHorizon from '../data/horizon/malapert.json';
import monsMoutonHorizon from '../data/horizon/mons-mouton.json';
import shackletonHorizon from '../data/horizon/shackleton.json';

const HORIZONS = { malapert: malapertHorizon, 'mons-mouton': monsMoutonHorizon, shackleton: shackletonHorizon };
const FLAT_MASK = new Array(360).fill(0);

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

function parseEphemerisTime(value) {
  if (value.includes('T')) return new Date(value);
  const [date, clock] = value.split(' ');
  const [year, month, day] = date.split('-');
  const [hour, minute] = clock.split(':');
  return new Date(Date.UTC(Number(year), MONTHS[month], Number(day), Number(hour), Number(minute)));
}

const sites = [malapert, monsMouton, shackleton].map((data) => ({
  ...data,
  horizon: HORIZONS[data.site.id] || null,
  sun: data.sun.map(normalizeSample),
  earth: data.earth.map(normalizeSample)
}));

function normalizeSample(sample) {
  return {
    time: parseEphemerisTime(sample.t),
    azimuth: sample.az,
    elevation: sample.el
  };
}

function findSite(latitude, longitude) {
  return sites.reduce((closest, site) => {
    const distance = Math.hypot(site.site.lat - latitude, site.site.lon - longitude);
    return distance < closest.distance ? { site, distance } : closest;
  }, { site: sites[0], distance: Infinity }).site;
}

function interpolate(samples, time) {
  const timestamp = time.getTime();
  const first = samples[0].time.getTime();
  const last = samples[samples.length - 1].time.getTime();
  if (timestamp <= first) return samples[0];
  if (timestamp >= last) return samples[samples.length - 1];

  // Samples are evenly spaced (hourly), so jump straight to the right pair.
  const stepMs = (last - first) / (samples.length - 1);
  const lowerIndex = Math.min(samples.length - 2, Math.floor((timestamp - first) / stepMs));
  const lower = samples[lowerIndex];
  const upper = samples[lowerIndex + 1];
  const ratio = (timestamp - lower.time.getTime()) / (upper.time.getTime() - lower.time.getTime());
  // Azimuth wraps at 360°, so interpolate along the short way round.
  let azimuthDelta = upper.azimuth - lower.azimuth;
  if (azimuthDelta > 180) azimuthDelta -= 360;
  if (azimuthDelta < -180) azimuthDelta += 360;
  return {
    azimuth: (lower.azimuth + azimuthDelta * ratio + 360) % 360,
    elevation: lower.elevation + (upper.elevation - lower.elevation) * ratio
  };
}

const calculatePosition = (body, time, latitude, longitude) => (
  interpolate(findSite(latitude, longitude)[body], time)
);

export const getBestOverlap = (latitude, longitude) => {
  const overlap = findSite(latitude, longitude).best_overlap;
  return overlap?.start
    ? { hours: overlap.hours, time: parseEphemerisTime(overlap.start) }
    : null;
};

export const calculateSunPosition = (time, latitude, longitude) => (
  calculatePosition('sun', time, latitude, longitude)
);

export const calculateEarthPosition = (time, latitude, longitude) => (
  calculatePosition('earth', time, latitude, longitude)
);

export const azElToCartesian = (azimuth, elevation) => {
  const azimuthRadians = azimuth * Math.PI / 180;
  const elevationRadians = elevation * Math.PI / 180;
  return {
    x: Math.cos(elevationRadians) * Math.sin(azimuthRadians),
    y: Math.cos(elevationRadians) * Math.cos(azimuthRadians),
    z: Math.sin(elevationRadians)
  };
};

export const isAboveHorizon = (elevation, horizonMask = 0) => elevation > horizonMask;

/** Skyline for a site: 360 angles in degrees, one per degree of azimuth. terrain=false gives a flat horizon. */
export const getHorizonMask = (latitude, longitude, terrain = true) => (
  (terrain && HORIZONS[findSite(latitude, longitude).site.id]?.mask_deg) || FLAT_MASK
);

/** Skyline elevation at any azimuth (interpolated between whole degrees). */
export const horizonAt = (latitude, longitude, azimuth, terrain = true) => {
  const mask = getHorizonMask(latitude, longitude, terrain);
  const wrapped = ((azimuth % 360) + 360) % 360;
  const lower = Math.floor(wrapped) % 360;
  const fraction = wrapped - Math.floor(wrapped);
  return mask[lower] * (1 - fraction) + mask[(lower + 1) % 360] * fraction;
};

/** Degrees between a body and the skyline below it. Positive = visible. */
export const clearanceOf = (position, latitude, longitude, terrain = true) => (
  position.elevation - horizonAt(latitude, longitude, position.azimuth, terrain)
);

/** Hourly az/el samples for one body over the lunar day (used to draw sky paths). */
export const getSkyPath = (startTime, positionCalculator, latitude, longitude) => (
  Array.from({ length: Math.floor(29.53 * 24) + 1 }, (_, hour) => {
    const time = new Date(startTime.getTime() + hour * 3600000);
    return { time, ...positionCalculator(time, latitude, longitude) };
  })
);

export const findNextHorizonTransition = (time, positionCalculator, latitude, longitude) => {
  const initialVisible = clearanceOf(positionCalculator(time, latitude, longitude), latitude, longitude) > 0;
  const stepMs = 30 * 60 * 1000;
  const maxSteps = 29.53 * 24 * 2;

  for (let step = 1; step <= maxSteps; step += 1) {
    const candidateTime = new Date(time.getTime() + step * stepMs);
    const visible = clearanceOf(positionCalculator(candidateTime, latitude, longitude), latitude, longitude) > 0;
    if (visible !== initialVisible) {
      return {
        time: candidateTime,
        visible,
        hours: (candidateTime.getTime() - time.getTime()) / 3600000
      };
>>>>>>> main
    }
    previousVisible = visible;
  }
  return null;
};

/**
 * One pass over a site's hourly data for the lunar day starting at startTime.
 * Everything the UI shows about "how many hours" comes from here, so the
 * timeline, the banner and the comparison panel can never disagree.
 */
export const getSiteWindows = (startTime, latitude, longitude, terrain = true) => {
  const hours = Math.floor(LUNAR_DAY_HOURS);
  let sunHours = 0; let earthHours = 0; let bothHours = 0;
  let darkRun = 0; let longestDarkHours = 0;
  let noEarthRun = 0; let longestNoEarthHours = 0;
  let bothRun = 0; let bestBoth = { hours: 0, start: null };

  for (let hour = 0; hour < hours; hour += 1) {
    const sampleTime = new Date(startTime.getTime() + hour * 3600000);
    const sunUp = clearanceOf(calculateSunPosition(sampleTime, latitude, longitude), latitude, longitude, terrain) > 0;
    const earthUp = clearanceOf(calculateEarthPosition(sampleTime, latitude, longitude), latitude, longitude, terrain) > 0;
    if (sunUp) { sunHours += 1; darkRun = 0; } else { darkRun += 1; longestDarkHours = Math.max(longestDarkHours, darkRun); }
    if (earthUp) { earthHours += 1; noEarthRun = 0; } else { noEarthRun += 1; longestNoEarthHours = Math.max(longestNoEarthHours, noEarthRun); }
    if (sunUp && earthUp) {
      bothHours += 1;
      bothRun += 1;
      if (bothRun > bestBoth.hours) {
        bestBoth = { hours: bothRun, start: new Date(sampleTime.getTime() - (bothRun - 1) * 3600000) };
      }
    } else {
      bothRun = 0;
    }
  }

  return {
    totalHours: hours,
    sunHours, earthHours, bothHours,
    longestDarkHours, longestNoEarthHours,
    longestBothHours: bestBoth.hours,
    longestBothStart: bestBoth.start
  };
};

/**
 * Every horizon crossing of one body in the lunar day starting at startTime.
 * Found once per site (hourly scan, then narrowed to the minute), so the UI can
 * look up "what happens next" instantly while the timeline plays.
 */
export const getHorizonEvents = (startTime, positionCalculator, latitude, longitude, terrain = true) => {
  const events = [];
  const isUp = (ms) => clearanceOf(positionCalculator(new Date(ms), latitude, longitude), latitude, longitude, terrain) > 0;
  const startMs = startTime.getTime();
  const endMs = startMs + LUNAR_DAY_HOURS * 3600000;
  let previousMs = startMs;
  let previousUp = isUp(startMs);
  for (let ms = startMs + 3600000; previousMs < endMs; ms += 3600000) {
    const currentMs = Math.min(ms, endMs);
    const currentUp = isUp(currentMs);
    if (currentUp !== previousUp) {
      let low = previousMs; let high = currentMs;
      while (high - low > 60000) {
        const middle = (low + high) / 2;
        if (isUp(middle) === previousUp) low = middle; else high = middle;
      }
      events.push({ time: new Date(high), kind: currentUp ? 'rise' : 'set' });
    }
    previousMs = currentMs;
    previousUp = currentUp;
  }
  return events;
};

/** Hourly az/el samples for one body over the lunar day (used to draw sky paths). */
export const getSkyPath = (startTime, positionCalculator, latitude, longitude) => (
  Array.from({ length: Math.floor(LUNAR_DAY_HOURS) + 1 }, (_, hour) => {
    const time = new Date(startTime.getTime() + hour * 3600000);
    return { time, ...positionCalculator(time, latitude, longitude) };
  })
);

export const getVisibilitySummary = (startTime, positionCalculator, latitude, longitude) => {
  const durationMs = 29.53 * 24 * 60 * 60 * 1000;
  const sampleCount = 240;
  let visibleHours = 0;
  let longestWindowHours = 0;
  let currentWindowHours = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sampleTime = new Date(startTime.getTime() + (index / sampleCount) * durationMs);
    const visible = clearanceOf(positionCalculator(sampleTime, latitude, longitude), latitude, longitude) > 0;
    const sampleHours = 29.53 * 24 / sampleCount;
    if (visible) {
      visibleHours += sampleHours;
      currentWindowHours += sampleHours;
      longestWindowHours = Math.max(longestWindowHours, currentWindowHours);
    } else {
      currentWindowHours = 0;
    }
  }

  return { visibleHours, longestWindowHours, durationHours: 29.53 * 24 };
};

export const getVisibilityBands = (startTime, positionCalculator, latitude, longitude, terrain = true) => {
  const sampleCount = 240;
  const bands = [];
  let bandStart = null;

  for (let index = 0; index <= sampleCount; index += 1) {
    const sampleTime = new Date(startTime.getTime() + (index / sampleCount) * 29.53 * 86400000);
    const visible = index < sampleCount
      && clearanceOf(positionCalculator(sampleTime, latitude, longitude), latitude, longitude) > 0;

    if (visible && bandStart === null) bandStart = index;
    if ((!visible || index === sampleCount) && bandStart !== null) {
      bands.push({
        left: (bandStart / sampleCount) * 100,
        width: ((index - bandStart) / sampleCount) * 100
      });
      bandStart = null;
    }
  }
  return bands;
};

export const createEphemerisTable = (startTime, positionCalculator, latitude, longitude) => (
  Array.from({ length: 241 }, (_, index) => {
    const time = new Date(startTime.getTime() + (index / 240) * 29.53 * 86400000);
    return { time, ...positionCalculator(time, latitude, longitude) };
  })
);
