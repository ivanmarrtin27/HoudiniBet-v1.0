const pool = require('../config/db');

async function upsertPrediction(p) {
  await pool.query(
    `INSERT INTO predictions (
      match_id, home_win_prob, draw_prob, away_win_prob,
      over15_prob, under15_prob, over25_prob, under25_prob, over35_prob, under35_prob,
      btts_yes_prob, btts_no_prob,
      corners_over95_prob, corners_under95_prob,
      suggested_bet, secondary_bet, confidence_score, value_edge, value_market
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      home_win_prob = VALUES(home_win_prob),
      draw_prob = VALUES(draw_prob),
      away_win_prob = VALUES(away_win_prob),
      over15_prob = VALUES(over15_prob),
      under15_prob = VALUES(under15_prob),
      over25_prob = VALUES(over25_prob),
      under25_prob = VALUES(under25_prob),
      over35_prob = VALUES(over35_prob),
      under35_prob = VALUES(under35_prob),
      btts_yes_prob = VALUES(btts_yes_prob),
      btts_no_prob = VALUES(btts_no_prob),
      corners_over95_prob = VALUES(corners_over95_prob),
      corners_under95_prob = VALUES(corners_under95_prob),
      suggested_bet = VALUES(suggested_bet),
      secondary_bet = VALUES(secondary_bet),
      confidence_score = VALUES(confidence_score),
      value_edge = VALUES(value_edge),
      value_market = VALUES(value_market),
      created_at = CURRENT_TIMESTAMP`,
    [
      p.match_id,
      p.home_win_prob,
      p.draw_prob,
      p.away_win_prob,
      p.over15_prob,
      p.under15_prob,
      p.over25_prob,
      p.under25_prob,
      p.over35_prob,
      p.under35_prob,
      p.btts_yes_prob,
      p.btts_no_prob,
      p.corners_over95_prob,
      p.corners_under95_prob,
      p.suggested_bet,
      p.secondary_bet,
      p.confidence_score,
      p.value_edge,
      p.value_market,
    ]
  );
}

async function getByMatchId(matchId) {
  const [rows] = await pool.query('SELECT * FROM predictions WHERE match_id = ?', [matchId]);
  return rows[0] || null;
}

async function getBestBets(limit = 40, days = 14) {
  const [rows] = await pool.query(
    `SELECT p.*,
       m.match_date, m.status, m.league_id,
       l.name AS league_name,
       ht.name AS home_name, ht.logo_url AS home_logo,
       at.name AS away_name, at.logo_url AS away_logo
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN leagues l ON l.id = m.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE DATE(m.match_date) >= CURDATE()
       AND DATE(m.match_date) <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       AND m.status IN ('scheduled', 'live')
     ORDER BY p.confidence_score DESC
     LIMIT ?`,
    [days, limit]
  );
  return rows;
}

async function upsertOdds(odds) {
  await pool.query(
    `INSERT INTO odds (match_id, bookmaker, home_odds, draw_odds, away_odds, over25_odds, under25_odds)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       home_odds = VALUES(home_odds),
       draw_odds = VALUES(draw_odds),
       away_odds = VALUES(away_odds),
       over25_odds = VALUES(over25_odds),
       under25_odds = VALUES(under25_odds)`,
    [
      odds.match_id,
      odds.bookmaker || 'avg',
      odds.home_odds,
      odds.draw_odds,
      odds.away_odds,
      odds.over25_odds,
      odds.under25_odds,
    ]
  );
}

async function getOddsForMatch(matchId) {
  const [rows] = await pool.query('SELECT * FROM odds WHERE match_id = ? LIMIT 1', [matchId]);
  return rows[0] || null;
}

module.exports = {
  upsertPrediction,
  getByMatchId,
  getBestBets,
  upsertOdds,
  getOddsForMatch,
};
