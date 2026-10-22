/**
 * Stake profitability (yield / ROI) for tips and combos.
 *
 * Honesty rules:
 * - Only tips priced with a real bookmaker quote count towards ROI. Tips whose
 *   price is the model-implied fair price (odds_source = 'model') are excluded:
 *   betting them at the model's own implied price is circular, so a "ROI" built
 *   on it would only measure calibration, not betting value.
 * - One unit staked per settled bet. A void returns the stake (0 profit).
 */

/** @typedef {{ outcome: string, odds: number|null, source: string|null }} StakeRow */

const BOOK = 'book';

function normalizedOdds(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * @param {StakeRow[]} rows
 * @returns {{
 *   staked: number, hits: number, misses: number, voids: number,
 *   profit: number, yield: number|null, avgOdds: number|null,
 *   bookPriced: number, modelPriced: number
 * }}
 */
export function computeStakeResults(rows) {
  const out = {
    staked: 0,
    hits: 0,
    misses: 0,
    voids: 0,
    profit: 0,
    yield: null,
    avgOdds: null,
    bookPriced: 0,
    modelPriced: 0,
  };
  if (!Array.isArray(rows) || !rows.length) return out;

  let oddsSum = 0;
  let oddsCount = 0;

  for (const row of rows) {
    const outcome = String(row?.outcome || '').toLowerCase();
    if (outcome === 'void') {
      out.voids += 1;
      continue;
    }
    if (outcome !== 'hit' && outcome !== 'miss') continue;

    const odds = normalizedOdds(row?.odds);
    const source = String(row?.source || '').toLowerCase();
    if (source !== BOOK) {
      if (odds != null) out.modelPriced += 1;
      continue;
    }
    if (odds == null) continue;

    out.bookPriced += 1;
    out.staked += 1;
    oddsSum += odds;
    oddsCount += 1;
    if (outcome === 'hit') {
      out.hits += 1;
      out.profit += odds - 1;
    } else {
      out.misses += 1;
      out.profit -= 1;
    }
  }

  if (oddsCount) out.avgOdds = Number((oddsSum / oddsCount).toFixed(4));
  if (out.staked > 0) out.yield = Number((out.profit / out.staked).toFixed(4));
  return out;
}

/** Group stake rows by a key and compute profitability per group. */
export function computeStakeResultsBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = String(keyFn(row) ?? 'otros');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = {};
  for (const [key, group] of groups.entries()) {
    out[key] = computeStakeResults(group);
  }
  return out;
}
