-- Per-token expiry chosen at mint. NULL means never expires; every row that
-- predates this column is NULL, so existing tokens keep working.
-- CREATE / ADD COLUMN are not idempotent. If apply fails with
-- "duplicate column name: expires_at", the Worker already added it via
-- ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE tokens ADD COLUMN expires_at TEXT;
