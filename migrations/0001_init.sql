-- Copy of src/schema.sql. Apply with: wrangler d1 migrations apply energon

CREATE TABLE IF NOT EXISTS sites (
  slug TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_written_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_files (
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  PRIMARY KEY (slug, path)
);

CREATE TABLE IF NOT EXISTS loose_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_files_slug ON site_files(slug);
CREATE INDEX IF NOT EXISTS idx_loose_files_created ON loose_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_email);
