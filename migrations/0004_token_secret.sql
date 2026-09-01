-- Recoverable token secret for the Access-gated hub. Auth still uses token_hash.
-- SQLite cannot ADD COLUMN IF NOT EXISTS. If apply fails with
-- "duplicate column name: token_secret", the Worker already added it via
-- ensureSchema. Stamp this file in d1_migrations and continue — see README.
ALTER TABLE tokens ADD COLUMN token_secret TEXT;
