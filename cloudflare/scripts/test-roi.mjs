/** Tests for stake profitability (yield/ROI) and its wiring into the API. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStakeResults, computeStakeResultsBy } from '../src/services/roi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');
const API = readFileSync(resolve(HERE, '../src/index.js'), 'utf8');
const APP = readFileSync(resolve(HERE, '../public/app.js'), 'utf8');

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

const book = (odds, outcome) => ({ odds, outcome, source: 'book' });
const model = (odds, outcome) => ({ odds, outcome, source: 'model' });

let r = computeStakeResults([
  book(2.0, 'hit'),
  book(2.0, 'miss'),
  book(3.0, 'hit'),
]);
check('book-priced hits multiply the stake', r.staked === 3 && r.hits === 2 && r.misses === 1);
check('profit counts (odds-1) per hit minus one unit per miss',
  Math.abs(r.profit - 2) < 1e-9, String(r.profit));
check('yield is profit over staked bets', Math.abs(r.yield - 2 / 3) < 1e-4, String(r.yield));
check('average odds is reported for priced bets', Math.abs(r.avgOdds - 7 / 3) < 1e-4);

r = computeStakeResults([model(1.6, 'hit'), model(1.6, 'miss'), model(1.6, 'hit')]);
check('model-implied prices never count as stakes', r.staked === 0 && r.yield === null);
check('model-implied prices are counted separately', r.modelPriced === 3);

r = computeStakeResults([book(2.0, 'void'), book(2.0, 'hit')]);
check('void bets return the stake and add no profit', r.voids === 1 && r.staked === 1 && r.profit === 1);

r = computeStakeResults([book(2.0, 'hit'), { odds: null, outcome: 'hit', source: 'book' }]);
check('book rows without a usable price are ignored', r.staked === 1 && r.hits === 1);

r = computeStakeResults([]);
check('empty input returns a safe empty result', r.staked === 0 && r.yield === null && r.profit === 0);

const byFamily = computeStakeResultsBy(
  [
    { ...book(2.0, 'hit'), family: 'goles' },
    { ...book(2.0, 'miss'), family: 'goles' },
    { ...book(3.0, 'hit'), family: '1X2' },
  ],
  (row) => row.family
);
check('profitability is grouped per family',
  byFamily.goles?.staked === 2 && byFamily['1X2']?.staked === 1 && byFamily.goles?.yield === 0);

check('tip ledger stores the odds source', DB.includes('odds_source = CASE WHEN tip_results.outcome'));
check('performance endpoint exposes roi', API.includes('roi: perf.roi || null') && API.includes('roiByFamily'));
check('performance query only counts book prices for roi',
  DB.includes("odds_source = 'book'") && DB.includes('tr.odds_source'));
check('stake rows are normalised before the roi maths',
  DB.includes('const stakeRows = stakeRowsRaw.map') && DB.includes('source: r.odds_source'));
check('family profitability uses the same normalised rows',
  DB.includes('computeStakeResultsBy(stakeRows, (r) => r.family)'));
check('combo ledger stores the odds source', DB.includes('odds_source = CASE WHEN combo_results.outcome'));
check('stats view renders the profitability block', APP.includes('perfRoiHtml(perf)'));
check('stats view explains when no book price exists',
  APP.includes('Sin cuota de casa') && APP.includes('tips con precio del modelo'));
check('stats view shows roi per family', APP.includes('perf-strip__roi'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
