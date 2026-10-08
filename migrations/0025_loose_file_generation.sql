ALTER TABLE loose_files ADD COLUMN content_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE upload_grants ADD COLUMN expected_version INTEGER;
