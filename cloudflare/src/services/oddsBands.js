/**
 * Odds bands @2 / @3 / @4 / @5 — centered ranges (not 1.5–2.5 dumps).
 * Bookmaker odds when available; else model-implied 1/P.
 */

function familyKey(label) {
  const bet = label != null ? String(label) : '';
  if (['HOME_WIN', 'DRAW', 'AWAY_WIN'].includes(bet)) return '1X2';
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
    ].includes(bet)
  ) {
    return 'goles';
  }
  if (
    [
      'CORNERS_OVER_85',
      'CORNERS_UNDER_85',
      'CORNERS_OVER_95',
      'CORNERS_UNDER_95',
      'CORNERS_OVER_105',
      'CORNERS_UNDER_105',
    ].includes(bet)
  ) {
    return 'corners';
  }
  if (
    ['CARDS_OVER_35', 'CARDS_UNDER_35', 'CARDS_OVER_45', 'CARDS_UNDER_45'].includes(bet)
  ) {
    return 'cards';
  }
  if (
    ['SHOTS_OVER_225', 'SHOTS_UNDER_225', 'SHOTS_OVER_255', 'SHOTS_UNDER_255'].includes(
      bet
    )
  ) {
    return 'shots';
  }
  if (
    [
      'SOT_OVER_75',
      'SOT_UNDER_75',
      'SOT_OVER_85',
      'SOT_UNDER_85',
      'SOT_OVER_95',
      'SOT_UNDER_95',
    ].includes(bet)
  ) {
    return 'shots_on_target';
  }
  return 'otros';
}

/** Prefer markets/bands with better historical mult (from tip_calibration meta). */
function calibBoost(calib, label, tipOdds = null) {
  if (!calib) return 1;
  const fam = familyKey(label);
  let mult = Number(calib.byFamily?.[fam]?.mult) || 1;
  const f = calib.byFamily?.[fam];
  if (f && Number(f.n || 0) >= 20 && Number(f.hitRate) < 0.45) mult *= 0.8;
  const o = Number(tipOdds);
  let band = null;
  if (Number.isFinite(o) && o > 1) {
    if (o < 1.7) band = '1';
    else if (o < 2.5) band = '2';
    else if (o < 3.5) band = '3';
    else if (o < 4.5) band = '4';
    else if (o <= 6.5) band = '5';
  }
  if (band) {
    const b = Number(calib.byBand?.[band]?.mult) || 1;
    mult *= 0.5 + 0.5 * b;
  }
  return mult;
}

const BOOK_ODDS_FIELD = {
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

const MODEL_PROB_FIELD = {
  HOME_WIN: 'home_win_prob',
  DRAW: 'draw_prob',
  AWAY_WIN: 'away_win_prob',
  OVER_15: 'over15_prob',
  UNDER_15: 'under15_prob',
  OVER_25: 'over25_prob',
  UNDER_25: 'under25_prob',
  OVER_35: 'over35_prob',
  UNDER_35: 'under35_prob',
  BTTS_YES: 'btts_yes_prob',
  BTTS_NO: 'btts_no_prob',
  HOME_OVER_05: 'home_over05_prob',
  HOME_UNDER_05: 'home_under05_prob',
  HOME_OVER_15: 'home_over15_prob',
  HOME_UNDER_15: 'home_under15_prob',
  HOME_OVER_25: 'home_over25_prob',
  HOME_UNDER_25: 'home_under25_prob',
  HOME_OVER_35: 'home_over35_prob',
  HOME_UNDER_35: 'home_under35_prob',
  AWAY_OVER_05: 'away_over05_prob',
  AWAY_UNDER_05: 'away_under05_prob',
  AWAY_OVER_15: 'away_over15_prob',
  AWAY_UNDER_15: 'away_under15_prob',
  AWAY_OVER_25: 'away_over25_prob',
  AWAY_UNDER_25: 'away_under25_prob',
  AWAY_OVER_35: 'away_over35_prob',
  AWAY_UNDER_35: 'away_under35_prob',
  CORNERS_OVER_85: 'corners_over85_prob',
  CORNERS_UNDER_85: 'corners_under85_prob',
  CORNERS_OVER_95: 'corners_over95_prob',
  CORNERS_UNDER_95: 'corners_under95_prob',
  CORNERS_OVER_105: 'corners_over105_prob',
  CORNERS_UNDER_105: 'corners_under105_prob',
  CARDS_OVER_35: 'cards_over35_prob',
  CARDS_UNDER_35: 'cards_under35_prob',
  CARDS_OVER_45: 'cards_over45_prob',
  CARDS_UNDER_45: 'cards_under45_prob',
  SHOTS_OVER_225: 'shots_over225_prob',
  SHOTS_UNDER_225: 'shots_under225_prob',
  SHOTS_OVER_255: 'shots_over255_prob',
  SHOTS_UNDER_255: 'shots_under255_prob',
  SOT_OVER_75: 'sot_over75_prob',
  SOT_UNDER_75: 'sot_under75_prob',
  SOT_OVER_85: 'sot_over85_prob',
  SOT_UNDER_85: 'sot_under85_prob',
  SOT_OVER_95: 'sot_over95_prob',
  SOT_UNDER_95: 'sot_under95_prob',
};

/** Combinada filter bands (Cuotas chips). */
export const ODDS_BANDS = ['2', '3', '4', '5'];

/** Stats counter bands — includes Cortas (short odds tips). */
export const STAT_ODDS_BANDS = ['1', '2', '3', '4', '5'];

/** Under 3.5 match/team totals — near-certain in low-xg games; never tip or combo. */
export const TRIVIAL_GOAL_TIPS = new Set(['UNDER_35', 'HOME_UNDER_35', 'AWAY_UNDER_35']);

/** Display + matching windows. Band 1 = Cortas (tips); 2–5 = combinada product windows. */
export const BAND_META = {
  '1': { center: 1.45, min: 1.05, max: 1.7, label: 'Cortas', range: '1.05–1.69' },
  '2': { center: 2, min: 1.65, max: 2.55, label: '2', range: '1.65–2.54' },
  '3': { center: 3, min: 2.55, max: 3.55, label: '3', range: '2.55–3.54' },
  '4': { center: 4, min: 3.55, max: 4.45, label: '4', range: '3.55–4.44' },
  '5': { center: 5, min: 4.45, max: 6.5, label: '5', range: '4.45–6.50' },
};

/** @returns {'1'|'2'|'3'|'4'|'5'|null} */
export function oddsBandFromValue(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1) return null;
  // Cortas includes ultra-short model odds (e.g. 1.02) so they aren't orphaned.
  if (o < 1.7) return '1';
  if (o < 2.5) return '2';
  if (o < 3.5) return '3';
  if (o < 4.5) return '4';
  if (o <= 6.5) return '5';
  return null;
}

/** Wider windows for combinada product (fills gaps between single-tip bands). */
export function oddsBandFromCombined(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 0) return null;
  if (o >= 1.65 && o < 2.55) return '2';
  if (o >= 2.55 && o < 3.55) return '3';
  if (o >= 3.55 && o < 4.45) return '4';
  if (o >= 4.45 && o <= 6.5) return '5';
  return null;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function modelProbForBet(predictionRow, bet) {
  if (!predictionRow || !bet) return null;
  const field = MODEL_PROB_FIELD[String(bet)];
  if (!field) return null;
  return numOrNull(predictionRow[field]);
}

/**
 * @returns {{ tipOdds: number|null, oddsBand: string|null, oddsSource: 'book'|'model'|null }}
 */
export function resolveTipOdds(suggestedBet, predictionRow = null, oddsRow = null) {
  const bet = suggestedBet ? String(suggestedBet) : '';
  if (!bet) return { tipOdds: null, oddsBand: null, oddsSource: null };

  const bookField = BOOK_ODDS_FIELD[bet];
  if (bookField && oddsRow) {
    const book = numOrNull(oddsRow[bookField]);
    if (book != null) {
      return {
        tipOdds: Number(book.toFixed(3)),
        oddsBand: oddsBandFromValue(book),
        oddsSource: 'book',
      };
    }
  }

  const p = modelProbForBet(predictionRow, bet);
  if (p != null && p > 0.01 && p < 0.99) {
    const implied = 1 / p;
    return {
      tipOdds: Number(implied.toFixed(3)),
      oddsBand: oddsBandFromValue(implied),
      oddsSource: 'model',
    };
  }

  return { tipOdds: null, oddsBand: null, oddsSource: null };
}

export function parseOddsBandParam(raw) {
  const s = raw == null ? '' : String(raw).trim();
  return ODDS_BANDS.includes(s) ? s : null;
}

/**
 * Market for Cuotas: prefer primary tip in band, then secondary, else closest to band center.
 * @returns {{ label: string, tipOdds: number, oddsBand: string, oddsSource: string, prob: number, dist: number }|null}
 */
export function pickMarketForOddsBand(predictionRow, oddsRow, band, preferredBets = [], calib = null) {
  if (!predictionRow || !band || !BAND_META[band]) return null;
  const center = BAND_META[band].center;

  for (const bet of preferredBets) {
    if (!bet || TRIVIAL_GOAL_TIPS.has(String(bet))) continue;
    const resolved = resolveTipOdds(bet, predictionRow, oddsRow);
    if (resolved.oddsBand !== band || resolved.tipOdds == null) continue;
    const p = modelProbForBet(predictionRow, bet) ?? 1 / resolved.tipOdds;
    return {
      label: String(bet),
      tipOdds: resolved.tipOdds,
      oddsBand: resolved.oddsBand,
      oddsSource: resolved.oddsSource,
      prob: p,
      dist: Math.abs(resolved.tipOdds - center),
      fromPreferred: true,
    };
  }

  const CORE_SCAN = [
    'HOME_WIN',
    'DRAW',
    'AWAY_WIN',
    'OVER_25',
    'UNDER_25',
    'BTTS_YES',
    'BTTS_NO',
    'OVER_15',
    'UNDER_15',
    'OVER_35',
    'UNDER_35',
  ];
  let best = null;
  for (const label of CORE_SCAN) {
    if (TRIVIAL_GOAL_TIPS.has(label)) continue;
    const p = modelProbForBet(predictionRow, label);
    if (p == null || p < 0.16 || p > 0.7) continue;
    const resolved = resolveTipOdds(label, predictionRow, oddsRow);
    // Prefer book; skip model-implied for mid bands (avoids fake band fit)
    if (resolved.oddsSource !== 'book') continue;
    if (resolved.oddsBand !== band || resolved.tipOdds == null) continue;
    const dist = Math.abs(resolved.tipOdds - center);
    const score = p * calibBoost(calib, label, resolved.tipOdds);
    const bestScore = best
      ? best.prob * calibBoost(calib, best.label, best.tipOdds)
      : -1;
    if (
      !best ||
      dist < best.dist - 0.001 ||
      (Math.abs(dist - best.dist) <= 0.001 && score > bestScore)
    ) {
      best = {
        label,
        tipOdds: resolved.tipOdds,
        oddsBand: resolved.oddsBand,
        oddsSource: resolved.oddsSource,
        prob: p,
        dist,
        fromPreferred: false,
      };
    }
  }
  return best;
}

/** @deprecated use pickMarketForOddsBand */
export function pickBestMarketInBand(predictionRow, oddsRow, band) {
  return pickMarketForOddsBand(predictionRow, oddsRow, band, []);
}

/**
 * Leg for a combinada: odds roughly 1.25–2.20, prefer suggested tip.
 * @returns {{ label: string, tipOdds: number, oddsSource: string, prob: number }|null}
 */
/**
 * @param {object} predictionRow
 * @param {object|null} oddsRow
 * @param {string[]} [preferredBets]
 * @param {{ tipMin?: number, tipMax?: number }} [opts] band-aware odds window
 */
export function pickLegForCombo(predictionRow, oddsRow, preferredBets = [], opts = {}) {
  if (!predictionRow) return null;
  const LEG_MIN = opts.tipMin ?? 1.18;
  const LEG_MAX = opts.tipMax ?? 2.35;
  const P_MIN = 0.42;
  const P_MAX = 0.84;
  const calib = opts.calib || null;
  /** Combinadas only use book odds — no fake 1/p legs. */
  const bookOnly = opts.bookOnly !== false;

  const CORE = new Set([
    'HOME_WIN',
    'DRAW',
    'AWAY_WIN',
    'OVER_25',
    'UNDER_25',
    'BTTS_YES',
    'BTTS_NO',
    'OVER_15',
    'UNDER_15',
    'OVER_35',
    'UNDER_35',
  ]);

  const candidates = [];

  function consider(bet, preferred) {
    if (!bet || TRIVIAL_GOAL_TIPS.has(String(bet))) return;
    if (!CORE.has(String(bet))) return;
    const resolved = resolveTipOdds(bet, predictionRow, oddsRow);
    if (resolved.tipOdds == null) return;
    if (bookOnly && resolved.oddsSource !== 'book') return;
    if (resolved.tipOdds < LEG_MIN || resolved.tipOdds > LEG_MAX) return;
    const p = modelProbForBet(predictionRow, bet) ?? 1 / resolved.tipOdds;
    if (p < P_MIN || p > P_MAX) return;
    candidates.push({
      label: String(bet),
      tipOdds: resolved.tipOdds,
      oddsSource: resolved.oddsSource,
      prob: p,
      preferred: Boolean(preferred),
    });
  }

  for (const bet of preferredBets) consider(bet, true);
  for (const label of CORE) consider(label, false);

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const bookA = a.oddsSource === 'book' ? 1 : 0;
    const bookB = b.oddsSource === 'book' ? 1 : 0;
    if (bookB !== bookA) return bookB - bookA;
    const sa = a.prob * calibBoost(calib, a.label, a.tipOdds);
    const sb = b.prob * calibBoost(calib, b.label, b.tipOdds);
    if (sb !== sa) return sb - sa;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.tipOdds - b.tipOdds;
  });
  const best = candidates[0];
  return { label: best.label, tipOdds: best.tipOdds, oddsSource: best.oddsSource, prob: best.prob };
}
