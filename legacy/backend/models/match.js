const pool = require('../config/db');

function mapMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    matchDate: row.match_date,
    status: row.status,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    apiId: row.api_id,
    homeTeam: { id: row.home_team_id, name: row.home_name, logo: row.home_logo },
    awayTeam: { id: row.away_team_id, name: row.away_name, logo: row.away_logo },
  };
}

const MATCH_SELECT = `
  SELECT m.*,
    l.name AS league_name,
    ht.name AS home_name, ht.logo_url AS home_logo,
    at.name AS away_name, at.logo_url AS away_logo
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  JOIN teams ht ON ht.id = m.home_team_id
  JOIN teams at ON at.id = m.away_team_id
`;

async function upsertFixture(fixture) {
  const [existing] = await pool.query('SELECT id FROM matches WHERE api_id = ?', [fixture.api_id]);
  if (existing.length) {
    await pool.query(
      `UPDATE matches SET league_id=?, home_team_id=?, away_team_id=?, match_date=?,
       status=?, home_goals=?, away_goals=? WHERE api_id=?`,
      [
        fixture.league_id,
        fixture.home_team_id,
        fixture.away_team_id,
        fixture.match_date,
        fixture.status,
        fixture.home_goals,
        fixture.away_goals,
        fixture.api_id,
      ]
    );
    return existing[0].id;
  }
  const [result] = await pool.query(
    `INSERT INTO matches
      (league_id, home_team_id, away_team_id, match_date, status, home_goals, away_goals, api_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fixture.league_id,
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.match_date,
      fixture.status,
      fixture.home_goals,
      fixture.away_goals,
      fixture.api_id,
    ]
  );
  return result.insertId;
}

async function getToday(leagueId = null) {
  let sql = `${MATCH_SELECT} WHERE DATE(m.match_date) = CURDATE()`;
  const params = [];
  if (leagueId) {
    sql += ' AND m.league_id = ?';
    params.push(leagueId);
  }
  sql += ' ORDER BY m.match_date ASC';
  const [rows] = await pool.query(sql, params);
  return rows.map(mapMatch);
}

async function findById(id) {
  const [rows] = await pool.query(`${MATCH_SELECT} WHERE m.id = ?`, [id]);
  return mapMatch(rows[0]);
}

async function getScheduledTodayIds() {
  const [rows] = await pool.query(
    `SELECT id FROM matches WHERE DATE(match_date) = CURDATE() AND status = 'scheduled'`
  );
  return rows.map((r) => r.id);
}

async function getNextForTeam(teamId) {
  const [rows] = await pool.query(
    `${MATCH_SELECT}
     WHERE (m.home_team_id = ? OR m.away_team_id = ?)
       AND m.status IN ('scheduled', 'live')
       AND m.match_date >= NOW()
     ORDER BY m.match_date ASC
     LIMIT 1`,
    [teamId, teamId]
  );
  return mapMatch(rows[0]);
}

module.exports = {
  upsertFixture,
  getToday,
  findById,
  getScheduledTodayIds,
  getNextForTeam,
  mapMatch,
};
