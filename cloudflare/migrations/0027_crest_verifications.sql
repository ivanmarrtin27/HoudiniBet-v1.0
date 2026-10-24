-- Independent crest audit history (per league / team)
CREATE TABLE IF NOT EXISTS crest_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_api_id INTEGER NOT NULL,
  team_id INTEGER,
  team_api_id INTEGER,
  team_name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  reference_url TEXT,
  reference_source TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified', 'mismatch', 'pending', 'broken')),
  problem TEXT,
  action TEXT,
  evidence TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_crest_verifications_league
  ON crest_verifications (league_api_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_crest_verifications_team
  ON crest_verifications (team_api_id, checked_at DESC);
