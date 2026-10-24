-- Total goals O/U 0.5 and 4.5 (model probs + book odds) + odds fetch timestamp
ALTER TABLE predictions ADD COLUMN over05_prob REAL;
ALTER TABLE predictions ADD COLUMN under05_prob REAL;
ALTER TABLE predictions ADD COLUMN over45_prob REAL;
ALTER TABLE predictions ADD COLUMN under45_prob REAL;

ALTER TABLE odds ADD COLUMN over05_odds REAL;
ALTER TABLE odds ADD COLUMN under05_odds REAL;
ALTER TABLE odds ADD COLUMN over45_odds REAL;
ALTER TABLE odds ADD COLUMN under45_odds REAL;
ALTER TABLE odds ADD COLUMN fetched_at TEXT;
