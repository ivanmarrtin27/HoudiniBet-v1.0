/**
 * Backfills predictions.home_xg / predictions.away_xg.
 *
 * The live projection reuses the pre-match strength, so it needs the expected
 * goals of every prediction. Rows written before the columns existed are
 * recovered from their stored probabilities (same inference the runtime uses
 * as a fallback, so the numbers do not change when the columns are filled).
 *
 * Usage: node scripts/backfill-xg.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferLambdas } from '../src/services/liveModel.js';

const DB = 'houdini-bet-db';
const BATCH = 40;
const HERE = dirname(fileURLToPath(import.meta.url));
const WRANGLER = resolve(HERE, '../node_modules/wrangler/bin/wrangler.js');

function wrangler(args) {
  if (existsSync(WRANGLER)) {
    return execFileSync(process.execPath, [WRANGLER, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const cmd = `npx wrangler ${args.map((a) => `"${a}"`).join(' ')}`;
  return execFileSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });
}

/** SELECT via --command: only this mode returns the rows. */
function queryRows(sql) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', sql]);
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json[0]?.results || [];
}

/** Write via --file: batched statements, one round trip. */
function execSql(sql) {
  const file = join(
    tmpdir(),
    `houdini-backfill-xg-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`
  );
  writeFileSync(file, sql, 'utf8');
  try {
    const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--file', file]);
    const json = JSON.parse(out.slice(out.indexOf('[')));
    if (!json[0]?.success) throw new Error(`wrangler failed: ${out.slice(0, 400)}`);
  } finally {
    try {
      unlinkSync(file);
    } catch (_) {
      /* ignore */
    }
  }
}

const rows = queryRows(
  `SELECT match_id, home_win_prob, draw_prob, away_win_prob, over25_prob, btts_yes_prob
     FROM predictions
    WHERE home_xg IS NULL OR away_xg IS NULL`
);
console.log(`predictions without xG: ${rows.length}`);

const updates = [];
let skipped = 0;
for (const r of rows) {
  const lam = inferLambdas(r);
  if (!lam) {
    skipped += 1;
    continue;
  }
  updates.push({
    match_id: Number(r.match_id),
    home_xg: lam.homeXg,
    away_xg: lam.awayXg,
  });
}
console.log(`recovered: ${updates.length} · skipped: ${skipped}`);

let written = 0;
for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  const sql = slice
    .map(
      (u) =>
        `UPDATE predictions SET home_xg = ${u.home_xg}, away_xg = ${u.away_xg} WHERE match_id = ${u.match_id};`
    )
    .join('\n');
  execSql(sql);
  written += slice.length;
  console.log(`written ${written}/${updates.length}`);
}

const after = queryRows(
  `SELECT COUNT(*) AS total, SUM(CASE WHEN home_xg IS NOT NULL THEN 1 ELSE 0 END) AS with_xg
     FROM predictions`
);
console.log('state:', JSON.stringify(after[0] || {}));
