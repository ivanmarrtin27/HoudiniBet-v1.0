/**
 * Build multi-leg combos whose product of odds falls in a band (2–5).
 * Always ranked by avgConfidence DESC (highest probability first).
 */

import { BAND_META, oddsBandFromCombined, marketFamily } from './oddsBands.js';

/**
 * Diversity score in [0,1]: unique market families / target (capped at 1).
 * Does not force low-quality legs — caller gates quality first.
 */
export function scoreComboDiversity(legs, { targetFamilies = 4, availableFamilyCount = 0 } = {}) {
  const families = [
    ...new Set(
      (legs || []).map((l) => l.marketFamily || marketFamily(l.suggestedBet || l.label))
    ),
  ].filter((f) => f && f !== 'otros');
  const familyCount = families.length;
  const target =
    availableFamilyCount > 0
      ? Math.min(targetFamilies, availableFamilyCount)
      : targetFamilies;
  const diversityScore =
    target > 0 ? Number(Math.min(1, familyCount / target).toFixed(3)) : 1;
  return { families, familyCount, diversityScore, targetFamilies: target };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function comboKey(legs) {
  return legs
    .map((l) => l.matchId)
    .slice()
    .sort((a, b) => a - b)
    .join('-');
}

/** Bounded combinations of size k. */
function eachCombo(arr, k, visit) {
  const n = arr.length;
  if (k <= 0 || k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    visit(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) break;
    idx[i] += 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Per-band defaults.
 * Higher bands need slightly longer legs (or more of them) so the product can land.
 * tipMin is the floor for the confidence-ranked pool (avoids only ~1.20 favorites).
 */
export function comboOptsForBand(band) {
  switch (String(band)) {
    case '2':
      return { minLegs: 2, maxLegs: 3, poolSize: 14, tipMin: 1.18, tipMax: 2.1 };
    case '3':
      return { minLegs: 2, maxLegs: 4, poolSize: 16, tipMin: 1.28, tipMax: 2.2 };
    case '4':
      return { minLegs: 3, maxLegs: 5, poolSize: 18, tipMin: 1.32, tipMax: 2.25 };
    case '5':
      return { minLegs: 3, maxLegs: 6, poolSize: 20, tipMin: 1.35, tipMax: 2.35 };
    default:
      return { minLegs: 2, maxLegs: 4, poolSize: 12, tipMin: 1.22, tipMax: 2.35 };
  }
}

function byConfidenceThenOdds(a, b) {
  if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
  return a.tipOdds - b.tipOdds;
}

/**
 * @param {Array<{ matchId: number, tipOdds: number, confidenceScore?: number }>} candidates
 * @param {string} band
 * @param {{ minLegs?: number, maxLegs?: number, limit?: number, poolSize?: number, tipMin?: number, tipMax?: number }} [opts]
 */
export function buildCombos(candidates, band, opts = {}) {
  const meta = BAND_META[band];
  if (!meta) return [];
  const defaults = comboOptsForBand(band);
  const minLegs = opts.minLegs ?? defaults.minLegs;
  const maxLegs = opts.maxLegs ?? defaults.maxLegs;
  const limit = opts.limit ?? 8;
  const poolSize = opts.poolSize ?? defaults.poolSize;
  let tipMin = opts.tipMin ?? defaults.tipMin;
  const tipMax = opts.tipMax ?? defaults.tipMax;

  const normalized = (candidates || [])
    .map((c) => ({
      ...c,
      matchId: Number(c.matchId),
      tipOdds: num(c.tipOdds),
      confidenceScore: num(c.confidenceScore) ?? 0,
    }))
    .filter((c) => c.matchId && c.tipOdds != null && c.tipOdds <= tipMax);

  // Confidence-first pool inside the band's tip window; relax tipMin if too few legs.
  let eligible = normalized
    .filter((c) => c.tipOdds >= tipMin)
    .sort(byConfidenceThenOdds);
  if (eligible.length < minLegs) {
    const steps = [0.05, 0.1, 0.15, 0.2];
    for (const step of steps) {
      tipMin = Math.max(1.18, (opts.tipMin ?? defaults.tipMin) - step);
      eligible = normalized
        .filter((c) => c.tipOdds >= tipMin)
        .sort(byConfidenceThenOdds);
      if (eligible.length >= minLegs) break;
    }
  }

  const pool = eligible.slice(0, poolSize);
  if (pool.length < minLegs) return [];

  const seen = new Set();
  const out = [];

  function consider(legs) {
    if (legs.length < minLegs || legs.length > maxLegs) return;
    const ids = new Set(legs.map((l) => l.matchId));
    if (ids.size !== legs.length) return;
    let product = 1;
    let confSum = 0;
    for (const l of legs) {
      product *= l.tipOdds;
      confSum += l.confidenceScore;
    }
    if (oddsBandFromCombined(product) !== band) return;
    const key = comboKey(legs);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      combinedOdds: Number(product.toFixed(3)),
      oddsBand: band,
      avgConfidence: Number((confSum / legs.length).toFixed(2)),
      legs: legs.map((l) => ({ ...l })),
      dist: Math.abs(product - meta.center),
    });
  }

  for (let k = minLegs; k <= maxLegs; k += 1) {
    eachCombo(pool, k, consider);
  }

  // Highest average probability first, then drop any combo that reuses a match.
  out.sort((x, y) => {
    if (y.avgConfidence !== x.avgConfidence) return y.avgConfidence - x.avgConfidence;
    if (x.dist !== y.dist) return x.dist - y.dist;
    return x.combinedOdds - y.combinedOdds;
  });

  const picked = [];
  const usedMatches = new Set();
  for (const combo of out) {
    const ids = combo.legs.map((l) => l.matchId);
    if (ids.some((id) => usedMatches.has(id))) continue;
    picked.push(combo);
    for (const id of ids) usedMatches.add(id);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Combos whose product of odds is near a target cuota.
 * Ranked by joint model probability (product of leg probs, independence assumption).
 * Defaults: 3–8 legs, pool 14 (C(14,8) stays Worker-safe; max 10 would explode).
 *
 * @param {Array<{ matchId: number, tipOdds: number, confidenceScore?: number, prob?: number, oddsSource?: string }>} candidates
 * @param {number} targetOdds
 * @param {{ tolerance?: number, minLegs?: number, maxLegs?: number, limit?: number, poolSize?: number, tipMin?: number, tipMax?: number }} [opts]
 */
export function buildCombosForTargetOdds(candidates, targetOdds, opts = {}) {
  const target = Number(targetOdds);
  if (!Number.isFinite(target) || target < 1.5) return [];
  const tolerance = opts.tolerance ?? 0.12;
  const minOdds = target * (1 - tolerance);
  const maxOdds = target * (1 + tolerance);
  const minLegs = opts.minLegs ?? 3;
  const maxLegs = opts.maxLegs ?? 8;
  const limit = opts.limit ?? 12;
  const poolSize = opts.poolSize ?? 14;
  const tipMin = opts.tipMin ?? 1.2;
  const tipMax = opts.tipMax ?? 2.8;

  const preserveOrder = Boolean(opts.preserveOrder);
  const normalized = (candidates || [])
    .map((c) => {
      const tipOdds = num(c.tipOdds);
      const conf = num(c.confidenceScore);
      const prob =
        num(c.prob) ??
        (conf != null ? conf / 100 : tipOdds != null ? 1 / tipOdds : null);
      return {
        ...c,
        matchId: Number(c.matchId),
        tipOdds,
        confidenceScore: conf ?? (prob != null ? Number((prob * 100).toFixed(2)) : 0),
        jointProb: prob,
      };
    })
    .filter(
      (c) =>
        c.matchId &&
        c.tipOdds != null &&
        c.tipOdds >= tipMin &&
        c.tipOdds <= tipMax &&
        c.jointProb != null &&
        c.jointProb > 0
    );
  if (!preserveOrder) {
    normalized.sort((a, b) => b.jointProb - a.jointProb || a.tipOdds - b.tipOdds);
  }

  const pool = normalized.slice(0, poolSize);
  if (pool.length < minLegs) return [];

  const seen = new Set();
  const out = [];

  const targetFamilies = opts.targetFamilies ?? 4;
  const availableFamilyCount = opts.availableFamilyCount ?? 0;

  function consider(legs) {
    if (legs.length < minLegs || legs.length > maxLegs) return;
    const ids = new Set(legs.map((l) => l.matchId));
    if (ids.size !== legs.length) return;
    let product = 1;
    let joint = 1;
    let confSum = 0;
    for (const l of legs) {
      product *= l.tipOdds;
      joint *= l.jointProb;
      confSum += l.confidenceScore;
    }
    if (product < minOdds || product > maxOdds) return;
    const key = comboKey(legs);
    if (seen.has(key)) return;
    seen.add(key);
    const sources = new Set(legs.map((l) => l.oddsSource || 'model'));
    const pricing =
      sources.size === 1 && sources.has('book')
        ? 'book'
        : sources.size === 1
          ? 'model'
          : 'mixed';
    const div = scoreComboDiversity(legs, { targetFamilies, availableFamilyCount });
    out.push({
      combinedOdds: Number(product.toFixed(3)),
      targetOdds: Number(target.toFixed(2)),
      avgConfidence: Number((confSum / legs.length).toFixed(2)),
      jointProb: Number(joint.toFixed(6)),
      nLegs: legs.length,
      pricing,
      diversityScore: div.diversityScore,
      familyCount: div.familyCount,
      families: div.families,
      legs: legs.map((l) => ({ ...l })),
      dist: Math.abs(product - target),
    });
  }

  for (let k = minLegs; k <= maxLegs; k += 1) {
    eachCombo(pool, k, consider);
  }

  out.sort((x, y) => {
    // Quality (joint P) first; soft diversity boost when pool has enough families.
    const bx =
      x.jointProb *
      (availableFamilyCount >= targetFamilies ? 0.9 + 0.1 * (x.diversityScore || 0) : 1);
    const by =
      y.jointProb *
      (availableFamilyCount >= targetFamilies ? 0.9 + 0.1 * (y.diversityScore || 0) : 1);
    if (by !== bx) return by - bx;
    if (x.dist !== y.dist) return x.dist - y.dist;
    return x.combinedOdds - y.combinedOdds;
  });

  const picked = [];
  const usedMatches = new Set();
  for (const combo of out) {
    const ids = combo.legs.map((l) => l.matchId);
    if (ids.some((id) => usedMatches.has(id))) continue;
    picked.push(combo);
    for (const id of ids) usedMatches.add(id);
    if (picked.length >= limit) break;
  }
  return picked;
}
