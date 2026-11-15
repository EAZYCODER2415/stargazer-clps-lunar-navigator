import * as THREE from 'three';
import { ASSEMBLY_COMPONENTS } from './gameEngine';
import { earthCloudCanvas, earthSoftCanvas, earthSurfaceCanvas, moonSurfaceCanvas } from './planetTextures';

// Shared 3D building blocks for the mission scenes: the vehicle parts, text tags,
// stars, engine glow, and the painted Earth and Moon.

export const componentColors = {
  'first-engine': 0xe87943,
  'first-tank': 0x64748b,
  interstage: 0x94a3b8,
  'upper-engine': 0xf59e0b,
  'upper-tank': 0x475569,
  'payload-adapter': 0xa78bfa,
  lander: 0x38bdf8,
  fairing: 0xcbd5e1,
};

// The vehicle stack, bottom to top. Every part is modelled around its own centre, so the
// same object can rest on the parts rack, follow the pointer and seat on the vehicle.
// The fairing is a shell: it closes over the payload adapter and the lander.
export const STACK_ORDER = ['first-engine', 'first-tank', 'interstage', 'upper-engine', 'upper-tank', 'payload-adapter', 'lander', 'fairing'];
export const PART_SIZE = {
  'first-engine': [0.9, 0.9],
  'first-tank': [0.84, 1.9],
  interstage: [0.84, 0.4],
  'upper-engine': [0.64, 0.7],
  'upper-tank': [0.7, 1.2],
  'payload-adapter': [0.7, 0.4],
  lander: [1.1, 1],
  fairing: [1.24, 2.8],
};
export const SLOT_OF = Object.fromEntries(ASSEMBLY_COMPONENTS.map((part) => [part.id, part.slot]));
export const STACK_BASE = 0.55;
/** Height of each part's centre on the vehicle. */
export const partSlots = {};
/** The band of the vehicle that counts as each space when pointing at it. */
export const SLOT_RANGE = {};
let cursor = STACK_BASE;
for (const id of STACK_ORDER.slice(0, 7)) {
  partSlots[id] = cursor + PART_SIZE[id][1] / 2;
  SLOT_RANGE[id] = [cursor, cursor + PART_SIZE[id][1]];
  cursor += PART_SIZE[id][1];
}
const fairingBase = SLOT_RANGE['payload-adapter'][0];
partSlots.fairing = fairingBase + PART_SIZE.fairing[1] / 2;
// Pointing at the fairing means pointing at its nose, above the lander it encloses.
SLOT_RANGE.fairing = [cursor, fairingBase + PART_SIZE.fairing[1]];
export const STACK_TOP = SLOT_RANGE.fairing[1];

export function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.35, ...options });
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function box(parent, position, size, color, options = {}) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options)));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

export function cylinder(parent, position, radiusTop, radiusBottom, height, color, segments = 20, options = {}) {
  const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material(color, options)));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

/** A thin rod between two points, for legs and braces. */
export function strut(parent, from, to, radius, color) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8), material(color)));
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  parent.add(mesh);
  return mesh;
}

// Fairing outline from its base to the tip of the nose, as [radius, height] pairs.
function fairingProfile() {
  const points = [new THREE.Vector2(0.37, -1.4), new THREE.Vector2(0.62, -1.05), new THREE.Vector2(0.62, 0.35)];
  for (let i = 1; i <= 10; i += 1) {
    const t = i / 10;
    points.push(new THREE.Vector2(0.62 * Math.sqrt(Math.max(0, 1 - t * t)), 0.35 + 1.05 * t));
  }
  return points;
}

/** One half of the fairing shell; side is −1 or 1. */
export function makeFairingHalf(parent, side) {
  const shell = shadowed(new THREE.Mesh(
    new THREE.LatheGeometry(fairingProfile(), 18, side > 0 ? 0 : Math.PI, Math.PI),
    material(componentColors.fairing, { side: THREE.DoubleSide, roughness: 0.42, metalness: 0.2 }),
  ));
  parent.add(shell);
  return shell;
}

/**
 * Builds one vehicle part. Options: `cutaway` draws the fairing see-through so the
 * lander stays visible inside it; `deployed` opens the lander's solar panels.
 */
export function makePart(id, parent, options = {}) {
  const color = componentColors[id];
  const group = new THREE.Group();
  parent.add(group);
  if (id === 'first-engine') {
    // Wide thrust plate carrying a cluster of three bells.
    cylinder(group, [0, 0.36, 0], 0.42, 0.42, 0.18, 0x566278, 28);
    cylinder(group, [0, 0.25, 0], 0.3, 0.36, 0.06, 0x30394a, 24);
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(angle) * 0.22;
      const z = Math.sin(angle) * 0.22;
      cylinder(group, [x, 0.16, z], 0.08, 0.1, 0.16, 0x273244, 14);
      cylinder(group, [x, -0.17, z], 0.1, 0.2, 0.5, color, 20, { roughness: 0.4, metalness: 0.55 });
      cylinder(group, [x, -0.435, z], 0.21, 0.21, 0.03, 0x3a2418, 20);
    }
  } else if (id === 'upper-engine') {
    // One long vacuum bell under a narrow mount.
    cylinder(group, [0, 0.29, 0], 0.32, 0.32, 0.12, 0x566278, 24);
    cylinder(group, [0, 0.13, 0], 0.11, 0.14, 0.22, 0x273244, 16);
    for (const side of [-1, 1]) strut(group, [side * 0.26, 0.23, 0], [side * 0.13, 0.04, 0], 0.014, 0x8995a8);
    cylinder(group, [0, -0.14, 0], 0.12, 0.3, 0.38, color, 24, { roughness: 0.4, metalness: 0.55 });
    cylinder(group, [0, -0.335, 0], 0.305, 0.305, 0.03, 0x4a3410, 24);
  } else if (id === 'first-tank') {
    cylinder(group, [0, 0, 0], 0.42, 0.42, 1.7, color, 32);
    cylinder(group, [0, 0.9, 0], 0.34, 0.42, 0.1, 0xb8c5d4, 32);
    cylinder(group, [0, -0.9, 0], 0.42, 0.34, 0.1, 0x313b4c, 32);
    for (const y of [-0.55, 0, 0.55]) cylinder(group, [0, y, 0], 0.428, 0.428, 0.03, 0xa6b1c2, 32);
    box(group, [0, 0, 0.425], [0.07, 1.6, 0.04], 0x2f394a);
    box(group, [0, 0.72, 0.43], [0.3, 0.1, 0.02], 0xe2e8f0);
  } else if (id === 'upper-tank') {
    cylinder(group, [0, 0, 0], 0.35, 0.35, 1, color, 32);
    cylinder(group, [0, 0.55, 0], 0.28, 0.35, 0.1, 0xb8c5d4, 32);
    cylinder(group, [0, -0.55, 0], 0.35, 0.28, 0.1, 0x313b4c, 32);
    cylinder(group, [0, 0.2, 0], 0.357, 0.357, 0.2, 0xd9a441, 32, { roughness: 0.35, metalness: 0.6 });
    box(group, [0, -0.15, 0.355], [0.06, 0.6, 0.03], 0x2f394a);
  } else if (id === 'interstage') {
    cylinder(group, [0, 0, 0], 0.35, 0.42, 0.4, color, 32);
    cylinder(group, [0, 0, 0], 0.386, 0.4, 0.08, 0x30394a, 32);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      box(group, [Math.cos(angle) * 0.4, -0.12, Math.sin(angle) * 0.4], [0.05, 0.08, 0.05], 0x566278);
    }
  } else if (id === 'payload-adapter') {
    cylinder(group, [0, -0.04, 0], 0.24, 0.35, 0.32, color, 32);
    cylinder(group, [0, 0.16, 0], 0.27, 0.27, 0.08, 0xd9d2f5, 32);
    cylinder(group, [0, -0.19, 0], 0.355, 0.355, 0.03, 0x6d5bb0, 32);
  } else if (id === 'lander') {
    // Gold-foil body, four legs, a dish, and two solar panels.
    const body = cylinder(group, [0, 0.1, 0], 0.36, 0.36, 0.44, 0xc9a54a, 8, { roughness: 0.38, metalness: 0.6 });
    body.rotation.y = Math.PI / 8;
    cylinder(group, [0, 0.35, 0], 0.3, 0.3, 0.06, 0x8995a8, 8).rotation.y = Math.PI / 8;
    box(group, [0, 0.12, 0.34], [0.26, 0.18, 0.04], 0x1f2937);
    cylinder(group, [0.12, 0.435, 0], 0.15, 0.03, 0.09, 0xe2e8f0, 18);
    cylinder(group, [-0.16, 0.44, 0.1], 0.014, 0.014, 0.12, 0xbac4d1, 8);
    cylinder(group, [0, -0.22, 0], 0.08, 0.15, 0.2, 0x30394a, 16);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      strut(group, [sx * 0.26, -0.05, sz * 0.26], [sx * 0.4, -0.47, sz * 0.4], 0.022, 0xbac4d1);
      strut(group, [sx * 0.29, 0.14, sz * 0.29], [sx * 0.37, -0.3, sz * 0.37], 0.013, 0x8995a8);
      cylinder(group, [sx * 0.4, -0.485, sz * 0.4], 0.075, 0.075, 0.03, 0xbac4d1, 14);
    }
    for (const side of [-1, 1]) {
      if (options.deployed) {
        box(group, [side * 0.68, 0.2, 0], [0.56, 0.03, 0.4], color, { emissive: 0x08283a, roughness: 0.3 });
        box(group, [side * 0.68, 0.184, 0], [0.58, 0.012, 0.42], 0x1f2937);
      } else {
        box(group, [side * 0.42, 0.1, 0], [0.035, 0.4, 0.46], color, { emissive: 0x08283a, roughness: 0.3 });
      }
    }
  } else if (id === 'fairing') {
    const shellOptions = options.cutaway
      ? { transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide, roughness: 0.25, metalness: 0.1 }
      : { roughness: 0.42, metalness: 0.2 };
    const shell = shadowed(new THREE.Mesh(new THREE.LatheGeometry(fairingProfile(), 36), material(color, shellOptions)));
    group.add(shell);
    const stripe = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.627, 0.627, 0.08, 36, 1, true), material(0x4cc9f0, { side: THREE.DoubleSide, emissive: 0x0d3442 })));
    stripe.position.y = -0.95;
    group.add(stripe);
    const seam = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.626, 0.626, 0.025, 36, 1, true), material(0x7d8aa0, { side: THREE.DoubleSide })));
    seam.position.y = 0.35;
    group.add(seam);
  }
  return group;
}

/** A see-through copy of a part that marks its empty space on the vehicle. */
export function makeGhost(id, parent) {
  const group = makePart(id, parent);
  const fill = new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.06, depthWrite: false });
  const line = new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.3 });
  const meshes = [];
  group.traverse((object) => { if (object.isMesh) meshes.push(object); });
  meshes.forEach((mesh) => {
    mesh.material.dispose();
    mesh.material = fill;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 35), line));
  });
  return { group, fill, line };
}

/**
 * A small text tag. By default it is a flat panel; `sprite: true` makes it always face
 * the camera. Call `tag.userData.setLabel(text, colour)` to change it.
 */
export function makeLabel(text, options = {}) {
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const settings = { map: texture, transparent: true, depthWrite: false, toneMapped: false };
  const tag = options.sprite
    ? new THREE.Sprite(new THREE.SpriteMaterial({ ...settings, fog: false }))
    : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ ...settings, fog: false }));
  const height = options.height || 0.3;
  let shown = '';
  tag.userData.setLabel = (nextText, colour = options.color || '#cfeffa') => {
    if (`${nextText}|${colour}` === shown) return;
    shown = `${nextText}|${colour}`;
    const context = canvas.getContext('2d');
    const font = '700 40px system-ui, "Segoe UI", sans-serif';
    const prepare = () => {
      context.font = font;
      context.textBaseline = 'middle';
      if ('letterSpacing' in context) context.letterSpacing = '3px';
    };
    prepare();
    const width = Math.ceil(context.measureText(nextText).width) + 46;
    canvas.width = width;
    canvas.height = 72;
    prepare();
    context.fillStyle = options.background || 'rgba(6, 14, 26, 0.9)';
    context.strokeStyle = colour;
    context.lineWidth = 3;
    context.beginPath();
    if (context.roundRect) context.roundRect(2, 2, width - 4, 68, 9);
    else context.rect(2, 2, width - 4, 68);
    context.fill();
    context.stroke();
    context.fillStyle = colour;
    context.fillText(nextText, 22, 38);
    // The canvas changed size, so the old GPU copy has to be thrown away first.
    texture.dispose();
    texture.needsUpdate = true;
    tag.scale.set((height * width) / 72, height, 1);
  };
  tag.userData.setLabel(text);
  return tag;
}

let glowCanvas = null;
/** Soft round glow used for engine light, clouds and dust. */
export function makeGlowTexture() {
  if (!glowCanvas) {
    glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const context = glowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(glowCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeGlow(parent, color, size, opacity = 1) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sprite.scale.set(size, size, 1);
  parent.add(sprite);
  return sprite;
}

/** Engine exhaust: an outer and an inner cone pointing down from `parent`'s origin. */
export function makePlume(parent, radius, length, outer, inner) {
  const group = new THREE.Group();
  parent.add(group);
  const cone = (r, l, color, opacity) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, l, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    mesh.rotation.x = Math.PI;
    mesh.position.y = -l / 2;
    group.add(mesh);
  };
  cone(radius, length, outer, 0.55);
  cone(radius * 0.5, length * 0.7, inner, 0.9);
  makeGlow(group, outer, radius * 5, 0.75).position.y = -radius * 0.4;
  return group;
}

/** A distant star field that always sits behind the scene. */
export function addStars(scene, count = 800) {
  const positions = [];
  const colours = [];
  let seed = 27;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < count; i += 1) {
    const height = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - height * height);
    positions.push(Math.cos(angle) * ring * 110, height * 110, Math.sin(angle) * ring * 110);
    const brightness = 0.35 + random() * random() * 0.65;
    const warmth = random();
    colours.push(brightness * (0.85 + warmth * 0.15), brightness * 0.92, brightness * (1 - warmth * 0.12));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  scene.add(stars);
  return stars;
}

const canvasTexture = (canvas) => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/**
 * Earth with a drifting cloud layer and a thin blue rim of atmosphere.
 * `soft` swaps the world map for a smooth invented surface, for close-up views.
 */
export function makeEarth(parent, radius, detail = 512, soft = false) {
  const group = new THREE.Group();
  group.rotation.z = 0.41;
  parent.add(group);
  const segments = radius > 1 ? 72 : 36;
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments / 2),
    new THREE.MeshStandardMaterial({ map: canvasTexture(soft ? earthSoftCanvas(detail) : earthSurfaceCanvas(detail)), roughness: 0.72, metalness: 0.04, emissive: 0x0a1c33, emissiveIntensity: 0.3, fog: false }),
  );
  group.add(globe);
  const cloudLayer = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, segments, segments / 2),
    new THREE.MeshStandardMaterial({ map: canvasTexture(earthCloudCanvas(detail)), transparent: true, roughness: 1, metalness: 0, depthWrite: false, fog: false }),
  );
  group.add(cloudLayer);
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, segments, segments / 2),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x5aa9ff) }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying vec3 vNormal; varying vec3 vView; void main() { float rim = clamp(-dot(normalize(vNormal), normalize(vView)) / 0.45, 0.0, 1.0); gl_FragColor = vec4(uColor, pow(rim, 2.4) * 0.6 * uOpacity); }',
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(haze);
  return { group, globe, cloudLayer, haze };
}

/** The Moon with dark plains and rimmed craters. */
export function makeMoon(parent, radius, detail = 512) {
  const surface = canvasTexture(moonSurfaceCanvas(detail));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), new THREE.MeshStandardMaterial({ map: surface, bumpMap: surface, bumpScale: 0.6, roughness: 0.96, metalness: 0, fog: false }));
  parent.add(moon);
  return moon;
}
