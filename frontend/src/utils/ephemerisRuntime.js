import malapert from '../data/ephemeris/malapert.json';
import monsMouton from '../data/ephemeris/mons-mouton.json';
import shackleton from '../data/ephemeris/shackleton.json';

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
  if (timestamp <= samples[0].time.getTime()) return samples[0];
  if (timestamp >= samples[samples.length - 1].time.getTime()) return samples[samples.length - 1];

  const upperIndex = samples.findIndex((sample) => sample.time.getTime() >= timestamp);
  const lower = samples[upperIndex - 1];
  const upper = samples[upperIndex];
  const ratio = (timestamp - lower.time.getTime()) / (upper.time.getTime() - lower.time.getTime());
  return {
    azimuth: lower.azimuth + (upper.azimuth - lower.azimuth) * ratio,
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

export const findNextHorizonTransition = (time, positionCalculator, latitude, longitude) => {
  const initialVisible = isAboveHorizon(positionCalculator(time, latitude, longitude).elevation);
  const stepMs = 30 * 60 * 1000;
  const maxSteps = 29.53 * 24 * 2;

  for (let step = 1; step <= maxSteps; step += 1) {
    const candidateTime = new Date(time.getTime() + step * stepMs);
    const visible = isAboveHorizon(positionCalculator(candidateTime, latitude, longitude).elevation);
    if (visible !== initialVisible) {
      return {
        time: candidateTime,
        visible,
        hours: (candidateTime.getTime() - time.getTime()) / 3600000
      };
    }
  }
  return null;
};

export const getVisibilitySummary = (startTime, positionCalculator, latitude, longitude) => {
  const durationMs = 29.53 * 24 * 60 * 60 * 1000;
  const sampleCount = 240;
  let visibleHours = 0;
  let longestWindowHours = 0;
  let currentWindowHours = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sampleTime = new Date(startTime.getTime() + (index / sampleCount) * durationMs);
    const visible = isAboveHorizon(positionCalculator(sampleTime, latitude, longitude).elevation);
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

export const getVisibilityBands = (startTime, positionCalculator, latitude, longitude) => {
  const sampleCount = 240;
  const bands = [];
  let bandStart = null;

  for (let index = 0; index <= sampleCount; index += 1) {
    const sampleTime = new Date(startTime.getTime() + (index / sampleCount) * 29.53 * 86400000);
    const visible = index < sampleCount
      && isAboveHorizon(positionCalculator(sampleTime, latitude, longitude).elevation);

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
