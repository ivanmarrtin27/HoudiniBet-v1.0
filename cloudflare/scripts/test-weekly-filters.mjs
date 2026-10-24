/**
 * Unit tests: weekly league + market-family filters + calendar window + conservative @5.
 */
import assert from 'node:assert/strict';
import {
  filterWeeklyLegs,
  parseWeeklyFilterParams,
  buildWeeklyCombos,
  buildWeeklyProfiles,
  resolveWeeklyWindow,
  TOP5_LEAGUE_API_IDS,
  WEEKLY_MARKET_FAMILIES,
  WEEKLY_DEFAULTS,
} from '../src/services/weeklyComboService.js';

function leg(partial) {
  return {
    matchId: partial.matchId,
    matchDate: partial.matchDate || '2026-10-25T15:00:00Z',
    league: partial.league || 'Test',
    leagueApiId: partial.leagueApiId,
    homeTeam: { name: `H${partial.matchId}` },
    awayTeam: { name: `A${partial.matchId}` },
    suggestedBet: partial.suggestedBet,
    tipOdds: partial.tipOdds ?? 1.5,
    oddsSource: partial.oddsSource || 'book',
    marketFamily: partial.marketFamily,
    confidenceScore: 55,
    prob: partial.prob ?? 0.58,
  };
}

const pool = [
  leg({ matchId: 1, leagueApiId: 39, suggestedBet: 'HOME_WIN', marketFamily: 'result' }),
  leg({ matchId: 2, leagueApiId: 39, suggestedBet: 'OVER_25', marketFamily: 'goals' }),
  leg({ matchId: 3, leagueApiId: 78, suggestedBet: 'HOME_WIN', marketFamily: 'result' }),
  leg({
    matchId: 4,
    leagueApiId: 78,
    suggestedBet: 'CORNERS_OVER_95',
    marketFamily: 'corners',
    tipOdds: 1.65,
  }),
  leg({ matchId: 5, leagueApiId: 140, suggestedBet: 'BTTS_YES', marketFamily: 'goals' }),
  leg({
    matchId: 6,
    leagueApiId: 140,
    suggestedBet: 'CARDS_UNDER_45',
    marketFamily: 'cards',
    tipOdds: 1.72,
  }),
];

// —— parse params ——
{
  const sp = new URLSearchParams('leagueApiId=78&family=corners');
  const p = parseWeeklyFilterParams(sp);
  assert.equal(p.leagueApiId, 78);
  assert.equal(p.family, 'corners');
}
{
  const sp = new URLSearchParams('leagueApiId=999&family=bogus');
  const p = parseWeeklyFilterParams(sp);
  assert.equal(p.leagueApiId, null);
  assert.equal(p.family, null);
}
{
  const sp = new URLSearchParams('');
  const p = parseWeeklyFilterParams(sp);
  assert.equal(p.leagueApiId, null);
  assert.equal(p.family, null);
  assert.equal(p.window, 'next14');
  assert.ok(p.from);
  assert.ok(p.to);
}
{
  const sp = new URLSearchParams('window=weekend');
  const p = parseWeeklyFilterParams(sp);
  assert.equal(p.window, 'weekend');
  assert.ok(p.from <= p.to);
}
{
  const sp = new URLSearchParams('window=bogus');
  const p = parseWeeklyFilterParams(sp);
  assert.equal(p.window, 'next14');
}

assert.ok(TOP5_LEAGUE_API_IDS.has(39));
assert.ok(WEEKLY_MARKET_FAMILIES.has('shots'));

// —— calendar windows ——
{
  // Wednesday 2026-10-21 UTC
  const wed = new Date(Date.UTC(2026, 9, 21, 12, 0, 0));
  const next7 = resolveWeeklyWindow('next7', wed);
  assert.equal(next7.from, '2026-10-21');
  assert.equal(next7.to, '2026-10-28');
  assert.equal(next7.fetchDays, 7);

  const next14 = resolveWeeklyWindow('next14', wed);
  assert.equal(next14.from, '2026-10-21');
  assert.equal(next14.to, '2026-11-04');
  assert.equal(next14.fetchDays, 14);

  const thisWeek = resolveWeeklyWindow('this_week', wed);
  assert.equal(thisWeek.from, '2026-10-21');
  assert.equal(thisWeek.to, '2026-10-25'); // Sun of that ISO week

  const weekend = resolveWeeklyWindow('weekend', wed);
  assert.equal(weekend.from, '2026-10-23'); // Fri
  assert.equal(weekend.to, '2026-10-25'); // Sun
}
{
  // Monday after a Sunday — weekend rolls to next Fri–Sun
  const mon = new Date(Date.UTC(2026, 9, 26, 12, 0, 0));
  const weekend = resolveWeeklyWindow('weekend', mon);
  assert.equal(weekend.from, '2026-10-30');
  assert.equal(weekend.to, '2026-11-01');
}

// —— date filter ——
{
  const dated = [
    leg({ matchId: 1, leagueApiId: 39, suggestedBet: 'HOME_WIN', marketFamily: 'result', matchDate: '2026-10-22T15:00:00Z' }),
    leg({ matchId: 2, leagueApiId: 39, suggestedBet: 'OVER_25', marketFamily: 'goals', matchDate: '2026-10-24T15:00:00Z' }),
    leg({ matchId: 3, leagueApiId: 39, suggestedBet: 'HOME_WIN', marketFamily: 'result', matchDate: '2026-10-28T15:00:00Z' }),
  ];
  const filtered = filterWeeklyLegs(dated, { from: '2026-10-23', to: '2026-10-25' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].matchId, 2);
}

// —— each top5 league ——
for (const lid of [39, 140, 135, 78, 61]) {
  const filtered = filterWeeklyLegs(pool, { leagueApiId: lid });
  assert.ok(filtered.every((l) => Number(l.leagueApiId) === lid));
}

assert.equal(filterWeeklyLegs(pool, { leagueApiId: 39 }).length, 2);
assert.equal(filterWeeklyLegs(pool, { leagueApiId: 78 }).length, 2);
assert.equal(filterWeeklyLegs(pool, { leagueApiId: 141 }).length, 0); // not top5

// —— each family ——
for (const fam of ['result', 'goals', 'corners', 'cards', 'shots']) {
  const filtered = filterWeeklyLegs(pool, { family: fam });
  assert.ok(filtered.every((l) => l.marketFamily === fam));
}
assert.equal(filterWeeklyLegs(pool, { family: 'corners' }).length, 1);
assert.equal(filterWeeklyLegs(pool, { family: 'result' }).length, 2);

// —— combined ——
{
  const filtered = filterWeeklyLegs(pool, { leagueApiId: 78, family: 'corners' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].matchId, 4);
}

// —— no filter ——
assert.equal(filterWeeklyLegs(pool, {}).length, pool.length);

// —— empty pool does not invent ——
{
  const empty = filterWeeklyLegs(pool, { leagueApiId: 61, family: 'shots' });
  assert.equal(empty.length, 0);
  const { combos } = buildWeeklyCombos(empty, { targetOdds: 10 });
  assert.equal(combos.length, 0);
}

// —— build respects filtered league ——
{
  const big = [];
  for (let i = 0; i < 10; i += 1) {
    big.push(
      leg({
        matchId: 100 + i,
        leagueApiId: 78,
        suggestedBet: i % 2 ? 'OVER_25' : 'HOME_WIN',
        marketFamily: i % 2 ? 'goals' : 'result',
        tipOdds: 1.4 + (i % 4) * 0.05,
        matchDate: `2026-10-${20 + (i % 6)}T15:00:00Z`,
      })
    );
  }
  const onlyBl = filterWeeklyLegs(big, { leagueApiId: 78 });
  const { combos, meta } = buildWeeklyCombos(onlyBl, { targetOdds: 10 });
  if (combos[0]) {
    assert.ok(combos[0].legs.every((l) => Number(l.leagueApiId) === 78));
  }
  assert.ok(meta);
}

// —— conservative @5 profile ——
{
  const safePool = [];
  for (let i = 0; i < 12; i += 1) {
    safePool.push(
      leg({
        matchId: 200 + i,
        leagueApiId: [39, 140, 78, 61, 135][i % 5],
        suggestedBet: i % 2 ? 'OVER_25' : 'HOME_WIN',
        marketFamily: i % 2 ? 'goals' : 'result',
        tipOdds: 1.25 + (i % 5) * 0.04,
        prob: 0.62 + (i % 4) * 0.03,
        matchDate: `2026-10-${20 + (i % 6)}T15:00:00Z`,
      })
    );
  }
  const { aggressive, conservative } = buildWeeklyProfiles(safePool);
  assert.ok(aggressive.meta.profile === 'aggressive');
  assert.ok(conservative.meta.profile === 'conservative');
  assert.equal(conservative.meta.targetOdds, WEEKLY_DEFAULTS.SAFE_TARGET_ODDS);
  assert.equal(conservative.meta.minJointProbAdj, WEEKLY_DEFAULTS.SAFE_MIN_JOINT);
  if (conservative.combos[0]) {
    const c = conservative.combos[0];
    assert.ok(c.combinedOdds >= 4 && c.combinedOdds <= 7);
    assert.ok(c.nLegs >= 2);
    assert.equal(c.profile, 'conservative');
  }
}

console.log('test-weekly-filters: ok');
