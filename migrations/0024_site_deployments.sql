ALTER TABLE sites ADD COLUMN active_version_id TEXT;
ALTER TABLE sites ADD COLUMN content_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'live';
ALTER TABLE sites ADD COLUMN conversion_state TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE upload_grants ADD COLUMN deployment_id TEXT;
ALTER TABLE upload_grants ADD COLUMN deployment_intent_hash TEXT;
ALTER TABLE upload_grants ADD COLUMN deployment_base_generation INTEGER;
ALTER TABLE upload_grants ADD COLUMN receipt_expires_at TEXT;

CREATE TABLE IF NOT EXISTS site_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'candidate',
  manifest_hash TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  superseded_at TEXT,
  cleanup_owner TEXT,
  cleanup_started_at TEXT
);

CREATE TABLE IF NOT EXISTS site_version_files (
  version_id TEXT NOT NULL,
  path TEXT NOT NULL,
  allocation_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK (size >= 0),
  sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  PRIMARY KEY (version_id, path)
);

CREATE TABLE IF NOT EXISTS site_deployments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version_id TEXT NOT NULL UNIQUE,
  base_generation INTEGER NOT NULL,
  mode TEXT NOT NULL,
  input_json TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading',
  created_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  prepare_cursor TEXT,
  prepare_owner TEXT,
  prepare_expires_at TEXT,
  commit_attempt TEXT,
  terminal_at TEXT,
  receipt_expires_at TEXT,
  receipt_json TEXT,
  last_error TEXT,
  UNIQUE (owner_id, site_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS site_operation_leases (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  generation TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_allocations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  site_id TEXT,
  version_id TEXT,
  deployment_id TEXT,
  kind TEXT NOT NULL,
  object_key TEXT UNIQUE,
  multipart_id TEXT,
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= 0),
  actual_bytes INTEGER CHECK (actual_bytes >= 0),
  result_sha256 TEXT,
  recovery_json TEXT,
  state TEXT NOT NULL DEFAULT 'reserved',
  attempt_id TEXT NOT NULL,
  writer_expires_at TEXT,
  quiesced_at TEXT,
  cleanup_owner TEXT,
  cleanup_started_at TEXT,
  deleted_at TEXT,
  released_at TEXT,
  cleanup_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_conversions (
  site_id TEXT PRIMARY KEY,
  deployment_id TEXT,
  phase TEXT NOT NULL,
  cursor TEXT,
  inventory_json TEXT,
  owner TEXT,
  owner_expires_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_versions_site ON site_versions(site_id, state);
CREATE INDEX IF NOT EXISTS idx_site_versions_cleanup ON site_versions(state, superseded_at);
CREATE INDEX IF NOT EXISTS idx_site_deployments_deadline ON site_deployments(state, deadline);
CREATE INDEX IF NOT EXISTS idx_site_deployments_receipt ON site_deployments(receipt_expires_at);
CREATE INDEX IF NOT EXISTS idx_site_leases_version ON site_operation_leases(version_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_allocations_version ON storage_allocations(version_id, state);
CREATE INDEX IF NOT EXISTS idx_allocations_deployment ON storage_allocations(deployment_id, state);
CREATE INDEX IF NOT EXISTS idx_allocations_cleanup ON storage_allocations(state, writer_expires_at);
CREATE INDEX IF NOT EXISTS idx_allocations_legacy_recovery ON storage_allocations(json_extract(recovery_json, '$.fileId')) WHERE kind = 'legacy_reservation' AND state != 'released';

CREATE TRIGGER IF NOT EXISTS site_version_files_insert_guard
BEFORE INSERT ON site_version_files
WHEN NOT EXISTS (SELECT 1 FROM site_versions WHERE id = NEW.version_id AND state = 'candidate')
BEGIN SELECT RAISE(ABORT, 'version catalog is sealed'); END;

CREATE TRIGGER IF NOT EXISTS site_version_files_update_guard
BEFORE UPDATE ON site_version_files
BEGIN SELECT RAISE(ABORT, 'version files are immutable'); END;

CREATE TRIGGER IF NOT EXISTS site_version_files_delete_guard
BEFORE DELETE ON site_version_files
WHEN EXISTS (SELECT 1 FROM site_versions WHERE id = OLD.version_id AND state != 'retiring')
BEGIN SELECT RAISE(ABORT, 'version has not retired'); END;

CREATE TRIGGER IF NOT EXISTS site_deployments_intent_guard
BEFORE UPDATE OF site_id, owner_id, version_id, base_generation, mode, input_json, intent_hash, idempotency_key, created_at ON site_deployments
BEGIN SELECT RAISE(ABORT, 'deployment intent is immutable'); END;
