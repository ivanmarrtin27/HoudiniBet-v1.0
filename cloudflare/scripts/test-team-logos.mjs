/**
 * Crest resolution: FotMob overrides for broken AF media (e.g. RC Deportivo 1102).
 */
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  clubLogoUrl,
  resolveTeamLogoUrl,
} = await import(pathToFileURL(join(__dirname, '../src/services/teamLogos.js')).href);

let failed = 0;
function check(label, ok) {
  if (!ok) {
    failed += 1;
    console.error('FAIL:', label);
  } else {
    console.log('ok:', label);
  }
}

const FOTMOB_DEPOR =
  'https://images.fotmob.com/image_resources/logo/teamlogo/9783.png';
const BROKEN_AF =
  'https://media.api-sports.io/football/teams/1102.png';
const ALAVES_AF =
  'https://media.api-sports.io/football/teams/542.png';

check('RC Deportivo maps to FotMob crest', clubLogoUrl('RC Deportivo') === FOTMOB_DEPOR);
check(
  'Deportivo A Coruña alias maps to FotMob',
  clubLogoUrl('Deportivo A Coruña') === FOTMOB_DEPOR
);
check(
  'bare Deportivo maps to A Coruña FotMob (not Alavés)',
  clubLogoUrl('Deportivo') === FOTMOB_DEPOR
);
check(
  'Deportivo Alavés still uses AF id 542',
  clubLogoUrl('Deportivo Alavés') === ALAVES_AF
);
check(
  'resolve replaces broken AF 1102 with FotMob',
  resolveTeamLogoUrl('RC Deportivo', BROKEN_AF) === FOTMOB_DEPOR
);
check(
  'resolve keeps synced FotMob logo',
  resolveTeamLogoUrl('RC Deportivo', FOTMOB_DEPOR) === FOTMOB_DEPOR
);
check(
  'resolve keeps good AF logo for Alavés',
  resolveTeamLogoUrl('Deportivo Alavés', ALAVES_AF) === ALAVES_AF
);
check(
  'resolve without stored logo still returns Deportivo FotMob',
  resolveTeamLogoUrl('RC Deportivo', null) === FOTMOB_DEPOR
);

const FOTMOB_PSG =
  'https://images.fotmob.com/image_resources/logo/teamlogo/9847.png';
const FOTMOB_ELCHE =
  'https://images.fotmob.com/image_resources/logo/teamlogo/10268.png';
const AF_PSG = 'https://media.api-sports.io/football/teams/85.png';
const AF_ELCHE = 'https://media.api-sports.io/football/teams/3751.png';

check('PSG maps to FotMob crest', clubLogoUrl('Paris Saint Germain') === FOTMOB_PSG);
check('PSG alias maps to FotMob', clubLogoUrl('PSG') === FOTMOB_PSG);
check('paris sg alias maps to FotMob', clubLogoUrl('Paris SG') === FOTMOB_PSG);
check(
  'paris saint-germain hyphen maps to FotMob',
  clubLogoUrl('Paris Saint-Germain') === FOTMOB_PSG
);
check(
  'paris saint germain fc maps to FotMob',
  clubLogoUrl('Paris Saint Germain FC') === FOTMOB_PSG
);
check(
  'resolve replaces stored AF PSG with FotMob',
  resolveTeamLogoUrl('Paris Saint Germain', AF_PSG) === FOTMOB_PSG
);
check(
  'resolve forces FotMob even when D1 has AF 85',
  resolveTeamLogoUrl('PSG', AF_PSG) === FOTMOB_PSG
);
check('Elche maps to FotMob crest', clubLogoUrl('Elche') === FOTMOB_ELCHE);
check(
  'resolve replaces stored AF Elche with FotMob',
  resolveTeamLogoUrl('Elche CF', AF_ELCHE) === FOTMOB_ELCHE
);
check(
  'Paris FC still uses AF id 1113 (not PSG FotMob)',
  clubLogoUrl('Paris FC') === 'https://media.api-sports.io/football/teams/1113.png'
);
check(
  'Paris FC resolve does not inherit PSG FotMob',
  resolveTeamLogoUrl('Paris FC', 'https://media.api-sports.io/football/teams/1113.png') ===
    'https://media.api-sports.io/football/teams/1113.png'
);

const FOTMOB_LEV =
  'https://images.fotmob.com/image_resources/logo/teamlogo/8178.png';
const AF_LEV = 'https://media.api-sports.io/football/teams/168.png';
check('Bayer Leverkusen maps to FotMob crest', clubLogoUrl('Bayer Leverkusen') === FOTMOB_LEV);
check(
  'Bayer 04 Leverkusen alias maps to FotMob',
  clubLogoUrl('Bayer 04 Leverkusen') === FOTMOB_LEV
);
check('bare leverkusen maps to FotMob', clubLogoUrl('Leverkusen') === FOTMOB_LEV);
check(
  'resolve replaces stored AF Leverkusen with FotMob',
  resolveTeamLogoUrl('Bayer Leverkusen', AF_LEV) === FOTMOB_LEV
);
check(
  'Bayern Munich is not Leverkusen FotMob',
  clubLogoUrl('Bayern Munich') !== FOTMOB_LEV
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll team logo checks passed');
