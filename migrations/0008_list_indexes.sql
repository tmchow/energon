CREATE INDEX IF NOT EXISTS idx_sites_created_by ON sites(created_by);
CREATE INDEX IF NOT EXISTS idx_sites_written_by ON sites(last_written_by);
CREATE INDEX IF NOT EXISTS idx_sites_updated_slug ON sites(updated_at DESC, handle DESC, slug DESC);
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);
CREATE INDEX IF NOT EXISTS idx_loose_created_by ON loose_files(created_by);
CREATE INDEX IF NOT EXISTS idx_loose_written_by ON loose_files(last_written_by);
CREATE INDEX IF NOT EXISTS idx_loose_updated_id ON loose_files(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_loose_filename ON loose_files(filename);
