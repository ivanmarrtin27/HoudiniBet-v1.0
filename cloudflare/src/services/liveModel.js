/**
 * Live (in-play) projection.
 *
 * The pre-match model (Poisson + Dixon–Coles) is reused for the minutes that
 * are still to be played: the expected goals of the whole match are scaled by
 * the fraction of the match left, the remaining-goals matrix is shifted by the
 * current score, and the result is the distribution of the FINAL score.
 *
 * From that we get live 1X2 / O/U / BTTS probabilities and the status of a
 * pre-match tip: `secured` (mathematically decided), `dead` (mathematically
 * lost) or `alive` (still in play).
 *
 * Assumptions (first order, documented on purpose):
 *  - Goals are distributed uniformly over the 90 minutes of regulation.
 *  - The pre-match strength does not change because of the current score.
 *  - A red card shifts the strength of both teams for the time that is still
 *    to be played (see RED_SIM_FACTOR / RED_OPP_FACTOR); score and minutes
 *    already played keep the goals that already happened.
 */

import {
  buildScoreMatrix,
  marketsFromMatrix,
  poissonP,
  sumMatrix,
} from './matchModel.js';

export const FULL_MATCH_MINUTES = 90;
/** Average stoppage time added to the 90 minutes of regulation. */
export const AVERAGE_STOPPAGE_MINUTES = 5;
/**
 * Minutes of football in a match (regulation + average stoppage).
 * The expected goals of the model refer to this length, so the share of the
 * match still to be played is `remaining / TOTAL_MATCH_MINUTES`.
 */
export const TOTAL_MATCH_MINUTES = FULL_MATCH_MINUTES + AVERAGE_STOPPAGE_MINUTES;
const DIXON_COLES_RHO = -0.08;
/** Probability from which a tip counts as mathematically decided / lost. */
const SECURED_AT = 0.995;
const ALIVE_AT = 0.1;
const DEAD_AT = 0.01;
/**
 * First-order red-card effect on the remaining expected goals, documented on
 * purpose: the team that lost a player scores ~25% less and the team with
 * the extra man scores ~15% more for the minutes left. The factors apply
 * only to the part of the match still to be played; a red in minute 85
 * barely moves the projection, which follows from the math automatically.
 */
export const RED_SIM_FACTOR = 0.75;
export const RED_OPP_FACTOR = 1.15;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round4(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(4));
}

/** Number or null — `Number(null)` is 0, which would hide missing values. */
function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minutes of football left to play.
 * Regulation + estimated stoppage; inside stoppage time only a short tail is left.
 */
export function remainingMinutes(minute) {
  const m = numOrNull(minute);
  if (m == null || m < 0) return TOTAL_MATCH_MINUTES;
  if (m <= FULL_MATCH_MINUTES) {
    return clamp(TOTAL_MATCH_MINUTES - m, 0, TOTAL_MATCH_MINUTES);
  }
  return clamp(2 - (m - FULL_MATCH_MINUTES), 0, 10);
}

/**
 * Normalized live state of a match row.
 * The incident timeline wins over the scoreline while the match is running:
 * a goal that reached the timeline is always counted.
 */
export function liveSnapshot(match) {
  const status = String(match?.status || '');
  const events = Array.isArray(match?.events) ? match.events : [];
  const isLive = status === 'live';

  let goalHome = 0;
  let goalAway = 0;
  let redsHome = 0;
  let redsAway = 0;
  let lastEventMinute = 0;
  for (const ev of events) {
    const minute = Number(ev?.minute);
    if (Number.isFinite(minute) && minute > lastEventMinute) lastEventMinute = minute;
    if (ev?.type === 'red') {
      if (ev.isHome) redsHome += 1;
      else redsAway += 1;
    }
    if (ev?.type !== 'goal') continue;
    if (ev.isHome) goalHome += 1;
    else goalAway += 1;
  }

  const rawHome = numOrNull(match?.homeGoals);
  const rawAway = numOrNull(match?.awayGoals);
  let homeGoals = rawHome != null && rawHome >= 0 ? rawHome : goalHome;
  let awayGoals = rawAway != null && rawAway >= 0 ? rawAway : goalAway;
  if (isLive) {
    homeGoals = Math.max(homeGoals, goalHome);
    awayGoals = Math.max(awayGoals, goalAway);
  }

  const rawMinute = numOrNull(match?.elapsedMinute);
  let minute = rawMinute != null && rawMinute >= 0 ? rawMinute : lastEventMinute;

  return {
    isLive,
    minute: clamp(Math.round(minute), 0, 130),
    homeGoals: clamp(Math.round(homeGoals), 0, 30),
    awayGoals: clamp(Math.round(awayGoals), 0, 30),
    remaining: isLive ? remainingMinutes(minute) : 0,
    redsHome: clamp(redsHome, 0, 4),
    redsAway: clamp(redsAway, 0, 4),
  };
}

/**
 * Distribution of the final score given the current score and the minutes left.
 * Red cards (players sent off during the match) shift the remaining expected
 * goals of both teams: the side with a man less attacks less, the side with
 * an extra man attacks more.
 * @returns {{markets: object, remaining: number, homeGoals: number, awayGoals: number}}
 */
export function projectLive({
  homeXg,
  awayXg,
  homeGoals = 0,
  awayGoals = 0,
  minute = 0,
  remaining = null,
  redsHome = 0,
  redsAway = 0,
}) {
  const rem = remaining == null ? remainingMinutes(minute) : clamp(remaining, 0, 120);
  const frac = rem / TOTAL_MATCH_MINUTES;
  const redH = clamp(redsHome, 0, 4);
  const redA = clamp(redsAway, 0, 4);
  const homeRem = Math.max(
    0,
    Number(homeXg) * frac * RED_SIM_FACTOR ** redH * RED_OPP_FACTOR ** redA
  );
  const awayRem = Math.max(
    0,
    Number(awayXg) * frac * RED_SIM_FACTOR ** redA * RED_OPP_FACTOR ** redH
  );

  const maxGoals = clamp(
    Math.ceil(Math.max(homeRem, awayRem)) + 2,
    3,
    9
  );
  const remainingMatrix = buildScoreMatrix(homeRem, awayRem, maxGoals, DIXON_COLES_RHO);

  const rows = maxGoals + homeGoals + 1;
  const cols = maxGoals + awayGoals + 1;
  const finalMatrix = [];
  for (let h = 0; h < rows; h += 1) {
    finalMatrix[h] = new Array(cols).fill(0);
  }
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      finalMatrix[h + homeGoals][a + awayGoals] += remainingMatrix[h][a];
    }
  }

  return {
    markets: marketsFromMatrix(finalMatrix),
    remaining: rem,
    homeGoals,
    awayGoals,
  };
}

/** Live probability of every market the goal model can produce. */
const LIVE_MARKET_PROB = {
  HOME_WIN: (m) => m.homeWin,
  DRAW: (m) => m.draw,
  AWAY_WIN: (m) => m.awayWin,
  OVER_15: (m) => m.over15,
  UNDER_15: (m) => m.under15,
  OVER_25: (m) => m.over25,
  UNDER_25: (m) => m.under25,
  OVER_35: (m) => m.over35,
  UNDER_35: (m) => m.under35,
  BTTS_YES: (m) => m.bttsYes,
  BTTS_NO: (m) => m.bttsNo,
  HOME_OVER_05: (m) => m.homeOver05,
  HOME_UNDER_05: (m) => m.homeUnder05,
  HOME_OVER_15: (m) => m.homeOver15,
  HOME_UNDER_15: (m) => m.homeUnder15,
  HOME_OVER_25: (m) => m.homeOver25,
  HOME_UNDER_25: (m) => m.homeUnder25,
  HOME_OVER_35: (m) => m.homeOver35,
  HOME_UNDER_35: (m) => m.homeUnder35,
  AWAY_OVER_05: (m) => m.awayOver05,
  AWAY_UNDER_05: (m) => m.awayUnder05,
  AWAY_OVER_15: (m) => m.awayOver15,
  AWAY_UNDER_15: (m) => m.awayUnder15,
  AWAY_OVER_25: (m) => m.awayOver25,
  AWAY_UNDER_25: (m) => m.awayUnder25,
  AWAY_OVER_35: (m) => m.awayOver35,
  AWAY_UNDER_35: (m) => m.awayUnder35,
};

export function liveMarketProb(label, markets) {
  const fn = LIVE_MARKET_PROB[label];
  if (!fn || !markets) return null;
  const p = Number(fn(markets));
  return Number.isFinite(p) ? p : null;
}

/**
 * Status of a pre-match tip once the match is running.
 *
 * `secured`  — mathematically decided (the outcome already happened).
 * `alive`    — still in play with a real chance.
 * `fading`   — still possible but the balance has turned against it.
 * `dead`     — mathematically lost.
 * `unknown`  — count markets (corners/cards/shots) have no live projection yet.
 */
export function liveTipStatus(label, markets) {
  const p = liveMarketProb(label, markets);
  if (p == null) return 'unknown';
  if (p >= SECURED_AT) return 'secured';
  if (p >= ALIVE_AT) return 'alive';
  if (p > DEAD_AT) return 'fading';
  return 'dead';
}

/* ------------------------------------------------------------------ *
 * Lambdas
 * ------------------------------------------------------------------ */

function modelProbs(homeXg, awayXg) {
  const matrix = buildScoreMatrix(homeXg, awayXg, 8, DIXON_COLES_RHO);
  const m = marketsFromMatrix(matrix);
  return {
    homeWin: m.homeWin,
    draw: m.draw,
    awayWin: m.awayWin,
    over25: m.over25,
    bttsYes: m.bttsYes,
  };
}

function lambdaError(homeXg, awayXg, target) {
  const p = modelProbs(homeXg, awayXg);
  let err = 0;
  err += 2 * (p.homeWin - target.homeWin) ** 2;
  err += 1.5 * (p.draw - target.draw) ** 2;
  err += 2 * (p.awayWin - target.awayWin) ** 2;
  if (target.over25 != null) err += (p.over25 - target.over25) ** 2;
  if (target.bttsYes != null) err += 0.5 * (p.bttsYes - target.bttsYes) ** 2;
  return err;
}

/**
 * Recover (homeXg, awayXg) from stored pre-match probabilities.
 *
 * Two-step fit instead of a blind grid search (the Worker CPU budget is tight):
 *  1. the total expected goals come from the O/U 2.5 probability (bisection);
 *  2. the home/away split comes from the draw probability (also bisection,
 *     since P(draw) decreases monotonically as the split moves away from 50/50);
 *  3. a small local grid around that estimate polishes both numbers.
 *
 * Used for prediction rows written before the xG columns existed.
 */
export function inferLambdas(prediction) {
  if (!prediction) return null;
  const homeWin = Number(prediction.home_win_prob ?? prediction.homeWinProb);
  const draw = Number(prediction.draw_prob ?? prediction.drawProb);
  const awayWin = Number(prediction.away_win_prob ?? prediction.awayWinProb);
  if (![homeWin, draw, awayWin].every((v) => Number.isFinite(v))) return null;

  const target = {
    homeWin,
    draw,
    awayWin,
    over25: Number.isFinite(Number(prediction.over25_prob))
      ? Number(prediction.over25_prob)
      : null,
    bttsYes: Number.isFinite(Number(prediction.btts_yes_prob))
      ? Number(prediction.btts_yes_prob)
      : null,
  };

  // 1) total expected goals
  let totalLambda = 2.5;
  if (target.over25 != null) {
    let lo = 0.2;
    let hi = 6;
    for (let i = 0; i < 34; i += 1) {
      const mid = (lo + hi) / 2;
      const p = 1 - (poissonP(0, mid) + poissonP(1, mid) + poissonP(2, mid));
      if (p > target.over25) hi = mid;
      else lo = mid;
    }
    totalLambda = (lo + hi) / 2;
  }

  // 2) home/away split from the draw probability
  const drawProbFor = (homeXg, awayXg) =>
    sumMatrix(buildScoreMatrix(homeXg, awayXg, 8, DIXON_COLES_RHO), (h, a) => h === a);
  let ratio = 0.5;
  if (drawProbFor(totalLambda / 2, totalLambda / 2) >= target.draw) {
    let lo = 0.5;
    let hi = 0.97;
    for (let i = 0; i < 26; i += 1) {
      const mid = (lo + hi) / 2;
      const p = drawProbFor(totalLambda * mid, totalLambda * (1 - mid));
      if (p > target.draw) lo = mid;
      else hi = mid;
    }
    ratio = (lo + hi) / 2;
  }

  // 3) local polish
  let best = { homeXg: totalLambda * ratio, awayXg: totalLambda * (1 - ratio), err: Infinity };
  const totals = [totalLambda - 0.16, totalLambda - 0.08, totalLambda, totalLambda + 0.08, totalLambda + 0.16];
  const ratios = [ratio - 0.06, ratio - 0.03, ratio, ratio + 0.03, ratio + 0.06];
  for (const lt of totals) {
    if (lt <= 0.2) continue;
    for (const r of ratios) {
      if (r <= 0.03 || r >= 0.97) continue;
      const homeXg = lt * r;
      const awayXg = lt * (1 - r);
      const err = lambdaError(homeXg, awayXg, target);
      if (err < best.err) best = { homeXg, awayXg, err };
    }
  }
  if (!Number.isFinite(best.err)) return null;
  return { homeXg: Number(best.homeXg.toFixed(3)), awayXg: Number(best.awayXg.toFixed(3)) };
}

/** Lambdas of a prediction row: stored xG first, inference as fallback. */
export function lambdasFor(prediction) {
  if (!prediction) return null;
  const home = Number(prediction.home_xg ?? prediction.homeXg);
  const away = Number(prediction.away_xg ?? prediction.awayXg);
  if (Number.isFinite(home) && Number.isFinite(away) && home > 0 && away > 0) {
    return { homeXg: home, awayXg: away, source: 'stored' };
  }
  const inferred = inferLambdas(prediction);
  if (!inferred) return null;
  return { ...inferred, source: 'inferred' };
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

function tipBlock(label, markets) {
  if (!label) return null;
  const prob = liveMarketProb(label, markets);
  return {
    label,
    status: liveTipStatus(label, markets),
    prob: prob == null ? null : round4(prob),
  };
}

/**
 * Live block attached to a match row.
 * Returns null when the match is not running or the model cannot be recovered.
 */
export function buildLiveBlock(match, prediction) {
  if (!match || String(match.status) !== 'live') return null;
  const snap = liveSnapshot(match);
  const lambdas = lambdasFor(prediction);
  if (!lambdas) return null;

  const projection = projectLive({
    homeXg: lambdas.homeXg,
    awayXg: lambdas.awayXg,
    homeGoals: snap.homeGoals,
    awayGoals: snap.awayGoals,
    minute: snap.minute,
    remaining: snap.remaining,
    redsHome: snap.redsHome,
    redsAway: snap.redsAway,
  });
  const markets = projection.markets;

  return {
    minute: snap.minute,
    remaining: snap.remaining,
    homeGoals: snap.homeGoals,
    awayGoals: snap.awayGoals,
    redCards: { home: snap.redsHome, away: snap.redsAway },
    homeWin: round4(markets.homeWin),
    draw: round4(markets.draw),
    awayWin: round4(markets.awayWin),
    over25: round4(markets.over25),
    under25: round4(markets.under25),
    bttsYes: round4(markets.bttsYes),
    bttsNo: round4(markets.bttsNo),
    preMatch: {
      homeWin: round4(prediction?.home_win_prob),
      draw: round4(prediction?.draw_prob),
      awayWin: round4(prediction?.away_win_prob),
    },
    lambdaSource: lambdas.source,
    tip: tipBlock(prediction?.suggested_bet, markets),
    secondary: tipBlock(prediction?.secondary_bet, markets),
  };
}
