-- Per-object write password (guest PUT / site-path DELETE) and a marker
-- for hub copy when the last mutation used that door.
-- CREATE / ADD COLUMN are not idempotent. If these columns already exist, the
-- Worker added them via ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE sites ADD COLUMN write_password_hash TEXT;
ALTER TABLE sites ADD COLUMN written_via TEXT;
ALTER TABLE loose_files ADD COLUMN write_password_hash TEXT;
ALTER TABLE loose_files ADD COLUMN written_via TEXT;
