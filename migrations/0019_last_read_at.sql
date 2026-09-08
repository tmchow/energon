-- When the Worker last served this site's or file's bytes (public URL or /v1).
-- NULL means never read since this column existed. Best effort and throttled,
-- so a value is a floor: public reads answered from the edge cache never reach
-- the Worker and are not counted.
-- CREATE / ADD COLUMN are not idempotent. If apply fails with
-- "duplicate column name: last_read_at", the Worker already added it via
-- ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE sites ADD COLUMN last_read_at TEXT;
ALTER TABLE loose_files ADD COLUMN last_read_at TEXT;
