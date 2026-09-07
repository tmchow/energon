-- Recoverable share/write phrases for the Access-gated Hub. Gate still uses the hashes.
-- CREATE / ADD COLUMN are not idempotent. If these columns already exist, the
-- Worker added them via ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
ALTER TABLE sites ADD COLUMN password_secret TEXT;
ALTER TABLE sites ADD COLUMN write_password_secret TEXT;
ALTER TABLE loose_files ADD COLUMN password_secret TEXT;
ALTER TABLE loose_files ADD COLUMN write_password_secret TEXT;
