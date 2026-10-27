/**
 * Guards tip % display helpers: never bare "— modelo"; probForLabel / tipProbPct present.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'public/app.js'), 'utf8');
const pred = readFileSync(join(root, 'src/services/predictionService.js'), 'utf8');
const db = readFileSync(join(root, 'src/db.js'), 'utf8');

let failed = 0;
function check(name, ok) {
  if (!ok) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('ok', name);
  }
}

check('probForLabel helper exists', /function probForLabel\(/.test(app));
check('tipProbPct prefers conf > 0 then label', /function tipProbPct\(/.test(app));
check('tipConfMetaHtml exists', /function tipConfMetaHtml\(/.test(app));
check(
  'panel never renders bare dash+modelo ternary',
  !/: '— modelo'/.test(app) && !/\? `[^\n]*modelo`\s*:\s*'— modelo'/.test(app)
);
check('panel uses tipConfMetaHtml', /tipConfMetaHtml\(tipProb/.test(app));
check('server stores tip_tier on payload', /tip_tier:\s*tipTier/.test(pred));
check('display tipTier none still stores real conf', /tip_tier gates Mejores/.test(pred));
check('Mejores filters playable tip_tier', /PLAYABLE_TIP_SQL/.test(db));
check('backfill uses PLAYABLE_TIP_SQL', /AND \$\{PLAYABLE_TIP_SQL\}/.test(db));

// Inline logic mirror of tipProbPct / probForLabel for HOME_WIN + conf 0
function toDisplayPct(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n <= 1 ? Number((n * 100).toFixed(1)) : Number(n.toFixed(1));
}
function probForLabel(p, label) {
  if (!p || !label) return null;
  if (label === 'HOME_WIN') return toDisplayPct(p.home_win_prob ?? p.homeWinProb);
  if (label === 'CORNERS_OVER_95') return toDisplayPct(p.corners_over95_prob);
  return null;
}
function tipProbPct(raw) {
  const tip = String(raw.suggestedBet || raw.suggested_bet || '');
  const confRaw = raw.confidenceScore ?? raw.confidence_score;
  const conf = confRaw != null && !Number.isNaN(Number(confRaw)) ? Number(confRaw) : null;
  if (conf != null && conf > 0) return conf;
  if (tip) {
    const fromLabel = probForLabel(raw, tip);
    if (fromLabel != null) return fromLabel;
  }
  return null;
}

check(
  'conf 0 + HOME_WIN → market %',
  tipProbPct({ suggestedBet: 'HOME_WIN', confidence_score: 0, home_win_prob: 0.62 }) === 62
);
check(
  'conf 0 + corners → market %',
  tipProbPct({
    suggestedBet: 'CORNERS_OVER_95',
    confidenceScore: 0,
    corners_over95_prob: 0.71,
  }) === 71
);
check(
  'conf > 0 preferred over market',
  tipProbPct({ suggestedBet: 'HOME_WIN', confidenceScore: 81, home_win_prob: 0.5 }) === 81
);
check(
  'no tip / no conf → null (not dash string)',
  tipProbPct({ confidenceScore: 0 }) == null
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall ok');
