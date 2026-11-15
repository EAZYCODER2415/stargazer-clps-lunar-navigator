// Paints the Moon's surface map away from the page, so the home page stays responsive while
// it is drawn (about a second of work at this size). Reuses the game's painter unchanged.
import { moonSurfaceCanvas } from '../game/planetTextures.js';

// The painter asks the page for a canvas. A worker has no page, so give it an off-screen one.
self.document = { createElement: () => new OffscreenCanvas(1, 1) };

self.onmessage = ({ data: width }) => {
  const bitmap = moonSurfaceCanvas(width).transferToImageBitmap();
  self.postMessage(bitmap, [bitmap]);
};
