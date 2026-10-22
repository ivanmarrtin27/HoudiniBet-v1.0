-- Corners / yellow cards O/U book lines for tip value
ALTER TABLE odds ADD COLUMN corners_over85_odds REAL;
ALTER TABLE odds ADD COLUMN corners_under85_odds REAL;
ALTER TABLE odds ADD COLUMN corners_over95_odds REAL;
ALTER TABLE odds ADD COLUMN corners_under95_odds REAL;
ALTER TABLE odds ADD COLUMN corners_over105_odds REAL;
ALTER TABLE odds ADD COLUMN corners_under105_odds REAL;
ALTER TABLE odds ADD COLUMN cards_over35_odds REAL;
ALTER TABLE odds ADD COLUMN cards_under35_odds REAL;
ALTER TABLE odds ADD COLUMN cards_over45_odds REAL;
ALTER TABLE odds ADD COLUMN cards_under45_odds REAL;
