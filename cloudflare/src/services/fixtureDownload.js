/**
 * FixtureDownload public JSON feeds (no API key).
 * https://fixturedownload.com/feed/json/{slug}
 */

const FEEDS = [
  {
    slug: 'nations-league-2026',
    leagueApiId: 5,
    name: 'UEFA Nations League',
    country: 'World',
  },
  {
    slug: 'champions-league-2026',
    leagueApiId: 2,
    name: 'Champions League',
    country: 'World',
  },
  {
    slug: 'europa-league-2026',
    leagueApiId: 3,
    name: 'Europa League',
    country: 'World',
  },
  {
    slug: 'la-liga-2026',
    leagueApiId: 140,
    name: 'La Liga',
    country: 'Spain',
  },
  {
    slug: 'epl-2026',
    leagueApiId: 39,
    name: 'Premier League',
    country: 'England',
  },
  {
    slug: 'serie-a-2026',
    leagueApiId: 135,
    name: 'Serie A',
    country: 'Italy',
  },
  {
    slug: 'bundesliga-2026',
    leagueApiId: 78,
    name: 'Bundesliga',
    country: 'Germany',
  },
  {
    slug: 'ligue-1-2026',
    leagueApiId: 61,
    name: 'Ligue 1',
    country: 'France',
  },
];

/** Numeric api_id namespace for FixtureDownload matches (avoid clash with demo 91xxxx / API-Football). */
export const FD_MATCH_API_MIN = 820000000;

/** Sync + list window: today through today+WINDOW_DAYS (inclusive). */
export const WINDOW_DAYS = 14;

/** Finished results lookback for form / Poisson. */
export const HISTORY_DAYS = 60;

function stableHash(str) {
  let h = 2166136261;
  const s = String(str).toLowerCase().trim();
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function teamApiId(leagueApiId, teamName) {
  return 800000000 + (leagueApiId % 1000) * 100000 + (stableHash(teamName) % 100000);
}

export function matchApiId(leagueApiId, matchNumber) {
  return FD_MATCH_API_MIN + leagueApiId * 1000000 + Number(matchNumber);
}

function parseUtc(dateUtc) {
  if (!dateUtc) return null;
  const d = new Date(String(dateUtc).endsWith('Z') ? dateUtc : `${dateUtc}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toSqlDate(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dayBounds(fromOffset, toOffset) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + fromOffset);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  end.setUTCDate(end.getUTCDate() + toOffset);
  return { start, end };
}

export async function fetchFeed(slug) {
  const url = `https://fixturedownload.com/feed/json/${slug}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`FixtureDownload ${slug} ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function mapRow(row, feed) {
  const d = parseUtc(row.DateUtc);
  if (!d) return null;
  const homeGoals = row.HomeTeamScore != null ? Number(row.HomeTeamScore) : null;
  const awayGoals = row.AwayTeamScore != null ? Number(row.AwayTeamScore) : null;
  const finished = homeGoals != null && awayGoals != null && !Number.isNaN(homeGoals) && !Number.isNaN(awayGoals);
  return {
    leagueApiId: feed.leagueApiId,
    leagueName: feed.name,
    country: feed.country,
    matchNumber: Number(row.MatchNumber),
    matchDate: toSqlDate(d),
    status: finished ? 'finished' : 'scheduled',
    homeName: String(row.HomeTeam || '').trim(),
    awayName: String(row.AwayTeam || '').trim(),
    homeGoals: finished ? homeGoals : null,
    awayGoals: finished ? awayGoals : null,
    api_id: matchApiId(feed.leagueApiId, row.MatchNumber),
    _date: d,
  };
}

/**
 * @returns {Array} fixtures in date window (any status)
 */
export function filterWindow(rows, feed, fromOffset, toOffset) {
  const { start, end } = dayBounds(fromOffset, toOffset);
  const out = [];
  for (const row of rows) {
    const mapped = mapRow(row, feed);
    if (!mapped || mapped._date < start || mapped._date > end) continue;
    delete mapped._date;
    out.push(mapped);
  }
  return out;
}

export function listFeeds() {
  return FEEDS;
}

/**
 * Upcoming (0..WINDOW_DAYS) + finished history (-HISTORY_DAYS..-1).
 */
export async function fetchAllWindowFixtures() {
  const errors = [];
  const settled = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const rows = await fetchFeed(feed.slug);
        const upcoming = filterWindow(rows, feed, 0, WINDOW_DAYS);
        const history = filterWindow(rows, feed, -HISTORY_DAYS, -1).filter((m) => m.status === 'finished');
        return { upcoming, history };
      } catch (err) {
        errors.push({ slug: feed.slug, error: err.message });
        return { upcoming: [], history: [] };
      }
    })
  );

  const upcoming = settled.flatMap((s) => s.upcoming);
  const history = settled.flatMap((s) => s.history);
  // Dedupe by api_id (prefer finished if both)
  const byId = new Map();
  for (const fx of [...history, ...upcoming]) {
    const prev = byId.get(fx.api_id);
    if (!prev || (fx.status === 'finished' && prev.status !== 'finished')) {
      byId.set(fx.api_id, fx);
    }
  }
  return {
    fixtures: [...byId.values()],
    upcomingCount: upcoming.length,
    historyCount: history.length,
    errors,
  };
}

/** Partidos recientes para refresh live / cierre. Por defecto, solo hoy. */
export async function fetchTodayFixtures(fromOffset = 0, toOffset = 0) {
  const errors = [];
  const settled = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const rows = await fetchFeed(feed.slug);
        return filterWindow(rows, feed, fromOffset, toOffset);
      } catch (err) {
        errors.push({ slug: feed.slug, error: err.message });
        return [];
      }
    })
  );
  const byId = new Map();
  for (const fx of settled.flat()) {
    byId.set(fx.api_id, fx);
  }
  return { fixtures: [...byId.values()], errors };
}
