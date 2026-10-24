const DEFAULT_REMOTE = 'https://houdini-bet.dev';

/**
 * Prefer production Worker unless HOUDINI_LOCAL=1 (MySQL local).
 * Override with API_BASE_URL when set.
 */
function resolveApiBase() {
  if (process.env.HOUDINI_LOCAL === '1') return '';
  const fromEnv = process.env.API_BASE_URL;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return String(fromEnv).replace(/\/$/, '');
  }
  return DEFAULT_REMOTE;
}

const API_BASE = resolveApiBase();
const FETCH_TIMEOUT_MS = 90000;

function isRemote() {
  return Boolean(API_BASE);
}

async function remoteJson(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `La API tardó más de ${FETCH_TIMEOUT_MS / 1000}s (${path}). Prueba Sync o vuelve a intentar.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { API_BASE, isRemote, remoteJson, DEFAULT_REMOTE };
