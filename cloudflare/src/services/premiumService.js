/**
 * Premium access without user accounts (F8).
 *
 * Model, agreed with the product owner:
 *  - No login, no database of users. The browser gets an HttpOnly guest
 *    session cookie (`hb_prem` = `<id>.<secret>`).
 *  - Payment runs on Stripe Checkout: the session id travels as
 *    `client_reference_id`. When the `checkout.session.completed` webhook
 *    arrives (signature verified against `STRIPE_WEBHOOK_SECRET`), the
 *    session gets `premium_until` = today + PREMIUM_DAYS.
 *  - Gating is currently OFF (no login yet): combos + full performance are
 *    public. Stripe/session plumbing remains for a future paid tier.
 *
 * First-order, documented on purpose: one payment buys `PREMIUM_DAYS` days
 * (default 30). Subscriptions would need retries on webhook replays and are
 * out of scope; a manual admin grant exists for promos/refunds.
 */

const COOKIE_NAME = 'hb_prem';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DEFAULT_PREMIUM_DAYS = 30;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function nowIso() {
  return new Date().toISOString();
}

function plusDays(days, from = new Date()) {
  const base = new Date(from.getTime());
  base.setUTCDate(base.getUTCDate() + Math.max(0, Math.round(Number(days) || 0)));
  return base.toISOString();
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison for equal-length hex strings. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isPremiumActive(row, at = new Date()) {
  if (!row || Number(row.active) !== 1) return false;
  const until = row.premium_until ? Date.parse(row.premium_until) : NaN;
  if (!Number.isFinite(until)) return false;
  return until > at.getTime();
}

/* ------------------------------------------------------------------ *
 * Guest sessions
 * ------------------------------------------------------------------ */

export async function createPremiumSession(db, { days = 0 } = {}) {
  const id = randomHex(16);
  const secret = randomHex(32);
  const tokenHash = await sha256Hex(secret);
  await db.run(
    `INSERT INTO premium_sessions (id, token_hash, active, premium_until, created_at)
     VALUES (?1, ?2, 1, ?3, ?4)`,
    id,
    tokenHash,
    plusDays(days),
    nowIso()
  );
  return { id, cookieValue: `${id}.${secret}` };
}

/** Extract `hb_prem=<id>.<secret>` from a cookie header (last one wins). */
export function sessionCookieFromHeader(header) {
  if (!header) return null;
  const pairs = header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  let value = null;
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq) === COOKIE_NAME) value = pair.slice(eq + 1);
  }
  return value ? decodeURIComponent(value) : null;
}

export function sessionCookieHeader(cookieValue, { maxAge = SESSION_COOKIE_MAX_AGE } = {}) {
  return {
    name: COOKIE_NAME,
    value: cookieValue,
    toSetCookieString: () =>
      `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`,
  };
}

/**
 * Resolve a cookie value `${id}.${secret}` into `{ session, premium }`.
 * Token mismatch deactivates the session (brute-force guard).
 */
export async function resolvePremiumSession(db, cookieValue) {
  if (!cookieValue) return { session: null, premium: false };
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return { session: null, premium: false };
  const id = cookieValue.slice(0, dot);
  const secret = cookieValue.slice(dot + 1);
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(secret)) {
    return { session: null, premium: false };
  }
  const row = await db.first(
    `SELECT * FROM premium_sessions WHERE id = ?1 AND active = 1`,
    id
  );
  if (!row) return { session: null, premium: false };
  const hash = await sha256Hex(secret);
  if (!safeEqual(hash, String(row.token_hash))) {
    await db.run(`UPDATE premium_sessions SET active = 0 WHERE id = ?1`, id);
    return { session: null, premium: false };
  }
  const premium = isPremiumActive(row);
  await db.run(`UPDATE premium_sessions SET last_seen_at = ?2 WHERE id = ?1`, id, nowIso());
  return { session: row, premium };
}

/** Extend (or activate) premium access for a session id. */
export async function grantPremium(db, id, { days = DEFAULT_PREMIUM_DAYS, at = new Date() } = {}) {
  const row = await db.first(`SELECT * FROM premium_sessions WHERE id = ?1`, id);
  if (!row) return null;
  const current = row.premium_until ? Date.parse(row.premium_until) : NaN;
  const from = Number.isFinite(current) && current > at.getTime() ? new Date(current) : at;
  const premiumUntil = plusDays(days, from);
  await db.run(`UPDATE premium_sessions SET premium_until = ?2 WHERE id = ?1`, id, premiumUntil);
  return premiumUntil;
}

/* ------------------------------------------------------------------ *
 * Stripe
 * ------------------------------------------------------------------ */

export function stripeConfigured(env) {
  return Boolean(
    env &&
      String(env.STRIPE_SECRET_KEY || '').trim() &&
      String(env.STRIPE_PRICE_ID || '').trim()
  );
}

/** Form-encoded body for the Checkout Sessions API (no SDK needed). */
export function checkoutFormBody({ clientReferenceId, origin, priceId }) {
  const successBase = `${origin}/?premium=ok`;
  const cancelBase = `${origin}/?premium=cancel`;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('client_reference_id', clientReferenceId);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', successBase);
  params.set('cancel_url', cancelBase);
  params.set('allow_promotion_codes', 'true');
  return params.toString();
}

export async function createStripeCheckout(env, clientReferenceId, { fetchImpl = fetch } = {}) {
  if (!stripeConfigured(env)) return { error: 'stripe_not_configured' };
  const origin = String(env.PREMIUM_SUCCESS_URL || '').trim() || 'https://houdini-bet.dev';
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: checkoutFormBody({
      clientReferenceId,
      origin,
      priceId: String(env.STRIPE_PRICE_ID).trim(),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `stripe_${res.status}`, detail: detail.slice(0, 300) };
  }
  const data = await res.json();
  return { url: data.url, sessionId: data.id };
}

/**
 * Verify `Stripe-Signature` against the raw body.
 * Signed payload = `${timestamp}.${body}`; v1 entries are HMAC-SHA256.
 */
export async function verifyStripeSignature(rawBody, sigHeader, secret, at = new Date()) {
  if (!sigHeader || !secret || !rawBody) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of String(sigHeader).split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || !signatures.length) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(at.getTime() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(`${timestamp}.${rawBody}`, secret);
  return signatures.some((sig) => safeEqual(expected, sig.toLowerCase()));
}

async function hmacHex(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Apply a signed Stripe event to D1. Returns `{ applied, kind }`.
 * `checkout.session.completed` grants the days; `charge.refunded` revokes.
 */
export async function applyStripeEvent(db, env, event) {
  const type = String(event?.type || '');
  const days = Math.max(1, Math.min(365, Number(env.PREMIUM_DAYS) || DEFAULT_PREMIUM_DAYS));
  if (type === 'checkout.session.completed') {
    const session = event?.data?.object || {};
    const ref = String(session.client_reference_id || session.metadata?.token || '');
    const id = validSessionId(ref);
    if (!id) return { applied: false, kind: 'no_session_ref' };
    const until = await grantPremium(db, id, { days, at: new Date(session.created ? session.created * 1000 : Date.now()) });
    if (!until) return { applied: false, kind: 'unknown_session' };
    await db.run(
      `UPDATE premium_sessions
        SET stripe_session_id = ?2,
            stripe_customer_id = ?3,
            amount_total = ?4,
            currency = ?5
      WHERE id = ?1`,
      id,
      session.id ? String(session.id) : null,
      session.customer ? String(session.customer) : null,
      session.amount_total != null ? Number(session.amount_total) : null,
      session.currency ? String(session.currency) : null
    );
    return { applied: true, kind: 'granted', until, id };
  }
  if (type === 'charge.refunded') {
    const charge = event?.data?.object || {};
    const sessionId = charge.checkout?.session ? String(charge.checkout.session) : null;
    if (!sessionId) return { applied: false, kind: 'no_session_id' };
    await db.run(
      `UPDATE premium_sessions SET premium_until = NULL WHERE stripe_session_id = ?1`,
      sessionId
    );
    return { applied: true, kind: 'revoked', sessionId };
  }
  return { applied: false, kind: 'ignored', type };
}

function validSessionId(value) {
  return /^[0-9a-f]{32}$/.test(String(value || '')) ? String(value) : null;
}

/* ------------------------------------------------------------------ *
 * Gating helpers
 * ------------------------------------------------------------------ */

/**
 * Performance payload for free visitors: basic counts stay public, the
 * money view (ROI) and the deeper combo history are premium.
 */
export function stripPerfForFree(perf) {
  if (!perf || typeof perf !== 'object') return perf;
  const free = { ...perf, premiumRequired: true };
  delete free.roi;
  delete free.roiByFamily;
  delete free.recentCombos;
  delete free.recent;
  free.byFamily = (free.byFamily || []).map((row) => {
    const rest = { ...row };
    delete rest.roi;
    return rest;
  });
  return free;
}
