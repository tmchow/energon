-- Rename stored write_policy from instance to org.
-- CREATE / ADD COLUMN are not idempotent. If these rows are already org, this is a no-op.
-- The Worker also rewrites via ensureSchema — see "Migrations after a deploy" in docs/DEPLOY.md.
UPDATE sites SET write_policy = 'org' WHERE write_policy = 'instance';
UPDATE loose_files SET write_policy = 'org' WHERE write_policy = 'instance';
