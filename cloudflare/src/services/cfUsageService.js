/**
 * Cloudflare GraphQL Analytics — Worker invocations + optional Web Analytics visits.
 * Needs CF_ACCOUNT_ID + CF_API_TOKEN (Account Analytics Read).
 * Visits also need CF_WEB_ANALYTICS_SITE_TAG.
 */

const GQL = 'https://api.cloudflare.com/client/v4/graphql';
const MAX_DAILY_RANGE_DAYS = 90;

export function todayUtcWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function usageConfigured(env) {
  return Boolean(String(env?.CF_ACCOUNT_ID || '').trim() && String(env?.CF_API_TOKEN || '').trim());
}

export function visitsConfigured(env) {
  return Boolean(usageConfigured(env) && String(env?.CF_WEB_ANALYTICS_SITE_TAG || '').trim());
}

/** Which CF analytics secrets are empty (names only — never values). */
export function missingUsageSecrets(env) {
  const missing = [];
  if (!String(env?.CF_ACCOUNT_ID || '').trim()) missing.push('CF_ACCOUNT_ID');
  if (!String(env?.CF_API_TOKEN || '').trim()) missing.push('CF_API_TOKEN');
  return missing;
}

export function missingVisitsSecrets(env) {
  const missing = missingUsageSecrets(env);
  if (!String(env?.CF_WEB_ANALYTICS_SITE_TAG || '').trim()) {
    missing.push('CF_WEB_ANALYTICS_SITE_TAG');
  }
  return missing;
}

function accountCreds(env) {
  const accountId = String(env?.CF_ACCOUNT_ID || '').trim();
  const token = String(env?.CF_API_TOKEN || '').trim();
  const scriptName = String(env?.CF_WORKER_SCRIPT_NAME || 'houdini-bet').trim() || 'houdini-bet';
  return { accountId, token, scriptName };
}

function dayIso(d) {
  return d.toISOString().slice(0, 10);
}

function parseDay(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

/** Inclusive UTC day range; default last `defaultDays` ending today. Max MAX_DAILY_RANGE_DAYS. */
export function resolveUtcDayRange({ from, to, defaultDays = 7, now = new Date() } = {}) {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let end = to ? parseDay(to) : todayStart;
  let start = from ? parseDay(from) : null;
  if (!end) end = todayStart;
  if (!start) {
    start = new Date(end.getTime() - (Math.max(1, defaultDays) - 1) * 24 * 60 * 60 * 1000);
  }
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const spanDays = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
  if (spanDays > MAX_DAILY_RANGE_DAYS) {
    start = new Date(end.getTime() - (MAX_DAILY_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  }
  return {
    from: dayIso(start),
    to: dayIso(end),
    startIso: start.toISOString(),
    endIsoExclusive: new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function fillDays(fromDay, toDay, byDay) {
  const out = [];
  let cur = parseDay(fromDay);
  const end = parseDay(toDay);
  if (!cur || !end) return out;
  while (cur <= end) {
    const key = dayIso(cur);
    const row = byDay.get(key) || { requests: 0, errors: 0 };
    out.push({ day: key, requests: row.requests, errors: row.errors });
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

async function gqlFetch(env, query, variables, { fetchImpl = fetch } = {}) {
  const { accountId, token } = accountCreds(env);
  if (!accountId || !token) {
    return { ok: false, configured: false };
  }
  try {
    const res = await fetchImpl(GQL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, configured: true, error: `CF GraphQL HTTP ${res.status}` };
    }
    if (data?.errors?.length) {
      return {
        ok: false,
        configured: true,
        error: String(data.errors[0]?.message || 'GraphQL error'),
      };
    }
    return { ok: true, configured: true, data };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err?.message || 'Error al consultar Analytics',
    };
  }
}

/**
 * @returns {{ configured: boolean, requests?: number, errors?: number, scriptName?: string, day?: string, error?: string }}
 */
export async function fetchWorkerUsageToday(env, { fetchImpl = fetch } = {}) {
  const { accountId, token, scriptName } = accountCreds(env);
  if (!accountId || !token) {
    return { configured: false, missing: missingUsageSecrets(env) };
  }

  const { start, end } = todayUtcWindow();
  const query = `
    query WorkerUsage($accountTag: String!, $datetimeStart: String!, $datetimeEnd: String!, $scriptName: String!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 1
            filter: {
              datetime_geq: $datetimeStart
              datetime_lt: $datetimeEnd
              scriptName: $scriptName
            }
          ) {
            sum {
              requests
              errors
            }
          }
        }
      }
    }
  `;

  const result = await gqlFetch(
    env,
    query,
    {
      accountTag: accountId,
      datetimeStart: start,
      datetimeEnd: end,
      scriptName,
    },
    { fetchImpl }
  );

  if (!result.configured) return { configured: false };
  if (!result.ok) {
    return {
      configured: true,
      scriptName,
      day: start.slice(0, 10),
      error: result.error,
    };
  }
  const rows = result.data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
  const sum = rows[0]?.sum || {};
  return {
    configured: true,
    scriptName,
    day: start.slice(0, 10),
    requests: Number(sum.requests) || 0,
    errors: Number(sum.errors) || 0,
  };
}

/**
 * Daily Worker series (UTC days inclusive).
 */
export async function fetchWorkerUsageDaily(env, { from, to, fetchImpl = fetch } = {}) {
  const { accountId, token, scriptName } = accountCreds(env);
  if (!accountId || !token) {
    return { configured: false, missing: missingUsageSecrets(env) };
  }

  const range = resolveUtcDayRange({ from, to, defaultDays: 7 });
  // Prefer Groups + datetime window (reliable daily buckets). Fallback to date filter.
  const queryGroups = `
    query WorkerUsageDailyGroups(
      $accountTag: String!
      $datetimeStart: String!
      $datetimeEnd: String!
      $scriptName: String!
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptiveGroups(
            limit: 100
            filter: {
              datetime_geq: $datetimeStart
              datetime_lt: $datetimeEnd
              scriptName: $scriptName
            }
            orderBy: [date_ASC]
          ) {
            dimensions {
              date
            }
            sum {
              requests
              errors
            }
          }
        }
      }
    }
  `;

  let result = await gqlFetch(
    env,
    queryGroups,
    {
      accountTag: accountId,
      datetimeStart: range.startIso,
      datetimeEnd: range.endIsoExclusive,
      scriptName,
    },
    { fetchImpl }
  );

  let rows = result.ok
    ? result.data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptiveGroups || []
    : [];

  if (!result.ok || !Array.isArray(rows)) {
    const queryLegacy = `
      query WorkerUsageDaily(
        $accountTag: String!
        $dateStart: Date!
        $dateEnd: Date!
        $scriptName: String!
      ) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            workersInvocationsAdaptive(
              limit: 100
              filter: {
                date_geq: $dateStart
                date_leq: $dateEnd
                scriptName: $scriptName
              }
              orderBy: [date_ASC]
            ) {
              dimensions {
                date
              }
              sum {
                requests
                errors
              }
            }
          }
        }
      }
    `;
    result = await gqlFetch(
      env,
      queryLegacy,
      {
        accountTag: accountId,
        dateStart: range.from,
        dateEnd: range.to,
        scriptName,
      },
      { fetchImpl }
    );
    rows = result.ok
      ? result.data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || []
      : [];
  }

  if (!result.configured) return { configured: false };
  if (!result.ok) {
    return {
      configured: true,
      scriptName,
      from: range.from,
      to: range.to,
      days: fillDays(range.from, range.to, new Map()),
      error: result.error,
    };
  }
  const byDay = new Map();
  for (const row of rows) {
    const day = String(row?.dimensions?.date || '').slice(0, 10);
    if (!day) continue;
    const prev = byDay.get(day) || { requests: 0, errors: 0 };
    prev.requests += Number(row?.sum?.requests) || 0;
    prev.errors += Number(row?.sum?.errors) || 0;
    byDay.set(day, prev);
  }

  return {
    configured: true,
    scriptName,
    from: range.from,
    to: range.to,
    days: fillDays(range.from, range.to, byDay),
  };
}

/**
 * Web Analytics visits for one UTC day (default today).
 */
export async function fetchWebAnalyticsVisits(env, { day, fetchImpl = fetch } = {}) {
  const { accountId, token } = accountCreds(env);
  const siteTag = String(env?.CF_WEB_ANALYTICS_SITE_TAG || '').trim();
  if (!accountId || !token) {
    return {
      configured: false,
      reason: 'missing_account',
      missing: missingVisitsSecrets(env),
    };
  }
  if (!siteTag) {
    return {
      configured: false,
      reason: 'missing_site_tag',
      missing: missingVisitsSecrets(env),
    };
  }

  const target = day ? parseDay(day) : parseDay(todayUtcWindow().start.slice(0, 10));
  const dayKey = dayIso(target || new Date());
  const datetimeStart = `${dayKey}T00:00:00Z`;
  const datetimeEnd = new Date(Date.parse(datetimeStart) + 24 * 60 * 60 * 1000).toISOString();

  const query = `
    query WebAnalyticsVisits(
      $accountTag: String!
      $siteTag: String!
      $datetimeStart: Time!
      $datetimeEnd: Time!
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          rumPageloadEventsAdaptiveGroups(
            limit: 1
            filter: {
              siteTag: $siteTag
              datetime_geq: $datetimeStart
              datetime_lt: $datetimeEnd
            }
          ) {
            count
            sum {
              visits
            }
          }
        }
      }
    }
  `;

  const result = await gqlFetch(
    env,
    query,
    {
      accountTag: accountId,
      siteTag,
      datetimeStart,
      datetimeEnd,
    },
    { fetchImpl }
  );

  if (!result.configured) return { configured: false };
  if (!result.ok) {
    return {
      configured: true,
      day: dayKey,
      siteTag,
      error: result.error,
    };
  }

  const rows = result.data?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups || [];
  const row = rows[0] || {};
  return {
    configured: true,
    day: dayKey,
    siteTag,
    pageViews: Number(row.count) || 0,
    visits: Number(row?.sum?.visits) || 0,
  };
}
