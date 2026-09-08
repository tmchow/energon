-- When the Worker last served this site's or file's bytes (public URL or /v1).
-- NULL means never read since this column existed. Best effort and throttled,
-- so a value is a floor, not a view count: public reads answered from the edge
-- cache do not reach the Worker. The edge cache holds public responses for at
-- most a day, so the stamp lags real reads by at most about a day plus the
-- hourly throttle.
-- CREATE / ADD COLUMN are not idempotent. If apply fails with
-- "duplicate column name: last_read_at", the Worker already added it via
-- ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE sites ADD COLUMN last_read_at TEXT;
ALTER TABLE loose_files ADD COLUMN last_read_at TEXT;
