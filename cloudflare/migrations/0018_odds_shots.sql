-- Shots O/U book lines + prediction probs (total shots tip market)
ALTER TABLE odds ADD COLUMN shots_over225_odds REAL;
ALTER TABLE odds ADD COLUMN shots_under225_odds REAL;
ALTER TABLE odds ADD COLUMN shots_over255_odds REAL;
ALTER TABLE odds ADD COLUMN shots_under255_odds REAL;

ALTER TABLE predictions ADD COLUMN shots_over225_prob REAL;
ALTER TABLE predictions ADD COLUMN shots_under225_prob REAL;
ALTER TABLE predictions ADD COLUMN shots_over255_prob REAL;
ALTER TABLE predictions ADD COLUMN shots_under255_prob REAL;
