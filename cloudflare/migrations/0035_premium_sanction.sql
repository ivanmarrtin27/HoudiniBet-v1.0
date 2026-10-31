-- Flag shown once after admin Premium revoke with sanction.
ALTER TABLE users ADD COLUMN premium_sanction_at TEXT NULL;
