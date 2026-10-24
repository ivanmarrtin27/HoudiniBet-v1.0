/**
 * Combinada semanal top-5 · cuota objetivo ~10 (rango 9–11).
 * Book / derived_1x2 / model etiquetados con honestidad.
 * Diversidad de familias + P conjunta ajustada por correlación soft.
 */

import { WEEKLY_COMBO_MARKETS } from './matchModel.js';
import { buildCombosForTargetOdds, scoreComboDiversity } from './combos.js';
import { marketFamily } from './oddsBands.js';

/** AF api_id: Premier, LaLiga, Serie A, Bundesliga, Ligue 1 */
export const TOP5_LEAGUE_API_IDS = new Set([39, 140, 135, 78, 61]);

const TOP5_NAME_RE =
  /premier\s*league|la\s*liga|serie\s*a|bundesliga|ligue\s*1|primera\s*divisi/i;

export function isTop5League(match) {
  if (TOP5_LEAGUE_API_IDS.has(Number(match?.leagueApiId))) return true;
  const name = String(match?.leagueName || '');
  return TOP5_NAME_RE.test(name);
}

/** Allowed market families for weekly filter query param. */
export const WEEKLY_MARKET_FAMILIES = new Set([
  'result',
  'goals',
  'corners',
  'cards',
  'shots',
]);

/** Calendar windows for Semanal "jornada" control. */
export const WEEKLY_WINDOWS = new Set(['weekend', 'this_week', 'next7', 'next14']);

function ymdUTC(d) {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Monday=0 … Sunday=6 for ISO-like week in UTC. */
function utcMondayOffset(d) {
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  return day === 0 ? 6 : day - 1;
}

/**
 * Resolve calendar window → inclusive [fromYmd, toYmd] and fetch horizon in days.
 * @param {string} windowKey
 * @param {Date} [now]
 */
export function resolveWeeklyWindow(windowKey, now = new Date()) {
  const key = WEEKLY_WINDOWS.has(String(windowKey)) ? String(windowKey) : 'next14';
  const today = startOfUtcDay(now);
  const todayYmd = ymdUTC(today);

  if (key === 'next7') {
    const to = addUtcDays(today, 7);
    return { window: key, from: todayYmd, to: ymdUTC(to), fetchDays: 7 };
  }
  if (key === 'next14') {
    const to = addUtcDays(today, 14);
    return { window: key, from: todayYmd, to: ymdUTC(to), fetchDays: 14 };
  }

  const monOffset = utcMondayOffset(today);
  const monday = addUtcDays(today, -monOffset);
  const sunday = addUtcDays(monday, 6);

  if (key === 'this_week') {
    const from = todayYmd > ymdUTC(monday) ? todayYmd : ymdUTC(monday);
    const to = ymdUTC(sunday);
    const fetchDays = Math.max(1, Math.ceil((sunday - today) / 86400000) + 1);
    return { window: key, from, to, fetchDays: Math.min(14, fetchDays) };
  }

  // weekend: Fri–Sun of current ISO week; if past Sunday → next Fri–Sun
  let fri = addUtcDays(monday, 4);
  let sun = sunday;
  if (today > sun) {
    fri = addUtcDays(fri, 7);
    sun = addUtcDays(sun, 7);
  }
  const fromDate = today > fri ? today : fri;
  const from = ymdUTC(fromDate);
  const to = ymdUTC(sun);
  const fetchDays = Math.max(1, Math.ceil((sun - today) / 86400000) + 1);
  return { window: 'weekend', from, to, fetchDays: Math.min(14, fetchDays) };
}

function legDateYmd(leg) {
  const s = String(leg?.matchDate || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return ymdUTC(new Date(t));
}

/**
 * Filter weekly leg candidates by AF league, market family, and/or calendar window.
 */
export function filterWeeklyLegs(
  legs,
  { leagueApiId = null, family = null, from = null, to = null } = {}
) {
  const list = Array.isArray(legs) ? legs : [];
  const lid =
    leagueApiId != null && leagueApiId !== '' && Number.isFinite(Number(leagueApiId))
      ? Number(leagueApiId)
      : null;
  const fam =
    family && WEEKLY_MARKET_FAMILIES.has(String(family)) ? String(family) : null;
  const fromY = from ? String(from).slice(0, 10) : null;
  const toY = to ? String(to).slice(0, 10) : null;
  if (lid != null && !TOP5_LEAGUE_API_IDS.has(lid)) return [];
  return list.filter((leg) => {
    if (lid != null && Number(leg.leagueApiId) !== lid) return false;
    if (fam != null) {
      const lf = leg.marketFamily || marketFamily(leg.suggestedBet);
      if (lf !== fam) return false;
    }
    if (fromY || toY) {
      const d = legDateYmd(leg);
      if (!d) return false;
      if (fromY && d < fromY) return false;
      if (toY && d > toY) return false;
    }
    return true;
  });
}

export function parseWeeklyFilterParams(searchParams) {
  const rawLeague = searchParams?.get?.('leagueApiId');
  const rawFamily = searchParams?.get?.('family');
  const rawWindow = searchParams?.get?.('window');
  let leagueApiId = null;
  if (rawLeague != null && String(rawLeague).trim() !== '') {
    const n = Number(rawLeague);
    if (Number.isFinite(n) && TOP5_LEAGUE_API_IDS.has(n)) leagueApiId = n;
  }
  let family = null;
  if (rawFamily != null && String(rawFamily).trim() !== '') {
    const f = String(rawFamily).trim();
    if (WEEKLY_MARKET_FAMILIES.has(f)) family = f;
  }
  const windowKey =
    rawWindow != null && WEEKLY_WINDOWS.has(String(rawWindow).trim())
      ? String(rawWindow).trim()
      : 'next14';
  const range = resolveWeeklyWindow(windowKey);
  return { leagueApiId, family, window: range.window, from: range.from, to: range.to, fetchDays: range.fetchDays };
}

const MIN_LEG_ODDS = 1.2;
const TARGET_ODDS = 10;
const TOLERANCE = 0.1; // 9–11
const MIN_LEGS = 3;
const MAX_LEGS = 8;
const POOL_SIZE = 18;
const LIMIT = 8;
const TARGET_FAMILIES = 4;
const ODDS_STALE_HOURS = 36;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function implied(odds) {
  const o = num(odds);
  return o && o > 1 ? 1 / o : null;
}

function clampProb(p) {
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}

/** Fair probs from 1X2 book (overround stripped). */
function fair1x2(oddsRow) {
  const ph = implied(oddsRow?.home_odds);
  const pd = implied(oddsRow?.draw_odds);
  const pa = implied(oddsRow?.away_odds);
  if (ph == null || pd == null || pa == null) return null;
  const s = ph + pd + pa;
  if (s <= 0) return null;
  return { home: ph / s, draw: pd / s, away: pa / s };
}

function oddsAreStale(oddsRow) {
  const raw = oddsRow?.fetched_at || oddsRow?.updated_at;
  if (!raw) return false;
  const t = Date.parse(String(raw).includes('T') ? raw : `${String(raw).replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > ODDS_STALE_HOURS * 3600 * 1000;
}

/**
 * Resolve tip odds for weekly markets.
 * DC/DNB: derived from book 1X2 → oddsSource `derived_1x2` (not verified board).
 * Direct columns → `book`. Stale book → `stale` (still priced, flagged).
 */
export function resolveWeeklyLegOdds(label, oddsRow) {
  const stale = oddsAreStale(oddsRow);
  const fair = fair1x2(oddsRow);
  if (label === 'DC_1X' && fair) {
    return {
      tipOdds: Number((1 / (fair.home + fair.draw)).toFixed(3)),
      oddsSource: 'derived_1x2',
    };
  }
  if (label === 'DC_X2' && fair) {
    return {
      tipOdds: Number((1 / (fair.away + fair.draw)).toFixed(3)),
      oddsSource: 'derived_1x2',
    };
  }
  if (label === 'DNB_HOME' && fair && fair.home + fair.away > 0) {
    return {
      tipOdds: Number((1 / (fair.home / (fair.home + fair.away))).toFixed(3)),
      oddsSource: 'derived_1x2',
    };
  }
  if (label === 'DNB_AWAY' && fair && fair.home + fair.away > 0) {
    return {
      tipOdds: Number((1 / (fair.away / (fair.home + fair.away))).toFixed(3)),
      oddsSource: 'derived_1x2',
    };
  }

  const field = {
    HOME_WIN: 'home_odds',
    DRAW: 'draw_odds',
    AWAY_WIN: 'away_odds',
    OVER_05: 'over05_odds',
    UNDER_05: 'under05_odds',
    OVER_15: 'over15_odds',
    UNDER_15: 'under15_odds',
    OVER_25: 'over25_odds',
    UNDER_25: 'under25_odds',
    OVER_35: 'over35_odds',
    UNDER_35: 'under35_odds',
    OVER_45: 'over45_odds',
    UNDER_45: 'under45_odds',
    BTTS_YES: 'btts_yes_odds',
    BTTS_NO: 'btts_no_odds',
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
  }[label];
  if (field) {
    const o = num(oddsRow?.[field]);
    if (o && o >= MIN_LEG_ODDS) {
      return { tipOdds: o, oddsSource: stale ? 'stale' : 'book' };
    }
  }

  return { tipOdds: null, oddsSource: null };
}

export function modelProbForWeekly(pred, label) {
  if (!pred) return null;
  const hw = Number(pred.home_win_prob);
  const dr = Number(pred.draw_prob);
  const aw = Number(pred.away_win_prob);
  const map = {
    HOME_WIN: hw,
    DRAW: dr,
    AWAY_WIN: aw,
    DC_1X: Number.isFinite(hw) && Number.isFinite(dr) ? hw + dr : null,
    DC_X2: Number.isFinite(aw) && Number.isFinite(dr) ? aw + dr : null,
    DNB_HOME:
      Number.isFinite(hw) && Number.isFinite(aw) && hw + aw > 0 ? hw / (hw + aw) : null,
    DNB_AWAY:
      Number.isFinite(hw) && Number.isFinite(aw) && hw + aw > 0 ? aw / (hw + aw) : null,
    OVER_05: pred.over05_prob != null ? Number(pred.over05_prob) : null,
    UNDER_05: pred.under05_prob != null ? Number(pred.under05_prob) : null,
    UNDER_45: pred.under45_prob != null ? Number(pred.under45_prob) : null,
    OVER_45: pred.over45_prob != null ? Number(pred.over45_prob) : null,
    OVER_15: Number(pred.over15_prob),
    UNDER_15: Number(pred.under15_prob),
    OVER_25: Number(pred.over25_prob),
    UNDER_25: Number(pred.under25_prob),
    OVER_35: Number(pred.over35_prob),
    UNDER_35: Number(pred.under35_prob),
    BTTS_YES: Number(pred.btts_yes_prob),
    BTTS_NO: Number(pred.btts_no_prob),
    CORNERS_OVER_85: Number(pred.corners_over85_prob),
    CORNERS_UNDER_85: Number(pred.corners_under85_prob),
    CORNERS_OVER_95: Number(pred.corners_over95_prob),
    CORNERS_UNDER_95: Number(pred.corners_under95_prob),
    CORNERS_OVER_105: Number(pred.corners_over105_prob),
    CORNERS_UNDER_105: Number(pred.corners_under105_prob),
    CARDS_OVER_35: Number(pred.cards_over35_prob),
    CARDS_UNDER_35: Number(pred.cards_under35_prob),
    CARDS_OVER_45: Number(pred.cards_over45_prob),
    CARDS_UNDER_45: Number(pred.cards_under45_prob),
    SHOTS_OVER_225: Number(pred.shots_over225_prob),
    SHOTS_UNDER_225: Number(pred.shots_under225_prob),
    SHOTS_OVER_255: Number(pred.shots_over255_prob),
    SHOTS_UNDER_255: Number(pred.shots_under255_prob),
    SOT_OVER_75: Number(pred.sot_over75_prob),
    SOT_UNDER_75: Number(pred.sot_under75_prob),
    SOT_OVER_85: Number(pred.sot_over85_prob),
    SOT_UNDER_85: Number(pred.sot_under85_prob),
    SOT_OVER_95: Number(pred.sot_over95_prob),
    SOT_UNDER_95: Number(pred.sot_under95_prob),
  };
  return clampProb(map[label]);
}

function ev(prob, odds) {
  return prob * odds - 1;
}

function isPricedSource(src) {
  return src === 'book' || src === 'derived_1x2' || src === 'model' || src === 'stale';
}

function isVerifiedBook(src) {
  return src === 'book';
}

function matchDayKey(matchDate) {
  const s = String(matchDate || '');
  return s.slice(0, 10);
}

/**
 * Soft correlation: same match forbidden elsewhere; same family / same day penalize joint P.
 */
export function jointProbAdjusted(legs) {
  let joint = 1;
  for (const l of legs) {
    const p = Number(l.prob ?? l.jointProb);
    if (!Number.isFinite(p) || p <= 0) return { jointProb: 0, jointProbAdj: 0, corrFactor: 0 };
    joint *= p;
  }
  let corr = 1;
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i];
      const b = legs[j];
      if (marketFamily(a.suggestedBet) === marketFamily(b.suggestedBet)) corr *= 0.92;
      if (matchDayKey(a.matchDate) && matchDayKey(a.matchDate) === matchDayKey(b.matchDate)) {
        corr *= 0.97;
      }
      if (Number(a.leagueApiId) && Number(a.leagueApiId) === Number(b.leagueApiId)) {
        corr *= 0.99;
      }
    }
  }
  corr = Math.max(0.55, Math.min(1, corr));
  return {
    jointProb: Number(joint.toFixed(6)),
    jointProbAdj: Number((joint * corr).toFixed(6)),
    corrFactor: Number(corr.toFixed(4)),
    independenceAssumption: false,
  };
}

function legBase(match, best) {
  return {
    matchId: match.id,
    matchDate: match.matchDate,
    league: match.leagueName,
    leagueId: match.leagueId,
    leagueApiId: match.leagueApiId,
    leagueCountry: match.leagueCountry,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    suggestedBet: best.label,
    tipOdds: best.tipOdds,
    oddsSource: best.oddsSource,
    marketFamily: best.family,
    confidenceScore: Number((best.prob * 100).toFixed(2)),
    prob: best.prob,
    impliedProb: best.impliedProb,
    valueEdge: best.valueEdge,
  };
}

/**
 * Best scored label overall for a match (compat).
 */
export function pickWeeklyLeg(match, pred, oddsRow) {
  const cands = pickWeeklyCandidates(match, pred, oddsRow);
  if (!cands.length) return null;
  return cands.sort((a, b) => (b._score || 0) - (a._score || 0))[0];
}

/**
 * Up to one candidate per market family for a match (quality-gated).
 */
export function pickWeeklyCandidates(match, pred, oddsRow) {
  if (!pred || match.status !== 'scheduled') return [];
  const labels = [...WEEKLY_COMBO_MARKETS];
  const byFamily = new Map();
  for (const label of labels) {
    // Never tip total match shots in Semanal (SOT/corners/cards OK).
    if (String(label).startsWith('SHOTS_')) continue;
    const prob = modelProbForWeekly(pred, label);
    if (prob == null || prob < 0.42 || prob > 0.88) continue;
    const resolved = resolveWeeklyLegOdds(label, oddsRow);
    let tipOdds = resolved.tipOdds;
    let oddsSource = resolved.oddsSource;
    if (tipOdds == null) {
      tipOdds = Number((1 / prob).toFixed(3));
      oddsSource = 'model';
    }
    if (tipOdds == null || tipOdds < MIN_LEG_ODDS || tipOdds > 2.85) continue;
    if (!isPricedSource(oddsSource)) continue;
    const edge = ev(prob, tipOdds);
    if (edge < -0.08 && oddsSource === 'model') continue;
    // Extras (corners/cards/shots) require real book — no model-only filler.
    const fam = marketFamily(label);
    if ((fam === 'corners' || fam === 'cards' || fam === 'shots') && !isVerifiedBook(oddsSource)) {
      continue;
    }
    const oddsFit =
      tipOdds >= 1.28 && tipOdds <= 1.85
        ? 0.2
        : tipOdds >= 1.2 && tipOdds < 1.28
          ? 0.05
          : 0;
    const sourceBoost =
      oddsSource === 'book' ? 10 : oddsSource === 'derived_1x2' ? 4 : oddsSource === 'stale' ? 2 : 0;
    const score = sourceBoost + edge + prob * 0.05 + oddsFit;
    const prev = byFamily.get(fam);
    if (!prev || score > prev._score) {
      const leg = legBase(match, {
        label,
        tipOdds,
        oddsSource,
        prob,
        impliedProb: 1 / tipOdds,
        valueEdge: Number(edge.toFixed(4)),
        family: fam,
      });
      leg._score = score;
      byFamily.set(fam, leg);
    }
  }
  return [...byFamily.values()];
}

function comboPricing(legs) {
  const sources = new Set((legs || []).map((l) => l.oddsSource || 'model'));
  if (sources.size === 1 && sources.has('book')) return 'book';
  if ([...sources].every((s) => s === 'book' || s === 'derived_1x2' || s === 'stale')) {
    return sources.has('book') ? 'mixed' : 'derived';
  }
  if (sources.has('book') || sources.has('derived_1x2') || sources.has('stale')) return 'mixed';
  return 'model';
}

function whyPreferred(selected, alternatives, metaExtras = {}) {
  if (!selected) return null;
  const fams = new Set((selected.legs || []).map((l) => l.marketFamily || marketFamily(l.suggestedBet)));
  const bookN = (selected.legs || []).filter((l) => isVerifiedBook(l.oddsSource)).length;
  const alt0 = alternatives?.[0];
  const reasons = [];
  if (selected.jointProbAdj != null) {
    reasons.push(
      `Mayor P conjunta ajustada (${(selected.jointProbAdj * 100).toFixed(2)}%)`
    );
  }
  if (fams.size >= TARGET_FAMILIES) {
    reasons.push(`${fams.size} familias de mercado (objetivo ≥${TARGET_FAMILIES})`);
  } else {
    reasons.push(`${fams.size} familias de mercado`);
  }
  reasons.push(`${bookN}/${selected.nLegs || selected.legs?.length} selecciones con cuota book verificada`);
  if (alt0 && selected.jointProbAdj != null && alt0.jointProbAdj != null) {
    const delta = selected.jointProbAdj - alt0.jointProbAdj;
    if (delta > 0) {
      reasons.push(
        `+${(delta * 100).toFixed(2)} pp vs mejor alternativa en P ajustada`
      );
    }
  }
  return {
    jointProb: selected.jointProb,
    jointProbAdj: selected.jointProbAdj,
    corrFactor: selected.corrFactor,
    diversityScore: selected.diversityScore,
    familyCount: fams.size,
    families: [...fams],
    leagueCount: selected.leagueCount,
    bookRatio: selected.bookRatio,
    combinedOdds: selected.combinedOdds,
    reasons,
    ...metaExtras,
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.targetOdds]
 * @param {number} [opts.tolerance]
 * @param {number|null} [opts.minJointProbAdj] — prefer combos above this; else best effort
 * @param {boolean} [opts.preferHighProb] — rank by P first (conservative profile)
 * @param {number} [opts.minLegs]
 * @param {number} [opts.maxLegs]
 * @param {number} [opts.tipMin]
 * @param {number} [opts.tipMax]
 * @param {string} [opts.profile] — 'aggressive' | 'conservative'
 * @returns {{ combos, meta, whyPreferred }}
 */
export function buildWeeklyCombos(legs, opts = {}) {
  const target = Number(opts.targetOdds) || TARGET_ODDS;
  const tolerance = Number.isFinite(Number(opts.tolerance)) ? Number(opts.tolerance) : TOLERANCE;
  const preferHighProb = Boolean(opts.preferHighProb);
  const minJoint = Number.isFinite(Number(opts.minJointProbAdj))
    ? Number(opts.minJointProbAdj)
    : null;
  const profile = opts.profile || (preferHighProb ? 'conservative' : 'aggressive');
  const minLegs = Math.max(2, Number(opts.minLegs) || (preferHighProb ? 2 : MIN_LEGS));
  const maxLegs = Math.max(minLegs, Number(opts.maxLegs) || (preferHighProb ? 6 : MAX_LEGS));
  const tipMin = Number(opts.tipMin) || (preferHighProb ? 1.18 : 1.28);
  const tipMax = Number(opts.tipMax) || (preferHighProb ? 1.9 : 1.95);
  const targetFamilies = preferHighProb ? 2 : TARGET_FAMILIES;

  const bookLegs = legs.filter((l) => isVerifiedBook(l.oddsSource));
  const pricedLegs = legs.filter(
    (l) => isVerifiedBook(l.oddsSource) || l.oddsSource === 'derived_1x2' || l.oddsSource === 'stale'
  );
  let pool;
  let pricing;
  if (bookLegs.length >= minLegs) {
    pool = bookLegs;
    pricing = 'book';
  } else if (pricedLegs.length >= minLegs) {
    pool = pricedLegs;
    pricing = 'mixed';
  } else {
    pool = legs;
    pricing = 'model';
  }

  // Conservative: keep higher-prob legs only
  if (preferHighProb) {
    pool = pool.filter((l) => Number(l.prob) >= 0.55);
    if (pool.length < minLegs) pool = legs.filter((l) => Number(l.prob) >= 0.5);
  }

  const availableFamilies = new Set(pool.map((l) => l.marketFamily || marketFamily(l.suggestedBet)));

  const ranked = [...pool].sort((a, b) => {
    const fit = (l) => {
      const o = Number(l.tipOdds) || 1;
      const mid = Math.abs(Math.log(o) - Math.log(preferHighProb ? 1.35 : 1.48));
      const fam = l.marketFamily || marketFamily(l.suggestedBet);
      const div = 0.05;
      void fam;
      if (preferHighProb) {
        return (
          Number(l.prob) * 1.2 +
          (isVerifiedBook(l.oddsSource) ? 0.15 : 0) -
          mid * 0.3
        );
      }
      return (
        (isVerifiedBook(l.oddsSource) ? 0.2 : 0) + Number(l.prob) * 0.35 - mid + div
      );
    };
    return fit(b) - fit(a);
  });

  const diversified = [];
  const usedFam = new Map();
  const usedMatch = new Set();
  const rest = [];
  for (const l of ranked) {
    const fam = l.marketFamily || marketFamily(l.suggestedBet);
    const mid = Number(l.matchId);
    // Conservative: one leg per match (highest-ranked first) so @5 can land.
    if (preferHighProb && usedMatch.has(mid)) {
      rest.push(l);
      continue;
    }
    const n = usedFam.get(fam) || 0;
    if (n < (preferHighProb ? 4 : 3)) {
      diversified.push(l);
      usedFam.set(fam, n + 1);
      if (preferHighProb) usedMatch.add(mid);
    } else {
      rest.push(l);
    }
  }
  const orderedPool = [...diversified, ...rest];

  function tryBuild(tol, tMax, mLegs, pSize) {
    return buildCombosForTargetOdds(orderedPool, target, {
      tolerance: tol,
      minLegs,
      maxLegs: mLegs,
      poolSize: pSize,
      tipMin,
      tipMax: tMax,
      limit: LIMIT * 3,
      preserveOrder: true,
      targetFamilies,
      availableFamilyCount: availableFamilies.size,
    });
  }

  let built = tryBuild(tolerance, tipMax, maxLegs, preferHighProb ? 16 : POOL_SIZE);
  let oddsRelaxed = false;
  if (!built.length && preferHighProb) {
    // Best-effort: widen tip/odds window rather than invent legs.
    built = tryBuild(Math.max(tolerance, 0.25), Math.max(tipMax, 2.05), Math.max(maxLegs, 6), 20);
    oddsRelaxed = built.length > 0;
  }
  if (!built.length && preferHighProb) {
    built = tryBuild(0.4, 2.2, 7, 22);
    oddsRelaxed = built.length > 0;
  }

  const scored = built.map((c, i) => {
    const jp = jointProbAdjusted(c.legs);
    const div = scoreComboDiversity(c.legs, {
      targetFamilies,
      availableFamilyCount: availableFamilies.size,
    });
    const bookN = c.legs.filter((l) => isVerifiedBook(l.oddsSource)).length;
    const bookRatio = bookN / c.legs.length;
    const diversityBonus =
      !preferHighProb && availableFamilies.size >= targetFamilies
        ? 0.85 + 0.15 * div.diversityScore
        : 1;
    const rankScore = preferHighProb
      ? jp.jointProbAdj * 2 - Math.abs(c.combinedOdds - target) * 0.01
      : jp.jointProbAdj * diversityBonus * (0.7 + 0.3 * bookRatio) -
        Math.abs(c.combinedOdds - target) * 0.002;
    const minOdds = Math.min(...c.legs.map((l) => Number(l.tipOdds) || 99));
    const maxOdds = Math.max(...c.legs.map((l) => Number(l.tipOdds) || 0));
    const leagues = new Set(c.legs.map((l) => l.leagueApiId || l.leagueId));
    const uncertain = [...c.legs]
      .sort((a, b) => Number(a.prob) - Number(b.prob))
      .slice(0, 3)
      .map((l) => ({
        matchId: l.matchId,
        label: l.suggestedBet,
        prob: l.prob,
        home: l.homeTeam?.name,
        away: l.awayTeam?.name,
      }));
    return {
      id: `weekly-${profile}-${target}-${i}-${c.legs.map((l) => l.matchId).join('_')}`,
      profile,
      combinedOdds: c.combinedOdds,
      targetOdds: target,
      jointProb: jp.jointProb,
      jointProbAdj: jp.jointProbAdj,
      corrFactor: jp.corrFactor,
      independenceAssumption: jp.independenceAssumption,
      diversityScore: div.diversityScore,
      familyCount: div.familyCount,
      families: div.families,
      bookRatio: Number(bookRatio.toFixed(3)),
      nLegs: c.nLegs ?? c.legs.length,
      pricing: comboPricing(c.legs),
      minLegOdds: Number(minOdds.toFixed(3)),
      maxLegOdds: Number(maxOdds.toFixed(3)),
      leagueCount: leagues.size,
      uncertainLegs: uncertain,
      legs: c.legs.map(({ _score, ...rest }) => rest),
      _rankScore: rankScore,
    };
  });

  scored.sort((a, b) => b._rankScore - a._rankScore || b.jointProbAdj - a.jointProbAdj);

  let belowTarget = false;
  let belowReason = null;
  let ordered = scored;
  if (oddsRelaxed && scored.length) {
    belowTarget = true;
    belowReason =
      'Ninguna combinada cae en el rango cuota 5 (4,5–5,5) con selecciones de alta P; se muestra la mejor estimación del modelo.';
  }
  if (minJoint != null && scored.length) {
    const above = scored.filter((c) => c.jointProbAdj >= minJoint);
    if (above.length) {
      ordered = above;
    } else {
      belowTarget = true;
      belowReason = `Ninguna combinada alcanza P conjunta ajustada ≥${(minJoint * 100).toFixed(0)}%; se muestra la mejor estimación del modelo.`;
      ordered = scored;
    }
  }

  const combos = ordered.slice(0, LIMIT).map(({ _rankScore, ...c }) => ({
    ...c,
    belowTarget: belowTarget || undefined,
  }));

  if (
    !preferHighProb &&
    combos.length >= 2 &&
    availableFamilies.size >= targetFamilies &&
    (combos[0].familyCount || 0) < targetFamilies
  ) {
    const better = combos.find(
      (c) =>
        (c.familyCount || 0) >= targetFamilies && c.jointProbAdj >= combos[0].jointProbAdj * 0.92
    );
    if (better && better !== combos[0]) {
      const idx = combos.indexOf(better);
      combos.splice(idx, 1);
      combos.unshift(better);
    }
  }

  const primary = combos[0] || null;
  const alternatives = combos.slice(1, 4);
  const why = whyPreferred(primary, alternatives);

  return {
    combos,
    whyPreferred: why,
    meta: {
      targetOdds: target,
      tolerance,
      range: [target * (1 - tolerance), target * (1 + tolerance)],
      minLegOdds: MIN_LEG_ODDS,
      minLegs,
      maxLegs,
      top5Only: true,
      pricing,
      profile,
      poolSize: pool.length,
      bookPoolSize: bookLegs.length,
      availableFamilies: [...availableFamilies],
      targetFamilies,
      minJointProbAdj: minJoint,
      belowTarget,
      belowReason,
      note: preferHighProb
        ? 'Perfil Conservadora: estimación del modelo orientada a mayor P conjunta. No es una apuesta segura ni garantiza acierto.'
        : 'P(acierto) ajustada por correlación soft (misma familia / día / liga). DC/DNB = derived_1x2 (no cuota de tablón). No es una apuesta segura.',
    },
  };
}

const SAFE_TARGET_ODDS = 5;
const SAFE_TOLERANCE = 0.1; // 4.5–5.5
const SAFE_MIN_JOINT = 0.75;

/** Build primary @10 + conservative @5 from the same filtered leg pool. */
export function buildWeeklyProfiles(legs) {
  const aggressive = buildWeeklyCombos(legs, {
    targetOdds: TARGET_ODDS,
    profile: 'aggressive',
  });
  const conservative = buildWeeklyCombos(legs, {
    targetOdds: SAFE_TARGET_ODDS,
    tolerance: SAFE_TOLERANCE,
    minJointProbAdj: SAFE_MIN_JOINT,
    preferHighProb: true,
    profile: 'conservative',
  });
  return { aggressive, conservative };
}

export const WEEKLY_DEFAULTS = {
  TARGET_ODDS,
  TOLERANCE,
  MIN_LEG_ODDS,
  MIN_LEGS,
  MAX_LEGS,
  TOP5_LEAGUE_API_IDS,
  TARGET_FAMILIES,
  WEEKLY_MARKET_FAMILIES,
  WEEKLY_WINDOWS,
  SAFE_TARGET_ODDS,
  SAFE_TOLERANCE,
  SAFE_MIN_JOINT,
};
