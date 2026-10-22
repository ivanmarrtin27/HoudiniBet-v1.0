/**
 * Offline Kalman retune on a synthetic walk-forward corpus
 * (used when remote D1 quota blocks live admin backtest).
 */
import { tuneKalmanOnCorpus, runBacktestOnCorpus } from '../src/services/backtestService.js';
import { setKalmanParams, getKalmanParams } from '../src/services/ratingsService.js';

function poisson(lambda, rng) {
  const L = Math.exp(-Math.max(0.05, lambda));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build finished matches + team_stats with latent team strengths (Kalman can learn). */
function buildCorpus({ days = 60, teamsPerLeague = 16, leagues = 2, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const rows = [];
  const stats = [];
  const strengths = new Map(); // teamId -> { att, def }
  let matchId = 1;
  const start = Date.UTC(2026, 7, 1); // Aug 1 2026

  for (let lid = 1; lid <= leagues; lid += 1) {
    for (let t = 1; t <= teamsPerLeague; t += 1) {
      const tid = lid * 100 + t;
      strengths.set(tid, {
        att: 0.75 + rng() * 0.7,
        def: 0.75 + rng() * 0.7,
      });
    }
  }

  const muH = 1.4;
  const muA = 1.15;
  for (let d = 0; d < days; d += 1) {
    const dayIso = new Date(start + d * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    for (let lid = 1; lid <= leagues; lid += 1) {
      const teams = Array.from({ length: teamsPerLeague }, (_, i) => lid * 100 + i + 1);
      // shuffle
      for (let i = teams.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [teams[i], teams[j]] = [teams[j], teams[i]];
      }
      for (let i = 0; i + 1 < teams.length; i += 2) {
        const homeId = teams[i];
        const awayId = teams[i + 1];
        const hs = strengths.get(homeId);
        const as = strengths.get(awayId);
        const homeXg = Math.max(0.2, hs.att * as.def * muH);
        const awayXg = Math.max(0.2, as.att * hs.def * muA);
        const hg = poisson(homeXg, rng);
        const ag = poisson(awayXg, rng);
        const id = matchId++;
        rows.push({
          id,
          match_date: dayIso,
          league_id: lid,
          home_team_id: homeId,
          away_team_id: awayId,
          home_goals: hg,
          away_goals: ag,
          home_odds: null,
          draw_odds: null,
          away_odds: null,
          over25_odds: null,
          under25_odds: null,
          btts_yes_odds: null,
          btts_no_odds: null,
        });
        stats.push({
          team_id: homeId,
          match_id: id,
          goals_scored: hg,
          goals_conceded: ag,
          corners_for: null,
          corners_against: null,
          yellows_for: null,
          yellows_against: null,
          is_home: 1,
          match_date: dayIso,
          league_id: lid,
        });
        stats.push({
          team_id: awayId,
          match_id: id,
          goals_scored: ag,
          goals_conceded: hg,
          corners_for: null,
          corners_against: null,
          yellows_for: null,
          yellows_against: null,
          is_home: 0,
          match_date: dayIso,
          league_id: lid,
        });
      }
    }
  }

  const byTeam = new Map();
  for (const row of stats) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push(row);
  }
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => Date.parse(String(a.match_date).replace(' ', 'T')) - Date.parse(String(b.match_date).replace(' ', 'T')));
  }
  return { rows, statsIndex: { byTeam, all: stats } };
}

const corpus = buildCorpus();
const tune = tuneKalmanOnCorpus(corpus, { days: 60, holdoutDays: 14 });

// Lock best params and re-compare vs prior aggressive defaults
const prior = { Q: 0.012, R: 0.55, MIN_N_OBS: 4, strengthMin: 0.35, strengthMax: 2.4, varMin: 0.01, varMax: 0.5, varInit: 0.08 };
setKalmanParams(prior);
const priorRes = runBacktestOnCorpus(corpus, { days: 60, holdoutDays: 14, engine: 'ratings' });
setKalmanParams(tune.best?.params || null);
const bestRes = runBacktestOnCorpus(corpus, { days: 60, holdoutDays: 14, engine: 'ratings' });
const shrink = runBacktestOnCorpus(corpus, { days: 60, holdoutDays: 14, engine: 'shrinkage' });

const out = {
  recommendation: tune.recommendation,
  reason: tune.reason,
  shrinkageHoldoutBrier1x2: tune.shrinkageHoldoutBrier1x2,
  best: tune.best,
  top5: tune.trials.slice(0, 5),
  priorHoldoutBrier1x2: priorRes.holdout?.['1x2']?.brier,
  bestLockedHoldoutBrier1x2: bestRes.holdout?.['1x2']?.brier,
  shrinkRecheck: shrink.holdout?.['1x2']?.brier,
  matches: corpus.rows.length,
  activeAfter: getKalmanParams(),
};
console.log(JSON.stringify(out, null, 2));
