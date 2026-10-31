-- Promo codes for Premium grants (e.g. HOUDINI7 = 7 days).
CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(code);

INSERT OR IGNORE INTO promo_codes (code, days, max_redemptions, redeemed_count, active, expires_at, created_at)
VALUES ('HOUDINI7', 7, NULL, 0, 1, NULL, datetime('now'));
