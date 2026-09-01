-- Per-object expiry. NULL means keep until someone deletes it (only valid
-- when the instance allows unlimited retention). ISO-8601 UTC, compared as text.
-- CREATE / ADD COLUMN are not idempotent. If expires_at already exists, stamp
-- this file in d1_migrations instead of applying it.
ALTER TABLE sites ADD COLUMN expires_at TEXT;
ALTER TABLE loose_files ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sites_expires_at ON sites(expires_at);
CREATE INDEX IF NOT EXISTS idx_loose_expires_at ON loose_files(expires_at);
