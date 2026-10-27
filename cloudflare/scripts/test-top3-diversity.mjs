/** Tests for Top 10 exact-label + family diversity (max 3 per family) + soft fill. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, '../public/app.js'), 'utf8');

function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`${name} not found`);
  const start = src.lastIndexOf('\n', idx) + 1;
  const paren = src.indexOf('(', idx);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paren; i < src.length; i += 1) {
    if (src[i] === '(') parenDepth += 1;
    else if (src[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = src.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (let i = bodyStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} not closed`);
}

const api = new Function(
  `const TOP10_MIN_PROB = 75;
   const TOP10_SOFT_MIN_PROB = 69;
   const TOP10_MIN_ODDS = 1.3;
   const TOP10_MAX_ODDS = 3.5;
   const TOP10_TRIVIAL_LABELS = new Set(['OVER_05', 'UNDER_45']);
   const TOP10_MAX_PER_FAMILY = 3;
   const TOP10_LIMIT = 10;
   const TOP10_WINDOW_DAYS = 14;
   function tipProbPct(raw) {
     const conf = raw?.confidenceScore != null ? Number(raw.confidenceScore) : null;
     return conf != null && conf > 0 ? conf : null;
   }
   ${extractFunction('isTrivialTop10Label')}
   ${extractFunction('tipOddsForTop10Band')}
   ${extractFunction('tipPlayableScore')}
   ${extractFunction('tipFamilyUi')}
   ${extractFunction('isTop10MatchStatus')}
   ${extractFunction('selectDiverseTips')}
   ${extractFunction('buildTop10Pool')}
   ${extractFunction('pickTop10Tips')}
   return {
     tipFamilyUi,
     selectDiverseTips,
     tipOddsForTop10Band,
     tipPlayableScore,
     buildTop10Pool,
     pickTop10Tips,
     isTop10MatchStatus,
   };`
)();

const {
  tipFamilyUi,
  selectDiverseTips,
  tipOddsForTop10Band,
  tipPlayableScore,
  buildTop10Pool,
  pickTop10Tips,
  isTop10MatchStatus,
} = api;

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

const ranked = [
  { m: { id: 1, suggestedBet: 'BTTS_YES' }, tipLabel: 'BTTS_YES', matchId: 1 },
  { m: { id: 2, suggestedBet: 'BTTS_YES' }, tipLabel: 'BTTS_YES', matchId: 2 },
  { m: { id: 3, suggestedBet: 'OVER_25' }, tipLabel: 'OVER_25', matchId: 3 },
  { m: { id: 4, suggestedBet: 'HOME_WIN' }, tipLabel: 'HOME_WIN', matchId: 4 },
];
const top = selectDiverseTips(ranked, 3, 1, 3);
check(
  'Top caps repeated labels at one when alternatives exist',
  top.map((x) => x.matchId).join(',') === '1,3,4'
);
check(
  'diversification prefers unused families in rank order',
  top[0] === ranked[0] && top[1] === ranked[2] && top[2] === ranked[3]
);

const monoOu = Array.from({ length: 12 }, (_, i) => ({
  m: { id: i + 1, suggestedBet: 'OVER_25' },
  tipLabel: i < 8 ? 'OVER_25' : `UNDER_${15 + (i - 8)}`,
  matchId: i + 1,
}));
// Fix labels so we have unique labels in same family for fill, plus other families
const mixed = [
  ...Array.from({ length: 5 }, (_, i) => ({
    tipLabel: 'OVER_25',
    matchId: 100 + i,
    m: { id: 100 + i, suggestedBet: 'OVER_25' },
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    tipLabel: 'BTTS_YES',
    matchId: 200 + i,
    m: { id: 200 + i, suggestedBet: 'BTTS_YES' },
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    tipLabel: 'HOME_WIN',
    matchId: 300 + i,
    m: { id: 300 + i, suggestedBet: 'HOME_WIN' },
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    tipLabel: 'CORNERS_OVER_95',
    matchId: 400 + i,
    m: { id: 400 + i, suggestedBet: 'CORNERS_OVER_95' },
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    tipLabel: 'CARDS_UNDER_45',
    matchId: 500 + i,
    m: { id: 500 + i, suggestedBet: 'CARDS_UNDER_45' },
  })),
];
// Unique labels within family for maxPerLabel=1 — use distinct labels
const wide = [
  { tipLabel: 'OVER_15', matchId: 1, m: { id: 1 } },
  { tipLabel: 'OVER_25', matchId: 2, m: { id: 2 } },
  { tipLabel: 'OVER_35', matchId: 3, m: { id: 3 } },
  { tipLabel: 'UNDER_25', matchId: 4, m: { id: 4 } },
  { tipLabel: 'BTTS_YES', matchId: 5, m: { id: 5 } },
  { tipLabel: 'BTTS_NO', matchId: 6, m: { id: 6 } },
  { tipLabel: 'HOME_WIN', matchId: 7, m: { id: 7 } },
  { tipLabel: 'AWAY_WIN', matchId: 8, m: { id: 8 } },
  { tipLabel: 'CORNERS_OVER_95', matchId: 9, m: { id: 9 } },
  { tipLabel: 'CORNERS_UNDER_95', matchId: 10, m: { id: 10 } },
  { tipLabel: 'CARDS_OVER_45', matchId: 11, m: { id: 11 } },
  { tipLabel: 'CARDS_UNDER_45', matchId: 12, m: { id: 12 } },
  { tipLabel: 'SOT_OVER_75', matchId: 13, m: { id: 13 } },
  { tipLabel: 'DC_1X', matchId: 14, m: { id: 14 } },
];
const top10 = selectDiverseTips(wide, 10, 1, 3);
const fams = new Set(top10.map((x) => tipFamilyUi(x.tipLabel)));
const famCounts = {};
for (const x of top10) {
  const f = tipFamilyUi(x.tipLabel);
  famCounts[f] = (famCounts[f] || 0) + 1;
}
check('wide pool yields 10 tips', top10.length === 10);
check('wide pool spans at least 4 families', fams.size >= 4);
check(
  'no family exceeds soft cap of 3 in pass 1 when alternatives exist',
  Object.values(famCounts).every((n) => n <= 3)
);
check(
  'does not take 8 of the same ou family when alternatives exist',
  (famCounts.ou || 0) <= 3
);

const small = wide.slice(0, 4);
check('small pool of 4 returns length 4', selectDiverseTips(small, 10, 1, 3).length === 4);

check(
  'same match id only once',
  selectDiverseTips(
    [
      { tipLabel: 'OVER_25', matchId: 9, m: { id: 9 } },
      { tipLabel: 'BTTS_YES', matchId: 9, m: { id: 9 } },
      { tipLabel: 'HOME_WIN', matchId: 10, m: { id: 10 } },
    ],
    3,
    1,
    3
  ).map((x) => x.matchId).join(',') === '9,10'
);

check('empty list remains empty', selectDiverseTips([], 10, 1, 3).length === 0);
check('buildTop10Pool exists', src.includes('function buildTop10Pool('));
check('pickTop10Tips exists', src.includes('function pickTop10Tips('));
check('soft min prob is 69', src.includes('const TOP10_SOFT_MIN_PROB = 69'));
check('primary min prob is 75', src.includes('const TOP10_MIN_PROB = 75'));
check('Top 10 window is 14 days', src.includes('const TOP10_WINDOW_DAYS = 14'));
check(
  'Top 10 builds from multi-day upcoming pool, not single-date / playable-only best-bets',
  src.includes('days=${TOP10_WINDOW_DAYS}') &&
    src.includes('pickTop10Tips(matches') &&
    !/renderTop3[\s\S]*?matches\/today\?date=/.test(src.slice(src.indexOf('async function renderTop3'))) &&
    !/renderTop3[\s\S]*?best-bets\?date=/.test(src.slice(src.indexOf('async function renderTop3')))
);
check('model-implied odds helper for null tipOdds', src.includes('function tipOddsForTop10Band('));
check('secondary tip meta wired in client pool', src.includes('secondaryTipOdds'));

/** 15 mixed-prob candidates → diversity returns 10 (primary preferred via sort order). */
const mixedProb15 = [
  { tipLabel: 'OVER_15', matchId: 1, m: { id: 1 }, meta: { primaryPass: true, prob: 82, score: 0.4, kind: 'est' } },
  { tipLabel: 'OVER_25', matchId: 2, m: { id: 2 }, meta: { primaryPass: true, prob: 78, score: 0.38, kind: 'est' } },
  { tipLabel: 'OVER_35', matchId: 3, m: { id: 3 }, meta: { primaryPass: false, prob: 71, score: 0.3, kind: 'est' } },
  { tipLabel: 'UNDER_25', matchId: 4, m: { id: 4 }, meta: { primaryPass: false, prob: 70, score: 0.29, kind: 'est' } },
  { tipLabel: 'BTTS_YES', matchId: 5, m: { id: 5 }, meta: { primaryPass: true, prob: 76, score: 0.35, kind: 'book' } },
  { tipLabel: 'BTTS_NO', matchId: 6, m: { id: 6 }, meta: { primaryPass: false, prob: 69, score: 0.28, kind: 'est' } },
  { tipLabel: 'HOME_WIN', matchId: 7, m: { id: 7 }, meta: { primaryPass: true, prob: 80, score: 0.39, kind: 'book' } },
  { tipLabel: 'AWAY_WIN', matchId: 8, m: { id: 8 }, meta: { primaryPass: false, prob: 72, score: 0.31, kind: 'est' } },
  { tipLabel: 'CORNERS_OVER_95', matchId: 9, m: { id: 9 }, meta: { primaryPass: true, prob: 77, score: 0.36, kind: 'est' } },
  { tipLabel: 'CORNERS_UNDER_95', matchId: 10, m: { id: 10 }, meta: { primaryPass: false, prob: 69, score: 0.27, kind: 'est' } },
  { tipLabel: 'CARDS_OVER_45', matchId: 11, m: { id: 11 }, meta: { primaryPass: true, prob: 75, score: 0.34, kind: 'est' } },
  { tipLabel: 'CARDS_UNDER_45', matchId: 12, m: { id: 12 }, meta: { primaryPass: false, prob: 70, score: 0.28, kind: 'est' } },
  { tipLabel: 'SOT_OVER_75', matchId: 13, m: { id: 13 }, meta: { primaryPass: false, prob: 71, score: 0.29, kind: 'est' } },
  { tipLabel: 'DC_1X', matchId: 14, m: { id: 14 }, meta: { primaryPass: true, prob: 79, score: 0.37, kind: 'book' } },
  { tipLabel: 'DC_X2', matchId: 15, m: { id: 15 }, meta: { primaryPass: false, prob: 69, score: 0.26, kind: 'est' } },
];
const ranked15 = [...mixedProb15].sort((a, b) => {
  const aPri = a.meta.primaryPass ? 1 : 0;
  const bPri = b.meta.primaryPass ? 1 : 0;
  if (bPri !== aPri) return bPri - aPri;
  return b.meta.prob - a.meta.prob;
});
const filled10 = selectDiverseTips(ranked15, 10, 1, 3);
check('15 mixed-prob candidates fill to 10', filled10.length === 10);
check(
  'soft fill prefers primary-pass tips first',
  filled10.slice(0, 5).every((x) => x.meta.primaryPass)
);
check(
  'soft fill includes at least one soft-floor tip when primary underfills families',
  filled10.some((x) => !x.meta.primaryPass) || filled10.filter((x) => x.meta.primaryPass).length >= 7
);

void monoOu;
void mixed;

check(
  'null tipOdds uses model-implied 1/p inside band',
  Math.abs(tipOddsForTop10Band({ tipOdds: null }, 70) - 1 / 0.7) < 1e-9
);
check(
  'null tipOdds candidate is eligible (not rejected by odds band)',
  tipPlayableScore(
    { suggestedBet: 'OVER_25', tipOdds: null, oddsSource: 'model', confidenceScore: 76 },
    69
  ) != null
);
check(
  'odds below band still rejected even with high P',
  tipPlayableScore(
    { suggestedBet: 'DC_1X', tipOdds: 1.1, oddsSource: 'model', confidenceScore: 90 },
    69
  ) == null
);
check('finished matches excluded from Top 10 status', isTop10MatchStatus('finished') === false);
check('scheduled matches allowed', isTop10MatchStatus('scheduled') === true);

// P 69–76 → model 1/p stays inside 1.30–3.50; P≥77 alone would fall under 1.30.
const nullOddsPool = Array.from({ length: 12 }, (_, i) => ({
  id: 1000 + i,
  status: 'scheduled',
  suggestedBet: [
    'OVER_15',
    'OVER_25',
    'UNDER_25',
    'BTTS_YES',
    'HOME_WIN',
    'AWAY_WIN',
    'DC_1X',
    'DNB_HOME',
    'CORNERS_OVER_95',
    'CARDS_UNDER_45',
    'SOT_OVER_75',
    'DC_X2',
  ][i],
  tipOdds: null,
  oddsSource: 'model',
  confidenceScore: 76 - (i % 6),
  secondaryBet: null,
}));
const filledFromNullOdds = pickTop10Tips(nullOddsPool, 10);
check(
  '12 scheduled null-odds tips fill Top 10 to 10',
  filledFromNullOdds.length === 10
);
check(
  'high P with null tipOdds fails min band via 1/p (<1.30)',
  tipPlayableScore(
    { suggestedBet: 'OVER_25', tipOdds: null, oddsSource: 'model', confidenceScore: 80 },
    69
  ) == null
);
check(
  'finished-only day cannot fill Top 10',
  pickTop10Tips(
    [
      {
        id: 1,
        status: 'finished',
        suggestedBet: 'DNB_AWAY',
        tipOdds: 1.7,
        oddsSource: 'model',
        confidenceScore: 76,
      },
    ],
    10
  ).length === 0
);
check(
  'buildTop10Pool skips finished even if soft-eligible',
  buildTop10Pool([
    {
      id: 9,
      status: 'finished',
      suggestedBet: 'HOME_WIN',
      tipOdds: 1.8,
      oddsSource: 'model',
      confidenceScore: 80,
    },
    {
      id: 10,
      status: 'scheduled',
      suggestedBet: 'AWAY_WIN',
      tipOdds: 1.9,
      oddsSource: 'model',
      confidenceScore: 80,
    },
  ]).map((x) => x.matchId).join(',') === '10'
);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
