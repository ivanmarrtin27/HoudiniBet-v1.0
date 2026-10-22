/** Contract tests for real bookmaker odds parsing from API-Football. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '../src/services/syncService.js'), 'utf8');

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
      if (parenDepth === 0) { bodyStart = SRC.indexOf('{', i); break; }
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

const functions = ['findBet', 'oddValue', 'extractOddsFields', 'orderBookmakers', 'mergeOddsFromBookmakers']
  .map(extractFunction);
const api = new Function(
  `${functions.join('\n\n')}\nreturn { extractOddsFields, mergeOddsFromBookmakers };`
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

const sampleBets = [
  {
    name: 'Match Winner',
    values: [
      { value: 'Home', odd: '1.91' },
      { value: 'Draw', odd: '3.55' },
      { value: 'Away', odd: '4.20' },
    ],
  },
  {
    name: 'Goals Over/Under',
    values: [
      { value: 'Over 2.5', odd: '1.88' },
      { value: 'Under 2.5', odd: '1.96' },
    ],
  },
  {
    name: 'Both Teams Score',
    values: [
      { value: 'Yes', odd: '1.72' },
      { value: 'No', odd: '2.08' },
    ],
  },
];

const fields = api.extractOddsFields(sampleBets);
check('extracts decimal 1X2 bookmaker prices',
  fields.home === 1.91 && fields.draw === 3.55 && fields.away === 4.2);
check('extracts O/U 2.5 and BTTS without model estimates',
  fields.over25 === 1.88 && fields.under25 === 1.96 &&
    fields.bttsYes === 1.72 && fields.bttsNo === 2.08);
check('rejects invalid odds at or below 1',
  api.extractOddsFields([{ name: 'Match Winner', values: [{ value: 'Home', odd: '1' }] }]).home == null);

const merged = api.mergeOddsFromBookmakers([
  { name: 'RestBook', bets: [{ name: 'Match Winner', values: [{ value: 'Home', odd: '2.0' }] }] },
  { name: 'Sportium', bets: sampleBets },
]);
check('preferred bookmaker fills markets first',
  merged.bookmaker === 'Sportium' && merged.home === 1.91 && merged.over25 === 1.88);
check('missing markets stay null instead of being synthesized',
  merged.cornersOver95 == null && merged.cardsOver35 == null);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
