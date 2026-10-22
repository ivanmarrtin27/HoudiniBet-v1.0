/**
 * Smoke test of the market tabs (tiros a puerta / córners / tarjetas) of
 * public/app.js.
 *
 * They must render like the "Goles" tab: an Expected card plus one Market
 * Section per scope (partido / local / visitante) with "Más de X" and
 * "Menos de X" rows.
 *
 * The frontend is a plain script, so the pieces are extracted from the source
 * and evaluated here. That keeps the check on the real code (no copy) while
 * avoiding a DOM.
 *
 * Usage: node scripts/test-market-panels.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../public/app.js');
const FIXTURE = resolve(HERE, 'fixtures/market-ladders-23605.json');
const src = readFileSync(APP, 'utf8');

/**
 * Extracts a top level function declaration from the source.
 * Handles destructured parameters (the body brace is the one after the
 * closing parenthesis of the signature, not the destructuring pattern).
 */
function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`function ${name} not found`);
  const start = src.lastIndexOf('\n', idx) + 1;
  const paren = src.indexOf('(', idx);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paren; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = src.indexOf('{', i);
        break;
      }
    }
  }
  if (bodyStart < 0) throw new Error(`function ${name} has no body`);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} not closed`);
}

const pieces = [
  extractFunction('escapeHtml'),
  extractFunction('pct'),
  extractFunction('probBar'),
  extractFunction('marketSection'),
  extractFunction('expectedCardHtml'),
  extractFunction('ladderProbsMap'),
  extractFunction('marketLineLabel'),
  extractFunction('ladderProbRows'),
  extractFunction('marketAveragesHtml'),
  extractFunction('extrasPanel'),
];

const api = new Function(
  `${pieces.join('\n\n')}
   function crestHtml() { return '<span class="crest"></span>'; }
   return { ladderProbsMap, marketLineLabel, ladderProbRows, extrasPanel };`
)();

let failed = 0;
let passed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

/** Parses the "data-count-to" percentages of a rendered block. */
function percents(html) {
  return [...html.matchAll(/data-count-to="(-?\d+)"/g)].map((m) => Number(m[1]));
}

/** Parses the labels of a rendered block, in order. */
function labels(html) {
  return [...html.matchAll(/<div class="prob-row__label">([^<]*)<\/div>/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------- helpers

const map = api.ladderProbsMap([
  { line: 8.5, over: 0.67 },
  { line: 9.5, over: 0.5452 },
  { line: null, over: 0.5 },
  { line: 10.5, over: null },
]);
check('ladderProbsMap keeps valid lines', map.size === 2);
check('ladderProbsMap reads the over probability', map.get(8.5) === 0.67);
check('ladderProbsMap ignores broken rows', !map.has(10.5) && !map.has(null));

check('marketLineLabel uses es-ES decimals', api.marketLineLabel(8.5) === '8,5');
check('marketLineLabel keeps integers', api.marketLineLabel(3) === '3');

const rows = api.ladderProbRows([{ line: 8.5, over: 0.67 }], [8.5, 9.5]);
check('ladderProbRows emits both sides of a line', labels(rows).join('|') === 'Más de 8,5|Menos de 8,5');
check('ladderProbRows skips lines outside the ladder', !rows.includes('9,5'));
const sums = percents(rows);
check('ladderProbRows sums to 100', sums.reduce((a, b) => a + b, 0) === 100, sums.join(','));

// ---------------------------------------------------------------- panel

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const cornersHtml = api.extrasPanel({
  label: 'Córners esperados',
  unit: 'Córners',
  homeName: fixture.home,
  awayName: fixture.away,
  expected: fixture.expected.corners,
  ladders: {
    ...fixture.ladders.corners,
    degraded: true,
    samples: { home: 1, away: 2 },
  },
  recentAvgs: { home: 6.2, away: 4.1 },
  leagueAverage: 9.4,
  matchLines: [8.5, 9.5, 10.5],
  teamLines: [3.5, 4.5, 5.5, 6.5],
});

check('panel renders the expected card', cornersHtml.includes('ladder-expected'));
check('degraded panel shows sample-count warning', cornersHtml.includes('Estimación con pocas muestras · 1 local / 2 visitante'));
check('panel shows both team averages and league reference',
  cornersHtml.includes('Promedios recientes · Córners') &&
    cornersHtml.includes('6,2') && cornersHtml.includes('4,1') &&
    cornersHtml.includes('Media liga / equipo') && cornersHtml.includes('4,7'));
const noRecentStats = api.extrasPanel({ unit: 'Córners', ladders: null });
check('missing averages render as dashes rather than invalid numbers',
  (noRecentStats.match(/market-averages__value">—<\/strong>/g) || []).length === 3 &&
    !noRecentStats.includes('NaN'));
check(
  'panel renders one section per scope',
  (cornersHtml.match(/class="market-block"/g) || []).length === 3,
  `blocks=${(cornersHtml.match(/class="market-block"/g) || []).length}`
);
check('panel titles the match scope', cornersHtml.includes('Córners del partido'));
check('panel titles the home scope', cornersHtml.includes(`Córners de ${fixture.home}`));
check('panel titles the away scope', cornersHtml.includes(`Córners de ${fixture.away}`));
check(
  'panel renders the match lines',
  labels(cornersHtml).includes('Más de 8,5') && labels(cornersHtml).includes('Menos de 10,5')
);
check(
  'panel renders the team lines',
  labels(cornersHtml).includes('Más de 3,5') && labels(cornersHtml).includes('Menos de 6,5')
);
check(
  'panel rows pair up to 100',
  (() => {
    const ps = percents(cornersHtml);
    if (ps.length === 0 || ps.length % 2 !== 0) return false;
    for (let i = 0; i < ps.length; i += 2) if (ps[i] + ps[i + 1] !== 100) return false;
    return true;
  })(),
  percents(cornersHtml).join(',')
);

const cardsHtml = api.extrasPanel({
  label: 'Tarjetas (amarillas) esperadas',
  unit: 'Tarjetas',
  homeName: fixture.home,
  awayName: fixture.away,
  expected: fixture.expected.cards,
  ladders: fixture.ladders.cards,
  recentAvgs: { home: 1.2, away: 3.1 },
  leagueAverage: 4.4,
  matchLines: [3.5, 4.5],
  teamLines: [0.5, 1.5, 2.5],
});
check('cards panel has the three scopes', (cardsHtml.match(/class="market-block"/g) || []).length === 3);
check('cards panel shows the team lines', labels(cardsHtml).includes('Más de 0,5'));
check('cards panel hides the lines outside the ladder', !labels(cardsHtml).includes('Más de 5,5'));

const shotsHtml = api.extrasPanel({
  label: 'Tiros a puerta esperados',
  unit: 'Tiros a puerta',
  homeName: fixture.home,
  awayName: fixture.away,
  expected: fixture.expected.shotsOnTarget,
  ladders: fixture.ladders.shotsOnTarget,
  recentAvgs: { home: 4.4, away: 3.6 },
  leagueAverage: 9.2,
  matchLines: [7.5, 8.5, 9.5],
  teamLines: [2.5, 3.5, 4.5, 5.5],
});
check('shots panel has the three scopes', (shotsHtml.match(/class="market-block"/g) || []).length === 3);
check('shots panel shows the match lines', labels(shotsHtml).includes('Más de 7,5'));

// ---------------------------------------------------------------- fallbacks

const fallback = '<div class="market-block"><div class="muted">Sin ladder</div></div>';
check(
  'no ladder falls back',
  api.extrasPanel({ unit: 'Córners', ladders: null, fallbackHtml: fallback }).includes(fallback) &&
    api.extrasPanel({ unit: 'Córners', ladders: null, fallbackHtml: fallback }).includes('market-averages')
);
check(
  'empty ladder falls back',
  api.extrasPanel({ unit: 'Córners', ladders: { match: [], home: [], away: [] }, fallbackHtml: fallback }).includes(fallback)
);
check(
  'no ladder still renders average section',
  api.extrasPanel({ unit: 'Córners', ladders: undefined }).includes('Promedios recientes · Córners')
);
check(
  'a ladder without the wanted lines drops the section',
  !api.extrasPanel({
    unit: 'Córners',
    ladders: { match: [{ line: 3.5, over: 0.5 }], home: [], away: [] },
    matchLines: [9.5],
    teamLines: [3.5],
  }).includes('Córners del partido')
);

// ---------------------------------------------------------------- escaping

const xss = api.extrasPanel({
  unit: 'Córners',
  homeName: '<script>alert(1)</script>',
  awayName: 'Rennes',
  recentAvgs: { home: 5, away: 4 },
  leagueAverage: 9,
  ladders: { match: [{ line: 9.5, over: 0.5 }], home: [], away: [] },
  matchLines: [9.5],
  teamLines: [],
});
check('panel escapes the team names', !xss.includes('<script>'), xss.slice(0, 240));

// ---------------------------------------------------------------- always-visible tabs

check('all three extra tab buttons are unconditional', [
  "['tiros', 'Tiros a puerta']",
  "['corners', 'Córners']",
  "['tarjetas', 'Tarjetas']",
].every((tab) => src.includes(tab)) && !src.includes('hasShots ?') && !src.includes('hasCorners ?') && !src.includes('hasCards ?'));
check('all three extra panels are unconditional', [
  'data-mp-panel="tiros" role="tabpanel" hidden>${shotsPanel}</div>',
  'data-mp-panel="corners" role="tabpanel" hidden>${cornersPanel}</div>',
  'data-mp-panel="tarjetas" role="tabpanel" hidden>${cardsPanel}</div>',
].every((panel) => src.includes(panel)));
check('empty-market fallbacks explain missing data', [
  'Sin datos suficientes para calcular probabilidades de este mercado.',
].every((message) => src.includes(message)));

console.log(failed ? `\n${failed} check(s) failed` : `\n${passed}/${passed} checks passed`);
process.exit(failed ? 1 : 0);
