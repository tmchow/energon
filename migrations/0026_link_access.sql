ALTER TABLE sites ADD COLUMN link_access TEXT NOT NULL DEFAULT 'public';
ALTER TABLE loose_files ADD COLUMN link_access TEXT NOT NULL DEFAULT 'public';
ALTER TABLE upload_grants ADD COLUMN file_link_access TEXT;
