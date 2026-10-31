-- Link premium_sessions to auth users (admin plan display + account-bound Premium).
ALTER TABLE premium_sessions ADD COLUMN user_id TEXT;
ALTER TABLE premium_sessions ADD COLUMN premium_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_premium_sessions_user ON premium_sessions(user_id);
