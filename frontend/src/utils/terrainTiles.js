// Loads a site's LOLA height tiles (written by lola_terrain.py) for the 3D view.
// The small .json describes the tiles; the .bin holds the heights and is fetched only for the site in view.
import malapertMeta from '../data/terrain/malapert.json';
import monsMoutonMeta from '../data/terrain/mons-mouton.json';
import shackletonMeta from '../data/terrain/shackleton.json';

const TILES = {
  malapert: { meta: malapertMeta, url: new URL('../data/terrain/malapert.bin', import.meta.url).href },
  'mons-mouton': { meta: monsMoutonMeta, url: new URL('../data/terrain/mons-mouton.bin', import.meta.url).href },
  shackleton: { meta: shackletonMeta, url: new URL('../data/terrain/shackleton.bin', import.meta.url).href }
};
const cache = new Map();

/** Resolves to { meta, raw } where raw is an Int16Array of every level's heights, or rejects if the site has no tiles. */
export const loadTerrainTiles = (siteId) => {
  const tile = TILES[siteId];
  if (!tile) return Promise.reject(new Error(`No terrain tiles for site "${siteId}"`));
  if (!cache.has(siteId)) {
    const request = fetch(tile.url)
      .then((response) => {
        if (!response.ok) throw new Error(`Terrain tile for ${siteId} failed to load (${response.status})`);
        return response.arrayBuffer();
      })
      .then((buffer) => ({ meta: tile.meta, raw: new Int16Array(buffer) }));
    request.catch(() => cache.delete(siteId));     // allow a retry after a failed download
    cache.set(siteId, request);
  }
  return cache.get(siteId);
};
