/**
 * Goals model v2 — Poisson with home/away splits, Bayesian shrinkage, Dixon–Coles.
 * Extra count markets (corners, SOT, yellow cards) are modeled separately
 * because their historical inputs and lines differ from goals.
 */

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i += 1) r *= i;
  return r;
}

export function poissonP(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

export function weightedAvg(arr, key, decay = 0.85) {
  if (!arr?.length) return null;
  let num = 0;
  let den = 0;
  let w = 1;
  for (const row of arr) {
    const v = row?.[key];
    if (v != null && v !== '' && !Number.isNaN(Number(v))) {
      num += Number(v) * w;
      den += w;
    }
    w *= decay;
  }
  return den ? num / den : null;
}

/** Shrink team rate toward league: prior ≈ 8 “ghost” matches. */
export function shrinkRate(teamAvg, leagueAvg, n, priorN = 8) {
  if (teamAvg == null && leagueAvg == null) return null;
  if (teamAvg == null) return leagueAvg;
  if (leagueAvg == null) return teamAvg;
  const nn = Math.max(0, Number(n) || 0);
  const p = Math.max(1, Number(priorN) || 8);
  return (nn * teamAvg + p * leagueAvg) / (nn + p);
}

function strength(teamAvg, leagueAvg, fallback = 1) {
  if (teamAvg == null || !leagueAvg) return fallback;
  return teamAvg / leagueAvg;
}

/**
 * Dixon–Coles low-score correction (tau).
 * rho typically -0.05 .. -0.15 for football.
 */
export function dixonColesTau(h, a, lambdaH, lambdaA, rho = -0.08) {
  if (h === 0 && a === 0) return 1 - lambdaH * lambdaA * rho;
  if (h === 0 && a === 1) return 1 + lambdaH * rho;
  if (h === 1 && a === 0) return 1 + lambdaA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function buildScoreMatrix(homeXg, awayXg, maxGoals = 8, rho = -0.08) {
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
      const tau = dixonColesTau(h, a, homeXg, awayXg, rho);
      const p = Math.max(0, homeP[h] * awayP[a] * tau);
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

export function sumMatrix(matrix, predicate) {
  let s = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      if (predicate(h, a)) s += matrix[h][a];
    }
  }
  return s;
}

function splitHomeAway(stats) {
  const home = (stats || []).filter((s) => Number(s.is_home) === 1);
  const away = (stats || []).filter((s) => Number(s.is_home) !== 1);
  return { home, away };
}

/**
 * @param {object[]} homeStats last N for home team (newest first)
 * @param {object[]} awayStats last N for away team
 * @param {object} league leagueGoalAverages
 */
export function estimateLambdas(homeStats, awayStats, league) {
  const hs = splitHomeAway(homeStats);
  const as = splitHomeAway(awayStats);

  // Prefer venue-specific samples; fall back to all matches.
  const homeAttSample = hs.home.length >= 3 ? hs.home : homeStats;
  const homeDefSample = hs.home.length >= 3 ? hs.home : homeStats;
  const awayAttSample = as.away.length >= 3 ? as.away : awayStats;
  const awayDefSample = as.away.length >= 3 ? as.away : awayStats;

  const homeScored = shrinkRate(
    weightedAvg(homeAttSample, 'goals_scored'),
    league.avgHomeScored || league.avgScored,
    homeAttSample.length
  );
  const homeConceded = shrinkRate(
    weightedAvg(homeDefSample, 'goals_conceded'),
    league.avgAwayScored || league.avgConceded,
    homeDefSample.length
  );
  const awayScored = shrinkRate(
    weightedAvg(awayAttSample, 'goals_scored'),
    league.avgAwayScored || league.avgScored,
    awayAttSample.length
  );
  const awayConceded = shrinkRate(
    weightedAvg(awayDefSample, 'goals_conceded'),
    league.avgHomeScored || league.avgConceded,
    awayDefSample.length
  );

  const homeAttack = strength(homeScored, league.avgHomeScored || league.avgScored);
  const homeDefense = strength(homeConceded, league.avgAwayScored || league.avgConceded);
  const awayAttack = strength(awayScored, league.avgAwayScored || league.avgScored);
  const awayDefense = strength(awayConceded, league.avgHomeScored || league.avgConceded);

  const homeXg = Math.max(
    0.15,
    homeAttack * awayDefense * (league.avgHomeScored || 1.35)
  );
  const awayXg = Math.max(
    0.15,
    awayAttack * homeDefense * (league.avgAwayScored || 1.15)
  );

  return {
    homeXg,
    awayXg,
    nHome: homeStats.length,
    nAway: awayStats.length,
    venueN: {
      homeAtHome: hs.home.length,
      awayAway: as.away.length,
    },
  };
}

export function marketsFromMatrix(matrix) {
  const homeWin = sumMatrix(matrix, (h, a) => h > a);
  const draw = sumMatrix(matrix, (h, a) => h === a);
  const awayWin = sumMatrix(matrix, (h, a) => h < a);
  const over15 = sumMatrix(matrix, (h, a) => h + a > 1);
  const over25 = sumMatrix(matrix, (h, a) => h + a > 2);
  const over35 = sumMatrix(matrix, (h, a) => h + a > 3);
  const bttsYes = sumMatrix(matrix, (h, a) => h > 0 && a > 0);

  const homeOver05 = sumMatrix(matrix, (h) => h > 0);
  const homeOver15 = sumMatrix(matrix, (h) => h > 1);
  const homeOver25 = sumMatrix(matrix, (h) => h > 2);
  const homeOver35 = sumMatrix(matrix, (h) => h > 3);
  const awayOver05 = sumMatrix(matrix, (_h, a) => a > 0);
  const awayOver15 = sumMatrix(matrix, (_h, a) => a > 1);
  const awayOver25 = sumMatrix(matrix, (_h, a) => a > 2);
  const awayOver35 = sumMatrix(matrix, (_h, a) => a > 3);

  return {
    homeWin,
    draw,
    awayWin,
    over15,
    under15: 1 - over15,
    over25,
    under25: 1 - over25,
    over35,
    under35: 1 - over35,
    bttsYes,
    bttsNo: 1 - bttsYes,
    homeOver05,
    homeUnder05: 1 - homeOver05,
    homeOver15,
    homeUnder15: 1 - homeOver15,
    homeOver25,
    homeUnder25: 1 - homeOver25,
    homeOver35,
    homeUnder35: 1 - homeOver35,
    awayOver05,
    awayUnder05: 1 - awayOver05,
    awayOver15,
    awayUnder15: 1 - awayOver15,
    awayOver25,
    awayUnder25: 1 - awayOver25,
    awayOver35,
    awayUnder35: 1 - awayOver35,
  };
}

/** Core tip markets only (product default). */
export const CORE_MARKETS = new Set([
  'HOME_WIN',
  'DRAW',
  'AWAY_WIN',
  'OVER_25',
  'UNDER_25',
  'BTTS_YES',
  'BTTS_NO',
]);

export function coreCandidatesFromMarkets(m) {
  return [
    { label: 'HOME_WIN', prob: m.homeWin },
    { label: 'DRAW', prob: m.draw },
    { label: 'AWAY_WIN', prob: m.awayWin },
    { label: 'OVER_25', prob: m.over25 },
    { label: 'UNDER_25', prob: m.under25 },
    { label: 'BTTS_YES', prob: m.bttsYes },
    { label: 'BTTS_NO', prob: m.bttsNo },
  ];
}

export function allGoalCandidatesFromMarkets(m) {
  return [
    ...coreCandidatesFromMarkets(m),
    { label: 'OVER_15', prob: m.over15 },
    { label: 'UNDER_15', prob: m.under15 },
    { label: 'OVER_35', prob: m.over35 },
    { label: 'UNDER_35', prob: m.under35 },
    { label: 'HOME_OVER_05', prob: m.homeOver05 },
    { label: 'HOME_UNDER_05', prob: m.homeUnder05 },
    { label: 'HOME_OVER_15', prob: m.homeOver15 },
    { label: 'HOME_UNDER_15', prob: m.homeUnder15 },
    { label: 'HOME_OVER_25', prob: m.homeOver25 },
    { label: 'HOME_UNDER_25', prob: m.homeUnder25 },
    { label: 'HOME_OVER_35', prob: m.homeOver35 },
    { label: 'HOME_UNDER_35', prob: m.homeUnder35 },
    { label: 'AWAY_OVER_05', prob: m.awayOver05 },
    { label: 'AWAY_UNDER_05', prob: m.awayUnder05 },
    { label: 'AWAY_OVER_15', prob: m.awayOver15 },
    { label: 'AWAY_UNDER_15', prob: m.awayUnder15 },
    { label: 'AWAY_OVER_25', prob: m.awayOver25 },
    { label: 'AWAY_UNDER_25', prob: m.awayUnder25 },
    { label: 'AWAY_OVER_35', prob: m.awayOver35 },
    { label: 'AWAY_UNDER_35', prob: m.awayUnder35 },
  ];
}
