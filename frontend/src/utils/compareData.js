// Site comparison numbers come from the Stargazer API (backend/app/routers/compare.py).
// If the API cannot be reached within 1.5 s, a saved copy of the exact same response is used instead.
import snapshot from '../data/api_snapshot/compare_lunar_day_1.json';

const API_BASE = (import.meta.env.VITE_STARGAZER_API || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const COMPARE_URL = `${API_BASE}/api/v1/compare?lunar_day=1&horizon_model=lola_mask`;
const TIMEOUT_MS = 1500;

export const compareSnapshot = snapshot;

/** Resolves to { payload, source } where source is 'live' or 'snapshot'. Never rejects. */
export async function loadCompare() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(COMPARE_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.sites) || payload.sites.length === 0) throw new Error('Unexpected response shape');
    return { payload, source: 'live' };
  } catch {
    return { payload: snapshot, source: 'snapshot' };
  } finally {
    clearTimeout(timer);
  }
}
