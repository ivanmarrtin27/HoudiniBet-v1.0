/** Tests for Top 3 exact-label diversity. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, '../public/app.js'), 'utf8');
const idx = src.indexOf('function selectDiverseTips(');
if (idx < 0) throw new Error('selectDiverseTips not found');
const start = src.lastIndexOf('\n', idx) + 1;
const paren = src.indexOf('(', idx);
let parenDepth = 0;
let bodyStart = -1;
for (let i = paren; i < src.length; i += 1) {
  if (src[i] === '(') parenDepth += 1;
  else if (src[i] === ')') {
    parenDepth -= 1;
    if (parenDepth === 0) { bodyStart = src.indexOf('{', i); break; }
  }
}
let depth = 0;
let fn = '';
for (let i = bodyStart; i < src.length; i += 1) {
  if (src[i] === '{') depth += 1;
  else if (src[i] === '}') {
    depth -= 1;
    if (depth === 0) { fn = src.slice(start, i + 1); break; }
  }
}
if (!fn) throw new Error('selectDiverseTips not closed');
const selectDiverseTips = new Function(`${fn}; return selectDiverseTips;`)();

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
  { m: { id: 1, suggestedBet: 'BTTS_YES' } },
  { m: { id: 2, suggestedBet: 'BTTS_YES' } },
  { m: { id: 3, suggestedBet: 'OVER_25' } },
  { m: { id: 4, suggestedBet: 'HOME_WIN' } },
];
const top = selectDiverseTips(ranked, 3, 1);
check('Top 3 caps repeated labels at one when alternatives exist',
  top.map((x) => x.m.id).join(',') === '1,3,4');
check('diversification preserves the existing rank order',
  top[0] === ranked[0] && top[1] === ranked[2] && top[2] === ranked[3]);
check('configurable cap allows two of the same label',
  selectDiverseTips(ranked, 3, 2).map((x) => x.m.id).join(',') === '1,2,3');
check('fills Top 3 when only one label is available',
  selectDiverseTips(ranked.slice(0, 2), 3, 1).length === 2);
check('empty list remains empty', selectDiverseTips([], 3, 1).length === 0);
check('Top 3 uses the diversity selector', src.includes('selectDiverseTips(rankedTips, 3, 1)'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
