-- Admin can close access without deleting the account.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
