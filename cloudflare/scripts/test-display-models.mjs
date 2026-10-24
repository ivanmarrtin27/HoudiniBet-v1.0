/**
 * Regression tests for the low-sample count-market models used for display.
 * Run with: node scripts/test-display-models.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '../src/services/predictionService.js'), 'utf8');

function extractFunction(name) {
  const idx = SRC.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`function ${name} not found`);
  const start = SRC.lastIndexOf('\n', idx) + 1;
  const paren = SRC.indexOf('(', idx);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paren; i < SRC.length; i += 1) {
    if (SRC[i] === '(') parenDepth += 1;
    else if (SRC[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = SRC.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (let i = bodyStart; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} not closed`);
}

const poissonP = (k, lambda) => {
  if (k < 0 || !Number.isInteger(k) || lambda < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) p *= lambda / i;
  return p;
};

const weightedAvg = (rows, key) => {
  const values = rows.map((r) => r[key]).filter((v) => v != null && Number.isFinite(Number(v)));
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + Number(v), 0) / values.length;
};

const fns = [
  'avg',
  'hasCornerSamples',
  'hasCardSamples',
  'hasSotSamples',
  'countStatSamples',
  'shrinkStrength',
  'strength',
  'poissonOverLadder',
  'rangeLines',
  'cornersModel',
  'cardsModel',
  'shotsOnTargetModel',
  'packDisplayLadder',
].map(extractFunction);

const api = new Function(
  `const EXTRA_MARKET_MIN_N = 4;
   const poissonP = ${poissonP.toString()};
   const weightedAvg = ${weightedAvg.toString()};
   ${fns.join('\n\n')}
   return { shrinkStrength, cornersModel, cardsModel, shotsOnTargetModel, packDisplayLadder };`
)();

let failed = 0;
let passed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const homeOne = {
  corners_for: 7,
  corners_against: 6,
  yellows_for: 2,
  yellows_against: 3,
  shots_on_target_for: 6,
  shots_on_target_against: 5,
};
const awayOne = {
  corners_for: 5,
  corners_against: 8,
  yellows_for: 3,
  yellows_against: 2,
  shots_on_target_for: 4,
  shots_on_target_against: 7,
};
const league = {
  avgCornersFor: 5,
  avgCornersAgainst: 5,
  avgYellowsFor: 2.2,
  avgYellowsAgainst: 2.2,
  avgShotsOnTargetFor: 4.5,
  avgShotsOnTargetAgainst: 4.5,
};

check('shrinkStrength blends a one-sample ratio with league average',
  Math.abs(api.shrinkStrength(10, 5, 1) - 1.25) < 1e-10);
check('shrinkStrength returns neutral when sample or league data is missing',
  api.shrinkStrength(null, 5, 1) === 1 && api.shrinkStrength(10, 5, 0) === 1);

for (const [name, model, awayDefenseKey] of [
  ['corners', api.cornersModel, 'corners_against'],
  ['cards', api.cardsModel, 'yellows_against'],
  ['shots on target', api.shotsOnTargetModel, 'shots_on_target_against'],
]) {
  check(`${name}: strict model still rejects one sample`, model([homeOne], [awayOne], league) === null);
  const degraded = model([homeOne], [awayOne], league, { degraded: true });
  check(`${name}: display fallback returns a model`, degraded != null);
  check(`${name}: low-sample model is marked degraded`, degraded?.degraded === true);
  check(`${name}: sample counts are exposed`, degraded?.samples?.home === 1 && degraded?.samples?.away === 1);
  check(`${name}: emits non-empty probability ladders`,
    degraded?.ladderHome?.length > 0 && degraded?.ladderAway?.length > 0 && degraded?.ladderMatch?.length > 0);
  check(`${name}: lambdas are finite and positive`,
    Number.isFinite(degraded?.lambdaHome) && degraded.lambdaHome > 0 &&
      Number.isFinite(degraded?.lambdaAway) && degraded.lambdaAway > 0);

  const noAway = { ...awayOne, [awayDefenseKey]: null };
  const neutralDefense = model([homeOne], [noAway], league, { degraded: true });
  check(`${name}: missing defense stats use neutral league strength`,
    neutralDefense != null && Number.isFinite(neutralDefense.lambdaMatch));

  const oneSided = model([homeOne], [], league, { degraded: true });
  check(`${name}: display model works with zero samples on one side`,
    oneSided != null &&
      oneSided.degraded === true &&
      oneSided.samples?.home === 1 &&
      oneSided.samples?.away === 0 &&
      Number.isFinite(oneSided.lambdaMatch) &&
      oneSided.lambdaMatch > 0);

  const leagueOnly = model([], [], league, { degraded: true });
  check(`${name}: display model falls back to league when both sides empty`,
    leagueOnly != null &&
      leagueOnly.degraded === true &&
      leagueOnly.samples?.home === 0 &&
      leagueOnly.samples?.away === 0 &&
      Number.isFinite(leagueOnly.lambdaMatch) &&
      leagueOnly.lambdaMatch > 0);

  const enoughHome = Array.from({ length: 4 }, () => ({ ...homeOne }));
  const enoughAway = Array.from({ length: 4 }, () => ({ ...awayOne }));
  const strict = model(enoughHome, enoughAway, league);
  check(`${name}: strict model still works at four samples`, strict != null && strict.degraded !== true);
  check(`${name}: strict display result carries no degraded marker`, strict?.samples == null);

  const packed = api.packDisplayLadder(degraded);
  check(`${name}: packer forwards degraded marker and sample counts`,
    packed?.degraded === true && packed.samples?.home === 1 && packed.samples?.away === 1);
  check(`${name}: packer forwards all three ladder scopes`,
    packed?.home === degraded.ladderHome && packed?.away === degraded.ladderAway &&
      packed?.match === degraded.ladderMatch);
  check(`${name}: strict pack omits degraded metadata`,
    api.packDisplayLadder(strict)?.degraded !== true && api.packDisplayLadder(strict)?.samples == null);
}

check('bundle computes strict models separately from degraded display models',
  /const corners = cornersModel\(homeStats, awayStats, league\);/.test(SRC) &&
    /const cards = cardsModel\(homeStats, awayStats, league\);/.test(SRC) &&
    /const shotsOnTarget = shotsOnTargetModel\(homeStats, awayStats, league\);/.test(SRC) &&
    /cornersDisplay\s*=\s*corners\s*\|\|\s*cornersModel\([\s\S]*?degraded:\s*true/.test(SRC) &&
    /cardsDisplay\s*=\s*cards\s*\|\|\s*cardsModel\([\s\S]*?degraded:\s*true/.test(SRC) &&
    /shotsOnTargetDisplay\s*=\s*shotsOnTarget\s*\|\|\s*shotsOnTargetModel\([\s\S]*?degraded:\s*true/.test(SRC));
check('tip candidates and stored probabilities still use strict models',
  SRC.includes('cornerCandidatesFromModel(corners)') &&
    SRC.includes('cardCandidatesFromModel(cards)') &&
    SRC.includes('sotCandidatesFromModel(shotsOnTarget)') &&
    SRC.includes('corners?.cornersOver') &&
    SRC.includes('cards?.cardsOver35') &&
    SRC.includes('shotsOnTarget?.sotOver85'));
check('display ladders are packed from degraded-capable models',
  SRC.includes('corners: packDisplayLadder(cornersDisplay)') &&
    SRC.includes('cards: packDisplayLadder(cardsDisplay)') &&
    SRC.includes('shotsOnTarget: packDisplayLadder(shotsOnTargetDisplay)'));

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
