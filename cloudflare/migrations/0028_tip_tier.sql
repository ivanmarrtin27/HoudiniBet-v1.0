-- Distinguish playable Stats tips from display-only suggested_bet (UI %).
ALTER TABLE predictions ADD COLUMN tip_tier TEXT;
