const pool = require('../config/db');

async function upsertByApiId({ name, logo_url, league_id, api_id }) {
  const [existing] = await pool.query('SELECT id FROM teams WHERE api_id = ?', [api_id]);
  if (existing.length) {
    await pool.query(
      'UPDATE teams SET name = ?, logo_url = COALESCE(?, logo_url), league_id = ? WHERE api_id = ?',
      [name, logo_url, league_id, api_id]
    );
    return existing[0].id;
  }
  const [result] = await pool.query(
    'INSERT INTO teams (name, logo_url, league_id, api_id) VALUES (?, ?, ?, ?)',
    [name, logo_url, league_id, api_id]
  );
  return result.insertId;
}

async function searchByName(query, limit = 15) {
  const like = `%${query}%`;
  const [rows] = await pool.query(
    `SELECT t.*, l.name AS league_name
     FROM teams t
     JOIN leagues l ON l.id = t.league_id
     WHERE t.name LIKE ?
     ORDER BY t.name
     LIMIT ?`,
    [like, limit]
  );
  return rows;
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT t.*, l.name AS league_name
     FROM teams t
     JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { upsertByApiId, searchByName, findById };
