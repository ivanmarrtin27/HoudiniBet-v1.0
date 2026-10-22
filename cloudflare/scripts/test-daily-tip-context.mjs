/** Regression tests for the D1 context used by daily tip quotas. */
import { getDailyTipDiversityContext } from '../src/db.js';

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
  { id: 10, suggested_bet: 'BTTS_YES' },
  { id: 11, suggested_bet: 'BTTS_YES' },
  { id: 12, suggested_bet: 'BTTS_YES' },
  { id: 13, suggested_bet: 'HOME_WIN' },
  { id: 14, suggested_bet: null },
];
let query = '';
let params = [];
const db = {
  all: async (sql, ...values) => {
    query = sql;
    params = values;
    return rows;
  },
};

const context = await getDailyTipDiversityContext(db, '2026-10-22', 11);
check('fixture count includes every scheduled match', context.fixtureCount === 5);
check('daily quota is 40% with a minimum of one', context.maxPerLabel === 2);
check('current match is excluded from existing tip counts', context.counts.BTTS_YES === 2);
check('unrecommended matches do not enter label counts', context.counts.HOME_WIN === 1);
check('query is date-scoped to scheduled allowlisted fixtures',
  query.includes('date(m.match_date) = date(?)') &&
    query.includes("m.status = 'scheduled'") &&
    query.includes('LEFT JOIN predictions'));
check('query binds the requested date', params[0] === '2026-10-22');

let emptyDbCalls = 0;
const empty = await getDailyTipDiversityContext({ all: async () => { emptyDbCalls += 1; return []; } }, null);
check('missing date returns empty context without querying D1',
  empty.fixtureCount === 0 && emptyDbCalls === 0);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
