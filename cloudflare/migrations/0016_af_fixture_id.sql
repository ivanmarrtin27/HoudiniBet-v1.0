-- API-Football fixture id for direct /odds lookups (FD/FotMob use other api_id namespaces).
ALTER TABLE matches ADD COLUMN af_fixture_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_matches_af_fixture ON matches(af_fixture_id);
