/** Tests for the richer analysis panel: exact scores, head to head, table. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeadToHead, getLeagueTable } from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');
const SERVICE = readFileSync(resolve(HERE, '../src/services/predictionService.js'), 'utf8');
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

// ---------------------------------------------------------------- head to head
let h2hSql = '';
const h2hRows = [
  { id: 1, match_date: '2026-09-20 18:00:00', home_name: 'A', away_name: 'B', home_goals: 2, away_goals: 1, league_name: 'La Liga' },
  { id: 2, match_date: '2026-02-11 20:00:00', home_name: 'B', away_name: 'A', home_goals: 0, away_goals: 0, league_name: 'La Liga' },
];
const h2h = await getHeadToHead(
  {
    all: async (sql) => {
      h2hSql = sql;
      return h2hRows;
    },
  },
  'A',
  'B',
  { limit: 6, excludeId: 99, beforeDate: '2026-10-22 18:00:00' }
);
check('head to head matches both venue orders', h2hSql.includes('lower(ht.name) = lower(?1)') && h2hSql.includes('lower(at.name) = lower(?4)'));
check('head to head ignores matches without a score', h2hSql.includes('m.home_goals IS NOT NULL'));
check('head to head excludes the current match', h2hSql.includes('m.id != ?5'));
check('head to head has no lookahead before kickoff', h2hSql.includes('datetime(m.match_date) < datetime(?6)'));
check('head to head returns the newest meetings first', h2hSql.includes('ORDER BY m.match_date DESC'));
check('head to head normalises the result for the home team',
  h2h[0].homeWon === true && h2h[1].draw === true);
check('head to head keeps the date and league', h2h[0].date === '2026-09-20' && h2h[0].leagueName === 'La Liga');
check('head to head without names returns nothing', (await getHeadToHead({}, null, 'B')).length === 0);
// ---------------------------------------------------------------- league table
let tableSql = '';
const table = await getLeagueTable(
  {
    all: async (sql) => {
      tableSql = sql;
      return [
        { team_id: 1, team: 'A', won: 5, drawn: 2, lost: 1, gf: 14, ga: 6 },
        { team_id: 2, team: 'B', won: 4, drawn: 1, lost: 3, gf: 10, ga: 9 },
      ];
    },
  },
  1,
  20
);
check('league table only counts finished matches with a score',
  tableSql.includes("status = 'finished'") && tableSql.includes('home_goals IS NOT NULL'));
check('league table counts both venues', (tableSql.match(/UNION ALL/g) || []).length === 1);
check('league table sorts by points then goal difference',
  tableSql.includes('(SUM(r.won) * 3 + SUM(r.drawn)) DESC') && tableSql.includes('(SUM(r.gf) - SUM(r.ga)) DESC'));
check('league table exposes position, points and goal difference',
  table[0].position === 1 && table[0].points === 17 && table[0].goalDiff === 8);
check('league table without a league returns nothing', (await getLeagueTable({}, null)).length === 0);

// ---------------------------------------------------------------- wiring
check('bundle exposes the exact score grid', SERVICE.includes('scoreGrid: scoreGridFromMatrix(matrix)'));
check('bundle exposes the most likely scorelines', SERVICE.includes('topScores: topScoresFromMatrix(matrix)'));
check('bundle exposes head to head and the league table',
  SERVICE.includes('h2h,') && SERVICE.includes('leagueTable,') && SERVICE.includes('store.getHeadToHead') && SERVICE.includes('store.getLeagueTable'));
check('head to head call drops the current match and future meetings',
  SERVICE.includes('excludeId: match.id') && SERVICE.includes('beforeDate: match.matchDate'));
check('context blocks never break the tip',
  SERVICE.includes('keep the panel working without the score grid') && SERVICE.includes('h2h = [];'));
check('national-team tournaments and cups get no pseudo table', SERVICE.includes('table.length > 24'));
check('score grid is limited to five goals per side', SERVICE.includes('const size = Math.min(5, matrix.length)'));
check('goals tab renders the score grid', APP.includes('scoreGridHtml(bundle.scoreGrid, bundle.topScores'));
check('general tab renders head to head and the table',
  APP.includes('h2hHtml(bundle.h2h, homeName)') && APP.includes('leagueTableHtml(bundle.leagueTable'));
check('table highlights the teams of the match', APP.includes('is-mine'));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
