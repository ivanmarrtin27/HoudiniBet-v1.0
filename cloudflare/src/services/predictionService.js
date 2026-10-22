import * as store from '../db.js';
import { resolveTipOdds, TRIVIAL_GOAL_TIPS } from './oddsBands.js';
import {
  applyCalibrationToCandidates,
  isFamilyBlocked,
  loadTipCalibration,
  tipFamily,
} from './calibration.js';
import {
  estimateLambdas,
  buildScoreMatrix,
  marketsFromMatrix,
  allGoalCandidatesFromMarkets,
  CORE_MARKETS,
  poissonP,
  weightedAvg,
} from './matchModel.js';
import {
  getOrInitRating,
  lambdasFromRatings,
  ratingsReady,
} from './ratingsService.js';
import { buildLiveBlock } from './liveModel.js';

export { TRIVIAL_GOAL_TIPS };

const MIN_TIP_PROB = 0.48;
const MAX_TIP_PROB = 0.78;
const MIN_VALUE = 0.04;
const MIN_DRAW_PROB = 0.32;
const MIN_1X2_TIP_PROB = 0.44;
const MAX_1X2_TIP_PROB = 0.85;
const MIN_SAMPLE_FOR_TIP = 3;
/** Count markets need denser enriched history before they can be tips. */
const EXTRA_MARKET_MIN_N = 4;

const BOOK_ODDS_MAP = {
  HOME_WIN: 'home_odds',
  DRAW: 'draw_odds',
  AWAY_WIN: 'away_odds',
  OVER_15: 'over15_odds',
  UNDER_15: 'under15_odds',
  OVER_25: 'over25_odds',
  UNDER_25: 'under25_odds',
  OVER_35: 'over35_odds',
  UNDER_35: 'under35_odds',
  BTTS_YES: 'btts_yes_odds',
  BTTS_NO: 'btts_no_odds',
  SHOTS_OVER_225: 'shots_over225_odds',
  SHOTS_UNDER_225: 'shots_under225_odds',
  SHOTS_OVER_255: 'shots_over255_odds',
  SHOTS_UNDER_255: 'shots_under255_odds',
  SOT_OVER_75: 'sot_over75_odds',
  SOT_UNDER_75: 'sot_under75_odds',
  SOT_OVER_85: 'sot_over85_odds',
  SOT_UNDER_85: 'sot_under85_odds',
  SOT_OVER_95: 'sot_over95_odds',
  SOT_UNDER_95: 'sot_under95_odds',
  CORNERS_OVER_85: 'corners_over85_odds',
  CORNERS_UNDER_85: 'corners_under85_odds',
  CORNERS_OVER_95: 'corners_over95_odds',
  CORNERS_UNDER_95: 'corners_under95_odds',
  CORNERS_OVER_105: 'corners_over105_odds',
  CORNERS_UNDER_105: 'corners_under105_odds',
  CARDS_OVER_35: 'cards_over35_odds',
  CARDS_UNDER_35: 'cards_under35_odds',
  CARDS_OVER_45: 'cards_over45_odds',
  CARDS_UNDER_45: 'cards_under45_odds',
};

function avg(arr, key) {
  if (!arr.length) return null;
  const vals = arr
    .map((x) => x[key])
    .filter((v) => v != null && v !== '' && !Number.isNaN(Number(v)))
    .map((v) => Number(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function hasCornerSamples(stats, min = EXTRA_MARKET_MIN_N) {
  const n = stats.filter((s) => s.corners_for != null && s.corners_against != null).length;
  return n >= min;
}

function hasCardSamples(stats, min = EXTRA_MARKET_MIN_N) {
  const n = stats.filter((s) => s.yellows_for != null && s.yellows_against != null).length;
  return n >= min;
}

function hasShotSamples(stats, min = EXTRA_MARKET_MIN_N) {
  const n = stats.filter((s) => s.shots_for != null && s.shots_against != null).length;
  return n >= min;
}

function hasSotSamples(stats, min = EXTRA_MARKET_MIN_N) {
  const n = stats.filter(
    (s) => s.shots_on_target_for != null && s.shots_on_target_against != null
  ).length;
  return n >= min;
}

function countStatSamples(stats, key) {
  return stats.filter((s) => s[key] != null && s[key] !== '' && Number.isFinite(Number(s[key])))
    .length;
}

/** Pull small samples toward league-average strength (ratio 1). */
function shrinkStrength(teamAvg, leagueAvg, n, pseudoSamples = 3) {
  if (teamAvg == null || !leagueAvg || n <= 0) return 1;
  const ratio = Number(teamAvg) / Number(leagueAvg);
  if (!Number.isFinite(ratio)) return 1;
  return (n * ratio + pseudoSamples) / (n + pseudoSamples);
}

function strength(teamAvg, leagueAvg, fallback = 1) {
  if (teamAvg == null || !leagueAvg) return fallback;
  return teamAvg / leagueAvg;
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
  if (String(label).startsWith('HOME_') || String(label).startsWith('AWAY_')) {
    return 'goles_equipo';
  }
  if (String(label).startsWith('CORNERS_')) return 'corners';
  if (String(label).startsWith('CARDS_')) return 'cards';
  if (String(label).startsWith('SHOTS_')) return 'shots';
  if (String(label).startsWith('SOT_')) return 'shots_on_target';
  return 'other';
}

function impliedProb(odds) {
  const o = Number(odds);
  if (!o || o <= 1) return null;
  return 1 / o;
}

/** Remove overround from 1X2 (or any mutually exclusive subset) proportionally. */
function fairImpliedFromOdds(oddsMap, labels) {
  const raw = {};
  let sum = 0;
  for (const lab of labels) {
    const p = impliedProb(oddsMap[lab]);
    if (p == null) return null;
    raw[lab] = p;
    sum += p;
  }
  if (sum <= 0) return null;
  const fair = {};
  for (const lab of labels) fair[lab] = raw[lab] / sum;
  return fair;
}

function bookOddsForLabel(oddsRow, label) {
  if (!oddsRow || !label) return null;
  const field = BOOK_ODDS_MAP[label];
  if (!field) return null;
  const n = Number(oddsRow[field]);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * EV vs book (fair 1X2 when possible). Edge = modelProb - fairImplied.
 */
function computeValue(candidates, oddsRow) {
  if (!oddsRow) return { value_edge: null, value_market: null, byLabel: {} };

  const oddsMap = {};
  for (const [lab, field] of Object.entries(BOOK_ODDS_MAP)) {
    const n = Number(oddsRow[field]);
    if (Number.isFinite(n) && n > 1) oddsMap[lab] = n;
  }

  const fair1x2 = fairImpliedFromOdds(oddsMap, ['HOME_WIN', 'DRAW', 'AWAY_WIN']);
  const fairOu = fairImpliedFromOdds(oddsMap, ['OVER_25', 'UNDER_25']);
  const fairBtts = fairImpliedFromOdds(oddsMap, ['BTTS_YES', 'BTTS_NO']);
  const fairShots225 = fairImpliedFromOdds(oddsMap, ['SHOTS_OVER_225', 'SHOTS_UNDER_225']);
  const fairShots255 = fairImpliedFromOdds(oddsMap, ['SHOTS_OVER_255', 'SHOTS_UNDER_255']);
  const fairSot75 = fairImpliedFromOdds(oddsMap, ['SOT_OVER_75', 'SOT_UNDER_75']);
  const fairSot85 = fairImpliedFromOdds(oddsMap, ['SOT_OVER_85', 'SOT_UNDER_85']);
  const fairSot95 = fairImpliedFromOdds(oddsMap, ['SOT_OVER_95', 'SOT_UNDER_95']);
  const fairCorners85 = fairImpliedFromOdds(oddsMap, ['CORNERS_OVER_85', 'CORNERS_UNDER_85']);
  const fairCorners95 = fairImpliedFromOdds(oddsMap, ['CORNERS_OVER_95', 'CORNERS_UNDER_95']);
  const fairCorners105 = fairImpliedFromOdds(oddsMap, ['CORNERS_OVER_105', 'CORNERS_UNDER_105']);
  const fairCards35 = fairImpliedFromOdds(oddsMap, ['CARDS_OVER_35', 'CARDS_UNDER_35']);
  const fairCards45 = fairImpliedFromOdds(oddsMap, ['CARDS_OVER_45', 'CARDS_UNDER_45']);

  const byLabel = {};
  let best = null;
  for (const c of candidates) {
    const book = oddsMap[c.label];
    if (book == null) continue;
    let fair =
      fair1x2?.[c.label] ??
      fairOu?.[c.label] ??
      fairBtts?.[c.label] ??
      fairShots225?.[c.label] ??
      fairShots255?.[c.label] ??
      fairSot75?.[c.label] ??
      fairSot85?.[c.label] ??
      fairSot95?.[c.label] ??
      fairCorners85?.[c.label] ??
      fairCorners95?.[c.label] ??
      fairCorners105?.[c.label] ??
      fairCards35?.[c.label] ??
      fairCards45?.[c.label] ??
      impliedProb(book);
    if (fair == null) continue;
    const edge = Number(c.prob) - fair;
    byLabel[c.label] = { edge, book, fair };
    if (edge >= MIN_VALUE && (!best || edge > best.edge)) {
      best = { edge, market: c.label };
    }
  }
  return best
    ? { value_edge: Number(best.edge.toFixed(4)), value_market: best.market, byLabel }
    : { value_edge: null, value_market: null, byLabel };
}

function isExtraFamily(label) {
  const f = familyOf(label);
  return f === 'shots' || f === 'shots_on_target' || f === 'corners' || f === 'cards';
}

function tipProbabilityAllowed(candidate, { valueCandidate = false } = {}) {
  const prob = Number(candidate?.prob);
  if (!Number.isFinite(prob)) return false;
  if (candidate.label === 'HOME_WIN' || candidate.label === 'AWAY_WIN') {
    return prob >= MIN_1X2_TIP_PROB && prob <= MAX_1X2_TIP_PROB;
  }
  const min = valueCandidate ? 0.4 : MIN_TIP_PROB;
  return prob >= min && prob <= MAX_TIP_PROB &&
    (candidate.label !== 'DRAW' || prob >= MIN_DRAW_PROB);
}

function dailyQuotaCandidates(candidates, dailyTipContext) {
  if (!dailyTipContext || dailyTipContext.fixtureCount <= 0) return candidates;
  const cap = Math.max(1, Number(dailyTipContext.maxPerLabel) || 1);
  const underCap = candidates.filter(
    (candidate) => (Number(dailyTipContext.counts?.[candidate.label]) || 0) < cap
  );
  // If every viable market is already at quota, keep a recommendation and
  // let the rank malus below prefer the least-used available label.
  return underCap.length ? underCap : candidates;
}

function dailyFamilyCount(label, dailyTipContext) {
  if (!dailyTipContext) return 0;
  const family = familyOf(label);
  return Object.entries(dailyTipContext.counts || {}).reduce(
    (sum, [bet, count]) => sum + (familyOf(bet) === family ? Number(count) || 0 : 0),
    0
  );
}

function compareTipCandidates(a, b, value, dailyTipContext) {
  const score = (candidate) => {
    const edge = value.byLabel?.[candidate.label]?.edge;
    const base = edge != null ? Number(edge) : -1;
    if (!dailyTipContext || dailyTipContext.fixtureCount <= 0) return base;
    const cap = Math.max(1, Number(dailyTipContext.maxPerLabel) || 1);
    const count = Number(dailyTipContext.counts?.[candidate.label]) || 0;
    const excess = Math.max(0, count + 1 - cap);
    return base - Math.min(0.1, excess * 0.02);
  };
  const scoreDiff = score(b) - score(a);
  // When candidates are within 2pp, use family frequency as a deterministic
  // tiebreak so 1X2/count markets can edge out an overrepresented goals family.
  if (Math.abs(scoreDiff) > 0.02) return scoreDiff;
  const familyDiff =
    dailyFamilyCount(a.label, dailyTipContext) - dailyFamilyCount(b.label, dailyTipContext);
  if (familyDiff) return familyDiff;
  return scoreDiff || Number(b.prob) - Number(a.prob);
}

/**
 * Book-first tip selection:
 * 1) Best EV among core markets with book odds
 * 2) If hasBook: soft fallback only among labels that have book cuota
 * 3) Else highest core model prob
 * Extras (shots/corners/cards): secondary (or primary when no core book but extra has book+edge)
 */
function pickBets(candidates, value, calib = null, opts = {}) {
  const {
    hasBook = false,
    sampleSize = 0,
    shotCandidates = [],
    extraCandidates = null,
    dailyTipContext = null,
  } = opts;
  const nonTrivial = candidates.filter((c) => !TRIVIAL_GOAL_TIPS.has(c.label));
  const familyOk = (c) => {
    if (!calib) return true;
    return !isFamilyBlocked(calib, tipFamily(c.label));
  };

  const core = nonTrivial.filter((c) => CORE_MARKETS.has(c.label)).filter(familyOk);
  const extras = (extraCandidates || shotCandidates || []).filter(familyOk);
  const annotate = (c) => {
    const meta = value.byLabel?.[c.label];
    return meta
      ? { ...c, edge: meta.edge, hasBook: true }
      : { ...c, edge: null, hasBook: false };
  };
  const withBookEv = core.map(annotate).filter((c) => c.hasBook && c.edge != null);
  const extrasWithBook = extras.map(annotate).filter((c) => c.hasBook && c.edge != null);

  let primary = null;

  if (hasBook && withBookEv.length) {
    const valuePoolBase = withBookEv.filter(
      (c) =>
        c.edge >= MIN_VALUE &&
        tipProbabilityAllowed(c, { valueCandidate: true })
    );
    const valuePool = dailyQuotaCandidates(valuePoolBase, dailyTipContext);
    if (valuePool.length) {
      primary = [...valuePool].sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
    } else {
      const pool = valuePoolBase.length ? valuePoolBase : withBookEv;
      primary = [...pool].sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
    }
  }

  // No core book tip: allow extras primary when book edge is strong
  if (!primary && extrasWithBook.length) {
    const extraValueBase = extrasWithBook.filter(
      (c) => c.edge >= MIN_VALUE && tipProbabilityAllowed(c, { valueCandidate: true })
    );
    const extraValue = dailyQuotaCandidates(extraValueBase, dailyTipContext);
    if (extraValue.length) {
      primary = [...extraValue].sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
    } else if (extraValueBase.length) {
      primary = [...extraValueBase].sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
    }
  }

  if (!primary) {
    const bookBacked = core.filter((c) => value.byLabel?.[c.label] != null);
    const poolSource = hasBook && bookBacked.length ? bookBacked : core;
    const usableBase = poolSource.filter((c) => tipProbabilityAllowed(c));
    const usable = dailyQuotaCandidates(usableBase, dailyTipContext);
    const pool = usable.length ? usable : usableBase.length ? usableBase : poolSource;
    primary = [...pool].sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
  }

  if (!primary && nonTrivial.length) {
    const fallbackBase = nonTrivial.filter(
      (c) => CORE_MARKETS.has(c.label) || familyOf(c.label) === 'goles'
    );
    primary = [...dailyQuotaCandidates(fallbackBase, dailyTipContext)]
      .sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0];
  }
  if (!primary) primary = candidates[0] || extras[0];

  // Thin sample: prefer safer core under (book-aligned when hasBook); don't force extras
  if (sampleSize < MIN_SAMPLE_FOR_TIP && primary && !isExtraFamily(primary.label)) {
    const safePool = hasBook
      ? core.filter((c) => value.byLabel?.[c.label] != null)
      : core;
    const safePoolBase = safePool.filter((c) =>
      ['UNDER_25', 'BTTS_NO', 'HOME_WIN', 'AWAY_WIN'].includes(c.label)
    );
    const safePoolByQuota = dailyQuotaCandidates(safePoolBase, dailyTipContext);
    const safe = (safePoolByQuota.length ? safePoolByQuota : safePoolBase)
      .sort((a, b) => b.prob - a.prob)[0];
    if (safe && safe.prob >= primary.prob - 0.03) primary = safe;
  }

  const secondaryPool = [
    ...core.filter((c) => c.label !== primary?.label),
    ...extras.filter((c) => c.label !== primary?.label),
  ];
  const secondary =
    [...secondaryPool]
      .filter((c) => familyOf(c.label) !== familyOf(primary.label))
      .sort((a, b) => compareTipCandidates(a, b, value, dailyTipContext))[0] || null;

  return { primary, secondary };
}

/** Build over-line ladder: lines like 8.5 → P(X > 8). */
function poissonOverLadder(lambda, lines) {
  const lam = Number(lambda);
  if (!Number.isFinite(lam) || lam < 0) return [];
  return (lines || []).map((line) => {
    const L = Number(line);
    const maxK = Math.floor(L); // over 8.5 → sum k=0..8
    let under = 0;
    for (let k = 0; k <= maxK; k += 1) under += poissonP(k, lam);
    const over = Math.max(0, Math.min(1, 1 - under));
    return { line: L, over: Number(over.toFixed(4)) };
  });
}

function rangeLines(from, to, step = 1) {
  const out = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Number(x.toFixed(1)));
  return out;
}

function cornersModel(homeStats, awayStats, league, { degraded = false } = {}) {
  const strict = hasCornerSamples(homeStats) && hasCornerSamples(awayStats);
  const homeSamples = countStatSamples(homeStats, 'corners_for');
  const awaySamples = countStatSamples(awayStats, 'corners_for');
  if (!strict && (!degraded || homeSamples === 0 || awaySamples === 0)) return null;
  const homeCornersFor = weightedAvg(homeStats, 'corners_for');
  const awayCornersFor = weightedAvg(awayStats, 'corners_for');
  const homeCornersAgainst = weightedAvg(homeStats, 'corners_against');
  const awayCornersAgainst = weightedAvg(awayStats, 'corners_against');
  if (
    strict &&
    [homeCornersFor, awayCornersFor, homeCornersAgainst, awayCornersAgainst].some(
      (v) => v == null
    )
  ) {
    return null;
  }
  const leagueAvg = league.avgCornersFor || 5;
  const homeCornerAtt = strict
    ? strength(homeCornersFor, league.avgCornersFor)
    : shrinkStrength(homeCornersFor, league.avgCornersFor, homeSamples);
  const homeCornerDef = strict
    ? strength(homeCornersAgainst, league.avgCornersAgainst)
    : shrinkStrength(
        homeCornersAgainst,
        league.avgCornersAgainst,
        countStatSamples(homeStats, 'corners_against')
      );
  const awayCornerAtt = strict
    ? strength(awayCornersFor, league.avgCornersFor)
    : shrinkStrength(awayCornersFor, league.avgCornersFor, awaySamples);
  const awayCornerDef = strict
    ? strength(awayCornersAgainst, league.avgCornersAgainst)
    : shrinkStrength(
        awayCornersAgainst,
        league.avgCornersAgainst,
        countStatSamples(awayStats, 'corners_against')
      );
  const lambdaHome = homeCornerAtt * awayCornerDef * leagueAvg;
  const lambdaAway = awayCornerAtt * homeCornerDef * leagueAvg;
  const total = lambdaHome + lambdaAway;
  let under85 = 0;
  for (let k = 0; k <= 8; k += 1) under85 += poissonP(k, total);
  let under95 = 0;
  for (let k = 0; k <= 9; k += 1) under95 += poissonP(k, total);
  let under105 = 0;
  for (let k = 0; k <= 10; k += 1) under105 += poissonP(k, total);
  return {
    lambdaHome,
    lambdaAway,
    lambdaMatch: total,
    cornersOver85: 1 - under85,
    cornersUnder85: under85,
    cornersOver: 1 - under95,
    cornersUnder: under95,
    cornersOver105: 1 - under105,
    cornersUnder105: under105,
    ladderHome: poissonOverLadder(lambdaHome, rangeLines(2.5, 7.5)),
    ladderAway: poissonOverLadder(lambdaAway, rangeLines(2.5, 7.5)),
    ladderMatch: poissonOverLadder(total, rangeLines(7.5, 12.5)),
    ...(strict ? {} : { degraded: true, samples: { home: homeSamples, away: awaySamples } }),
  };
}

function cardsModel(homeStats, awayStats, league, { degraded = false } = {}) {
  const strict = hasCardSamples(homeStats) && hasCardSamples(awayStats);
  const homeSamples = countStatSamples(homeStats, 'yellows_for');
  const awaySamples = countStatSamples(awayStats, 'yellows_for');
  if (!strict && (!degraded || homeSamples === 0 || awaySamples === 0)) return null;
  const homeYellowsFor = avg(homeStats, 'yellows_for');
  const awayYellowsFor = avg(awayStats, 'yellows_for');
  const homeYellowsAgainst = avg(homeStats, 'yellows_against');
  const awayYellowsAgainst = avg(awayStats, 'yellows_against');
  if (
    strict &&
    [homeYellowsFor, awayYellowsFor, homeYellowsAgainst, awayYellowsAgainst].some(
      (v) => v == null
    )
  ) {
    return null;
  }
  const leagueAvg = league.avgYellowsFor || 2;
  const homeCardAtt = strict
    ? strength(homeYellowsFor, league.avgYellowsFor)
    : shrinkStrength(homeYellowsFor, league.avgYellowsFor, homeSamples);
  const homeCardDef = strict
    ? strength(homeYellowsAgainst, league.avgYellowsAgainst)
    : shrinkStrength(
        homeYellowsAgainst,
        league.avgYellowsAgainst,
        countStatSamples(homeStats, 'yellows_against')
      );
  const awayCardAtt = strict
    ? strength(awayYellowsFor, league.avgYellowsFor)
    : shrinkStrength(awayYellowsFor, league.avgYellowsFor, awaySamples);
  const awayCardDef = strict
    ? strength(awayYellowsAgainst, league.avgYellowsAgainst)
    : shrinkStrength(
        awayYellowsAgainst,
        league.avgYellowsAgainst,
        countStatSamples(awayStats, 'yellows_against')
      );
  const lambdaHome = homeCardAtt * awayCardDef * leagueAvg;
  const lambdaAway = awayCardAtt * homeCardDef * leagueAvg;
  const total = lambdaHome + lambdaAway;
  let under35 = 0;
  for (let k = 0; k <= 3; k += 1) under35 += poissonP(k, total);
  let under45 = 0;
  for (let k = 0; k <= 4; k += 1) under45 += poissonP(k, total);
  return {
    lambdaHome,
    lambdaAway,
    lambdaMatch: total,
    cardsOver35: 1 - under35,
    cardsUnder35: under35,
    cardsOver45: 1 - under45,
    cardsUnder45: under45,
    ladderHome: poissonOverLadder(lambdaHome, rangeLines(0.5, 3.5)),
    ladderAway: poissonOverLadder(lambdaAway, rangeLines(0.5, 3.5)),
    ladderMatch: poissonOverLadder(total, rangeLines(2.5, 6.5)),
    ...(strict ? {} : { degraded: true, samples: { home: homeSamples, away: awaySamples } }),
  };
}

function totalShotsModel(homeStats, awayStats, league) {
  if (!hasShotSamples(homeStats) || !hasShotSamples(awayStats)) return null;
  const homeShotsFor = weightedAvg(homeStats, 'shots_for');
  const awayShotsFor = weightedAvg(awayStats, 'shots_for');
  const homeShotsAgainst = weightedAvg(homeStats, 'shots_against');
  const awayShotsAgainst = weightedAvg(awayStats, 'shots_against');
  if (
    [homeShotsFor, awayShotsFor, homeShotsAgainst, awayShotsAgainst].some((v) => v == null)
  ) {
    return null;
  }
  const homeAtt = strength(homeShotsFor, league.avgShotsFor);
  const homeDef = strength(homeShotsAgainst, league.avgShotsAgainst);
  const awayAtt = strength(awayShotsFor, league.avgShotsFor);
  const awayDef = strength(awayShotsAgainst, league.avgShotsAgainst);
  const leagueAvg = league.avgShotsFor || 12;
  const lambdaHome = homeAtt * awayDef * leagueAvg;
  const lambdaAway = awayAtt * homeDef * leagueAvg;
  const total = lambdaHome + lambdaAway;
  let under225 = 0;
  for (let k = 0; k <= 22; k += 1) under225 += poissonP(k, total);
  let under255 = 0;
  for (let k = 0; k <= 25; k += 1) under255 += poissonP(k, total);
  return {
    total,
    lambdaHome,
    lambdaAway,
    lambdaMatch: total,
    shotsOver225: 1 - under225,
    shotsUnder225: under225,
    shotsOver255: 1 - under255,
    shotsUnder255: under255,
    ladderHome: poissonOverLadder(lambdaHome, rangeLines(5.5, 15.5)),
    ladderAway: poissonOverLadder(lambdaAway, rangeLines(5.5, 15.5)),
    ladderMatch: poissonOverLadder(total, rangeLines(18.5, 32.5)),
  };
}

function shotsOnTargetModel(homeStats, awayStats, league, { degraded = false } = {}) {
  const strict = hasSotSamples(homeStats) && hasSotSamples(awayStats);
  const homeSamples = countStatSamples(homeStats, 'shots_on_target_for');
  const awaySamples = countStatSamples(awayStats, 'shots_on_target_for');
  if (!strict && (!degraded || homeSamples === 0 || awaySamples === 0)) return null;
  const homeFor = weightedAvg(homeStats, 'shots_on_target_for');
  const awayFor = weightedAvg(awayStats, 'shots_on_target_for');
  const homeAgainst = weightedAvg(homeStats, 'shots_on_target_against');
  const awayAgainst = weightedAvg(awayStats, 'shots_on_target_against');
  if (strict && [homeFor, awayFor, homeAgainst, awayAgainst].some((v) => v == null)) return null;

  const leagueAvg = league.avgShotsOnTargetFor || 4.5;
  const homeAtt = strict
    ? strength(homeFor, league.avgShotsOnTargetFor)
    : shrinkStrength(homeFor, league.avgShotsOnTargetFor, homeSamples);
  const awayDef = strict
    ? strength(awayAgainst, league.avgShotsOnTargetAgainst)
    : shrinkStrength(
        awayAgainst,
        league.avgShotsOnTargetAgainst,
        countStatSamples(awayStats, 'shots_on_target_against')
      );
  const awayAtt = strict
    ? strength(awayFor, league.avgShotsOnTargetFor)
    : shrinkStrength(awayFor, league.avgShotsOnTargetFor, awaySamples);
  const homeDef = strict
    ? strength(homeAgainst, league.avgShotsOnTargetAgainst)
    : shrinkStrength(
        homeAgainst,
        league.avgShotsOnTargetAgainst,
        countStatSamples(homeStats, 'shots_on_target_against')
      );
  const lambdaHome = homeAtt * awayDef * leagueAvg;
  const lambdaAway = awayAtt * homeDef * leagueAvg;
  const total = lambdaHome + lambdaAway;
  const probabilities = Object.fromEntries(
    poissonOverLadder(total, [7.5, 8.5, 9.5]).flatMap(({ line, over }) => {
      const suffix = String(line).replace('.', '');
      return [
        [`sotOver${suffix}`, over],
        [`sotUnder${suffix}`, Number((1 - over).toFixed(4))],
      ];
    })
  );
  return {
    lambdaHome,
    lambdaAway,
    lambdaMatch: total,
    ...probabilities,
    ladderHome: poissonOverLadder(lambdaHome, rangeLines(1.5, 6.5)),
    ladderAway: poissonOverLadder(lambdaAway, rangeLines(1.5, 6.5)),
    ladderMatch: poissonOverLadder(total, rangeLines(5.5, 12.5)),
    ...(strict ? {} : { degraded: true, samples: { home: homeSamples, away: awaySamples } }),
  };
}

function packLadderSide(model) {
  if (!model) return null;
  return {
    home: Number(model.lambdaHome.toFixed(2)),
    away: Number(model.lambdaAway.toFixed(2)),
    match: Number(model.lambdaMatch.toFixed(2)),
    ladderHome: model.ladderHome,
    ladderAway: model.ladderAway,
    ladderMatch: model.ladderMatch,
    ...(model.degraded
      ? { degraded: true, samples: model.samples }
      : {}),
  };
}

function packDisplayLadder(model) {
  if (!model) return null;
  return {
    home: model.ladderHome,
    away: model.ladderAway,
    match: model.ladderMatch,
    ...(model.degraded ? { degraded: true, samples: model.samples } : {}),
  };
}

function shotCandidatesFromModel(shots) {
  if (!shots) return [];
  return [
    { label: 'SHOTS_OVER_225', prob: shots.shotsOver225 },
    { label: 'SHOTS_UNDER_225', prob: shots.shotsUnder225 },
    { label: 'SHOTS_OVER_255', prob: shots.shotsOver255 },
    { label: 'SHOTS_UNDER_255', prob: shots.shotsUnder255 },
  ].filter((c) => c.prob != null && Number.isFinite(c.prob));
}

function sotCandidatesFromModel(sot) {
  if (!sot) return [];
  return [
    { label: 'SOT_OVER_75', prob: sot.sotOver75 },
    { label: 'SOT_UNDER_75', prob: sot.sotUnder75 },
    { label: 'SOT_OVER_85', prob: sot.sotOver85 },
    { label: 'SOT_UNDER_85', prob: sot.sotUnder85 },
    { label: 'SOT_OVER_95', prob: sot.sotOver95 },
    { label: 'SOT_UNDER_95', prob: sot.sotUnder95 },
  ].filter((c) => c.prob != null && Number.isFinite(c.prob));
}

function cornerCandidatesFromModel(corners) {
  if (!corners) return [];
  return [
    { label: 'CORNERS_OVER_85', prob: corners.cornersOver85 },
    { label: 'CORNERS_UNDER_85', prob: corners.cornersUnder85 },
    { label: 'CORNERS_OVER_95', prob: corners.cornersOver },
    { label: 'CORNERS_UNDER_95', prob: corners.cornersUnder },
    { label: 'CORNERS_OVER_105', prob: corners.cornersOver105 },
    { label: 'CORNERS_UNDER_105', prob: corners.cornersUnder105 },
  ].filter((c) => c.prob != null && Number.isFinite(c.prob));
}

function cardCandidatesFromModel(cards) {
  if (!cards) return [];
  return [
    { label: 'CARDS_OVER_35', prob: cards.cardsOver35 },
    { label: 'CARDS_UNDER_35', prob: cards.cardsUnder35 },
    { label: 'CARDS_OVER_45', prob: cards.cardsOver45 },
    { label: 'CARDS_UNDER_45', prob: cards.cardsUnder45 },
  ].filter((c) => c.prob != null && Number.isFinite(c.prob));
}

export async function predictMatch(db, matchId) {
  const match = await store.findMatchById(db, matchId);
  if (!match) throw new Error(`Partido ${matchId} no encontrado`);

  const homeStats = await store.lastNForTeam(db, match.homeTeam.id, 10);
  const awayStats = await store.lastNForTeam(db, match.awayTeam.id, 10);
  const league = await store.leagueGoalAverages(db, match.leagueId);

  let homeXg;
  let awayXg;
  let nHome;
  let nAway;
  let lambdaSource = 'shrinkage';
  const ratingsLive = (await store.getMeta(db, 'ratings_live')) === '1';
  if (ratingsLive) {
    const homeR = await getOrInitRating(db, match.homeTeam.id, match.leagueId);
    const awayR = await getOrInitRating(db, match.awayTeam.id, match.leagueId);
    if (ratingsReady(homeR, awayR)) {
      ({ homeXg, awayXg, nHome, nAway } = lambdasFromRatings(homeR, awayR, league));
      lambdaSource = 'ratings';
    }
  }
  if (lambdaSource === 'shrinkage') {
    ({ homeXg, awayXg, nHome, nAway } = estimateLambdas(homeStats, awayStats, league));
  }
  const matrix = buildScoreMatrix(homeXg, awayXg, 8, -0.08);
  const m = marketsFromMatrix(matrix);

  const corners = cornersModel(homeStats, awayStats, league);
  const cards = cardsModel(homeStats, awayStats, league);
  const shots = totalShotsModel(homeStats, awayStats, league);
  const shotsOnTarget = shotsOnTargetModel(homeStats, awayStats, league);
  // Degraded count-market models are only for visual estimates. Tips and the
  // stored prediction probabilities continue using the strict models above.
  const cornersDisplay =
    corners || cornersModel(homeStats, awayStats, league, { degraded: true });
  const cardsDisplay = cards || cardsModel(homeStats, awayStats, league, { degraded: true });
  const shotsOnTargetDisplay =
    shotsOnTarget || shotsOnTargetModel(homeStats, awayStats, league, { degraded: true });

  // Tip pool = core + O/U 1.5/3.5 for value; shots/corners/cards as secondary extras.
  let candidates = allGoalCandidatesFromMarkets(m);
  const tipCandidates = candidates.filter(
    (c) =>
      CORE_MARKETS.has(c.label) ||
      ['OVER_15', 'UNDER_15', 'OVER_35', 'UNDER_35'].includes(c.label)
  );
  const shotCands = shotCandidatesFromModel(shots);
  const sotCands = sotCandidatesFromModel(shotsOnTarget);
  const cornerCands = cornerCandidatesFromModel(corners);
  const cardCands = cardCandidatesFromModel(cards);
  const extraCands = [...sotCands, ...cornerCands, ...cardCands, ...shotCands];

  const oddsRow = await store.getOddsForMatch(db, matchId);
  const hasBook = Boolean(
    oddsRow &&
      (bookOddsForLabel(oddsRow, 'HOME_WIN') ||
        bookOddsForLabel(oddsRow, 'OVER_25') ||
        bookOddsForLabel(oddsRow, 'BTTS_YES') ||
        bookOddsForLabel(oddsRow, 'SHOTS_OVER_225') ||
        bookOddsForLabel(oddsRow, 'SHOTS_OVER_255') ||
        bookOddsForLabel(oddsRow, 'SOT_OVER_75') ||
        bookOddsForLabel(oddsRow, 'SOT_OVER_85') ||
        bookOddsForLabel(oddsRow, 'SOT_OVER_95') ||
        bookOddsForLabel(oddsRow, 'CORNERS_OVER_95') ||
        bookOddsForLabel(oddsRow, 'CORNERS_OVER_85') ||
        bookOddsForLabel(oddsRow, 'CARDS_OVER_35') ||
        bookOddsForLabel(oddsRow, 'CARDS_OVER_45'))
  );

  const value = computeValue([...tipCandidates, ...extraCands], oddsRow);
  const calib = await loadTipCalibration(db);
  const calibrated = applyCalibrationToCandidates(tipCandidates, calib);
  const calibratedExtras = applyCalibrationToCandidates(extraCands, calib);
  const sampleSize = Math.min(nHome, nAway);
  const dailyTipContext = await store.getDailyTipDiversityContext(db, match.matchDate, matchId);
  const { primary, secondary } = pickBets(calibrated, value, calib, {
    hasBook,
    sampleSize,
    extraCandidates: calibratedExtras,
    dailyTipContext,
  });

  let tipResolved = resolveTipOdds(primary.label, null, oddsRow);
  // Book-first: do not store model-implied as tip_odds when we want honesty in bands.
  if (tipResolved.oddsSource !== 'book') {
    tipResolved = {
      tipOdds: tipResolved.tipOdds,
      oddsBand: tipResolved.oddsBand,
      oddsSource: 'model',
    };
  }

  let confidence = primary.prob * 100;
  let dataQuality = sampleSize >= MIN_SAMPLE_FOR_TIP ? 'ok' : 'low';
  if (tipResolved.oddsSource !== 'book') {
    confidence = Number((confidence * 0.94).toFixed(2));
  }
  if (sampleSize < MIN_SAMPLE_FOR_TIP) {
    confidence = Number((confidence * 0.9).toFixed(2));
    dataQuality = 'low';
  }
  // Prefer book tips in Mejores ranking
  if (tipResolved.oddsSource === 'book' && value.value_edge != null && value.value_edge > 0) {
    confidence = Number(Math.min(92, confidence + value.value_edge * 40).toFixed(2));
  }

  const payload = {
    match_id: matchId,
    home_win_prob: Number(m.homeWin.toFixed(4)),
    draw_prob: Number(m.draw.toFixed(4)),
    away_win_prob: Number(m.awayWin.toFixed(4)),
    over15_prob: Number(m.over15.toFixed(4)),
    under15_prob: Number(m.under15.toFixed(4)),
    over25_prob: Number(m.over25.toFixed(4)),
    under25_prob: Number(m.under25.toFixed(4)),
    over35_prob: Number(m.over35.toFixed(4)),
    under35_prob: Number(m.under35.toFixed(4)),
    btts_yes_prob: Number(m.bttsYes.toFixed(4)),
    btts_no_prob: Number(m.bttsNo.toFixed(4)),
    home_over05_prob: Number(m.homeOver05.toFixed(4)),
    home_under05_prob: Number(m.homeUnder05.toFixed(4)),
    home_over15_prob: Number(m.homeOver15.toFixed(4)),
    home_under15_prob: Number(m.homeUnder15.toFixed(4)),
    home_over25_prob: Number(m.homeOver25.toFixed(4)),
    home_under25_prob: Number(m.homeUnder25.toFixed(4)),
    home_over35_prob: Number(m.homeOver35.toFixed(4)),
    home_under35_prob: Number(m.homeUnder35.toFixed(4)),
    away_over05_prob: Number(m.awayOver05.toFixed(4)),
    away_under05_prob: Number(m.awayUnder05.toFixed(4)),
    away_over15_prob: Number(m.awayOver15.toFixed(4)),
    away_under15_prob: Number(m.awayUnder15.toFixed(4)),
    away_over25_prob: Number(m.awayOver25.toFixed(4)),
    away_under25_prob: Number(m.awayUnder25.toFixed(4)),
    away_over35_prob: Number(m.awayOver35.toFixed(4)),
    away_under35_prob: Number(m.awayUnder35.toFixed(4)),
    corners_over85_prob:
      corners?.cornersOver85 != null ? Number(corners.cornersOver85.toFixed(4)) : null,
    corners_under85_prob:
      corners?.cornersUnder85 != null ? Number(corners.cornersUnder85.toFixed(4)) : null,
    corners_over95_prob:
      corners?.cornersOver != null ? Number(corners.cornersOver.toFixed(4)) : null,
    corners_under95_prob:
      corners?.cornersUnder != null ? Number(corners.cornersUnder.toFixed(4)) : null,
    corners_over105_prob:
      corners?.cornersOver105 != null ? Number(corners.cornersOver105.toFixed(4)) : null,
    corners_under105_prob:
      corners?.cornersUnder105 != null ? Number(corners.cornersUnder105.toFixed(4)) : null,
    cards_over35_prob:
      cards?.cardsOver35 != null ? Number(cards.cardsOver35.toFixed(4)) : null,
    cards_under35_prob:
      cards?.cardsUnder35 != null ? Number(cards.cardsUnder35.toFixed(4)) : null,
    cards_over45_prob:
      cards?.cardsOver45 != null ? Number(cards.cardsOver45.toFixed(4)) : null,
    cards_under45_prob:
      cards?.cardsUnder45 != null ? Number(cards.cardsUnder45.toFixed(4)) : null,
    shots_over225_prob:
      shots?.shotsOver225 != null ? Number(shots.shotsOver225.toFixed(4)) : null,
    shots_under225_prob:
      shots?.shotsUnder225 != null ? Number(shots.shotsUnder225.toFixed(4)) : null,
    shots_over255_prob:
      shots?.shotsOver255 != null ? Number(shots.shotsOver255.toFixed(4)) : null,
    shots_under255_prob:
      shots?.shotsUnder255 != null ? Number(shots.shotsUnder255.toFixed(4)) : null,
    sot_over75_prob:
      shotsOnTarget?.sotOver75 != null ? Number(shotsOnTarget.sotOver75.toFixed(4)) : null,
    sot_under75_prob:
      shotsOnTarget?.sotUnder75 != null ? Number(shotsOnTarget.sotUnder75.toFixed(4)) : null,
    sot_over85_prob:
      shotsOnTarget?.sotOver85 != null ? Number(shotsOnTarget.sotOver85.toFixed(4)) : null,
    sot_under85_prob:
      shotsOnTarget?.sotUnder85 != null ? Number(shotsOnTarget.sotUnder85.toFixed(4)) : null,
    sot_over95_prob:
      shotsOnTarget?.sotOver95 != null ? Number(shotsOnTarget.sotOver95.toFixed(4)) : null,
    sot_under95_prob:
      shotsOnTarget?.sotUnder95 != null ? Number(shotsOnTarget.sotUnder95.toFixed(4)) : null,
    home_xg: Number(homeXg.toFixed(4)),
    away_xg: Number(awayXg.toFixed(4)),
    suggested_bet: primary.label,
    secondary_bet: secondary ? secondary.label : null,
    confidence_score: Number(confidence.toFixed(2)),
    value_edge: value.value_edge,
    value_market: value.value_market,
  };

  await store.upsertPrediction(db, payload);
  // Re-resolve with full prediction for model fallback display only
  tipResolved = resolveTipOdds(payload.suggested_bet, payload, oddsRow);
  const storeOdds =
    tipResolved.oddsSource === 'book'
      ? tipResolved
      : { tipOdds: null, oddsBand: null, oddsSource: 'model' };

  const modelProb =
    primary.rawProb != null && Number.isFinite(Number(primary.rawProb))
      ? Number(primary.rawProb)
      : primary.prob;

  await store.upsertTipResult(db, {
    match_id: matchId,
    suggested_bet: payload.suggested_bet,
    confidence_score: payload.confidence_score,
    model_prob: modelProb,
    value_edge: payload.value_edge,
    value_market: payload.value_market,
    tip_odds: storeOdds.tipOdds,
    odds_band: storeOdds.oddsBand,
    odds_source: storeOdds.oddsSource || tipResolved.oddsSource || null,
  });

  const homeCornerAvg = avg(homeStats, 'corners_for');
  const awayCornerAvg = avg(awayStats, 'corners_for');
  const homeYellowAvg = avg(homeStats, 'yellows_for');
  const awayYellowAvg = avg(awayStats, 'yellows_for');
  const homeShotsAvg = avg(homeStats, 'shots_for');
  const awayShotsAvg = avg(awayStats, 'shots_for');
  const homeSotAvg = avg(homeStats, 'shots_on_target_for');
  const awaySotAvg = avg(awayStats, 'shots_on_target_for');

  const expected = {
    shots: packLadderSide(shotsOnTargetDisplay),
    shotsOnTarget: packLadderSide(shotsOnTargetDisplay),
    totalShots: packLadderSide(shots),
    corners: packLadderSide(cornersDisplay),
    cards: packLadderSide(cardsDisplay),
  };
  const ladders = {
    shots: packDisplayLadder(shotsOnTargetDisplay),
    shotsOnTarget: packDisplayLadder(shotsOnTargetDisplay),
    corners: packDisplayLadder(cornersDisplay),
    cards: packDisplayLadder(cardsDisplay),
  };

  return {
    match,
    prediction: payload,
    form: {
      home: store.formFromStats(homeStats),
      away: store.formFromStats(awayStats),
    },
    recentAvgs: {
      home: {
        corners: homeCornerAvg != null ? Number(homeCornerAvg.toFixed(1)) : null,
        yellows: homeYellowAvg != null ? Number(homeYellowAvg.toFixed(1)) : null,
        shots: homeShotsAvg != null ? Number(homeShotsAvg.toFixed(1)) : null,
        shotsOnTarget: homeSotAvg != null ? Number(homeSotAvg.toFixed(1)) : null,
      },
      away: {
        corners: awayCornerAvg != null ? Number(awayCornerAvg.toFixed(1)) : null,
        yellows: awayYellowAvg != null ? Number(awayYellowAvg.toFixed(1)) : null,
        shots: awayShotsAvg != null ? Number(awayShotsAvg.toFixed(1)) : null,
        shotsOnTarget: awaySotAvg != null ? Number(awaySotAvg.toFixed(1)) : null,
      },
    },
    expected,
    ladders,
    leagueAvgs: {
      goals: Number(((league.avgHomeScored || 1.35) + (league.avgAwayScored || 1.15)).toFixed(2)),
      corners: Number(((league.avgCornersFor || 5) * 2).toFixed(2)),
      cards: Number(((league.avgYellowsFor || 2) * 2).toFixed(2)),
      shots: Number(((league.avgShotsFor || 12) * 2).toFixed(2)),
      shotsOnTarget: Number(((league.avgShotsOnTargetFor || 4.5) * 2).toFixed(2)),
    },
    dataQuality,
    sampleSize,
    tipOdds: tipResolved.tipOdds,
    oddsBand: tipResolved.oddsBand,
    oddsSource: tipResolved.oddsSource,
    lambdaSource,
    xg: { home: Number(homeXg.toFixed(3)), away: Number(awayXg.toFixed(3)) },
    highConfidence:
      dataQuality === 'ok' &&
      tipResolved.oddsSource === 'book' &&
      confidence >= 58,
    odds: oddsRow,
    live: buildLiveBlock(match, payload),
  };
}

export async function predictMany(db, matchIds) {
  const results = [];
  for (const id of matchIds) {
    try {
      results.push(await predictMatch(db, id));
    } catch (err) {
      results.push({ matchId: id, error: err.message });
    }
  }
  return results;
}

export async function getPredictionBundle(db, matchId) {
  return predictMatch(db, matchId);
}
