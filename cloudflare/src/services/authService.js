/**
 * User accounts + opaque sessions (hb_auth = <id>.<secret>).
 * Password: PBKDF2-SHA-256 via WebCrypto. Google OAuth optional (env secrets).
 */

const COOKIE_NAME = 'hb_auth';
const OAUTH_STATE_COOKIE = 'hb_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30d
const OAUTH_STATE_MAX_AGE = 600; // 10m
const PBKDF2_ITERS = 100_000;
const MIN_PASSWORD = 8;

/** Best-effort rate limit per isolate. */
const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 20;

function nowIso() {
  return new Date().toISOString();
}

function plusSeconds(sec, from = new Date()) {
  return new Date(from.getTime() + sec * 1000).toISOString();
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function validateEmail(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, error: 'Email no válido' };
  }
  return { ok: true, email: e };
}

export function validatePassword(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres` };
  }
  if (p.length > 128) return { ok: false, error: 'Contraseña demasiado larga' };
  return { ok: true, password: p };
}

export function validateName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2) return { ok: false, error: 'Indica tu nombre' };
  if (n.length > 80) return { ok: false, error: 'Nombre demasiado largo' };
  return { ok: true, name: n };
}

/** Public handle: lowercase a-z0-9_ , 3–20 chars. */
export function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

export function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return { ok: false, error: 'Indica un ID de usuario' };
  if (!/^[a-z0-9_]{3,20}$/.test(u)) {
    return {
      ok: false,
      error: 'ID: 3–20 caracteres máximo (letras minúsculas, números o _)',
    };
  }
  return { ok: true, username: u };
}

/** ES / E.164-ish: optional +, digits, spaces, dashes. */
export function validatePhone(phone, { required = true } = {}) {
  const raw = String(phone || '').trim();
  if (!raw) {
    if (required) return { ok: false, error: 'Indica tu teléfono' };
    return { ok: true, phone: null };
  }
  const digits = raw.replace(/[^\d+]/g, '');
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.length < 9 || onlyDigits.length > 15) {
    return { ok: false, error: 'Teléfono no válido' };
  }
  return { ok: true, phone: digits.slice(0, 20) };
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations: PBKDF2_ITERS,
    },
    keyMaterial,
    256
  );
  return `${salt}:${bytesToHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  const s = String(stored || '');
  const colon = s.indexOf(':');
  if (colon <= 0) return false;
  const salt = s.slice(0, colon);
  const expect = s.slice(colon + 1);
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expect)) return false;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations: PBKDF2_ITERS,
    },
    keyMaterial,
    256
  );
  return safeEqual(bytesToHex(bits), expect);
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username || null,
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    provider: row.provider,
    role: row.role || 'user',
    disabled: Boolean(Number(row.disabled) || 0),
    premiumSanction: Boolean(row.premium_sanction_at),
  };
}

export function adminUserRow(row) {
  if (!row) return null;
  const untilMs = row.premium_until ? Date.parse(row.premium_until) : NaN;
  const premiumActive =
    Number.isFinite(untilMs) && untilMs > Date.now() && Number(row.premium_active ?? 1) === 1;
  let premiumDaysLeft = null;
  if (premiumActive) {
    premiumDaysLeft = Math.max(0, Math.ceil((untilMs - Date.now()) / 86400000));
  }
  return {
    id: row.id,
    username: row.username || null,
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    provider: row.provider,
    role: row.role || 'user',
    disabled: Boolean(Number(row.disabled) || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    google_sub: row.google_sub ? true : false,
    plan: premiumActive ? 'premium' : 'free',
    premium: premiumActive,
    premiumStartedAt: row.premium_started_at || null,
    premiumUntil: row.premium_until || null,
    premiumDaysLeft,
    premiumSanction: Boolean(row.premium_sanction_at),
    lastIp: row.last_ip || null,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function listUsersAdmin(db) {
  const rows = await db.all(
    `SELECT u.id, u.username, u.name, u.email, u.phone, u.provider, u.role, u.disabled,
            u.created_at, u.updated_at, u.google_sub, u.premium_sanction_at,
            (
              SELECT s.last_seen_at
              FROM auth_sessions s
              WHERE s.user_id = u.id
              ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC
              LIMIT 1
            ) AS last_login_at,
            (
              SELECT s.ip
              FROM auth_sessions s
              WHERE s.user_id = u.id
              ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC
              LIMIT 1
            ) AS last_ip,
            (
              SELECT p.premium_until
              FROM premium_sessions p
              WHERE p.user_id = u.id AND p.active = 1
              ORDER BY COALESCE(p.premium_until, p.created_at) DESC
              LIMIT 1
            ) AS premium_until,
            (
              SELECT COALESCE(p.premium_started_at, p.created_at)
              FROM premium_sessions p
              WHERE p.user_id = u.id AND p.active = 1
              ORDER BY COALESCE(p.premium_until, p.created_at) DESC
              LIMIT 1
            ) AS premium_started_at,
            (
              SELECT p.active
              FROM premium_sessions p
              WHERE p.user_id = u.id AND p.active = 1
              ORDER BY COALESCE(p.premium_until, p.created_at) DESC
              LIMIT 1
            ) AS premium_active
     FROM users u
     ORDER BY u.created_at DESC`
  );
  return (rows || []).map(adminUserRow);
}

/**
 * Count auth_sessions created in [startIso, endIso) — same UTC day window as CF usage.
 * Each new session row ≈ one login (password or Google).
 */
export async function countLoginsToday(db, { startIso, endIso } = {}) {
  let start = startIso;
  let end = endIso;
  if (!start || !end) {
    const dayStart = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    ));
    start = start || dayStart.toISOString();
    end = end || new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  const row = await db.first(
    `SELECT COUNT(*) AS n FROM auth_sessions
     WHERE created_at >= ?1 AND created_at < ?2`,
    String(start),
    String(end)
  );
  return Number(row?.n) || 0;
}

export async function revokeAllUserSessions(db, userId) {
  await db.run(`UPDATE auth_sessions SET active = 0 WHERE user_id = ?1`, String(userId));
}

export async function setUserDisabled(db, userId, disabled) {
  const flag = disabled ? 1 : 0;
  const ts = nowIso();
  await db.run(
    `UPDATE users SET disabled = ?2, updated_at = ?3 WHERE id = ?1`,
    String(userId),
    flag,
    ts
  );
  if (flag) await revokeAllUserSessions(db, userId);
  return findUserById(db, userId);
}

export async function deleteUser(db, userId) {
  const id = String(userId);
  // Batch = one D1 transaction so sessions+user stay consistent under FK.
  await db.batch([
    { sql: `DELETE FROM auth_sessions WHERE user_id = ?1`, params: [id] },
    { sql: `UPDATE premium_sessions SET user_id = NULL WHERE user_id = ?1`, params: [id] },
    { sql: `DELETE FROM users WHERE id = ?1`, params: [id] },
  ]);
  const still = await findUserById(db, id);
  if (still) {
    throw new Error('No se pudo eliminar el usuario (sigue en D1)');
  }
}

export async function findUserByEmail(db, email) {
  return db.first(`SELECT * FROM users WHERE email = ?1`, normalizeEmail(email));
}

export async function findUserByUsername(db, username) {
  return db.first(`SELECT * FROM users WHERE username = ?1`, normalizeUsername(username));
}

/** Login: email if contains @, else username. */
export async function findUserByLoginIdentifier(db, identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return findUserByEmail(db, raw);
  return findUserByUsername(db, raw);
}

export async function findUserByGoogleSub(db, sub) {
  return db.first(`SELECT * FROM users WHERE google_sub = ?1`, String(sub));
}

export async function findUserById(db, id) {
  return db.first(`SELECT * FROM users WHERE id = ?1`, String(id));
}

export async function createUserPassword(db, { username, name, phone, email, password }) {
  const id = randomHex(16);
  const passwordHash = await hashPassword(password);
  const ts = nowIso();
  await db.run(
    `INSERT INTO users (id, email, name, phone, password_hash, google_sub, provider, role, created_at, updated_at, username)
     VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'password', 'user', ?6, ?7, ?8)`,
    id,
    email,
    name,
    phone,
    passwordHash,
    ts,
    ts,
    username
  );
  return findUserById(db, id);
}

/**
 * Create or link Google user. If email matches an existing password user without google_sub, link.
 */
export async function upsertGoogleUser(db, { sub, email, name }) {
  const googleSub = String(sub || '');
  if (!googleSub) throw new Error('google_sub requerido');
  const em = normalizeEmail(email);
  if (!em) throw new Error('email Google requerido');

  let user = await findUserByGoogleSub(db, googleSub);
  if (user) return user;

  user = await findUserByEmail(db, em);
  const ts = nowIso();
  const displayName = String(name || '').trim() || em.split('@')[0] || 'Usuario';

  if (user) {
    if (user.google_sub && user.google_sub !== googleSub) {
      throw new Error('Ese email ya está vinculado a otra cuenta Google');
    }
    await db.run(
      `UPDATE users SET google_sub = ?2, provider = CASE WHEN provider = 'password' THEN provider ELSE 'google' END,
       name = COALESCE(NULLIF(name, ''), ?3), updated_at = ?4 WHERE id = ?1`,
      user.id,
      googleSub,
      displayName,
      ts
    );
    return findUserById(db, user.id);
  }

  const id = randomHex(16);
  await db.run(
    `INSERT INTO users (id, email, name, phone, password_hash, google_sub, provider, role, created_at, updated_at)
     VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'google', 'user', ?5, ?6)`,
    id,
    em,
    displayName.slice(0, 80),
    googleSub,
    ts,
    ts
  );
  return findUserById(db, id);
}

export async function createAuthSession(db, userId, { ip = null } = {}) {
  const id = randomHex(16);
  const secret = randomHex(32);
  const tokenHash = await sha256Hex(secret);
  const ts = nowIso();
  const expiresAt = plusSeconds(SESSION_MAX_AGE);
  const ipVal = ip != null && String(ip).trim() ? String(ip).trim().slice(0, 128) : null;
  await db.run(
    `INSERT INTO auth_sessions (id, user_id, token_hash, active, expires_at, created_at, last_seen_at, ip)
     VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)`,
    id,
    userId,
    tokenHash,
    expiresAt,
    ts,
    ts,
    ipVal
  );
  return { id, cookieValue: `${id}.${secret}` };
}

export function authCookieFromHeader(header) {
  if (!header) return null;
  let value = null;
  for (const part of header.split(';')) {
    const pair = part.trim();
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq) === COOKIE_NAME) value = pair.slice(eq + 1);
  }
  return value ? decodeURIComponent(value) : null;
}

export function authCookieHeader(cookieValue, { maxAge = SESSION_MAX_AGE } = {}) {
  return `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function clearAuthCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export async function resolveAuthSession(db, cookieValue) {
  if (!cookieValue) return { user: null, session: null };
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return { user: null, session: null };
  const id = cookieValue.slice(0, dot);
  const secret = cookieValue.slice(dot + 1);
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(secret)) {
    return { user: null, session: null };
  }
  const row = await db.first(
    `SELECT * FROM auth_sessions WHERE id = ?1 AND active = 1`,
    id
  );
  if (!row) return { user: null, session: null };
  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    await db.run(`UPDATE auth_sessions SET active = 0 WHERE id = ?1`, id);
    return { user: null, session: null };
  }
  const hash = await sha256Hex(secret);
  if (!safeEqual(hash, String(row.token_hash))) {
    await db.run(`UPDATE auth_sessions SET active = 0 WHERE id = ?1`, id);
    return { user: null, session: null };
  }
  const user = await findUserById(db, row.user_id);
  if (!user) {
    await db.run(`UPDATE auth_sessions SET active = 0 WHERE id = ?1`, id);
    return { user: null, session: null };
  }
  if (Number(user.disabled) === 1) {
    await db.run(`UPDATE auth_sessions SET active = 0 WHERE user_id = ?1`, user.id);
    return { user: null, session: null };
  }
  await db.run(`UPDATE auth_sessions SET last_seen_at = ?2 WHERE id = ?1`, id, nowIso());
  return { user, session: row };
}

export async function revokeAuthSession(db, cookieValue) {
  if (!cookieValue) return;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return;
  const id = cookieValue.slice(0, dot);
  if (!/^[0-9a-f]{32}$/.test(id)) return;
  await db.run(`UPDATE auth_sessions SET active = 0 WHERE id = ?1`, id);
}

export function checkLoginRateLimit(key) {
  const k = String(key || 'anon');
  const now = Date.now();
  let entry = loginAttempts.get(k);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    loginAttempts.set(k, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return { ok: false, error: 'Demasiados intentos. Prueba más tarde.' };
  }
  return { ok: true };
}

export function googleConfigured(env) {
  return Boolean(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET);
}

export function publicOrigin(request, env) {
  if (env?.AUTH_PUBLIC_ORIGIN) return String(env.AUTH_PUBLIC_ORIGIN).replace(/\/$/, '');
  return new URL(request.url).origin;
}

export function googleRedirectUri(request, env) {
  return `${publicOrigin(request, env)}/api/v1/auth/google/callback`;
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret || 'dev-auth-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(sig);
}

export async function createOAuthState(env) {
  const nonce = randomHex(16);
  const ts = String(Date.now());
  const payload = `${nonce}.${ts}`;
  const sig = await hmacSign(env.AUTH_SECRET, payload);
  return `${payload}.${sig}`;
}

export async function verifyOAuthState(env, state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^\d+$/.test(ts)) return false;
  const age = Date.now() - Number(ts);
  if (age < 0 || age > OAUTH_STATE_MAX_AGE * 1000) return false;
  const expect = await hmacSign(env.AUTH_SECRET, `${nonce}.${ts}`);
  return safeEqual(sig, expect);
}

export function oauthStateCookieHeader(state) {
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${OAUTH_STATE_MAX_AGE}`;
}

export function clearOauthStateCookieHeader() {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function oauthStateFromHeader(header) {
  if (!header) return null;
  let value = null;
  for (const part of header.split(';')) {
    const pair = part.trim();
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq) === OAUTH_STATE_COOKIE) value = pair.slice(eq + 1);
  }
  return value ? decodeURIComponent(value) : null;
}

export function googleAuthUrl(env, request, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(request, env),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(env, request, code) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: googleRedirectUri(request, env),
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    throw new Error(`Google token error: ${tokenRes.status} ${t.slice(0, 200)}`);
  }
  const tokens = await tokenRes.json();
  const access = tokens.access_token;
  if (!access) throw new Error('Sin access_token de Google');
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!infoRes.ok) throw new Error('No se pudo leer el perfil de Google');
  const info = await infoRes.json();
  if (!info.sub || !info.email) throw new Error('Perfil Google incompleto');
  return {
    sub: info.sub,
    email: info.email,
    name: info.name || info.given_name || '',
  };
}

export const AUTH_COOKIE = COOKIE_NAME;
export const SESSION_TTL = SESSION_MAX_AGE;
