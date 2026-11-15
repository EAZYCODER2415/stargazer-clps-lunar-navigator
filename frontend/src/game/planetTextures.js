// Painted surfaces for the mission scenes. The project ships no image files, so Earth,
// the Moon and the lunar ground are drawn once on a canvas and cached.
// They are illustrative: Earth uses hand-simplified coastlines, not survey data.

function latticeValue(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, z) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const fx = x - xi; const fy = y - yi; const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx); const v = fy * fy * (3 - 2 * fy); const w = fz * fz * (3 - 2 * fz);
  const mix = (a, b, t) => a + (b - a) * t;
  const x00 = mix(latticeValue(xi, yi, zi), latticeValue(xi + 1, yi, zi), u);
  const x10 = mix(latticeValue(xi, yi + 1, zi), latticeValue(xi + 1, yi + 1, zi), u);
  const x01 = mix(latticeValue(xi, yi, zi + 1), latticeValue(xi + 1, yi, zi + 1), u);
  const x11 = mix(latticeValue(xi, yi + 1, zi + 1), latticeValue(xi + 1, yi + 1, zi + 1), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w);
}

/** Repeatable noise in 0–1, built from several layers of finer detail. */
export function layeredNoise(x, y, z, octaves) {
  let total = 0; let amplitude = 0.5; let scale = 1; let weight = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += smoothNoise(x * scale, y * scale, z * scale) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    scale *= 2.03;
  }
  return total / weight;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (from, to, value) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };
const bell = (value, centre, width) => Math.exp(-(((value - centre) / width) ** 2));
const blend = (from, to, amount) => {
  const t = clamp01(amount);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
};

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

// Paints a longitude/latitude map (west edge at −180°). `shade` gets degrees plus the
// matching point on the unit sphere, so noise has no seam and does not pinch at the poles.
function paintMap(width, shade) {
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const latitude = 90 - ((row + 0.5) / height) * 180;
    const ring = Math.cos(latitude * Math.PI / 180);
    const y = Math.sin(latitude * Math.PI / 180);
    for (let column = 0; column < width; column += 1) {
      const longitude = ((column + 0.5) / width) * 360 - 180;
      const angle = longitude * Math.PI / 180;
      const colour = shade(longitude, latitude, Math.cos(angle) * ring, y, Math.sin(angle) * ring, column, row);
      const offset = (row * width + column) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = colour[3] === undefined ? 255 : colour[3];
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

// Simplified coastlines as [latitude, longitude] loops.
const LAND = [
  // Africa
  [[35.8, -5.9], [37.2, 10], [33, 11.5], [30.5, 19.5], [32.8, 22], [31.2, 29.5], [31.3, 32.3], [27, 34], [22, 37], [15.5, 39.5], [12, 43.3], [11.8, 51.2], [5, 48.5], [-1.5, 41.5], [-6.5, 39.4], [-10.5, 40.4], [-15.5, 40.6], [-20, 35], [-25.5, 33], [-29.5, 31.2], [-34, 26], [-34.5, 20], [-33.5, 18], [-29, 16.7], [-22, 14.3], [-17, 11.8], [-12, 13.7], [-6, 12.3], [-1, 9], [4, 9.5], [4.3, 6], [6.3, 3.5], [5, -2], [5, -7.5], [7.5, -12.8], [11, -15.3], [14.7, -17.4], [21, -17], [27.5, -13.3], [32.5, -9.3]],
  // Europe and Asia
  [[36.1, -5.6], [37, -9], [43.3, -9.2], [43.5, -1.8], [46.3, -1.3], [48.4, -4.7], [49.7, -1.3], [51, 2], [53.5, 5.5], [53.8, 8.8], [57.5, 9.5], [58, 7], [62, 5], [65, 11.5], [69.5, 18], [71, 25.5], [70, 31], [67, 41], [68.5, 44], [68.2, 53.5], [69, 60.5], [73, 70], [73.3, 80.5], [76, 98], [77.6, 104], [74, 112], [73, 127], [71, 140], [72, 150], [69.8, 160], [69.6, 170.5], [66.2, 179.5], [64.5, 178], [62.2, 179.3], [60, 170], [59.9, 163.5], [56, 162.8], [51.2, 156.7], [57, 156.6], [61.8, 163], [59.5, 155], [59.3, 152], [59.4, 143], [56.5, 138.3], [54.5, 135.5], [53.2, 140.8], [49, 140.3], [45, 136.8], [42.9, 132.5], [39.8, 127.6], [38, 128.8], [35.2, 129.3], [34.4, 126.5], [37.7, 126.2], [39.8, 124.3], [40.8, 121.5], [39, 117.8], [37.4, 119], [37, 122.4], [35, 119.3], [31.8, 121.8], [28, 121.5], [24.5, 118.2], [22.5, 114.5], [21.5, 109.5], [21.6, 107.8], [18.5, 105.8], [16, 108.3], [12.5, 109.4], [10.4, 107.2], [8.6, 104.8], [10.2, 104.6], [12.6, 101], [13.4, 100.3], [9.5, 99.2], [6.9, 101.7], [3, 103.4], [1.3, 103.8], [2.8, 101.3], [6.4, 100.1], [8.5, 98.3], [13, 98.5], [16.5, 97.4], [15.9, 94.3], [19.8, 93.2], [22.5, 91.5], [21.7, 87.5], [19.8, 86], [16, 81.2], [13, 80.3], [10.3, 79.8], [8.1, 77.5], [11.5, 75.5], [15.5, 73.8], [19, 72.8], [21, 72.6], [20.9, 70.3], [22.8, 68.7], [24.8, 67], [25.3, 61.5], [26.6, 57], [27.1, 56.3], [30, 50.2], [29.4, 48], [27, 49.8], [24, 51.8], [24.2, 54], [26, 56.3], [23.6, 58.6], [22.5, 59.8], [20, 57.8], [17, 55], [15.2, 51.5], [12.8, 45], [12.7, 43.5], [16.5, 42.7], [21.3, 39.1], [25, 37.2], [28, 34.7], [29.5, 35], [31.2, 34.3], [33.5, 35.4], [36.8, 36.1], [36.2, 32.5], [36.8, 30.6], [36.7, 28], [38.5, 26.4], [40.4, 26.2], [41.1, 29], [40.9, 26], [40.6, 23], [38, 24], [36.5, 22.8], [38.3, 21], [40.5, 19.4], [42.5, 18.5], [45.3, 13.8], [45.6, 12.3], [44, 12.6], [42, 14.6], [41.9, 16], [40.1, 18.4], [39.8, 16.5], [38, 15.7], [38.9, 16], [40.8, 14.1], [42.4, 11.2], [44.2, 9], [43.5, 7], [43.2, 4.5], [42.3, 3.2], [41.3, 2.2], [39.5, -0.3], [37.5, -1.5], [36.7, -4.5]],
  // North and Central America
  [[71.3, -156.5], [70, -141], [69.5, -133], [70, -128], [68.5, -114], [68, -108], [68.2, -97], [69.5, -93], [69, -82], [66, -84], [64, -80], [62.5, -78], [62.4, -72], [60.4, -64.8], [58.5, -62.5], [55, -59.5], [53.5, -56], [50.2, -60], [50.2, -66], [47, -64.5], [45.5, -61], [43.6, -65.7], [43.6, -70.2], [42, -70.3], [41.3, -72.5], [40.5, -74], [38.9, -74.9], [37, -76], [35.2, -75.6], [34, -78], [32, -81], [30.3, -81.4], [27, -80.1], [25.2, -80.4], [25.9, -81.7], [28, -82.8], [29.9, -84], [30.3, -87.5], [29.2, -89.5], [29.7, -93.5], [28.5, -96.5], [25.9, -97.2], [22.3, -97.8], [19.2, -96.1], [18.3, -94.5], [18.7, -91.5], [21, -90.3], [21.5, -87], [18.5, -87.8], [15.9, -88.8], [15.8, -84], [15, -83.2], [11, -83.7], [9.3, -82.3], [9.5, -79.5], [8.9, -77.5], [7.3, -77.9], [7.3, -80.4], [8.3, -82.9], [9.9, -85.7], [11.1, -85.8], [13, -87.7], [13.6, -90.5], [14.5, -92.3], [16.1, -94.5], [15.7, -96.5], [17, -100.5], [19.3, -105], [21.2, -105.3], [23.2, -106.4], [25.6, -109.1], [27.9, -110.9], [31.3, -113.5], [32.5, -117.1], [34.4, -120.5], [36.6, -121.9], [38, -123], [40.4, -124.4], [43, -124.4], [46.2, -124], [48.4, -124.7], [51, -127.8], [54.2, -130.3], [58.3, -136.5], [59.7, -140], [60.2, -146], [59, -153.5], [57.5, -156.3], [55.2, -162.2], [56.5, -160], [58.7, -157.5], [58.7, -161.8], [60.5, -165.3], [63, -164.3], [64.6, -166.3], [65.6, -168], [66.5, -163.8], [68.3, -166.5], [70.8, -159.5]],
  // South America
  [[12, -72], [10.5, -62], [6, -57], [4, -51.5], [0, -50], [-5, -35], [-8, -35], [-13, -38.5], [-23, -42], [-25, -48], [-34, -53.5], [-38, -57.5], [-41, -65], [-47, -66], [-52, -68.5], [-55, -67], [-53, -74], [-46, -75], [-37, -73.5], [-30, -71.5], [-18, -70.5], [-14, -76], [-6, -81], [-1, -80.5], [1, -79], [7, -77.5], [9, -76], [11, -74.5]],
  // Australia
  [[-11, 142.5], [-17, 146], [-24, 153], [-28, 153.5], [-37.5, 150], [-39, 146.5], [-38, 141], [-35, 137], [-32, 134], [-31.5, 129], [-34, 124], [-35, 117.5], [-32, 115.5], [-22, 114], [-20, 119], [-17, 122.5], [-14, 127], [-12, 131], [-12, 136.5], [-15, 136], [-17.5, 140]],
  // Greenland (drawn as ice)
  [[60, -44], [65, -52], [70, -54], [76, -68], [78, -72], [81.5, -60], [83.5, -35], [81, -15], [76, -19], [70, -22], [66, -36]],
  // Islands
  [[-12, 49.5], [-16, 50.5], [-25, 47], [-25.5, 44], [-20, 43.5], [-16, 44.5]],
  [[45.5, 142], [43, 145.5], [41.5, 140.5], [36, 141], [34.5, 137], [33.5, 135.5], [31, 131], [33.5, 129.5], [35.5, 133], [37.5, 137], [40.5, 140]],
  [[58.5, -5], [57.5, -2], [55, -1.5], [53, 0.3], [51.2, 1.4], [50.2, -5.5], [51.8, -5], [53.3, -4.5], [55, -5.2], [57.5, -6.5]],
  [[55.3, -7.3], [54, -6], [52.2, -6.4], [51.5, -9.8], [54.2, -10]],
  [[5.5, 95.5], [3, 99], [-3, 106], [-6, 105.5], [-2, 100.5]],
  [[7, 117], [1, 118.5], [-4, 115], [-3, 110.5], [1.5, 109.5], [5, 115]],
  [[-0.5, 131], [-2.5, 141], [-6, 147.5], [-10, 149.5], [-8, 143], [-8.5, 138], [-4, 133]],
  [[-6, 106], [-7, 112], [-8.5, 114.5], [-7.7, 107]],
  [[1.5, 125], [0.5, 120], [-3, 119.2], [-5.5, 120], [-4, 122.8], [-1, 121.5]],
  [[18.5, 121], [14, 124], [7, 126], [6.5, 122.5], [13, 120.5]],
  [[-34.5, 173], [-37.5, 178.5], [-41.5, 175], [-46.5, 169], [-45.5, 166.5], [-40.5, 172.5]],
  [[66.3, -16], [64.5, -14], [63.5, -19], [64.5, -23.5], [66, -22.5]],
  [[73.7, -80], [71.5, -71.5], [67, -62], [62.5, -66], [64.5, -74], [68.5, -76], [70.5, -85]],
  [[73, -118], [73, -105], [69, -102], [68.5, -113], [70.5, -117.5]],
  [[83, -70], [82, -62], [78, -75], [76.5, -80], [77, -88], [81, -92]],
  [[23, -84], [23, -80.5], [20.3, -74.5], [19.9, -77.5], [22, -84.3]],
  [[19.9, -72.5], [19.6, -68.6], [18.2, -68.8], [18.2, -74.3]],
  [[9.8, 80], [8, 81.8], [6, 80.7], [8, 79.7]],
  [[51.5, 143.2], [54.3, 142.8], [49, 144], [46, 143.3], [46.5, 141.9]],
  [[25.2, 121.6], [22, 120.8], [23.5, 120.1]],
];
const GREENLAND = 5;
// Seas enclosed by the outlines above.
const WATER = [
  [[41.2, 29.5], [42, 33.5], [41.1, 37.5], [41.5, 41.4], [43.2, 40], [45.1, 36.8], [46.4, 31.5], [44.5, 28.8], [42.5, 27.8]],
  [[47, 49], [45, 52.5], [42, 52.5], [37, 54], [36.7, 51], [38.5, 49], [41.5, 49.5], [44.5, 47.5]],
  [[54.3, 11], [54.5, 19], [57, 21], [59.5, 23.5], [60, 28.5], [60.5, 21.5], [63, 21], [65.7, 24.5], [65.6, 22], [62.5, 17.5], [59, 18.5], [56, 16], [55.4, 13]],
  [[63.5, -91], [58.8, -94.3], [57, -92.5], [55.2, -85], [55.2, -82.2], [51.5, -80.5], [52, -79], [56.5, -76.5], [59, -78], [62.5, -78], [64, -81], [64.5, -88]],
];

const withBounds = (points) => ({
  points,
  minLat: Math.min(...points.map((p) => p[0])), maxLat: Math.max(...points.map((p) => p[0])),
  minLon: Math.min(...points.map((p) => p[1])), maxLon: Math.max(...points.map((p) => p[1])),
});
const LAND_SHAPES = LAND.map(withBounds);
const WATER_SHAPES = WATER.map(withBounds);

function inside(shape, latitude, longitude) {
  if (latitude < shape.minLat || latitude > shape.maxLat || longitude < shape.minLon || longitude > shape.maxLon) return false;
  const points = shape.points;
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [latA, lonA] = points[i];
    const [latB, lonB] = points[j];
    if ((latA > latitude) !== (latB > latitude) && longitude < ((lonB - lonA) * (latitude - latA)) / (latB - latA) + lonA) hit = !hit;
  }
  return hit;
}

// 0 = sea, 1 = land, 2 = ice sheet.
function surfaceKind(latitude, longitude) {
  const southCoast = -68 - 7 * bell(longitude, -40, 22) - 9 * (bell(longitude, 180, 22) + bell(longitude, -168, 22)) + 4.5 * bell(longitude, -62, 6);
  if (latitude < southCoast) return 2;
  for (const sea of WATER_SHAPES) if (inside(sea, latitude, longitude)) return 0;
  for (let i = 0; i < LAND_SHAPES.length; i += 1) if (inside(LAND_SHAPES[i], latitude, longitude)) return i === GREENLAND ? 2 : 1;
  return 0;
}

export function earthSurfaceCanvas(width = 512) {
  return cached(`earth-${width}`, () => {
    const height = width / 2;
    const kinds = new Uint8Array(width * height);
    // First pass: land or sea, with the coastline nudged by noise so it is not polygonal.
    paintMap(width, (longitude, latitude, x, y, z, column, row) => {
      const wobbleLon = (layeredNoise(x * 7 + 3, y * 7 + 3, z * 7 + 3, 3) - 0.5) * 4.4;
      const wobbleLat = (layeredNoise(x * 7 + 31, y * 7 + 31, z * 7 + 31, 3) - 0.5) * 3.6;
      kinds[row * width + column] = surfaceKind(latitude + wobbleLat, longitude + wobbleLon);
      return [0, 0, 0];
    });
    const nearLand = (column, row) => {
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const r = row + dy;
        if (r < 0 || r >= height) continue;
        if (kinds[r * width + ((column + dx + width) % width)]) return true;
      }
      return false;
    };
    return paintMap(width, (longitude, latitude, x, y, z, column, row) => {
      const kind = kinds[row * width + column];
      const distance = Math.abs(latitude);
      const detail = layeredNoise(x * 6 + 9, y * 6 + 9, z * 6 + 9, 4);
      if (kind === 0) {
        let sea = blend([8, 36, 88], [16, 66, 132], detail * 1.2 - 0.1 + bell(distance, 8, 22) * 0.35);
        if (nearLand(column, row)) sea = blend(sea, [40, 124, 172], 0.45);
        return blend(sea, [214, 228, 238], smooth(77, 82, latitude + (detail - 0.5) * 8));
      }
      if (kind === 2) return blend([232, 238, 244], [205, 218, 232], detail);
      // Dry belts sit near 24 degrees north and south; wetter and drier regions fade in softly.
      const patch = layeredNoise(x * 3 + 70, y * 3 + 70, z * 3 + 70, 3) - 0.5;
      const zone = (west, east, south, north) => smooth(west - 7, west + 7, longitude) * smooth(east + 7, east - 7, longitude) * smooth(south - 5, south + 5, latitude) * smooth(north + 5, north - 5, latitude);
      let dry = bell(distance + patch * 9, 24, 9);
      dry *= 1 - 0.78 * zone(68, 125, 5, 32);
      dry *= 1 - 0.7 * zone(-100, -74, 8, 36);
      dry *= 1 - 0.7 * zone(-62, -38, -32, -12);
      dry *= 1 - 0.6 * zone(143, 156, -40, -10);
      dry *= 1 - 0.5 * zone(28, 42, -28, -8);
      dry = Math.max(dry, 0.82 * bell(latitude, 42, 7) * zone(48, 110, 34, 50));
      dry += patch * 0.5 + (detail - 0.5) * 0.3;
      let colour = blend([34, 92, 50], blend([82, 124, 60], [42, 82, 56], smooth(44, 58, distance)), smooth(8, 22, distance + patch * 10));
      colour = blend(colour, [198, 170, 112], smooth(0.34, 0.7, dry));
      if (layeredNoise(x * 11 + 50, y * 11 + 50, z * 11 + 50, 3) > 0.66) colour = blend(colour, [118, 102, 84], 0.45);
      colour = blend(colour, [128, 124, 104], smooth(60, 67, distance));
      return blend(colour, [234, 240, 246], smooth(69, 74, distance + (detail - 0.5) * 7));
    });
  });
}

/** A smooth, invented patch of ocean and land for close views, where coastlines drawn from the map above would look blocky. */
export function earthSoftCanvas(width = 512) {
  return cached(`earth-soft-${width}`, () => paintMap(width, (longitude, latitude, x, y, z) => {
    const land = layeredNoise(x * 4.2 + 11, y * 4.2 + 3, z * 4.2 + 7, 5);
    const dry = layeredNoise(x * 7 + 40, y * 7 + 40, z * 7 + 40, 3);
    let colour = blend([8, 38, 92], [30, 112, 172], smooth(0.4, 0.52, land));
    colour = blend(colour, blend([40, 104, 56], [176, 152, 98], smooth(0.4, 0.65, dry)), smooth(0.52, 0.56, land));
    return blend(colour, [112, 100, 86], smooth(0.66, 0.74, land));
  }));
}

export function earthCloudCanvas(width = 512) {
  return cached(`clouds-${width}`, () => paintMap(width, (longitude, latitude, x, y, z) => {
    const swirl = layeredNoise(x * 2.6 + 90 + y * 0.8, y * 4.4 + 90, z * 2.6 + 90, 5);
    const band = 0.03 * (bell(Math.abs(latitude), 52, 14) + bell(latitude, 4, 8));
    return [255, 255, 255, clamp01((swirl + band - 0.55) / 0.14) * 225];
  }));
}

export function moonSurfaceCanvas(width = 512) {
  return cached(`moon-${width}`, () => {
    // Craters are placed on the sphere itself so they stay round everywhere.
    let seed = 97;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const craters = [];
    for (let i = 0; i < 70; i += 1) {
      const height = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - height * height);
      craters.push([Math.cos(angle) * ring, height, Math.sin(angle) * ring, 0.03 + random() * random() * 0.16]);
    }
    return paintMap(width, (longitude, latitude, x, y, z) => {
      const grain = layeredNoise(x * 9 + 5, y * 9 + 5, z * 9 + 5, 4);
      const seas = layeredNoise(x * 1.5 + 60, y * 1.5 + 60, z * 1.5 + 60, 4);
      let shade = 152 + (grain - 0.5) * 60;
      shade -= clamp01((0.47 - seas) / 0.07) * 55;
      for (const crater of craters) {
        const distance = Math.acos(Math.max(-1, Math.min(1, x * crater[0] + y * crater[1] + z * crater[2]))) / crater[3];
        if (distance < 1) shade -= 26 * (1 - distance * distance);
        else if (distance < 1.25) shade += 30 * (1 - (distance - 1) / 0.25);
      }
      const value = Math.max(30, Math.min(235, shade));
      return [value, value * 0.985, value * 0.96];
    });
  });
}

/** Fine regolith grain; per-pixel noise tiles without a visible seam. */
export function grainCanvas(size = 256) {
  return cached(`grain-${size}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    let seed = 2026;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < size * size; i += 1) {
      const speck = random() < 0.02 ? -70 : random() < 0.02 ? 40 : 0;
      const value = Math.max(40, Math.min(255, 190 + (random() - 0.5) * 70 + speck));
      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  });
}
