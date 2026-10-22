/** Tests the API-Football free-tier request planner and D1 odds retry policy. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countOddsRows,
  getOddsForMatch,
  getUpcomingForOddsEnrichment,
} from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNC = readFileSync(resolve(HERE, '../src/services/syncService.js'), 'utf8');
const idx = SYNC.indexOf('function planApiFootballEnrichLimits(');
if (idx < 0) throw new Error('planApiFootballEnrichLimits not found');
const start = SYNC.lastIndexOf('\n', idx) + 1;
const paren = SYNC.indexOf('(', idx);
let parenDepth = 0;
let bodyStart = -1;
for (let i = paren; i < SYNC.length; i += 1) {
  if (SYNC[i] === '(') parenDepth += 1;
  else if (SYNC[i] === ')') {
    parenDepth -= 1;
    if (parenDepth === 0) { bodyStart = SYNC.indexOf('{', i); break; }
  }
}
let depth = 0;
let fn = '';
for (let i = bodyStart; i < SYNC.length; i += 1) {
  if (SYNC[i] === '{') depth += 1;
  else if (SYNC[i] === '}') {
    depth -= 1;
    if (depth === 0) { fn = SYNC.slice(start, i + 1); break; }
  }
}
if (!fn) throw new Error('planApiFootballEnrichLimits not closed');
const planApiFootballEnrichLimits = new Function(
  'ODDS_ENRICH_LIMIT',
  'STATS_ENRICH_LIMIT',
  'AF_FREE_RESERVE_REQUESTS',
  `${fn}; return planApiFootballEnrichLimits;`
)(20, 8, 10);

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

check('unknown remaining quota uses conservative default',
  JSON.stringify(planApiFootballEnrichLimits(null)) ===
    JSON.stringify({ oddsLimit: 15, statsLimit: 5, estimatedRequests: 41 }));
check('100 free requests are capped well below daily limit',
  planApiFootballEnrichLimits(100).oddsLimit === 20 &&
    planApiFootballEnrichLimits(100).statsLimit === 8 &&
    planApiFootballEnrichLimits(100).estimatedRequests <= 100);
check('second enrich run adapts to the remaining free quota',
  planApiFootballEnrichLimits(43).oddsLimit === 12 &&
    planApiFootballEnrichLimits(43).statsLimit === 4 &&
    planApiFootballEnrichLimits(43).estimatedRequests <= 43);
check('low remaining quota reduces work rather than overspending',
  planApiFootballEnrichLimits(20).oddsLimit === 4 &&
    planApiFootballEnrichLimits(20).statsLimit === 1);
check('exhausted quota skips both enrichers',
  planApiFootballEnrichLimits(10).oddsLimit === 0 &&
    planApiFootballEnrichLimits(10).statsLimit === 0);
check('API requests are paced below free-plan 10/minute cap',
  SYNC.includes('const API_FOOTBALL_MIN_INTERVAL_MS = 6200') &&
    /async function apiGet\([\s\S]*?if \(rateLimit\) await rateLimit\(\)/.test(SYNC));
check('enrichment uses the probed remaining quota for both syncs',
  SYNC.includes('planApiFootballEnrichLimits(afProbe.remaining)') &&
    SYNC.includes('quotaPlan.statsLimit') && SYNC.includes('quotaPlan.oddsLimit'));

let oddsQuery = '';
let upcomingQuery = '';
const fakeDb = {
  first: async (sql) => { oddsQuery = sql; return { c: 0 }; },
  all: async (sql) => { upcomingQuery = sql; return []; },
};
await countOddsRows(fakeDb);
await getUpcomingForOddsEnrichment(fakeDb, 20, 14);
check('odds coverage excludes empty request-attempt rows',
  oddsQuery.includes('home_odds IS NOT NULL') && oddsQuery.includes('btts_yes_odds IS NOT NULL'));
check('odds enrichment waits 12h before retrying an incomplete market',
  upcomingQuery.includes("datetime(recent.updated_at) > datetime('now', '-12 hours')") &&
    upcomingQuery.includes('NOT EXISTS'));

let selectedQuery = '';
await getOddsForMatch({ first: async (sql) => { selectedQuery = sql; return null; } }, 123);
check('best odds row prefers the most useful market coverage',
  selectedQuery.includes('(home_odds IS NOT NULL)') && selectedQuery.includes('btts_yes_odds IS NOT NULL'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
