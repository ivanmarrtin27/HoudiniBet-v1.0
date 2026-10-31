/**
 * Unit test for leagueMarketRates mapping / n≥20 threshold (no D1 required).
 * Mirrors the pure mapping logic from db.leagueMarketRates.
 */
import assert from 'node:assert/strict';

const LEAGUE_MARKET_RATES_MIN_N = 20;

function mapLeagueMarketRates(r) {
  const n = Number(r?.n) || 0;
  if (n < LEAGUE_MARKET_RATES_MIN_N) {
    return { n, over15Rate: null, over25Rate: null, bttsRate: null };
  }
  const toRate = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Number(x.toFixed(4)) : null;
  };
  return {
    n,
    over15Rate: toRate(r.over15_rate),
    over25Rate: toRate(r.over25_rate),
    bttsRate: toRate(r.btts_rate),
  };
}

const below = mapLeagueMarketRates({
  n: 19,
  over15_rate: 0.8,
  over25_rate: 0.55,
  btts_rate: 0.5,
});
assert.equal(below.n, 19);
assert.equal(below.over15Rate, null);
assert.equal(below.over25Rate, null);
assert.equal(below.bttsRate, null);

const ok = mapLeagueMarketRates({
  n: 20,
  over15_rate: 0.81234,
  over25_rate: 0.54321,
  btts_rate: 0.5,
});
assert.equal(ok.n, 20);
assert.equal(ok.over15Rate, 0.8123);
assert.equal(ok.over25Rate, 0.5432);
assert.equal(ok.bttsRate, 0.5);

const empty = mapLeagueMarketRates(null);
assert.equal(empty.n, 0);
assert.equal(empty.bttsRate, null);

console.log('ok: leagueMarketRates threshold + mapping');
