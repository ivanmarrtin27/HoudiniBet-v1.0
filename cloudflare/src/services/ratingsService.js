/**
 * Per-team attack/defense ratings with scalar Kalman updates.
 * λ_home = att_home × def_away × league.avgHomeScored
 * λ_away = att_away × def_home × league.avgAwayScored
 */
import * as store from '../db.js';

/**
 * Defaults from retune grid (smooth + warm-up).
 * Best offline holdout still ties/slightly behind shrinkage → ratings_live stays off.
 */
const DEFAULT_KALMAN = Object.freeze({
  Q: 0.004, // process noise
  R: 1.1, // observation noise (goals)
  MIN_N_OBS: 8, // prefer ratings only after warm-up
  strengthMin: 0.5,
  strengthMax: 1.85,
  varMin: 0.015,
  varMax: 0.35,
  varInit: 0.06,
});

let kalman = { ...DEFAULT_KALMAN };

export function getKalmanParams() {
  return { ...kalman };
}

/** Override tunables for backtest / retune. Pass null/undefined to reset defaults. */
export function setKalmanParams(partial) {
  if (partial == null) {
    kalman = { ...DEFAULT_KALMAN };
    return getKalmanParams();
  }
  const next = { ...kalman };
  for (const key of Object.keys(DEFAULT_KALMAN)) {
    if (partial[key] != null && Number.isFinite(Number(partial[key]))) {
      next[key] = Number(partial[key]);
    }
  }
  kalman = next;
  return getKalmanParams();
}

function clampStrength(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  return Math.min(kalman.strengthMax, Math.max(kalman.strengthMin, n));
}

function clampVar(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return kalman.varInit;
  return Math.min(kalman.varMax, Math.max(kalman.varMin, n));
}

export function defaultRating(teamId, leagueId) {
  return {
    team_id: teamId,
    league_id: leagueId,
    attack: 1,
    defense: 1,
    var_att: kalman.varInit,
    var_def: kalman.varInit,
    n_obs: 0,
    updated_at: null,
  };
}

/** One-sided Kalman update: strength multiplies into Poisson λ. */
function updateStrength(strength, variance, goals, oppStrength, leagueAvg) {
  const H = Math.max(0.2, Number(oppStrength) * Number(leagueAvg || 1.25));
  const predicted = Math.max(0.15, Number(strength) * H);
  const Ppri = clampVar(variance) + kalman.Q;
  const K = Ppri / (Ppri + kalman.R);
  const innov = Number(goals) - predicted;
  const next = clampStrength(Number(strength) + (K * innov) / H);
  const nextVar = clampVar((1 - K) * Ppri);
  return { strength: next, variance: nextVar };
}

export function lambdasFromRatings(homeR, awayR, league) {
  const muH = league?.avgHomeScored || 1.35;
  const muA = league?.avgAwayScored || 1.15;
  const ha = clampStrength(homeR?.attack ?? 1);
  const hd = clampStrength(homeR?.defense ?? 1);
  const aa = clampStrength(awayR?.attack ?? 1);
  const ad = clampStrength(awayR?.defense ?? 1);
  return {
    homeXg: Math.max(0.15, ha * ad * muH),
    awayXg: Math.max(0.15, aa * hd * muA),
    nHome: Number(homeR?.n_obs || 0),
    nAway: Number(awayR?.n_obs || 0),
  };
}

export function ratingsReady(homeR, awayR) {
  const minN = kalman.MIN_N_OBS;
  return Number(homeR?.n_obs || 0) >= minN && Number(awayR?.n_obs || 0) >= minN;
}

export async function getOrInitRating(db, teamId, leagueId) {
  const existing = await store.getTeamRating(db, teamId, leagueId);
  if (existing) {
    return {
      team_id: existing.team_id,
      league_id: existing.league_id,
      attack: clampStrength(existing.attack),
      defense: clampStrength(existing.defense),
      var_att: clampVar(existing.var_att),
      var_def: clampVar(existing.var_def),
      n_obs: Number(existing.n_obs || 0),
      updated_at: existing.updated_at,
    };
  }
  return defaultRating(teamId, leagueId);
}

/**
 * Update both teams from a finished match. Mutates in-memory maps if provided.
 * @returns {{ home, away }}
 */
export function updateRatingsFromMatch(homeR, awayR, homeGoals, awayGoals, league) {
  const muH = league?.avgHomeScored || 1.35;
  const muA = league?.avgAwayScored || 1.15;
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);
  if (!Number.isFinite(hg) || !Number.isFinite(ag)) return { home: homeR, away: awayR };

  // Home attack vs away defense (home goals)
  const homeAtt = updateStrength(homeR.attack, homeR.var_att, hg, awayR.defense, muH);
  // Away defense vs home attack (home goals conceded by away)
  const awayDef = updateStrength(awayR.defense, awayR.var_def, hg, homeR.attack, muH);
  // Away attack vs home defense (away goals)
  const awayAtt = updateStrength(awayR.attack, awayR.var_att, ag, homeR.defense, muA);
  // Home defense vs away attack
  const homeDef = updateStrength(homeR.defense, homeR.var_def, ag, awayR.attack, muA);

  const now = new Date().toISOString();
  return {
    home: {
      ...homeR,
      attack: homeAtt.strength,
      defense: homeDef.strength,
      var_att: homeAtt.variance,
      var_def: homeDef.variance,
      n_obs: Number(homeR.n_obs || 0) + 1,
      updated_at: now,
    },
    away: {
      ...awayR,
      attack: awayAtt.strength,
      defense: awayDef.strength,
      var_att: awayAtt.variance,
      var_def: awayDef.variance,
      n_obs: Number(awayR.n_obs || 0) + 1,
      updated_at: now,
    },
  };
}

export async function persistRating(db, rating) {
  await store.upsertTeamRating(db, {
    team_id: rating.team_id,
    league_id: rating.league_id,
    attack: rating.attack,
    defense: rating.defense,
    var_att: rating.var_att,
    var_def: rating.var_def,
    n_obs: rating.n_obs,
    updated_at: rating.updated_at || new Date().toISOString(),
  });
}

/** Apply Kalman update for one finished match and persist. */
export async function updateRatingsForFinishedMatch(db, match) {
  const leagueId = match.league_id ?? match.leagueId;
  const homeId = match.home_team_id ?? match.homeTeamId;
  const awayId = match.away_team_id ?? match.awayTeamId;
  const hg = match.home_goals ?? match.homeGoals;
  const ag = match.away_goals ?? match.awayGoals;
  if (leagueId == null || homeId == null || awayId == null) return null;
  if (hg == null || ag == null) return null;

  const before = String(match.match_date || match.matchDate || '').slice(0, 19);
  const league = before
    ? await store.leagueGoalAveragesAsOf(db, leagueId, before)
    : await store.leagueGoalAverages(db, leagueId);

  let home = await getOrInitRating(db, homeId, leagueId);
  let away = await getOrInitRating(db, awayId, leagueId);
  const next = updateRatingsFromMatch(home, away, hg, ag, league);
  await persistRating(db, next.home);
  await persistRating(db, next.away);
  return next;
}

/**
 * Walk finished matches oldest→newest and rebuild ratings (chunked).
 */
export async function backfillRatings(db, { days = 60, limit = 400 } = {}) {
  const rows = await store.listFinishedForBacktest(db, { days, limit });
  const cache = new Map(); // `${teamId}:${leagueId}` → rating
  const leagueCache = new Map();
  let updated = 0;

  const key = (tid, lid) => `${tid}:${lid}`;

  for (const m of rows) {
    const lid = m.league_id;
    let league = leagueCache.get(`${lid}|${m.match_date}`);
    if (!league) {
      league = await store.leagueGoalAveragesAsOf(db, lid, m.match_date);
      leagueCache.set(`${lid}|${m.match_date}`, league);
    }
    let home = cache.get(key(m.home_team_id, lid)) || defaultRating(m.home_team_id, lid);
    let away = cache.get(key(m.away_team_id, lid)) || defaultRating(m.away_team_id, lid);
    const next = updateRatingsFromMatch(home, away, m.home_goals, m.away_goals, league);
    cache.set(key(m.home_team_id, lid), next.home);
    cache.set(key(m.away_team_id, lid), next.away);
    updated += 1;
  }

  for (const r of cache.values()) {
    await persistRating(db, r);
  }
  const lastDate = rows.length ? rows[rows.length - 1].match_date : null;
  if (lastDate) await store.setMeta(db, 'ratings_watermark', String(lastDate).slice(0, 19));
  return { matches: rows.length, ratings: cache.size, updated, watermark: lastDate };
}

/** Apply ratings for finished matches after watermark (exactly once each). */
export async function advanceRatingsWatermark(db, limit = 50) {
  const wm = (await store.getMeta(db, 'ratings_watermark')) || '1970-01-01T00:00:00';
  const rows = await store.listFinishedAfterWatermark(db, wm, limit);
  let n = 0;
  for (const m of rows) {
    await updateRatingsForFinishedMatch(db, m);
    await store.setMeta(db, 'ratings_watermark', String(m.match_date).slice(0, 19));
    n += 1;
  }
  return { advanced: n, watermark: rows.length ? rows[rows.length - 1].match_date : wm };
}

/** Ensure ratings exist: full backfill if empty, else advance watermark. */
export async function maintainTeamRatings(db) {
  try {
    const c = await store.countTeamRatings(db);
    if (c === 0) return { mode: 'backfill', ...(await backfillRatings(db, { days: 60, limit: 400 })) };
    return { mode: 'advance', ...(await advanceRatingsWatermark(db, 60)) };
  } catch (err) {
    return { mode: 'skip', error: err.message || String(err) };
  }
}
