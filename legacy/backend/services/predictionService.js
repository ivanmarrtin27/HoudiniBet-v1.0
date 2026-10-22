const matchModel = require('../models/match');
const predictionModel = require('../models/prediction');
const teamStats = require('../models/teamStats');

const MIN_TIP_PROB = 0.55;
const MIN_VALUE = 0.05;
const MIN_VALUE_OVERRIDE = 0.08;
const MIN_VALUE_OVERRIDE_PROB = 0.58;
const MIN_DRAW_PROB = 0.4;

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i += 1) r *= i;
  return r;
}

function poissonP(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

function avg(arr, key) {
  if (!arr.length) return null;
  const vals = arr
    .map((x) => x[key])
    .filter((v) => v != null && v !== '' && !Number.isNaN(Number(v)))
    .map((v) => Number(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function hasCornerSamples(stats, min = 3) {
  const n = stats.filter((s) => s.corners_for != null && s.corners_against != null).length;
  return n >= min;
}

function blendRate(teamAvg, leagueAvg, n, fullN = 5) {
  if (teamAvg == null && leagueAvg == null) return null;
  if (teamAvg == null) return leagueAvg;
  if (leagueAvg == null) return teamAvg;
  const w = Math.min(1, Math.max(0, n) / fullN);
  return w * teamAvg + (1 - w) * leagueAvg;
}

function strength(teamAvg, leagueAvg, fallback = 1) {
  if (teamAvg == null || !leagueAvg) return fallback;
  return teamAvg / leagueAvg;
}

function buildScoreMatrix(homeXg, awayXg, maxGoals = 8) {
  const homeP = [];
  const awayP = [];
  for (let i = 0; i <= maxGoals; i += 1) {
    homeP[i] = poissonP(i, homeXg);
    awayP[i] = poissonP(i, awayXg);
  }
  const matrix = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = homeP[h] * awayP[a];
      matrix[h][a] = p;
      total += p;
    }
  }
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h += 1) {
      for (let a = 0; a <= maxGoals; a += 1) {
        matrix[h][a] /= total;
      }
    }
  }
  return matrix;
}

function sumMatrix(matrix, predicate) {
  let s = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      if (predicate(h, a)) s += matrix[h][a];
    }
  }
  return s;
}

function familyOf(label) {
  if (['HOME_WIN', 'DRAW', 'AWAY_WIN'].includes(label)) return '1X2';
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
    ].includes(label)
  ) {
    return 'goles';
  }
  if (['CORNERS_OVER_95', 'CORNERS_UNDER_95'].includes(label)) return 'corners';
  return 'other';
}

function pickBets(candidates, value) {
  const strongEnough = candidates.filter((c) => {
    if (c.prob < MIN_TIP_PROB) return false;
    if (c.label === 'DRAW' && c.prob < MIN_DRAW_PROB) return false;
    return true;
  });
  const pool = strongEnough.length
    ? strongEnough
    : candidates.filter((c) => c.label !== 'DRAW' || c.prob >= MIN_DRAW_PROB);
  const usePool = pool.length ? pool : candidates;
  let primary = [...usePool].sort((a, b) => b.prob - a.prob)[0];

  if (
    value.value_market &&
    value.value_edge != null &&
    value.value_edge >= MIN_VALUE_OVERRIDE
  ) {
    const valued = candidates.find((c) => c.label === value.value_market);
    if (
      valued &&
      valued.prob >= MIN_VALUE_OVERRIDE_PROB &&
      (valued.label !== 'DRAW' || valued.prob >= MIN_DRAW_PROB)
    ) {
      primary = valued;
    }
  }

  const secondary =
    candidates
      .filter((c) => c.label !== primary.label)
      .sort((a, b) => b.prob - a.prob)
      .find((c) => familyOf(c.label) !== familyOf(primary.label)) ||
    candidates.find((c) => c.label !== primary.label) ||
    null;

  return { primary, secondary };
}

function impliedProb(odds) {
  const o = Number(odds);
  if (!o || o <= 1) return null;
  return 1 / o;
}

function computeValue(candidates, oddsRow) {
  if (!oddsRow) return { value_edge: null, value_market: null };
  const map = {
    HOME_WIN: oddsRow.home_odds,
    DRAW: oddsRow.draw_odds,
    AWAY_WIN: oddsRow.away_odds,
    OVER_25: oddsRow.over25_odds,
    UNDER_25: oddsRow.under25_odds,
  };
  let best = null;
  for (const c of candidates) {
    const imp = impliedProb(map[c.label]);
    if (imp == null) continue;
    const edge = c.prob - imp;
    if (edge >= MIN_VALUE && (!best || edge > best.edge)) {
      best = { edge, market: c.label };
    }
  }
  return best
    ? { value_edge: Number(best.edge.toFixed(4)), value_market: best.market }
    : { value_edge: null, value_market: null };
}

async function predictMatch(matchId) {
  const match = await matchModel.findById(matchId);
  if (!match) throw new Error(`Partido ${matchId} no encontrado`);

  const homeStats = await teamStats.lastNForTeam(match.homeTeam.id, 5);
  const awayStats = await teamStats.lastNForTeam(match.awayTeam.id, 5);
  const league = await teamStats.leagueGoalAverages(match.leagueId);

  const nHome = homeStats.length;
  const nAway = awayStats.length;

  const homeScored = blendRate(avg(homeStats, 'goals_scored'), league.avgScored, nHome);
  const homeConceded = blendRate(avg(homeStats, 'goals_conceded'), league.avgConceded, nHome);
  const awayScored = blendRate(avg(awayStats, 'goals_scored'), league.avgScored, nAway);
  const awayConceded = blendRate(avg(awayStats, 'goals_conceded'), league.avgConceded, nAway);

  const homeAttack = strength(homeScored, league.avgScored);
  const homeDefense = strength(homeConceded, league.avgConceded);
  const awayAttack = strength(awayScored, league.avgScored);
  const awayDefense = strength(awayConceded, league.avgConceded);

  const homeXg = homeAttack * awayDefense * league.avgHomeScored;
  const awayXg = awayAttack * homeDefense * league.avgAwayScored;
  const matrix = buildScoreMatrix(homeXg, awayXg, 8);

  const homeWin = sumMatrix(matrix, (h, a) => h > a);
  const draw = sumMatrix(matrix, (h, a) => h === a);
  const awayWin = sumMatrix(matrix, (h, a) => h < a);
  const over15 = sumMatrix(matrix, (h, a) => h + a > 1);
  const under15 = 1 - over15;
  const over25 = sumMatrix(matrix, (h, a) => h + a > 2);
  const under25 = 1 - over25;
  const over35 = sumMatrix(matrix, (h, a) => h + a > 3);
  const under35 = 1 - over35;
  const bttsYes = sumMatrix(matrix, (h, a) => h > 0 && a > 0);
  const bttsNo = 1 - bttsYes;

  let cornersOver = null;
  let cornersUnder = null;
  const canUseCorners = hasCornerSamples(homeStats) && hasCornerSamples(awayStats);
  const homeCornersFor = canUseCorners ? avg(homeStats, 'corners_for') : null;
  const awayCornersFor = canUseCorners ? avg(awayStats, 'corners_for') : null;
  const homeCornersAgainst = canUseCorners ? avg(homeStats, 'corners_against') : null;
  const awayCornersAgainst = canUseCorners ? avg(awayStats, 'corners_against') : null;

  if (
    canUseCorners &&
    [homeCornersFor, awayCornersFor, homeCornersAgainst, awayCornersAgainst].every((v) => v != null)
  ) {
    const homeCornerAtt = strength(homeCornersFor, league.avgCornersFor);
    const homeCornerDef = strength(homeCornersAgainst, league.avgCornersAgainst);
    const awayCornerAtt = strength(awayCornersFor, league.avgCornersFor);
    const awayCornerDef = strength(awayCornersAgainst, league.avgCornersAgainst);
    const homeCornersX = homeCornerAtt * awayCornerDef * (league.avgCornersFor || 5);
    const awayCornersX = awayCornerAtt * homeCornerDef * (league.avgCornersFor || 5);
    const totalCornersLambda = homeCornersX + awayCornersX;
    let underCum = 0;
    for (let k = 0; k <= 9; k += 1) underCum += poissonP(k, totalCornersLambda);
    cornersUnder = underCum;
    cornersOver = 1 - underCum;
  }

  const candidates = [
    { label: 'HOME_WIN', prob: homeWin },
    { label: 'DRAW', prob: draw },
    { label: 'AWAY_WIN', prob: awayWin },
    { label: 'OVER_15', prob: over15 },
    { label: 'UNDER_15', prob: under15 },
    { label: 'OVER_25', prob: over25 },
    { label: 'UNDER_25', prob: under25 },
    { label: 'OVER_35', prob: over35 },
    { label: 'UNDER_35', prob: under35 },
    { label: 'BTTS_YES', prob: bttsYes },
    { label: 'BTTS_NO', prob: bttsNo },
  ];
  if (cornersOver != null && cornersUnder != null) {
    candidates.push({ label: 'CORNERS_OVER_95', prob: cornersOver });
    candidates.push({ label: 'CORNERS_UNDER_95', prob: cornersUnder });
  }

  const oddsRow = await predictionModel.getOddsForMatch(matchId);
  const value = computeValue(candidates, oddsRow);
  const { primary, secondary } = pickBets(candidates, value);

  let confidence = primary.prob * 100;
  const sampleSize = Math.min(nHome, nAway);
  const dataQuality = sampleSize >= 3 ? 'ok' : 'low';

  const payload = {
    match_id: matchId,
    home_win_prob: Number(homeWin.toFixed(4)),
    draw_prob: Number(draw.toFixed(4)),
    away_win_prob: Number(awayWin.toFixed(4)),
    over15_prob: Number(over15.toFixed(4)),
    under15_prob: Number(under15.toFixed(4)),
    over25_prob: Number(over25.toFixed(4)),
    under25_prob: Number(under25.toFixed(4)),
    over35_prob: Number(over35.toFixed(4)),
    under35_prob: Number(under35.toFixed(4)),
    btts_yes_prob: Number(bttsYes.toFixed(4)),
    btts_no_prob: Number(bttsNo.toFixed(4)),
    corners_over95_prob: cornersOver != null ? Number(cornersOver.toFixed(4)) : null,
    corners_under95_prob: cornersUnder != null ? Number(cornersUnder.toFixed(4)) : null,
    suggested_bet: primary.label,
    secondary_bet: secondary ? secondary.label : null,
    confidence_score: Number(confidence.toFixed(2)),
    value_edge: value.value_edge,
    value_market: value.value_market,
  };

  await predictionModel.upsertPrediction(payload);

  return {
    match,
    prediction: payload,
    form: {
      home: teamStats.formFromStats(homeStats),
      away: teamStats.formFromStats(awayStats),
    },
    dataQuality,
    sampleSize,
    xg: { home: Number(homeXg.toFixed(3)), away: Number(awayXg.toFixed(3)) },
    highConfidence: dataQuality === 'ok' && confidence >= 60,
    odds: oddsRow,
  };
}

async function predictMany(matchIds) {
  const results = [];
  for (const id of matchIds) {
    try {
      results.push(await predictMatch(id));
    } catch (err) {
      results.push({ matchId: id, error: err.message });
    }
  }
  return results;
}

async function getBestBets(limit = 40, days = 14) {
  return predictionModel.getBestBets(limit, days);
}

async function getPredictionBundle(matchId) {
  return predictMatch(matchId);
}

module.exports = {
  predictMatch,
  predictMany,
  getBestBets,
  getPredictionBundle,
  poissonP,
};
