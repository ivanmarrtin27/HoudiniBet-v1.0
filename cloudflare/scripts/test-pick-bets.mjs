/**
 * Regression tests for diverse primary/secondary tip selection.
 * Playable-only primary enters Stats (tip_results). tipTier 'none' + displayPrimary
 * is for predictions.suggested_bet display only — never ledger into tip_results.
 * displayPrimary prefers P≥DISPLAY_MIN_PROB (0.75); weak schema fallback keeps conf 0.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '../src/services/predictionService.js'), 'utf8');

function extractFunction(name) {
  const idx = SRC.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`function ${name} not found`);
  const start = SRC.lastIndexOf('\n', idx) + 1;
  const paren = SRC.indexOf('(', idx);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paren; i < SRC.length; i += 1) {
    if (SRC[i] === '(') parenDepth += 1;
    else if (SRC[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = SRC.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (let i = bodyStart; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} not closed`);
}

const functions = [
  'familyOf',
  'isExtraFamily',
  'secondaryTipScore',
  'tipProbabilityAllowed',
  'dailyQuotaCandidates',
  'dailyFamilyCount',
  'tipOddsForCandidate',
  'isBannedShotTotalLabel',
  'isTrivialTipLabel',
  'isPlayableCandidate',
  'playableTipScore',
  'oddsQualityPenalty',
  'compareTipCandidates',
  'meetsDisplayFloor',
  'pickDisplayPrimary',
  'pickBets',
].map(extractFunction);

const coreMarkets = [
  'HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_25', 'UNDER_25', 'BTTS_YES', 'BTTS_NO',
];
const trivialTips = ['UNDER_35', 'HOME_UNDER_35', 'AWAY_UNDER_35'];
const api = new Function(
  `const MIN_TIP_PROB = 0.48;
   const MAX_TIP_PROB = 0.78;
   const PLAYABLE_MIN_PROB = 0.75;
   const DISPLAY_MIN_PROB = PLAYABLE_MIN_PROB;
   const SAFE_TIP_PROB = 0.8;
   const MIN_VALUE = 0.04;
   const MIN_DRAW_PROB = 0.32;
   const MIN_1X2_TIP_PROB = 0.44;
   const MAX_1X2_TIP_PROB = 0.85;
   const MIN_SAMPLE_FOR_TIP = 3;
   const MIN_PLAYABLE_ODDS = 1.25;
   const MIN_TIP_BOOK_ODDS = 1.2;
   const MAX_TIP_BOOK_ODDS = 4.5;
   const MAX_LABEL_PER_DAY = 2;
   const MAX_FAMILY_DAY_SHARE = 0.35;
   const TRIVIAL_TIP_LABELS = new Set(['OVER_05','UNDER_45']);
   const PRIMARY_BLOCKED_FAMILIES = new Set(['btts']);
   void SAFE_TIP_PROB;
   const CORE_MARKETS = new Set(${JSON.stringify(coreMarkets)});
   const TRIVIAL_GOAL_TIPS = new Set(${JSON.stringify(trivialTips)});
   const TIP_POOL_LABELS = new Set([
     ...CORE_MARKETS,
     'DC_1X','DC_X2','DNB_HOME','DNB_AWAY',
     'OVER_05','UNDER_05','OVER_15','UNDER_15','OVER_35','UNDER_35','OVER_45','UNDER_45',
   ]);
   const isFamilyBlocked = (calib, family) => (calib?.blockedFamilies || []).includes(family);
   // Mirror calibration.tipFamily (DC/DNB ∈ 1X2) — do not alias to local familyOf.
   const tipFamily = (label) => {
     const bet = label != null ? String(label) : '';
     if (['HOME_WIN','DRAW','AWAY_WIN','DC_1X','DC_X2','DNB_HOME','DNB_AWAY'].includes(bet)) return '1X2';
     if (['BTTS_YES','BTTS_NO'].includes(bet)) return 'btts';
     if (
       ['OVER_05','UNDER_05','OVER_15','UNDER_15','OVER_25','UNDER_25','OVER_35','UNDER_35','OVER_45','UNDER_45'].includes(bet) ||
       /^(HOME|AWAY)_(OVER|UNDER)_/.test(bet)
     ) return 'ou';
     if (bet.startsWith('CORNERS_')) return 'corners';
     if (bet.startsWith('CARDS_')) return 'cards';
     if (bet.startsWith('SHOTS_')) return 'shots';
     if (bet.startsWith('SOT_')) return 'shots_on_target';
     return 'otros';
   };
   ${functions.join('\n\n')}
   return { pickBets, tipProbabilityAllowed, familyOf, tipFamily };`
)();

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}`);
  }
}

const familyOfForTest = (label) => api.familyOf(label);

const value = (entries) => ({
  byLabel: Object.fromEntries(
    Object.entries(entries).map(([label, v]) => {
      if (v != null && typeof v === 'object') {
        return [label, { edge: v.edge, book: v.book }];
      }
      return [label, { edge: v, book: null }];
    })
  ),
});

let result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.82 },
    { label: 'BTTS_YES', prob: 0.8 },
  ],
  value({
    HOME_WIN: { edge: 0.09, book: 1.5 },
    BTTS_YES: { edge: 0.06, book: 1.4 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check('1X2 favorite wins playable lane over BTTS primary', result.primary.label === 'HOME_WIN');
check('playable primary tipTier', result.tipTier === 'playable');
check('playable displayPrimary mirrors primary', result.displayPrimary?.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.82 },
    { label: 'OVER_25', prob: 0.62 },
  ],
  value({
    BTTS_YES: { edge: 0.1, book: 1.45 },
    OVER_25: { edge: 0.08, book: 1.5 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'BTTS excluded from Stats primary; tipTier none (not for tip_results)',
  result.primary == null && result.tipTier === 'none'
);
check(
  'displayPrimary still set when tipTier none (predictions.suggested_bet)',
  result.displayPrimary?.label != null
);
check(
  'BTTS ok as displayPrimary when highest non-playable (≥75%)',
  result.displayPrimary?.label === 'BTTS_YES'
);
check(
  'BTTS can still be secondary when no playable primary',
  result.secondary?.label === 'BTTS_YES' || result.displayPrimary?.label === 'BTTS_YES'
);

result = api.pickBets(
  [
    { label: 'AWAY_WIN', prob: 0.43 },
    { label: 'OVER_25', prob: 0.59 },
  ],
  value({ AWAY_WIN: 0.15, OVER_25: 0.08 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'sub-75% yields no Stats primary (tipTier none) but has displayPrimary',
  result.primary == null && result.tipTier === 'none' && result.displayPrimary?.label != null
);

result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.52 },
    { label: 'OVER_25', prob: 0.78 },
    { label: 'AWAY_WIN', prob: 0.48 },
  ],
  value({
    HOME_WIN: { edge: 0.12, book: 2.1 },
    OVER_25: { edge: 0.06, book: 1.55 },
    AWAY_WIN: { edge: 0.1, book: 2.4 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'displayPrimary prefers ≥75% over ~50% when higher exists',
  result.tipTier === 'playable'
    ? result.primary?.label === 'OVER_25'
    : result.displayPrimary?.label === 'OVER_25' && Number(result.displayPrimary?.prob) >= 0.75
);
check(
  'displayPrimary never sticks to ~50% when ≥75% market exists',
  result.displayPrimary?.label !== 'HOME_WIN' && result.displayPrimary?.label !== 'AWAY_WIN'
);

result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.51 },
    { label: 'OVER_25', prob: 0.55 },
    { label: 'BTTS_YES', prob: 0.49 },
  ],
  value({
    HOME_WIN: { edge: 0.08, book: 2.0 },
    OVER_25: { edge: 0.05, book: 1.9 },
    BTTS_YES: { edge: 0.04, book: 1.85 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'only low-P markets → tipTier none + displayPrimary schema fallback (UI conf from display P)',
  result.primary == null &&
    result.tipTier === 'none' &&
    result.displayPrimary?.label != null &&
    Number(result.displayPrimary.prob) < 0.75
);

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.78 },
    { label: 'OVER_25', prob: 0.76 },
    { label: 'HOME_WIN', prob: 0.76 },
  ],
  value({
    BTTS_YES: { edge: 0.14, book: 1.4 },
    OVER_25: { edge: 0.08, book: 1.5 },
    HOME_WIN: { edge: 0.06, book: 1.55 },
  }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: {
      fixtureCount: 10,
      maxPerLabel: 4,
      counts: { BTTS_YES: 4, OVER_25: 4, HOME_WIN: 0 },
    },
  }
);
check('daily label quota prefers under-cap playable (not BTTS)', result.primary.label === 'HOME_WIN');

const rotatingCounts = {};
const fixtureCandidates = [
  { label: 'OVER_25', prob: 0.76 },
  { label: 'HOME_WIN', prob: 0.76 },
  { label: 'UNDER_25', prob: 0.76 },
];
const fixtureEdges = value({
  OVER_25: { edge: 0.1, book: 1.5 },
  HOME_WIN: { edge: 0.09, book: 1.5 },
  UNDER_25: { edge: 0.08, book: 1.5 },
});
for (let i = 0; i < 6; i += 1) {
  const picked = api.pickBets(fixtureCandidates, fixtureEdges, null, {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: { fixtureCount: 10, maxPerLabel: 2, counts: rotatingCounts },
  }).primary?.label;
  if (picked) rotatingCounts[picked] = (rotatingCounts[picked] || 0) + 1;
}
check(
  'six sequential playable picks respect max 2 per label',
  Math.max(...Object.values(rotatingCounts)) <= 2 &&
    (rotatingCounts.OVER_25 || 0) === 2 &&
    (rotatingCounts.HOME_WIN || 0) === 2 &&
    (rotatingCounts.UNDER_25 || 0) === 2
);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.76 },
    { label: 'BTTS_YES', prob: 0.78 },
    { label: 'HOME_WIN', prob: 0.55 },
  ],
  value({
    OVER_25: { edge: 0.1, book: 1.55 },
    BTTS_YES: { edge: 0.09, book: 1.5 },
    HOME_WIN: { edge: 0.05, book: 2.1 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'secondary tip must come from a different family',
  result.primary != null &&
    result.secondary != null &&
    familyOfForTest(result.primary.label) !== familyOfForTest(result.secondary.label)
);
check('primary is not BTTS', result.primary?.label !== 'BTTS_YES');

result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.82 },
    { label: 'DNB_HOME', prob: 0.9 },
    { label: 'DC_1X', prob: 0.92 },
    { label: 'OVER_25', prob: 0.76 },
  ],
  value({
    HOME_WIN: { edge: 0.08, book: 1.5 },
    DNB_HOME: { edge: 0.1, book: 1.35 },
    DC_1X: { edge: 0.09, book: 1.28 },
    OVER_25: { edge: 0.07, book: 1.5 },
  }),
  null,
  { hasBook: true, sampleSize: 5 }
);
const oneX2 = new Set(['HOME_WIN', 'AWAY_WIN', 'DRAW', 'DC_1X', 'DC_X2', 'DNB_HOME', 'DNB_AWAY']);
check(
  'secondary never repeats 1X2/DC/DNB side of primary',
  oneX2.has(result.primary?.label) &&
    result.secondary?.label === 'OVER_25' &&
    !oneX2.has(result.secondary.label)
);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.76 },
    { label: 'UNDER_25', prob: 0.76 },
  ],
  value({ OVER_25: 0.1, UNDER_25: 0.09 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check(
  'no same-family secondary is emitted when no other family exists',
  result.secondary == null
);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.6 },
    { label: 'HOME_WIN', prob: 0.58 },
  ],
  { byLabel: {} },
  null,
  { hasBook: false, sampleSize: 1 }
);
check(
  'thin-sample sub-75% yields no Stats primary (display ok)',
  result.primary == null && result.tipTier === 'none' && result.displayPrimary?.label != null
);

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.8 },
    { label: 'HOME_WIN', prob: 0.76 },
  ],
  value({
    BTTS_YES: { edge: 0.1, book: 1.4 },
    HOME_WIN: { edge: 0.08, book: 1.5 },
  }),
  { blockedFamilies: ['btts'] },
  { hasBook: true, sampleSize: 5 }
);
check('calibration family blocks still apply; HOME wins', result.primary.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.55 },
    { label: 'OVER_05', prob: 0.95 },
  ],
  value({ HOME_WIN: 0.12, OVER_05: 0.02 }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [{ label: 'CORNERS_OVER_95', prob: 0.76 }],
  }
);
check(
  'playable corners (≥75%) beat trivial OVER_05 and low 1X2',
  result.primary.label === 'CORNERS_OVER_95' && result.tipTier === 'playable'
);

result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.55 },
    { label: 'OVER_25', prob: 0.6 },
    { label: 'SHOTS_OVER_225', prob: 0.92 },
  ],
  value({ HOME_WIN: 0.12, OVER_25: 0.08, SHOTS_OVER_225: 0.01 }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [{ label: 'SHOTS_OVER_225', prob: 0.92 }],
  }
);
check(
  'banned SHOTS_ and sub-75% yield no Stats primary; display non-SHOTS',
  result.primary == null &&
    result.tipTier === 'none' &&
    result.displayPrimary?.label != null &&
    !String(result.displayPrimary.label).startsWith('SHOTS_')
);

result = api.pickBets(
  [{ label: 'HOME_WIN', prob: 0.55 }],
  value({ HOME_WIN: 0.05, SHOTS_OVER_255: { edge: 0.2, book: 1.4 } }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [{ label: 'SHOTS_OVER_255', prob: 0.9 }],
  }
);
check(
  'SHOTS_OVER_255 never wins primary',
  result.primary == null &&
    (result.secondary == null || !String(result.secondary.label).startsWith('SHOTS_'))
);

result = api.pickBets(
  [{ label: 'HOME_WIN', prob: 0.55 }],
  value({
    HOME_WIN: 0.05,
    CARDS_UNDER_45: { edge: 0.08, book: 1.55 },
    SOT_OVER_75: { edge: 0.06, book: 1.35 },
  }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [
      { label: 'CARDS_UNDER_45', prob: 0.76 },
      { label: 'SOT_OVER_75', prob: 0.76 },
    ],
  }
);
check(
  'playable cards preferred over SOT when higher score',
  result.primary.label === 'CARDS_UNDER_45' && result.tipTier === 'playable'
);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.76 },
    { label: 'BTTS_YES', prob: 0.78 },
  ],
  value({
    OVER_25: { edge: 0.12, book: 1.55 },
    BTTS_YES: { edge: 0.09, book: 1.45 },
    CORNERS_OVER_95: { edge: 0.08, book: 1.5 },
  }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [{ label: 'CORNERS_OVER_95', prob: 0.76 }],
  }
);
check(
  'secondary prefers corners over BTTS when both playable',
  result.primary.label === 'OVER_25' && result.secondary?.label === 'CORNERS_OVER_95'
);

const secCounts = {};
const secLabels = [];
const secFixture = [
  { label: 'OVER_25', prob: 0.76 },
  { label: 'HOME_WIN', prob: 0.76 },
];
const secEdges = value({
  OVER_25: { edge: 0.1, book: 1.5 },
  HOME_WIN: { edge: 0.09, book: 1.5 },
  BTTS_YES: { edge: 0.1, book: 1.5 },
  CARDS_UNDER_45: { edge: 0.08, book: 1.55 },
});
for (let i = 0; i < 8; i += 1) {
  const picked = api.pickBets(secFixture, secEdges, null, {
    hasBook: true,
    sampleSize: 5,
    extraCandidates: [
      { label: 'CARDS_UNDER_45', prob: 0.76 },
      { label: 'BTTS_YES', prob: 0.76 },
    ],
    dailyTipContext: {
      fixtureCount: 10,
      maxPerLabel: 2,
      counts: {},
      secondaryCounts: secCounts,
    },
  });
  const sec = picked.secondary?.label;
  if (sec) {
    secLabels.push(sec);
    secCounts[sec] = (secCounts[sec] || 0) + 1;
  }
}
const bttsSecShare =
  secLabels.length > 0
    ? secLabels.filter((l) => l === 'BTTS_YES' || l === 'BTTS_NO').length / secLabels.length
    : 0;
check(
  'secondary rotation keeps BTTS under ~40% when cards alternative exists',
  secLabels.length >= 4 && bttsSecShare <= 0.4
);
check(
  'secondary never uses SHOTS_*',
  secLabels.every((l) => !String(l).startsWith('SHOTS_'))
);

check(
  'source PLAYABLE_MIN_PROB is 0.75',
  /const PLAYABLE_MIN_PROB = 0\.75/.test(SRC)
);
check(
  'source DISPLAY_MIN_PROB equals PLAYABLE_MIN_PROB',
  /const DISPLAY_MIN_PROB = PLAYABLE_MIN_PROB/.test(SRC)
);
check(
  'source blocks btts from primary',
  /PRIMARY_BLOCKED_FAMILIES = new Set\(\['btts'\]\)/.test(SRC)
);
check(
  'source returns displayPrimary from pickBets',
  /return \{ primary, secondary, tipTier, displayPrimary \}/.test(SRC)
);
check(
  'source never nulls suggested_bet on tipTier none',
  /suggested_bet: suggestedLabel/.test(SRC) &&
    !/suggested_bet: hasPlayablePrimary \? primary\.label : null/.test(SRC)
);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
