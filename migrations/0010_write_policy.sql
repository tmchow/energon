-- Per-object write policy. Existing rows stay instance (any token can
-- mutate) so company coworkers keep access to already-published objects.
-- Unset instance default for NEW objects is owner (public-safe).
-- CREATE / ADD COLUMN are not idempotent. If write_policy already exists,
-- stamp this file in d1_migrations instead of applying it.
ALTER TABLE sites ADD COLUMN write_policy TEXT NOT NULL DEFAULT 'instance';
ALTER TABLE loose_files ADD COLUMN write_policy TEXT NOT NULL DEFAULT 'instance';
