-- Shots on target (SOT) kept separate from total shots.
ALTER TABLE team_stats ADD COLUMN shots_on_target_for INTEGER;
ALTER TABLE team_stats ADD COLUMN shots_on_target_against INTEGER;

ALTER TABLE odds ADD COLUMN sot_over75_odds REAL;
ALTER TABLE odds ADD COLUMN sot_under75_odds REAL;
ALTER TABLE odds ADD COLUMN sot_over85_odds REAL;
ALTER TABLE odds ADD COLUMN sot_under85_odds REAL;
ALTER TABLE odds ADD COLUMN sot_over95_odds REAL;
ALTER TABLE odds ADD COLUMN sot_under95_odds REAL;

ALTER TABLE predictions ADD COLUMN sot_over75_prob REAL;
ALTER TABLE predictions ADD COLUMN sot_under75_prob REAL;
ALTER TABLE predictions ADD COLUMN sot_over85_prob REAL;
ALTER TABLE predictions ADD COLUMN sot_under85_prob REAL;
ALTER TABLE predictions ADD COLUMN sot_over95_prob REAL;
ALTER TABLE predictions ADD COLUMN sot_under95_prob REAL;
