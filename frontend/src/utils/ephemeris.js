/**
 * Ephemeris calculations for Sun and Earth positions as seen from lunar surface
 * Simplified models for demonstration purposes
 */

/**
 * Calculate Sun's azimuth and elevation as seen from a lunar location
 * @param {Date} time - The time for which to calculate position
 * @param {number} latitude - Latitude of observer on Moon (degrees, -90 to +90)
 * @param {number} longitude - Longitude of observer on Moon (degrees, -180 to +180)
 * @returns {{azimuth: number, elevation: number}} - Sun's position (azimuth 0-360°, elevation -90 to +90°)
 */
export const calculateSunPosition = (time, latitude, longitude) => {
  // Simplified model for lunar south pole observations
  // In reality, this would use proper astronomical algorithms

  const hours = time.getUTCHours() + time.getUTCMinutes() / 60 + time.getUTCSeconds() / 3600;

  // At lunar poles, Sun circles around the horizon with slowly changing elevation
  // Over a year, the Sun's elevation changes from about -1.5° to +1.5°
  // For simplicity, we model a 24-hour cycle with some annual variation

  const startOfYear = Date.UTC(time.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((time.getTime() - startOfYear) / 86400000) + 1;
  const azimuth = (hours / 24) * 360; // Sun circles once per 24 hours

  // Elevation varies based on time of year and time of day
  // At lunar south pole, Sun stays near horizon
  const annualOffset = 1.5 * Math.sin((dayOfYear - 80) * 2 * Math.PI / 365); // Max elevation around June solstice
  const dailyVariation = 1.0 * Math.sin(hours * 2 * Math.PI / 24); // Daily variation

  const elevation = annualOffset + dailyVariation;

  return { azimuth, elevation };
};

/**
 * Calculate Earth's azimuth and elevation as seen from a lunar location
 * @param {Date} time - The time for which to calculate position
 * @param {number} latitude - Latitude of observer on Moon (degrees, -90 to +90)
 * @param {number} longitude - Longitude of observer on Moon (degrees, -180 to +180)
 * @returns {{azimuth: number, elevation: number}} - Earth's position (azimuth 0-360°, elevation -90 to +90°)
 */
export const calculateEarthPosition = (time, latitude, longitude) => {
  // Simplified model: Earth appears to orbit the Moon once per sidereal month
  // From Moon's surface, Earth stays relatively fixed in the sky with small libration

  const days = time.getTime() / (1000 * 60 * 60 * 24); // Days since epoch

  // Earth's position varies slightly due to lunar libration and orbital inclination
  // From lunar south pole, Earth would be near the horizon

  const azimuth = (days * 360 / 27.321661) % 360; // Sidereal month ~27.32 days

  // Elevation depends on latitude - at poles, Earth circles around horizon
  // At equator, Earth would be fixed at some elevation
  const baseElevation = 90 + latitude; // At pole (lat=-90), Earth at 0° elevation (horizon)
  const libration = 2 * Math.sin(days * 2 * Math.PI / 27.321661) +
                   1 * Math.sin(days * 2 * Math.PI / 29.530588); // Synodic month for phases

  const elevation = baseElevation + libration;

  // Keep elevation in reasonable range
  const clampedElevation = Math.max(-90, Math.min(90, elevation));

  return { azimuth, elevation: clampedElevation };
};

/**
 * Convert azimuth and elevation to Cartesian coordinates for rendering
 * Assumes a view centered at (0,0,0) with zenith at (0,0,1)
 * @param {number} azimuth - Azimuth in degrees (0°=North, 90°=East, 180°=South, 270°=West)
 * @param {number} elevation - Elevation in degrees (-90°=nadir, 0°=horizon, +90°=zenith)
 * @returns {{x: number, y: number, z: number}} - Cartesian coordinates
 */
export const azElToCartesian = (azimuth, elevation) => {
  // Convert to radians
  const azRad = azimuth * Math.PI / 180;
  const elRad = elevation * Math.PI / 180;

  // Convert to Cartesian (x=east, y=north, z=up)
  const x = Math.cos(elRad) * Math.sin(azRad);
  const y = Math.cos(elRad) * Math.cos(azRad);
  const z = Math.sin(elRad);

  return { x, y, z };
};

/**
 * Calculate if a celestial body is above the horizon for a given location
 * @param {number} elevation - Elevation in degrees
 * @param {number} horizonMask - Optional horizon obstruction angle (default 0)
 * @returns {boolean} - True if above horizon
 */
export const isAboveHorizon = (elevation, horizonMask = 0) => {
  return elevation > horizonMask;
};

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

  return {
    visibleHours,
    longestWindowHours,
    durationHours: 29.53 * 24
  };
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

export const createEphemerisTable = (startTime, positionCalculator, latitude, longitude) => {
  const sampleCount = 240;
  const durationMs = 29.53 * 86400000;
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const time = new Date(startTime.getTime() + (index / sampleCount) * durationMs);
    return {
      time,
      ...positionCalculator(time, latitude, longitude)
    };
  });
};

export default {
  calculateSunPosition,
  calculateEarthPosition,
  azElToCartesian,
  isAboveHorizon,
  findNextHorizonTransition,
  getVisibilitySummary,
  getVisibilityBands,
  createEphemerisTable
};