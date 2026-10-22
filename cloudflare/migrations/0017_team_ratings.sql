-- Dynamic attack/defense ratings (Kalman-lite) per team × league.
CREATE TABLE IF NOT EXISTS team_ratings (
  team_id INTEGER NOT NULL,
  league_id INTEGER NOT NULL,
  attack REAL NOT NULL DEFAULT 1.0,
  defense REAL NOT NULL DEFAULT 1.0,
  var_att REAL NOT NULL DEFAULT 0.08,
  var_def REAL NOT NULL DEFAULT 0.08,
  n_obs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (team_id, league_id)
);
CREATE INDEX IF NOT EXISTS idx_team_ratings_league ON team_ratings(league_id);
