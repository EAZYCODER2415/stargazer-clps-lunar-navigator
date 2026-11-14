/**
 * Coordinate conversion utilities for lunar horizon visualization
 */

/**
 * Convert equatorial coordinates (RA, Dec) to horizontal coordinates (Az, El)
 * for a given location and time
 * This is a simplified version - real implementation would use proper astrometry
 * @param {number} ra - Right Ascension in hours
 * @param {number} dec - Declination in degrees
 * @param {Date} time - Observation time
 * @param {number} latitude - Observer latitude in degrees
 * @param {number} longitude - Observer longitude in degrees
 * @returns {{azimuth: number, elevation: number}} - Horizontal coordinates
 */
export const equatorialToHorizontal = (ra, dec, time, latitude, longitude) => {
  // Simplified conversion for demonstration
  // In reality, this requires calculating Local Sidereal Time, hour angle, etc.

  const lst = (time.getUTCHours() + time.getUTCMinutes()/60 + time.getUTCSeconds()/3600 +
               longitude/15) * 15; // Rough LST in degrees

  const ha = lst - ra*15; // Hour angle in degrees
  const haRad = ha * Math.PI / 180;
  const decRad = dec * Math.PI / 180;
  const latRad = latitude * Math.PI / 180;

  // Convert to horizontal coordinates
  const elevationRad = Math.asin(
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad)
  );

  const azimuthRad = Math.atan2(
    -Math.sin(haRad),
    Math.cos(decRad) * Math.tan(latRad) - Math.sin(decRad) * Math.cos(haRad)
  );

  // Convert azimuth to 0-360 range (0°=North)
  let azimuth = azimuthRad * 180 / Math.PI;
  if (azimuth < 0) azimuth += 360;

  const elevation = elevationRad * 180 / Math.PI;

  return { azimuth, elevation };
};

/**
 * Convert horizontal coordinates to equatorial coordinates
 * @param {number} azimuth - Azimuth in degrees (0°=North)
 * @param {number} elevation - Elevation in degrees
 * @param {Date} time - Observation time
 * @param {number} latitude - Observer latitude in degrees
 * @param {number} longitude - Observer longitude in degrees
 * @returns {{ra: number, dec: number}} - Equatorial coordinates (RA in hours, Dec in degrees)
 */
export const horizontalToEquatorial = (azimuth, elevation, time, latitude, longitude) => {
  // Simplified conversion
  const azRad = azimuth * Math.PI / 180;
  const elRad = elevation * Math.PI / 180;
  const latRad = latitude * Math.PI / 180;

  const haRad = Math.atan2(
    -Math.sin(azRad),
    Math.cos(elRad) * Math.sin(latRad) + Math.sin(elRad) * Math.cos(latRad) * Math.cos(azRad)
  );

  const decRad = Math.asin(
    Math.sin(elRad) * Math.sin(latRad) - Math.cos(elRad) * Math.cos(latRad) * Math.cos(haRad)
  );

  const lst = haRad + Math.asin(Math.sin(decRad) / Math.cos(latRad)); // Simplified
  const ra = (lst * 12) / Math.PI; // Convert to hours

  const dec = decRad * 180 / Math.PI;

  return { ra, dec };
};

/**
 * Calculate angular distance between two points on sphere
 * @param {number} az1 - Azimuth of point 1 in degrees
 * @param {number} el1 - Elevation of point 1 in degrees
 * @param {number} az2 - Azimuth of point 2 in degrees
 * @param {number} el2 - Elevation of point 2 in degrees
 * @returns {number} - Angular distance in degrees
 */
export const angularDistance = (az1, el1, az2, el2) => {
  // Convert to Cartesian coordinates
  const toCart = (az, el) => {
    const azRad = az * Math.PI / 180;
    const elRad = el * Math.PI / 180;
    return {
      x: Math.cos(elRad) * Math.cos(azRad),
      y: Math.cos(elRad) * Math.sin(azRad),
      z: Math.sin(elRad)
    };
  };

  const p1 = toCart(az1, el1);
  const p2 = toCart(az2, el2);

  // Dot product
  const dot = p1.x * p2.x + p1.y * p2.y + p1.z * p2.z;
  // Clamp to [-1, 1] for numerical stability
  const clampedDot = Math.max(-1, Math.min(1, dot));
  // Angular distance
  return Math.acos(clampedDot) * 180 / Math.PI;
};

/**
 * Normalize angle to 0-360 range
 * @param {number} angle - Angle in degrees
 * @returns {number} - Normalized angle
 */
export const normalizeAngle360 = (angle) => {
  let normalized = angle % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
};

/**
 * Normalize angle to -180 to +180 range
 * @param {number} angle - Angle in degrees
 * @returns {number} - Normalized angle
 */
export const normalizeAngle180 = (angle) => {
  let normalized = angle % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return normalized;
};

export default {
  equatorialToHorizontal,
  horizontalToEquatorial,
  angularDistance,
  normalizeAngle360,
  normalizeAngle180
};