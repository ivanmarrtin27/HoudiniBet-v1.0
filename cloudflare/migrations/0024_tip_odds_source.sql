ALTER TABLE tip_results ADD COLUMN odds_source TEXT;

CREATE INDEX IF NOT EXISTS idx_tip_results_odds_source ON tip_results(odds_source);

ALTER TABLE combo_results ADD COLUMN odds_source TEXT;

CREATE INDEX IF NOT EXISTS idx_combo_results_odds_source ON combo_results(odds_source);
