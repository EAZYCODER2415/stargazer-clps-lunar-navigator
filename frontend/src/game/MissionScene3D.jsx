import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

const componentColors = {
  'first-engine': 0xe87943,
  'first-tank': 0x64748b,
  interstage: 0x94a3b8,
  'upper-engine': 0xf59e0b,
  'upper-tank': 0x475569,
  'payload-adapter': 0xa78bfa,
  lander: 0x38bdf8,
  fairing: 0xcbd5e1,
};

const partSlots = {
  'first-engine': 0.45,
  'first-tank': 1.75,
  interstage: 3.02,
  'upper-engine': 3.34,
  'upper-tank': 4.36,
  'payload-adapter': 5.27,
  lander: 5.68,
  fairing: 6.72,
};

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.35, ...options });
}

function box(parent, position, size, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, position, radiusTop, radiusBottom, height, color, segments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material(color));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function makePart(id, parent) {
  const color = componentColors[id];
  const group = new THREE.Group();
  parent.add(group);
  if (id.endsWith('engine')) {
    cylinder(group, [0, 0.13, 0], 0.2, 0.32, 0.25, 0x64748b, 16);
    cylinder(group, [0, -0.15, 0], 0.16, 0.25, 0.42, color, 16);
    cylinder(group, [0, -0.4, 0], 0.23, 0.12, 0.26, 0x273244, 16);
  } else if (id.endsWith('tank')) {
    cylinder(group, [0, 0, 0], 0.4, 0.4, id === 'first-tank' ? 1.6 : 1.05, color, 24);
    cylinder(group, [0, id === 'first-tank' ? 0.82 : 0.545, 0], 0.32, 0.4, 0.1, 0xb8c5d4, 24);
    cylinder(group, [0, id === 'first-tank' ? -0.82 : -0.545, 0], 0.4, 0.32, 0.1, 0x313b4c, 24);
    for (let y = -0.55; y <= 0.56; y += 0.55) cylinder(group, [0, y, 0], 0.405, 0.405, 0.025, 0xa6b1c2, 24);
  } else if (id === 'interstage') {
    cylinder(group, [0, 0, 0], 0.42, 0.46, 0.28, color, 24);
    cylinder(group, [0, 0.18, 0], 0.3, 0.42, 0.12, 0x30394a, 24);
  } else if (id === 'payload-adapter') {
    cylinder(group, [0, 0, 0], 0.23, 0.4, 0.42, color, 24);
  } else if (id === 'lander') {
    box(group, [0, 0.1, 0], [0.88, 0.64, 0.72], 0xc6c3b5, { metalness: 0.16 });
    box(group, [0, 0.18, 0.39], [0.45, 0.27, 0.08], 0x64748b);
    for (const side of [-1, 1]) {
      box(group, [side * 0.72, 0.1, 0], [0.6, 0.05, 0.28], color, { emissive: 0x08283a });
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.65, 8), material(0xbac4d1));
      leg.position.set(side * 0.35, -0.42, 0);
      group.add(leg);
    }
  } else if (id === 'fairing') {
    cylinder(group, [0, -0.1, 0], 0.41, 0.41, 0.18, color, 24);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.41, 0.8, 24), material(color));
    nose.position.y = 0.39;
    group.add(nose);
  }
  return group;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xc9d9f1, 0x1c2331, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(7, 11, 8);
  scene.add(key);
  const fill = new THREE.PointLight(0x4cc9f0, 22, 24);
  fill.position.set(-5, 5, 1);
  scene.add(fill);
}

function addHangar(scene, installedParts, selectedPart) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 30), material(0x151b27, { roughness: 0.88 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.04, -1);
  scene.add(floor);
  const grid = new THREE.GridHelper(30, 30, 0x37546a, 0x253344);
  grid.position.set(0, 0.01, -1);
  scene.add(grid);
  box(scene, [0, 8.5, -6], [18, 0.22, 0.22], 0x59677d);
  box(scene, [0, 10.5, -6], [18, 0.16, 0.16], 0x344156);
  for (const x of [-8, -5.3, 5.3, 8]) {
    box(scene, [x, 4.5, -6], [0.18, 9, 0.18], 0x526078);
    box(scene, [x, 4.5, 4], [0.18, 9, 0.18], 0x364255);
    box(scene, [x, 9, -1], [0.16, 0.16, 10], 0x4b5970);
    for (let y = 1.2; y < 8.8; y += 2.1) box(scene, [x, y, -0.9], [0.65, 0.045, 10], 0x38465a);
  }
  for (const z of [-6, 4]) {
    for (const x of [-8, -5.3, 5.3, 8]) box(scene, [x * 0.78, 5, z], [0.12, 0.12, 0.12], 0x4cc9f0, { emissive: 0x1b6476 });
  }

  box(scene, [-4.9, 1.45, -0.8], [1.3, 2.9, 7.6], 0x0c111b);
  box(scene, [-4.9, 1.45, 3.05], [1.4, 0.2, 0.18], 0x53637c);
  const partTargets = [];
  for (let i = 0; i < 8; i += 1) {
    const id = ['fairing', 'lander', 'payload-adapter', 'upper-tank', 'upper-engine', 'interstage', 'first-tank', 'first-engine'][i];
    const y = 0.5 + i * 0.77;
    const rack = new THREE.Group();
    scene.add(rack);
    rack.position.set(-4.55, y, 0.5);
    rack.userData.partId = id;
    rack.userData.rackPosition = rack.position.clone();
    const part = makePart(id, rack);
    part.scale.setScalar(selectedPart === id ? 0.48 : 0.38);
    if (installedParts.includes(id)) {
      rack.position.set(0, partSlots[id], 0);
      delete rack.userData.partId;
      part.scale.setScalar(1);
    } else {
      partTargets.push(rack);
    }
  }

  box(scene, [0, 0.16, 0], [1.35, 0.18, 1.35], 0x59677d);
  for (const x of [-0.56, 0.56]) box(scene, [x, 0.9, 0], [0.055, 1.5, 0.055], 0x8995a8);
  for (const z of [-0.56, 0.56]) box(scene, [0, 0.9, z], [1.15, 1.5, 0.055], 0x8995a8);
  return partTargets;
}

function addControlRoom(scene, pad) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 22), material(0x121825, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  scene.add(floor);
  const grid = new THREE.GridHelper(22, 22, 0x314258, 0x202b3b);
  grid.position.y = 0.015;
  scene.add(grid);
  box(scene, [0, 5.2, -7], [20, 10.4, 0.35], 0x141b29);
  box(scene, [-9.8, 4.5, -1], [0.35, 9, 12], 0x101622);
  box(scene, [9.8, 4.5, -1], [0.35, 9, 12], 0x101622);
  box(scene, [0, 9.8, -1], [20, 0.35, 12], 0x0b1019);

  // Panoramic mission monitor: a schematic pad, not a live or photorealistic feed.
  box(scene, [0, 4.45, -6.74], [14.5, 5.9, 0.22], 0x4b5b73);
  box(scene, [0, 4.45, -6.59], [14.1, 5.5, 0.08], 0x0a1521, { emissive: 0x071321 });
  box(scene, [0, 1.95, -6.48], [14, 0.08, 0.08], 0x4cc9f0, { emissive: 0x15546b });
  const screenTower = new THREE.Group();
  scene.add(screenTower);
  screenTower.position.set(-2.5, 2.1, -6.42);
  box(screenTower, [0, 1.72, 0], [0.24, 3.5, 0.18], 0x64748b);
  for (const y of [0.45, 1.1, 1.8, 2.5]) box(screenTower, [0.55, y, 0], [1.15, 0.07, 0.12], 0x64748b);
  const displayRocket = new THREE.Group();
  scene.add(displayRocket);
  displayRocket.position.set(0.35, 2.2, -6.36);
  cylinder(displayRocket, [0, 1.6, 0], 0.23, 0.28, 3.2, 0xcbd5e1, 18);
  cylinder(displayRocket, [0, 0.25, 0], 0.28, 0.28, 0.15, 0x4cc9f0, 18);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.65, 18), material(0xe2e8f0));
  tip.position.set(0, 3.47, 0);
  displayRocket.add(tip);
  box(scene, [-1.1, 3.65, -6.28], [pad.platformRetracted ? 0.35 : pad.platformExtended ? 2.3 : 1.3, 0.12, 0.18], 0xfbbf24, { emissive: 0x4a3108 });
  const cableMat = material(pad.fuelConnected ? 0xfbbf24 : 0x465267, { emissive: pad.fuelConnected ? 0x30200a : 0x000000 });
  const fuelLine = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 8, 32, Math.PI), cableMat);
  fuelLine.rotation.z = Math.PI;
  fuelLine.position.set(-0.15, 2.65, -6.28);
  scene.add(fuelLine);
  const oxidizerLine = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.04, 8, 32, Math.PI), material(pad.oxidizerConnected ? 0x66b2ff : 0x465267, { emissive: pad.oxidizerConnected ? 0x102b49 : 0x000000 }));
  oxidizerLine.rotation.z = Math.PI;
  oxidizerLine.position.set(0.3, 2.65, -6.26);
  scene.add(oxidizerLine);
  if (pad.propellantLoaded) {
    const loaded = box(scene, [5.4, 2.25, -6.42], [1.65, 0.16, 0.07], 0x6ee7b7, { emissive: 0x1a5e46 });
    loaded.name = 'propellant-loaded-indicator';
  } else if (pad.propellantStartedAt !== null) {
    box(scene, [5.4, 2.25, -6.42], [1.1, 0.16, 0.07], 0xfbbf24, { emissive: 0x4a3108 });
  }
  const screenBars = [0, 1, 2, 3, 4, 5];
  screenBars.forEach((index) => box(scene, [-5.6 + (index % 2) * 0.65, 5.9 - Math.floor(index / 2) * 0.44, -6.4], [0.48, 0.045, 0.06], index % 2 ? 0x66b2ff : 0x4cc9f0, { emissive: 0x092437 }));

  for (const x of [-6.2, -3.1, 3.1, 6.2]) {
    box(scene, [x, 0.62, 0], [2.55, 0.95, 1.6], 0x222d40);
    box(scene, [x, 1.13, -0.34], [2.3, 0.08, 1.15], 0x101b2a, { emissive: 0x07131e });
    for (let i = 0; i < 5; i += 1) box(scene, [x - 0.82 + i * 0.4, 1.19, -0.28], [0.12, 0.025, 0.18], i % 3 ? 0x4cc9f0 : 0xfbbf24, { emissive: 0x122d3e });
  }
  for (const x of [-8.7, 8.7]) {
    const screen = box(scene, [x, 3.1, -4.5], [1.65, 1.25, 0.12], 0x15283a, { emissive: 0x0a3045 });
    screen.rotation.y = x < 0 ? 0.2 : -0.2;
  }
  for (let x = -8; x <= 8; x += 4) box(scene, [x, 9.25, -1], [0.08, 0.08, 10], 0x4cc9f0, { emissive: 0x15546b });
}

function addStars(scene) {
  const positions = [];
  let seed = 27;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 450; i += 1) {
    const point = new THREE.Vector3((random() - 0.5) * 70, (random() - 0.5) * 45, (random() - 0.5) * 70);
    if (point.length() < 15) point.normalize().multiplyScalar(18);
    positions.push(point.x, point.y, point.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb8c8e3, size: 0.1, transparent: true, opacity: 0.8 }));
  scene.add(stars);
}

function addAscent(scene) {
  addStars(scene);
  const rocket = new THREE.Group();
  scene.add(rocket);
  cylinder(rocket, [0, -0.7, 0], 0.48, 0.58, 1.9, 0x64748b, 24);
  cylinder(rocket, [0, 1.05, 0], 0.36, 0.48, 1.6, 0x8792a3, 24);
  cylinder(rocket, [0, 2.38, 0], 0.28, 0.36, 1.2, 0xcbd5e1, 24);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 24), material(0xe2e8f0));
  nose.position.y = 3.3;
  rocket.add(nose);
  const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.37, 1.35, 20), material(0xf97316, { emissive: 0xea580c, transparent: true, opacity: 0.82 }));
  exhaust.rotation.x = Math.PI;
  exhaust.position.y = -2.05;
  rocket.add(exhaust);
  for (const x of [-0.38, 0.38]) box(rocket, [x, -0.6, 0], [0.12, 0.55, 0.2], 0x475569);

  const firstStage = new THREE.Group();
  scene.add(firstStage);
  cylinder(firstStage, [0, 0, 0], 0.48, 0.58, 1.45, 0x64748b, 24);
  cylinder(firstStage, [0, -0.89, 0], 0.15, 0.24, 0.34, 0xe87943, 16);
  const fairings = [];
  for (const side of [-1, 1]) {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 1.55, 18, 1, true, side < 0 ? 0 : Math.PI, Math.PI), material(0xcbd5e1, { side: THREE.DoubleSide }));
    shell.position.set(side * 0.18, 2.55, 0);
    rocket.add(shell);
    fairings.push(shell);
  }
  return { rocket, firstStage, fairings, exhaust };
}

function addTransit(scene) {
  addStars(scene);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(2.1, 48, 32), material(0x286ca6, { emissive: 0x071d37, roughness: 0.68 }));
  earth.position.set(-8, 0.2, 0);
  scene.add(earth);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.45, 40, 28), material(0x9ba1a9, { roughness: 0.93 }));
  moon.position.set(8, 0, 0);
  scene.add(moon);
  const orbit = new THREE.CatmullRomCurve3([new THREE.Vector3(-5.6, 0, 0), new THREE.Vector3(-2.6, 2.1, 0), new THREE.Vector3(1.3, 2.1, 0), new THREE.Vector3(5.7, 0, 0)]);
  const path = new THREE.Mesh(new THREE.TubeGeometry(orbit, 72, 0.025, 6, false), material(0x4cc9f0, { emissive: 0x164352 }));
  scene.add(path);
  const craft = new THREE.Group();
  scene.add(craft);
  cylinder(craft, [0, 0, 0], 0.26, 0.26, 1.2, 0xcbd5e1, 16).rotation.z = Math.PI / 2;
  box(craft, [0, 0, 0], [0.45, 0.34, 0.36], 0x38bdf8, { emissive: 0x082b3c });
  for (const side of [-1, 1]) box(craft, [0, side * 0.65, 0], [0.72, 0.06, 0.48], 0x4f7fa9, { emissive: 0x101e30 });
  return { earth, moon, craft, orbit };
}

function addLandingScene(scene) {
  addStars(scene);
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 1, 1), material(0x34312e, { roughness: 1, metalness: 0 }));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.08;
  scene.add(surface);
  const horizon = new THREE.Mesh(new THREE.SphereGeometry(42, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), material(0x242a31, { roughness: 1 }));
  horizon.position.set(0, -3.8, -28);
  horizon.scale.set(1.8, 0.55, 0.65);
  scene.add(horizon);
  for (const [x, z, radius] of [[-8, -3, 2.7], [7, -5, 2], [2, 4, 1.35], [-4, 7, 1.6]]) {
    const crater = new THREE.Mesh(new THREE.RingGeometry(radius * 0.55, radius, 32), material(0x211f20, { roughness: 1, side: THREE.DoubleSide }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(x, -0.025, z);
    scene.add(crater);
  }
  let seed = 41;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 34; i += 1) {
    const radius = 0.16 + random() * 0.48;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), material(i % 3 ? 0x514a43 : 0x696159, { roughness: 1, metalness: 0 }));
    rock.position.set((random() - 0.5) * 26, radius * 0.35, (random() - 0.5) * 25);
    rock.rotation.set(random(), random() * Math.PI, random());
    scene.add(rock);
  }
  const earth = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16), material(0x4a9bdb, { emissive: 0x123758 }));
  earth.position.set(-7, 8, -17);
  scene.add(earth);
  const lander = makePart('lander', scene);
  lander.position.set(0, 9, 0);
  lander.scale.setScalar(1.45);
  const dust = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xc5b49a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  dust.rotation.x = Math.PI;
  dust.position.y = -1.9;
  lander.add(dust);
  return { lander, earth };
}

export default function MissionScene3D({ phase, elapsed, installedParts = [], selectedPart, pad, ascent, landing, transitElapsed = 0, onInstall, onSelectPart }) {
  const mountRef = useRef(null);
  const frameState = useRef({});
  const installedKey = useMemo(() => [...installedParts].sort().join('|'), [installedParts]);
  const padSceneState = useMemo(() => ({
    platformExtended: pad?.platformExtended,
    platformRetracted: pad?.platformRetracted,
    fuelConnected: pad?.fuelConnected,
    oxidizerConnected: pad?.oxidizerConnected,
    propellantStartedAt: pad?.propellantStartedAt,
    propellantLoaded: pad?.propellantLoaded,
  }), [pad?.platformExtended, pad?.platformRetracted, pad?.fuelConnected, pad?.oxidizerConnected, pad?.propellantStartedAt, pad?.propellantLoaded]);

  useEffect(() => {
    frameState.current = { elapsed, pad, ascent, landing, selectedPart, transitElapsed, onInstall, onSelectPart };
  }, [elapsed, pad, ascent, landing, selectedPart, transitElapsed, onInstall, onSelectPart]);

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
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(phase === 'assembly' || phase === 'assembly-complete' ? 0x080c14 : phase === 'launchpad' || phase === 'countdown' ? 0x080d17 : 0x02050d);
    if (phase.startsWith('assembly')) scene.fog = new THREE.Fog(0x080c14, 18, 38);
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 100);
    let motion = {};
    let assemblyTarget = null;
    let assemblyParts = [];
    let assemblyGuide = null;

    if (phase.startsWith('assembly')) {
      camera.position.set(10.5, 7.5, 15.5);
      camera.lookAt(0, 4.1, 0);
      assemblyParts = addHangar(scene, installedKey ? installedKey.split('|') : [], selectedPart);
      assemblyTarget = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 7.8, 12), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      assemblyTarget.position.y = 4;
      assemblyTarget.name = 'assembly-drop-target';
      scene.add(assemblyTarget);
      assemblyGuide = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.045, 8, 36), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.9, depthWrite: false }));
      assemblyGuide.rotation.x = Math.PI / 2;
      assemblyGuide.position.y = 4;
      assemblyGuide.visible = false;
      scene.add(assemblyGuide);
    } else if (phase === 'launchpad' || phase === 'countdown') {
      camera.position.set(0, 3.8, 10.5);
      camera.lookAt(0, 4.1, -6.8);
      addControlRoom(scene, padSceneState || {});
    } else if (phase === 'ascent') {
      camera.position.set(0, 4.2, 17);
      camera.lookAt(0, 3.8, 0);
      motion = addAscent(scene);
    } else if (phase === 'transit') {
      camera.position.set(0, 9.5, 21);
      camera.lookAt(0, 0.2, 0);
      motion = addTransit(scene);
    } else if (phase === 'landing') {
      camera.position.set(0, 10, 18);
      camera.lookAt(0, 3.4, 0);
      motion = addLandingScene(scene);
    }

    let frame = 0;
    let disposed = false;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let activeAssemblyDrag = null;
    const updatePointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return rect;
    };
    const onPointerDown = (event) => {
      if (!assemblyTarget || event.button !== 0) return;
      updatePointer(event);
      const hit = raycaster.intersectObjects(assemblyParts.flatMap((part) => part.children), true)[0];
      if (!hit) return;
      let root = hit.object;
      while (root && !root.userData.partId) root = root.parent;
      if (!root?.userData.partId) return;
      const partId = root.userData.partId;
      frameState.current?.onSelectPart?.(partId);
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -root.position.z);
      const point = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
      if (!point) return;
      activeAssemblyDrag = {
        pointerId: event.pointerId,
        partId,
        root,
        original: root.position.clone(),
        offset: root.position.clone().sub(point),
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      if (!activeAssemblyDrag || activeAssemblyDrag.pointerId !== event.pointerId) {
        if (assemblyTarget) {
          updatePointer(event);
          const hovered = raycaster.intersectObjects(assemblyParts.flatMap((part) => part.children), true).length > 0;
          renderer.domElement.style.cursor = hovered ? 'grab' : 'default';
        }
        return;
      }
      updatePointer(event);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -activeAssemblyDrag.original.z);
      const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!point) return;
      activeAssemblyDrag.root.position.set(point.x + activeAssemblyDrag.offset.x, point.y + activeAssemblyDrag.offset.y, activeAssemblyDrag.original.z);
      activeAssemblyDrag.moved ||= Math.hypot(event.clientX - activeAssemblyDrag.startX, event.clientY - activeAssemblyDrag.startY) > 7;
      const targetHit = raycaster.intersectObject(assemblyTarget, false)[0];
      if (targetHit && assemblyGuide) {
        const nearest = Object.entries(partSlots).reduce((result, [slotId, y]) => Math.abs(y - targetHit.point.y) < Math.abs(result.y - targetHit.point.y) ? { slotId, y } : result, { slotId: '', y: 4 });
        assemblyGuide.visible = true;
        assemblyGuide.position.y = nearest.y;
        assemblyGuide.material.color.set(nearest.slotId === activeAssemblyDrag.partId ? 0x4cc9f0 : 0xfbbf24);
      } else if (assemblyGuide) assemblyGuide.visible = false;
    };
    const onPointerUp = (event) => {
      if (!activeAssemblyDrag || activeAssemblyDrag.pointerId !== event.pointerId) return;
      const drag = activeAssemblyDrag;
      activeAssemblyDrag = null;
      if (assemblyGuide) assemblyGuide.visible = false;
      renderer.domElement.style.cursor = 'default';
      if (!drag.moved) {
        frameState.current?.onSelectPart?.(drag.partId);
        return;
      }
      updatePointer(event);
      const hit = raycaster.intersectObject(assemblyTarget, false)[0];
      if (hit) {
        const nearestSlot = Object.entries(partSlots).reduce((nearest, [slotId, y]) => Math.abs(y - hit.point.y) < Math.abs(nearest.y - hit.point.y) ? { slotId, y } : nearest, { slotId: '', y: 4 });
        const partSlot = drag.partId;
        if (Math.abs(nearestSlot.y - hit.point.y) <= 0.82 && Math.hypot(hit.point.x, hit.point.z) < 1.35) {
          frameState.current?.onInstall?.(partSlot, nearestSlot.slotId);
        }
      }
      drag.root.position.copy(drag.original);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    const resize = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    resize.observe(mount);
    const animate = () => {
      if (disposed) return;
      const current = frameState.current || {};
      if (assemblyParts.length) assemblyParts.forEach((part) => part.children[0]?.scale.setScalar(current.selectedPart === part.userData.partId ? 0.48 : 0.38));
      if (phase === 'ascent' && motion.rocket) {
        const flightTime = Math.max(0, current.elapsed - (current.ascent?.launchedAt || 0));
        motion.rocket.position.y = Math.min(4.8, flightTime * 0.021);
        motion.exhaust.scale.y = 0.8 + (Math.sin(flightTime * 0.4) + 1) * 0.18;
        if (current.ascent?.separatedAt) {
          motion.firstStage.visible = true;
          motion.firstStage.position.set(0.15, Math.max(-8, 1.2 - (current.elapsed - current.ascent.separatedAt) * 0.045), 0.3);
        } else {
          motion.firstStage.visible = false;
        }
        motion.fairings.forEach((piece, index) => {
          if (current.ascent?.fairingSeparated) piece.position.x = (index === 0 ? -1 : 1) * (0.8 + Math.max(0, flightTime - 75) * 0.018);
        });
      }
      if (phase === 'transit' && motion.craft) {
        const progress = THREE.MathUtils.clamp((current.transitElapsed || 0) / 180, 0, 1);
        motion.craft.position.copy(motion.orbit.getPoint(progress));
        motion.craft.rotation.z = Math.sin(progress * Math.PI) * 0.18;
        motion.earth.rotation.y += 0.0012;
        motion.moon.rotation.y += 0.0008;
      }
      if (phase === 'landing' && motion.lander) {
        const descentStart = current.landing?.descentStartedAt;
        const progress = descentStart === null || descentStart === undefined ? 0 : THREE.MathUtils.clamp((current.elapsed - descentStart) / 90, 0, 1);
        const targetHeight = current.landing?.touchdown ? 0.82 : 9 - progress * 8.18;
        motion.lander.position.y = THREE.MathUtils.damp(motion.lander.position.y, targetHeight, 3.5, 1 / 60);
        motion.lander.rotation.z = Math.sin(current.elapsed * 0.04) * (current.landing?.touchdown ? 0 : 0.025);
        motion.earth.rotation.y += 0.001;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [phase, installedKey, padSceneState]);

  return <div ref={mountRef} className={`mission-scene-background scene-${phase}`} aria-hidden="true"><div className="mission-scene-fallback">3D scene unavailable · mission controls remain active</div></div>;
}
