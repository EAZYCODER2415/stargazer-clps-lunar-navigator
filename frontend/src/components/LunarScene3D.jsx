import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import '../styles/lunarScene.css';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  calculateEarthPosition,
  calculateSunPosition,
  clearanceOf,
  getHorizonMask,
  getSkyPath
} from '../utils/ephemerisRuntime';
import { createLunarTerrain, fbm, hash2, RING_CELLS, seededRandom, smooth } from '../utils/lunarTerrain';
import { loadTerrainTiles } from '../utils/terrainTiles';

const DEG = Math.PI / 180;

// ---- Scene scale: 1 unit = 1 metre. The ground at the landing site is y = 0. ----
const MAST_HEIGHT = 3;             // POV camera sits on the lander's sensor mast
const EYE_Y = MAST_HEIGHT;         // the horizon mask was computed for an eye 3 m above the ground
// The sky (Sun, Earth, paths, grid, far skyline) is drawn in its own pass, centred on the camera,
// before the ground. So these radii only set the order of things within the sky; real terrain
// tens of kilometres away is still drawn in front of all of it.
const SKY_RADIUS = 4000;
const SKYLINE_RADIUS = 3800;       // the mask skyline sits just inside the Sun and Earth, so it hides them correctly
// Sun shadows of the rocks and the lander use a fine shadow map over the ground near the lander.
// Shadows cast by the terrain itself are worked out directly from the height data (see lunarTerrain.js).
const SHADOW_MAP_SIZE = 2048;      // holds 60 fps on integrated laptop graphics
const SHADOW_HALF = 60;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 900;
const FAR_LAYER = 2;               // terrain beyond ~5 km is drawn in a separate pass, to keep depth precise at both scales
const FAR_RING_START = 4;
const GRAIN_TILE_M = 13.3;         // one repeat of the dust texture
const SUN_STRENGTH = 4.2;          // how bright full sunlight is on the ground, rocks and lander
// Free View: fly over the real ground like a first-person game, never more than this far from the lander.
const FREE_VIEW_RANGE = 2000;
const FREE_VIEW_EYE_HEIGHT = 2;    // the eye never gets closer to the ground than this
const FREE_VIEW_CEILING = 500;     // ... and never further above it than this
const FREE_VIEW_KEEP_OUT = 3.5;    // do not fly through the lander
const FREE_VIEW_START_DISTANCE = 16;
const FREE_VIEW_BASE_SPEED = 25;   // metres per second beside the lander
const FREE_VIEW_SPEED_PER_METRE = 0.156;   // faster further out, so the 2 km range does not take minutes to cross
const FREE_VIEW_MAX_SPEED = 100;      // before the Shift boost
const FREE_VIEW_BOOST = 4;         // Shift
const FREE_VIEW_PAD_STEP = 3;      // metres per click of the on-screen pad
const DEFAULT_LOOK_SENSITIVITY = 1.8;
const MOVE_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);

// Real angular radii: Sun 0.27°, Earth 0.95° as seen from the Moon. Drawn larger so they read on screen.
const SUN_EXAGGERATION = 3;
const EARTH_EXAGGERATION = 2;
const SUN_RADIUS = SKY_RADIUS * Math.tan(0.265 * SUN_EXAGGERATION * DEG);
const EARTH_RADIUS = SKY_RADIUS * Math.tan(0.95 * EARTH_EXAGGERATION * DEG);
const EARTH_SIDEREAL_DAY_MS = 23.9345 * 3600000;

const SUN_COLOR = 0xfbbf24;
const EARTH_COLOR = 0x38bdf8;

/** Unit vector for an azimuth (0° = north = -Z, 90° = east = +X) and elevation. */
const skyDirection = (azimuth, elevation) => new THREE.Vector3(
  Math.sin(azimuth * DEG) * Math.cos(elevation * DEG),
  Math.sin(elevation * DEG),
  -Math.cos(azimuth * DEG) * Math.cos(elevation * DEG)
);

const skyPoint = (azimuth, elevation, radius = SKY_RADIUS) => (
  skyDirection(azimuth, elevation).multiplyScalar(radius).add(new THREE.Vector3(0, EYE_Y, 0))
);

// ---------- Terrain ----------
// REAL: the ground mesh is built from NASA LOLA elevation data (LDEM_80S_80M, 80 m per pixel) out to
//   about 330 km, and the skyline shell behind it is the LOLA horizon mask. Terrain shadows are worked
//   out from the same heights.
// ILLUSTRATIVE: everything smaller than an 80 m pixel. The small craters and swells within ~300 m of
//   the lander, the rocks, the dust texture, the light and dark patches and the levelled landing pad
//   are invented, and are kept below the mask skyline so they can never change what is visible.
const SITE_SEEDS = { malapert: 11, shackleton: 23, 'mons-mouton': 37 };

/** Noise that repeats every `period` cells, so the texture built from it tiles without seams. */
const tileNoise = (x, y, period, seed) => {
  const wrap = (value) => ((value % period) + period) % period;
  const xi = Math.floor(x); const yi = Math.floor(y);
  const xf = smooth(x - xi); const yf = smooth(y - yi);
  const a = hash2(wrap(xi), wrap(yi), seed); const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed); const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};

/**
 * Regolith grain: fine clumps, speckle and a scatter of tiny pits. Used both as the
 * surface colour and as a bump map, so low sunlight picks out the texture of the dust.
 * Only small features are drawn here, so the repeat is not visible; large-scale tone
 * comes from the terrain's vertex colours.
 */
const createRegolithTexture = (seed) => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const values = new Float32Array(size * size);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const u = px / size; const v = py / size;
      const clumps = 0.5 * tileNoise(u * 12, v * 12, 12, seed)
        + 0.3 * tileNoise(u * 32, v * 32, 32, seed + 3)
        + 0.2 * tileNoise(u * 96, v * 96, 96, seed + 7);
      values[py * size + px] = 0.76 + 0.22 * clumps + 0.02 * hash2(px, py, seed + 11);
    }
  }
  // Tiny pits (centimetre to half-metre craterlets), wrapped across the tile edges.
  const random = seededRandom(seed + 57);
  for (let pit = 0; pit < 70; pit += 1) {
    const cx = random() * size; const cy = random() * size;
    const radius = 2 + random() * random() * 16;
    const reach = Math.ceil(radius * 1.5);
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const d = Math.hypot(dx, dy) / radius;
        if (d < 1.5) {
          const bowl = d < 1 ? -0.16 * (1 - d * d) : 0;
          const rim = 0.05 * Math.exp(-(((d - 1) / 0.25) ** 2));
          const x = ((Math.round(cx) + dx) % size + size) % size;
          const y = ((Math.round(cy) + dy) % size + size) % size;
          values[y * size + x] += bowl + rim;
        }
      }
    }
  }
  for (let index = 0; index < values.length; index += 1) {
    const level = Math.round(255 * Math.min(1, Math.max(0, values[index])));
    image.data[index * 4] = level; image.data[index * 4 + 1] = level;
    image.data[index * 4 + 2] = level; image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  // The ground's texture coordinates are in units of one tile (about 13 m), so no extra repeat is set here.
  texture.anisotropy = 8;                // the ground is always seen at a shallow angle
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/**
 * Lunar dust does not shade like a matte (Lambert) surface. It scatters light back towards the Sun
 * and stays bright right up to grazing angles, which is why the full Moon looks like a flat disc
 * with no darker edge. This swaps the lighting of a Lambert material for the "lunar-Lambert" mix
 * used in planetary mapping: mostly Lommel-Seeliger, 2*mu0/(mu0+mu), with a little Lambert, times a
 * backscatter term that brightens the ground when the Sun is behind the viewer. Because that
 * response is bounded, slopes facing a low Sun no longer blow out to white.
 * (An approximation for looks: the constants are chosen by eye, not fitted to lunar photometry.)
 * With `terrain: true` the Sun's light is also multiplied by the per-vertex `sunlight` attribute,
 * which holds the terrain shadows computed from the height data.
 */
const REGOLITH_LIGHTING = /* glsl */`
varying vec3 vViewPosition;
struct LambertMaterial {
  vec3 diffuseColor;
  float specularStrength;
};
uniform vec3 uSunDirView;
uniform float uSunBoost;
#ifdef TERRAIN_SUNLIGHT
  varying float vSunlight;
#endif
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float mu0 = saturate( dot( geometryNormal, directLight.direction ) );
  float mu = saturate( dot( geometryNormal, geometryViewDir ) );
  float lommelSeeliger = 2.0 * mu0 / ( mu0 + mu + 0.02 );
  float facingSun = dot( directLight.direction, geometryViewDir ) * 0.5 + 0.5;
  float backscatter = 0.5 + 0.5 * facingSun * facingSun + 0.2 * pow( facingSun, 24.0 );
  float response = mix( mu0, lommelSeeliger, 0.85 ) * backscatter;
  vec3 light = directLight.color;
  #ifdef TERRAIN_SUNLIGHT
    if ( dot( directLight.direction, uSunDirView ) > 0.9999 ) light *= uSunBoost * vSunlight;
  #endif
  reflectedLight.directDiffuse += light * response * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

const createRegolithMaterial = (sunUniforms, parameters, terrain = false) => {
  // Still a Lambert material underneath (no gloss): only the diffuse response is replaced.
  const material = new THREE.MeshLambertMaterial(parameters);
  if (terrain) material.defines = { TERRAIN_SUNLIGHT: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirView = sunUniforms.uSunDirView;
    shader.uniforms.uSunBoost = sunUniforms.uSunBoost;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifdef TERRAIN_SUNLIGHT\nattribute float sunlight;\nvarying float vSunlight;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef TERRAIN_SUNLIGHT\nvSunlight = sunlight;\n#endif');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', REGOLITH_LIGHTING);
  };
  material.customProgramCacheKey = () => (terrain ? 'regolith-terrain' : 'regolith');
  return material;
};

/**
 * The ground: nested square rings of real LOLA heights, each four times wider and coarser than the
 * one inside it (1.25 m spacing by the lander, 80 m, the data's own resolution, out to 5 km, then
 * coarser out to about 330 km). Each ring has a hole where the finer ring sits.
 */
const createTerrainMeshes = (terrain, seed, sunUniforms) => {
  const grain = createRegolithTexture(seed);
  const material = createRegolithMaterial(sunUniforms, { vertexColors: true, map: grain, bumpMap: grain, bumpScale: 0.015 }, true);
  const group = new THREE.Group();
  const sunlightAttributes = [];
  terrain.rings.forEach((ring, ringIndex) => {
    const { half, cell, size, heights, slopes, tones, sunlight } = ring;
    const count = size * size;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const index = row * size + column;
        const x = -half + column * cell; const z = -half + row * cell;
        positions[index * 3] = x; positions[index * 3 + 1] = heights[index]; positions[index * 3 + 2] = z;
        const slopeX = slopes[index * 2]; const slopeZ = slopes[index * 2 + 1];
        const length = Math.hypot(slopeX, 1, slopeZ);
        normals[index * 3] = -slopeX / length; normals[index * 3 + 1] = 1 / length; normals[index * 3 + 2] = -slopeZ / length;
        const tone = tones[index];
        colors[index * 3] = tone * 1.03; colors[index * 3 + 1] = tone; colors[index * 3 + 2] = tone * 0.96;
        uvs[index * 2] = x / GRAIN_TILE_M; uvs[index * 2 + 1] = z / GRAIN_TILE_M;
      }
    }
    const holeStart = (RING_CELLS * 3) / 8; const holeEnd = (RING_CELLS * 5) / 8;
    const indices = [];
    for (let row = 0; row < RING_CELLS; row += 1) {
      for (let column = 0; column < RING_CELLS; column += 1) {
        if (ringIndex > 0 && row >= holeStart && row < holeEnd && column >= holeStart && column < holeEnd) continue;
        const a = row * size + column; const b = a + 1; const c = a + size; const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const sunlightAttribute = new THREE.BufferAttribute(sunlight, 1);     // shares the terrain model's array
    sunlightAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('sunlight', sunlightAttribute);
    sunlightAttributes.push(sunlightAttribute);
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = half <= SHADOW_HALF * 8;      // only ground near the lander can catch rock and lander shadows
    if (ringIndex >= FAR_RING_START) mesh.layers.set(FAR_LAYER);
    group.add(mesh);
  });
  return { group, sunlightAttributes };
};

/** Survey grid draped over the terrain: one line every 10 m. Shown by the Terrain grid toggle. */
const createSurveyGrid = (heightAt) => {
  const points = [];
  const extent = 100; const spacing = 10; const step = 2;
  for (let line = -extent; line <= extent; line += spacing) {
    for (let along = -extent; along < extent; along += step) {
      points.push(
        new THREE.Vector3(line, heightAt(line, along) + 0.06, along),
        new THREE.Vector3(line, heightAt(line, along + step) + 0.06, along + step),
        new THREE.Vector3(along, heightAt(along, line) + 0.06, line),
        new THREE.Vector3(along + step, heightAt(along + step, line) + 0.06, line)
      );
    }
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.75, toneMapped: false })
  );
};

/** A lumpy boulder: a subdivided sphere pushed in and out by noise, with smooth shading. */
const createRockGeometry = (seed) => {
  const base = new THREE.IcosahedronGeometry(1, 2);
  base.deleteAttribute('uv'); base.deleteAttribute('normal');
  const geometry = mergeVertices(base);
  base.dispose();
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    const lump = 0.62 + 0.75 * fbm(vertex.x * 1.4 + vertex.z * 0.8 + 9, vertex.y * 1.4 - vertex.z * 0.6 + 9, seed, 3);
    vertex.multiplyScalar(lump);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * Scattered boulders (illustrative). Any rock that would poke above the mask skyline is left out.
 * Each rock carries its own `sunlight` value, copied from the terrain shadow at its position, so a
 * rock standing on shadowed ground is in shadow too.
 */
const createRocks = (terrain, seed, sunUniforms) => {
  const random = seededRandom(seed + 101);
  const group = new THREE.Group();
  const rocks = [];
  const shapes = Array.from({ length: 6 }, (_, index) => createRockGeometry(seed + 200 + index * 17));
  const materials = [0x6f6b66, 0x7b7771, 0x64615d].map((color) => createRegolithMaterial(sunUniforms, { color }, true));
  for (let index = 0; index < 110; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 7 + random() * random() * 110;
    const size = 0.1 + random() * random() * random() * 1.6;
    const geometry = shapes[index % shapes.length].clone();
    const sunlight = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(1), 1);
    geometry.setAttribute('sunlight', sunlight);
    const rock = new THREE.Mesh(geometry, materials[index % materials.length]);
    const x = Math.cos(angle) * distance; const z = Math.sin(angle) * distance;
    const squash = 0.5 + random() * 0.4;
    rock.scale.set(size * (0.8 + random() * 0.5), size * squash, size * (0.8 + random() * 0.5));
    // Sit each rock partly in the dust, as real boulders do, so it does not look placed on top.
    const y = terrain.heightAt(x, z) + size * squash * 0.3;
    rock.position.set(x, y, z);
    rock.rotation.y = random() * Math.PI * 2;
    rock.castShadow = true;
    rock.receiveShadow = true;
    if (terrain.headroomAt(x, y + size * squash * 1.4, z) > 0.3) {
      group.add(rock);
      rocks.push({ x, z, sunlight });
    } else geometry.dispose();
  }
  shapes.forEach((shape) => shape.dispose());
  const updateSunlight = () => rocks.forEach((rock) => {
    rock.sunlight.array.fill(terrain.sunlightAt(rock.x, rock.z));
    rock.sunlight.needsUpdate = true;
  });
  return { group, updateSunlight };
};

/**
 * The skyline shell, drawn from the horizon mask: a bowl whose rim follows the real LOLA skyline
 * (one point per degree of azimuth). It is drawn in the sky pass, behind the terrain mesh, and is
 * what actually hides the Sun and Earth, so the picture always agrees with the visibility numbers.
 * The mesh in front of it reaches the same skyline to within a few tenths of a degree; where the
 * mesh falls short (far peaks that its coarse outer rings smooth down) the shell shows in the gap.
 */
const createSkyline = (mask) => {
  const centre = new THREE.Vector3(0, EYE_Y, 0);
  const positions = [];
  const nadir = new THREE.Vector3(0, EYE_Y - SKYLINE_RADIUS, 0);
  const rim = Array.from({ length: 360 }, (_, azimuth) => skyPoint(azimuth, mask[azimuth], SKYLINE_RADIUS));
  // Each degree: a strip from the rim down to 12° below it, then on to the point underfoot.
  const skirt = Array.from({ length: 360 }, (_, azimuth) => skyPoint(azimuth, mask[azimuth] - 12, SKYLINE_RADIUS));
  const push = (a, b, c) => {
    // Wind every triangle so its front faces the observer in the middle.
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const inward = normal.dot(new THREE.Vector3().subVectors(centre, a)) > 0;
    (inward ? [a, b, c] : [a, c, b]).forEach((point) => positions.push(point.x, point.y, point.z));
  };
  for (let azimuth = 0; azimuth < 360; azimuth += 1) {
    const next = (azimuth + 1) % 360;
    push(rim[azimuth], rim[next], skirt[azimuth]);
    push(rim[next], skirt[next], skirt[azimuth]);
    push(skirt[azimuth], skirt[next], nadir);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Tone varies along the skyline and darkens below it, so it reads as distant land and not a flat cut-out.
  const colors = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const azimuth = Math.atan2(positions[index], -positions[index + 2]) / DEG;
    const depth = Math.min(1, Math.max(0, (EYE_Y - positions[index + 1]) / (SKYLINE_RADIUS * 0.35)));
    const tone = (0.2 + 0.16 * fbm(azimuth * 0.11 + 40, depth * 6, 7, 4)) * (1 - 0.45 * depth);
    colors[index] = tone * 1.02; colors[index + 1] = tone; colors[index + 2] = tone * 0.97;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Unlit: its brightness is set from the Sun's height on every time update.
  const land = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const edge = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([...rim, rim[0]].map((point) => point.clone().sub(centre).multiplyScalar(0.999).add(centre))),
    new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.55 })
  );
  const group = new THREE.Group();
  group.add(land, edge);
  return { group, land };
};

// ---------- Lander ----------
const createLander = () => {
  const lander = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.55, metalness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dee5, roughness: 0.5, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1d3a8a, roughness: 0.35, metalness: 0.5, emissive: 0x0b1a44, emissiveIntensity: 0.4 });
  const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; lander.add(mesh); return mesh; };

  const body = add(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.95, 8), foil));
  body.position.y = 1.25;
  const deck = add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 8), metal));
  deck.position.y = 1.77;
  const engine = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 0.5, 12, 1, true), dark));
  engine.position.y = 0.55;

  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 4 + (index * Math.PI) / 2;
    const footX = Math.cos(angle) * 2.0; const footZ = Math.sin(angle) * 2.0;
    const hipX = Math.cos(angle) * 1.05; const hipZ = Math.sin(angle) * 1.05;
    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), metal));
    const hip = new THREE.Vector3(hipX, 1.3, hipZ); const foot = new THREE.Vector3(footX, 0.06, footZ);
    leg.position.copy(hip).add(foot).multiplyScalar(0.5);
    leg.scale.y = hip.distanceTo(foot);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(hip).normalize());
    const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.07, 12), metal));
    pad.position.set(footX, 0.04, footZ);
    const tank = add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), metal));
    tank.position.set(Math.cos(angle) * 0.95, 1.05, Math.sin(angle) * 0.95);
  }

  // Vertical solar panels: at the pole the Sun is always near the horizon, so panels stand upright.
  [0, Math.PI].forEach((angle) => {
    const wing = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 1.7), panel));
    wing.position.set(Math.cos(angle) * 1.32, 1.6, Math.sin(angle) * 1.32);
    wing.rotation.y = angle;
  });

  // High-gain dish. It is re-aimed at Earth every time the scene updates.
  const dishMount = new THREE.Group();
  dishMount.position.set(0.55, 2.05, -0.45);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3.2),
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide })
  );
  dish.rotation.x = -Math.PI / 2;      // open side faces -Z, which lookAt() points at the target
  dish.position.z = 0.42;
  dish.castShadow = true;
  dishMount.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), metal);
  feed.rotation.x = Math.PI / 2;
  feed.position.z = -0.1;
  dishMount.add(feed);
  lander.add(dishMount);
  const boom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 6), metal));
  boom.position.set(0.55, 1.93, -0.45);

  // Sensor mast. The POV camera rides on top of it.
  const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, MAST_HEIGHT - 1.8, 8), metal));
  mast.position.y = 1.8 + (MAST_HEIGHT - 1.8) / 2;
  const sensorHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0xff5a00, emissiveIntensity: 1.6, roughness: 0.4 })
  );
  sensorHead.position.y = MAST_HEIGHT;
  lander.add(sensorHead);

  // Work lights keep the lander readable during the lunar night.
  const workLight = new THREE.Group();
  [[0, 3.6, 0, 1], [2.8, 1.1, 2.4, 0.45], [-2.6, 1.0, -2.6, 0.35]].forEach(([x, y, z, share]) => {
    const lamp = new THREE.PointLight(0xffe2b8, 0, 30, 1.6);
    lamp.position.set(x, y, z);
    lamp.userData.share = share;
    workLight.add(lamp);
  });
  lander.add(workLight);

  return { lander, dishMount, sensorHead, workLight };
};

// ---------- Sky ----------
const createGlowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 6, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 250, 225, 1)');
  gradient.addColorStop(0.08, 'rgba(255, 236, 170, 0.85)');
  gradient.addColorStop(0.25, 'rgba(251, 191, 36, 0.28)');
  gradient.addColorStop(0.6, 'rgba(245, 158, 11, 0.06)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/** Painted stand-in for Earth: oceans, land, ice caps. Replaced by /textures/earth_day.jpg when that file exists. */
const createEarthTextures = () => {
  const width = 512; const height = 256;
  const surface = document.createElement('canvas'); surface.width = width; surface.height = height;
  const clouds = document.createElement('canvas'); clouds.width = width; clouds.height = height;
  const surfaceContext = surface.getContext('2d'); const cloudContext = clouds.getContext('2d');
  const surfaceData = surfaceContext.createImageData(width, height);
  const cloudData = cloudContext.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const latitude = (0.5 - y / height) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const longitude = (x / width) * Math.PI * 2;
      // Sample noise on the sphere so the texture has no seam.
      const px = Math.cos(latitude) * Math.cos(longitude); const py = Math.sin(latitude); const pz = Math.cos(latitude) * Math.sin(longitude);
      const land = fbm(px * 1.6 + 5.2, pz * 1.6 + py * 1.9 + 1.3, 71, 5) + 0.18 * fbm(py * 3 + 9, px * 3 + pz * 2, 12, 3);
      const offset = (y * width + x) * 4;
      const polar = Math.abs(latitude) / (Math.PI / 2);
      let r; let g; let b;
      if (polar > 0.86 - 0.08 * fbm(px * 4, pz * 4, 5, 2)) { r = 236; g = 242; b = 247; }
      else if (land > 0.6) {
        const dry = fbm(px * 5 + 3, pz * 5 + py * 4, 33, 3);
        const tropics = 1 - Math.min(1, polar * 1.6);
        r = 60 + dry * 110 + (1 - tropics) * 20; g = 96 + tropics * 40 + dry * 30; b = 48 + dry * 40;
      } else {
        const depth = Math.max(0, (0.6 - land) * 2.2);
        r = 14 + 22 * (1 - depth); g = 62 + 60 * (1 - depth); b = 128 + 62 * (1 - depth);
      }
      surfaceData.data[offset] = r; surfaceData.data[offset + 1] = g; surfaceData.data[offset + 2] = b; surfaceData.data[offset + 3] = 255;
      const cloud = fbm(px * 2.6 + 11, pz * 2.6 + py * 5.5, 97, 5);
      const cover = Math.max(0, Math.min(1, (cloud - 0.5) * 4.5));
      cloudData.data[offset] = 255; cloudData.data[offset + 1] = 255; cloudData.data[offset + 2] = 255; cloudData.data[offset + 3] = cover * 255;
    }
  }
  surfaceContext.putImageData(surfaceData, 0, 0);
  cloudContext.putImageData(cloudData, 0, 0);
  const toTexture = (canvas) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  };
  return { surface: toTexture(surface), clouds: toTexture(clouds) };
};

/** Earth with a real day/night terminator: it is lit from the Sun's direction even when the Sun is below our horizon. */
const createEarth = () => {
  const textures = createEarthTextures();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSurface: { value: textures.surface },
      uClouds: { value: textures.clouds },
      uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
      uCloudShift: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uSurface;
      uniform sampler2D uClouds;
      uniform vec3 uSunDirection;
      uniform float uCloudShift;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 normal = normalize(vWorldNormal);
        float light = dot(normal, normalize(uSunDirection));
        float day = smoothstep(-0.08, 0.22, light);
        vec3 surface = texture2D(uSurface, vUv).rgb;
        float cloud = texture2D(uClouds, vec2(vUv.x + uCloudShift, vUv.y)).a;
        vec3 lit = mix(surface, vec3(1.0), cloud * 0.85) * (0.25 + 0.95 * max(light, 0.0));
        vec3 night = vec3(0.012, 0.02, 0.045) + surface * 0.02;
        vec3 color = mix(night, lit, day);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.6);
        color += vec3(0.25, 0.55, 1.0) * rim * (0.15 + 0.85 * day);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 64, 48), material);
  const tilt = new THREE.Group();   // 23.4° axial tilt; the mesh spins inside it
  tilt.rotation.z = 23.4 * DEG;
  tilt.add(mesh);

  // Optional real imagery: drop a public-domain NASA Blue Marble image at
  // frontend/public/textures/earth_day.jpg and it replaces the painted surface.
  new THREE.TextureLoader().load('/textures/earth_day.jpg', (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    material.uniforms.uSurface.value = texture;
  }, undefined, () => {});

  return { group: tilt, mesh, material };
};

const createStars = () => {
  const random = seededRandom(4242);
  const positions = []; const colors = [];
  for (let index = 0; index < 3200; index += 1) {
    const u = random() * 2 - 1; const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    positions.push(ring * Math.cos(theta) * 5000, u * 5000 + EYE_Y, ring * Math.sin(theta) * 5000);
    const brightness = 0.35 + random() * random() * 0.65;
    const warmth = random();
    colors.push(brightness * (0.85 + warmth * 0.15), brightness * 0.92, brightness * (1 - warmth * 0.18));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, depthWrite: false
  }));
};

const createTextSprite = (text, color = '#cbd5e1', scale = 1) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 44;
  context.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  canvas.width = Math.ceil(context.measureText(text).width) + 24;
  canvas.height = fontSize + 20;
  context.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.fillStyle = color;
  context.textBaseline = 'middle';
  context.fillText(text, 12, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.9 }));
  const height = SKY_RADIUS * 0.022 * scale;
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  return sprite;
};

/** Sky grid: a meridian every 30° of azimuth, and elevation rings packed near the horizon where everything happens. */
const createSkyGrid = () => {
  const group = new THREE.Group();
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x7c8ba1, transparent: true, opacity: 0.3 });
  const fineMaterial = new THREE.LineBasicMaterial({ color: 0x7c8ba1, transparent: true, opacity: 0.16 });
  const radius = SKY_RADIUS * 1.02;   // just behind the Sun and Earth discs
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    const points = [];
    for (let elevation = 0; elevation <= 30; elevation += 1) points.push(skyPoint(azimuth, elevation, radius));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[azimuth];
    const label = createTextSprite(cardinal ? `${cardinal} ${azimuth}°` : `${azimuth}°`, cardinal ? '#f8fafc' : '#94a3b8', cardinal ? 1.15 : 0.85);
    label.position.copy(skyPoint(azimuth, 0.9, radius));
    group.add(label);
  }
  [1, 2, 3, 5, 10, 15, 20, 30].forEach((elevation) => {
    const points = Array.from({ length: 181 }, (_, index) => skyPoint(index * 2, elevation, radius));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), elevation < 5 ? fineMaterial : lineMaterial));
    if (elevation >= 2) {
      [15, 105, 195, 285].forEach((azimuth) => {
        const label = createTextSprite(`${elevation}°`, '#94a3b8', 0.75);
        label.position.copy(skyPoint(azimuth, elevation + 0.35, radius));
        group.add(label);
      });
    }
  });
  return group;
};

const createFatLine = (color, linewidth, opacity) => {
  const material = new LineMaterial({ color, linewidth, transparent: true, opacity, depthWrite: false });
  const line = new Line2(new LineGeometry(), material);
  line.frustumCulled = false;
  return line;
};

const setFatLinePoints = (line, points) => {
  if (points.length < 2) { line.visible = false; return; }
  const flat = new Float32Array(points.length * 3);
  points.forEach((point, index) => { flat[index * 3] = point.x; flat[index * 3 + 1] = point.y; flat[index * 3 + 2] = point.z; });
  line.geometry.dispose();
  line.geometry = new LineGeometry();
  line.geometry.setPositions(flat);
  line.computeLineDistances();
};

const disposeObject = (object) => {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => { material.map?.dispose(); material.bumpMap?.dispose(); material.dispose(); });
  });
};

const formatSigned = (value, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}°`;

const LunarScene3D = ({
  time,
  windowStart,
  selectedSite,
  showSolarFlux,
  showDTELink,
  showGrid,
  showHorizonMask,
  useTerrain,
  cameraYaw,
  cameraPitch,
  viewMode,
  viewResetCount,
  invertLook,
  onLookDrag,
  onCameraInfo,
  cameraInfo,
  showInterface,
  freeMoveRef,
  lookSensitivity = DEFAULT_LOOK_SENSITIVITY
}) => {
  const [fps, setFps] = useState(0);
  const [hover, setHover] = useState(null);
  const [isPointerLocked, setIsPointerLocked] = useState(false);   // Free View has taken the mouse
  const [isCompassVisible, setIsCompassVisible] = useState(true);
  const [siteVersion, setSiteVersion] = useState(0);     // bumped when a site's terrain has finished loading
  const containerRef = useRef(null);
  const stageRef = useRef(null);       // everything created once
  const siteRef = useRef(null);        // everything rebuilt per site
  const propsRef = useRef({ cameraYaw, cameraPitch, viewMode, invertLook, onLookDrag, onCameraInfo, freeMoveRef, lookSensitivity });

  // Latest props for the render loop and pointer handlers, which are set up only once.
  useEffect(() => {
    propsRef.current = { cameraYaw, cameraPitch, viewMode, invertLook, onLookDrag, onCameraInfo, freeMoveRef, lookSensitivity };
  });

  // ---- One-time setup: renderer, sky, lander, input ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    // Two scenes. The sky (stars, Sun, Earth, grid, paths, skyline shell) is drawn first and follows
    // the camera, like a backdrop at infinity. The ground, rocks and lander are drawn over it.
    const scene = new THREE.Scene();
    const skyScene = new THREE.Scene();
    const skyRoot = new THREE.Group();
    skyScene.add(skyRoot);

    const camera = new THREE.PerspectiveCamera(62, 1, 1, 14000);
    camera.position.set(0, EYE_Y, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000004);
    renderer.autoClear = false;                 // the render loop clears once, then draws three passes
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;      // nothing moves between time steps, so redraw shadows only when asked
    container.appendChild(renderer.domElement);

    // Sunlight: direction and strength are set from the ephemeris on every update.
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    Object.assign(sunLight.shadow.camera, {
      left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: SHADOW_NEAR, far: SHADOW_FAR
    });
    sunLight.shadow.normalBias = 0.25;   // the depth bias is set per Sun angle in the time update below
    scene.add(sunLight, sunLight.target);
    // Earthshine: faint blue fill from Earth's direction, so night is dark but not blind.
    const earthLight = new THREE.DirectionalLight(0x8fb4ff, 0);
    scene.add(earthLight);
    // Fill light. At night this is faint starlight. By day it stands in for sunlight bouncing off
    // the surrounding lit ground, which is why real lunar shadows are dark but not pure black.
    const fillLight = new THREE.HemisphereLight(0x9fb2d8, 0x30343c, 0.16);
    scene.add(fillLight);
    // Shared by every dust-shaded material: where the Sun is (in camera space) and how much to scale
    // its light for the terrain, which takes its shadows from the height data instead of the lander's.
    const sunUniforms = { uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uSunBoost: { value: 1 } };
    const sunDirectionWorld = new THREE.Vector3(0, 1, 0);

    const stars = createStars();
    skyRoot.add(stars);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false })
    );
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    sunGlow.scale.setScalar(SUN_RADIUS * 14);
    sun.add(sunGlow);
    skyRoot.add(sun);

    const earth = createEarth();
    skyRoot.add(earth.group);

    const skyGrid = createSkyGrid();
    skyRoot.add(skyGrid);

    const sunPath = createFatLine(SUN_COLOR, 1.6, 0.42);
    const sunTrail = createFatLine(SUN_COLOR, 3.2, 0.95);
    const earthPath = createFatLine(EARTH_COLOR, 1.6, 0.42);
    const earthTrail = createFatLine(EARTH_COLOR, 3.2, 0.95);
    const linkBeam = createFatLine(0x7dd3fc, 1.4, 0.55);
    skyRoot.add(sunPath, sunTrail, earthPath, earthTrail);
    scene.add(linkBeam);
    const fatLines = [sunPath, sunTrail, earthPath, earthTrail, linkBeam];

    const { lander, dishMount, sensorHead, workLight } = createLander();
    scene.add(lander);
    // Lights must be on both terrain layers, or the far terrain would be drawn unlit.
    [sunLight, earthLight, fillLight, ...workLight.children].forEach((light) => light.layers.enable(FAR_LAYER));


    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      fatLines.forEach((line) => line.material.resolution.set(width, height));
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    // ---- Pointer input ----
    const canvas = renderer.domElement;
    const drag = { active: false, x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHoverCheck = 0;

    // Free View only: lock the pointer to the canvas, as a first-person game does. The browser
    // releases it on Esc; we release it when Free View is left.
    let pointerLocked = false;
    const lockPointer = () => {
      if (propsRef.current.viewMode !== 'free' || pointerLocked || !canvas.requestPointerLock) return;
      try {
        // Browsers refuse a new lock for about a second after Esc; the next click or key press retries.
        canvas.requestPointerLock()?.catch?.(() => {});
      } catch { /* not available here: dragging still looks around */ }
    };
    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === canvas;
      setIsPointerLocked(pointerLocked);
      drag.active = false;
      canvas.style.cursor = pointerLocked ? 'none' : 'grab';
      if (pointerLocked) setHover(null);
    };
    const onMoveKeyDown = (event) => {
      if (!event.repeat && MOVE_KEYS.has(event.key.toLowerCase())) lockPointer();
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('keydown', onMoveKeyDown);

    const onPointerDown = (event) => {
      if (pointerLocked) return;
      drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
      if (propsRef.current.viewMode === 'free') lockPointer();      // a pointer about to be locked cannot also be captured
      else canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onPointerMove = (event) => {
      if (pointerLocked) {
        // Mouse look: moving the mouse right turns right, moving it up looks up.
        const { invertLook: inverted, lookSensitivity: sensitivity } = propsRef.current;
        const degreesPerPixel = (camera.fov / container.clientHeight) * (sensitivity / DEFAULT_LOOK_SENSITIVITY) * (inverted ? -1 : 1);
        const limit = (value) => Math.max(-150, Math.min(150, value));      // browsers can report one huge jump as the lock starts
        propsRef.current.onLookDrag?.(-limit(event.movementX) * degreesPerPixel, -limit(event.movementY) * degreesPerPixel);
        return;
      }
      if (drag.active) {
        const degreesPerPixel = camera.fov / container.clientHeight;
        const direction = propsRef.current.invertLook ? -1 : 1;
        propsRef.current.onLookDrag?.(
          (event.clientX - drag.x) * degreesPerPixel * direction,
          (event.clientY - drag.y) * degreesPerPixel * direction
        );
        drag.x = event.clientX; drag.y = event.clientY;
        return;
      }
      const now = performance.now();
      if (now - lastHoverCheck < 80) return;
      lastHoverCheck = now;
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const belongsTo = (object, root) => { for (let node = object; node; node = node.parent) if (node === root) return true; return false; };
      const hit = raycaster.intersectObjects([sun, earth.mesh, lander], true).find((candidate) => candidate.object.visible && candidate.distance > 1);
      let key = null;
      if (hit) key = belongsTo(hit.object, sun) ? 'sun' : hit.object === earth.mesh ? 'earth' : 'lander';
      setHover((current) => {
        if (!key) return current ? null : current;
        return { key, x: event.clientX, y: event.clientY };
      });
    };
    const endDrag = (event) => {
      drag.active = false;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = pointerLocked ? 'none' : 'grab';
    };
    const onWheel = (event) => {
      event.preventDefault();
      camera.fov = Math.max(8, Math.min(80, camera.fov * (event.deltaY > 0 ? 1.08 : 1 / 1.08)));
      camera.updateProjectionMatrix();
    };
    const onPointerLeave = () => setHover(null);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    stageRef.current = {
      scene, skyRoot, camera, renderer, sunLight, earthLight, fillLight, stars, sun, sunGlow, earth,
      sunUniforms, sunDirectionWorld, shadowsDirty: true,
      skyGrid, sunPath, sunTrail, earthPath, earthTrail, linkBeam,
      lander, dishMount, sensorHead, workLight, mode: null, keyLightAzimuth: 0
    };

    let frameCount = 0;
    let fpsWindowStart = performance.now();
    let lastInfo = { centerAz: -1, fov: -1, at: 0 };
    const forward = new THREE.Vector3();
    const flight = new THREE.Vector3();          // Free View velocity, metres per second
    const flightTarget = new THREE.Vector3();
    let lastFrameAt = performance.now();
    let frame;
    const render = () => {
      frame = requestAnimationFrame(render);
      if (document.hidden) return;
      const now = performance.now();
      const deltaSeconds = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      frameCount += 1;
      if (now - fpsWindowStart >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - fpsWindowStart)));
        frameCount = 0; fpsWindowStart = now;
      }
      const stage = stageRef.current;
      const { viewMode: mode, cameraYaw: yaw, cameraPitch: pitch } = propsRef.current;
      const site = siteRef.current;
      const groundAt = (x, z) => (site ? site.terrain.heightAt(x, z) : 0);
      const moves = propsRef.current.freeMoveRef?.current;
      if (stage.mode !== mode) {
        stage.mode = mode;
        if (mode === 'free') {
          // Start a few steps from the lander on its sunlit side (or the Earth side at night), facing it.
          const side = (stage.keyLightAzimuth + 38) * DEG;
          const x = Math.sin(side) * FREE_VIEW_START_DISTANCE; const z = -Math.cos(side) * FREE_VIEW_START_DISTANCE;
          camera.position.set(x, groundAt(x, z) + FREE_VIEW_EYE_HEIGHT, z);
          propsRef.current.onLookDrag?.(Math.atan2(x, z) / DEG - yaw, -3 - pitch);
        } else {
          camera.position.set(0, EYE_Y, 0);
          if (document.pointerLockElement === canvas) document.exitPointerLock();
        }
        if (moves) { moves.stepForward = 0; moves.stepRight = 0; }
        flight.set(0, 0, 0);
        canvas.style.cursor = 'grab';
        sensorHead.visible = mode === 'free';   // don't put the sensor inside the POV camera
      }
      if (mode === 'free') {
        // Flying: W / Up moves along the look direction (up and down included), A / D strafes.
        // App.jsx reports which keys are held; the speed is applied here, once per frame, so it is smooth.
        const position = camera.position;
        const heading = yaw * DEG; const tilt = pitch * DEG;
        const aheadX = -Math.sin(heading) * Math.cos(tilt); const aheadY = Math.sin(tilt); const aheadZ = -Math.cos(heading) * Math.cos(tilt);
        const sideX = Math.cos(heading); const sideZ = -Math.sin(heading);
        const held = moves || { forward: 0, right: 0, boost: false, stepForward: 0, stepRight: 0 };
        const speed = Math.min(FREE_VIEW_MAX_SPEED, FREE_VIEW_BASE_SPEED + FREE_VIEW_SPEED_PER_METRE * Math.hypot(position.x, position.z))
          * (held.boost ? FREE_VIEW_BOOST : 1);
        flightTarget.set(
          (aheadX * held.forward + sideX * held.right) * speed,
          aheadY * held.forward * speed,
          (aheadZ * held.forward + sideZ * held.right) * speed
        );
        flight.lerp(flightTarget, Math.min(1, deltaSeconds * 10));       // ease in and out instead of snapping
        if (flight.lengthSq() < 0.0001) flight.set(0, 0, 0);
        position.addScaledVector(flight, deltaSeconds);
        if (held.stepForward || held.stepRight) {
          // Clicks on the on-screen pad: one short hop each.
          position.x += (aheadX * held.stepForward + sideX * held.stepRight) * FREE_VIEW_PAD_STEP;
          position.y += aheadY * held.stepForward * FREE_VIEW_PAD_STEP;
          position.z += (aheadZ * held.stepForward + sideZ * held.stepRight) * FREE_VIEW_PAD_STEP;
          held.stepForward = 0; held.stepRight = 0;
        }
        // Limits: stay out of the lander, within range of it, above the ground and below the ceiling.
        const fromLanderY = position.y - 1.5;
        const fromLander = Math.hypot(position.x, fromLanderY, position.z);
        if (fromLander < FREE_VIEW_KEEP_OUT) {
          if (fromLander < 0.001) position.x = FREE_VIEW_KEEP_OUT;
          else {
            const push = FREE_VIEW_KEEP_OUT / fromLander;
            position.set(position.x * push, 1.5 + fromLanderY * push, position.z * push);
          }
        }
        const distance = Math.hypot(position.x, position.z);
        if (distance > FREE_VIEW_RANGE) { position.x *= FREE_VIEW_RANGE / distance; position.z *= FREE_VIEW_RANGE / distance; }
        const ground = groundAt(position.x, position.z);
        if (position.y < ground + FREE_VIEW_EYE_HEIGHT) { position.y = ground + FREE_VIEW_EYE_HEIGHT; flight.y = Math.max(0, flight.y); }
        if (position.y > ground + FREE_VIEW_CEILING) { position.y = ground + FREE_VIEW_CEILING; flight.y = Math.min(0, flight.y); }
      }
      camera.rotation.set(pitch * DEG, yaw * DEG, 0, 'YXZ');

      // Terrain shadows: a few milliseconds of work per frame after the Sun moves, then idle.
      if (site) site.applySunlight(site.terrain.stepSunlight(4));

      sunGlow.material.opacity = 0.92 + Math.sin(now * 0.0012) * 0.05;
      earth.material.uniforms.uCloudShift.value = (now * 0.0000035) % 1;

      camera.getWorldDirection(forward);
      const centerAz = (Math.atan2(forward.x, -forward.z) / DEG + 360) % 360;
      if (now - lastInfo.at > 120 && (Math.abs(centerAz - lastInfo.centerAz) > 0.05 || camera.fov !== lastInfo.fov)) {
        lastInfo = { centerAz, fov: camera.fov, at: now };
        propsRef.current.onCameraInfo?.({ centerAz, fov: camera.fov });
      }

      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      sunUniforms.uSunDirView.value.copy(sunDirectionWorld).transformDirection(camera.matrixWorldInverse);
      const drawPass = (target, layer, near, far) => {
        camera.near = near; camera.far = far; camera.updateProjectionMatrix();
        camera.layers.set(layer);
        renderer.render(target, camera);
      };
      renderer.clear();
      // 1. Sky, centred on the camera so that it behaves as if infinitely far away.
      skyRoot.position.set(camera.position.x, camera.position.y - EYE_Y, camera.position.z);
      drawPass(skyScene, 0, 50, 14000);
      // 2. Terrain from about 5 km to 330 km.
      renderer.clearDepth();
      drawPass(scene, FAR_LAYER, 800, 900000);
      // 3. Everything near: ground out to about 5 km, rocks, lander.
      renderer.clearDepth();
      if (stage.shadowsDirty) { renderer.shadowMap.needsUpdate = true; stage.shadowsDirty = false; }
      drawPass(scene, 0, 1, FREE_VIEW_RANGE + 10000);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('keydown', onMoveKeyDown);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      disposeObject(scene);
      disposeObject(skyScene);
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
      siteRef.current = null;
    };
  }, []);

  // Reset view also restores the default zoom.
  useEffect(() => {
    if (!stageRef.current || !viewResetCount) return;
    stageRef.current.camera.fov = 62;
    stageRef.current.camera.updateProjectionMatrix();
  }, [viewResetCount]);

  // ---- Per-site: terrain, rocks, survey grid, full-lunar-day sky paths ----
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let built = null;
    const mask = getHorizonMask(selectedSite.latitude, selectedSite.longitude, useTerrain);

    const toPoints = (path, radius) => path.map((sample) => skyPoint(sample.azimuth, sample.elevation, radius));
    const sunSamples = getSkyPath(windowStart, calculateSunPosition, selectedSite.latitude, selectedSite.longitude);
    const earthSamples = getSkyPath(windowStart, calculateEarthPosition, selectedSite.latitude, selectedSite.longitude);
    setFatLinePoints(stage.sunPath, toPoints(sunSamples, SKY_RADIUS * 0.99));
    setFatLinePoints(stage.earthPath, toPoints(earthSamples, SKY_RADIUS * 0.99));

    // The height tiles are fetched per site (about 460 KB), so the ground appears a moment after the sky.
    loadTerrainTiles(selectedSite.id).then(({ meta, raw }) => {
      if (cancelled) return;
      const seed = SITE_SEEDS[selectedSite.id] || 11;
      const terrain = createLunarTerrain(meta, raw, mask, { seed, eyeHeight: EYE_Y });
      const ground = createTerrainMeshes(terrain, seed, stage.sunUniforms);
      const rocks = createRocks(terrain, seed, stage.sunUniforms);
      // Push freshly computed terrain shadows to the graphics card (rings as they finish, then the rocks).
      const applySunlight = (finishedRings) => {
        finishedRings.forEach((ringIndex) => { ground.sunlightAttributes[ringIndex].needsUpdate = true; });
        if (finishedRings.includes(1)) rocks.updateSunlight();
      };
      const surveyGrid = createSurveyGrid(terrain.heightAt);
      const skyline = createSkyline(mask);
      const group = new THREE.Group();
      group.add(ground.group, rocks.group, surveyGrid);
      stage.scene.add(group);
      stage.skyRoot.add(skyline.group);
      built = { group, skyline };
      siteRef.current = {
        terrain, applySunlight, skyline, surveyGrid, sunSamples, earthSamples, fresh: true
      };
      setSiteVersion((version) => version + 1);
    }).catch((error) => console.error(error));

    return () => {
      cancelled = true;
      if (built) {
        stage.scene.remove(built.group);
        stage.skyRoot.remove(built.skyline.group);
        disposeObject(built.group);
        disposeObject(built.skyline.group);
      }
      siteRef.current = null;
    };
  }, [selectedSite, windowStart, useTerrain]);

  // ---- Per-time: place the Sun and Earth, light the scene, update trails ----
  useEffect(() => {
    const stage = stageRef.current;
    const site = siteRef.current;
    if (!stage || !site) return;

    const sunPosition = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
    const earthPosition = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
    const sunClearance = clearanceOf(sunPosition, selectedSite.latitude, selectedSite.longitude, useTerrain);
    const earthClearance = clearanceOf(earthPosition, selectedSite.latitude, selectedSite.longitude, useTerrain);
    const sunDirection = skyDirection(sunPosition.azimuth, sunPosition.elevation);
    const earthDirection = skyDirection(earthPosition.azimuth, earthPosition.elevation);

    // Disc centres sit at the true elevation; the skyline hides whatever is below it.
    stage.sun.position.copy(skyPoint(sunPosition.azimuth, sunPosition.elevation));
    stage.earth.group.position.copy(skyPoint(earthPosition.azimuth, earthPosition.elevation));
    // The skyline shell is the view from the mast, so it is only drawn in the POV camera. In Free View
    // the terrain itself hides the Sun and Earth from wherever you stand, and a body that has fully
    // set at the lander is hidden, so the picture never contradicts the readouts.
    site.skyline.group.visible = viewMode === 'surface';
    stage.sun.visible = viewMode === 'surface' || sunClearance > -0.265 * SUN_EXAGGERATION;
    stage.earth.group.visible = viewMode === 'surface' || earthClearance > -0.95 * EARTH_EXAGGERATION;
    stage.earth.material.uniforms.uSunDirection.value.copy(sunDirection);
    stage.earth.mesh.rotation.y = ((time.getTime() % EARTH_SIDEREAL_DAY_MS) / EARTH_SIDEREAL_DAY_MS) * Math.PI * 2;

    stage.keyLightAzimuth = sunClearance > 0 ? sunPosition.azimuth : earthPosition.azimuth;

    // Sunlight at the lander fades in as the real 0.53°-wide disc clears the skyline (from the mask).
    const sunFraction = Math.max(0, Math.min(1, (sunClearance + 0.265) / 0.53));
    stage.sunLight.position.copy(sunDirection.clone().multiplyScalar(420));
    // The Sun light itself follows the lander's view of the Sun, so the lander and rocks go dark when
    // the mask says the Sun is hidden. The terrain undoes that factor (uSunBoost) and uses its own
    // shadows from the height data, so distant slopes can still be in sunlight while the lander is not.
    stage.sunLight.intensity = SUN_STRENGTH * Math.max(sunFraction, 0.002);
    stage.sunUniforms.uSunBoost.value = SUN_STRENGTH / stage.sunLight.intensity;
    stage.sunDirectionWorld.copy(sunDirection);
    site.terrain.setSun(sunPosition.azimuth, sunPosition.elevation);
    if (site.fresh) {
      // First frame of a new site: finish the terrain shadows now, so the ground does not flash unlit.
      site.applySunlight(site.terrain.stepSunlight());
      site.fresh = false;
    }
    stage.shadowsDirty = true;
    // How much sunlit land there is around, whether or not the lander itself is lit.
    const daylight = Math.max(0, Math.min(1, (sunPosition.elevation + 1.5) / 2.5));
    site.skyline.land.material.color.setScalar(0.03 + 1.25 * daylight);
    // Shadow bias scaled to the Sun's angle. Light that grazes the ground crosses a lot of depth inside
    // one shadow-map pixel, so a fixed bias either speckles the ground (too small) or eats the shadows (too big).
    const grazing = Math.tan(Math.max(1, sunPosition.elevation - 2) * DEG);
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP_SIZE;
    stage.sunLight.shadow.bias = -(1.3 * texel / grazing) / (SHADOW_FAR - SHADOW_NEAR);
    const earthUp = earthClearance > 0;
    stage.earthLight.position.copy(earthDirection.clone().multiplyScalar(300));
    stage.earthLight.intensity = earthUp ? 0.5 : 0;
    // Fill: faint starlight at night, plus light bounced off whatever sunlit ground is around.
    const bounce = 0.6 * sunFraction + 0.25 * daylight * (1 - sunFraction);
    stage.fillLight.intensity = 0.16 + bounce;
    stage.fillLight.color.setHex(bounce > 0.05 ? 0xb9b4ab : 0x9fb2d8);
    stage.fillLight.groundColor.setHex(bounce > 0.05 ? 0x8a857c : 0x30343c);
    stage.workLight.children.forEach((lamp) => { lamp.intensity = 30 * lamp.userData.share * (1 - sunFraction); });
    stage.stars.material.opacity = 1 - 0.72 * sunFraction;

    // Dish tracks Earth. The link beam shows only while Earth is above the horizon.
    const earthTarget = skyPoint(earthPosition.azimuth, earthPosition.elevation);
    stage.dishMount.lookAt(earthTarget);
    const dishWorld = stage.dishMount.getWorldPosition(new THREE.Vector3());
    stage.linkBeam.visible = showDTELink && earthUp;
    if (stage.linkBeam.visible) setFatLinePoints(stage.linkBeam, [dishWorld, earthTarget]);

    // Bright trail = where the body has just been; thin line = its whole lunar-day path.
    const hourIndex = Math.max(0, Math.min(site.sunSamples.length - 1, Math.round((time.getTime() - windowStart.getTime()) / 3600000)));
    const trail = (samples, hoursBack, current) => [
      ...samples.slice(Math.max(0, hourIndex - hoursBack), hourIndex).map((sample) => skyPoint(sample.azimuth, sample.elevation, SKY_RADIUS * 0.988)),
      skyPoint(current.azimuth, current.elevation, SKY_RADIUS * 0.988)
    ];
    stage.sunPath.visible = showSolarFlux;
    stage.sunTrail.visible = showSolarFlux;
    stage.earthPath.visible = showDTELink;
    stage.earthTrail.visible = showDTELink;
    if (showSolarFlux) setFatLinePoints(stage.sunTrail, trail(site.sunSamples, 72, sunPosition));
    if (showDTELink) setFatLinePoints(stage.earthTrail, trail(site.earthSamples, 120, earthPosition));

    stage.skyGrid.visible = showGrid;
    site.surveyGrid.visible = showHorizonMask;
  }, [time, selectedSite, windowStart, viewMode, useTerrain, showSolarFlux, showDTELink, showGrid, showHorizonMask, siteVersion]);

  const sunPosition = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
  const earthPosition = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
  const sunClearance = clearanceOf(sunPosition, selectedSite.latitude, selectedSite.longitude, useTerrain);
  const earthClearance = clearanceOf(earthPosition, selectedSite.latitude, selectedSite.longitude, useTerrain);
  const skylineWord = useTerrain ? 'skyline' : 'horizon';
  const hoverText = hover && {
    sun: ['Sun', `Elevation ${formatSigned(sunPosition.elevation)} · azimuth ${sunPosition.azimuth.toFixed(1)}°`, sunClearance > 0 ? `${sunClearance.toFixed(1)}° above the ${skylineWord}: solar power available` : `${Math.abs(sunClearance).toFixed(1)}° below the ${skylineWord}: no solar power`],
    earth: ['Earth', `Elevation ${formatSigned(earthPosition.elevation)} · azimuth ${earthPosition.azimuth.toFixed(1)}°`, earthClearance > 0 ? `${earthClearance.toFixed(1)}° above the ${skylineWord}: direct radio contact possible` : `${Math.abs(earthClearance).toFixed(1)}° below the ${skylineWord}: no direct radio contact`],
    lander: ['Lander', `Sensor mast ${MAST_HEIGHT} m above the ground`, 'The dish turns to follow Earth']
  }[hover.key];

  // Bird's-eye compass: where the Sun and Earth are around the horizon, and where the camera is looking.
  const compassPoint = (azimuth, radius) => ({
    x: 50 + Math.sin(azimuth * DEG) * radius,
    y: 50 - Math.cos(azimuth * DEG) * radius
  });
  const viewAz = cameraInfo?.centerAz ?? 0;
  const halfFov = ((cameraInfo?.fov ?? 62) * 1.3) / 2;
  const wedgeStart = compassPoint(viewAz - halfFov, 40);
  const wedgeEnd = compassPoint(viewAz + halfFov, 40);
  const sunDot = compassPoint(sunPosition.azimuth, 40);
  const earthDot = compassPoint(earthPosition.azimuth, 40);

  return (
    <div ref={containerRef} className="lunar-scene-3d" aria-label="Interactive 3D lunar horizon">
      {showInterface && (
        <>
          <div className="camera-fps-readout" aria-live="off">FPS {fps || '--'}</div>
          <div className="camera-fps-readout" style={{ top: '6.1rem' }}>
            Ground &amp; skyline: NASA LOLA elevation data, 80 m/pixel · detail finer than 80 m (small craters, rocks, dust) is illustrative
          </div>
          {isCompassVisible ? (
            <div className="sky-compass" aria-label="Bird's-eye compass of Sun and Earth directions">
              <div className="sky-compass-title">
                <span>Bird&apos;s-eye compass</span>
                <button type="button" aria-label="Hide compass" onClick={() => setIsCompassVisible(false)}>×</button>
              </div>
              <svg viewBox="0 0 100 100" role="img" aria-label={`Sun at azimuth ${sunPosition.azimuth.toFixed(0)} degrees, Earth at azimuth ${earthPosition.azimuth.toFixed(0)} degrees`}>
                <circle className="sky-compass-ring" cx="50" cy="50" r="40" />
                <path className="sky-compass-view" d={`M 50 50 L ${wedgeStart.x} ${wedgeStart.y} A 40 40 0 0 1 ${wedgeEnd.x} ${wedgeEnd.y} Z`} />
                {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, azimuth]) => {
                  const point = compassPoint(azimuth, 47);
                  return <text key={label} className="sky-compass-cardinal" x={point.x} y={point.y + 2.4}>{label}</text>;
                })}
                <circle className="sky-compass-lander" cx="50" cy="50" r="2.2" />
                {showSolarFlux && (
                  <g className={sunClearance > 0 ? '' : 'is-down'}>
                    <line className="sky-compass-ray sun" x1="50" y1="50" x2={sunDot.x} y2={sunDot.y} />
                    <circle className="sky-compass-body sun" cx={sunDot.x} cy={sunDot.y} r="3.4" />
                  </g>
                )}
                {showDTELink && (
                  <g className={earthClearance > 0 ? '' : 'is-down'}>
                    <line className="sky-compass-ray earth" x1="50" y1="50" x2={earthDot.x} y2={earthDot.y} />
                    <circle className="sky-compass-body earth" cx={earthDot.x} cy={earthDot.y} r="3.4" />
                  </g>
                )}
              </svg>
              <dl className="sky-compass-legend">
                <div><dt className="sun">Sun</dt><dd>{formatSigned(sunPosition.elevation, 1)} · az {sunPosition.azimuth.toFixed(0)}°</dd></div>
                <div><dt className="earth">Earth</dt><dd>{formatSigned(earthPosition.elevation, 1)} · az {earthPosition.azimuth.toFixed(0)}°</dd></div>
                <div><dt className="view">View</dt><dd>looking az {viewAz.toFixed(0)}°</dd></div>
              </dl>
            </div>
          ) : (
            <button type="button" className="sky-compass-launch" onClick={() => setIsCompassVisible(true)}>Compass</button>
          )}
        </>
      )}
      {isPointerLocked && viewMode === 'free' && <div className="scene-crosshair" aria-hidden="true">+</div>}
      {hoverText && (
        <div className="scene-hover-tip" role="tooltip" style={{ left: `${hover.x + 14}px`, top: `${hover.y + 14}px` }}>
          <strong>{hoverText[0]}</strong>
          <span>{hoverText[1]}</span>
          <span>{hoverText[2]}</span>
        </div>
      )}
    </div>
  );
};

export default LunarScene3D;
