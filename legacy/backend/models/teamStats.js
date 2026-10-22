const pool = require('../config/db');

async function upsertStat(stat) {
  await pool.query(
    `INSERT INTO team_stats
      (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against, is_home, match_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       goals_scored = VALUES(goals_scored),
       goals_conceded = VALUES(goals_conceded),
       corners_for = VALUES(corners_for),
       corners_against = VALUES(corners_against),
       is_home = VALUES(is_home),
       match_date = VALUES(match_date)`,
    [
      stat.team_id,
      stat.match_id,
      stat.goals_scored,
      stat.goals_conceded,
      stat.corners_for,
      stat.corners_against,
      stat.is_home ? 1 : 0,
      stat.match_date,
    ]
  );
}

async function lastNForTeam(teamId, n = 5) {
  const [rows] = await pool.query(
    `SELECT * FROM team_stats WHERE team_id = ? ORDER BY match_date DESC LIMIT ?`,
    [teamId, n]
  );
  return rows;
}

async function leagueGoalAverages(leagueId) {
  const [rows] = await pool.query(
    `SELECT
       AVG(CASE WHEN ts.is_home = 1 THEN ts.goals_scored END) AS avg_home_scored,
       AVG(CASE WHEN ts.is_home = 0 THEN ts.goals_scored END) AS avg_away_scored,
       AVG(ts.goals_scored) AS avg_scored,
       AVG(ts.goals_conceded) AS avg_conceded,
       AVG(ts.corners_for) AS avg_corners_for,
       AVG(ts.corners_against) AS avg_corners_against
     FROM team_stats ts
     JOIN matches m ON m.id = ts.match_id
     WHERE m.league_id = ?`,
    [leagueId]
  );
  const r = rows[0] || {};
  return {
    avgHomeScored: Number(r.avg_home_scored) || 1.35,
    avgAwayScored: Number(r.avg_away_scored) || 1.15,
    avgScored: Number(r.avg_scored) || 1.25,
    avgConceded: Number(r.avg_conceded) || 1.25,
    avgCornersFor: Number(r.avg_corners_for) || 5.0,
    avgCornersAgainst: Number(r.avg_corners_against) || 5.0,
  };
}

function formFromStats(stats) {
  return stats.map((s) => {
    if (s.goals_scored > s.goals_conceded) return 'W';
    if (s.goals_scored < s.goals_conceded) return 'L';
    return 'D';
  });
}

module.exports = { upsertStat, lastNForTeam, leagueGoalAverages, formFromStats };
