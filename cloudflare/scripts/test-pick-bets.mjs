/** Regression tests for diverse primary/secondary tip selection. */
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
  'tipProbabilityAllowed',
  'dailyQuotaCandidates',
  'dailyFamilyCount',
  'compareTipCandidates',
  'pickBets',
].map(extractFunction);

const coreMarkets = [
  'HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_25', 'UNDER_25', 'BTTS_YES', 'BTTS_NO',
];
const trivialTips = ['UNDER_35', 'HOME_UNDER_35', 'AWAY_UNDER_35'];
const api = new Function(
  `const MIN_TIP_PROB = 0.48;
   const MAX_TIP_PROB = 0.78;
   const MIN_VALUE = 0.04;
   const MIN_DRAW_PROB = 0.32;
   const MIN_1X2_TIP_PROB = 0.44;
   const MAX_1X2_TIP_PROB = 0.85;
   const MIN_SAMPLE_FOR_TIP = 3;
   const CORE_MARKETS = new Set(${JSON.stringify(coreMarkets)});
   const TRIVIAL_GOAL_TIPS = new Set(${JSON.stringify(trivialTips)});
   const isFamilyBlocked = (calib, family) => (calib?.blockedFamilies || []).includes(family);
   const tipFamily = (label) => familyOf(label);
   ${functions.join('\n\n')}
   return { pickBets, tipProbabilityAllowed };`
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

const value = (entries) => ({
  byLabel: Object.fromEntries(Object.entries(entries).map(([label, edge]) => [label, { edge }])),
});

let result = api.pickBets(
  [
    { label: 'HOME_WIN', prob: 0.82 },
    { label: 'BTTS_YES', prob: 0.74 },
  ],
  value({ HOME_WIN: 0.09, BTTS_YES: 0.06 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check('1X2 favorite up to 85% can win the book-value comparison', result.primary.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'AWAY_WIN', prob: 0.43 },
    { label: 'OVER_25', prob: 0.59 },
  ],
  value({ AWAY_WIN: 0.15, OVER_25: 0.08 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check('1X2 below 44% does not use the expanded window', result.primary.label === 'OVER_25');

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.68 },
    { label: 'OVER_25', prob: 0.62 },
    { label: 'HOME_WIN', prob: 0.56 },
  ],
  value({ BTTS_YES: 0.14, OVER_25: 0.08, HOME_WIN: 0.06 }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: {
      fixtureCount: 10,
      maxPerLabel: 4,
      counts: { BTTS_YES: 4, OVER_25: 1, HOME_WIN: 0 },
    },
  }
);
check('daily label quota chooses an under-cap recommendation', result.primary.label !== 'BTTS_YES');

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.66 },
    { label: 'HOME_WIN', prob: 0.58 },
  ],
  value({ BTTS_YES: 0.1, HOME_WIN: 0.09 }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: {
      fixtureCount: 10,
      maxPerLabel: 4,
      counts: { BTTS_YES: 1, OVER_25: 1 },
    },
  }
);
check('near-tied tips rotate toward the underrepresented family', result.primary.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.67 },
    { label: 'OVER_25', prob: 0.61 },
    { label: 'HOME_WIN', prob: 0.54 },
  ],
  value({ BTTS_YES: 0.12, OVER_25: 0.08, HOME_WIN: 0.06 }),
  null,
  {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: {
      fixtureCount: 10,
      maxPerLabel: 4,
      counts: { BTTS_YES: 4, OVER_25: 4, HOME_WIN: 4 },
    },
  }
);
check('quota fallback still returns a primary when all labels are full', Boolean(result.primary));

const rotatingCounts = {};
const fixtureCandidates = [
  { label: 'BTTS_YES', prob: 0.7 },
  { label: 'OVER_25', prob: 0.65 },
  { label: 'HOME_WIN', prob: 0.55 },
];
const fixtureEdges = value({ BTTS_YES: 0.16, OVER_25: 0.1, HOME_WIN: 0.06 });
for (let i = 0; i < 10; i += 1) {
  const picked = api.pickBets(fixtureCandidates, fixtureEdges, null, {
    hasBook: true,
    sampleSize: 5,
    dailyTipContext: { fixtureCount: 10, maxPerLabel: 4, counts: rotatingCounts },
  }).primary.label;
  rotatingCounts[picked] = (rotatingCounts[picked] || 0) + 1;
}
check('ten sequential picks respect the 40% per-label cap when alternatives exist',
  Math.max(...Object.values(rotatingCounts)) <= 4 &&
    rotatingCounts.BTTS_YES === 4 && rotatingCounts.OVER_25 === 4);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.72 },
    { label: 'BTTS_YES', prob: 0.70 },
    { label: 'HOME_WIN', prob: 0.55 },
  ],
  value({ OVER_25: 0.10, BTTS_YES: 0.09, HOME_WIN: 0.05 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check('secondary tip must come from a different family',
  result.primary.label === 'OVER_25' && result.secondary.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.72 },
    { label: 'BTTS_YES', prob: 0.70 },
  ],
  value({ OVER_25: 0.10, BTTS_YES: 0.09 }),
  null,
  { hasBook: true, sampleSize: 5 }
);
check('no same-family secondary is emitted when no other family exists', result.secondary == null);

result = api.pickBets(
  [
    { label: 'OVER_25', prob: 0.60 },
    { label: 'HOME_WIN', prob: 0.58 },
  ],
  { byLabel: {} },
  null,
  { hasBook: false, sampleSize: 1 }
);
check('thin-sample safe-core preference is preserved', result.primary.label === 'HOME_WIN');

result = api.pickBets(
  [
    { label: 'BTTS_YES', prob: 0.72 },
    { label: 'HOME_WIN', prob: 0.62 },
  ],
  { byLabel: {} },
  { blockedFamilies: ['goles'] },
  { hasBook: false, sampleSize: 5 }
);
check('calibration family blocks still apply', result.primary.label === 'HOME_WIN');

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
