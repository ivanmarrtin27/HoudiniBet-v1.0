-- First-party page hits (beacon) for admin IP/path visibility. Retention enforced in app (30d).

CREATE TABLE IF NOT EXISTS page_hits (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  path TEXT NOT NULL,
  country TEXT,
  ua TEXT,
  host TEXT,
  referrer_host TEXT
);

CREATE INDEX IF NOT EXISTS idx_page_hits_created ON page_hits(created_at);
CREATE INDEX IF NOT EXISTS idx_page_hits_ip_path_created ON page_hits(ip, path, created_at);
