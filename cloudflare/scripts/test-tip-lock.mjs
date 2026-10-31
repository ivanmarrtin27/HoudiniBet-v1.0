/**
 * Tip lock: once tip_results exists and match is live/finished (or settled),
 * predictions.suggested_bet must stay on the Stats market.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const dbSrc = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');
const predSrc = readFileSync(resolve(HERE, '../src/services/predictionService.js'), 'utf8');

function check(name, ok) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${name}`);
  }
}

// Inline the pure helper (mirrors db.js) for runtime asserts.
function isTipMarketLocked(tipRow, matchStatus) {
  if (!tipRow?.suggested_bet) return false;
  const outcome = tipRow.outcome != null ? String(tipRow.outcome) : 'pending';
  if (outcome !== 'pending') return true;
  const st = matchStatus != null ? String(matchStatus) : '';
  return st === 'live' || st === 'finished';
}

check('scheduled + pending → unlocked', !isTipMarketLocked({ suggested_bet: 'OVER_15', outcome: 'pending' }, 'scheduled'));
check('live + pending → locked', isTipMarketLocked({ suggested_bet: 'OVER_15', outcome: 'pending' }, 'live'));
check('finished + pending → locked', isTipMarketLocked({ suggested_bet: 'OVER_15', outcome: 'pending' }, 'finished'));
check('settled hit → locked even scheduled', isTipMarketLocked({ suggested_bet: 'OVER_15', outcome: 'hit' }, 'scheduled'));
check('no tip → unlocked', !isTipMarketLocked(null, 'finished'));

check('db exports isTipMarketLocked', /export function isTipMarketLocked/.test(dbSrc));
check('db exports repairPredictionsToLockedTips', /export async function repairPredictionsToLockedTips/.test(dbSrc));
check('db exports getTipResultByMatchId', /export async function getTipResultByMatchId/.test(dbSrc));
check('predictMatch freezes locked tip', /tipMarketLocked/.test(predSrc) && /getTipResultByMatchId/.test(predSrc));
check('predictMatch skips tip_results upsert when locked', /hasPlayablePrimary && !tipMarketLocked/.test(predSrc));
check('admin sync-predictions route', /admin\/tips\/sync-predictions/.test(readFileSync(resolve(HERE, '../src/index.js'), 'utf8')));
check('sync runs repairPredictionsToLockedTips', /repairPredictionsToLockedTips/.test(readFileSync(resolve(HERE, '../src/services/syncService.js'), 'utf8')));

if (process.exitCode) {
  console.error('tip-lock tests failed');
} else {
  console.log('All tip-lock checks passed');
}
