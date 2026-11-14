/**
 * Ground model for the 3D view.
 *
 * REAL DATA: the height tiles written by lola_terrain.py. They are cut from NASA's LOLA
 * LDEM_80S_80M elevation map (80 m per pixel) around each landing site, out to about 330 km,
 * with the Moon's curvature included. Everything 80 m across or larger is measured.
 *
 * ILLUSTRATIVE: anything smaller than an 80 m pixel. Within about 300 m of the lander a layer
 * of invented small craters and undulations is added so the ground does not look like smooth
 * facets, and a 4 m landing pad is levelled under the lander. This layer is switched off
 * wherever the ground forms the skyline, and the result is trimmed so that it never rises
 * above the LOLA horizon mask: the mask stays the single source of truth for visibility.
 *
 * Coordinates: metres, x = east, z = south (so north is -z), y = up, origin on the ground at
 * the site. This file has no rendering code, so it can also be run in Node to check it.
 */

const DEG = Math.PI / 180;

// Nested square rings of ground, each four times wider and four times coarser than the one inside it.
export const RING_HALF_WIDTHS = [80, 320, 1280, 5120, 20480, 81920, 327680];
export const RING_CELLS = 128;
const RING_SIZE = RING_CELLS + 1;
export const DATA_PIXEL_M = 80;
// Each ring blends into the next coarser one across this band (fractions of its half width),
// so there is no step in height or shading where two rings meet.
const BLEND_START = 0.72;
const BLEND_END = 0.96;
const PAD_RADIUS = 3.5;            // levelled ground under the lander
const PAD_BLEND_RADIUS = 9;
const SUN_HALF_WIDTH_DEG = 0.265;  // the Sun's real angular radius: sets how soft a terrain shadow edge is
// Extra softening (degrees) per ring. Shadows are stored per vertex, so on the coarse outer rings a
// sharp edge would show as saw-teeth between vertices; a wider edge hides that.
const SHADOW_SOFTENING_DEG = [0, 0, 0.05, 0.2, 0.3, 0.4, 0.5];

// ---------- Deterministic noise (so each site always looks the same) ----------
export const hash2 = (x, y, seed) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};
export const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (from, to, value) => smooth(Math.min(1, Math.max(0, (value - from) / (to - from))));
export const valueNoise = (x, y, seed) => {
  const xi = Math.floor(x); const yi = Math.floor(y);
  const xf = smooth(x - xi); const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed); const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed); const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};
export const fbm = (x, y, seed, octaves = 4) => {
  let total = 0; let amplitude = 0.5; let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 13);
    amplitude *= 0.5; frequency *= 2;
  }
  return total;
};
export const seededRandom = (seed) => {
  let state = seed * 9301 + 49297;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
};

/** Linear interpolation on a square grid of `size` x `size` values with `stride` numbers per point. */
const sampleGrid = (values, size, stride, channel, column, row) => {
  const c = Math.min(size - 1.0001, Math.max(0, column));
  const r = Math.min(size - 1.0001, Math.max(0, row));
  const c0 = Math.floor(c); const r0 = Math.floor(r);
  const fc = c - c0; const fr = r - r0;
  const index = (r0 * size + c0) * stride + channel;
  const a = values[index]; const b = values[index + stride];
  const d = values[index + size * stride]; const e = values[index + size * stride + stride];
  return a + (b - a) * fc + (d - a) * fr + (a - b - d + e) * fc * fr;
};

/**
 * Build the ground for one site.
 * @param meta    the site's terrain .json (levels, far skyline)
 * @param raw     Int16Array view of the site's terrain .bin
 * @param mask    the site's horizon mask: 360 skyline angles in degrees, as seen from eyeHeight
 * @param options { seed, eyeHeight }
 */
export const createLunarTerrain = (meta, raw, mask, { seed = 1, eyeHeight = 3 } = {}) => {
  // ---- Real heights (LOLA) ----
  const levels = meta.levels.map((level) => {
    const count = level.cells * level.cells;
    const start = level.offset_bytes / 2;
    const heights = new Float32Array(count);
    for (let index = 0; index < count; index += 1) heights[index] = raw[start + index] * level.scale_m;
    return { half: level.half_width_m, size: level.cells, spacing: level.spacing_m, heights };
  });
  const sampleLevel = (level, east, north) => (
    sampleGrid(level.heights, level.size, 1, 0, (east + level.half) / level.spacing, (north + level.half) / level.spacing)
  );
  /** Measured height at a point: the finest tile that covers it, eased into the next one near its edge. */
  const dataHeightAt = (x, z) => {
    const reach = Math.max(Math.abs(x), Math.abs(z));
    let index = 0;
    while (index < levels.length - 1 && reach > levels[index].half) index += 1;
    const level = levels[index];
    let height = sampleLevel(level, x, -z);
    if (index < levels.length - 1 && reach > level.half * 0.85) {
      height += (sampleLevel(levels[index + 1], x, -z) - height) * smoothstep(level.half * 0.85, level.half, reach);
    }
    return height;
  };

  // ---- The horizon mask, as a height limit ----
  const maskAt = (azimuth) => {
    const wrapped = ((azimuth % 360) + 360) % 360;
    const lower = Math.floor(wrapped) % 360;
    const fraction = wrapped - Math.floor(wrapped);
    return mask[lower] * (1 - fraction) + mask[(lower + 1) % 360] * fraction;
  };
  const azimuthOf = (x, z) => Math.atan2(x, -z) / DEG;
  /** Degrees between a point and the skyline above it, as seen from the mast. Positive = below the skyline. */
  const headroomAt = (x, y, z) => {
    const distance = Math.hypot(x, z);
    return maskAt(azimuthOf(x, z)) - Math.atan2(y - eyeHeight, distance) / DEG;
  };

  // ---- Illustrative detail smaller than a LOLA pixel ----
  const random = seededRandom(seed);
  const craters = [];
  const addCraters = (count, maxDistance, minRadius, maxRadius) => {
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * maxDistance;
      const radius = minRadius + random() * random() * (maxRadius - minRadius);
      const crater = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, radius, depth: radius * (0.1 + random() * 0.14) };
      if (distance - radius * 1.5 > PAD_BLEND_RADIUS) craters.push(crater);   // keep the landing pad clear
    }
  };
  addCraters(90, 85, 0.8, 5);      // craterlets around the lander
  addCraters(70, 300, 4, 13);      // larger ones further out, still well under one 80 m pixel
  const BUCKET = 32; const BUCKET_SPAN = 12;     // craters sorted into 32 m squares so lookups stay cheap
  const buckets = new Map();
  craters.forEach((crater) => {
    const reach = crater.radius * 1.5;
    for (let bx = Math.floor((crater.x - reach) / BUCKET); bx <= Math.floor((crater.x + reach) / BUCKET); bx += 1) {
      for (let bz = Math.floor((crater.z - reach) / BUCKET); bz <= Math.floor((crater.z + reach) / BUCKET); bz += 1) {
        const key = (bx + BUCKET_SPAN) * 64 + (bz + BUCKET_SPAN);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(crater);
      }
    }
  });
  const detailAt = (x, z, cell) => {
    let total = 0;
    if (cell <= 12) total += (fbm(x / 45 + 17, z / 45 - 9, seed + 1, 2) - 0.375) * 1.5;      // gentle swells, about +/-0.5 m
    if (cell <= 2) total += (fbm(x / 6 + 3, z / 6 + 31, seed + 5, 3) - 0.4375) * 0.32;       // lumps, about +/-0.15 m
    const nearby = buckets.get((Math.floor(x / BUCKET) + BUCKET_SPAN) * 64 + (Math.floor(z / BUCKET) + BUCKET_SPAN));
    if (nearby) {
      for (let index = 0; index < nearby.length; index += 1) {
        const crater = nearby[index];
        if (crater.radius < cell * 1.6) continue;       // too small for this ring's spacing to draw
        const d = Math.hypot(x - crater.x, z - crater.z) / crater.radius;
        if (d < 1.5) {
          const bowl = d < 1 ? -crater.depth * (1 - d * d) : 0;
          total += bowl + crater.depth * 0.2 * Math.exp(-(((d - 1) / 0.22) ** 2));
        }
      }
    }
    return total;
  };

  const trim = { points: 0, maxMetres: 0, maxDegrees: 0 };     // how much measured ground had to be lowered to stay under the mask
  /** The drawn ground at ring spacing `cell`: measured height + illustrative detail, kept under the skyline. */
  const surfaceAt = (x, z, cell, measured) => {
    const distance = Math.hypot(x, z);
    let height = measured;
    if (distance > PAD_RADIUS) {
      if (cell <= 12) {
        // No invented detail on ground that forms (or nearly forms) the skyline.
        const allowed = smoothstep(0.2, 1.0, headroomAt(x, measured, z));
        if (allowed > 0) height += detailAt(x, z, cell) * allowed;
      }
      const limit = eyeHeight + distance * Math.tan((maskAt(azimuthOf(x, z)) - 0.02) * DEG);
      if (height > limit) {
        if (measured > limit) {
          trim.points += 1;
          trim.maxMetres = Math.max(trim.maxMetres, measured - limit);
          trim.maxDegrees = Math.max(trim.maxDegrees, -headroomAt(x, measured, z));
        }
        height = limit;
      }
    }
    return height * smoothstep(PAD_RADIUS, PAD_BLEND_RADIUS, distance);
  };

  /** Broad light and dark patches of dust (illustrative: LOLA measures height, not brightness). */
  const toneAt = (x, z, cell) => {
    let tone = 0.3;
    if (cell <= 6) tone += (valueNoise(x * 0.05, z * 0.05, seed + 3) - 0.5) * 0.09;
    if (cell <= 25) tone += (valueNoise(x * 0.0125 + 7, z * 0.0125, seed + 4) - 0.5) * 0.07;
    if (cell <= 400) tone += (valueNoise(x * 0.0009 + 3, z * 0.0009 + 5, seed + 6) - 0.5) * 0.05;
    return tone + (valueNoise(x * 0.00008 + 1, z * 0.00008 + 2, seed + 8) - 0.5) * 0.05;
  };

  // ---- Rings, built from the outside in so each can blend into the coarser one around it ----
  const rings = RING_HALF_WIDTHS.map((half) => ({
    half,
    cell: (half * 2) / RING_CELLS,
    size: RING_SIZE,
    heights: new Float32Array(RING_SIZE * RING_SIZE),
    slopes: new Float32Array(RING_SIZE * RING_SIZE * 2),     // d(height)/dx and d(height)/dz, for shading
    tones: new Float32Array(RING_SIZE * RING_SIZE),
    sunlight: new Float32Array(RING_SIZE * RING_SIZE).fill(1)
  }));
  const toGrid = (ring, value) => (value + ring.half) / ring.cell;

  for (let ringIndex = rings.length - 1; ringIndex >= 0; ringIndex -= 1) {
    const ring = rings[ringIndex];
    const outer = rings[ringIndex + 1];
    const { half, cell, size, heights, slopes, tones } = ring;
    const fine = cell < DATA_PIXEL_M;
    const measured = new Float32Array(size * size);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const x = -half + column * cell; const z = -half + row * cell;
        const index = row * size + column;
        measured[index] = dataHeightAt(x, z);
        heights[index] = surfaceAt(x, z, cell, measured[index]);
        tones[index] = toneAt(x, z, cell);
      }
    }
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const index = row * size + column;
        const left = row * size + Math.max(0, column - 1); const right = row * size + Math.min(size - 1, column + 1);
        const up = Math.max(0, row - 1) * size + column; const down = Math.min(size - 1, row + 1) * size + column;
        let slopeX; let slopeZ;
        if (fine) {
          // Finer than the data: LOLA's 80 m pixels would show as flat facets with creases between them.
          // Shade with the measured slope averaged over one pixel, plus the slope of the added detail.
          const x = -half + column * cell; const z = -half + row * cell;
          const reach = DATA_PIXEL_M / 2;
          slopeX = (dataHeightAt(x + reach, z) - dataHeightAt(x - reach, z)) / (2 * reach)
            + ((heights[right] - measured[right]) - (heights[left] - measured[left])) / ((right - left) * cell);
          slopeZ = (dataHeightAt(x, z + reach) - dataHeightAt(x, z - reach)) / (2 * reach)
            + ((heights[down] - measured[down]) - (heights[up] - measured[up])) / (((down - up) / size) * cell);
        } else {
          slopeX = (heights[right] - heights[left]) / ((right - left) * cell);
          slopeZ = (heights[down] - heights[up]) / (((down - up) / size) * cell);
        }
        slopes[index * 2] = slopeX; slopes[index * 2 + 1] = slopeZ;
      }
    }
    if (outer) {
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          const x = -half + column * cell; const z = -half + row * cell;
          const blend = smoothstep(BLEND_START, BLEND_END, Math.max(Math.abs(x), Math.abs(z)) / half);
          if (blend <= 0) continue;
          const index = row * size + column;
          const oc = toGrid(outer, x); const or = toGrid(outer, z);
          heights[index] += (sampleGrid(outer.heights, outer.size, 1, 0, oc, or) - heights[index]) * blend;
          tones[index] += (sampleGrid(outer.tones, outer.size, 1, 0, oc, or) - tones[index]) * blend;
          slopes[index * 2] += (sampleGrid(outer.slopes, outer.size, 2, 0, oc, or) - slopes[index * 2]) * blend;
          slopes[index * 2 + 1] += (sampleGrid(outer.slopes, outer.size, 2, 1, oc, or) - slopes[index * 2 + 1]) * blend;
        }
      }
    }
  }

  let highest = -Infinity;
  rings.forEach((ring) => { for (let index = 0; index < ring.heights.length; index += 1) highest = Math.max(highest, ring.heights[index]); });

  const ringFor = (x, z) => {
    const reach = Math.max(Math.abs(x), Math.abs(z));
    for (let index = 0; index < rings.length; index += 1) if (reach <= rings[index].half) return rings[index];
    return null;
  };
  /** Height of the drawn ground (what the meshes show). Beyond the outermost ring this returns its edge. */
  const heightAt = (x, z) => {
    const ring = ringFor(x, z) || rings[rings.length - 1];
    return sampleGrid(ring.heights, ring.size, 1, 0, toGrid(ring, x), toGrid(ring, z));
  };

  // ---- Sunlight: which ground can see the Sun ----
  const farMask = meta.far_mask_deg; const farKm = meta.far_blocker_km;
  let job = null;
  /**
   * Work out which ground can see the Sun, filling every ring's `sunlight` (0 = shadow, 1 = full Sun).
   * From each point we walk towards the Sun across the height data and note the steepest angle
   * to any ground on the way; the point is lit if the Sun stands above that angle. Unlike a
   * shadow map this stays exact when the Sun grazes the surface, and covers all the terrain.
   * Ground beyond the tiles is covered by the far skyline (approximate away from the lander).
   *
   * setSun() starts the work and stepSunlight() does a few milliseconds of it, so a caller can
   * spread it over several frames. stepSunlight returns the rings it finished in that call.
   */
  const setSun = (sunAzimuth, sunElevation) => {
    if (job && Math.abs(job.azimuth - sunAzimuth) < 0.02 && Math.abs(job.elevation - sunElevation) < 0.004) return;
    const farIndex = ((Math.round(sunAzimuth) % 360) + 360) % 360;
    job = {
      azimuth: sunAzimuth,
      elevation: sunElevation,
      stepX: Math.sin(sunAzimuth * DEG),
      stepZ: -Math.cos(sunAzimuth * DEG),
      farSlope: Math.tan(Math.max(-89, farMask[farIndex]) * DEG),
      farDistance: Math.max(1, farKm[farIndex]) * 1000,
      ring: 0,
      row: 0
    };
  };
  const stepSunlight = (budgetMs = Infinity) => {
    const finished = [];
    if (!job || job.ring >= rings.length) return finished;
    const started = performance.now();
    const { stepX, stepZ, farSlope, farDistance } = job;
    const reachLimit = rings[rings.length - 1].half;
    while (job.ring < rings.length) {
      const ring = rings[job.ring];
      const { half, cell, size, heights, sunlight } = ring;
      const hole = job.ring > 0 ? rings[job.ring - 1].half - rings[job.ring - 1].cell : -1;
      const edge = SUN_HALF_WIDTH_DEG + (SHADOW_SOFTENING_DEG[job.ring] || 0);
      const fullSun = Math.tan((job.elevation - edge) * DEG);    // skyline slopes below this leave the whole disc visible
      const noSun = Math.tan((job.elevation + edge) * DEG);      // slopes above this hide it completely
      for (; job.row < size; job.row += 1) {
        if ((job.row & 7) === 0 && performance.now() - started > budgetMs) return finished;
        const z = -half + job.row * cell;
        for (let column = 0; column < size; column += 1) {
          const x = -half + column * cell;
          if (Math.abs(x) < hole && Math.abs(z) < hole) continue;     // covered by the finer ring inside
          const index = job.row * size + column;
          const y = heights[index];
          let steepest = farSlope + (eyeHeight - y) / farDistance;
          let travelled = cell * 0.75;
          while (steepest < noSun) {
            const px = x + stepX * travelled; const pz = z + stepZ * travelled;
            const reach = Math.max(Math.abs(px), Math.abs(pz));
            if (reach >= reachLimit) break;
            if ((highest - y) / travelled <= steepest) break;        // nothing further out is tall enough to matter
            let sample = rings[0];
            for (let search = 0; reach > sample.half; search += 1) sample = rings[search + 1];
            const sampled = sampleGrid(sample.heights, sample.size, 1, 0, (px + sample.half) / sample.cell, (pz + sample.half) / sample.cell);
            const slope = (sampled - y) / travelled;
            if (slope > steepest) steepest = slope;
            travelled += Math.max(sample.cell, travelled * 0.2);
          }
          sunlight[index] = Math.min(1, Math.max(0, (noSun - steepest) / (noSun - fullSun)));
        }
      }
      finished.push(job.ring);
      job.ring += 1; job.row = 0;
    }
    return finished;
  };

  /** Sunlight (0 to 1) on the ground at a point, from the last finished stepSunlight(). */
  const sunlightAt = (x, z) => {
    const ring = ringFor(x, z);
    return ring ? sampleGrid(ring.sunlight, ring.size, 1, 0, toGrid(ring, x), toGrid(ring, z)) : 1;
  };

  /**
   * Skyline of the drawn ground as seen from the mast, for checking against the mask.
   * Returns degrees for each azimuth step.
   */
  const drawnSkyline = (stepDeg = 1) => {
    const result = [];
    for (let azimuth = 0; azimuth < 360; azimuth += stepDeg) {
      const dx = Math.sin(azimuth * DEG); const dz = -Math.cos(azimuth * DEG);
      let steepest = -Infinity; let at = 0;
      for (let travelled = 1; travelled < RING_HALF_WIDTHS[RING_HALF_WIDTHS.length - 1]; travelled += Math.max(0.5, travelled * 0.004)) {
        const slope = (heightAt(dx * travelled, dz * travelled) - eyeHeight) / travelled;
        if (slope > steepest) { steepest = slope; at = travelled; }
      }
      result.push({ azimuth, elevation: Math.atan(steepest) / DEG, distance: at });
    }
    return result;
  };

  return { rings, heightAt, dataHeightAt, headroomAt, maskAt, setSun, stepSunlight, sunlightAt, drawnSkyline, trim, craterCount: craters.length, eyeHeight };
};
