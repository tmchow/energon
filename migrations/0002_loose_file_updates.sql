-- Living loose files: same id can be replaced.
ALTER TABLE loose_files ADD COLUMN updated_at TEXT;
ALTER TABLE loose_files ADD COLUMN last_written_by TEXT;
