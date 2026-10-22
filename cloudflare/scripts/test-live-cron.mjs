/** Tests for the live cron: schedule, routing, guard and status exposure. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLiveWorkStatus } from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(resolve(HERE, '../src/index.js'), 'utf8');
const SYNC = readFileSync(resolve(HERE, '../src/services/syncService.js'), 'utf8');
const DB = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');
const WRANGLER = readFileSync(resolve(HERE, '../wrangler.jsonc'), 'utf8');

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

const cron = INDEX.match(/const LIVE_CRON = '([^']+)'/)?.[1];
check('live cron expression is defined', cron === '*/10 15-23 * * *', String(cron));
check('live cron is registered in wrangler', WRANGLER.includes('"*/10 15-23 * * *"'));
check('live cron keeps the worker within the cron trigger limit',
  (WRANGLER.match(/"[0-9*\/ ]+ \* \* \*"/g) || []).length <= 5);
check('scheduled handler routes the live cron to the live refresh',
  INDEX.includes("if (cron === LIVE_CRON)") && INDEX.includes('runLiveCron(env, db)'));
check('live cron does not fall through to the daily sync',
  INDEX.indexOf("if (cron === LIVE_CRON)") <
    INDEX.indexOf('runDailySync(env, db)', INDEX.indexOf('async scheduled(')));
check('live cron runs in the background', INDEX.includes('ctx.waitUntil('));

// The window must cover European evening kickoffs (UTC) and US evening games.
const step = Number(cron.split(' ')[0].split('/')[1]);
const [fromHour, toHour] = cron.split(' ')[1].split('-').map(Number);
check('live cron runs every 10 minutes', step === 10, String(step));
check('live cron covers the European match window',
  fromHour <= 16 && toHour >= 22, `${fromHour}-${toHour}`);

check('live cron skips the upstream calls when there is no work',
  SYNC.includes('if (!work.needsWork)') && SYNC.includes('reason:'));
check('live cron reuses the shared live refresh', SYNC.includes('runLiveStatusRefresh(env, db)'));
check('live cron records when it last ran', SYNC.includes("'last_live_cron_at'"));

let sql = '';
const status = await getLiveWorkStatus({
  first: async (query) => {
    sql = query;
    return { live: 1, pending_tips: 2, kicking: 0 };
  },
});
check('work status counts live, pending tips and kicking matches',
  sql.includes("status = 'live'") && sql.includes("outcome = 'pending'") && sql.includes('kicking'));
check('work status reports work when something is live', status.needsWork === true);
check('work status reports the counters', status.live === 1 && status.pendingTips === 2);

const idle = await getLiveWorkStatus({
  first: async () => ({ live: 0, pending_tips: 0, kicking: 0 }),
});
check('work status reports no work when everything is idle', idle.needsWork === false);

check('status endpoint exposes the live cron timestamps',
  INDEX.includes('lastLiveCronAt: lastLiveCronAt || null') &&
    INDEX.includes('lastLiveRefreshAt: lastLiveRefreshAt || null'));
check('status endpoint exposes the live work counters', INDEX.includes('liveWork,'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
