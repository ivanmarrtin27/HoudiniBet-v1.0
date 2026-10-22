-- Expected goals used by the pre-match model.
-- Kept so the live projection can reuse the same strength instead of refitting it.
ALTER TABLE predictions ADD COLUMN home_xg REAL;
ALTER TABLE predictions ADD COLUMN away_xg REAL;
