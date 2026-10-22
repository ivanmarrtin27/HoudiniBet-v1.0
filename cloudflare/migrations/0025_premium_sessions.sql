CREATE TABLE IF NOT EXISTS premium_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  premium_until TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  amount_total INTEGER,
  currency TEXT
);

CREATE INDEX IF NOT EXISTS idx_premium_sessions_until ON premium_sessions(premium_until);
