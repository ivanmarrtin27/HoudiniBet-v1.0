/**
 * Unit tests: weekly diversity, derived_1x2 labels, jointProbAdj, O0.5/U4.5 from model.
 */
import assert from 'node:assert/strict';
import {
  resolveWeeklyLegOdds,
  modelProbForWeekly,
  jointProbAdjusted,
  pickWeeklyCandidates,
  buildWeeklyCombos,
  isTop5League,
} from '../src/services/weeklyComboService.js';
import { scoreComboDiversity } from '../src/services/combos.js';
import { marketFamily } from '../src/services/oddsBands.js';
import { marketsFromMatrix, buildScoreMatrix } from '../src/services/matchModel.js';
import { auditCrestsForLeague } from '../src/services/teamLogos.js';

function makePred(overrides = {}) {
  const matrix = buildScoreMatrix(1.4, 1.1);
  const m = marketsFromMatrix(matrix);
  return {
    home_win_prob: m.homeWin,
    draw_prob: m.draw,
    away_win_prob: m.awayWin,
    over05_prob: m.over05,
    under05_prob: m.under05,
    over15_prob: m.over15,
    under15_prob: m.under15,
    over25_prob: m.over25,
    under25_prob: m.under25,
    over35_prob: m.over35,
    under35_prob: m.under35,
    over45_prob: m.over45,
    under45_prob: m.under45,
    btts_yes_prob: m.bttsYes,
    btts_no_prob: m.bttsNo,
    ...overrides,
  };
}

// —— marketFamily ——
assert.equal(marketFamily('DC_1X'), 'result');
assert.equal(marketFamily('OVER_05'), 'goals');
assert.equal(marketFamily('CORNERS_OVER_95'), 'corners');
assert.equal(marketFamily('CARDS_UNDER_35'), 'cards');
assert.equal(marketFamily('SOT_OVER_85'), 'shots');

// —— DC/DNB derived_1x2 (not book) ——
const odds1x2 = { home_odds: 2.1, draw_odds: 3.4, away_odds: 3.5 };
const dc = resolveWeeklyLegOdds('DC_1X', odds1x2);
assert.equal(dc.oddsSource, 'derived_1x2');
assert.ok(dc.tipOdds >= 1.2);
const dnb = resolveWeeklyLegOdds('DNB_HOME', odds1x2);
assert.equal(dnb.oddsSource, 'derived_1x2');

const bookOu = resolveWeeklyLegOdds('OVER_25', { over25_odds: 1.85 });
assert.equal(bookOu.oddsSource, 'book');

// —— O0.5 / U4.5 from persisted model ——
const pred = makePred();
assert.ok(modelProbForWeekly(pred, 'OVER_05') > 0.7);
assert.ok(modelProbForWeekly(pred, 'UNDER_45') > 0.5);
assert.equal(modelProbForWeekly({ over15_prob: 0.6 }, 'OVER_05'), null); // no soft fill

// —— jointProbAdj soft correlation ——
const legsCorr = [
  { suggestedBet: 'OVER_25', prob: 0.55, matchDate: '2026-10-24T15:00:00Z', leagueApiId: 39 },
  { suggestedBet: 'UNDER_25', prob: 0.52, matchDate: '2026-10-24T17:00:00Z', leagueApiId: 39 },
];
const jp = jointProbAdjusted(legsCorr);
assert.ok(jp.jointProbAdj < jp.jointProb);
assert.equal(jp.independenceAssumption, false);

// —— diversity score ——
const div = scoreComboDiversity(
  [
    { suggestedBet: 'HOME_WIN' },
    { suggestedBet: 'OVER_25' },
    { suggestedBet: 'CORNERS_OVER_95' },
    { suggestedBet: 'CARDS_UNDER_45' },
  ],
  { targetFamilies: 4, availableFamilyCount: 5 }
);
assert.equal(div.familyCount, 4);
assert.equal(div.diversityScore, 1);

// —— pickWeeklyCandidates multi-family ——
const match = {
  id: 1,
  status: 'scheduled',
  matchDate: '2026-10-25T15:00:00Z',
  leagueName: 'Premier League',
  leagueApiId: 39,
  leagueId: 1,
  homeTeam: { name: 'Arsenal', logo: null },
  awayTeam: { name: 'Chelsea', logo: null },
};
const cands = pickWeeklyCandidates(match, pred, {
  home_odds: 2.0,
  draw_odds: 3.4,
  away_odds: 3.8,
  over25_odds: 1.9,
  under25_odds: 1.95,
  btts_yes_odds: 1.8,
  btts_no_odds: 2.0,
});
assert.ok(cands.length >= 1);
const fams = new Set(cands.map((c) => c.marketFamily));
assert.ok(fams.has('result') || fams.has('goals'));

// —— buildWeeklyCombos whyPreferred ——
const pool = [];
for (let i = 0; i < 8; i += 1) {
  pool.push({
    matchId: 100 + i,
    matchDate: `2026-10-${20 + (i % 5)}T15:00:00Z`,
    league: 'Premier League',
    leagueApiId: 39,
    homeTeam: { name: `Home${i}` },
    awayTeam: { name: `Away${i}` },
    suggestedBet: i % 2 === 0 ? 'OVER_25' : 'HOME_WIN',
    tipOdds: 1.45 + (i % 3) * 0.08,
    oddsSource: 'book',
    marketFamily: i % 2 === 0 ? 'goals' : 'result',
    confidenceScore: 55,
    prob: 0.58,
  });
}
const { combos, whyPreferred, meta } = buildWeeklyCombos(pool, { targetOdds: 10 });
assert.ok(Array.isArray(combos));
assert.ok(meta.targetFamilies === 4);
if (combos[0]) {
  assert.ok(combos[0].jointProbAdj != null);
  assert.ok(whyPreferred?.reasons?.length >= 1);
}

assert.equal(isTop5League({ leagueApiId: 39 }), true);
assert.equal(isTop5League({ leagueApiId: 141 }), false);

// —— crest audit PL ——
const pl = auditCrestsForLeague(39);
assert.ok(pl.rows.length >= 18);
assert.ok(pl.rows.every((r) => r.status));

console.log('test-weekly-diversity: ok');
