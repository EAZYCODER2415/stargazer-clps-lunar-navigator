import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortal } from 'react-dom';
import {
  calculateEarthPosition,
  calculateSunPosition
} from '../utils/ephemeris';

const DEG_TO_RAD = Math.PI / 180;
const CAMERA_HEIGHT = 1.8;

const getTerrainHeight = (x, z) => {
  const ridgeHeight = Math.max(0, 3.8 * (1 - Math.hypot(x, z + 11) / 9));
  const craterDepression = [
    [1.4, -4.5, -4, 0.18],
    [0.8, 4.2, -7, 0.12],
    [2.1, -8.5, -14, 0.28],
    [0.6, 7.5, -16, 0.1]
  ].reduce((depth, [radius, craterX, craterZ, amount]) => {
    const distance = Math.hypot(x - craterX, z - craterZ);
    return depth + (distance < radius ? amount * (1 - distance / radius) : 0);
  }, 0);
  return Math.max(0, ridgeHeight - craterDepression);
};

const celestialPosition = (azimuth, elevation, distance, heightOffset = 0) => {
  const azimuthRadians = azimuth * DEG_TO_RAD;
  const elevationRadians = elevation * DEG_TO_RAD;

  return new THREE.Vector3(
    Math.sin(azimuthRadians) * distance,
    CAMERA_HEIGHT + heightOffset + Math.sin(elevationRadians) * distance,
    -Math.cos(azimuthRadians) * distance
  );
};

const createCloudSprites = () => {
  const createCloudTexture = (type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 40;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 20, 4, 32, 20, 34);
    gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.76)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    const shapes = type === 'cumulus'
      ? [[10, 25, 11], [22, 16, 15], [34, 20, 18], [48, 14, 13], [56, 25, 10]]
      : type === 'stratus'
        ? [[8, 20, 16], [24, 19, 17], [40, 20, 18], [56, 19, 16]]
        : [[4, 22, 7], [18, 19, 6], [31, 16, 5], [44, 13, 4], [59, 10, 3]];
    shapes.forEach(([x, y, radius]) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    });
    return new THREE.CanvasTexture(canvas);
  };
  const materials = ['cumulus', 'stratus', 'cirrus'].map((type) => new THREE.SpriteMaterial({
    map: createCloudTexture(type),
    transparent: true,
    opacity: type === 'cirrus' ? 0.48 : 0.68,
    depthWrite: false,
    depthTest: true
  }));
  const group = new THREE.Group();
  const cloudRadius = 0.806;
  const clusterCount = 30;
  const clusterShape = [
    [-1.25, -0.55], [-0.55, -0.8], [0.2, -0.62], [0.95, -0.4],
    [-1.45, 0.08], [-0.68, 0.08], [0, 0], [0.76, 0.12], [1.4, 0.2],
    [-1.05, 0.78], [-0.25, 0.68], [0.55, 0.72], [1.12, 0.7]
  ];
  for (let index = 0; index < clusterCount; index += 1) {
    const latitude = Math.acos(1 - 2 * (index + 0.5) / clusterCount) - Math.PI / 2;
    const longitude = Math.PI * (3 - Math.sqrt(5)) * index;
    const normal = new THREE.Vector3(
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude)
    );
    const tangent = new THREE.Vector3(-normal.z, 0, normal.x).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    clusterShape.forEach(([tangentOffset, bitangentOffset], spriteIndex) => {
      const position = normal.clone()
        .multiplyScalar(cloudRadius)
        .addScaledVector(tangent, tangentOffset * 0.024)
        .addScaledVector(bitangent, bitangentOffset * 0.024)
        .normalize()
        .multiplyScalar(cloudRadius);
      const type = index % 3 === 0 ? 'cumulus' : index % 3 === 1 ? 'stratus' : 'cirrus';
      const sprite = new THREE.Sprite(materials[['cumulus', 'stratus', 'cirrus'].indexOf(type)]);
      sprite.position.copy(position);
      const scale = type === 'cumulus' ? 0.3 : type === 'stratus' ? 0.42 : 0.5;
      sprite.scale.set(scale + (spriteIndex % 3) * 0.035, (type === 'cirrus' ? 0.07 : 0.15) + (spriteIndex % 2) * 0.035, 1);
      group.add(sprite);
    });
  }
  return group;
};

const createEarthAxis = () => {
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.12, 0),
      new THREE.Vector3(0, 1.12, 0)
    ]),
    new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 })
  );
  axis.rotation.z = 23.4 * DEG_TO_RAD;
  return axis;
};

const createSunRaySprite = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 16, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 247, 180, 0.9)');
  gradient.addColorStop(0.35, 'rgba(251, 191, 36, 0.45)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.62,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 3.2, 1);
  return sprite;
};

const createStars = () => {
  const positions = [];
  for (let index = 0; index < 280; index += 1) {
    const azimuth = ((index * 137.5) % 360) * DEG_TO_RAD;
    const elevation = (((index * 83.7) % 100) - 25) * DEG_TO_RAD;
    const distance = 42 + (index % 11);
    positions.push(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance + 2,
      -Math.cos(azimuth) * Math.cos(elevation) * distance
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xbfd7ff,
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82
  });
  return new THREE.Points(geometry, material);
};

const createCrater = (radius, depth, x, z) => {
  const geometry = new THREE.CircleGeometry(radius, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x343b4c,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide
  });
  const crater = new THREE.Mesh(geometry, material);
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(x, 0.016 + depth, z);
  return crater;
};

const createTrajectory = (color) => {
  const material = new THREE.LineDashedMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    dashSize: 0.7,
    gapSize: 0.22,
    depthTest: false
  });
  const geometry = new THREE.BufferGeometry();
  const trajectory = new THREE.Line(geometry, material);
  trajectory.renderOrder = 20;
  return trajectory;
};

const createRelaySensor = () => {
  const sensor = new THREE.Group();
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0xff7a00,
    emissive: 0xff4d00,
    emissiveIntensity: 1.3,
    metalness: 0.25,
    roughness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.72, 12), beaconMaterial);
  beacon.position.y = 0.7;
  sensor.add(beacon);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 10), beaconMaterial);
  cap.scale.y = 0.45;
  cap.position.y = 1.08;
  sensor.add(cap);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.62, 0.14, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2
    })
  );
  base.position.y = 0.08;
  sensor.add(base);

  const beaconRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.035, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, depthTest: false })
  );
  beaconRing.rotation.x = Math.PI / 2;
  beaconRing.position.y = 0.28;
  beaconRing.renderOrder = 22;
  sensor.add(beaconRing);

  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.7, roughness: 0.3 })
  );
  antenna.position.set(0, 1.47, 0);
  sensor.add(antenna);

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xff7a00,
    transparent: true,
    opacity: 0.4,
    depthTest: false
  }));
  marker.scale.set(1.7, 1.7, 1);
  marker.position.y = 0.8;
  marker.renderOrder = 21;
  sensor.add(marker);

  return sensor;
};

const getOverlayOrbitPoint = (azimuth, radius) => {
  const angle = (azimuth - 90) * DEG_TO_RAD;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius
  };
};

const getOverlayTrailPath = (azimuth, radius, sweep = 72) => {
  const start = getOverlayOrbitPoint(azimuth - sweep, radius);
  const end = getOverlayOrbitPoint(azimuth, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
};

const createAzimuthGrid = () => {
  const group = new THREE.Group();
  const domeRadius = 28;
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    const points = [];
    for (let elevation = 0; elevation <= 75; elevation += 3) {
      points.push(celestialPosition(azimuth, elevation, domeRadius, 0));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.34 })
    );
    group.add(line);
  }
  for (let elevation = 0; elevation <= 75; elevation += 5) {
    const points = Array.from({ length: 73 }, (_, index) => (
      celestialPosition(index * 5, elevation, domeRadius, 0)
    ));
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.28 })
    ));
  }
  return group;
};

const createCraterRim = () => {
  const points = [];
  for (let index = 0; index <= 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    points.push(new THREE.Vector3(
      Math.cos(angle) * 9,
      1.65 + Math.sin(angle * 4) * 0.08,
      -11 + Math.sin(angle) * 2.8
    ));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.7 })
  );
};

const LunarScene3D = ({
  time,
  selectedSite,
  showSolarFlux,
  showDTELink,
  showGrid,
  showHorizonMask,
  cameraYaw,
  cameraPitch,
  showInterface
}) => {
  const [popup, setPopup] = useState(null);
  const [fps, setFps] = useState(0);
  const [azimuthHost, setAzimuthHost] = useState(null);
  const [isAzimuthVisible, setIsAzimuthVisible] = useState(true);
  const [isAzimuthFullscreen, setIsAzimuthFullscreen] = useState(false);
  const [azimuthScrollVisible, setAzimuthScrollVisible] = useState(false);
  const [azimuthScrollAt, setAzimuthScrollAt] = useState({ top: true, bottom: false });
  const azimuthScrollRef = useRef(null);
  const azimuthScrollTimerRef = useRef(null);
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const layersRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    setAzimuthHost(document.querySelector('.azimuth-layer'));
  }, []);

  useEffect(() => () => clearTimeout(azimuthScrollTimerRef.current), []);

  const updateAzimuthScroll = () => {
    const element = azimuthScrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollHeight - element.clientHeight;
    setAzimuthScrollAt({
      top: element.scrollTop <= 2,
      bottom: maxScroll <= 2 || element.scrollTop >= maxScroll - 2
    });
    setAzimuthScrollVisible(true);
    clearTimeout(azimuthScrollTimerRef.current);
    azimuthScrollTimerRef.current = setTimeout(() => setAzimuthScrollVisible(false), 900);
  };

  const nudgeAzimuthScroll = (direction) => {
    azimuthScrollRef.current?.scrollBy({ top: direction * 220, behavior: 'smooth' });
    updateAzimuthScroll();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.Fog(0x05070d, 28, 58);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
    camera.position.set(0, CAMERA_HEIGHT, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x64748b, 0x111827, 1.2));
    const moonLight = new THREE.DirectionalLight(0xf8fafc, 1.6);
    moonLight.position.set(-5, 12, 4);
    scene.add(moonLight);

    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x151c2d, roughness: 1 })
    );
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);

    const ridge = new THREE.Mesh(
      new THREE.ConeGeometry(9, 3.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x232c40, roughness: 1 })
    );
    ridge.position.set(0, 1.4, -11);
    scene.add(ridge);

    [
      [1.4, -0.02, -4.5, -4],
      [0.8, 0.01, 4.2, -7],
      [2.1, -0.01, -8.5, -14],
      [0.6, 0.02, 7.5, -16]
    ].forEach(([radius, depth, x, z]) => scene.add(createCrater(radius, depth, x, z)));

    const grid = new THREE.GridHelper(40, 16, 0x475569, 0x334155);
    grid.position.y = 0.025;
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    scene.add(grid);

    const horizonMask = new THREE.Mesh(
      new THREE.RingGeometry(14, 14.06, 96),
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
      })
    );
    horizonMask.rotation.x = -Math.PI / 2;
    horizonMask.position.y = 0.04;
    scene.add(horizonMask);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
    );
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x0c4a6e, emissiveIntensity: 0.45 })
    );
    const earthClouds = createCloudSprites();
    earth.add(earthClouds);
    earth.add(createEarthAxis());

    const sunRays = createSunRaySprite();
    sun.add(sunRays);
    earth.rotation.z = 23.4 * DEG_TO_RAD;
    scene.add(sun, earth);

    const lander = new THREE.Group();
    const landerBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.65, 1),
      new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0x9a3412,
        emissiveIntensity: 0.45,
        metalness: 0.35,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -2
      })
    );
    landerBody.position.y = 0.9;
    lander.add(landerBody);
    [-0.5, 0.5].forEach((x) => {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.5 })
      );
      leg.position.set(x, 0.45, 0);
      leg.rotation.z = x < 0 ? -0.28 : 0.28;
      lander.add(leg);
    });
    lander.position.set(0, getTerrainHeight(0, -8), -8);
    lander.scale.setScalar(1.35);
    scene.add(lander);
    const relaySensor = createRelaySensor();
    relaySensor.position.set(0, getTerrainHeight(0, -2.2), -2.2);
    relaySensor.scale.setScalar(1.15);
    scene.add(relaySensor);

    const stars = createStars();
    scene.add(stars);

    const solarTrajectory = createTrajectory(0xf59e0b);
    const earthTrajectory = createTrajectory(0x38bdf8);
    const craterRim = createCraterRim();
    const azimuthGrid = createAzimuthGrid();
    scene.add(solarTrajectory, earthTrajectory, craterRim, azimuthGrid);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    layersRef.current = {
      grid,
      horizonMask,
      sun,
      earth,
      solarTrajectory,
      earthTrajectory
      ,
      craterRim,
      azimuthGrid,
      earthClouds,
      sunRays,
      relaySensor
    };

    let frameCount = 0;
    let fpsWindowStart = performance.now();
    const render = () => {
      frameRef.current = requestAnimationFrame(render);
      frameCount += 1;
      const now = performance.now();
      if (now - fpsWindowStart >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - fpsWindowStart)));
        frameCount = 0;
        fpsWindowStart = now;
      }
      earth.rotation.y += 0.0008;

      if (!document.hidden) {
        sunRays.material.opacity = 0.48 + Math.sin(performance.now() * 0.0015) * 0.12;
        earthClouds.rotation.y += 0.0011;
      }
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.rotation.set(cameraPitch * DEG_TO_RAD, cameraYaw * DEG_TO_RAD, 0, 'YXZ');
  }, [cameraYaw, cameraPitch]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;

    layers.grid.visible = showGrid;
    layers.horizonMask.visible = showHorizonMask;

    const sunPosition = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
    const earthPosition = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
    layers.sun.position.copy(celestialPosition(sunPosition.azimuth, sunPosition.elevation, 18, 1.1));
    layers.earth.position.copy(celestialPosition(earthPosition.azimuth, earthPosition.elevation, 17, 1.1));
    layers.sun.visible = sunPosition.elevation >= 0;
    layers.earth.visible = earthPosition.elevation >= 0;

    const solarPoints = [];
    for (let offset = -6; offset <= 6; offset += 0.5) {
      const sample = calculateSunPosition(
        new Date(time.getTime() + offset * 60 * 60 * 1000),
        selectedSite.latitude,
        selectedSite.longitude
      );
      solarPoints.push(celestialPosition(sample.azimuth, Math.max(0.12, sample.elevation), 18, 1.1));
    }
    const earthPoints = [];
    for (let offset = -15; offset <= 15; offset += 1) {
      const sample = calculateEarthPosition(
        new Date(time.getTime() + offset * 24 * 60 * 60 * 1000),
        selectedSite.latitude,
        selectedSite.longitude
      );
      earthPoints.push(celestialPosition(sample.azimuth, Math.max(0.12, sample.elevation), 17, 1.1));
    }

    layers.solarTrajectory.visible = showSolarFlux;
    layers.earthTrajectory.visible = showDTELink;
    layers.solarTrajectory.geometry.setFromPoints(solarPoints);
    layers.earthTrajectory.geometry.setFromPoints(earthPoints);
    layers.solarTrajectory.computeLineDistances();
    layers.earthTrajectory.computeLineDistances();
    layers.craterRim.visible = showHorizonMask;
    layers.azimuthGrid.visible = showGrid;
  }, [
    time,
    selectedSite,
    showSolarFlux,
    showDTELink,
    showGrid,
    showHorizonMask
  ]);

  const sunPosition = calculateSunPosition(time, selectedSite.latitude, selectedSite.longitude);
  const earthPosition = calculateEarthPosition(time, selectedSite.latitude, selectedSite.longitude);
  const overlaySunPoint = getOverlayOrbitPoint(sunPosition.azimuth, 30);
  const overlayEarthPoint = getOverlayOrbitPoint(earthPosition.azimuth, 17);
  const overlaySunTrail = getOverlayTrailPath(sunPosition.azimuth, 30);
  const overlayEarthTrail = getOverlayTrailPath(earthPosition.azimuth, 17);
  const aerialLabels = useMemo(() => ([
    { key: 'north', label: 'N', azimuth: 0, elevation: 10, className: 'cardinal' },
    { key: 'east', label: 'E', azimuth: 90, elevation: 10, className: 'cardinal' },
    { key: 'south', label: 'S', azimuth: 180, elevation: 10, className: 'cardinal' },
    { key: 'west', label: 'W', azimuth: 270, elevation: 10, className: 'cardinal' },
    { key: 'site', label: selectedSite.name, azimuth: 180, elevation: 2, className: 'site' },
    { key: 'rim', label: 'Malapert rim · 2.4 km', azimuth: 180, elevation: 8, className: 'feature' },
    { key: 'sensor', label: 'Sensor · 0 m', azimuth: 180, elevation: 1, className: 'sensor' },
    { key: 'sun', label: `Sun · ${sunPosition.elevation.toFixed(1)}°`, azimuth: sunPosition.azimuth, elevation: Math.max(0, sunPosition.elevation), className: 'sun' },
    { key: 'earth', label: `Earth · ${earthPosition.elevation.toFixed(1)}°`, azimuth: earthPosition.azimuth, elevation: Math.max(0, earthPosition.elevation), className: 'earth' }
  ]), [selectedSite, sunPosition.azimuth, sunPosition.elevation, earthPosition.azimuth, earthPosition.elevation]);

  const openElementPopup = (key, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 15 * 16;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right + 8));
    const top = Math.max(8, Math.min(window.innerHeight - 130, rect.top));
    setPopup({ key, left, top });
  };

  return (
    <div ref={containerRef} className="lunar-scene-3d" aria-label="Interactive 3D lunar horizon">
      {showInterface && (
        <div className="camera-fps-readout" aria-live="polite">
          CAMERA FPS {fps || '--'}
        </div>
      )}
      {showInterface && azimuthHost && createPortal((
        <>
          {!isAzimuthVisible && (
            <button
              type="button"
              className="azimuth-map-launch"
              onClick={() => setIsAzimuthVisible(true)}
            >
              Azimuth Map
            </button>
          )}
          {isAzimuthVisible && (
            <div
              ref={azimuthScrollRef}
              className={`aerial-overlay-shell${isAzimuthFullscreen ? ' is-fullscreen' : ''}`}
              onScroll={isAzimuthFullscreen ? updateAzimuthScroll : undefined}
            >
              <div className="aerial-azimuth-overlay" aria-label="Aerial azimuth and elevation">
              {isAzimuthFullscreen && <h2 className="azimuth-overlay-heading">South Pole Map = Bird's Eye View</h2>}
              <div className="azimuth-mock-model" aria-label="Moon-centered azimuth model">
                <svg className="azimuth-mock-trajectories" viewBox="0 0 100 100" role="img" aria-label="Sun and Earth circular trajectories">
                  {showSolarFlux && (
                    <>
                      <circle className="azimuth-orbit-sun" cx="50" cy="50" r="30" />
                      <path className="azimuth-trail-sun" d={overlaySunTrail} />
                    </>
                  )}
                  {showDTELink && (
                    <>
                      <circle className="azimuth-orbit-earth" cx="50" cy="50" r="17" />
                      <path className="azimuth-trail-earth" d={overlayEarthTrail} />
                    </>
                  )}
                  <circle className="azimuth-moon" cx="50" cy="50" r="18" />
                  {showSolarFlux && <circle className="azimuth-point-sun" cx={overlaySunPoint.x} cy={overlaySunPoint.y} r="2.2" />}
                  {showDTELink && <circle className="azimuth-point-earth" cx={overlayEarthPoint.x} cy={overlayEarthPoint.y} r="2.4" />}
                </svg>
                <span className="azimuth-moon-label">MOON POV</span>
              </div>
              {aerialLabels.map((item) => {
                const left = Math.min(86, Math.max(14, 50 + Math.sin(item.azimuth * DEG_TO_RAD) * 42));
                const bottom = Math.min(84, Math.max(14, 8 + Math.min(item.elevation, 20) / 20 * 82));
                const interactive = ['sun', 'earth', 'sensor'].includes(item.key);
                return (
                  <button
                    type="button"
                    key={item.key}
                    className={`aerial-label ${item.className}`}
                    style={{ left: `${left}%`, bottom: `${bottom}%` }}
                    onClick={interactive ? (event) => openElementPopup(item.key, event) : undefined}
                    tabIndex={interactive ? 0 : -1}
                  >
                    {item.label}
                  </button>
                );
              })}
              </div>
              {isAzimuthFullscreen && (
                <div className={`azimuth-custom-scroll${azimuthScrollVisible ? ' is-visible' : ''}`} aria-label="Azimuth map scroll controls">
                  <button type="button" aria-label="Scroll azimuth map up" className={azimuthScrollAt.top ? 'is-end' : ''} onClick={() => nudgeAzimuthScroll(-1)}>▲</button>
                  <span aria-hidden="true" />
                  <button type="button" aria-label="Scroll azimuth map down" className={azimuthScrollAt.bottom ? 'is-end' : ''} onClick={() => nudgeAzimuthScroll(1)}>▼</button>
                </div>
              )}
              <div className="aerial-overlay-actions">
                <button type="button" aria-label="Toggle fullscreen azimuth map" onClick={() => setIsAzimuthFullscreen((value) => !value)}>
                  {isAzimuthFullscreen ? '↙' : '⛶'}
                </button>
                <button type="button" aria-label="Close azimuth map" onClick={() => { setIsAzimuthVisible(false); setIsAzimuthFullscreen(false); }}>
                  ×
                </button>
              </div>
            </div>
          )}
        </>
      ), azimuthHost)}
      <div className="dome-grid-metrics" aria-label="Dome azimuth and elevation metrics">
        <span>AZIMUTH 0° · 30° · 60° · 90° · 120° · 150° · 180° · 210° · 240° · 270° · 300° · 330°</span>
        <span>ELEVATION 0° · 5° · 10° · 15° · 20° · 30° · 45° · 60° · 75°</span>
      </div>
      <div className="topography-grid-scale" aria-label="Moon topography scale">
        <span>0 km</span><span>5 km</span><span>10 km</span>
      </div>
      {popup && azimuthHost && createPortal((
        <div className="scene-element-popup" role="dialog" aria-label={`${popup.key} details`} style={{ left: `${popup.left}px`, top: `${popup.top}px` }}>
          <strong>{popup.key === 'sun' ? 'Sun' : popup.key === 'earth' ? 'Earth' : 'Sensor'}</strong>
          <span>
            {popup.key === 'sun' && `Solar elevation ${sunPosition.elevation.toFixed(2)}° · azimuth ${sunPosition.azimuth.toFixed(1)}°`}
            {popup.key === 'earth' && `Earth elevation ${earthPosition.elevation.toFixed(2)}° · azimuth ${earthPosition.azimuth.toFixed(1)}°`}
            {popup.key === 'sensor' && 'Orange exposure sensor centered in the POV reference frame'}
          </span>
          <button type="button" className="popup-close-link" onClick={() => setPopup(null)}>Close</button>
        </div>
      ), azimuthHost)}
    </div>
  );
};

export default LunarScene3D;
