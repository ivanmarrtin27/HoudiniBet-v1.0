/** Tests for Top 10 exact-label + family diversity (max 3 per family). */
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
  `const TOP10_MAX_PER_FAMILY = 3;
   ${extractFunction('tipFamilyUi')}
   ${extractFunction('selectDiverseTips')}
   return { tipFamilyUi, selectDiverseTips };`
)();

const { tipFamilyUi, selectDiverseTips } = api;

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
check(
  'Top 10 tab loads server best-bets limit 10',
  src.includes('/api/v1/matches/best-bets?date=') && src.includes('limit=10')
);
check('secondary tip meta wired in client pool', src.includes('secondaryTipOdds'));

void monoOu;
void mixed;

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
