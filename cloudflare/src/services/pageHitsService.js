/**
 * First-party page hit log (beacon → D1). Admin-only read. Retention 30 days UTC.
 */

const RETENTION_DAYS = 30;
const DEDUPE_WINDOW_MS = 60 * 1000;
const UA_MAX = 180;
const PATH_MAX = 240;
const SKIP_PATH_RE = /\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|webmanifest)$/i;

function nowIso() {
  return new Date().toISOString();
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function truncate(s, max) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

export function normalizeHitPath(raw) {
  let p = String(raw || '/').trim() || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = truncate(p, PATH_MAX);
  const bare = p.split('?')[0].split('#')[0] || '/';
  if (bare === '/sw.js' || bare === '/favicon.ico' || SKIP_PATH_RE.test(bare)) {
    return null;
  }
  return p;
}

export function referrerHostOf(raw) {
  try {
    if (!raw) return '';
    const u = new URL(String(raw));
    return truncate(u.host, 120);
  } catch {
    return '';
  }
}

export async function purgeOlderThan(db, { days = RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  await db.run(`DELETE FROM page_hits WHERE created_at < ?1`, cutoff);
  return cutoff;
}

async function recentlyLogged(db, ip, path) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const row = await db.first(
    `SELECT id FROM page_hits WHERE ip = ?1 AND path = ?2 AND created_at >= ?3 LIMIT 1`,
    ip,
    path,
    since
  );
  return Boolean(row);
}

/**
 * @returns {{ ok: boolean, skipped?: string, id?: string }}
 */
export async function recordHit(db, { ip, path, country, ua, host, referrerHost } = {}) {
  const normalized = normalizeHitPath(path);
  if (!normalized) return { ok: false, skipped: 'path' };

  const safeIp = truncate(ip || 'unknown', 64) || 'unknown';
  if (await recentlyLogged(db, safeIp, normalized)) {
    return { ok: false, skipped: 'dedupe' };
  }

  const id = randomHex(16);
  const createdAt = nowIso();
  await db.run(
    `INSERT INTO page_hits (id, created_at, ip, path, country, ua, host, referrer_host)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    id,
    createdAt,
    safeIp,
    normalized,
    truncate(country || '', 8) || null,
    truncate(ua || '', UA_MAX) || null,
    truncate(host || '', 120) || null,
    truncate(referrerHost || '', 120) || null
  );

  try {
    await purgeOlderThan(db);
  } catch (_) {
    /* best-effort */
  }

  return { ok: true, id };
}

export async function countUniqueIpsToday(db, { now = new Date() } = {}) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86400000);
  const row = await db.first(
    `SELECT COUNT(DISTINCT ip) AS n FROM page_hits
     WHERE created_at >= ?1 AND created_at < ?2`,
    start.toISOString(),
    end.toISOString()
  );
  return Number(row?.n) || 0;
}

/**
 * Best-effort friendly device label from User-Agent.
 * Honest limits: Apple UA does not expose iPhone 13 vs 14; websites never see
 * the user-assigned device name ("iPhone de Juan").
 */
export function deviceLabelFromUa(ua) {
  const s = String(ua || '').trim();
  if (!s) return 'Desconocido';

  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/iPod/i.test(s)) return 'iPod';

  if (/Android/i.test(s)) {
    // Typical: "... Android 14; Pixel 8 Build/..." or "...; SM-S911B ..."
    const m = s.match(/Android[^;]*;\s*([^);]+)/i);
    let model = (m?.[1] || '').replace(/\s*Build\/.*$/i, '').trim();
    // Chrome on Android 10+ often sends model "K" (reduced UA) — not useful.
    if (
      model &&
      model.length < 40 &&
      !/^K$/i.test(model) &&
      !/^Linux$/i.test(model) &&
      !/^U$/i.test(model)
    ) {
      return `Android · ${model}`;
    }
    return 'Android';
  }

  if (/CrOS/i.test(s)) return 'ChromeOS';
  if (/Windows NT/i.test(s)) {
    if (/Edg\//i.test(s)) return 'Windows · Edge';
    if (/Firefox\//i.test(s)) return 'Windows · Firefox';
    if (/Chrome\//i.test(s)) return 'Windows · Chrome';
    return 'Windows';
  }
  if (/Mac OS X/i.test(s)) {
    if (/Safari\//i.test(s) && !/Chrome\/|CriOS\/|Edg\//i.test(s)) return 'Mac · Safari';
    if (/Firefox\//i.test(s)) return 'Mac · Firefox';
    if (/Chrome\//i.test(s)) return 'Mac · Chrome';
    return 'Mac';
  }
  if (/Linux/i.test(s)) {
    if (/Firefox\//i.test(s)) return 'Linux · Firefox';
    if (/Chrome\//i.test(s)) return 'Linux · Chrome';
    return 'Linux';
  }
  return 'Otro';
}

export async function listRecent(db, { limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const rows = await db.all(
    `SELECT id, created_at, ip, path, country, ua, host, referrer_host
     FROM page_hits
     ORDER BY created_at DESC
     LIMIT ?1`,
    lim
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => ({
    ...row,
    device: deviceLabelFromUa(row.ua),
  }));
}
