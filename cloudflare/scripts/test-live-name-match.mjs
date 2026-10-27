/** Live name-match threshold + pre-kickoff guard + PL aliases. */
import {
  findBestFixtureMatch,
  isPreKickoff,
  isInPostKickoffLiveWindow,
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

check(
  'Man City alias scores 100 vs Manchester City',
  teamNameScore('Man City', 'Manchester City') === 100
);
check(
  'Aston Villa exact still 100',
  teamNameScore('Aston Villa', 'Aston Villa') === 100
);

const villaCityFm = {
  teams: { home: { name: 'Aston Villa' }, away: { name: 'Manchester City' } },
};
const otherPl = {
  teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } },
};
check(
  'kickoff pasado sin fotmob id: Villa–Man City name-matches FotMob Manchester City',
  findBestFixtureMatch([otherPl, villaCityFm], 'Aston Villa', 'Man City') === villaCityFm
);
check(
  'past kickoff is in post-kickoff live window',
  isInPostKickoffLiveWindow(past) === true
);
check(
  'future kickoff is not in post-kickoff live window',
  isInPostKickoffLiveWindow(future) === false
);

check('Hull vs Hull City scores 100', teamNameScore('Hull', 'Hull City') === 100);
check('Getafe CF vs Getafe scores 100', teamNameScore('Getafe CF', 'Getafe') === 100);
check(
  'Liverpool vs Brighton & Hove Albion scores at least 85',
  Math.min(
    teamNameScore('Liverpool', 'Liverpool'),
    teamNameScore('Brighton', 'Brighton & Hove Albion')
  ) >= 85
);

check('Osasuna vs CA Osasuna scores at least 85', teamNameScore('Osasuna', 'CA Osasuna') >= 85);
check(
  'Lyon vs Olympique Lyonnais scores at least 85',
  teamNameScore('Lyon', 'Olympique Lyonnais') >= 85
);
check(
  'PSG vs Paris Saint-Germain scores at least 85',
  teamNameScore('PSG', 'Paris Saint-Germain') >= 85
);

const sevillaFm = {
  teams: { home: { name: 'Sevilla' }, away: { name: 'CA Osasuna' } },
};
const otherLaLiga = {
  teams: { home: { name: 'Real Madrid' }, away: { name: 'Barcelona' } },
};
check(
  'Sevilla FC–Osasuna name-matches FotMob Sevilla–CA Osasuna',
  findBestFixtureMatch([otherLaLiga, sevillaFm], 'Sevilla FC', 'Osasuna') === sevillaFm
);

const psgFm = {
  teams: { home: { name: 'Paris Saint-Germain' }, away: { name: 'Olympique Lyonnais' } },
};
const otherL1 = {
  teams: { home: { name: 'Marseille' }, away: { name: 'Monaco' } },
};
check(
  'Paris Saint-Germain–Lyon name-matches FotMob PSG–Olympique Lyonnais',
  findBestFixtureMatch([otherL1, psgFm], 'Paris Saint-Germain', 'Lyon') === psgFm
);
check(
  'PSG–Lyon name-matches FotMob Paris Saint-Germain–Olympique Lyonnais',
  findBestFixtureMatch([otherL1, psgFm], 'PSG', 'Lyon') === psgFm
);

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
