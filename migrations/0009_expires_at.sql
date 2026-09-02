-- Per-object expiry. NULL means keep until someone deletes it (only valid
-- when the instance allows unlimited retention). ISO-8601 UTC, compared as text.
-- CREATE / ADD COLUMN are not idempotent. If expires_at already exists, the
-- Worker added it via ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE sites ADD COLUMN expires_at TEXT;
ALTER TABLE loose_files ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sites_expires_at ON sites(expires_at);
CREATE INDEX IF NOT EXISTS idx_loose_expires_at ON loose_files(expires_at);
