/**
 * Optional smoke against live Worker admin daily usage.
 * Requires env SYNC_SECRET (+ CF secrets on Worker for real series).
 *
 *   SYNC_SECRET=… node scripts/smoke-usage-daily.mjs
 */
const base = process.env.API_BASE_URL || 'https://houdini-bet.ivanmarrtin2703.workers.dev';
const secret = process.env.SYNC_SECRET || '';

if (!secret) {
  console.error('Set SYNC_SECRET to smoke admin /usage/daily');
  process.exit(1);
}

const to = new Date().toISOString().slice(0, 10);
const fromDate = new Date(Date.parse(`${to}T00:00:00.000Z`) - 6 * 86400000);
const from = fromDate.toISOString().slice(0, 10);

const res = await fetch(`${base}/api/v1/admin/usage/daily?from=${from}&to=${to}`, {
  headers: { 'x-sync-secret': secret },
});
const data = await res.json().catch(() => ({}));
console.log(JSON.stringify({ status: res.status, configured: data.configured, error: data.error, days: data.days?.length, sample: data.days?.[0] }, null, 2));
if (!res.ok) process.exit(1);
