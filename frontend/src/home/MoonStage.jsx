import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play } from 'lucide-react';
import landingSites from '../data/landingSites.json';
import { getEphemerisRange } from '../utils/ephemerisRuntime';
import { moonSurfaceCanvas } from '../game/planetTextures';
import { hashFor } from '../routes';
import { getMoonLighting, moonFixedFromLatLon } from './sunDirection';

const HOUR_MS = 3600000;
const PLAY_HOURS_PER_SECOND = 72;                      // three days of data a second: a lunar day passes in about ten seconds
const START_VIEW = { latitude: -66, longitude: 12 };   // looking up at the south pole, with the near side above it
const CAMERA_DISTANCE = 4.1;                           // in Moon radii
const CAMERA_FOV = 30;
// Share of the stage's height taken by the Moon's radius, used to make the surface follow the pointer.
const GLOBE_RADIUS_SHARE = 0.5 / (Math.sqrt(CAMERA_DISTANCE ** 2 - 1) * Math.tan((CAMERA_FOV / 2) * Math.PI / 180));
const LIMB = 1 / CAMERA_DISTANCE + 0.05;               // a surface point is in view when it faces the camera by more than this
const LABEL_ARC = 15;                                  // degrees from the pole to where a label sits

// The sites lie within 5° of the pole, so their labels fan out from it along these longitudes.
const MARKERS = [
  { id: 'south-pole', label: 'South Pole', latitude: -90, longitude: 0, fan: 280 },
  { id: 'malapert', label: 'Malapert Massif', fan: 335 },
  { id: 'mons-mouton', label: 'Mons Mouton', fan: 62 },
  { id: 'shackleton', label: 'Shackleton Rim', fan: 118 }
].map((marker) => {
  const site = landingSites.find((item) => item.id === marker.id);
  return site ? { ...marker, latitude: site.latitude, longitude: site.longitude, isSite: true } : marker;
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Moon-fixed axes (z = north pole) to the 3D scene's axes (y = north pole). The surface map has
// longitude 0° facing +x and east to the right, as on the real Moon.
const toScene = (vector, radius = 1) => new THREE.Vector3(vector.x * radius, vector.z * radius, -vector.y * radius);
const surfacePoint = (latitude, longitude, radius) => toScene(moonFixedFromLatLon(latitude, longitude), radius);

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatPlace = ({ latitude, longitude }) => (
  `${Math.abs(latitude).toFixed(1)}° ${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(1)}° ${longitude >= 0 ? 'E' : 'W'}`
);
function phaseName({ litFraction, waxing }) {
  if (litFraction < 0.02) return 'new Moon';
  if (litFraction > 0.98) return 'full Moon';
  return `${waxing ? 'waxing' : 'waning'} ${litFraction < 0.5 ? 'crescent' : 'gibbous'}`;
}

function MoonStage() {
  const range = useMemo(() => {
    const { start, end } = getEphemerisRange(landingSites[0].latitude, landingSites[0].longitude);
    return { startMs: start.getTime(), hours: Math.floor((end.getTime() - start.getTime()) / HOUR_MS), start, end };
  }, []);
  // Hours since the start of the data. Opens on today's date when that is inside the data range.
  const [hour, setHour] = useState(() => clamp(Math.round((Date.now() - range.startMs) / HOUR_MS), 0, range.hours));
  const [isPlaying, setIsPlaying] = useState(false);
  const hourRef = useRef(hour);
  const stageRef = useRef(null);
  const canvasHolderRef = useRef(null);
  const labelRefs = useRef({});
  const globeRef = useRef(null);          // { setSun, turn } once the 3D scene exists

  const lighting = useMemo(() => getMoonLighting(new Date(range.startMs + hour * HOUR_MS)), [hour, range]);
  const shownTime = new Date(range.startMs + Math.floor(hour) * HOUR_MS);
  const dateText = `${dateFormat.format(shownTime)} · ${shownTime.toISOString().slice(11, 16)} UTC`;

  const showHour = (next) => {
    hourRef.current = next;
    setHour(next);
  };

  // Build the globe once. It draws a frame only when something changed, so an idle page costs nothing.
  useEffect(() => {
    const stage = stageRef.current;
    const holder = canvasHolderRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      stage.classList.add('is-unavailable');      // shows the note below; the links still work without 3D
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    holder.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);
    let frame = 0;
    let lastFrameAt = 0;
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw);      // draw() is defined further down
    };

    // The Moon starts as a plain grey ball, already lit correctly, and gets its surface map
    // when the painter has finished. The map is painted in a worker so the page never freezes;
    // a browser that cannot do that paints a smaller map here instead.
    const moonMaterial = new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 1, metalness: 0 });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), moonMaterial));
    let surface = null;
    const showSurface = (image) => {
      surface = new THREE.CanvasTexture(image);
      surface.colorSpace = THREE.SRGBColorSpace;
      surface.anisotropy = 4;
      moonMaterial.map = surface;
      moonMaterial.bumpMap = surface;
      moonMaterial.bumpScale = 1.2;
      moonMaterial.color.set(0xffffff);
      moonMaterial.needsUpdate = true;
      stage.classList.add('is-ready');      // the stylesheet fades the Moon in once it has its surface
      invalidate();
    };
    let painter = null;
    try {
      painter = new Worker(new URL('./moonSurface.worker.js', import.meta.url), { type: 'module' });
      painter.onmessage = ({ data: bitmap }) => {
        const image = document.createElement('canvas');
        image.width = bitmap.width;
        image.height = bitmap.height;
        image.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        painter.terminate();
        showSurface(image);
      };
      painter.onerror = () => {
        painter.terminate();
        showSurface(moonSurfaceCanvas(512));
      };
      painter.postMessage(1024);
    } catch {
      showSurface(moonSurfaceCanvas(512));
    }
    // The night side is left almost black, with just enough fill to make out the globe's outline.
    scene.add(new THREE.AmbientLight(0xaebbd6, 0.07));
    const sunlight = new THREE.DirectionalLight(0xfff6e6, 3.1);
    scene.add(sunlight);

    // South-polar ring at 80° S, a dot for the pole and each site, and a tie line out to each label.
    const ring = [];
    for (let step = 0; step < 96; step += 1) ring.push(surfacePoint(-80, (step / 96) * 360, 1.004));
    scene.add(new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.38 })
    ));
    const dotGeometry = new THREE.SphereGeometry(0.012, 12, 8);
    const tieMaterial = new THREE.LineBasicMaterial({ color: 0xa9b8cc, transparent: true, opacity: 0.75 });
    const labels = MARKERS.map((marker) => {
      const dot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: marker.isSite ? 0x4cc9f0 : 0xffffff }));
      dot.position.copy(surfacePoint(marker.latitude, marker.longitude, 1.004));
      scene.add(dot);
      const anchor = surfacePoint(-90 + LABEL_ARC, marker.fan, 1.03);
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([surfacePoint(marker.latitude, marker.longitude, 1.008), anchor]),
        tieMaterial
      ));
      return { id: marker.id, anchor, polar: true };
    });
    const sunLabel = { id: 'sun', anchor: new THREE.Vector3(1, 0, 0), polar: false };
    labels.push(sunLabel);
    const pole = surfacePoint(-90, 0, 1);

    const view = { ...START_VIEW };
    const target = { ...START_VIEW };
    const projected = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const toScreen = (point, width, height) => {
      projected.copy(point).project(camera);
      return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height };
    };

    // Labels are ordinary HTML laid over the canvas, so they stay sharp and can be links.
    const placeLabels = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const cameraDirection = facing.copy(camera.position).normalize().clone();
      const poleScreen = toScreen(pole, width, height);
      const boxes = [];
      for (const label of labels) {
        const element = labelRefs.current[label.id];
        if (!element) continue;
        const inView = facing.copy(label.anchor).normalize().dot(cameraDirection) > LIMB;
        element.style.visibility = inView ? 'visible' : 'hidden';
        if (!inView) continue;
        const at = toScreen(label.anchor, width, height);
        if (label.id === 'sun') {
          const dot = labelRefs.current.sunDot;
          if (dot) dot.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
        }
        // Polar labels read away from the pole: text to the left of a tie line that ends left of it.
        // The Sun's label reads toward the middle of the stage, so it never runs off the page.
        const lean = clamp(((label.polar ? at.x - poleScreen.x : width / 2 - at.x)) / 24, -1, 1);
        label.width ??= element.offsetWidth;
        const left = at.x + ((lean - 1) / 2) * label.width + lean * (label.polar ? 3 : 11);
        boxes.push({ element, left, right: left + label.width, y: at.y });
      }
      // Keep stacked labels from covering each other.
      boxes.sort((first, second) => first.y - second.y);
      boxes.forEach((box, index) => {
        for (let above = 0; above < index; above += 1) {
          const other = boxes[above];
          if (box.left < other.right + 4 && other.left < box.right + 4 && box.y - other.y < 24) box.y = other.y + 24;
        }
        box.element.style.transform = `translate(${box.left}px, ${box.y}px) translateY(-50%)`;
      });
      const sunDot = labelRefs.current.sunDot;
      if (sunDot) sunDot.style.visibility = labelRefs.current.sun?.style.visibility || 'hidden';
    };

    function draw(now) {
      frame = 0;
      // The view eases toward where it was dragged, which keeps the turn slow and smooth.
      const ease = 1 - Math.exp(-(lastFrameAt ? Math.min(now - lastFrameAt, 100) : 16) / 90);
      lastFrameAt = now;
      view.latitude += (target.latitude - view.latitude) * ease;
      view.longitude += (target.longitude - view.longitude) * ease;
      camera.position.copy(surfacePoint(view.latitude, view.longitude, CAMERA_DISTANCE));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      placeLabels();
      if (Math.abs(target.latitude - view.latitude) > 0.02 || Math.abs(target.longitude - view.longitude) > 0.02) invalidate();
      else lastFrameAt = 0;
    }

    const turn = (longitudeDegrees, latitudeDegrees) => {
      target.longitude += longitudeDegrees;
      target.latitude = clamp(target.latitude + latitudeDegrees, -85, 85);
      invalidate();
    };
    let dragFrom = null;
    const onPointerDown = (event) => {
      dragFrom = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onPointerMove = (event) => {
      if (!dragFrom) return;
      const degreesPerPixel = 180 / (Math.PI * GLOBE_RADIUS_SHARE * stage.clientHeight);
      turn(-(event.clientX - dragFrom.x) * degreesPerPixel, (event.clientY - dragFrom.y) * degreesPerPixel);
      dragFrom = { x: event.clientX, y: event.clientY };
    };
    const endDrag = () => {
      dragFrom = null;
      canvas.style.cursor = 'grab';
    };
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const resize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      labels.forEach((label) => { label.width = undefined; });
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    globeRef.current = {
      turn,
      setSun(sunVector) {
        sunlight.position.copy(toScene(sunVector, 10));      // the light shines from here toward the Moon's centre
        sunLabel.anchor.copy(toScene(sunVector, 1.01));
        invalidate();
      }
    };

    return () => {
      globeRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      scene.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      painter?.terminate();
      surface?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  // Point the light along the Sun's Moon-fixed direction for the shown date.
  useEffect(() => {
    globeRef.current?.setSun(lighting.sunVector);
  }, [lighting]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let frame = 0;
    let lastAt = performance.now();
    const tick = (now) => {
      const next = Math.min(hourRef.current + (Math.min(now - lastAt, 100) / 1000) * PLAY_HOURS_PER_SECOND, range.hours);
      lastAt = now;
      hourRef.current = next;
      setHour(next);
      if (next >= range.hours) {
        setIsPlaying(false);      // hold the last date
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, range]);

  const togglePlay = () => {
    if (!isPlaying && hour >= range.hours) showHour(0);      // play again from the start
    setIsPlaying((playing) => !playing);
  };
  const onGlobeKey = (event) => {
    const turns = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[event.key];
    if (!turns) return;
    event.preventDefault();
    globeRef.current?.turn(turns[0], turns[1]);
  };
  const setLabel = (id) => (element) => { labelRefs.current[id] = element; };

  return (
    <section className="moon-stage" aria-label="The Moon, lit as on the chosen date">
      <div className="moon-globe" ref={stageRef}>
        <div
          className="moon-globe-canvas"
          ref={canvasHolderRef}
          tabIndex={0}
          role="img"
          aria-label="3D Moon showing the sunlit side, the south pole and three landing sites. Drag, or use the arrow keys, to turn it."
          onKeyDown={onGlobeKey}
        />
        <p className="moon-globe-missing">This browser could not start the 3D view. The links on this page still work.</p>
        <div className="moon-labels">
          {MARKERS.map((marker) => (marker.isSite ? (
            <a
              className="moon-label is-site"
              key={marker.id}
              ref={setLabel(marker.id)}
              href={hashFor('explore', marker.id)}
              title={`Open ${marker.label} in the 3D explorer`}
            >
              {marker.label}
            </a>
          ) : (
            <span className="moon-label" key={marker.id} ref={setLabel(marker.id)}>{marker.label}</span>
          )))}
          <span className="moon-sun-dot" ref={setLabel('sunDot')} aria-hidden="true" />
          <span className="moon-label is-sun" ref={setLabel('sun')}>Sun overhead</span>
        </div>
        <span className="moon-drag-hint" aria-hidden="true">Drag to turn</span>
      </div>

      <div className="moon-hud">
        <button
          type="button"
          className="moon-date-play"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play through the dates'}
          title={isPlaying ? 'Pause' : 'Play through the dates'}
        >
          {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <div className="moon-date-track">
          <strong>{dateText}</strong>
          <input
            type="range"
            min="0"
            max={range.hours}
            step="1"
            value={Math.round(hour)}
            style={{ '--fill': `${(hour / range.hours) * 100}%` }}
            onChange={(event) => showHour(Number(event.target.value))}
            aria-label="Date"
            aria-valuetext={dateText}
          />
          <span className="moon-date-ends">
            <span>{dateFormat.format(range.start)}</span>
            <span>{dateFormat.format(range.end)}</span>
          </span>
        </div>

        <dl className="moon-readouts">
          <div>
            <dt>Sun overhead at</dt>
            <dd className="is-sun">{formatPlace(lighting.subSolar)}</dd>
          </div>
          <div>
            <dt>Seen from Earth</dt>
            <dd>{Math.round(lighting.litFraction * 100)}% lit · {phaseName(lighting)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export default MoonStage;
