import { resolveTeamLogoUrl } from './services/teamLogos.js';
import {
  resolveTipOdds,
  STAT_ODDS_BANDS,
  oddsBandFromValue,
  pickMarketForOddsBand,
  pickLegForCombo,
} from './services/oddsBands.js';
import { buildCombos, comboOptsForBand } from './services/combos.js';
import { ALLOWED_LEAGUE_SQL } from './services/leagueAllowlist.js';
import { computeStakeResults, computeStakeResultsBy } from './services/roi.js';

/** @param {D1Database} db */
export function createDb(db) {
  return {
    raw: db,
    async all(sql, ...params) {
      const { results } = await db.prepare(sql).bind(...params).all();
      return results || [];
    },
    async first(sql, ...params) {
      return db.prepare(sql).bind(...params).first();
    },
    async run(sql, ...params) {
      return db.prepare(sql).bind(...params).run();
    },
    /** One subrequest for many statements (D1 batch). */
    async batch(items) {
      if (!items.length) return [];
      const stmts = items.map(({ sql, params = [] }) => db.prepare(sql).bind(...params));
      return db.batch(stmts);
    },
  };
}

const MATCH_SELECT = `
  SELECT m.*,
    l.name AS league_name,
    l.country AS league_country,
    l.api_id AS league_api_id,
    ht.name AS home_name, ht.logo_url AS home_logo, ht.id AS home_team_id,
    at.name AS away_name, at.logo_url AS away_logo, at.id AS away_team_id
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  JOIN teams ht ON ht.id = m.home_team_id
  JOIN teams at ON at.id = m.away_team_id
`;

function parseMatchEvents(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapMatch(row) {
  if (!row) return null;
  const homeName = row.home_name;
  const awayName = row.away_name;
  return {
    id: row.id,
    leagueId: row.league_id,
    leagueApiId: row.league_api_id != null ? Number(row.league_api_id) : null,
    leagueName: row.league_name,
    leagueCountry: row.league_country || null,
    matchDate: row.match_date,
    status: row.status,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    elapsedMinute: row.elapsed_minute != null ? Number(row.elapsed_minute) : null,
    apiId: row.api_id,
    afFixtureId: row.af_fixture_id != null ? Number(row.af_fixture_id) : null,
    fotmobMatchId: row.fotmob_match_id != null ? Number(row.fotmob_match_id) : null,
    events: parseMatchEvents(row.events_json),
    homeTeam: {
      id: row.home_team_id,
      name: homeName,
      logo: resolveTeamLogoUrl(homeName, row.home_logo),
    },
    awayTeam: {
      id: row.away_team_id,
      name: awayName,
      logo: resolveTeamLogoUrl(awayName, row.away_logo),
    },
  };
}

/** Exclude inventados del seed (scheduled demo api_ids). */
const EXCLUDE_DEMO_SCHEDULED = `
  AND NOT (
    status = 'scheduled'
    AND (
      (api_id >= 910100 AND api_id < 920000)
      OR (api_id >= 920000 AND api_id < 920100)
    )
  )`;

const EXCLUDE_DEMO_SCHEDULED_M = `
  AND NOT (
    m.status = 'scheduled'
    AND (
      (m.api_id >= 910100 AND m.api_id < 920000)
      OR (m.api_id >= 920000 AND m.api_id < 920100)
    )
  )`;

export async function getToday(db, leagueId = null) {
  return getUpcoming(db, 0, leagueId);
}

/** Partidos from today through today+days (inclusive). Default 14. */
export async function getUpcoming(db, days = 14, leagueId = null) {
  const endModifier = `+${Number(days)} days`;
  let sql = `${MATCH_SELECT}
    WHERE date(m.match_date) >= date('now')
      AND date(m.match_date) <= date('now', ?)
      AND m.status IN ('scheduled', 'live')
      ${EXCLUDE_DEMO_SCHEDULED_M}
      ${ALLOWED_LEAGUE_SQL}`;
  const params = [endModifier];
  if (leagueId) {
    sql += ' AND m.league_id = ?';
    params.push(leagueId);
  }
  sql += ' ORDER BY m.match_date ASC';
  const rows = await db.all(sql, ...params);
  return rows.map(mapMatch);
}

/** Partidos de un día concreto (YYYY-MM-DD) — todos los estados (browse Oddster). */
export async function getByDate(db, dateYmd, leagueId = null) {
  let sql = `${MATCH_SELECT}
    WHERE date(m.match_date) = date(?)
      AND m.status IN ('scheduled', 'live', 'finished')
      ${EXCLUDE_DEMO_SCHEDULED_M}
      ${ALLOWED_LEAGUE_SQL}`;
  const params = [dateYmd];
  if (leagueId) {
    sql += ' AND m.league_id = ?';
    params.push(leagueId);
  }
  sql += ' ORDER BY m.match_date ASC';
  const rows = await db.all(sql, ...params);
  return rows.map(mapMatch);
}

export async function getScheduledIdsOnDate(db, dateYmd) {
  const rows = await db.all(
    `SELECT m.id FROM matches m
     JOIN leagues l ON l.id = m.league_id
     WHERE date(m.match_date) = date(?)
       AND m.status IN ('scheduled', 'live')
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC`,
    dateYmd
  );
  return rows.map((r) => r.id);
}

/** Current primary + secondary tip counts for scheduled matches on one day. */
export async function getDailyTipDiversityContext(db, dateYmd, excludeMatchId = null) {
  if (!dateYmd) {
    return { fixtureCount: 0, maxPerLabel: 1, counts: {}, secondaryCounts: {} };
  }
  const rows = await db.all(
    `SELECT m.id, p.suggested_bet, p.secondary_bet
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     LEFT JOIN predictions p ON p.match_id = m.id
     WHERE date(m.match_date) = date(?)
       AND m.status = 'scheduled'
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC`,
    dateYmd
  );
  const counts = {};
  const secondaryCounts = {};
  for (const row of rows) {
    if (Number(row.id) === Number(excludeMatchId)) continue;
    if (row.suggested_bet) {
      const label = String(row.suggested_bet);
      counts[label] = (counts[label] || 0) + 1;
    }
    if (row.secondary_bet) {
      const sec = String(row.secondary_bet);
      secondaryCounts[sec] = (secondaryCounts[sec] || 0) + 1;
    }
  }
  const fixtureCount = rows.length;
  return {
    fixtureCount,
    // Cap same-label tips per day (playable diversity).
    maxPerLabel: Math.min(2, Math.max(1, Math.floor(fixtureCount * 0.4) || 1)),
    counts,
    secondaryCounts,
  };
}

/** Scheduled predictions in the upcoming window, grouped by date in the service. */
export async function getScheduledTipRows(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  return db.all(
    `SELECT m.id, date(m.match_date) AS match_day,
            p.suggested_bet, p.confidence_score
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     LEFT JOIN predictions p ON p.match_id = m.id
     WHERE date(m.match_date) >= date('now')
       AND date(m.match_date) <= date('now', ?)
       AND m.status = 'scheduled'
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY date(m.match_date) ASC, p.confidence_score ASC, m.id ASC`,
    endModifier
  );
}

export async function findMatchById(db, id) {
  const row = await db.first(`${MATCH_SELECT} WHERE m.id = ?`, id);
  return mapMatch(row);
}

export async function getScheduledTodayIds(db) {
  return getScheduledUpcomingIds(db, 14);
}

export async function getScheduledUpcomingIds(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const rows = await db.all(
    `SELECT m.id FROM matches m
     JOIN leagues l ON l.id = m.league_id
     WHERE date(m.match_date) >= date('now')
       AND date(m.match_date) <= date('now', ?)
       AND m.status IN ('scheduled', 'live')
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC`,
    endModifier
  );
  return rows.map((r) => r.id);
}

export async function getNextForTeam(db, teamId) {
  const row = await db.first(
    `${MATCH_SELECT}
     WHERE (m.home_team_id = ? OR m.away_team_id = ?)
       AND m.status IN ('scheduled', 'live')
       AND m.match_date >= datetime('now')
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC
     LIMIT 1`,
    teamId,
    teamId
  );
  return mapMatch(row);
}

export async function listLeagues(db) {
  return db.all(
    `SELECT * FROM leagues l
     WHERE 1=1 ${ALLOWED_LEAGUE_SQL}
     ORDER BY name`
  );
}

export async function findLeagueByApiId(db, apiId) {
  const aid = Number(apiId);
  if (!Number.isFinite(aid) || aid <= 0) return null;
  return db.first(
    `SELECT * FROM leagues l
     WHERE l.api_id = ? ${ALLOWED_LEAGUE_SQL}
     LIMIT 1`,
    aid
  );
}

export async function searchTeams(db, q, limit = 15) {
  return db.all(
    `SELECT t.*, l.name AS league_name
     FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.name LIKE ?
     ORDER BY t.name LIMIT ?`,
    `%${q}%`,
    limit
  );
}

export async function findTeamById(db, id) {
  return db.first(
    `SELECT t.*, l.name AS league_name
     FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ?`,
    id
  );
}

export async function lastNForTeam(db, teamId, n = 5) {
  return db.all(
    `SELECT * FROM team_stats WHERE team_id = ? ORDER BY match_date DESC LIMIT ?`,
    teamId,
    n
  );
}

/** Last N team_stats strictly before kickoff (no lookahead). `beforeDate` = match_date string. */
export async function lastNForTeamAsOf(db, teamId, n = 10, beforeDate) {
  const before = String(beforeDate || '').slice(0, 19);
  if (!before) return lastNForTeam(db, teamId, n);
  const lim = Math.max(1, Math.min(30, Number(n) || 10));
  return db.all(
    `SELECT * FROM team_stats
     WHERE team_id = ?
       AND datetime(match_date) < datetime(?)
     ORDER BY match_date DESC
     LIMIT ?`,
    teamId,
    before,
    lim
  );
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** League avgs with proxy flags when SQL had no samples (hardcoded fallbacks). */
function mapLeagueAvgs(r) {
  const avgHomeScored = numOrNull(r?.avg_home_scored);
  const avgAwayScored = numOrNull(r?.avg_away_scored);
  const avgScored = numOrNull(r?.avg_scored);
  const avgConceded = numOrNull(r?.avg_conceded);
  const avgCornersFor = numOrNull(r?.avg_corners_for);
  const avgCornersAgainst = numOrNull(r?.avg_corners_against);
  const avgYellowsFor = numOrNull(r?.avg_yellows_for);
  const avgYellowsAgainst = numOrNull(r?.avg_yellows_against);
  const avgShotsFor = numOrNull(r?.avg_shots_for);
  const avgShotsAgainst = numOrNull(r?.avg_shots_against);
  const avgShotsOnTargetFor = numOrNull(r?.avg_sot_for);
  const avgShotsOnTargetAgainst = numOrNull(r?.avg_sot_against);
  return {
    avgHomeScored: avgHomeScored ?? 1.35,
    avgAwayScored: avgAwayScored ?? 1.15,
    avgScored: avgScored ?? 1.25,
    avgConceded: avgConceded ?? 1.25,
    avgCornersFor: avgCornersFor ?? 5.0,
    avgCornersAgainst: avgCornersAgainst ?? 5.0,
    avgYellowsFor: avgYellowsFor ?? 2.0,
    avgYellowsAgainst: avgYellowsAgainst ?? 2.0,
    avgShotsFor: avgShotsFor ?? 12.0,
    avgShotsAgainst: avgShotsAgainst ?? 12.0,
    avgShotsOnTargetFor: avgShotsOnTargetFor ?? 4.5,
    avgShotsOnTargetAgainst: avgShotsOnTargetAgainst ?? 4.5,
    proxy: {
      goals: avgHomeScored == null || avgAwayScored == null,
      corners: avgCornersFor == null,
      cards: avgYellowsFor == null,
      shots: avgShotsFor == null,
      shotsOnTarget: avgShotsOnTargetFor == null,
    },
  };
}

export async function leagueGoalAverages(db, leagueId) {
  const r = await db.first(
    `SELECT
       AVG(CASE WHEN ts.is_home = 1 THEN ts.goals_scored END) AS avg_home_scored,
       AVG(CASE WHEN ts.is_home = 0 THEN ts.goals_scored END) AS avg_away_scored,
       AVG(ts.goals_scored) AS avg_scored,
       AVG(ts.goals_conceded) AS avg_conceded,
       AVG(ts.corners_for) AS avg_corners_for,
       AVG(ts.corners_against) AS avg_corners_against,
       AVG(ts.yellows_for) AS avg_yellows_for,
       AVG(ts.yellows_against) AS avg_yellows_against,
       AVG(ts.shots_for) AS avg_shots_for,
       AVG(ts.shots_against) AS avg_shots_against,
       AVG(ts.shots_on_target_for) AS avg_sot_for,
       AVG(ts.shots_on_target_against) AS avg_sot_against
     FROM team_stats ts
     JOIN matches m ON m.id = ts.match_id
     WHERE m.league_id = ?`,
    leagueId
  );
  return mapLeagueAvgs(r);
}

/** League averages using only stats from matches before kickoff. */
export async function leagueGoalAveragesAsOf(db, leagueId, beforeDate) {
  const before = String(beforeDate || '').slice(0, 19);
  if (!before) return leagueGoalAverages(db, leagueId);
  const r = await db.first(
    `SELECT
       AVG(CASE WHEN ts.is_home = 1 THEN ts.goals_scored END) AS avg_home_scored,
       AVG(CASE WHEN ts.is_home = 0 THEN ts.goals_scored END) AS avg_away_scored,
       AVG(ts.goals_scored) AS avg_scored,
       AVG(ts.goals_conceded) AS avg_conceded,
       AVG(ts.corners_for) AS avg_corners_for,
       AVG(ts.corners_against) AS avg_corners_against,
       AVG(ts.yellows_for) AS avg_yellows_for,
       AVG(ts.yellows_against) AS avg_yellows_against,
       AVG(ts.shots_for) AS avg_shots_for,
       AVG(ts.shots_against) AS avg_shots_against,
       AVG(ts.shots_on_target_for) AS avg_sot_for,
       AVG(ts.shots_on_target_against) AS avg_sot_against
     FROM team_stats ts
     JOIN matches m ON m.id = ts.match_id
     WHERE m.league_id = ?
       AND datetime(m.match_date) < datetime(?)`,
    leagueId,
    before
  );
  return mapLeagueAvgs(r);
}

/** Finished matches for walk-forward backtest (oldest first). */
export async function listFinishedForBacktest(db, { days = 60, limit = 400 } = {}) {
  const lookback = Math.max(14, Math.min(120, Number(days) || 60));
  const lim = Math.max(20, Math.min(800, Number(limit) || 400));
  return db.all(
    `SELECT m.id, m.match_date, m.league_id, m.home_team_id, m.away_team_id,
            m.home_goals, m.away_goals,
            o.home_odds, o.draw_odds, o.away_odds,
            o.over25_odds, o.under25_odds, o.btts_yes_odds, o.btts_no_odds
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
       AND date(m.match_date) >= date('now', ?)
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC
     LIMIT ?`,
    `-${lookback} days`,
    lim
  );
}

/**
 * Bulk team_stats (+ league_id) for in-memory as-of backtest.
 * Extends lookback so early window matches still have prior form.
 */
export async function listTeamStatsForBacktest(db, { days = 60 } = {}) {
  const lookback = Math.max(60, Math.min(240, (Number(days) || 60) + 90));
  return db.all(
    `SELECT ts.team_id, ts.match_id, ts.goals_scored, ts.goals_conceded,
            ts.corners_for, ts.corners_against, ts.yellows_for, ts.yellows_against,
            ts.is_home, ts.match_date, m.league_id
     FROM team_stats ts
     JOIN matches m ON m.id = ts.match_id
     JOIN leagues l ON l.id = m.league_id
     WHERE date(ts.match_date) >= date('now', ?)
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY ts.match_date ASC`,
    `-${lookback} days`
  );
}

export async function getTeamRating(db, teamId, leagueId) {
  return db.first(
    `SELECT * FROM team_ratings WHERE team_id = ? AND league_id = ?`,
    teamId,
    leagueId
  );
}

export async function upsertTeamRating(db, row) {
  await db.run(
    `INSERT INTO team_ratings
       (team_id, league_id, attack, defense, var_att, var_def, n_obs, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_id, league_id) DO UPDATE SET
       attack = excluded.attack,
       defense = excluded.defense,
       var_att = excluded.var_att,
       var_def = excluded.var_def,
       n_obs = excluded.n_obs,
       updated_at = excluded.updated_at`,
    row.team_id,
    row.league_id,
    row.attack,
    row.defense,
    row.var_att,
    row.var_def,
    row.n_obs,
    row.updated_at
  );
}

export async function listTeamRatings(db, limit = 500) {
  return db.all(
    `SELECT * FROM team_ratings ORDER BY updated_at DESC LIMIT ?`,
    Math.max(1, Math.min(2000, Number(limit) || 500))
  );
}

export async function listFinishedAfterWatermark(db, watermark, limit = 50) {
  const wm = String(watermark || '1970-01-01').slice(0, 19);
  const lim = Math.max(1, Math.min(120, Number(limit) || 50));
  return db.all(
    `SELECT m.id, m.match_date, m.league_id, m.home_team_id, m.away_team_id,
            m.home_goals, m.away_goals
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
       AND datetime(m.match_date) > datetime(?)
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date ASC
     LIMIT ?`,
    wm,
    lim
  );
}

export async function countTeamRatings(db) {
  const row = await db.first(`SELECT COUNT(*) AS c FROM team_ratings`);
  return Number(row?.c || 0);
}

export function formFromStats(stats) {
  return (stats || []).map((s) => {
    if (s.goals_scored > s.goals_conceded) return 'W';
    if (s.goals_scored < s.goals_conceded) return 'L';
    return 'D';
  });
}

export async function upsertLeague(db, { name, country, logo_url, api_id }) {
  const existing = await db.first('SELECT id FROM leagues WHERE api_id = ?', api_id);
  if (existing) {
    await db.run(
      'UPDATE leagues SET name = ?, country = ?, logo_url = COALESCE(?, logo_url) WHERE api_id = ?',
      name,
      country,
      logo_url,
      api_id
    );
    return existing.id;
  }
  const res = await db.run(
    'INSERT INTO leagues (name, country, logo_url, api_id) VALUES (?, ?, ?, ?)',
    name,
    country,
    logo_url,
    api_id
  );
  return res.meta.last_row_id;
}

export async function upsertTeam(db, { name, logo_url, league_id, api_id }) {
  const existing = await db.first('SELECT id FROM teams WHERE api_id = ?', api_id);
  if (existing) {
    await db.run(
      'UPDATE teams SET name = ?, logo_url = COALESCE(?, logo_url), league_id = ? WHERE api_id = ?',
      name,
      logo_url,
      league_id,
      api_id
    );
    return existing.id;
  }
  const res = await db.run(
    'INSERT INTO teams (name, logo_url, league_id, api_id) VALUES (?, ?, ?, ?)',
    name,
    logo_url,
    league_id,
    api_id
  );
  return res.meta.last_row_id;
}

export async function upsertFixture(db, f) {
  const existing = await db.first('SELECT id FROM matches WHERE api_id = ?', f.api_id);
  const elapsed =
    f.elapsed_minute != null && !Number.isNaN(Number(f.elapsed_minute))
      ? Number(f.elapsed_minute)
      : null;
  if (existing) {
    await db.run(
      `UPDATE matches SET league_id=?, home_team_id=?, away_team_id=?, match_date=?,
       status=?, home_goals=?, away_goals=?,
       elapsed_minute=COALESCE(?, elapsed_minute) WHERE api_id=?`,
      f.league_id,
      f.home_team_id,
      f.away_team_id,
      f.match_date,
      f.status,
      f.home_goals,
      f.away_goals,
      elapsed,
      f.api_id
    );
    return existing.id;
  }
  const res = await db.run(
    `INSERT INTO matches
      (league_id, home_team_id, away_team_id, match_date, status, home_goals, away_goals, elapsed_minute, api_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.league_id,
    f.home_team_id,
    f.away_team_id,
    f.match_date,
    f.status,
    f.home_goals,
    f.away_goals,
    elapsed,
    f.api_id
  );
  return res.meta.last_row_id;
}

/** Update live/finished fields by api_id (no team remapping). */
export async function updateMatchLiveByApiId(db, apiId, { status, home_goals, away_goals, elapsed_minute }) {
  await db.run(
    `UPDATE matches SET
       status = COALESCE(?, status),
       home_goals = COALESCE(?, home_goals),
       away_goals = COALESCE(?, away_goals),
       elapsed_minute = ?
     WHERE api_id = ?`,
    status ?? null,
    home_goals ?? null,
    away_goals ?? null,
    elapsed_minute ?? null,
    apiId
  );
}

/** Update live fields by internal match id. */
export async function updateMatchLiveById(
  db,
  matchId,
  { status, home_goals, away_goals, elapsed_minute, fotmob_match_id }
) {
  await db.run(
    `UPDATE matches SET
       status = COALESCE(?, status),
       home_goals = COALESCE(?, home_goals),
       away_goals = COALESCE(?, away_goals),
       elapsed_minute = ?,
       fotmob_match_id = COALESCE(?, fotmob_match_id)
     WHERE id = ?`,
    status ?? null,
    home_goals ?? null,
    away_goals ?? null,
    elapsed_minute ?? null,
    fotmob_match_id ?? null,
    matchId
  );
}

/** Same as updateMatchLiveById for many matches in a single D1 batch. */
export async function updateMatchLiveBatch(db, rows) {
  const items = (rows || [])
    .filter((r) => r && r.id != null)
    .map((r) => ({
      sql: `UPDATE matches SET
         status = COALESCE(?, status),
         home_goals = COALESCE(?, home_goals),
         away_goals = COALESCE(?, away_goals),
         elapsed_minute = ?,
         fotmob_match_id = COALESCE(?, fotmob_match_id)
       WHERE id = ?`,
      params: [
        r.status ?? null,
        r.home_goals ?? null,
        r.away_goals ?? null,
        r.elapsed_minute ?? null,
        r.fotmob_match_id ?? null,
        r.id,
      ],
    }));
  if (!items.length) return 0;
  await db.batch(items);
  return items.length;
}

export async function updateMatchEventsJson(db, matchId, events) {
  const json = JSON.stringify(Array.isArray(events) ? events : []);
  await db.run(`UPDATE matches SET events_json = ? WHERE id = ?`, json, matchId);
}

/** Same as updateMatchEventsJson for many matches in a single D1 batch. */
export async function updateMatchEventsBatch(db, rows) {
  const items = (rows || [])
    .filter((r) => r && r.id != null)
    .map((r) => ({
      sql: `UPDATE matches SET events_json = ? WHERE id = ?`,
      params: [JSON.stringify(Array.isArray(r.events) ? r.events : []), r.id],
    }));
  if (!items.length) return 0;
  await db.batch(items);
  return items.length;
}

export async function upsertStat(db, s) {
  await db.run(
    `INSERT INTO team_stats
      (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against,
       yellows_for, yellows_against, reds_for, reds_against, fouls_for, fouls_against,
       shots_for, shots_against, shots_on_target_for, shots_on_target_against,
       is_home, match_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id, team_id) DO UPDATE SET
       goals_scored = excluded.goals_scored,
       goals_conceded = excluded.goals_conceded,
       corners_for = COALESCE(excluded.corners_for, team_stats.corners_for),
       corners_against = COALESCE(excluded.corners_against, team_stats.corners_against),
       yellows_for = COALESCE(excluded.yellows_for, team_stats.yellows_for),
       yellows_against = COALESCE(excluded.yellows_against, team_stats.yellows_against),
       reds_for = COALESCE(excluded.reds_for, team_stats.reds_for),
       reds_against = COALESCE(excluded.reds_against, team_stats.reds_against),
       fouls_for = COALESCE(excluded.fouls_for, team_stats.fouls_for),
       fouls_against = COALESCE(excluded.fouls_against, team_stats.fouls_against),
       shots_for = COALESCE(excluded.shots_for, team_stats.shots_for),
       shots_against = COALESCE(excluded.shots_against, team_stats.shots_against),
       shots_on_target_for = COALESCE(excluded.shots_on_target_for, team_stats.shots_on_target_for),
       shots_on_target_against = COALESCE(excluded.shots_on_target_against, team_stats.shots_on_target_against),
       is_home = excluded.is_home,
       match_date = excluded.match_date`,
    s.team_id,
    s.match_id,
    s.goals_scored,
    s.goals_conceded,
    s.corners_for ?? null,
    s.corners_against ?? null,
    s.yellows_for ?? null,
    s.yellows_against ?? null,
    s.reds_for ?? null,
    s.reds_against ?? null,
    s.fouls_for ?? null,
    s.fouls_against ?? null,
    s.shots_for ?? null,
    s.shots_against ?? null,
    s.shots_on_target_for ?? null,
    s.shots_on_target_against ?? null,
    s.is_home ? 1 : 0,
    s.match_date
  );
}

export async function upsertPrediction(db, p) {
  await db.run(
    `INSERT INTO predictions (
      match_id, home_win_prob, draw_prob, away_win_prob,
      over05_prob, under05_prob, over15_prob, under15_prob, over25_prob, under25_prob,
      over35_prob, under35_prob, over45_prob, under45_prob,
      btts_yes_prob, btts_no_prob,
      home_over05_prob, home_under05_prob, home_over15_prob, home_under15_prob,
      home_over25_prob, home_under25_prob, home_over35_prob, home_under35_prob,
      away_over05_prob, away_under05_prob, away_over15_prob, away_under15_prob,
      away_over25_prob, away_under25_prob, away_over35_prob, away_under35_prob,
      corners_over85_prob, corners_under85_prob,
      corners_over95_prob, corners_under95_prob,
      corners_over105_prob, corners_under105_prob,
      cards_over35_prob, cards_under35_prob, cards_over45_prob, cards_under45_prob,
      shots_over225_prob, shots_under225_prob, shots_over255_prob, shots_under255_prob,
      sot_over75_prob, sot_under75_prob, sot_over85_prob, sot_under85_prob,
      sot_over95_prob, sot_under95_prob,
      suggested_bet, secondary_bet, confidence_score, value_edge, value_market,
      home_xg, away_xg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id) DO UPDATE SET
      home_win_prob = excluded.home_win_prob,
      draw_prob = excluded.draw_prob,
      away_win_prob = excluded.away_win_prob,
      over05_prob = excluded.over05_prob,
      under05_prob = excluded.under05_prob,
      over15_prob = excluded.over15_prob,
      under15_prob = excluded.under15_prob,
      over25_prob = excluded.over25_prob,
      under25_prob = excluded.under25_prob,
      over35_prob = excluded.over35_prob,
      under35_prob = excluded.under35_prob,
      over45_prob = excluded.over45_prob,
      under45_prob = excluded.under45_prob,
      btts_yes_prob = excluded.btts_yes_prob,
      btts_no_prob = excluded.btts_no_prob,
      home_over05_prob = excluded.home_over05_prob,
      home_under05_prob = excluded.home_under05_prob,
      home_over15_prob = excluded.home_over15_prob,
      home_under15_prob = excluded.home_under15_prob,
      home_over25_prob = excluded.home_over25_prob,
      home_under25_prob = excluded.home_under25_prob,
      home_over35_prob = excluded.home_over35_prob,
      home_under35_prob = excluded.home_under35_prob,
      away_over05_prob = excluded.away_over05_prob,
      away_under05_prob = excluded.away_under05_prob,
      away_over15_prob = excluded.away_over15_prob,
      away_under15_prob = excluded.away_under15_prob,
      away_over25_prob = excluded.away_over25_prob,
      away_under25_prob = excluded.away_under25_prob,
      away_over35_prob = excluded.away_over35_prob,
      away_under35_prob = excluded.away_under35_prob,
      corners_over85_prob = excluded.corners_over85_prob,
      corners_under85_prob = excluded.corners_under85_prob,
      corners_over95_prob = excluded.corners_over95_prob,
      corners_under95_prob = excluded.corners_under95_prob,
      corners_over105_prob = excluded.corners_over105_prob,
      corners_under105_prob = excluded.corners_under105_prob,
      cards_over35_prob = excluded.cards_over35_prob,
      cards_under35_prob = excluded.cards_under35_prob,
      cards_over45_prob = excluded.cards_over45_prob,
      cards_under45_prob = excluded.cards_under45_prob,
      shots_over225_prob = excluded.shots_over225_prob,
      shots_under225_prob = excluded.shots_under225_prob,
      shots_over255_prob = excluded.shots_over255_prob,
      shots_under255_prob = excluded.shots_under255_prob,
      sot_over75_prob = excluded.sot_over75_prob,
      sot_under75_prob = excluded.sot_under75_prob,
      sot_over85_prob = excluded.sot_over85_prob,
      sot_under85_prob = excluded.sot_under85_prob,
      sot_over95_prob = excluded.sot_over95_prob,
      sot_under95_prob = excluded.sot_under95_prob,
      suggested_bet = excluded.suggested_bet,
      secondary_bet = excluded.secondary_bet,
      confidence_score = excluded.confidence_score,
      value_edge = excluded.value_edge,
      value_market = excluded.value_market,
      home_xg = excluded.home_xg,
      away_xg = excluded.away_xg,
      created_at = datetime('now')`,
    p.match_id,
    p.home_win_prob,
    p.draw_prob,
    p.away_win_prob,
    p.over05_prob ?? null,
    p.under05_prob ?? null,
    p.over15_prob,
    p.under15_prob,
    p.over25_prob,
    p.under25_prob,
    p.over35_prob,
    p.under35_prob,
    p.over45_prob ?? null,
    p.under45_prob ?? null,
    p.btts_yes_prob,
    p.btts_no_prob,
    p.home_over05_prob,
    p.home_under05_prob,
    p.home_over15_prob,
    p.home_under15_prob,
    p.home_over25_prob,
    p.home_under25_prob,
    p.home_over35_prob,
    p.home_under35_prob,
    p.away_over05_prob,
    p.away_under05_prob,
    p.away_over15_prob,
    p.away_under15_prob,
    p.away_over25_prob,
    p.away_under25_prob,
    p.away_over35_prob,
    p.away_under35_prob,
    p.corners_over85_prob,
    p.corners_under85_prob,
    p.corners_over95_prob,
    p.corners_under95_prob,
    p.corners_over105_prob,
    p.corners_under105_prob,
    p.cards_over35_prob,
    p.cards_under35_prob,
    p.cards_over45_prob,
    p.cards_under45_prob,
    p.shots_over225_prob ?? null,
    p.shots_under225_prob ?? null,
    p.shots_over255_prob ?? null,
    p.shots_under255_prob ?? null,
    p.sot_over75_prob ?? null,
    p.sot_under75_prob ?? null,
    p.sot_over85_prob ?? null,
    p.sot_under85_prob ?? null,
    p.sot_over95_prob ?? null,
    p.sot_under95_prob ?? null,
    p.suggested_bet,
    p.secondary_bet,
    p.confidence_score,
    p.value_edge,
    p.value_market,
    p.home_xg ?? null,
    p.away_xg ?? null
  );
}

export async function getPredictionByMatchId(db, matchId) {
  return db.first('SELECT * FROM predictions WHERE match_id = ?', matchId);
}

/** @returns {Promise<Map<number, object>>} */
export async function getPredictionsByMatchIds(db, matchIds) {
  const map = new Map();
  const ids = [...new Set((matchIds || []).map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const ph = slice.map(() => '?').join(',');
    const rows = await db.all(`SELECT * FROM predictions WHERE match_id IN (${ph})`, ...slice);
    for (const r of rows) map.set(Number(r.match_id), r);
  }
  return map;
}

export async function getBestBets(db, limit = 3, days = 14) {
  const endModifier = `+${Number(days)} days`;
  return db.all(
    `SELECT p.*,
       m.match_date, m.status, m.league_id,
       l.name AS league_name,
       l.country AS league_country,
       ht.name AS home_name, ht.logo_url AS home_logo,
       at.name AS away_name, at.logo_url AS away_logo,
       o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds,
       o.sot_over75_odds, o.sot_under75_odds, o.sot_over85_odds, o.sot_under85_odds,
       o.sot_over95_odds, o.sot_under95_odds,
       o.corners_over85_odds, o.corners_under85_odds, o.corners_over95_odds, o.corners_under95_odds,
       o.corners_over105_odds, o.corners_under105_odds,
       o.cards_over35_odds, o.cards_under35_odds, o.cards_over45_odds, o.cards_under45_odds
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE date(m.match_date) >= date('now')
       AND date(m.match_date) <= date('now', ?)
       AND m.status IN ('scheduled', 'live')
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
       AND p.confidence_score IS NOT NULL
     ORDER BY p.confidence_score DESC, p.value_edge DESC
     LIMIT ?`,
    endModifier,
    limit
  );
}

export async function getBestBetsOnDate(db, dateYmd, limit = 3) {
  return db.all(
    `SELECT p.*,
       m.match_date, m.status, m.league_id,
       l.name AS league_name,
       l.country AS league_country,
       ht.name AS home_name, ht.logo_url AS home_logo,
       at.name AS away_name, at.logo_url AS away_logo,
       o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds,
       o.sot_over75_odds, o.sot_under75_odds, o.sot_over85_odds, o.sot_under85_odds,
       o.sot_over95_odds, o.sot_under95_odds,
       o.corners_over85_odds, o.corners_under85_odds, o.corners_over95_odds, o.corners_under95_odds,
       o.corners_over105_odds, o.corners_under105_odds,
       o.cards_over35_odds, o.cards_under35_odds, o.cards_over45_odds, o.cards_under45_odds
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE date(m.match_date) = date(?)
       AND m.status IN ('scheduled', 'live')
       ${EXCLUDE_DEMO_SCHEDULED_M}
       ${ALLOWED_LEAGUE_SQL}
       AND p.confidence_score IS NOT NULL
     ORDER BY p.confidence_score DESC, p.value_edge DESC
     LIMIT ?`,
    dateYmd,
    limit
  );
}

/** Matches for live/result refresh matching (today + recent days, all visible states). */
export async function getTodayMatchesForLiveRefresh(db, lookbackDays = 1) {
  const startModifier = `-${Math.max(0, Number(lookbackDays) || 0)} days`;
  return db.all(
    `SELECT m.id, m.api_id, m.af_fixture_id, m.fotmob_match_id, m.match_date, m.status,
            m.home_goals, m.away_goals, m.elapsed_minute,
            m.home_team_id, m.away_team_id,
            m.events_json,
            l.api_id AS league_api_id, l.name AS league_name,
            ht.name AS home_name, ht.api_id AS home_team_api_id,
            at.name AS away_name, at.api_id AS away_team_api_id
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE date(m.match_date) >= date('now', ?)
       AND date(m.match_date) <= date('now')
       AND m.status IN ('scheduled', 'live', 'finished')
       ${EXCLUDE_DEMO_SCHEDULED_M}
     ORDER BY m.match_date ASC`,
    startModifier
  );
}

export async function upsertOdds(db, o) {
  await db.run(
    `INSERT INTO odds (
       match_id, bookmaker, home_odds, draw_odds, away_odds,
       over05_odds, under05_odds, over15_odds, under15_odds, over25_odds, under25_odds,
       over35_odds, under35_odds, over45_odds, under45_odds, btts_yes_odds, btts_no_odds,
       shots_over225_odds, shots_under225_odds, shots_over255_odds, shots_under255_odds,
       sot_over75_odds, sot_under75_odds, sot_over85_odds, sot_under85_odds,
       sot_over95_odds, sot_under95_odds,
       corners_over85_odds, corners_under85_odds, corners_over95_odds, corners_under95_odds,
       corners_over105_odds, corners_under105_odds,
       cards_over35_odds, cards_under35_odds, cards_over45_odds, cards_under45_odds,
       fetched_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(match_id, bookmaker) DO UPDATE SET
       home_odds = COALESCE(excluded.home_odds, odds.home_odds),
       draw_odds = COALESCE(excluded.draw_odds, odds.draw_odds),
       away_odds = COALESCE(excluded.away_odds, odds.away_odds),
       over05_odds = COALESCE(excluded.over05_odds, odds.over05_odds),
       under05_odds = COALESCE(excluded.under05_odds, odds.under05_odds),
       over15_odds = COALESCE(excluded.over15_odds, odds.over15_odds),
       under15_odds = COALESCE(excluded.under15_odds, odds.under15_odds),
       over25_odds = COALESCE(excluded.over25_odds, odds.over25_odds),
       under25_odds = COALESCE(excluded.under25_odds, odds.under25_odds),
       over35_odds = COALESCE(excluded.over35_odds, odds.over35_odds),
       under35_odds = COALESCE(excluded.under35_odds, odds.under35_odds),
       over45_odds = COALESCE(excluded.over45_odds, odds.over45_odds),
       under45_odds = COALESCE(excluded.under45_odds, odds.under45_odds),
       btts_yes_odds = COALESCE(excluded.btts_yes_odds, odds.btts_yes_odds),
       btts_no_odds = COALESCE(excluded.btts_no_odds, odds.btts_no_odds),
       shots_over225_odds = COALESCE(excluded.shots_over225_odds, odds.shots_over225_odds),
       shots_under225_odds = COALESCE(excluded.shots_under225_odds, odds.shots_under225_odds),
       shots_over255_odds = COALESCE(excluded.shots_over255_odds, odds.shots_over255_odds),
       shots_under255_odds = COALESCE(excluded.shots_under255_odds, odds.shots_under255_odds),
       sot_over75_odds = COALESCE(excluded.sot_over75_odds, odds.sot_over75_odds),
       sot_under75_odds = COALESCE(excluded.sot_under75_odds, odds.sot_under75_odds),
       sot_over85_odds = COALESCE(excluded.sot_over85_odds, odds.sot_over85_odds),
       sot_under85_odds = COALESCE(excluded.sot_under85_odds, odds.sot_under85_odds),
       sot_over95_odds = COALESCE(excluded.sot_over95_odds, odds.sot_over95_odds),
       sot_under95_odds = COALESCE(excluded.sot_under95_odds, odds.sot_under95_odds),
       corners_over85_odds = COALESCE(excluded.corners_over85_odds, odds.corners_over85_odds),
       corners_under85_odds = COALESCE(excluded.corners_under85_odds, odds.corners_under85_odds),
       corners_over95_odds = COALESCE(excluded.corners_over95_odds, odds.corners_over95_odds),
       corners_under95_odds = COALESCE(excluded.corners_under95_odds, odds.corners_under95_odds),
       corners_over105_odds = COALESCE(excluded.corners_over105_odds, odds.corners_over105_odds),
       corners_under105_odds = COALESCE(excluded.corners_under105_odds, odds.corners_under105_odds),
       cards_over35_odds = COALESCE(excluded.cards_over35_odds, odds.cards_over35_odds),
       cards_under35_odds = COALESCE(excluded.cards_under35_odds, odds.cards_under35_odds),
       cards_over45_odds = COALESCE(excluded.cards_over45_odds, odds.cards_over45_odds),
       cards_under45_odds = COALESCE(excluded.cards_under45_odds, odds.cards_under45_odds),
       bookmaker = COALESCE(excluded.bookmaker, odds.bookmaker),
       fetched_at = datetime('now'),
       updated_at = datetime('now')`,
    o.match_id,
    o.bookmaker || 'avg',
    o.home_odds,
    o.draw_odds,
    o.away_odds,
    o.over05_odds ?? null,
    o.under05_odds ?? null,
    o.over15_odds ?? null,
    o.under15_odds ?? null,
    o.over25_odds,
    o.under25_odds,
    o.over35_odds ?? null,
    o.under35_odds ?? null,
    o.over45_odds ?? null,
    o.under45_odds ?? null,
    o.btts_yes_odds ?? null,
    o.btts_no_odds ?? null,
    o.shots_over225_odds ?? null,
    o.shots_under225_odds ?? null,
    o.shots_over255_odds ?? null,
    o.shots_under255_odds ?? null,
    o.sot_over75_odds ?? null,
    o.sot_under75_odds ?? null,
    o.sot_over85_odds ?? null,
    o.sot_under85_odds ?? null,
    o.sot_over95_odds ?? null,
    o.sot_under95_odds ?? null,
    o.corners_over85_odds ?? null,
    o.corners_under85_odds ?? null,
    o.corners_over95_odds ?? null,
    o.corners_under95_odds ?? null,
    o.corners_over105_odds ?? null,
    o.corners_under105_odds ?? null,
    o.cards_over35_odds ?? null,
    o.cards_under35_odds ?? null,
    o.cards_over45_odds ?? null,
    o.cards_under45_odds ?? null
  );
}

/**
 * Cheap check so the live cron can skip upstream calls when nothing is pending.
 * Counts live matches, pending tips to settle and matches kicking off soon.
 */
export async function getLiveWorkStatus(db) {
  const row = await db.first(
    `SELECT
       (SELECT COUNT(*) FROM matches WHERE status = 'live') AS live,
       (SELECT COUNT(*) FROM tip_results WHERE outcome = 'pending') AS pending_tips,
       (SELECT COUNT(*) FROM matches
         WHERE status IN ('scheduled','live')
           AND datetime(match_date) BETWEEN datetime('now', '-3 hours') AND datetime('now', '+3 hours')) AS kicking`
  );
  const live = Number(row?.live || 0);
  const pendingTips = Number(row?.pending_tips || 0);
  const kicking = Number(row?.kicking || 0);
  return {
    live,
    pendingTips,
    kicking,
    needsWork: live > 0 || pendingTips > 0 || kicking > 0,
  };
}

/**
 * Close live rows whose kickoff is long past and void their unverifiable tips.
 * Those matches are no longer covered by any feed, so their score cannot be
 * confirmed: settling them would write a made-up result into the ledger.
 */
export async function closeStaleLiveMatches(db, olderThanHours = 4) {
  const hours = Math.max(1, Number(olderThanHours) || 4);
  const rows = await db.all(
    `SELECT id FROM matches
     WHERE status = 'live' AND datetime(match_date) < datetime('now', ?)`,
    `-${hours} hours`
  );
  if (!rows.length) return { closed: 0, voided: 0 };
  const ids = rows.map((r) => Number(r.id)).filter((id) => id > 0);
  let voided = 0;
  for (const id of ids) {
    const res = await db.run(
      `UPDATE tip_results SET outcome = 'void' WHERE match_id = ? AND outcome = 'pending'`,
      id
    );
    voided += Number(res?.meta?.changes || 0);
  }
  await db.batch(
    ids.map((id) => ({
      sql: `UPDATE matches
            SET status = 'finished', elapsed_minute = NULL
            WHERE id = ? AND status = 'live'`,
      params: [id],
    }))
  );
  return { closed: ids.length, voided };
}

/**
 * Recent meetings between two teams (by name, case-insensitive).
 * Names are used instead of team ids so cross-league meetings are found.
 * `excludeId` drops the current match; `beforeDate` (its kickoff) prevents
 * lookahead: a head to head must only show meetings already played.
 */
export async function getHeadToHead(db, homeName, awayName, opts = {}) {
  if (!homeName || !awayName) return [];
  const limit = Math.max(1, Math.min(12, Number(opts.limit) || 6));
  const conds = [];
  const where = [
    '(lower(ht.name) = lower(?1) AND lower(at.name) = lower(?2))',
    'OR (lower(ht.name) = lower(?3) AND lower(at.name) = lower(?4))',
    'm.home_goals IS NOT NULL',
    'm.away_goals IS NOT NULL',
  ];
  const params = [homeName, awayName, awayName, homeName];
  if (opts.excludeId != null) {
    conds.push('m.id != ?5');
    params.push(Number(opts.excludeId));
  }
  if (opts.beforeDate) {
    conds.push('datetime(m.match_date) < datetime(?6)');
    params.push(String(opts.beforeDate));
  }
  const rows = await db.all(
    `SELECT m.id, m.match_date, m.status, m.home_goals, m.away_goals,
            ht.name AS home_name, at.name AS away_name, l.name AS league_name
     FROM matches m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     JOIN leagues l ON l.id = m.league_id
     WHERE ${(where[0] + '\n      OR ' + where[1] + '\n       AND ' + where[2] + '\n       AND ' + where[3])}${conds.length ? `\n       AND ${conds.join('\n       AND ')}` : ''}
     ORDER BY m.match_date DESC
     LIMIT ?${params.length + 1}`,
    ...params,
    limit
  );
  return rows.map((r) => {
    const homeGoals = Number(r.home_goals);
    const awayGoals = Number(r.away_goals);
    return {
      id: Number(r.id),
      date: String(r.match_date || '').slice(0, 10),
      homeName: r.home_name,
      awayName: r.away_name,
      leagueName: r.league_name,
      homeGoals,
      awayGoals,
      homeWon: homeGoals > awayGoals,
      draw: homeGoals === awayGoals,
    };
  });
}

/** Mini league table computed from finished matches. */
export async function getLeagueTable(db, leagueId, limit = 20) {
  const lid = Number(leagueId);
  if (!Number.isFinite(lid) || lid <= 0) return [];
  const rows = await db.all(
    `WITH results AS (
       SELECT home_team_id AS team_id, home_goals AS gf, away_goals AS ga,
              CASE WHEN home_goals > away_goals THEN 1 ELSE 0 END AS won,
              CASE WHEN home_goals = away_goals THEN 1 ELSE 0 END AS drawn
       FROM matches
       WHERE league_id = ? AND status = 'finished'
         AND home_goals IS NOT NULL AND away_goals IS NOT NULL
       UNION ALL
       SELECT away_team_id AS team_id, away_goals AS gf, home_goals AS ga,
              CASE WHEN away_goals > home_goals THEN 1 ELSE 0 END AS won,
              CASE WHEN away_goals = home_goals THEN 1 ELSE 0 END AS drawn
       FROM matches
       WHERE league_id = ? AND status = 'finished'
         AND home_goals IS NOT NULL AND away_goals IS NOT NULL
     )
     SELECT t.id AS team_id, t.name AS team, t.logo_url AS logo_url,
            SUM(r.won) AS won, SUM(r.drawn) AS drawn,
            COUNT(*) - SUM(r.won) - SUM(r.drawn) AS lost,
            SUM(r.gf) AS gf, SUM(r.ga) AS ga
     FROM results r
     JOIN teams t ON t.id = r.team_id
     GROUP BY r.team_id
     ORDER BY (SUM(r.won) * 3 + SUM(r.drawn)) DESC,
              (SUM(r.gf) - SUM(r.ga)) DESC,
              SUM(r.gf) DESC,
              t.name ASC`,
    lid,
    lid
  );
  return rows.slice(0, Math.max(1, Math.min(40, Number(limit) || 20))).map((r, i) => {
    const won = Number(r.won || 0);
    const drawn = Number(r.drawn || 0);
    const lost = Number(r.lost || 0);
    const gf = Number(r.gf || 0);
    const ga = Number(r.ga || 0);
    return {
      position: i + 1,
      teamId: Number(r.team_id),
      team: r.team,
      logoUrl: r.logo_url || null,
      played: won + drawn + lost,
      won,
      drawn,
      lost,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDiff: gf - ga,
      points: won * 3 + drawn,
    };
  });
}

export async function getOddsForMatch(db, matchId) {
  return db.first(
    `SELECT * FROM odds
     WHERE match_id = ?
     ORDER BY
       (home_odds IS NOT NULL) + (draw_odds IS NOT NULL) + (away_odds IS NOT NULL) +
       (over25_odds IS NOT NULL) + (under25_odds IS NOT NULL) +
       (btts_yes_odds IS NOT NULL) + (btts_no_odds IS NOT NULL) DESC,
       datetime(updated_at) DESC
     LIMIT 1`,
    matchId
  );
}

/** @returns {Promise<Map<number, object>>} */
export async function getOddsByMatchIds(db, matchIds) {
  const map = new Map();
  const ids = [...new Set((matchIds || []).map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const ph = slice.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT * FROM odds
       WHERE match_id IN (${ph})
       ORDER BY match_id ASC,
         (home_odds IS NOT NULL) + (draw_odds IS NOT NULL) + (away_odds IS NOT NULL) +
         (over25_odds IS NOT NULL) + (under25_odds IS NOT NULL) +
         (btts_yes_odds IS NOT NULL) + (btts_no_odds IS NOT NULL) DESC,
         datetime(updated_at) DESC`,
      ...slice
    );
    for (const r of rows) {
      const id = Number(r.match_id);
      if (!map.has(id)) map.set(id, r);
    }
  }
  return map;
}

/** Prefer existing team by name in league (avoids duplicate Portugal etc. after FD sync). */
export async function upsertTeamByName(db, { name, logo_url, league_id, api_id }) {
  const byName = await db.first(
    'SELECT id FROM teams WHERE league_id = ? AND lower(name) = lower(?)',
    league_id,
    name
  );
  if (byName) return byName.id;
  return upsertTeam(db, { name, logo_url, league_id, api_id });
}

/**
 * Remove all demo-seed fixtures (scheduled + finished inventados).
 * api_id 910000–929999 from migrations 0002/0003.
 */
export async function deleteAllDemoMatches(db) {
  const result = await db.run(
    `DELETE FROM matches WHERE api_id >= 910000 AND api_id < 930000`
  );
  return Number(result?.meta?.changes || 0);
}

/** @deprecated use deleteAllDemoMatches */
export async function deleteDemoScheduledMatches(db) {
  return deleteAllDemoMatches(db);
}

export async function clearPredictions(db) {
  const result = await db.run('DELETE FROM predictions');
  return Number(result?.meta?.changes || 0);
}

/** Drop predictions whose match no longer exists (keeps cache across sync). */
export async function purgeOrphanPredictions(db) {
  const result = await db.run(
    `DELETE FROM predictions WHERE match_id NOT IN (SELECT id FROM matches)`
  );
  return Number(result?.meta?.changes || 0);
}

/**
 * Rebuild team_stats goals for finished FD matches.
 * Does not wipe corners/yellows already filled by API-Football enrich.
 */
export async function rebuildFdTeamStats(db) {
  await db.run(
    `INSERT INTO team_stats
      (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against,
       yellows_for, yellows_against, is_home, match_date)
     SELECT m.home_team_id, m.id, m.home_goals, m.away_goals, NULL, NULL, NULL, NULL, 1, m.match_date
     FROM matches m
     WHERE m.status = 'finished'
       AND m.api_id >= 820000000
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
     ON CONFLICT(match_id, team_id) DO UPDATE SET
       goals_scored = excluded.goals_scored,
       goals_conceded = excluded.goals_conceded,
       match_date = excluded.match_date`
  );
  await db.run(
    `INSERT INTO team_stats
      (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against,
       yellows_for, yellows_against, is_home, match_date)
     SELECT m.away_team_id, m.id, m.away_goals, m.home_goals, NULL, NULL, NULL, NULL, 0, m.match_date
     FROM matches m
     WHERE m.status = 'finished'
       AND m.api_id >= 820000000
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
     ON CONFLICT(match_id, team_id) DO UPDATE SET
       goals_scored = excluded.goals_scored,
       goals_conceded = excluded.goals_conceded,
       match_date = excluded.match_date`
  );
  const row = await db.first(
    `SELECT COUNT(*) AS c FROM team_stats ts
     JOIN matches m ON m.id = ts.match_id
     WHERE m.api_id >= 820000000 AND m.status = 'finished'`
  );
  return Number(row?.c || 0);
}

export async function countFixtureDownloadMatches(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const row = await db.first(
    `SELECT COUNT(*) AS c FROM matches
     WHERE api_id >= 820000000
       AND date(match_date) >= date('now')
       AND date(match_date) <= date('now', ?)
       AND status IN ('scheduled', 'live')`,
    endModifier
  );
  return Number(row?.c || 0);
}

export async function getMeta(db, key) {
  const row = await db.first('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(db, key, value) {
  await db.run(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    key,
    value == null ? '' : String(value)
  );
}

/** Snapshot tip for hit tracking. Only updates pending rows (keeps settled history). */
export async function upsertTipResult(db, tip) {
  const modelProb =
    tip.model_prob != null && Number(tip.model_prob) > 0
      ? Number(tip.model_prob)
      : tip.confidence_score != null && Number(tip.confidence_score) > 0
        ? Number(tip.confidence_score) > 1
          ? Number(tip.confidence_score) / 100
          : Number(tip.confidence_score)
        : null;
  await db.run(
    `INSERT INTO tip_results (
       match_id, suggested_bet, confidence_score, value_edge, value_market,
       tip_odds, odds_band, model_prob, odds_source, outcome
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(match_id) DO UPDATE SET
       suggested_bet = CASE WHEN tip_results.outcome = 'pending' THEN excluded.suggested_bet ELSE tip_results.suggested_bet END,
       confidence_score = CASE WHEN tip_results.outcome = 'pending' THEN excluded.confidence_score ELSE tip_results.confidence_score END,
       value_edge = CASE WHEN tip_results.outcome = 'pending' THEN excluded.value_edge ELSE tip_results.value_edge END,
       value_market = CASE WHEN tip_results.outcome = 'pending' THEN excluded.value_market ELSE tip_results.value_market END,
       tip_odds = CASE WHEN tip_results.outcome = 'pending' THEN excluded.tip_odds ELSE tip_results.tip_odds END,
       odds_band = CASE WHEN tip_results.outcome = 'pending' THEN excluded.odds_band ELSE tip_results.odds_band END,
       model_prob = CASE WHEN tip_results.outcome = 'pending' THEN excluded.model_prob ELSE tip_results.model_prob END,
       odds_source = CASE WHEN tip_results.outcome = 'pending' THEN excluded.odds_source ELSE tip_results.odds_source END`,
    tip.match_id,
    tip.suggested_bet,
    tip.confidence_score,
    tip.value_edge,
    tip.value_market,
    tip.tip_odds ?? null,
    tip.odds_band ?? null,
    modelProb,
    tip.odds_source ?? null
  );
}

export function evaluateSuggestedBet(bet, homeGoals, awayGoals, extras = {}) {
  const h = Number(homeGoals);
  const a = Number(awayGoals);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  switch (bet) {
    case 'HOME_WIN':
      return h > a;
    case 'DRAW':
      return h === a;
    case 'AWAY_WIN':
      return h < a;
    case 'DC_1X':
      return h >= a;
    case 'DC_X2':
      return h <= a;
    case 'DNB_HOME':
      if (h === a) return null; // void
      return h > a;
    case 'DNB_AWAY':
      if (h === a) return null; // void
      return h < a;
    case 'OVER_05':
      return h + a > 0;
    case 'UNDER_05':
      return h + a <= 0;
    case 'OVER_45':
      return h + a > 4;
    case 'UNDER_45':
      return h + a <= 4;
    case 'OVER_15':
      return h + a > 1;
    case 'UNDER_15':
      return h + a <= 1;
    case 'OVER_25':
      return h + a > 2;
    case 'UNDER_25':
      return h + a <= 2;
    case 'OVER_35':
      return h + a > 3;
    case 'UNDER_35':
      return h + a <= 3;
    case 'BTTS_YES':
      return h > 0 && a > 0;
    case 'BTTS_NO':
      return h === 0 || a === 0;
    case 'HOME_OVER_05':
      return h > 0;
    case 'HOME_UNDER_05':
      return h === 0;
    case 'HOME_OVER_15':
      return h > 1;
    case 'HOME_UNDER_15':
      return h <= 1;
    case 'HOME_OVER_25':
      return h > 2;
    case 'HOME_UNDER_25':
      return h <= 2;
    case 'HOME_OVER_35':
      return h > 3;
    case 'HOME_UNDER_35':
      return h <= 3;
    case 'AWAY_OVER_05':
      return a > 0;
    case 'AWAY_UNDER_05':
      return a === 0;
    case 'AWAY_OVER_15':
      return a > 1;
    case 'AWAY_UNDER_15':
      return a <= 1;
    case 'AWAY_OVER_25':
      return a > 2;
    case 'AWAY_UNDER_25':
      return a <= 2;
    case 'AWAY_OVER_35':
      return a > 3;
    case 'AWAY_UNDER_35':
      return a <= 3;
    case 'CORNERS_OVER_85':
      return extras.cornersTotal != null ? extras.cornersTotal > 8 : null;
    case 'CORNERS_UNDER_85':
      return extras.cornersTotal != null ? extras.cornersTotal <= 8 : null;
    case 'CORNERS_OVER_95':
      return extras.cornersTotal != null ? extras.cornersTotal > 9 : null;
    case 'CORNERS_UNDER_95':
      return extras.cornersTotal != null ? extras.cornersTotal <= 9 : null;
    case 'CORNERS_OVER_105':
      return extras.cornersTotal != null ? extras.cornersTotal > 10 : null;
    case 'CORNERS_UNDER_105':
      return extras.cornersTotal != null ? extras.cornersTotal <= 10 : null;
    case 'CARDS_OVER_35':
      return extras.yellowsTotal != null ? extras.yellowsTotal > 3 : null;
    case 'CARDS_UNDER_35':
      return extras.yellowsTotal != null ? extras.yellowsTotal <= 3 : null;
    case 'CARDS_OVER_45':
      return extras.yellowsTotal != null ? extras.yellowsTotal > 4 : null;
    case 'CARDS_UNDER_45':
      return extras.yellowsTotal != null ? extras.yellowsTotal <= 4 : null;
    case 'SHOTS_OVER_225':
      return extras.shotsTotal != null ? extras.shotsTotal > 22 : null;
    case 'SHOTS_UNDER_225':
      return extras.shotsTotal != null ? extras.shotsTotal <= 22 : null;
    case 'SHOTS_OVER_255':
      return extras.shotsTotal != null ? extras.shotsTotal > 25 : null;
    case 'SHOTS_UNDER_255':
      return extras.shotsTotal != null ? extras.shotsTotal <= 25 : null;
    case 'SOT_OVER_75':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal > 7 : null;
    case 'SOT_UNDER_75':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal <= 7 : null;
    case 'SOT_OVER_85':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal > 8 : null;
    case 'SOT_UNDER_85':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal <= 8 : null;
    case 'SOT_OVER_95':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal > 9 : null;
    case 'SOT_UNDER_95':
      return extras.shotsOnTargetTotal != null ? extras.shotsOnTargetTotal <= 9 : null;
    default:
      return null;
  }
}

/** Snapshot tips from predictions missing tip_results (upcoming; finished only if no stats epoch). */
export async function backfillPendingTips(db, limit = 60) {
  const epoch = await getMeta(db, 'stats_reset_at');
  const epochOk = epoch && /^\d{4}-\d{2}-\d{2}$/.test(String(epoch));
  // After a Stats wipe, never re-materialize finished tips (same-day included).
  // Only scheduled/live enter the ledger until they finish after the reset.
  const finishedSql = epochOk
    ? ''
    : `OR (
           m.status = 'finished'
           AND m.home_goals IS NOT NULL
           AND m.away_goals IS NOT NULL
         )`;
  const params = [Math.max(1, Number(limit) || 60)];
  const rows = await db.all(
    `SELECT p.*, o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds,
            o.sot_over75_odds, o.sot_under75_odds, o.sot_over85_odds, o.sot_under85_odds,
            o.sot_over95_odds, o.sot_under95_odds,
            o.corners_over85_odds, o.corners_under85_odds, o.corners_over95_odds, o.corners_under95_odds,
            o.corners_over105_odds, o.corners_under105_odds,
            o.cards_over35_odds, o.cards_under35_odds, o.cards_over45_odds, o.cards_under45_odds,
            m.status AS match_status, m.home_goals AS m_home_goals, m.away_goals AS m_away_goals
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE p.suggested_bet IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM tip_results tr WHERE tr.match_id = p.match_id)
       AND (
         m.status IN ('scheduled', 'live')
         ${finishedSql}
       )
     ORDER BY CASE WHEN m.status = 'finished' THEN 0 ELSE 1 END, m.match_date DESC
     LIMIT ?`,
    ...params
  );
  let n = 0;
  for (const r of rows) {
    const resolved = resolveTipOdds(r.suggested_bet, r, r);
    await upsertTipResult(db, {
      match_id: r.match_id,
      suggested_bet: r.suggested_bet,
      confidence_score: r.confidence_score,
      model_prob:
        r.confidence_score != null && Number(r.confidence_score) > 1
          ? Number(r.confidence_score) / 100
          : r.confidence_score != null
            ? Number(r.confidence_score)
            : null,
      value_edge: r.value_edge,
      value_market: r.value_market,
      tip_odds: resolved.tipOdds,
      odds_band: resolved.oddsBand,
    });
    n += 1;
  }
  return n;
}

/** Fill tip_odds / odds_band on tip_results that are missing them. */
export async function backfillTipOddsBands(db, limit = 80) {
  const rows = await db.all(
    `SELECT tr.id, tr.suggested_bet, tr.tip_odds AS existing_tip_odds, tr.odds_band AS existing_band,
            tr.odds_source AS existing_source,
            p.home_win_prob, p.draw_prob, p.away_win_prob,
            p.over15_prob, p.under15_prob, p.over25_prob, p.under25_prob,
            p.over35_prob, p.under35_prob, p.btts_yes_prob, p.btts_no_prob,
            p.home_over05_prob, p.home_under05_prob, p.home_over15_prob, p.home_under15_prob,
            p.home_over25_prob, p.home_under25_prob, p.home_over35_prob, p.home_under35_prob,
            p.away_over05_prob, p.away_under05_prob, p.away_over15_prob, p.away_under15_prob,
            p.away_over25_prob, p.away_under25_prob, p.away_over35_prob, p.away_under35_prob,
            p.corners_over85_prob, p.corners_under85_prob,
            p.corners_over95_prob, p.corners_under95_prob,
            p.corners_over105_prob, p.corners_under105_prob,
            p.cards_over35_prob, p.cards_under35_prob, p.cards_over45_prob, p.cards_under45_prob,
            p.shots_over225_prob, p.shots_under225_prob, p.shots_over255_prob, p.shots_under255_prob,
            p.sot_over75_prob, p.sot_under75_prob, p.sot_over85_prob, p.sot_under85_prob,
            p.sot_over95_prob, p.sot_under95_prob,
            o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds,
            o.over15_odds, o.under15_odds, o.over35_odds, o.under35_odds,
            o.btts_yes_odds, o.btts_no_odds,
            o.shots_over225_odds, o.shots_under225_odds, o.shots_over255_odds, o.shots_under255_odds,
            o.sot_over75_odds, o.sot_under75_odds, o.sot_over85_odds, o.sot_under85_odds,
            o.sot_over95_odds, o.sot_under95_odds,
            o.corners_over85_odds, o.corners_under85_odds, o.corners_over95_odds, o.corners_under95_odds,
            o.corners_over105_odds, o.corners_under105_odds,
            o.cards_over35_odds, o.cards_under35_odds, o.cards_over45_odds, o.cards_under45_odds
     FROM tip_results tr
     LEFT JOIN predictions p ON p.match_id = tr.match_id
     LEFT JOIN odds o ON o.match_id = tr.match_id
     WHERE tr.tip_odds IS NULL OR tr.odds_band IS NULL OR tr.odds_source IS NULL
     LIMIT ?`,
    Math.max(1, Number(limit) || 80)
  );
  let n = 0;
  for (const r of rows) {
    const resolved = resolveTipOdds(r.suggested_bet, r, r);
    const tipOdds =
      r.existing_tip_odds != null && Number(r.existing_tip_odds) > 0
        ? Number(r.existing_tip_odds)
        : resolved.tipOdds;
    const band =
      r.existing_band ||
      resolved.oddsBand ||
      (tipOdds != null ? oddsBandFromValue(tipOdds) : null);
    // Legacy rows have no source: keep the stored price and label it 'model'
    // unless it matches the live bookmaker quote exactly.
    const source =
      r.existing_source ||
      (resolved.oddsSource === 'book' &&
      tipOdds != null &&
      resolved.tipOdds != null &&
      Math.abs(Number(tipOdds) - Number(resolved.tipOdds)) < 0.01
        ? 'book'
        : tipOdds != null
          ? 'model'
          : null);
    if (tipOdds == null && band == null && source == null) continue;
    await db.run(
      `UPDATE tip_results
       SET tip_odds = COALESCE(tip_odds, ?),
           odds_band = COALESCE(odds_band, ?),
           odds_source = COALESCE(odds_source, ?)
       WHERE id = ?`,
      tipOdds,
      band,
      source,
      r.id
    );
    n += 1;
  }
  return n;
}

/**
 * Wipe tip + combo ledgers used by Stats / ROI (pending + settled).
 * Does not touch matches, predictions, odds, or team_stats.
 * Sets stats_reset_at so backfill cannot resurrect older finished tips.
 */
export async function resetStatsLedgers(db) {
  const tipsBefore = await db.first(`SELECT COUNT(*) AS n FROM tip_results`);
  const combosBefore = await db.first(`SELECT COUNT(*) AS n FROM combo_results`);
  await db.run(`DELETE FROM tip_results`);
  await db.run(`DELETE FROM combo_results`);
  const statsResetAt = new Date().toISOString().slice(0, 10);
  await setMeta(db, 'stats_reset_at', statsResetAt);
  return {
    tipsDeleted: Number(tipsBefore?.n) || 0,
    combosDeleted: Number(combosBefore?.n) || 0,
    statsResetAt,
  };
}

/**
 * Undo phantom "finished" rows whose kickoff is still in the future
 * (e.g. Atlético–Deportivo painted by a wrong FotMob name-match).
 */
export async function repairFutureFinishedMatches(db) {
  const rows = await db.all(
    `SELECT id FROM matches
     WHERE status = 'finished'
       AND datetime(match_date) > datetime('now')`
  );
  const ids = (rows || []).map((r) => Number(r.id)).filter((id) => id > 0);
  if (!ids.length) {
    return { repaired: 0, tipResultsDeleted: 0, matchIds: [] };
  }
  const ph = ids.map(() => '?').join(',');
  await db.run(
    `UPDATE matches
     SET status = 'scheduled',
         home_goals = NULL,
         away_goals = NULL,
         elapsed_minute = NULL,
         fotmob_match_id = NULL,
         events_json = NULL
     WHERE id IN (${ph})`,
    ...ids
  );
  const tipBefore = await db.first(
    `SELECT COUNT(*) AS n FROM tip_results WHERE match_id IN (${ph})`,
    ...ids
  );
  await db.run(`DELETE FROM tip_results WHERE match_id IN (${ph})`, ...ids);
  return {
    repaired: ids.length,
    tipResultsDeleted: Number(tipBefore?.n) || 0,
    matchIds: ids,
  };
}

export async function settlePendingTips(db, limit = 80) {
  const pending = await db.all(
    `SELECT tr.id, tr.match_id, tr.suggested_bet, m.home_goals, m.away_goals, m.status
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE tr.outcome = 'pending'
       AND m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
     LIMIT ?`,
    Math.max(1, Number(limit) || 80)
  );
  let settled = 0;
  for (const row of pending) {
    const homeStat = await db.first(
      `SELECT corners_for, yellows_for, shots_for, shots_on_target_for FROM team_stats WHERE match_id = ? AND is_home = 1`,
      row.match_id
    );
    const awayStat = await db.first(
      `SELECT corners_for, yellows_for, shots_for, shots_on_target_for FROM team_stats WHERE match_id = ? AND is_home = 0`,
      row.match_id
    );
    let cornersTotal = null;
    let yellowsTotal = null;
    let shotsTotal = null;
    let shotsOnTargetTotal = null;
    if (homeStat?.corners_for != null && awayStat?.corners_for != null) {
      cornersTotal = Number(homeStat.corners_for) + Number(awayStat.corners_for);
    }
    if (homeStat?.yellows_for != null && awayStat?.yellows_for != null) {
      yellowsTotal = Number(homeStat.yellows_for) + Number(awayStat.yellows_for);
    }
    if (homeStat?.shots_for != null && awayStat?.shots_for != null) {
      shotsTotal = Number(homeStat.shots_for) + Number(awayStat.shots_for);
    }
    if (homeStat?.shots_on_target_for != null && awayStat?.shots_on_target_for != null) {
      shotsOnTargetTotal =
        Number(homeStat.shots_on_target_for) + Number(awayStat.shots_on_target_for);
    }
    const hit = evaluateSuggestedBet(row.suggested_bet, row.home_goals, row.away_goals, {
      cornersTotal,
      yellowsTotal,
      shotsTotal,
      shotsOnTargetTotal,
    });
    const outcome = hit == null ? 'void' : hit ? 'hit' : 'miss';
    await db.run(
      `UPDATE tip_results
       SET home_goals = ?, away_goals = ?, outcome = ?, settled_at = datetime('now')
       WHERE id = ?`,
      row.home_goals,
      row.away_goals,
      outcome,
      row.id
    );
    settled += 1;
  }
  return settled;
}

function comboKeyFromLegs(legs) {
  return (legs || [])
    .map((l) => Number(l.matchId ?? l.match_id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .join('-');
}

/** Persist Cuotas combinadas (pending). Does not overwrite settled rows. */
export async function upsertComboResults(db, combos) {
  let n = 0;
  for (const c of combos || []) {
    const band = c.oddsBand != null ? String(c.oddsBand) : '';
    if (!['2', '3', '4', '5'].includes(band)) continue;
    const legs = c.legs || [];
    const key = c.comboKey || comboKeyFromLegs(legs);
    if (!key || !legs.length) continue;
    const combined = Number(c.combinedOdds);
    if (!Number.isFinite(combined) || combined <= 1) continue;
    const legsJson = JSON.stringify(
      legs.map((l) => ({
        matchId: Number(l.matchId),
        matchDate: l.matchDate || null,
        league: l.league || null,
        leagueId: l.leagueId ?? null,
        leagueCountry: l.leagueCountry || null,
        homeName: l.homeTeam?.name || l.homeName || null,
        awayName: l.awayTeam?.name || l.awayName || null,
        homeLogo: l.homeTeam?.logo || l.homeLogo || null,
        awayLogo: l.awayTeam?.logo || l.awayLogo || null,
        suggestedBet: l.suggestedBet || null,
        tipOdds: l.tipOdds != null ? Number(l.tipOdds) : null,
        confidenceScore: l.confidenceScore != null ? Number(l.confidenceScore) : null,
      }))
    );
    await db.run(
      `INSERT INTO combo_results (
         combo_key, odds_band, combined_odds, avg_confidence, legs_json, odds_source, outcome
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(combo_key, odds_band) DO UPDATE SET
         combined_odds = CASE WHEN combo_results.outcome = 'pending' THEN excluded.combined_odds ELSE combo_results.combined_odds END,
         avg_confidence = CASE WHEN combo_results.outcome = 'pending' THEN excluded.avg_confidence ELSE combo_results.avg_confidence END,
         legs_json = CASE WHEN combo_results.outcome = 'pending' THEN excluded.legs_json ELSE combo_results.legs_json END,
         odds_source = CASE WHEN combo_results.outcome = 'pending' THEN excluded.odds_source ELSE combo_results.odds_source END`,
      key,
      band,
      combined,
      c.avgConfidence != null ? Number(c.avgConfidence) : null,
      legsJson,
      c.oddsSource || 'model'
    );
    n += 1;
  }
  return n;
}

async function matchExtrasForEval(db, matchId) {
  const homeStat = await db.first(
    `SELECT corners_for, yellows_for, shots_for, shots_on_target_for FROM team_stats WHERE match_id = ? AND is_home = 1`,
    matchId
  );
  const awayStat = await db.first(
    `SELECT corners_for, yellows_for, shots_for, shots_on_target_for FROM team_stats WHERE match_id = ? AND is_home = 0`,
    matchId
  );
  let cornersTotal = null;
  let yellowsTotal = null;
  let shotsTotal = null;
  let shotsOnTargetTotal = null;
  if (homeStat?.corners_for != null && awayStat?.corners_for != null) {
    cornersTotal = Number(homeStat.corners_for) + Number(awayStat.corners_for);
  }
  if (homeStat?.yellows_for != null && awayStat?.yellows_for != null) {
    yellowsTotal = Number(homeStat.yellows_for) + Number(awayStat.yellows_for);
  }
  if (homeStat?.shots_for != null && awayStat?.shots_for != null) {
    shotsTotal = Number(homeStat.shots_for) + Number(awayStat.shots_for);
  }
  if (homeStat?.shots_on_target_for != null && awayStat?.shots_on_target_for != null) {
    shotsOnTargetTotal =
      Number(homeStat.shots_on_target_for) + Number(awayStat.shots_on_target_for);
  }
  return { cornersTotal, yellowsTotal, shotsTotal, shotsOnTargetTotal };
}

/** Settle pending combinadas when every leg match is finished. */
export async function settlePendingCombos(db, limit = 40) {
  const pending = await db.all(
    `SELECT id, legs_json FROM combo_results WHERE outcome = 'pending' ORDER BY created_at ASC LIMIT ?`,
    Math.max(1, Number(limit) || 40)
  );
  let settled = 0;
  for (const row of pending) {
    let legs;
    try {
      legs = JSON.parse(row.legs_json || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(legs) || !legs.length) continue;
    let allHit = true;
    let anyPending = false;
    let anyVoid = false;
    for (const leg of legs) {
      const mid = Number(leg.matchId);
      if (!mid) {
        anyVoid = true;
        break;
      }
      const m = await db.first(
        `SELECT status, home_goals, away_goals FROM matches WHERE id = ?`,
        mid
      );
      if (!m || m.status !== 'finished' || m.home_goals == null || m.away_goals == null) {
        anyPending = true;
        break;
      }
      const extras = await matchExtrasForEval(db, mid);
      const hit = evaluateSuggestedBet(leg.suggestedBet, m.home_goals, m.away_goals, extras);
      if (hit == null) {
        anyVoid = true;
        break;
      }
      if (!hit) allHit = false;
    }
    if (anyPending) continue;
    const outcome = anyVoid ? 'void' : allHit ? 'hit' : 'miss';
    await db.run(
      `UPDATE combo_results SET outcome = ?, settled_at = datetime('now') WHERE id = ?`,
      outcome,
      row.id
    );
    settled += 1;
  }
  return settled;
}

/**
 * Rebuild combinadas from finished matches in a past window and settle immediately
 * so Cuotas history is not empty on first deploy.
 */
export async function backfillHistoricalCombos(db, days = 14, perBand = 6) {
  const d = Math.max(3, Math.min(60, Number(days) || 14));
  const rows = await db.all(
    `SELECT m.id AS match_id, m.match_date, m.home_goals, m.away_goals, m.status,
            m.league_id, l.name AS league_name, l.country AS league_country,
            ht.name AS home_name, at.name AS away_name,
            ht.logo_url AS home_logo, at.logo_url AS away_logo,
            p.*, o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds
     FROM matches m
     JOIN predictions p ON p.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     JOIN leagues l ON l.id = m.league_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
       AND DATE(m.match_date) >= DATE('now', ?)
       AND DATE(m.match_date) <= DATE('now')
     ORDER BY m.match_date DESC
     LIMIT 80`,
    `-${d} days`
  );
  if (!rows.length) return 0;

  const candidates = [];
  for (const r of rows) {
    for (const band of ['2', '3', '4', '5']) {
      const opts = comboOptsForBand(band);
      const picked = pickLegForCombo(r, r, [r.suggested_bet, r.secondary_bet], {
        tipMin: opts.tipMin,
        tipMax: opts.tipMax,
      });
      if (!picked) continue;
      candidates.push({
        band,
        leg: {
          matchId: r.match_id,
          matchDate: r.match_date,
          league: r.league_name,
          leagueId: r.league_id,
          leagueCountry: r.league_country,
          homeTeam: { name: r.home_name, logo: r.home_logo },
          awayTeam: { name: r.away_name, logo: r.away_logo },
          suggestedBet: picked.label,
          tipOdds: picked.tipOdds,
          confidenceScore: Number((picked.prob * 100).toFixed(2)),
          _homeGoals: r.home_goals,
          _awayGoals: r.away_goals,
        },
      });
    }
  }

  let saved = 0;
  for (const band of ['2', '3', '4', '5']) {
    const opts = comboOptsForBand(band);
    const legs = candidates.filter((c) => c.band === band).map((c) => c.leg);
    // Unique by match
    const seen = new Set();
    const uniq = [];
    for (const l of legs) {
      if (seen.has(l.matchId)) continue;
      seen.add(l.matchId);
      uniq.push(l);
    }
    const built = buildCombos(uniq, band, {
      ...opts,
      limit: Math.max(1, Number(perBand) || 6),
    });
    for (const c of built) {
      let allHit = true;
      let anyVoid = false;
      for (const leg of c.legs) {
        const src = uniq.find((u) => u.matchId === leg.matchId);
        if (!src) {
          anyVoid = true;
          break;
        }
        const extras = await matchExtrasForEval(db, leg.matchId);
        const hit = evaluateSuggestedBet(
          leg.suggestedBet,
          src._homeGoals,
          src._awayGoals,
          extras
        );
        if (hit == null) {
          anyVoid = true;
          break;
        }
        if (!hit) allHit = false;
      }
      const outcome = anyVoid ? 'void' : allHit ? 'hit' : 'miss';
      const key = comboKeyFromLegs(c.legs);
      const comboSource = c.legs.every((l) => l.oddsSource === 'book') ? 'book' : 'model';
      const legsJson = JSON.stringify(
        c.legs.map((l) => ({
          matchId: Number(l.matchId),
          matchDate: l.matchDate || null,
          league: l.league || null,
          leagueId: l.leagueId ?? null,
          leagueCountry: l.leagueCountry || null,
          homeName: l.homeTeam?.name || null,
          awayName: l.awayTeam?.name || null,
          homeLogo: l.homeTeam?.logo || null,
          awayLogo: l.awayTeam?.logo || null,
          suggestedBet: l.suggestedBet || null,
          tipOdds: l.tipOdds != null ? Number(l.tipOdds) : null,
          confidenceScore: l.confidenceScore != null ? Number(l.confidenceScore) : null,
        }))
      );
      await db.run(
        `INSERT INTO combo_results (
           combo_key, odds_band, combined_odds, avg_confidence, legs_json, odds_source, outcome, settled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(combo_key, odds_band) DO UPDATE SET
           outcome = CASE
             WHEN combo_results.outcome IN ('hit','miss','void') THEN combo_results.outcome
             ELSE excluded.outcome
           END,
           settled_at = CASE
             WHEN combo_results.outcome IN ('hit','miss','void') THEN combo_results.settled_at
             ELSE excluded.settled_at
           END,
           combined_odds = CASE WHEN combo_results.outcome = 'pending' THEN excluded.combined_odds ELSE combo_results.combined_odds END,
           legs_json = CASE WHEN combo_results.outcome = 'pending' THEN excluded.legs_json ELSE combo_results.legs_json END,
           odds_source = CASE WHEN combo_results.outcome = 'pending' THEN excluded.odds_source ELSE combo_results.odds_source END`,
        key,
        band,
        c.combinedOdds,
        c.avgConfidence,
        legsJson,
        comboSource,
        outcome
      );
      saved += 1;
    }
  }
  return saved;
}

export async function getRecentComboResults(db, { band = null, limit = 40, win = null } = {}) {
  const lim = Math.max(1, Math.min(80, Number(limit) || 40));
  const params = [];
  let windowSql = '1=1';
  if (win?.mode === 'date' && win.date && /^\d{4}-\d{2}-\d{2}$/.test(win.date)) {
    windowSql = `DATE(COALESCE(settled_at, created_at)) = DATE(?)`;
    params.push(win.date);
  } else if (win?.mode === 'days' || win?.mode === 'all') {
    const days = Math.max(1, Number(win.days) || 14);
    windowSql = `DATE(COALESCE(settled_at, created_at)) >= DATE('now', ?) AND DATE(COALESCE(settled_at, created_at)) <= DATE('now')`;
    params.push(`-${days} days`);
  } else if (win) {
    windowSql = `DATE(COALESCE(settled_at, created_at)) >= DATE('now', '-30 days')`;
  }
  let bandSql = '';
  if (band && ['2', '3', '4', '5'].includes(String(band))) {
    bandSql = 'AND odds_band = ?';
    params.push(String(band));
  }
  params.push(lim);
  const rows = await db.all(
    `SELECT id, combo_key, odds_band, combined_odds, avg_confidence, legs_json,
            outcome, settled_at, created_at
     FROM combo_results
     WHERE outcome IN ('hit', 'miss') AND ${windowSql} ${bandSql}
     ORDER BY COALESCE(settled_at, created_at) DESC
     LIMIT ?`,
    ...params
  );
  return rows.map((r) => {
    let legs = [];
    try {
      legs = JSON.parse(r.legs_json || '[]');
    } catch {
      legs = [];
    }
    return {
      id: r.id,
      comboKey: r.combo_key,
      oddsBand: r.odds_band,
      combinedOdds: r.combined_odds != null ? Number(r.combined_odds) : null,
      avgConfidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      outcome: r.outcome,
      settledAt: r.settled_at,
      createdAt: r.created_at,
      legs,
    };
  });
}

/** Hit/miss/pending for combinadas by band (ledger), optional calendar window on settled/created. */
export async function getComboBandStats(db, win = null) {
  let windowSql = '1=1';
  const params = [];
  if (win?.mode === 'date' && win.date && /^\d{4}-\d{2}-\d{2}$/.test(win.date)) {
    windowSql = `(
      (outcome IN ('hit','miss','void') AND DATE(COALESCE(settled_at, created_at)) = DATE(?))
      OR (outcome = 'pending' AND DATE(created_at) = DATE(?))
    )`;
    params.push(win.date, win.date);
  } else if (win?.mode === 'days' || win?.mode === 'all') {
    const days = Math.max(1, Number(win.days) || 14);
    windowSql = `DATE(COALESCE(settled_at, created_at)) >= DATE('now', ?) AND DATE(COALESCE(settled_at, created_at)) <= DATE('now')`;
    params.push(`-${days} days`);
  } else if (win) {
    windowSql = `DATE(COALESCE(settled_at, created_at)) >= DATE('now', '-30 days')`;
  }
  const rows = await db.all(
    `SELECT odds_band AS band,
       SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
       SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
       SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN outcome = 'hit' AND odds_source = 'book' THEN 1 ELSE 0 END) AS book_hits,
       SUM(CASE WHEN outcome = 'miss' AND odds_source = 'book' THEN 1 ELSE 0 END) AS book_misses,
       SUM(CASE WHEN outcome = 'hit' AND odds_source = 'book' THEN combined_odds - 1 ELSE 0 END) AS book_profit,
       SUM(CASE WHEN outcome = 'miss' AND odds_source = 'book' THEN 1 ELSE 0 END) AS book_staked,
       SUM(CASE WHEN odds_source = 'book' AND outcome IN ('hit','miss') THEN combined_odds ELSE 0 END) AS book_odds_sum
     FROM combo_results
     WHERE odds_band IN ('2','3','4','5') AND ${windowSql}
     GROUP BY odds_band`,
    ...params
  );
  const map = new Map(rows.map((r) => [String(r.band), r]));
  const out = {};
  for (const band of ['2', '3', '4', '5']) {
    const r = map.get(band);
    const h = Number(r?.hits || 0);
    const m = Number(r?.misses || 0);
    const d = h + m;
    const staked = Number(r?.book_staked || 0);
    out[band] = {
      hits: h,
      misses: m,
      pending: Number(r?.pending || 0),
      hitRate: d ? Number((h / d).toFixed(4)) : null,
      roi: staked > 0 ? Number((Number(r?.book_profit || 0) / staked).toFixed(4)) : null,
      staked,
      avgOdds:
        staked > 0 && Number(r?.book_odds_sum || 0) > 0
          ? Number((Number(r.book_odds_sum) / staked).toFixed(4))
          : null,
    };
  }
  return out;
}

/**
 * Hit rates for mid-odds single markets (calibration only — not Cuotas chip %).
 */
export async function computeMidBandMarketPerf(db, windowSql, windowParams) {
  const empty = () => ({ hits: 0, misses: 0, pending: 0 });
  const stats = {
    '2': empty(),
    '3': empty(),
    '4': empty(),
    '5': empty(),
  };

  const rows = await db.all(
    `SELECT p.*, m.id AS match_id, m.match_date, m.home_goals, m.away_goals, m.status,
            ht.name AS home_name, at.name AS away_name, l.name AS league_name,
            l.country AS league_country,
            ht.logo_url AS home_logo, at.logo_url AS away_logo,
            o.home_odds, o.draw_odds, o.away_odds, o.over25_odds, o.under25_odds
     FROM matches m
     JOIN predictions p ON p.match_id = m.id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     JOIN leagues l ON l.id = m.league_id
     LEFT JOIN odds o ON o.match_id = m.id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND m.away_goals IS NOT NULL
       AND ${windowSql}
     ORDER BY m.match_date DESC
     LIMIT 120`,
    ...windowParams
  );
  if (!rows.length) return { stats };

  const matchIds = rows.map((r) => r.match_id);
  const placeholders = matchIds.map(() => '?').join(',');
  const teamStats = await db.all(
    `SELECT match_id, is_home, corners_for, yellows_for, shots_for, shots_on_target_for
     FROM team_stats
     WHERE match_id IN (${placeholders})`,
    ...matchIds
  );
  const extrasByMatch = new Map();
  for (const s of teamStats) {
    let ex = extrasByMatch.get(s.match_id);
    if (!ex) {
      ex = { home: null, away: null };
      extrasByMatch.set(s.match_id, ex);
    }
    if (Number(s.is_home) === 1) ex.home = s;
    else ex.away = s;
  }

  for (const r of rows) {
    const pair = extrasByMatch.get(r.match_id);
    let cornersTotal = null;
    let yellowsTotal = null;
    let shotsTotal = null;
    let shotsOnTargetTotal = null;
    if (pair?.home?.corners_for != null && pair?.away?.corners_for != null) {
      cornersTotal = Number(pair.home.corners_for) + Number(pair.away.corners_for);
    }
    if (pair?.home?.yellows_for != null && pair?.away?.yellows_for != null) {
      yellowsTotal = Number(pair.home.yellows_for) + Number(pair.away.yellows_for);
    }
    if (pair?.home?.shots_for != null && pair?.away?.shots_for != null) {
      shotsTotal = Number(pair.home.shots_for) + Number(pair.away.shots_for);
    }
    if (
      pair?.home?.shots_on_target_for != null &&
      pair?.away?.shots_on_target_for != null
    ) {
      shotsOnTargetTotal =
        Number(pair.home.shots_on_target_for) + Number(pair.away.shots_on_target_for);
    }
    const preferred = [r.suggested_bet, r.secondary_bet].filter(Boolean);
    for (const band of ['2', '3', '4', '5']) {
      const picked = pickMarketForOddsBand(r, r, band, preferred);
      if (!picked?.label) continue;
      const hit = evaluateSuggestedBet(picked.label, r.home_goals, r.away_goals, {
        cornersTotal,
        yellowsTotal,
        shotsTotal,
        shotsOnTargetTotal,
      });
      if (hit == null) continue;
      if (hit) stats[band].hits += 1;
      else stats[band].misses += 1;
    }
  }

  return { stats };
}

/** Shared match-date window for tip aggregates (badge / Aciertos / Bandas). */
async function tipPerformanceWindow(db, win = null) {
  let windowSql = '1=1';
  const windowParams = [];
  let windowLabel = 'histórico';
  if (win?.mode === 'date' && win.date && /^\d{4}-\d{2}-\d{2}$/.test(win.date)) {
    windowSql = `DATE(m.match_date) = DATE(?)`;
    windowParams.push(win.date);
    windowLabel = win.date;
  } else if (win?.mode === 'all') {
    // Full ledger — ignore Pronósticos date/window filters
    windowSql = '1=1';
    windowLabel = 'histórico';
  } else if (win?.mode === 'days') {
    const days = Math.max(1, Number(win.days) || 14);
    // Past only: hit rates for last N days (cartelera 5d/14d still uses upcoming elsewhere)
    windowSql = `DATE(m.match_date) >= DATE('now', ?) AND DATE(m.match_date) <= DATE('now')`;
    windowParams.push(`-${days} days`);
    windowLabel = `últimos ${days} días`;
  } else {
    // Default for badge / no query: last 30 days of tips by match date
    windowSql = `DATE(m.match_date) >= DATE('now', '-30 days')`;
    windowLabel = 'últimos 30 días';
  }
  const epoch = await getMeta(db, 'stats_reset_at');
  if (epoch && /^\d{4}-\d{2}-\d{2}$/.test(String(epoch))) {
    windowSql = `(${windowSql}) AND DATE(m.match_date) >= DATE(?)`;
    windowParams.push(String(epoch));
    if (win?.mode === 'all' || !win) {
      windowLabel = `desde ${epoch}`;
    }
  }
  return { windowSql, windowParams, windowLabel };
}

/** Fast badge aggregates only — NO backfill / settle. */
export async function getTipSummary(db, win = null) {
  const { windowSql, windowParams, windowLabel } = await tipPerformanceWindow(db, win);
  const totals = await db.first(
    `SELECT
       SUM(CASE WHEN tr.outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
       SUM(CASE WHEN tr.outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
       SUM(CASE WHEN tr.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN tr.outcome = 'void' THEN 1 ELSE 0 END) AS voids
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE ${windowSql}`,
    ...windowParams
  );
  const hits = Number(totals?.hits || 0);
  const misses = Number(totals?.misses || 0);
  const decided = hits + misses;
  return {
    hits,
    misses,
    pending: Number(totals?.pending || 0),
    voids: Number(totals?.voids || 0),
    decided,
    hitRate: decided ? Number((hits / decided).toFixed(4)) : null,
    windowLabel,
  };
}

export async function getTipPerformance(db, win = null) {
  // Settle pending tips/combos on read; do NOT invent historical combos here.
  try {
    await backfillPendingTips(db, 80);
    await settlePendingTips(db, 200);
    await backfillTipOddsBands(db, 300);
    await settlePendingCombos(db, 40);
  } catch (_) {
    /* keep read path available even if maintenance fails */
  }

  const { windowSql, windowParams, windowLabel } = await tipPerformanceWindow(db, win);

  const totals = await db.first(
    `SELECT
       SUM(CASE WHEN tr.outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
       SUM(CASE WHEN tr.outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
       SUM(CASE WHEN tr.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN tr.outcome = 'void' THEN 1 ELSE 0 END) AS voids
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE ${windowSql}`,
    ...windowParams
  );
  const hits = Number(totals?.hits || 0);
  const misses = Number(totals?.misses || 0);
  const decided = hits + misses;
  const byFamily = await db.all(
    `SELECT
       CASE
         WHEN tr.suggested_bet IN ('HOME_WIN','DRAW','AWAY_WIN') THEN '1X2'
         WHEN tr.suggested_bet IN ('BTTS_YES','BTTS_NO') THEN 'btts'
         WHEN tr.suggested_bet IN ('OVER_15','UNDER_15','OVER_25','UNDER_25','OVER_35','UNDER_35') THEN 'ou'
         WHEN tr.suggested_bet IN ('CORNERS_OVER_85','CORNERS_UNDER_85','CORNERS_OVER_95','CORNERS_UNDER_95','CORNERS_OVER_105','CORNERS_UNDER_105') THEN 'corners'
         WHEN tr.suggested_bet IN ('CARDS_OVER_35','CARDS_UNDER_35','CARDS_OVER_45','CARDS_UNDER_45') THEN 'cards'
         WHEN tr.suggested_bet IN ('SOT_OVER_75','SOT_UNDER_75','SOT_OVER_85','SOT_UNDER_85','SOT_OVER_95','SOT_UNDER_95') THEN 'shots_on_target'
         WHEN tr.suggested_bet IN ('SHOTS_OVER_225','SHOTS_UNDER_225','SHOTS_OVER_255','SHOTS_UNDER_255') THEN 'shots'
         ELSE 'otros'
       END AS family,
       SUM(CASE WHEN tr.outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
       SUM(CASE WHEN tr.outcome = 'miss' THEN 1 ELSE 0 END) AS misses
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE tr.outcome IN ('hit', 'miss') AND ${windowSql}
     GROUP BY family`,
    ...windowParams
  );
  // Band 1 (Cortas) = official tips; bands 2–5 = combinadas ledger.
  const byOddsBandRaw = await db.all(
    `SELECT
       CASE
         WHEN tr.tip_odds > 1 AND tr.tip_odds < 1.7 THEN '1'
         WHEN tr.tip_odds >= 1.7 AND tr.tip_odds < 2.5 THEN '2'
         WHEN tr.tip_odds >= 2.5 AND tr.tip_odds < 3.5 THEN '3'
         WHEN tr.tip_odds >= 3.5 AND tr.tip_odds < 4.5 THEN '4'
         WHEN tr.tip_odds >= 4.5 AND tr.tip_odds <= 6.5 THEN '5'
         WHEN tr.odds_band IN ('1','2','3','4','5') THEN tr.odds_band
         ELSE NULL
       END AS band,
       SUM(CASE WHEN tr.outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
       SUM(CASE WHEN tr.outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
       SUM(CASE WHEN tr.outcome = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE ${windowSql}
     GROUP BY band
     HAVING band IS NOT NULL`,
    ...windowParams
  );
  const tipBandMap = new Map(byOddsBandRaw.map((r) => [String(r.band), r]));
  let comboBands = {};
  try {
    comboBands = await getComboBandStats(db, win);
  } catch (_) {
    comboBands = {};
  }
  const byOddsBand = STAT_ODDS_BANDS.map((band) => {
    if (band === '1') {
      const r = tipBandMap.get('1');
      const h = Number(r?.hits || 0);
      const m = Number(r?.misses || 0);
      const d = h + m;
      return {
        band,
        hits: h,
        misses: m,
        pending: Number(r?.pending || 0),
        hitRate: d ? Number((h / d).toFixed(4)) : null,
        source: 'tips',
      };
    }
    const c = comboBands[band] || { hits: 0, misses: 0, pending: 0, hitRate: null };
    return {
      band,
      hits: Number(c.hits || 0),
      misses: Number(c.misses || 0),
      pending: Number(c.pending || 0),
      hitRate: c.hitRate,
      roi: c.roi ?? null,
      staked: Number(c.staked || 0),
      avgOdds: c.avgOdds ?? null,
      source: 'combos',
    };
  });
  const stakeRowsRaw = await db.all(
    `SELECT tr.suggested_bet, tr.outcome, tr.tip_odds, tr.odds_source,
            CASE
              WHEN tr.suggested_bet IN ('HOME_WIN','DRAW','AWAY_WIN') THEN '1X2'
              WHEN tr.suggested_bet IN ('BTTS_YES','BTTS_NO') THEN 'btts'
              WHEN tr.suggested_bet IN ('OVER_15','UNDER_15','OVER_25','UNDER_25','OVER_35','UNDER_35') THEN 'ou'
              WHEN tr.suggested_bet IN ('CORNERS_OVER_85','CORNERS_UNDER_85','CORNERS_OVER_95','CORNERS_UNDER_95','CORNERS_OVER_105','CORNERS_UNDER_105') THEN 'corners'
              WHEN tr.suggested_bet IN ('CARDS_OVER_35','CARDS_UNDER_35','CARDS_OVER_45','CARDS_UNDER_45') THEN 'cards'
              WHEN tr.suggested_bet IN ('SOT_OVER_75','SOT_UNDER_75','SOT_OVER_85','SOT_UNDER_85','SOT_OVER_95','SOT_UNDER_95') THEN 'shots_on_target'
              WHEN tr.suggested_bet IN ('SHOTS_OVER_225','SHOTS_UNDER_225','SHOTS_OVER_255','SHOTS_UNDER_255') THEN 'shots'
              ELSE 'otros'
            END AS family
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     WHERE tr.outcome IN ('hit','miss','void') AND ${windowSql}`,
    ...windowParams
  );
  const stakeRows = stakeRowsRaw.map((r) => ({
    outcome: r.outcome,
    odds: r.tip_odds,
    source: r.odds_source,
    family: r.family,
  }));
  const roi = computeStakeResults(stakeRows);
  const roiByFamily = computeStakeResultsBy(stakeRows, (r) => r.family);
  const tipBandOne = byOddsBand.find((b) => b.band === '1');
  if (tipBandOne) {
    tipBandOne.roi = roi.yield;
    tipBandOne.staked = roi.staked;
    tipBandOne.avgOdds = roi.avgOdds;
  }

  const recentTips = await db.all(
    `SELECT tr.suggested_bet, tr.confidence_score, tr.outcome, tr.home_goals, tr.away_goals,
            tr.settled_at, tr.tip_odds, tr.odds_band, tr.odds_source, m.match_date,
            ht.name AS home_name, at.name AS away_name, l.name AS league_name,
            l.country AS league_country,
            ht.logo_url AS home_logo, at.logo_url AS away_logo
     FROM tip_results tr
     JOIN matches m ON m.id = tr.match_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     JOIN leagues l ON l.id = m.league_id
     WHERE tr.outcome IN ('hit', 'miss') AND ${windowSql}
     ORDER BY tr.settled_at DESC
     LIMIT 60`,
    ...windowParams
  );
  const recent = recentTips;
  let recentCombos = [];
  try {
    recentCombos = await getRecentComboResults(db, { limit: 40, win });
  } catch (_) {
    recentCombos = [];
  }
  return {
    hits,
    misses,
    pending: Number(totals?.pending || 0),
    voids: Number(totals?.voids || 0),
    decided,
    hitRate: decided ? Number((hits / decided).toFixed(4)) : null,
    windowLabel,
    byFamily: byFamily.map((r) => {
      const h = Number(r.hits || 0);
      const m = Number(r.misses || 0);
      const d = h + m;
      return {
        family: r.family,
        hits: h,
        misses: m,
        hitRate: d ? Number((h / d).toFixed(4)) : null,
        roi: roiByFamily[r.family]?.yield ?? null,
        staked: roiByFamily[r.family]?.staked ?? 0,
      };
    }),
    roi,
    roiByFamily,
    byOddsBand,
    recent,
    recentCombos,
  };
}

export async function updateTeamLogo(db, teamId, logoUrl) {
  if (!teamId || !logoUrl) return;
  await db.run(
    `UPDATE teams SET logo_url = COALESCE(logo_url, ?) WHERE id = ? AND (logo_url IS NULL OR logo_url = '')`,
    logoUrl,
    teamId
  );
}

/** Fill missing logos for all teams (club CDN map or flag). Returns count updated. */
export async function backfillMissingTeamLogos(db, resolveLogo) {
  const rows = await db.all(
    `SELECT id, name, logo_url FROM teams WHERE logo_url IS NULL OR logo_url = ''`
  );
  if (!rows.length) return 0;
  const stmts = [];
  for (const r of rows) {
    const url = resolveLogo(r.name);
    if (!url) continue;
    stmts.push({
      sql: `UPDATE teams SET logo_url = ? WHERE id = ? AND (logo_url IS NULL OR logo_url = '')`,
      params: [url, r.id],
    });
  }
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
  return stmts.length;
}

/** AF-compatible league api_ids only (skip FotMob synthetic namespaces). */
const AF_ODDS_LEAGUE_SQL = `AND l.api_id IN (2, 3, 5, 39, 61, 78, 135, 140, 141)`;

export async function getUpcomingForOddsEnrichment(db, limit = 80, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const lim = Math.max(1, Math.min(120, Number(limit) || 80));
  // Prefer never-attempted odds, then near fixtures; retry partial/no-market
  // attempts after 12h instead of burning free-plan calls every sync.
  return db.all(
    `SELECT m.id, m.match_date, m.api_id AS match_api_id, m.af_fixture_id,
            l.api_id AS league_api_id,
            ht.id AS home_team_id, at.id AS away_team_id,
            ht.name AS home_name, at.name AS away_name,
            ht.logo_url AS home_logo, at.logo_url AS away_logo
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE date(m.match_date) >= date('now')
       AND date(m.match_date) <= date('now', ?)
       AND m.status IN ('scheduled', 'live')
       AND NOT EXISTS (
         SELECT 1 FROM odds recent
         WHERE recent.match_id = m.id
           AND datetime(recent.updated_at) > datetime('now', '-12 hours')
       )
       ${AF_ODDS_LEAGUE_SQL}
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY
       CASE WHEN EXISTS (SELECT 1 FROM odds prior WHERE prior.match_id = m.id) THEN 1 ELSE 0 END ASC,
       CASE WHEN datetime(m.match_date) <= datetime('now', '+3 days') THEN 0 ELSE 1 END ASC,
       m.match_date ASC
     LIMIT ?`,
    endModifier,
    lim
  );
}

export async function setMatchAfFixtureId(db, matchId, afFixtureId) {
  const id = Number(matchId);
  const af = Number(afFixtureId);
  if (!Number.isFinite(id) || !Number.isFinite(af) || af <= 0) return;
  await db.run(`UPDATE matches SET af_fixture_id = ? WHERE id = ?`, af, id);
}

export async function countUpcomingInWindow(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const row = await db.first(
    `SELECT COUNT(*) AS c
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
      WHERE date(m.match_date) >= date('now')
        AND date(m.match_date) <= date('now', ?)
        AND m.status IN ('scheduled', 'live')
        ${ALLOWED_LEAGUE_SQL}`,
    endModifier
  );
  return Number(row?.c || 0);
}

export async function countUpcomingWithOdds(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const row = await db.first(
    `SELECT COUNT(DISTINCT m.id) AS c
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN odds o ON o.match_id = m.id
      WHERE date(m.match_date) >= date('now')
        AND date(m.match_date) <= date('now', ?)
        AND m.status IN ('scheduled', 'live')
        AND (
          o.home_odds IS NOT NULL OR o.draw_odds IS NOT NULL OR o.away_odds IS NOT NULL OR
          o.over25_odds IS NOT NULL OR o.under25_odds IS NOT NULL OR
          o.btts_yes_odds IS NOT NULL OR o.btts_no_odds IS NOT NULL
        )
        ${ALLOWED_LEAGUE_SQL}`,
    endModifier
  );
  return Number(row?.c || 0);
}

const TOP5_LEAGUE_SQL = `AND l.api_id IN (39, 140, 135, 78, 61)`;

export async function countUpcomingTop5(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const row = await db.first(
    `SELECT COUNT(*) AS c
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
      WHERE date(m.match_date) >= date('now')
        AND date(m.match_date) <= date('now', ?)
        AND m.status IN ('scheduled', 'live')
        ${TOP5_LEAGUE_SQL}`,
    endModifier
  );
  return Number(row?.c || 0);
}

export async function countUpcomingTop5WithOdds(db, days = 14) {
  const endModifier = `+${Number(days)} days`;
  const row = await db.first(
    `SELECT COUNT(DISTINCT m.id) AS c
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN odds o ON o.match_id = m.id
      WHERE date(m.match_date) >= date('now')
        AND date(m.match_date) <= date('now', ?)
        AND m.status IN ('scheduled', 'live')
        AND (
          o.home_odds IS NOT NULL OR o.draw_odds IS NOT NULL OR o.away_odds IS NOT NULL OR
          o.over25_odds IS NOT NULL OR o.under25_odds IS NOT NULL OR
          o.btts_yes_odds IS NOT NULL OR o.btts_no_odds IS NOT NULL
        )
        ${TOP5_LEAGUE_SQL}`,
    endModifier
  );
  return Number(row?.c || 0);
}

export async function insertCrestVerification(db, row) {
  await db.run(
    `INSERT INTO crest_verifications (
      league_api_id, team_id, team_api_id, team_name, short_name,
      logo_url, reference_url, reference_source, status, problem, action, evidence, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    row.league_api_id,
    row.team_id ?? null,
    row.team_api_id ?? null,
    row.team_name,
    row.short_name ?? null,
    row.logo_url ?? null,
    row.reference_url ?? null,
    row.reference_source ?? null,
    row.status,
    row.problem ?? null,
    row.action ?? null,
    row.evidence ?? null
  );
}

export async function listCrestVerifications(db, leagueApiId = null, limit = 200) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 200));
  if (leagueApiId != null) {
    return db.all(
      `SELECT * FROM crest_verifications
       WHERE league_api_id = ?
       ORDER BY checked_at DESC, id DESC
       LIMIT ?`,
      Number(leagueApiId),
      lim
    );
  }
  return db.all(
    `SELECT * FROM crest_verifications ORDER BY checked_at DESC, id DESC LIMIT ?`,
    lim
  );
}

/** Rewrite logos that resolve to a better URL (broken AF → FotMob override). */
export async function rewriteBrokenTeamLogos(db, resolveLogo) {
  const rows = await db.all(`SELECT id, name, logo_url FROM teams`);
  if (!rows.length) return 0;
  const stmts = [];
  for (const r of rows) {
    const next = resolveLogo(r.name, r.logo_url);
    if (!next || next === r.logo_url) continue;
    stmts.push({
      sql: `UPDATE teams SET logo_url = ? WHERE id = ?`,
      params: [next, r.id],
    });
  }
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
  return stmts.length;
}

/** Finished AF matches missing an extra stat — for API-Football enrichment. */
export async function getFinishedForStatsEnrichment(db, limit = 120, lookbackDays = 90) {
  const startModifier = `-${Number(lookbackDays)} days`;
  const lim = Math.max(1, Math.min(120, Number(limit) || 50));
  return db.all(
    `SELECT m.id, m.match_date, m.home_goals, m.away_goals,
            l.api_id AS league_api_id,
            ht.name AS home_name, at.name AS away_name,
            ht.id AS home_team_id, at.id AS away_team_id
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN team_stats hs ON hs.match_id = m.id AND hs.team_id = ht.id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL
       AND date(m.match_date) >= date('now', ?)
       AND date(m.match_date) < date('now')
       AND (
         hs.corners_for IS NULL OR hs.yellows_for IS NULL OR hs.shots_for IS NULL
         OR hs.shots_on_target_for IS NULL
       )
       ${AF_ODDS_LEAGUE_SQL}
     ORDER BY m.match_date DESC
     LIMIT ?`,
    startModifier,
    lim
  );
}

/** Finished matches eligible for no-key FotMob extra-stat enrichment. */
export async function getFinishedForFotmobStatsEnrichment(db, limit = 20, lookbackDays = 3) {
  const startModifier = `-${Math.max(1, Number(lookbackDays) || 3)} days`;
  return db.all(
    `SELECT m.id, m.api_id, m.match_date, m.home_goals, m.away_goals,
            ht.name AS home_name, at.name AS away_name,
            ht.id AS home_team_id, at.id AS away_team_id
     FROM matches m
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN team_stats hs ON hs.match_id = m.id AND hs.team_id = ht.id
     WHERE m.status = 'finished'
       AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
       AND date(m.match_date) >= date('now', ?)
       AND date(m.match_date) < date('now')
       AND (
         hs.corners_for IS NULL OR hs.yellows_for IS NULL OR hs.shots_for IS NULL
         OR hs.shots_on_target_for IS NULL
       )
       ${ALLOWED_LEAGUE_SQL}
     ORDER BY m.match_date DESC
     LIMIT ?`,
    startModifier,
    Math.max(1, Math.min(30, Number(limit) || 20))
  );
}

export async function countOddsRows(db) {
  const row = await db.first(
    `SELECT COUNT(DISTINCT match_id) AS c
     FROM odds
     WHERE home_odds IS NOT NULL OR draw_odds IS NOT NULL OR away_odds IS NOT NULL
        OR over25_odds IS NOT NULL OR under25_odds IS NOT NULL
        OR btts_yes_odds IS NOT NULL OR btts_no_odds IS NOT NULL`
  );
  return Number(row?.c || 0);
}

export async function countStatsWithCorners(db) {
  const row = await db.first(
    `SELECT COUNT(*) AS c FROM team_stats WHERE corners_for IS NOT NULL`
  );
  return Number(row?.c || 0);
}

export async function countStatsWithYellows(db) {
  const row = await db.first(
    `SELECT COUNT(*) AS c FROM team_stats WHERE yellows_for IS NOT NULL`
  );
  return Number(row?.c || 0);
}

export async function countStatsWithShotsOnTarget(db) {
  const row = await db.first(
    `SELECT COUNT(*) AS c FROM team_stats WHERE shots_on_target_for IS NOT NULL`
  );
  return Number(row?.c || 0);
}
