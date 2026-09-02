-- Recoverable token secret for the Access-gated hub. Auth still uses token_hash.
-- SQLite cannot ADD COLUMN IF NOT EXISTS. If apply fails with
-- "duplicate column name: token_secret", the Worker already added it via
-- ensureSchema. Record it by hand — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE tokens ADD COLUMN token_secret TEXT;
