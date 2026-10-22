/** Tests the daily-sync selector that recomputes lowest-confidence duplicates. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '../src/services/syncService.js'), 'utf8');
const idx = SRC.indexOf('function dailyDiversityRebalanceIds(');
if (idx < 0) throw new Error('dailyDiversityRebalanceIds not found');
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
let fn = '';
for (let i = bodyStart; i < SRC.length; i += 1) {
  if (SRC[i] === '{') depth += 1;
  else if (SRC[i] === '}') {
    depth -= 1;
    if (depth === 0) { fn = SRC.slice(start, i + 1); break; }
  }
}
if (!fn) throw new Error('dailyDiversityRebalanceIds not closed');
const dailyDiversityRebalanceIds = new Function(`${fn}; return dailyDiversityRebalanceIds;`)();

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

const rows = [
  ...Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    match_day: '2026-10-22',
    suggested_bet: 'BTTS_YES',
    confidence_score: 60 + i,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: i + 7,
    match_day: '2026-10-22',
    suggested_bet: ['HOME_WIN', 'UNDER_25', 'OVER_25', 'AWAY_WIN'][i],
    confidence_score: 70 + i,
  })),
  { id: 11, match_day: '2026-10-23', suggested_bet: 'AWAY_WIN', confidence_score: 50 },
  { id: 12, match_day: '2026-10-23', suggested_bet: 'AWAY_WIN', confidence_score: 65 },
  { id: 13, match_day: '2026-10-23', suggested_bet: 'AWAY_WIN', confidence_score: 70 },
  { id: 14, match_day: '2026-10-23', suggested_bet: 'HOME_WIN', confidence_score: 71 },
  { id: 15, match_day: '2026-10-23', suggested_bet: 'BTTS_NO', confidence_score: 72 },
];

const ids = dailyDiversityRebalanceIds(rows, 40);
check('daily quota selects exactly the over-cap duplicates', ids.length === 3);
check('lowest-confidence duplicates are recomputed first', ids.slice(0, 2).join(',') === '1,2');
check('different dates use separate 40% caps', ids[2] === 11);
check('already diverse and missing-tip rows are untouched', !ids.includes(7) && !ids.includes(14));
check('recompute candidate count respects the caller limit', dailyDiversityRebalanceIds(rows, 2).length === 2);
check('empty input is safe', dailyDiversityRebalanceIds([], 40).length === 0);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
