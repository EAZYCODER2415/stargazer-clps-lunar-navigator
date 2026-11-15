import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { PROPELLANT_LOAD_SECONDS } from './gameEngine';
import { grainCanvas, layeredNoise } from './planetTextures';
import { PART_SIZE, SLOT_OF, SLOT_RANGE, STACK_BASE, STACK_ORDER, STACK_TOP, addStars, box, cylinder, makeEarth, makeFairingHalf, makeGhost, makeGlowTexture, makeLabel, makeMoon, makePart, makePlume, material, partSlots } from './sceneKit';

const { clamp, damp, lerp } = THREE.MathUtils;
const smooth = (from, to, value) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };

// Assembly layout: the vehicle stands at VEHICLE_X and the parts wait on a two-shelf rack.
const VEHICLE_X = 2.6;
const SHELF_LOW = 0.9;
const SHELF_HIGH = 4.3;
const partHomes = Object.fromEntries([
  ['first-tank', -6.3, SHELF_LOW],
  ['lander', -4.75, SHELF_LOW],
  ['fairing', -3.1, SHELF_LOW],
  ['upper-tank', -1.6, SHELF_LOW],
  ['upper-engine', -6.2, SHELF_HIGH],
  ['payload-adapter', -4.8, SHELF_HIGH],
  ['first-engine', -3.3, SHELF_HIGH],
  ['interstage', -1.8, SHELF_HIGH],
].map(([id, x, shelf]) => [id, [x, shelf + PART_SIZE[id][1] / 2]]));

// Where each stage's subject sits. `width` and `height` are the world-space box the
// camera must keep inside the stage's clear "scene window" (see updateView).
const SCENE_FRAMES = {
  assembly: { position: [0.4, 5, 13], target: [-1.5, 4.3, 0], width: 12.8, height: 9.4 },
  pad: { position: [0.6, 3.9, 10.5], target: [0.6, 4.45, -6.6], width: 10.9, height: 6.1 },
  ascent: { position: [0, 3.4, 17], target: [0, 2.9, 0], width: 6, height: 11.8 },
  transit: { position: [0, 9.5, 21], target: [0, 0.5, 0], width: 21.5, height: 7.4 },
  landing: { position: [0, 10, 18], target: [0, 4.3, 0], width: 14, height: 12.8 },
};
const SCENE_KIND = { assembly: 'assembly', 'assembly-complete': 'assembly', launchpad: 'pad', countdown: 'pad', ascent: 'ascent', transit: 'transit', landing: 'landing' };

function shadowLight(scene, color, intensity, position, target, reach) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...position);
  light.target.position.set(...target);
  scene.add(light.target);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 70 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.03;
  scene.add(light);
  return light;
}

function addLights(scene, kind) {
  const point = (color, intensity, distance, position) => {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(...position);
    scene.add(light);
  };
  const sun = (color, intensity, position) => {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
  };
  if (kind === 'assembly') {
    scene.add(new THREE.HemisphereLight(0xc9d9f1, 0x1c2331, 1.25));
    shadowLight(scene, 0xffffff, 2.3, [5, 15, 10], [-1, 3, 0], 13);
    point(0x4cc9f0, 22, 24, [-5, 5, 1]);
    point(0xffc68a, 16, 16, [VEHICLE_X + 3, 3.5, 4]);
  } else if (kind === 'pad') {
    scene.add(new THREE.HemisphereLight(0xc9d9f1, 0x1c2331, 1.5));
    sun(0xffffff, 1.8, [3, 9, 10]);
    point(0x4cc9f0, 18, 22, [-5, 5, 1]);
  } else if (kind === 'ascent') {
    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x263448, 1.05));
    sun(0xfff6e8, 2.8, [8, 7, 10]);
  } else if (kind === 'transit') {
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x05070c, 0.32));
    sun(0xfff6e8, 3.2, [9, 7, 10]);
  } else {
    // The Moon's south pole: a low Sun, long shadows, and only a little light bounced back.
    scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x2a2622, 0.34));
    shadowLight(scene, 0xfff1dc, 3.2, [-17, 6, 9], [0, 0, 0], 20);
  }
}

function addHangar(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(46, 34), material(0x161d2a, { roughness: 0.82, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-1, -0.04, -1);
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(34, 34, 0x37546a, 0x253344);
  grid.position.set(-1, 0.01, -1);
  scene.add(grid);

  // Back wall, roof beams and overhead lamps.
  box(scene, [-1, 6.5, -7.6], [46, 14, 0.3], 0x0f1522);
  for (const y of [2.2, 4.4, 6.6, 8.8]) box(scene, [-1, y, -7.42], [46, 0.05, 0.05], 0x1c2536);
  box(scene, [-1, 9.6, -6], [24, 0.22, 0.22], 0x59677d);
  box(scene, [-1, 11.4, -6], [24, 0.16, 0.16], 0x344156);
  for (const x of [-10.5, -6.5, -1, 4.5, 8.5]) {
    box(scene, [x, 5.2, -6], [0.18, 10.4, 0.18], 0x526078);
    box(scene, [x, 6.4, -5.9], [0.12, 0.12, 0.12], 0x4cc9f0, { emissive: 0x1b6476 });
  }
  for (const x of [-6, -1.5, 3]) {
    box(scene, [x, 10.7, -1], [2.4, 0.12, 0.5], 0xdbeafe, { emissive: 0x9fc4ff, emissiveIntensity: 1.2 });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.4, 10.6, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(x, 5.4, -1);
    scene.add(beam);
  }

  // Parts rack: two shelves beside the vehicle, in the same plane the parts are dragged in.
  box(scene, [-3.95, 3.45, -0.85], [7.1, 6.7, 0.1], 0x0c111b);
  for (const shelf of [SHELF_LOW, SHELF_HIGH]) {
    box(scene, [-3.95, shelf - 0.08, -0.1], [7.1, 0.16, 1.5], 0x3a475c);
    box(scene, [-3.95, shelf - 0.19, 0.63], [7.1, 0.03, 0.04], 0x4cc9f0, { emissive: 0x15546b });
  }
  for (const x of [-7.5, -0.4]) box(scene, [x, 3.4, -0.1], [0.12, 6.8, 1.5], 0x526078);
  box(scene, [-3.95, 6.86, -0.1], [7.22, 0.12, 1.5], 0x526078);
  const rackTag = makeLabel('PARTS RACK', { height: 0.3, color: '#7fd8f2' });
  rackTag.position.set(-3.95, 7.25, 0.4);
  scene.add(rackTag);

  // Vehicle stand, floor marking and a service mast beside the stack.
  box(scene, [VEHICLE_X, 0.1, 0], [2.1, 0.2, 2.1], 0x59677d);
  cylinder(scene, [VEHICLE_X, 0.375, 0], 0.5, 0.64, 0.35, 0x465267, 28);
  const marking = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.92, 56), material(0xfbbf24, { roughness: 0.8, metalness: 0 }));
  marking.rotation.x = -Math.PI / 2;
  marking.position.set(VEHICLE_X, 0.02, 0);
  marking.receiveShadow = true;
  scene.add(marking);
  const mastX = VEHICLE_X + 1.55;
  for (const offset of [-0.18, 0.18]) box(scene, [mastX + offset, 4.5, -1.1], [0.09, 9, 0.09], 0x38465a);
  for (let y = 0.6; y < 9; y += 0.6) box(scene, [mastX, y, -1.1], [0.36, 0.04, 0.05], 0x4b5970);
  for (const y of [2.4, 4.4, 6.3]) {
    box(scene, [mastX - 0.62, y, -1.1], [1.1, 0.07, 0.12], 0x526078);
    box(scene, [mastX - 0.62, y + 0.045, -1.1], [1.1, 0.02, 0.5], 0x2a3446);
  }
  box(scene, [mastX, 9.06, -1.1], [0.14, 0.14, 0.14], 0xfb7185, { emissive: 0xb91c1c, emissiveIntensity: 1.4 });
}

function addAssemblyRig(scene) {
  const parts = {};
  const ghosts = {};
  for (const id of STACK_ORDER) {
    // The fairing is see-through in the hangar so the lander stays visible inside it.
    const group = makePart(id, scene, { cutaway: true });
    group.position.set(partHomes[id][0], partHomes[id][1], 0);
    const materials = [];
    group.traverse((object) => { if (object.isMesh) materials.push({ item: object.material, base: object.material.emissive.clone() }); });
    parts[id] = { group, materials };
    const ghost = makeGhost(id, scene);
    ghost.group.position.set(VEHICLE_X, partSlots[id], 0);
    ghosts[id] = ghost;
  }
  return { parts, ghosts };
}

// Control room for the launch pad and the countdown. The wall monitor is a labelled
// schematic of the pad, not a live or photorealistic feed.
function addPadRoom(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 22), material(0x121825, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(22, 22, 0x314258, 0x202b3b);
  grid.position.y = 0.015;
  scene.add(grid);
  box(scene, [0, 5.2, -7], [20, 10.4, 0.35], 0x141b29);
  box(scene, [-9.8, 4.5, -1], [0.35, 9, 12], 0x101622);
  box(scene, [9.8, 4.5, -1], [0.35, 9, 12], 0x101622);
  box(scene, [0, 9.8, -1], [20, 0.35, 12], 0x0b1019);
  for (const x of [-6.2, -3.1, 3.1, 6.2]) {
    box(scene, [x, 0.62, 0], [2.55, 0.95, 1.6], 0x222d40);
    box(scene, [x, 1.13, -0.34], [2.3, 0.08, 1.15], 0x101b2a, { emissive: 0x07131e });
    for (let i = 0; i < 5; i += 1) box(scene, [x - 0.82 + i * 0.4, 1.19, -0.28], [0.12, 0.025, 0.18], i % 3 ? 0x4cc9f0 : 0xfbbf24, { emissive: 0x122d3e });
  }
  for (const x of [-8.6, 8.6]) {
    const side = box(scene, [x, 4.2, -5.2], [1.9, 2.6, 0.12], 0x15283a, { emissive: 0x0a3045 });
    side.rotation.y = x < 0 ? 0.3 : -0.3;
  }
  for (let x = -8; x <= 8; x += 4) box(scene, [x, 9.25, -1], [0.08, 0.08, 10], 0x4cc9f0, { emissive: 0x15546b });

  // Wall monitor
  const Z = -6.42;
  const GREY = '#8fa0b8';
  box(scene, [0.6, 4.45, -6.74], [10.7, 5.95, 0.22], 0x4b5b73);
  box(scene, [0.6, 4.45, -6.59], [10.2, 5.5, 0.08], 0x0a1521, { emissive: 0x071321 });
  box(scene, [0.6, 1.95, -6.48], [10.1, 0.06, 0.06], 0x4cc9f0, { emissive: 0x15546b });
  const place = (object, x, y, z = Z) => { object.position.set(x, y, z); scene.add(object); return object; };
  place(makeLabel('LAUNCH PAD · SCHEMATIC VIEW', { height: 0.26, color: '#7fd8f2' }), -2.75, 6.8);

  // Service tower
  box(scene, [-1.5, 4.12, Z], [0.24, 4.35, 0.14], 0x64748b);
  for (const y of [2.5, 3.6, 5.6]) box(scene, [-1.27, y, Z], [0.46, 0.06, 0.1], 0x64748b);
  const beacon = place(new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshBasicMaterial({ color: 0x7f1d1d })), -1.5, 6.4);

  // The vehicle the player assembled, standing on its launch mount.
  box(scene, [1.1, 2.07, -6.3], [1.5, 0.2, 0.4], 0x475569);
  const rocket = new THREE.Group();
  rocket.position.set(1.1, 2.17, -6.25);
  rocket.scale.setScalar(0.5);
  scene.add(rocket);
  for (const id of STACK_ORDER) makePart(id, rocket).position.y = partSlots[id] - STACK_BASE;
  const heightOf = (id) => 2.17 + (partSlots[id] - STACK_BASE) * 0.5;

  // Access platform: grows from the tower towards the vehicle.
  const platformGeometry = new THREE.BoxGeometry(1, 0.1, 0.16);
  platformGeometry.translate(0.5, 0, 0);
  const platformY = heightOf('payload-adapter') + 0.05;
  const platform = place(new THREE.Mesh(platformGeometry, material(0xfbbf24, { emissive: 0x4a3108 })), -1.38, platformY, Z + 0.02);
  platform.scale.x = 1.1;

  // Fuel and oxidiser lines run from the tower to the tank they fill. A line that is
  // not connected hangs loose from the tower.
  const makeLine = (fromY, toX, toY, color, emissive) => {
    const from = new THREE.Vector3(-1.38, fromY, Z);
    const joined = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, new THREE.Vector3((toX - 1.38) / 2, Math.min(fromY, toY) - 0.5, Z + 0.05), new THREE.Vector3(toX, toY, Z + 0.08)), 30, 0.05, 8),
      material(color, { emissive }),
    );
    const loose = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, new THREE.Vector3(-0.92, fromY - 0.02, Z), new THREE.Vector3(-0.95, fromY - 0.62, Z)), 20, 0.05, 8),
      material(0x566278),
    );
    scene.add(joined, loose);
    return { joined, loose };
  };
  const fuelY = heightOf('first-tank');
  const oxidiserY = heightOf('upper-tank') - 0.15;
  const fuelLine = makeLine(fuelY - 0.1, 1.1 - 0.2, fuelY, 0xfbbf24, 0x4a3108);
  const oxidiserLine = makeLine(oxidiserY - 0.1, 1.1 - 0.17, oxidiserY, 0x66b2ff, 0x102b49);

  // Tags, each joined to the tower by a short leader line.
  const callout = (y) => {
    box(scene, [-1.81, y, Z], [0.38, 0.02, 0.02], 0x4cc9f0, { emissive: 0x15546b });
    return place(makeLabel('', { height: 0.3 }), -3.1, y);
  };
  const fuelTag = callout(fuelY - 0.1);
  const oxidiserTag = callout(oxidiserY - 0.1);
  const platformTag = callout(platformY);

  // Status column on the right of the monitor.
  const propellantTag = place(makeLabel('', { height: 0.3 }), 3.95, 5.05);
  box(scene, [3.95, 4.6, Z], [2.2, 0.2, 0.03], 0x1c2536);
  const gaugeGeometry = new THREE.BoxGeometry(1, 0.12, 0.04);
  gaugeGeometry.translate(0.5, 0, 0);
  const gauge = place(new THREE.Mesh(gaugeGeometry, new THREE.MeshBasicMaterial({ color: 0xfbbf24 })), 2.89, 4.6, Z + 0.02);
  const powerTag = place(makeLabel('', { height: 0.3 }), 3.95, 3.9);
  const countTag = place(makeLabel('TERMINAL COUNT', { height: 0.3, color: '#fb7185' }), 3.95, 3.2);

  return {
    update(current, dt, seconds) {
      const pad = current.pad || {};
      platform.scale.x = damp(platform.scale.x, pad.platformRetracted ? 0.32 : pad.platformExtended ? 2.17 : 1.1, 4, dt);
      platformTag.userData.setLabel(pad.platformRetracted ? 'PLATFORM CLEAR ✓' : pad.platformExtended ? 'ACCESS PLATFORM ✓' : 'ACCESS PLATFORM', pad.platformRetracted ? '#6ee7b7' : pad.platformExtended ? '#fbbf24' : GREY);
      fuelLine.joined.visible = Boolean(pad.fuelConnected);
      fuelLine.loose.visible = !pad.fuelConnected;
      fuelTag.userData.setLabel(pad.fuelConnected ? 'FUEL LINE ✓' : 'FUEL LINE', pad.fuelConnected ? '#fbbf24' : GREY);
      oxidiserLine.joined.visible = Boolean(pad.oxidizerConnected);
      oxidiserLine.loose.visible = !pad.oxidizerConnected;
      oxidiserTag.userData.setLabel(pad.oxidizerConnected ? 'OXIDISER LINE ✓' : 'OXIDISER LINE', pad.oxidizerConnected ? '#66b2ff' : GREY);
      const started = pad.propellantStartedAt;
      const loading = started !== null && started !== undefined;
      const filled = pad.propellantLoaded ? 1 : loading ? clamp((current.elapsed - started) / PROPELLANT_LOAD_SECONDS, 0, 1) : 0;
      gauge.scale.x = Math.max(0.001, filled * 2.12);
      gauge.material.color.set(pad.propellantLoaded ? 0x6ee7b7 : 0xfbbf24);
      propellantTag.userData.setLabel(pad.propellantLoaded ? 'PROPELLANT · LOADED ✓' : loading ? `PROPELLANT · ${Math.floor(filled * 100)}%` : 'PROPELLANT · EMPTY', pad.propellantLoaded ? '#6ee7b7' : loading ? '#fbbf24' : GREY);
      powerTag.userData.setLabel(pad.onboardPower ? 'POWER · ONBOARD ✓' : 'POWER · GROUND', pad.onboardPower ? '#6ee7b7' : GREY);
      const counting = current.phase === 'countdown';
      const blink = Math.sin(seconds * 6) > 0;
      countTag.visible = counting && blink;
      beacon.material.color.set(counting && blink ? 0xff4d5e : 0x7f1d1d);
    },
  };
}

// Ascent: the assembled vehicle climbs from the pad through cloud into a dark sky, then
// drops its first stage and its fairing. Illustrative only, not a flight simulation.
function addAscent(scene) {
  const stars = addStars(scene);
  stars.material.opacity = 0;
  const skyStops = [[0, new THREE.Color(0x4a8fd0)], [25, new THREE.Color(0x21559a)], [48, new THREE.Color(0x081a3a)], [75, new THREE.Color(0x02050d)]];
  const sky = new THREE.Color(0x4a8fd0);
  scene.background = sky;
  scene.fog = new THREE.Fog(0x4a8fd0, 60, 230);

  // Launch site, which falls away below the vehicle.
  const site = new THREE.Group();
  scene.add(site);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(175, 56), material(0x2c4a33, { roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -40;
  site.add(ground);
  box(site, [0, 0.08, 0], [7, 0.3, 7], 0x6b7280);
  box(site, [0, 0.1, 0], [1.6, 0.32, 1.6], 0x1f2937);
  box(site, [-2.3, 3.1, -0.6], [0.5, 6, 0.5], 0x64748b);
  for (const y of [1.6, 3.2, 4.8]) box(site, [-1.7, y, -0.6], [0.9, 0.08, 0.3], 0x64748b);

  const clouds = new THREE.Group();
  scene.add(clouds);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 17; i += 1) {
    const front = i % 4 === 3;
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffffff, transparent: true, opacity: front ? 0.26 : 0.5, depthWrite: false, fog: false }));
    cloud.userData.opacity = cloud.material.opacity;
    cloud.position.set((random() - 0.5) * 30, 14 + i * 5.4 + random() * 3, front ? 4 : -3 - random() * 8);
    cloud.scale.set(9 + random() * 7, 3 + random() * 2.2, 1);
    clouds.add(cloud);
  }

  // Earth's curved horizon, which comes into view as the sky darkens.
  const earth = makeEarth(scene, 42, 512, true);
  // Turned so the camera looks across the equator, not down onto a pole.
  earth.group.rotation.set(Math.PI / 2, 0, 0);
  earth.group.position.set(0, -80, -25);
  earth.group.visible = false;

  // The vehicle, built from the same parts as the assembly stage.
  const centre = (STACK_BASE + STACK_TOP) / 2;
  const vehicle = new THREE.Group();
  vehicle.position.set(0, 2.9, 0);
  vehicle.scale.setScalar(0.78);
  scene.add(vehicle);
  const stage1 = new THREE.Group();
  const stage2 = new THREE.Group();
  vehicle.add(stage1, stage2);
  for (const id of ['first-engine', 'first-tank', 'interstage']) makePart(id, stage1).position.y = partSlots[id] - centre;
  for (const id of ['upper-engine', 'upper-tank', 'payload-adapter', 'lander']) makePart(id, stage2).position.y = partSlots[id] - centre;
  const fairingY = partSlots.fairing - centre;
  const halves = [-1, 1].map((side) => { const half = makeFairingHalf(vehicle, side); half.position.y = fairingY; return half; });
  const plume1 = makePlume(stage1, 0.42, 3.6, 0xff8a2a, 0xfff1c2);
  plume1.position.y = STACK_BASE - centre + 0.03;
  const plume2 = makePlume(stage2, 0.27, 2, 0x9ad8ff, 0xffffff);
  plume2.position.y = SLOT_RANGE['upper-engine'][0] - centre + 0.05;
  let fairingAt = null;
  let fogCleared = false;

  return {
    update(current, dt, seconds) {
      const ascent = current.ascent || {};
      const t = Math.max(0, current.elapsed - (ascent.launchedAt || 0));
      const altitude = 0.25 * t + 0.05 * t * t;

      for (let i = 0; i < skyStops.length - 1; i += 1) {
        if (t >= skyStops[i][0]) sky.copy(skyStops[i][1]).lerp(skyStops[i + 1][1], clamp((t - skyStops[i][0]) / (skyStops[i + 1][0] - skyStops[i][0]), 0, 1));
      }
      if (scene.fog) scene.fog.color.copy(sky);
      if (!fogCleared && t > 44) { scene.fog = null; fogCleared = true; }
      stars.material.opacity = smooth(42, 85, t) * 0.95;
      site.position.y = -altitude;
      site.visible = altitude < 230;
      clouds.position.y = -altitude * 0.9;
      const haze = 1 - smooth(34, 50, t);
      clouds.children.forEach((cloud) => { cloud.material.opacity = cloud.userData.opacity * haze; });
      clouds.visible = haze > 0.01;
      earth.group.visible = t > 36;
      earth.group.position.y = lerp(-80, -44.6, smooth(36, 88, t));
      earth.globe.rotation.y += dt * 0.01;
      earth.cloudLayer.rotation.y += dt * 0.014;

      vehicle.position.y = 2.9 + Math.min(0.9, t * 0.012);
      vehicle.rotation.z = -smooth(8, 110, t) * 0.3;
      const flicker = 0.92 + 0.1 * Math.sin(seconds * 41) + 0.05 * Math.sin(seconds * 67);
      const separatedAt = ascent.separatedAt;
      plume1.visible = !separatedAt && t < 20;
      plume1.scale.set(1, flicker, 1);
      if (separatedAt) {
        const age = Math.max(0, current.elapsed - separatedAt);
        stage1.position.set(-0.03 * age, -(0.6 * age + 0.05 * age * age), 0);
        stage1.rotation.z = 0.035 * age;
        stage1.visible = age < 30;
        plume2.visible = age > 1.5 && !ascent.payloadSeparated;
      } else {
        stage1.position.set(0, 0, 0);
        stage1.rotation.z = 0;
        stage1.visible = true;
        plume2.visible = false;
      }
      plume2.scale.set(1, flicker, 1);
      if (ascent.fairingSeparated) {
        if (fairingAt === null) fairingAt = current.elapsed;
        const age = Math.max(0, current.elapsed - fairingAt);
        halves.forEach((half, index) => {
          const side = index === 0 ? -1 : 1;
          half.position.set(side * (0.25 * age + 0.06 * age * age), fairingY - 0.05 * age * age, 0);
          half.rotation.z = -side * Math.min(1.2, 0.22 * age);
          half.visible = age < 14;
        });
      }
    },
  };
}

// Transit: a schematic Earth-to-Moon view. Sizes, distance and path are not to scale.
function addTransit(scene) {
  addStars(scene);
  const earth = makeEarth(scene, 2.1);
  earth.group.position.set(-8, 0.2, 0);
  const moon = makeMoon(scene, 1.45);
  moon.position.set(8, 0, 0);
  const orbit = new THREE.CatmullRomCurve3([new THREE.Vector3(-5.6, 0, 0), new THREE.Vector3(-2.6, 2.1, 0), new THREE.Vector3(1.3, 2.1, 0), new THREE.Vector3(5.7, 0, 0)]);
  const SEGMENTS = 96;
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(orbit, SEGMENTS, 0.022, 6, false), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.3 })));
  const travelled = new THREE.Mesh(new THREE.TubeGeometry(orbit, SEGMENTS, 0.03, 6, false), new THREE.MeshBasicMaterial({ color: 0x6fdcff }));
  scene.add(travelled);
  const craft = new THREE.Group();
  scene.add(craft);
  const lander = makePart('lander', craft, { deployed: true });
  lander.scale.setScalar(0.8);
  const tag = (text, x, y) => { const label = makeLabel(text, { sprite: true, height: 0.42 }); label.position.set(x, y, 0); scene.add(label); return label; };
  tag('EARTH', -8, -2.75);
  tag('MOON', 8, -2.1);
  const landerTag = tag('LANDER', 0, 0);
  const tangent = new THREE.Vector3();

  return {
    update(current, dt) {
      const progress = clamp((current.transitElapsed || 0) / 180, 0, 1);
      craft.position.copy(orbit.getPoint(progress));
      orbit.getTangent(progress, tangent);
      craft.rotation.z = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
      lander.rotation.y += dt * 0.35;
      landerTag.position.set(craft.position.x, craft.position.y + 1.05, 0);
      travelled.geometry.setDrawRange(0, Math.floor(progress * SEGMENTS) * 36);
      earth.globe.rotation.y += dt * 0.07;
      earth.cloudLayer.rotation.y += dt * 0.1;
      moon.rotation.y += dt * 0.04;
    },
  };
}

// Landing: three marked training zones on rolling ground, lit by a low Sun.
function addLandingScene(scene) {
  addStars(scene);
  const ZONE_Z = -0.5;
  const ZONE_X = { A: -5, B: 0, C: 5 };
  const START_X = -2.5;
  const HOVER = 9.2;
  const SCALE = 1.3;
  const craters = [[-10, -8, 3, 0.9], [9, -10, 2.4, 0.7], [12.5, 5, 1.9, 0.5], [-13, 6, 2.6, 0.7], [-2, -16, 3.4, 0.9], [3.5, 10, 1.5, 0.35]];
  const heightAt = (x, z) => {
    const range = Math.hypot(x, z - ZONE_Z);
    let height = smooth(14, 46, range) * (layeredNoise(x * 0.045 + 20, 0, z * 0.045 + 20, 4) - 0.42) * 8;
    height += smooth(5, 16, range) * (layeredNoise(x * 0.16 + 7, 3, z * 0.16 + 7, 3) - 0.5) * 1.1;
    for (const [cx, cz, radius, depth] of craters) {
      const distance = Math.hypot(x - cx, z - cz) / radius;
      if (distance < 1) height -= depth * (1 - distance * distance);
      else if (distance < 1.35) height += depth * 0.35 * (1 - (distance - 1) / 0.35);
    }
    // Zone A is rough ground; zone C sits on a slope.
    height += smooth(2.6, 1.2, Math.hypot(x - ZONE_X.A, z - ZONE_Z)) * (layeredNoise(x * 1.3, 5, z * 1.3, 2) - 0.5) * 0.3;
    height += smooth(3.4, 1.7, Math.hypot(x - ZONE_X.C, z - ZONE_Z)) * (x - ZONE_X.C) * 0.2;
    return height;
  };

  const terrainGeometry = new THREE.PlaneGeometry(180, 180, 200, 200);
  terrainGeometry.rotateX(-Math.PI / 2);
  terrainGeometry.translate(0, 0, -22);
  const vertices = terrainGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i += 1) vertices.setY(i, heightAt(vertices.getX(i), vertices.getZ(i)));
  terrainGeometry.computeVertexNormals();
  const grain = new THREE.CanvasTexture(grainCanvas());
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = THREE.RepeatWrapping;
  grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(70, 70);
  grain.anisotropy = 8;
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ map: grain, color: 0x9a958d, roughness: 1, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  let seed = 41;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rock = (x, z, radius) => {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), material(random() > 0.4 ? 0x6b655d : 0x847c72, { roughness: 1, metalness: 0 }));
    mesh.position.set(x, heightAt(x, z) + radius * 0.3, z);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    mesh.scale.y = 0.7;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  for (let i = 0; i < 60; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 4 + random() * 30;
    const x = Math.cos(angle) * distance;
    const z = ZONE_Z + Math.sin(angle) * distance;
    const radius = 0.12 + random() * 0.4;
    if (Math.hypot(x - ZONE_X.B, z - ZONE_Z) > 2.4 && Math.hypot(x - ZONE_X.C, z - ZONE_Z) > 2.4) rock(x, z, radius);
  }
  for (let i = 0; i < 11; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * 1.45;
    rock(ZONE_X.A + Math.cos(angle) * distance, ZONE_Z + Math.sin(angle) * distance, 0.1 + random() * 0.2);
  }

  const zones = Object.entries(ZONE_X).map(([id, x]) => {
    const group = new THREE.Group();
    // Zone A is bumpy, so its marker floats a little higher to stay visible.
    group.position.set(x, heightAt(x, ZONE_Z) + (id === 'A' ? 0.2 : 0.06), ZONE_Z);
    if (id === 'C') group.rotation.z = Math.atan(0.2);
    scene.add(group);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.62, 56), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.45, 56), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.1, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    group.add(ring, pad);
    const label = makeLabel(`ZONE ${id}`, { sprite: true, height: 0.5 });
    label.position.set(x, heightAt(x, ZONE_Z) + 0.9, ZONE_Z - 2.1);
    scene.add(label);
    return { id, ring, pad, label };
  });

  const earth = makeEarth(scene, 1.5, 256);
  earth.group.position.set(9, 7.5, -60);

  const lander = makePart('lander', scene, { deployed: true });
  lander.scale.setScalar(SCALE);
  lander.position.set(START_X, HOVER, ZONE_Z);
  const plume = makePlume(lander, 0.16, 1.5, 0x9ad8ff, 0xffffff);
  plume.position.y = -0.3;
  const dust = [];
  for (let i = 0; i < 8; i += 1) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xc9b89c, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(puff);
    dust.push(puff);
  }

  return {
    update(current, dt, seconds) {
      const landing = current.landing || {};
      const start = landing.descentStartedAt;
      const descending = start !== null && start !== undefined;
      const progress = descending ? clamp((current.elapsed - start) / 90, 0, 1) : 0;
      // Alignment is what moves the lander over the chosen zone.
      const aimX = landing.alignmentComplete && ZONE_X[landing.zone] !== undefined ? ZONE_X[landing.zone] : START_X;
      const previousX = lander.position.x;
      lander.position.x = damp(previousX, aimX, 1.1, dt);
      const ground = heightAt(lander.position.x, ZONE_Z) + 0.5 * SCALE;
      const aimY = landing.touchdown ? ground : HOVER - (HOVER - ground) * (1 - (1 - progress) ** 1.6);
      lander.position.y = damp(lander.position.y, aimY, 3.5, dt);
      const above = lander.position.y - ground;
      const drift = dt > 0 ? (lander.position.x - previousX) / dt : 0;
      lander.rotation.z = clamp(-drift * 0.12, -0.2, 0.2) + (above > 0.1 ? Math.sin(seconds * 0.9) * 0.02 : 0);
      plume.visible = descending && above > 0.08;
      plume.scale.setScalar((landing.thrustAdjusted ? 1.25 : 0.9) * (0.92 + 0.1 * Math.sin(seconds * 41) + 0.05 * Math.sin(seconds * 67)));
      const blast = descending ? smooth(2.8, 0.2, above) : 0;
      dust.forEach((puff, index) => {
        const cycle = (seconds * 0.5 + index / dust.length) % 1;
        const angle = (index / dust.length) * Math.PI * 2 + index;
        puff.position.set(lander.position.x + Math.cos(angle) * (0.5 + cycle * 2.6), ground - 0.5 * SCALE + 0.25 + cycle * 0.3, ZONE_Z + Math.sin(angle) * (0.4 + cycle * 1.6));
        puff.scale.setScalar(1 + cycle * 2.2);
        puff.material.opacity = blast * 0.34 * (1 - cycle);
      });
      zones.forEach((zone) => {
        const chosen = landing.zone === zone.id;
        zone.ring.material.opacity = chosen ? 0.8 + 0.18 * Math.sin(seconds * 4) : 0.55;
        zone.ring.material.color.set(chosen ? 0x6ee7b7 : 0x4cc9f0);
        zone.pad.material.color.set(chosen ? 0x6ee7b7 : 0x4cc9f0);
        zone.pad.material.opacity = chosen ? 0.2 : 0.07;
        zone.label.userData.setLabel(`ZONE ${zone.id}`, chosen ? '#6ee7b7' : '#b9c7dc');
      });
      earth.globe.rotation.y += dt * 0.05;
      earth.cloudLayer.rotation.y += dt * 0.07;
    },
  };
}

export default function MissionScene3D({ phase, elapsed, installedParts = [], pad, ascent, landing, transitElapsed = 0, assembly, onInstall, onSelectPart, onHoverPart, onDragPart, onMiss, onLayout }) {
  const mountRef = useRef(null);
  const frameState = useRef({});
  // Stages that share a setting keep one scene: the hangar while the last part settles,
  // and the control room from pad preparation through the countdown.
  const sceneKind = SCENE_KIND[phase] || 'assembly';

  useEffect(() => {
    frameState.current = { phase, elapsed, installedParts, pad, ascent, landing, transitElapsed, assembly, onInstall, onSelectPart, onHoverPart, onDragPart, onMiss, onLayout };
  }, [phase, elapsed, installedParts, pad, ascent, landing, transitElapsed, assembly, onInstall, onSelectPart, onHoverPart, onDragPart, onMiss, onLayout]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      mount.dataset.unavailable = 'true';
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = sceneKind === 'assembly' || sceneKind === 'landing';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.replaceChildren(renderer.domElement);
    const canvas = renderer.domElement;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sceneKind === 'assembly' ? 0x080c14 : sceneKind === 'pad' ? 0x080d17 : 0x02050d);
    if (sceneKind === 'assembly') scene.fog = new THREE.Fog(0x080c14, 22, 46);
    addLights(scene, sceneKind);
    const frameSpec = SCENE_FRAMES[sceneKind];
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 320);
    const viewTarget = new THREE.Vector3(...frameSpec.target);
    camera.position.set(...frameSpec.position);
    camera.lookAt(viewTarget);
    camera.updateMatrixWorld();
    const viewDistance = camera.position.distanceTo(viewTarget);
    let stage = null;
    let rig = null;

    if (sceneKind === 'assembly') {
      addHangar(scene);
      rig = addAssemblyRig(scene);
    } else if (sceneKind === 'pad') {
      stage = addPadRoom(scene);
    } else if (sceneKind === 'ascent') {
      stage = addAscent(scene);
    } else if (sceneKind === 'transit') {
      stage = addTransit(scene);
    } else {
      stage = addLandingScene(scene);
    }

    const callbacks = () => frameState.current || {};
    const projected = new THREE.Vector3();
    const screenRect = (centreX, centreY, width, height) => {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        projected.set(centreX + sx * width / 2, centreY + sy * height / 2, 0).project(camera);
        const px = (projected.x + 1) / 2 * mount.clientWidth;
        const py = (1 - projected.y) / 2 * mount.clientHeight;
        left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
      return { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
    };
    const reportLayout = () => {
      if (!rig) return;
      const layout = { parts: {}, slots: {} };
      for (const id of STACK_ORDER) {
        layout.parts[id] = screenRect(partHomes[id][0], partHomes[id][1], PART_SIZE[id][0], PART_SIZE[id][1]);
        const [low, high] = SLOT_RANGE[id];
        layout.slots[id] = screenRect(VEHICLE_X, (low + high) / 2, Math.max(1, PART_SIZE[id][0]), high - low);
      }
      callbacks().onLayout?.(layout);
    };

    // Each stage marks the part of the page it leaves clear with [data-scene-window].
    // The camera is zoomed and shifted so the stage's subject fills that window instead
    // of sitting underneath the panels.
    let viewKey = '';
    const updateView = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      let area = { left: 0, top: 0, width, height };
      const marker = document.querySelector('[data-scene-window]');
      if (marker) {
        const rect = marker.getBoundingClientRect();
        const base = mount.getBoundingClientRect();
        if (rect.width > 60 && rect.height > 60) area = { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height };
      }
      const key = [width, height, area.left, area.top, area.width, area.height].map(Math.round).join(',');
      if (key === viewKey) return;
      viewKey = key;
      renderer.setSize(width, height);
      const halfHeight = Math.max(frameSpec.height, frameSpec.width / (area.width / area.height)) / 2;
      const tangent = (halfHeight / viewDistance) * (height / area.height);
      camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tangent)), 5, 140);
      camera.aspect = width / height;
      camera.setViewOffset(width, height, width / 2 - (area.left + area.width / 2), height / 2 - (area.top + area.height / 2), width, height);
      camera.updateProjectionMatrix();
      reportLayout();
    };
    updateView();

    // Assembly is the only stage with 3D interaction: pick up a part from the rack and
    // drop it on the vehicle, or click a part and then click its space.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let drag = null;
    let hoverPart = null;
    let hoverSlot = null;
    const installedNow = () => callbacks().installedParts || [];
    const planePoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
    };
    const partAt = (point) => {
      const installed = installedNow();
      let best = null;
      let bestDistance = Infinity;
      for (const id of STACK_ORDER) {
        if (installed.includes(id)) continue;
        const dx = Math.abs(point.x - partHomes[id][0]);
        const dy = Math.abs(point.y - partHomes[id][1]);
        if (dx <= PART_SIZE[id][0] / 2 + 0.2 && dy <= PART_SIZE[id][1] / 2 + 0.2 && dx + dy < bestDistance) { best = id; bestDistance = dx + dy; }
      }
      return best;
    };
    // Which space on the vehicle a point is over. The part in hand wins anywhere inside
    // its own space, which matters for the fairing: it closes over the lander's space.
    const slotAt = (point, partId) => {
      if (Math.abs(point.x - VEHICLE_X) > 1.15 || point.y < STACK_BASE - 0.25 || point.y > STACK_TOP + 0.25) return null;
      const own = partId ? SLOT_OF[partId] : null;
      if (own && Math.abs(point.y - partSlots[own]) <= PART_SIZE[own][1] / 2) return own;
      let best = null;
      let bestDistance = Infinity;
      for (const id of STACK_ORDER) {
        const [low, high] = SLOT_RANGE[id];
        const distance = Math.max(0, low - point.y, point.y - high);
        if (distance < bestDistance) { best = id; bestDistance = distance; }
      }
      return best;
    };
    // Forgiving snap: the part only has to be close to its own space, not exactly on it.
    const nearOwnSlot = (id, point) => {
      const slot = SLOT_OF[id];
      return Math.abs(point.x - VEHICLE_X) < 1.5 && Math.abs(point.y - partSlots[slot]) < PART_SIZE[slot][1] / 2 + 0.45;
    };
    const assemblyOpen = () => rig && installedNow().length < STACK_ORDER.length;
    const setHover = (id) => {
      if (id === hoverPart) return;
      hoverPart = id;
      callbacks().onHoverPart?.(id);
    };
    const onPointerDown = (event) => {
      if (!assemblyOpen() || event.button !== 0) return;
      const point = planePoint(event);
      if (!point) return;
      const id = partAt(point);
      if (id) {
        drag = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, position: new THREE.Vector3(partHomes[id][0], partHomes[id][1], 0), offsetX: partHomes[id][0] - point.x, offsetY: partHomes[id][1] - point.y };
        canvas.setPointerCapture?.(event.pointerId);
        callbacks().onSelectPart?.(id);
        event.preventDefault();
        return;
      }
      const selected = callbacks().assembly?.selected;
      const holding = selected && !installedNow().includes(selected) ? selected : null;
      const slot = slotAt(point, holding);
      if (!slot) return;
      if (holding) callbacks().onInstall?.(holding, slot);
      else callbacks().onMiss?.('no-part');
    };
    const onPointerMove = (event) => {
      if (!rig) return;
      const point = planePoint(event);
      if (drag) {
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
          drag.moved = true;
          setHover(null);
          callbacks().onDragPart?.(drag.id);
        }
        if (drag.moved && point) drag.position.set(clamp(point.x + drag.offsetX, -7.4, 5.4), clamp(point.y + drag.offsetY, 0.4, 9.4), 0);
        return;
      }
      if (!assemblyOpen() || !point) { setHover(null); hoverSlot = null; return; }
      const id = partAt(point);
      setHover(id);
      const selected = callbacks().assembly?.selected;
      hoverSlot = !id && selected ? slotAt(point, selected) : null;
    };
    const onPointerUp = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const finished = drag;
      drag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      if (!finished.moved || event.type === 'pointercancel') return;
      if (nearOwnSlot(finished.id, finished.position)) { callbacks().onInstall?.(finished.id, SLOT_OF[finished.id]); return; }
      const slot = slotAt(finished.position, finished.id);
      if (slot) callbacks().onInstall?.(finished.id, slot);
      else callbacks().onMiss?.('outside');
    };
    const onPointerLeave = () => { if (!drag) { setHover(null); hoverSlot = null; } };
    if (rig) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
    }

    const tint = new THREE.Color();
    const animateAssembly = (current, dt, seconds) => {
      const installed = current.installedParts || [];
      const selected = current.assembly?.selected;
      const focusPart = current.assembly?.focusPart;
      const focusSlot = current.assembly?.focusSlot;
      const dragging = drag?.moved ? drag : null;
      const guiding = Boolean(dragging || (selected && !installed.includes(selected)));
      for (const id of STACK_ORDER) {
        const part = rig.parts[id];
        const isInstalled = installed.includes(id);
        const isDragged = dragging?.id === id;
        const isSelected = !isInstalled && selected === id;
        const isHover = !isInstalled && (hoverPart === id || focusPart === id);
        let x = partHomes[id][0];
        let y = partHomes[id][1];
        let z = 0;
        let scale = 1;
        if (isInstalled) { x = VEHICLE_X; y = partSlots[SLOT_OF[id]]; }
        else if (isDragged) { x = dragging.position.x; y = dragging.position.y; z = 0.45; scale = 1.06; }
        else if (isSelected) { y += 0.14 + Math.sin(seconds * 3) * 0.03; scale = 1.08; }
        else if (isHover) scale = 1.06;
        const rate = isDragged ? 32 : 9;
        part.group.position.set(damp(part.group.position.x, x, rate, dt), damp(part.group.position.y, y, rate, dt), damp(part.group.position.z, z, rate, dt));
        part.group.scale.setScalar(damp(part.group.scale.x, scale, 12, dt));
        tint.set(isDragged || isSelected ? 0x17485c : isHover ? 0x0d2a36 : 0x000000);
        part.materials.forEach(({ item, base }) => item.emissive.copy(base).add(tint));

        const ghost = rig.ghosts[id];
        const filled = installed.some((partId) => SLOT_OF[partId] === id);
        ghost.group.visible = !filled;
        if (filled) continue;
        let colour = 0x4cc9f0;
        let fill = guiding ? 0.1 : 0.06;
        let line = guiding ? 0.5 : 0.3;
        if (dragging && SLOT_OF[dragging.id] === id && nearOwnSlot(dragging.id, dragging.position)) {
          colour = 0x6ee7b7;
          fill = 0.34 + Math.sin(seconds * 8) * 0.08;
          line = 1;
        } else if (!dragging && (focusSlot === id || hoverSlot === id)) {
          fill = 0.24;
          line = 0.95;
        }
        ghost.fill.color.set(colour);
        ghost.line.color.set(colour);
        ghost.fill.opacity = fill;
        ghost.line.opacity = line;
      }
      canvas.style.cursor = dragging ? 'grabbing' : hoverPart ? 'grab' : hoverSlot ? 'pointer' : 'default';
    };

    let frame = 0;
    let frameCount = 0;
    let lastTime = performance.now();
    let disposed = false;
    const resize = new ResizeObserver(updateView);
    resize.observe(mount);
    const animate = () => {
      if (disposed) return;
      const current = frameState.current || {};
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      frameCount += 1;
      // Panels can open, close or resize without the canvas changing size.
      if (frameCount % 12 === 0) updateView();
      if (rig) animateAssembly(current, dt, now / 1000);
      if (stage) stage.update(current, dt, now / 1000);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      if (rig) callbacks().onHoverPart?.(null);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => { item.map?.dispose(); item.dispose(); });
        }
        if (object.isLight) object.dispose?.();
      });
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [sceneKind]);

  return <div ref={mountRef} className={`mission-scene-background scene-${phase}`} aria-hidden="true"><div className="mission-scene-fallback">3D scene unavailable · mission controls remain active</div></div>;
}
