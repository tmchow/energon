-- Sites gain a stable capability id (same shape as loose file ids).
-- site_files rekey from (handle, slug, path) to (site_id, path).
-- CREATE / ADD COLUMN are not idempotent. Stamp 0018 after apply.
-- A 0005-shaped DB that has not run this file still starts via ensureSchema
-- (additive id / site_id columns). This rebuild is the clean pre-launch shape.

ALTER TABLE sites ADD COLUMN id TEXT;

UPDATE sites SET id = lower(hex(randomblob(3))) WHERE id IS NULL OR id = '';

CREATE TABLE sites_new (
  id TEXT NOT NULL PRIMARY KEY,
  handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  password_hash TEXT,
  password_secret TEXT,
  expires_at TEXT,
  write_policy TEXT NOT NULL DEFAULT 'org',
  write_password_hash TEXT,
  write_password_secret TEXT,
  written_via TEXT
);

INSERT INTO sites_new (
  id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by,
  password_hash, password_secret, expires_at, write_policy,
  write_password_hash, write_password_secret, written_via
)
SELECT
  id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by,
  password_hash, password_secret, expires_at, write_policy,
  write_password_hash, write_password_secret, written_via
FROM sites;

DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;

CREATE TABLE site_files_new (
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  PRIMARY KEY (site_id, path)
);

INSERT INTO site_files_new (site_id, path, size, content_type, updated_at, last_written_by)
SELECT s.id, f.path, f.size, f.content_type, f.updated_at, f.last_written_by
FROM site_files f
JOIN sites s ON s.handle = f.handle AND s.slug = f.slug;

DROP TABLE site_files;
ALTER TABLE site_files_new RENAME TO site_files;

CREATE INDEX IF NOT EXISTS idx_site_files_site ON site_files(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_files_id_path ON site_files(site_id, path);
CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_id);
CREATE INDEX IF NOT EXISTS idx_sites_created_by ON sites(created_by);
CREATE INDEX IF NOT EXISTS idx_sites_written_by ON sites(last_written_by);
CREATE INDEX IF NOT EXISTS idx_sites_updated_slug ON sites(updated_at DESC, handle DESC, slug DESC);
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);
CREATE INDEX IF NOT EXISTS idx_sites_expires_at ON sites(expires_at);
