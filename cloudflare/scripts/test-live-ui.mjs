/**
 * Smoke test of the live HTML helpers of public/app.js.
 *
 * The frontend is a plain script, so the pieces are extracted from the source
 * and evaluated here. That keeps the check on the real code (no copy) while
 * avoiding a DOM.
 *
 * Usage: node scripts/test-live-ui.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../public/app.js');
const src = readFileSync(APP, 'utf8');

/** Extracts a top level function declaration from the source. */
function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`function ${name} not found`);
  const start = src.lastIndexOf('\n', idx) + 1;
  const brace = src.indexOf('{', idx);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} not closed`);
}

/** Extracts a top level const declaration (object literal). */
function extractConst(name) {
  const idx = src.indexOf(`const ${name} =`);
  if (idx < 0) throw new Error(`const ${name} not found`);
  const start = src.lastIndexOf('\n', idx) + 1;
  let depth = 0;
  for (let i = src.indexOf('{', idx); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`const ${name} not closed`);
}

const pieces = [
  extractFunction('escapeHtml'),
  extractConst('BET_LABELS'),
  extractFunction('lineFromSuffix'),
  extractFunction('labelBetFallback'),
  extractFunction('labelBet'),
  extractConst('LIVE_TIP_META'),
  extractFunction('liveTipChip'),
  extractFunction('liveProbsRow'),
  extractFunction('liveStripHtml'),
  extractFunction('livePanelHtml'),
];

const api = new Function(
  `${pieces.join('\n\n')}
   return { liveTipChip, liveProbsRow, liveStripHtml, livePanelHtml };`
)();

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

const live = {
  minute: 67,
  remaining: 28,
  homeGoals: 1,
  awayGoals: 1,
  homeWin: 0.2835,
  draw: 0.5279,
  awayWin: 0.1886,
  over25: 0.5532,
  under25: 0.4468,
  bttsYes: 1,
  bttsNo: 0,
  preMatch: { homeWin: 0.4698, draw: 0.2649, awayWin: 0.2653 },
  lambdaSource: 'stored',
  tip: { label: 'BTTS_YES', status: 'secured', prob: 1 },
  secondary: { label: 'HOME_WIN', status: 'alive', prob: 0.2835 },
};

const strip = api.liveStripHtml({ live });
check('strip renders the live class', strip.includes('class="live-strip"'));
check('strip shows the three probabilities', strip.includes('28%') && strip.includes('53%') && strip.includes('19%'));
check('strip shows the tip status', strip.includes('live-tip--secured'));
check('strip shows the tip probability', strip.includes('100%'));

const panel = api.livePanelHtml(live, 'Juventus', 'Rennes');
check('panel renders the live section', panel.includes('<section class="mp-live">'));
check('panel shows the minute', panel.includes("67&#39;") || panel.includes("67'"));
check('panel shows the score', panel.includes('1-1'));
check('panel shows the minutes left', panel.includes('28'));
check('panel shows the pre-match delta', panel.includes('-19') && panel.includes('+27'));
check('panel labels the tip with the team names', panel.includes('BET_LABELS') === false);
check('panel tip uses the market label', panel.includes('Ambos marcan') || panel.includes('BTTS'));
check('panel marks the tip as secured', panel.includes('live-tip--secured'));

const empty = api.livePanelHtml(null, 'A', 'B');
check('no panel without a live block', empty === '');

const chip = api.liveTipChip({ label: 'OVER_25', status: 'fading', prob: 0.05 });
check('fading tip uses its own class', chip.includes('live-tip--fading'));

const unknown = api.liveTipChip({ label: 'CORNERS_OVER_95', status: 'unknown', prob: null });
check('unknown tip has no probability', !unknown.includes('%'));

const xss = api.livePanelHtml(
  { ...live, tip: { label: 'HOME_WIN', status: 'alive', prob: 0.5 } },
  '<script>alert(1)</script>',
  'Rennes'
);
check('panel escapes the team names', !xss.includes('<script>'), xss.slice(0, 200));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
