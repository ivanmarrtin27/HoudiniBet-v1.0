/** Live name-match threshold + pre-kickoff guard. */
import {
  findBestFixtureMatch,
  isPreKickoff,
  LIVE_NAME_MATCH_MIN,
  teamNameScore,
} from '../src/services/syncService.js';

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

check('LIVE_NAME_MATCH_MIN is 85', LIVE_NAME_MATCH_MIN === 85);

const atleti = 'Atlético de Madrid';
const depor = 'RC Deportivo';
const colombian = {
  teams: { home: { name: 'Atlético Nacional' }, away: { name: 'Deportivo Cali' } },
};
const exact = {
  teams: { home: { name: 'Atlético de Madrid' }, away: { name: 'RC Deportivo' } },
};

const hsWrong = teamNameScore(atleti, colombian.teams.home.name);
const asWrong = teamNameScore(depor, colombian.teams.away.name);
check(
  'partial Atlético/Deportivo score is below 85',
  Math.min(hsWrong, asWrong) < 85
);
check(
  'ambiguous Colombian fixture rejected at threshold 85',
  findBestFixtureMatch([colombian], atleti, depor) == null
);
check(
  'exact Atlético–Deportivo still matches',
  findBestFixtureMatch([exact, colombian], atleti, depor) === exact
);

const future = new Date(Date.now() + 3 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ');
const past = new Date(Date.now() - 3 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ');
check('future kickoff is pre-kickoff', isPreKickoff(future) === true);
check('past kickoff is not pre-kickoff', isPreKickoff(past) === false);
check('empty date is not pre-kickoff', isPreKickoff(null) === false);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
