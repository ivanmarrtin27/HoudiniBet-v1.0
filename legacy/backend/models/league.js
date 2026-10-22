const pool = require('../config/db');

async function upsertByApiId({ name, country, logo_url, api_id }) {
  const [existing] = await pool.query('SELECT id FROM leagues WHERE api_id = ?', [api_id]);
  if (existing.length) {
    await pool.query(
      'UPDATE leagues SET name = ?, country = ?, logo_url = COALESCE(?, logo_url) WHERE api_id = ?',
      [name, country, logo_url, api_id]
    );
    return existing[0].id;
  }
  const [result] = await pool.query(
    'INSERT INTO leagues (name, country, logo_url, api_id) VALUES (?, ?, ?, ?)',
    [name, country, logo_url, api_id]
  );
  return result.insertId;
}

async function findByApiId(apiId) {
  const [rows] = await pool.query('SELECT * FROM leagues WHERE api_id = ?', [apiId]);
  return rows[0] || null;
}

async function listAll() {
  const [rows] = await pool.query('SELECT * FROM leagues ORDER BY name');
  return rows;
}

module.exports = { upsertByApiId, findByApiId, listAll };
