-- Public handle for password users (password managers). NULL OK for Google-only accounts.
ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
