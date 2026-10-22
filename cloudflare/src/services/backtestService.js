/**
 * As-of walk-forward backtest: Brier / log-loss on 1X2, O/U 2.5, BTTS.
 * Bulk-loads matches + team_stats once (Worker D1 subrequest limit).
 */
import * as store from '../db.js';
import {
  estimateLambdas,
  buildScoreMatrix,
  marketsFromMatrix,
} from './matchModel.js';
import {
  defaultRating,
  updateRatingsFromMatch,
  lambdasFromRatings,
  ratingsReady,
  setKalmanParams,
  getKalmanParams,
} from './ratingsService.js';

function clamp01(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 1e-6;
  return Math.min(1 - 1e-6, Math.max(1e-6, n));
}

function brierMulti(probs, outcomeIdx) {
  let s = 0;
  for (let i = 0; i < probs.length; i += 1) {
    const y = i === outcomeIdx ? 1 : 0;
    const e = clamp01(probs[i]) - y;
    s += e * e;
  }
  return s;
}

function brierBinary(p, y) {
  const e = clamp01(p) - y;
  return e * e;
}

function logLossMulti(probs, outcomeIdx) {
  return -Math.log(clamp01(probs[outcomeIdx]));
}

function logLossBinary(p, y) {
  const pp = clamp01(p);
  return y ? -Math.log(pp) : -Math.log(1 - pp);
}

function impliedProbs(odds) {
  const o = odds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 1);
  if (o.length !== odds.length) return null;
  const inv = o.map((x) => 1 / x);
  const s = inv.reduce((a, b) => a + b, 0);
  if (s <= 0) return null;
  return inv.map((x) => x / s);
}

function emptyAgg() {
  return { n: 0, brier: 0, logloss: 0 };
}

function pushAgg(agg, b, ll) {
  agg.n += 1;
  agg.brier += b;
  agg.logloss += ll;
}

function finalizeAgg(agg) {
  if (!agg.n) return { n: 0, brier: null, logloss: null };
  return {
    n: agg.n,
    brier: Number((agg.brier / agg.n).toFixed(5)),
    logloss: Number((agg.logloss / agg.n).toFixed(5)),
  };
}

function matchTs(dateStr) {
  return Date.parse(String(dateStr || '').replace(' ', 'T'));
}

/** Index stats by team for O(1) as-of slices. */
function buildStatsIndex(statsRows) {
  const byTeam = new Map();
  for (const row of statsRows) {
    const tid = row.team_id;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid).push(row);
  }
  // Ensure ascending by date within each team
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => matchTs(a.match_date) - matchTs(b.match_date));
  }
  return { byTeam, all: statsRows };
}

function lastNAsOf(index, teamId, n, beforeDate) {
  const arr = index.byTeam.get(teamId) || [];
  const before = matchTs(beforeDate);
  const out = [];
  for (let i = arr.length - 1; i >= 0 && out.length < n; i -= 1) {
    const ts = matchTs(arr[i].match_date);
    if (Number.isFinite(before) && Number.isFinite(ts) && ts >= before) continue;
    out.push(arr[i]);
  }
  return out;
}

function leagueAvgsAsOf(index, leagueId, beforeDate) {
  const before = matchTs(beforeDate);
  let homeSum = 0;
  let homeN = 0;
  let awaySum = 0;
  let awayN = 0;
  let scoredSum = 0;
  let concededSum = 0;
  let n = 0;
  let cornersFor = 0;
  let cornersAgainst = 0;
  let cornersN = 0;
  let yellowsFor = 0;
  let yellowsAgainst = 0;
  let yellowsN = 0;
  for (const row of index.all) {
    if (Number(row.league_id) !== Number(leagueId)) continue;
    const ts = matchTs(row.match_date);
    if (Number.isFinite(before) && Number.isFinite(ts) && ts >= before) continue;
    const gs = Number(row.goals_scored);
    const gc = Number(row.goals_conceded);
    if (!Number.isFinite(gs)) continue;
    scoredSum += gs;
    concededSum += Number.isFinite(gc) ? gc : 0;
    n += 1;
    if (row.is_home) {
      homeSum += gs;
      homeN += 1;
    } else {
      awaySum += gs;
      awayN += 1;
    }
    if (row.corners_for != null) {
      cornersFor += Number(row.corners_for) || 0;
      cornersAgainst += Number(row.corners_against) || 0;
      cornersN += 1;
    }
    if (row.yellows_for != null) {
      yellowsFor += Number(row.yellows_for) || 0;
      yellowsAgainst += Number(row.yellows_against) || 0;
      yellowsN += 1;
    }
  }
  return {
    avgHomeScored: homeN ? homeSum / homeN : 1.35,
    avgAwayScored: awayN ? awaySum / awayN : 1.15,
    avgScored: n ? scoredSum / n : 1.25,
    avgConceded: n ? concededSum / n : 1.25,
    avgCornersFor: cornersN ? cornersFor / cornersN : 5.0,
    avgCornersAgainst: cornersN ? cornersAgainst / cornersN : 5.0,
    avgYellowsFor: yellowsN ? yellowsFor / yellowsN : 2.0,
    avgYellowsAgainst: yellowsN ? yellowsAgainst / yellowsN : 2.0,
  };
}

function lambdasForEngine(engine, m, league, ratingCache, statsIndex) {
  if (engine === 'league') {
    return {
      homeXg: league.avgHomeScored || 1.35,
      awayXg: league.avgAwayScored || 1.15,
      nHome: 0,
      nAway: 0,
    };
  }

  if (engine === 'ratings') {
    const key = (tid) => `${tid}:${m.league_id}`;
    const home = ratingCache.get(key(m.home_team_id)) || defaultRating(m.home_team_id, m.league_id);
    const away = ratingCache.get(key(m.away_team_id)) || defaultRating(m.away_team_id, m.league_id);
    if (!ratingsReady(home, away)) {
      const homeStats = lastNAsOf(statsIndex, m.home_team_id, 10, m.match_date);
      const awayStats = lastNAsOf(statsIndex, m.away_team_id, 10, m.match_date);
      return estimateLambdas(homeStats, awayStats, league);
    }
    return lambdasFromRatings(home, away, league);
  }

  const homeStats = lastNAsOf(statsIndex, m.home_team_id, 10, m.match_date);
  const awayStats = lastNAsOf(statsIndex, m.away_team_id, 10, m.match_date);
  return estimateLambdas(homeStats, awayStats, league);
}

/**
 * @param {'shrinkage'|'league'|'ratings'|'book'} engine
 * @param {{ rows: any[], statsIndex: ReturnType<typeof buildStatsIndex> }} corpus
 */
export function runBacktestOnCorpus(corpus, { days = 60, holdoutDays = 14, engine = 'shrinkage' } = {}) {
  const { rows, statsIndex } = corpus;
  if (!rows.length) {
    return { ok: true, engine, n: 0, message: 'Sin partidos finished en la ventana.' };
  }

  const holdMs = Math.max(0, Number(holdoutDays) || 14) * 86400000;
  const lastTs = matchTs(rows[rows.length - 1].match_date);
  const holdStart = Number.isFinite(lastTs) ? lastTs - holdMs : 0;

  const ratingCache = new Map();
  const leagueCache = new Map();

  const train = { x1x2: emptyAgg(), ou25: emptyAgg(), btts: emptyAgg() };
  const hold = { x1x2: emptyAgg(), ou25: emptyAgg(), btts: emptyAgg() };

  let scored = 0;
  let scoredHold = 0;
  let bookScored = 0;

  for (const m of rows) {
    const ts = matchTs(m.match_date);
    const inHold = Number.isFinite(ts) && ts >= holdStart;
    const agg = inHold ? hold : train;

    const lk = `${m.league_id}|${m.match_date}`;
    let league = leagueCache.get(lk);
    if (!league) {
      league = leagueAvgsAsOf(statsIndex, m.league_id, m.match_date);
      leagueCache.set(lk, league);
    }

    let markets = null;
    if (engine === 'book') {
      const p1x2 = impliedProbs([m.home_odds, m.draw_odds, m.away_odds]);
      const pou = impliedProbs([m.over25_odds, m.under25_odds]);
      const pb = impliedProbs([m.btts_yes_odds, m.btts_no_odds]);
      if (p1x2) {
        bookScored += 1;
        markets = {
          homeWin: p1x2[0],
          draw: p1x2[1],
          awayWin: p1x2[2],
          over25: pou ? pou[0] : null,
          under25: pou ? pou[1] : null,
          bttsYes: pb ? pb[0] : null,
          bttsNo: pb ? pb[1] : null,
        };
      }
    } else {
      const { homeXg, awayXg } = lambdasForEngine(engine, m, league, ratingCache, statsIndex);
      const matrix = buildScoreMatrix(homeXg, awayXg, 8, -0.08);
      markets = marketsFromMatrix(matrix);
    }

    if (!markets) continue;

    const hg = Number(m.home_goals);
    const ag = Number(m.away_goals);
    const xIdx = hg > ag ? 0 : hg === ag ? 1 : 2;
    const probs1x2 = [markets.homeWin, markets.draw, markets.awayWin];
    pushAgg(agg.x1x2, brierMulti(probs1x2, xIdx), logLossMulti(probs1x2, xIdx));

    if (markets.over25 != null) {
      const yOu = hg + ag > 2 ? 1 : 0;
      pushAgg(agg.ou25, brierBinary(markets.over25, yOu), logLossBinary(markets.over25, yOu));
    }
    if (markets.bttsYes != null) {
      const yB = hg > 0 && ag > 0 ? 1 : 0;
      pushAgg(agg.btts, brierBinary(markets.bttsYes, yB), logLossBinary(markets.bttsYes, yB));
    }

    scored += 1;
    if (inHold) scoredHold += 1;

    if (engine === 'ratings') {
      const key = (tid) => `${tid}:${m.league_id}`;
      const home = ratingCache.get(key(m.home_team_id)) || defaultRating(m.home_team_id, m.league_id);
      const away = ratingCache.get(key(m.away_team_id)) || defaultRating(m.away_team_id, m.league_id);
      const next = updateRatingsFromMatch(home, away, hg, ag, league);
      ratingCache.set(key(m.home_team_id), next.home);
      ratingCache.set(key(m.away_team_id), next.away);
    }
  }

  return {
    ok: true,
    engine,
    days,
    holdoutDays,
    matches: rows.length,
    scored,
    scoredHold,
    bookScored: engine === 'book' ? bookScored : undefined,
    train: {
      '1x2': finalizeAgg(train.x1x2),
      ou25: finalizeAgg(train.ou25),
      btts: finalizeAgg(train.btts),
    },
    holdout: {
      '1x2': finalizeAgg(hold.x1x2),
      ou25: finalizeAgg(hold.ou25),
      btts: finalizeAgg(hold.btts),
    },
  };
}

async function loadCorpus(db, { days = 60, limit = 400 } = {}) {
  const [rows, statsRows] = await Promise.all([
    store.listFinishedForBacktest(db, { days, limit }),
    store.listTeamStatsForBacktest(db, { days }),
  ]);
  return { rows, statsIndex: buildStatsIndex(statsRows) };
}

/**
 * @param {'shrinkage'|'league'|'ratings'|'book'} engine
 */
export async function runBacktest(db, opts = {}) {
  const corpus = await loadCorpus(db, opts);
  return runBacktestOnCorpus(corpus, opts);
}

/** Compact grid for Worker CPU / offline retune. */
const TUNE_GRID = [
  { Q: 0.004, R: 1.1, MIN_N_OBS: 8 }, // locked default (best so far)
  { Q: 0.004, R: 0.8, MIN_N_OBS: 6 },
  { Q: 0.006, R: 0.95, MIN_N_OBS: 8 },
  { Q: 0.006, R: 1.2, MIN_N_OBS: 10 },
  { Q: 0.008, R: 0.7, MIN_N_OBS: 6 },
  { Q: 0.008, R: 1.0, MIN_N_OBS: 8 },
  { Q: 0.01, R: 1.3, MIN_N_OBS: 10 },
  { Q: 0.012, R: 0.55, MIN_N_OBS: 4 }, // original pre-retune
  { Q: 0.015, R: 0.9, MIN_N_OBS: 8 },
  { Q: 0.02, R: 1.4, MIN_N_OBS: 10 },
];

/**
 * Grid-search Kalman params on one corpus; restores previous params after.
 * Ranked by holdout 1X2 Brier (lower better).
 */
export function tuneKalmanOnCorpus(corpus, opts = {}) {
  const saved = getKalmanParams();
  const shrinkage = runBacktestOnCorpus(corpus, { ...opts, engine: 'shrinkage' });
  const baselineBrier = shrinkage?.holdout?.['1x2']?.brier;
  const trials = [];
  try {
    for (const params of TUNE_GRID) {
      setKalmanParams({
        ...params,
        strengthMin: 0.5,
        strengthMax: 1.85,
        varMin: 0.015,
        varMax: 0.35,
        varInit: 0.06,
      });
      const res = runBacktestOnCorpus(corpus, { ...opts, engine: 'ratings' });
      const brier = res?.holdout?.['1x2']?.brier;
      trials.push({
        params: getKalmanParams(),
        holdoutBrier1x2: brier,
        holdoutN: res?.holdout?.['1x2']?.n ?? 0,
        deltaVsShrinkage:
          brier != null && baselineBrier != null
            ? Number((brier - baselineBrier).toFixed(5))
            : null,
      });
    }
  } finally {
    setKalmanParams(saved);
  }
  trials.sort((a, b) => {
    if (a.holdoutBrier1x2 == null) return 1;
    if (b.holdoutBrier1x2 == null) return -1;
    return a.holdoutBrier1x2 - b.holdoutBrier1x2;
  });
  const best = trials[0] || null;
  let recommendation = 'keep_shrinkage';
  let reason = 'Datos insuficientes en holdout.';
  if (best?.holdoutBrier1x2 != null && baselineBrier != null) {
    if (best.holdoutBrier1x2 < baselineBrier) {
      recommendation = 'enable_ratings';
      reason = `Mejor Kalman Brier 1X2 holdout ${best.holdoutBrier1x2} < shrinkage ${baselineBrier}.`;
    } else {
      recommendation = 'keep_shrinkage';
      reason = `Ningún set mejora shrinkage (mejor ${best.holdoutBrier1x2} ≥ ${baselineBrier}).`;
    }
  }
  return {
    ok: true,
    tune: true,
    shrinkageHoldoutBrier1x2: baselineBrier,
    shrinkageHoldoutN: shrinkage?.holdout?.['1x2']?.n ?? 0,
    best,
    trials,
    recommendation,
    reason,
    activeParams: getKalmanParams(),
  };
}

/** Run shrinkage + league + ratings (+ book if enough odds) and compare holdout Brier 1X2. */
export async function runBacktestSuite(db, opts = {}) {
  const allowed = new Set(['shrinkage', 'league', 'ratings', 'book']);
  let engines = ['shrinkage', 'league', 'ratings', 'book'];
  if (Array.isArray(opts.modes) && opts.modes.length) {
    engines = opts.modes.map(String).filter((m) => allowed.has(m));
    if (!engines.length) engines = ['shrinkage', 'ratings'];
  }
  const corpus = await loadCorpus(db, opts);

  if (opts.tune) {
    return tuneKalmanOnCorpus(corpus, opts);
  }

  const saved = getKalmanParams();
  if (opts.kalman && typeof opts.kalman === 'object') {
    setKalmanParams(opts.kalman);
  }
  try {
    const results = {};
    for (const engine of engines) {
      results[engine] = runBacktestOnCorpus(corpus, { ...opts, engine });
    }
    const holdBrier = (eng) => results[eng]?.holdout?.['1x2']?.brier;
    const a = holdBrier('shrinkage');
    const r = holdBrier('ratings');
    let recommendation = 'keep_shrinkage';
    let reason = 'Datos insuficientes en holdout.';
    if (a != null && r != null) {
      if (r < a) {
        recommendation = 'enable_ratings';
        reason = `Ratings mejora Brier 1X2 holdout (${r} < ${a}).`;
      } else {
        recommendation = 'keep_shrinkage';
        reason = `Ratings no mejora Brier 1X2 holdout (${r} ≥ ${a}); live sigue con shrinkage.`;
      }
    }
    return {
      ok: true,
      results,
      recommendation,
      reason,
      kalmanParams: getKalmanParams(),
    };
  } finally {
    setKalmanParams(saved);
  }
}
