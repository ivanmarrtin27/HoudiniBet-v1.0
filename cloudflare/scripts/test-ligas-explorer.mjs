/** Static + mock checks for Ligas explorer (folders → table → next match). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLeagueByApiId, getLeagueTable, getNextForTeam } from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');
const INDEX = readFileSync(resolve(HERE, '../src/index.js'), 'utf8');
const APP = readFileSync(resolve(HERE, '../public/app.js'), 'utf8');
const HTML = readFileSync(resolve(HERE, '../public/index.html'), 'utf8');
const CSS = readFileSync(resolve(HERE, '../public/styles.css'), 'utf8');

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

check('HTML has explorer + detail shells', HTML.includes('id="ligas-explorer"') && HTML.includes('id="ligas-detail"'));
check('HTML uses browse-split for Ligas', HTML.includes('ligas-split') && HTML.includes('ligasBrowsePanel'));
check('HTML dropped multi-select tabs as primary', !HTML.includes('data-ligas-scope') && !HTML.includes('id="ligas-apply"'));
check('CSS has folder accordion and standings table', CSS.includes('.ligas-folder') && CSS.includes('.ligas-standings'));
check('CSS has ligas mobile selection', CSS.includes('has-ligas-selection'));
check('UI folders expose flagCountry for countries', APP.includes("flagCountry: 'Spain'") && APP.includes('flagCountry: null'));
check('UI tree starts with Europeas then top5 countries',
  APP.includes("key: 'europeas'") &&
    APP.includes("key: 'england'") &&
    APP.includes("key: 'spain'") &&
    APP.includes("key: 'italy'") &&
    APP.includes("key: 'germany'") &&
    APP.includes("key: 'france'"));
check('UI tree includes UCL UEL UNL and Segunda api ids',
  APP.includes('apiId: 2') &&
    APP.includes('apiId: 3') &&
    APP.includes('apiId: 5') &&
    APP.includes('apiId: 141'));
check('Deep link #ligas/<apiId> is parsed', APP.includes('parseLigasApiIdFromHash') && APP.includes('#ligas/'));
check('Tap team uses /api/v1/teams/:id nextMatch → openPrediction',
  APP.includes('/api/v1/teams/${teamId}') &&
    APP.includes('insight?.nextMatch?.id') &&
    APP.includes('openPrediction(nextId)'));
check('CTA Ver partidos de esta liga wires leagueFilterIds',
  APP.includes('ligas-see-matches') && APP.includes('leagueFilterIds.add(d1Id)'));
check('API route GET /api/v1/leagues/:id/table exists',
  INDEX.includes('leagueTableMatch') &&
    INDEX.includes('leagues\\/(\\d+)\\/table') &&
    INDEX.includes('findLeagueByApiId'));
check('getLeagueTable selects logo_url', DB.includes('t.logo_url AS logo_url') && DB.includes('logoUrl:'));
check('findLeagueByApiId is exported', DB.includes('export async function findLeagueByApiId'));

let tableSql = '';
const table = await getLeagueTable(
  {
    all: async (sql) => {
      tableSql = sql;
      return [
        {
          team_id: 10,
          team: 'PSG',
          logo_url: 'https://example.com/psg.png',
          won: 3,
          drawn: 0,
          lost: 0,
          gf: 8,
          ga: 1,
        },
      ];
    },
  },
  7,
  40
);
check('league table SQL includes logo_url', tableSql.includes('t.logo_url AS logo_url'));
check('league table returns logoUrl + points', table[0].logoUrl === 'https://example.com/psg.png' && table[0].points === 9);
check('league table limit 40 keeps row', table.length === 1);

const league = await findLeagueByApiId(
  {
    first: async (_sql, apiId) =>
      Number(apiId) === 140 ? { id: 1, api_id: 140, name: 'La Liga', country: 'Spain' } : null,
  },
  140
);
check('findLeagueByApiId resolves LaLiga api 140', league?.id === 1 && league?.api_id === 140);
check('findLeagueByApiId rejects bad id', (await findLeagueByApiId({ first: async () => ({}) }, 0)) == null);

let nextSql = '';
await getNextForTeam(
  {
    first: async (sql) => {
      nextSql = sql;
      return null;
    },
  },
  99
);
check('getNextForTeam prefers scheduled/live upcoming',
  nextSql.includes("status IN ('scheduled', 'live')") && nextSql.includes("m.match_date >= datetime('now')"));

console.log(failed ? `\n${failed} checks failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
