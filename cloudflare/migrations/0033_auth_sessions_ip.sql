-- Track client IP on auth sessions for admin last-login display.
ALTER TABLE auth_sessions ADD COLUMN ip TEXT;
