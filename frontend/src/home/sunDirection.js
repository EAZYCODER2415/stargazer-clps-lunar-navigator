// Where the Sun and Earth are for the whole Moon, worked out from what one landing site sees.
//
// The ephemeris (NASA/JPL Horizons) gives each body's azimuth and elevation at a site. A site's
// "up", "east" and "north" are known directions on the Moon, so that local direction can be
// rewritten as a direction fixed to the Moon itself. The point of the surface that direction
// passes through is where the body is straight overhead: the sub-solar (or sub-Earth) point.
//
// Moon-fixed axes: x through 0° N 0° E (the middle of the near side), y through 0° N 90° E,
// z through the north pole. The Sun is so far away that every site gives the same answer;
// for Earth the sites differ by under 0.3°.

import { calculateEarthPosition, calculateSunPosition } from '../utils/ephemerisRuntime.js';
import landingSites from '../data/landingSites.json' with { type: 'json' };

const RAD = Math.PI / 180;

/** Unit vector from the Moon's centre through a latitude and east longitude (degrees). */
export function moonFixedFromLatLon(latitude, longitude) {
  const lat = latitude * RAD;
  const lon = longitude * RAD;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
}

/**
 * A direction seen from a site, as a Moon-fixed unit vector. Azimuth is clockwise from north
 * and elevation is above the flat horizon, both in degrees.
 */
export function localToMoonFixed(azimuth, elevation, latitude, longitude) {
  const lat = latitude * RAD;
  const lon = longitude * RAD;
  const up = moonFixedFromLatLon(latitude, longitude);
  const east = { x: -Math.sin(lon), y: Math.cos(lon), z: 0 };
  const north = { x: -Math.sin(lat) * Math.cos(lon), y: -Math.sin(lat) * Math.sin(lon), z: Math.cos(lat) };
  const alongEast = Math.cos(elevation * RAD) * Math.sin(azimuth * RAD);
  const alongNorth = Math.cos(elevation * RAD) * Math.cos(azimuth * RAD);
  const alongUp = Math.sin(elevation * RAD);
  return {
    x: east.x * alongEast + north.x * alongNorth + up.x * alongUp,
    y: east.y * alongEast + north.y * alongNorth + up.y * alongUp,
    z: east.z * alongEast + north.z * alongNorth + up.z * alongUp
  };
}

/** Latitude and east longitude (−180° to 180°) of the point a Moon-fixed vector passes through. */
export function latLonOf(vector) {
  return {
    latitude: Math.asin(Math.max(-1, Math.min(1, vector.z))) / RAD,
    longitude: Math.atan2(vector.y, vector.x) / RAD
  };
}

/**
 * Sun and Earth directions for the whole Moon at `time`, from one site's ephemeris.
 * `litFraction` is how much of the Moon's disc looks lit from Earth (0 = new, 1 = full) and
 * `waxing` says whether that is growing.
 */
export function getMoonLighting(time, site = landingSites[0]) {
  const sun = calculateSunPosition(time, site.latitude, site.longitude);
  const earth = calculateEarthPosition(time, site.latitude, site.longitude);
  const sunVector = localToMoonFixed(sun.azimuth, sun.elevation, site.latitude, site.longitude);
  const earthVector = localToMoonFixed(earth.azimuth, earth.elevation, site.latitude, site.longitude);
  const subSolar = latLonOf(sunVector);
  const subEarth = latLonOf(earthVector);
  const sunAheadOfEarth = (((subSolar.longitude - subEarth.longitude) % 360) + 360) % 360;
  return {
    sunVector,
    earthVector,
    subSolar,
    subEarth,
    litFraction: (1 + sunVector.x * earthVector.x + sunVector.y * earthVector.y + sunVector.z * earthVector.z) / 2,
    // The sub-solar point drifts west. Just after new Moon it is east of the sub-Earth point.
    waxing: sunAheadOfEarth < 180
  };
}
