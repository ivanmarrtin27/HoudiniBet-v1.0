/**
 * National-team fixtures via FotMob public matches-by-date API (no key).
 * Only national Friendlies — UNL / UCL / UEL come from FixtureDownload.
 */

import { teamApiId, WINDOW_DAYS } from './fixtureDownload.js';
import { isAllowedCompetition } from './leagueAllowlist.js';

/** Avoid clash with FixtureDownload (820M+) and demo seed. */
export const FOTMOB_MATCH_API_BASE = 830000000;
export const FOTMOB_LEAGUE_API_BASE = 840000000;

const SKIP_NAME =
  /Club Friendlies|Women|U21|U20|U19|U17|U23|Youth|Olympic|\(W\)|Womens|Women's/i;

/** Already covered by FixtureDownload feeds. */
const SKIP_COVERED =
  /UEFA Nations League|Champions League|Europa League/i;

/** Only national Friendlies (no ASEAN / WCQ / continental junk). */
const KEEP_NAME = /^Friendlies$/i;

function ymdCompact(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toSqlDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOffsets(fromOffset, toOffset) {
  const out = [];
  for (let i = fromOffset; i <= toOffset; i += 1) {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(ymdCompact(d));
  }
  return out;
}

function isNationalLeague(league) {
  const name = String(league?.name || '');
  if (SKIP_NAME.test(name) || SKIP_COVERED.test(name)) return false;
  if (!KEEP_NAME.test(name) || /Club/i.test(name)) return false;
  return isAllowedCompetition(name, 'World');
}

function mapStatus(match) {
  const st = match?.status || {};
  if (st.cancelled) return null;
  if (st.finished) return 'finished';
  if (st.started) return 'live';
  return 'scheduled';
}

function leagueApiId(league) {
  const primary = Number(league.primaryId || league.parentLeagueId || league.id) || 0;
  return FOTMOB_LEAGUE_API_BASE + (primary % 1000000);
}

function leagueDisplayName(league) {
  const name = String(league.name || 'International');
  // Collapse group suffixes: "Friendlies", "Africa Cup … Qualification Grp. D" → keep as-is but tidy
  return name.replace(/\s+Grp\.\s*.+$/i, '').trim() || 'International';
}

function parseElapsedMinute(st) {
  if (!st) return null;
  // Prefer short ("33'") — long is often mm:ss within the half ("32:47") and must not be used raw.
  const short = st.liveTime?.short;
  if (short != null && String(short).trim() !== '') {
    const m = String(short).match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  const reason = String(st.reason?.short || st.reason?.long || '');
  if (/HT|Half/i.test(reason)) return 45;
  return null;
}

function mapMatch(league, match) {
  const status = mapStatus(match);
  if (!status) return null;
  const homeName = String(match.home?.name || '').trim();
  const awayName = String(match.away?.name || '').trim();
  if (!homeName || !awayName) return null;
  if (SKIP_NAME.test(homeName) || SKIP_NAME.test(awayName)) return null;

  const matchDate = toSqlDate(match.status?.utcTime || match.utcTime);
  if (!matchDate) return null;

  const finished = status === 'finished';
  const live = status === 'live';
  let rawHome = match.home?.score;
  let rawAway = match.away?.score;
  if ((rawHome == null || rawAway == null) && match.status?.scoreStr) {
    const parts = String(match.status.scoreStr).split(/\s*-\s*/);
    if (parts.length === 2) {
      rawHome = parts[0];
      rawAway = parts[1];
    }
  }
  const homeGoals =
    rawHome != null && rawHome !== '' && !Number.isNaN(Number(rawHome)) ? Number(rawHome) : null;
  const awayGoals =
    rawAway != null && rawAway !== '' && !Number.isNaN(Number(rawAway)) ? Number(rawAway) : null;
  if (finished && (homeGoals == null || awayGoals == null)) return null;

  const elapsed = live ? parseElapsedMinute(match.status || {}) : null;

  const lApi = leagueApiId(league);
  return {
    leagueApiId: lApi,
    leagueName: leagueDisplayName(league),
    country: 'World',
    matchDate,
    status,
    homeName,
    awayName,
    homeGoals: finished || live ? homeGoals : null,
    awayGoals: finished || live ? awayGoals : null,
    elapsed_minute: elapsed,
    api_id: FOTMOB_MATCH_API_BASE + Number(match.id),
    homeTeamApiId: teamApiId(lApi, homeName),
    awayTeamApiId: teamApiId(lApi, awayName),
  };
}

async function fetchDay(ymd) {
  const url = `https://www.fotmob.com/api/data/matches?date=${ymd}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'HoudiniBet/1.0',
    },
  });
  if (!res.ok) throw new Error(`FotMob ${ymd} ${res.status}`);
  return res.json();
}

/**
 * @returns {{ fixtures: object[], errors: object[] }}
 */
export async function fetchInternationalFixtures(fromOffset = 0, toOffset = WINDOW_DAYS) {
  const dates = dateOffsets(fromOffset, toOffset);
  const errors = [];
  const fixtures = [];
  const CONCURRENCY = 4;

  for (let i = 0; i < dates.length; i += CONCURRENCY) {
    const slice = dates.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (ymd) => {
        try {
          const data = await fetchDay(ymd);
          return { ymd, data, error: null };
        } catch (err) {
          return { ymd, data: null, error: err.message };
        }
      })
    );
    for (const item of settled) {
      if (item.error) {
        errors.push({ date: item.ymd, error: item.error });
        continue;
      }
      for (const league of item.data?.leagues || []) {
        if (!isNationalLeague(league)) continue;
        for (const match of league.matches || []) {
          const mapped = mapMatch(league, match);
          if (!mapped) continue;
          fixtures.push(mapped);
        }
      }
    }
  }

  const byId = new Map();
  for (const fx of fixtures) {
    byId.set(fx.api_id, fx);
  }
  return { fixtures: [...byId.values()], errors };
}

/**
 * League-agnostic view of a FotMob match (no league context needed).
 */
function mapAnyLiveMatch(match) {
  const status = mapStatus(match);
  if (status !== 'live' && status !== 'finished') return null;
  const homeName = String(match.home?.name || '').trim();
  const awayName = String(match.away?.name || '').trim();
  if (!homeName || !awayName) return null;
  const fmId = Number(match.id);
  if (!Number.isFinite(fmId) || fmId <= 0) return null;

  let rawHome = match.home?.score;
  let rawAway = match.away?.score;
  if ((rawHome == null || rawAway == null) && match.status?.scoreStr) {
    const parts = String(match.status.scoreStr).split(/\s*-\s*/);
    if (parts.length === 2) {
      rawHome = parts[0];
      rawAway = parts[1];
    }
  }
  const homeGoals =
    rawHome != null && rawHome !== '' && !Number.isNaN(Number(rawHome)) ? Number(rawHome) : null;
  const awayGoals =
    rawAway != null && rawAway !== '' && !Number.isNaN(Number(rawAway)) ? Number(rawAway) : null;

  return {
    fotmobId: fmId,
    homeName,
    awayName,
    status,
    homeGoals,
    awayGoals,
    elapsed: status === 'live' ? parseElapsedMinute(match.status || {}) : null,
  };
}

/**
 * Live/finished snapshots — UNL / UCL / UEL / Friendlies only (status updates on FD rows).
 * Accepts a small date range so yesterday can still be closed after midnight.
 *
 * With `includeAll` the `all` list also carries every live/finished match of the
 * day feed, whatever the league. That is how rows coming from other feeds
 * (FixtureDownload domestic leagues) get a FotMob match id, and with it the
 * live score, the minute and the incident timeline.
 */
export async function fetchFotmobLiveSnapshot(fromOffset = 0, toOffset = 0, { includeAll = false } = {}) {
  const dates = dateOffsets(fromOffset, toOffset);
  const errors = [];
  const fixtures = [];
  const all = [];
  for (const ymd of dates) {
    let data;
    try {
      data = await fetchDay(ymd);
    } catch (err) {
      errors.push({ date: ymd, error: err.message });
      continue;
    }
    for (const league of data?.leagues || []) {
      const lname = String(league?.name || '');
      if (includeAll) {
        for (const match of league.matches || []) {
          const any = mapAnyLiveMatch(match);
          if (any) all.push(any);
        }
      }
      if (SKIP_NAME.test(lname)) continue;
      if (!isAllowedCompetition(lname, 'World') && !SKIP_COVERED.test(lname)) continue;
      for (const match of league.matches || []) {
        const mapped = mapMatch(league, match);
        if (!mapped) continue;
        if (mapped.status !== 'live' && mapped.status !== 'finished') continue;
        fixtures.push(mapped);
      }
    }
  }
  const byId = new Map();
  for (const fx of fixtures) byId.set(fx.api_id, fx);
  const allById = new Map();
  for (const fx of all) allById.set(fx.fotmobId, fx);
  return { fixtures: [...byId.values()], all: [...allById.values()], errors };
}
