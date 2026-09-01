-- Optional share password on published sites and loose files.
ALTER TABLE sites ADD COLUMN password_hash TEXT;
ALTER TABLE loose_files ADD COLUMN password_hash TEXT;
