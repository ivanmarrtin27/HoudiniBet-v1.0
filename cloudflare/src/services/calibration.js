/**
 * Outcome-based tip calibration (no heavy ML).
 * Fits multipliers from settled tip_results (+ mid-band market stats) into meta.
 */

import * as store from '../db.js';

export const CALIBRATION_META_KEY = 'tip_calibration';
export const CALIBRATION_SAMPLE_DAYS = 90;
export const CALIBRATION_MIN_N = 12;

const MULT_MIN = 0.75;
const MULT_MAX = 1.15;

/** Local copy to avoid circular import with oddsBands.js */
function bandFromOdds(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1) return null;
  if (o < 1.7) return '1';
  if (o < 2.5) return '2';
  if (o < 3.5) return '3';
  if (o < 4.5) return '4';
  if (o <= 6.5) return '5';
  return null;
}

/** @type {{ data: object|null, at: number }|null} */
let calibCache = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export function tipFamily(label) {
  const bet = label != null ? String(label) : '';
  if (['HOME_WIN', 'DRAW', 'AWAY_WIN'].includes(bet)) return '1X2';
  if (
    [
      'OVER_15',
      'UNDER_15',
      'OVER_25',
      'UNDER_25',
      'OVER_35',
      'UNDER_35',
      'BTTS_YES',
      'BTTS_NO',
    ].includes(bet)
  ) {
    return 'goles';
  }
  if (
    [
      'CORNERS_OVER_85',
      'CORNERS_UNDER_85',
      'CORNERS_OVER_95',
      'CORNERS_UNDER_95',
      'CORNERS_OVER_105',
      'CORNERS_UNDER_105',
    ].includes(bet)
  ) {
    return 'corners';
  }
  if (
    ['CARDS_OVER_35', 'CARDS_UNDER_35', 'CARDS_OVER_45', 'CARDS_UNDER_45'].includes(bet)
  ) {
    return 'cards';
  }
  if (
    ['SHOTS_OVER_225', 'SHOTS_UNDER_225', 'SHOTS_OVER_255', 'SHOTS_UNDER_255'].includes(
      bet
    )
  ) {
    return 'shots';
  }
  if (
    [
      'SOT_OVER_75',
      'SOT_UNDER_75',
      'SOT_OVER_85',
      'SOT_UNDER_85',
      'SOT_OVER_95',
      'SOT_UNDER_95',
    ].includes(bet)
  ) {
    return 'shots_on_target';
  }
  return 'otros';
}

export function confBinKey(probOrPct) {
  let p = Number(probOrPct);
  if (!Number.isFinite(p)) return 'other';
  if (p > 1.5) p = p / 100;
  if (p >= 0.55 && p < 0.65) return '55-65';
  if (p >= 0.65 && p < 0.75) return '65-75';
  if (p >= 0.75 && p <= 0.9) return '75-82';
  return 'other';
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function bucketMult(hitRate, avgProb, n, minN = CALIBRATION_MIN_N) {
  const h = Number(hitRate);
  const a = Number(avgProb);
  const nn = Number(n) || 0;
  if (nn < minN || !Number.isFinite(h) || !Number.isFinite(a) || a <= 0.01) {
    return 1;
  }
  return Number(clamp(h / a, MULT_MIN, MULT_MAX).toFixed(4));
}

function emptyBucket() {
  return { hitRate: null, avgProb: null, n: 0, mult: 1 };
}

/**
 * @param {{ hits: number, misses: number, sumProb: number }} acc
 */
function finalizeBucket(acc) {
  const hits = Number(acc.hits || 0);
  const misses = Number(acc.misses || 0);
  const n = hits + misses;
  const avgProb = n ? Number(acc.sumProb || 0) / n : null;
  const hitRate = n ? hits / n : null;
  return {
    hitRate: hitRate != null ? Number(hitRate.toFixed(4)) : null,
    avgProb: avgProb != null ? Number(avgProb.toFixed(4)) : null,
    n,
    mult: bucketMult(hitRate, avgProb, n),
  };
}

/**
 * Fit calibration from settled tips + mid-band market outcomes; persist to meta.
 * @returns {Promise<object>}
 */
export async function fitTipCalibration(db, sampleDays = CALIBRATION_SAMPLE_DAYS, opts = {}) {
  const days = Math.max(14, Math.min(180, Number(sampleDays) || CALIBRATION_SAMPLE_DAYS));
  // Mid-band synthetic fill off by default (was circular with band-chasing).
  const includeMidBands = opts.includeMidBands === true;
  const windowSql = `DATE(m.match_date) >= DATE('now', ?)`;
  const windowParams = [`-${days} days`];

  const tipRows = await db.all(
    `SELECT tr.suggested_bet, tr.outcome, tr.confidence_score, tr.model_prob,
            tr.tip_odds, tr.odds_band
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE tr.outcome IN ('hit', 'miss') AND ${windowSql}`,
    ...windowParams
  );

  const byFamilyAcc = new Map();
  const byBandAcc = new Map();
  const byConfAcc = new Map();

  const bump = (map, key, hit, prob) => {
    if (!key) return;
    let a = map.get(key);
    if (!a) {
      a = { hits: 0, misses: 0, sumProb: 0 };
      map.set(key, a);
    }
    if (hit) a.hits += 1;
    else a.misses += 1;
    if (prob != null && Number.isFinite(prob)) a.sumProb += prob;
  };

  for (const r of tipRows) {
    const hit = r.outcome === 'hit';
    let prob =
      r.model_prob != null && Number(r.model_prob) > 0
        ? Number(r.model_prob)
        : r.confidence_score != null
          ? Number(r.confidence_score) > 1
            ? Number(r.confidence_score) / 100
            : Number(r.confidence_score)
          : null;
    if (prob != null && (!Number.isFinite(prob) || prob <= 0)) prob = null;

    bump(byFamilyAcc, tipFamily(r.suggested_bet), hit, prob);

    let band =
      r.odds_band != null && ['1', '2', '3', '4', '5'].includes(String(r.odds_band))
        ? String(r.odds_band)
        : r.tip_odds != null
          ? bandFromOdds(r.tip_odds)
          : null;
    if (band === '1' || !band) {
      if (band === '1') bump(byBandAcc, '1', hit, prob);
    } else {
      bump(byBandAcc, band, hit, prob);
    }

    bump(byConfAcc, confBinKey(prob != null ? prob : r.confidence_score), hit, prob);
  }

  if (includeMidBands) {
    let mid = { stats: null };
    try {
      mid = await store.computeMidBandMarketPerf(db, windowSql, windowParams);
    } catch (_) {
      mid = { stats: null };
    }
    for (const band of ['2', '3', '4', '5']) {
      const existing = byBandAcc.get(band);
      const tipN = existing ? existing.hits + existing.misses : 0;
      if (tipN >= CALIBRATION_MIN_N) continue;
      const s = mid.stats?.[band];
      if (!s) continue;
      const h = Number(s.hits || 0);
      const m = Number(s.misses || 0);
      const n = h + m;
      if (n < 1) continue;
      const centerProb = 1 / ({ 2: 2, 3: 3, 4: 4, 5: 5 }[band] || 3);
      byBandAcc.set(band, {
        hits: h,
        misses: m,
        sumProb: centerProb * n,
      });
    }
  }

  const byFamily = {};
  for (const [k, acc] of byFamilyAcc) byFamily[k] = finalizeBucket(acc);
  const byBand = {};
  for (const [k, acc] of byBandAcc) byBand[k] = finalizeBucket(acc);
  for (const b of ['1', '2', '3', '4', '5']) {
    if (!byBand[b]) byBand[b] = emptyBucket();
  }
  const byConfBin = {};
  for (const [k, acc] of byConfAcc) byConfBin[k] = finalizeBucket(acc);
  for (const k of ['55-65', '65-75', '75-82', 'other']) {
    if (!byConfBin[k]) byConfBin[k] = emptyBucket();
  }

  const decided = tipRows.length;
  const payload = {
    updatedAt: new Date().toISOString(),
    sampleDays: days,
    decided,
    byFamily,
    byBand,
    byConfBin,
  };
  await store.setMeta(db, CALIBRATION_META_KEY, JSON.stringify(payload));
  calibCache = { data: payload, at: Date.now() };
  return payload;
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadTipCalibration(db) {
  if (calibCache && Date.now() - calibCache.at < CACHE_TTL_MS) {
    return calibCache.data;
  }
  const raw = await store.getMeta(db, CALIBRATION_META_KEY);
  if (!raw) {
    calibCache = { data: null, at: Date.now() };
    return null;
  }
  try {
    const data = JSON.parse(raw);
    calibCache = { data, at: Date.now() };
    return data;
  } catch {
    calibCache = { data: null, at: Date.now() };
    return null;
  }
}

export function isFamilyBlocked(calib, family) {
  const f = calib?.byFamily?.[family];
  if (!f) return false;
  return Number(f.n || 0) >= 20 && Number(f.hitRate) < 0.45;
}

/**
 * Scale candidate probs with family / soft band / soft conf multipliers.
 * @param {{ label: string, prob: number }[]} candidates
 * @param {object|null} calib
 */
export function applyCalibrationToCandidates(candidates, calib) {
  if (!calib || !Array.isArray(candidates)) return candidates;
  return candidates.map((c) => {
    const raw = Number(c.prob);
    if (!Number.isFinite(raw)) return c;
    const fam = tipFamily(c.label);
    const famMult = Number(calib.byFamily?.[fam]?.mult) || 1;
    const impliedOdds = raw > 0.01 ? 1 / raw : null;
    const band = impliedOdds != null ? bandFromOdds(impliedOdds) : null;
    const bandRaw = band ? Number(calib.byBand?.[band]?.mult) || 1 : 1;
    const bandMult = 0.5 + 0.5 * bandRaw;
    const confRaw = Number(calib.byConfBin?.[confBinKey(raw)]?.mult) || 1;
    const confMult = 0.7 + 0.3 * confRaw;
    let mult = famMult * bandMult * confMult;
    if (isFamilyBlocked(calib, fam)) mult *= 0.85;
    const p = clamp(raw * mult, 0.05, 0.95);
    return { ...c, rawProb: raw, prob: p };
  });
}

/** Score boost for combo/market pick ranking (higher = prefer). */
export function calibrationScoreBoost(calib, label, tipOdds = null) {
  if (!calib) return 1;
  const fam = tipFamily(label);
  let mult = Number(calib.byFamily?.[fam]?.mult) || 1;
  if (isFamilyBlocked(calib, fam)) mult *= 0.8;
  const band = tipOdds != null ? bandFromOdds(tipOdds) : null;
  if (band) {
    const b = Number(calib.byBand?.[band]?.mult) || 1;
    mult *= 0.5 + 0.5 * b;
  }
  return mult;
}
