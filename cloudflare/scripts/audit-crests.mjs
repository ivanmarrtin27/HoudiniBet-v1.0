/**
 * Crest audit for top-5 leagues (independent of tip engine).
 * Usage:
 *   node scripts/audit-crests.mjs              # all top5
 *   node scripts/audit-crests.mjs 39           # Premier only
 *   node scripts/audit-crests.mjs 140 --json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOP5_CREST_ROSTERS,
  auditCrestsForLeague,
} from '../src/services/teamLogos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'reports', 'crests');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const leagueArg = args.find((a) => /^\d+$/.test(a));
const leagueIds = leagueArg
  ? [Number(leagueArg)]
  : [39, 140, 141, 135, 78, 61];

mkdirSync(outDir, { recursive: true });

const reports = [];
for (const id of leagueIds) {
  const report = auditCrestsForLeague(id);
  reports.push(report);
  const slug = (report.name || String(id)).toLowerCase().replace(/\s+/g, '-');
  const mdLines = [
    `# Crest audit — ${report.name || id} (api_id ${id})`,
    '',
    `Checked: ${new Date().toISOString()}`,
    '',
    '| Equipo | AF id | Escudo ref | Fuente | Estado | Problema | Acción |',
    '|--------|-------|------------|--------|--------|----------|--------|',
  ];
  for (const r of report.rows) {
    mdLines.push(
      `| ${r.team} | ${r.teamApiId ?? '—'} | ${r.referenceUrl || '—'} | ${r.referenceSource || '—'} | ${r.status} | ${r.problem || '—'} | ${r.action || '—'} |`
    );
  }
  const counts = report.rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  mdLines.push('', `## Resumen`, '', JSON.stringify(counts, null, 2));
  const mdPath = join(outDir, `${slug}.md`);
  writeFileSync(mdPath, mdLines.join('\n') + '\n', 'utf8');
  console.log(
    `${report.name || id}: ${report.rows.length} teams · ${JSON.stringify(counts)} → ${mdPath}`
  );
}

if (asJson) {
  const jsonPath = join(outDir, 'all.json');
  writeFileSync(jsonPath, JSON.stringify(reports, null, 2), 'utf8');
  console.log('JSON:', jsonPath);
}

const failed = reports.flatMap((r) =>
  r.rows.filter((x) => x.status === 'broken' || x.status === 'mismatch')
);
if (failed.length) {
  console.error(`\n${failed.length} crest issue(s) need attention:`);
  for (const f of failed.slice(0, 20)) {
    console.error(`  [${f.status}] ${f.team} (${f.leagueApiId}): ${f.problem}`);
  }
  process.exitCode = 1;
} else {
  console.log('\nNo broken/mismatch in static roster audit.');
}

void TOP5_CREST_ROSTERS;
