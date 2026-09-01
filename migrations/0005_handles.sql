-- Rebuilds sites/site_files onto PRIMARY KEY (handle, slug).
-- Do not apply this on a database that already has sites.handle (ensureSchema
-- adds that column without changing the PK). Stamp 0005 instead; a rebuild
-- would rewrite published handles from email and can 404 old URLs.
CREATE TABLE IF NOT EXISTS handles (
  email TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE sites_new (
  handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  password_hash TEXT,
  PRIMARY KEY (handle, slug)
);

INSERT INTO sites_new (handle, slug, created_at, updated_at, created_by, last_written_by, password_hash)
SELECT
  lower(replace(substr(created_by, 1, instr(created_by, '@') - 1), '.', '-')),
  slug, created_at, updated_at, created_by, last_written_by, password_hash
FROM sites;

DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;

CREATE TABLE site_files_new (
  handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  PRIMARY KEY (handle, slug, path)
);

INSERT INTO site_files_new (handle, slug, path, size, content_type, updated_at, last_written_by)
SELECT s.handle, f.slug, f.path, f.size, f.content_type, f.updated_at, f.last_written_by
FROM site_files f
JOIN sites s ON s.slug = f.slug;

DROP TABLE site_files;
ALTER TABLE site_files_new RENAME TO site_files;

ALTER TABLE loose_files ADD COLUMN handle TEXT;

CREATE INDEX IF NOT EXISTS idx_site_files_site ON site_files(handle, slug);
CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_handles_handle ON handles(handle);
