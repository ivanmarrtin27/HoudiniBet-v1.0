/** Unit + mock-DB checks for allowlisted team search. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchTeams } from '../src/db.js';
import {
  leagueSearchPriority,
  rankTeamSearchRows,
  searchNameVariants,
  sqlLikePatternsForVariant,
  teamSearchScore,
} from '../src/services/teamSearch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = readFileSync(resolve(HERE, '../src/db.js'), 'utf8');

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

check('searchTeams uses ALLOWED_LEAGUE_SQL', DB.includes('searchTeams') && /searchTeams[\s\S]{0,800}ALLOWED_LEAGUE_SQL/.test(DB));
check('searchTeams uses alias variants + rank', DB.includes('searchNameVariants') && DB.includes('rankTeamSearchRows'));

const variants = searchNameVariants('Manchester City');
check(
  'Manchester City expands to Man City alias',
  variants.some((v) => /man city/i.test(v)) && variants.some((v) => /manchester city/i.test(v))
);

check('single-token patterns are word-prefix', sqlLikePatternsForVariant('man').includes('man%') && sqlLikePatternsForVariant('man').includes('% man%'));
check('multi-token pattern is contains', sqlLikePatternsForVariant('man city').includes('%man city%'));

check('Man City scores 100 vs Manchester City', teamSearchScore('Manchester City', 'Man City') === 100);
check('Germany does not score high for man', teamSearchScore('man', 'Germany') < 75);
check('domestic beats Champions for priority', leagueSearchPriority('Premier League') < leagueSearchPriority('Champions League'));

const ranked = rankTeamSearchRows(
  [
    {
      id: 2,
      name: 'Man City',
      logo_url: 'https://media.api-sports.io/football/teams/50.png',
      league_name: 'Champions League',
      api_id: 800200410,
    },
    {
      id: 1,
      name: 'Man City',
      logo_url: 'https://media.api-sports.io/football/teams/50.png',
      league_name: 'Premier League',
      api_id: 803900410,
    },
    {
      id: 9,
      name: 'Germany',
      logo_url: 'https://flagcdn.com/w80/de.png',
      league_name: 'UEFA Nations League',
      api_id: 1,
    },
    {
      id: 99,
      name: 'Manila Digger',
      logo_url: null,
      league_name: 'ASEAN Club Championship - A',
      api_id: 2,
    },
  ],
  'Manchester City'
);
check('dedupe keeps one Man City', ranked.filter((r) => /man city/i.test(r.name)).length === 1);
check('prefers Premier League Man City', ranked[0]?.league_name === 'Premier League');
check('drops Germany for Manchester City query', !ranked.some((r) => r.name === 'Germany'));

let capturedSql = '';
let capturedParams = [];
const mockDb = {
  async all(sql, ...params) {
    capturedSql = sql;
    capturedParams = params;
    return [
      {
        id: 93,
        name: 'Man City',
        logo_url: 'https://media.api-sports.io/football/teams/50.png',
        league_id: 3,
        api_id: 803900410,
        league_name: 'Premier League',
        league_api_id: 39,
      },
      {
        id: 2153,
        name: 'Man City',
        logo_url: 'https://media.api-sports.io/football/teams/50.png',
        league_id: 239,
        api_id: 800200410,
        league_name: 'Champions League',
        league_api_id: 2,
      },
      {
        id: 208,
        name: 'Manila Digger',
        logo_url: null,
        league_id: 104,
        api_id: 801247485,
        league_name: 'ASEAN Club Championship - A',
        league_api_id: 999,
      },
    ];
  },
};

const hits = await searchTeams(mockDb, 'Manchester City', 10);
check('SQL applies allowlist fragment', /Premier League|ALLOWED|l\.name IN/i.test(capturedSql) && capturedSql.includes('l.name IN'));
check('SQL params include man city pattern', capturedParams.some((p) => String(p).includes('man city')));
check('searchTeams returns single Man City (PL)', hits.length === 1 && hits[0].name === 'Man City' && hits[0].league_name === 'Premier League');

const elcheVariants = searchNameVariants('Elche');
check('Elche keeps useful variant', elcheVariants.some((v) => /elche/i.test(v)));
check('Leverkusen alias present', searchNameVariants('Leverkusen').some((v) => /bayer leverkusen/i.test(v)));

const lev = rankTeamSearchRows(
  [
    {
      id: 124,
      name: 'Bayer 04 Leverkusen',
      logo_url: 'https://images.fotmob.com/image_resources/logo/teamlogo/8178.png',
      league_name: 'Bundesliga',
    },
    {
      id: 309,
      name: 'Bayer Leverkusen',
      logo_url: 'https://images.fotmob.com/image_resources/logo/teamlogo/8178.png',
      league_name: 'Europa League',
    },
    {
      id: 2184,
      name: 'Leverkusen',
      logo_url: 'https://images.fotmob.com/image_resources/logo/teamlogo/8178.png',
      league_name: 'Europa League',
    },
  ],
  'Leverkusen'
);
check('FotMob crest dedupes Leverkusen rows', lev.length === 1 && lev[0].league_name === 'Bundesliga');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
