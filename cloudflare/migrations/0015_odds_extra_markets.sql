-- Extra book markets for tip_odds / value (BTTS + O/U 1.5 / 3.5)
ALTER TABLE odds ADD COLUMN over15_odds REAL;
ALTER TABLE odds ADD COLUMN under15_odds REAL;
ALTER TABLE odds ADD COLUMN over35_odds REAL;
ALTER TABLE odds ADD COLUMN under35_odds REAL;
ALTER TABLE odds ADD COLUMN btts_yes_odds REAL;
ALTER TABLE odds ADD COLUMN btts_no_odds REAL;
