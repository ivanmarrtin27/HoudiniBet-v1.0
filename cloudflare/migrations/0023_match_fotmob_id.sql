-- FotMob match id resolved by name for rows coming from other feeds
-- (FixtureDownload domestic leagues). Used to read live score and incidents.
ALTER TABLE matches ADD COLUMN fotmob_match_id INTEGER;
