CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  idp_sub TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS handle_reservations (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  active_version_id TEXT,
  content_generation INTEGER NOT NULL DEFAULT 0,
  lifecycle_state TEXT NOT NULL DEFAULT 'live',
  conversion_state TEXT NOT NULL DEFAULT 'legacy',
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  password_hash TEXT,
  password_secret TEXT,
  expires_at TEXT,
  write_policy TEXT NOT NULL DEFAULT 'org',
  write_password_hash TEXT,
  write_password_secret TEXT,
  written_via TEXT,
  last_read_at TEXT
);

CREATE TABLE IF NOT EXISTS site_files (
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_written_by TEXT NOT NULL,
  PRIMARY KEY (site_id, path)
);

CREATE TABLE IF NOT EXISTS loose_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT,
  last_written_by TEXT,
  password_hash TEXT,
  password_secret TEXT,
  handle TEXT,
  owner_id TEXT,
  expires_at TEXT,
  write_policy TEXT NOT NULL DEFAULT 'org',
  write_password_hash TEXT,
  write_password_secret TEXT,
  written_via TEXT,
  last_read_at TEXT,
  content_generation INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_id TEXT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_secret TEXT,
  token_hint TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  expires_at TEXT,
  scope TEXT NOT NULL DEFAULT 'account'
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  token_id TEXT,
  token_hint TEXT,
  action TEXT NOT NULL,
  executed INTEGER NOT NULL,
  action_kind TEXT,
  ttl TEXT,
  target_json TEXT NOT NULL,
  matched INTEGER,
  eligible INTEGER,
  applied INTEGER,
  skipped INTEGER,
  failed INTEGER,
  bytes INTEGER,
  confirm TEXT
);

CREATE TABLE IF NOT EXISTS gate_attempts (
  scope TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_files_site ON site_files(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_files_id_path ON site_files(site_id, path);
CREATE INDEX IF NOT EXISTS idx_loose_files_created ON loose_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_idp_sub ON users(idp_sub);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique ON users(handle);
CREATE INDEX IF NOT EXISTS idx_handle_reservations_user ON handle_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_id);
CREATE INDEX IF NOT EXISTS idx_loose_files_owner ON loose_files(owner_id);
CREATE INDEX IF NOT EXISTS idx_sites_created_by ON sites(created_by);
CREATE INDEX IF NOT EXISTS idx_sites_written_by ON sites(last_written_by);
CREATE INDEX IF NOT EXISTS idx_sites_updated_slug ON sites(updated_at DESC, handle DESC, slug DESC);
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);
CREATE INDEX IF NOT EXISTS idx_loose_created_by ON loose_files(created_by);
CREATE INDEX IF NOT EXISTS idx_loose_written_by ON loose_files(last_written_by);
CREATE INDEX IF NOT EXISTS idx_loose_updated_id ON loose_files(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_loose_filename ON loose_files(filename);
CREATE INDEX IF NOT EXISTS idx_sites_expires_at ON sites(expires_at);
CREATE INDEX IF NOT EXISTS idx_loose_expires_at ON loose_files(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_connections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  poll_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT NOT NULL,
  user_id TEXT,
  token_expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_connections_ip_created ON agent_connections(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_connections_created ON agent_connections(created_at);
CREATE INDEX IF NOT EXISTS idx_connections_expires ON agent_connections(expires_at);

CREATE TABLE IF NOT EXISTS upload_grants (
  deployment_id TEXT,
  deployment_intent_hash TEXT,
  deployment_base_generation INTEGER,
  receipt_expires_at TEXT,
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  token_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_id TEXT,
  target_kind TEXT NOT NULL,
  file_id TEXT,
  site_id TEXT,
  path TEXT,
  filename TEXT,
  file_ttl TEXT,
  file_write_policy TEXT,
  file_password TEXT,
  file_write_password TEXT,
  expected_version INTEGER,
  max_bytes INTEGER NOT NULL,
  sha256 TEXT,
  state TEXT NOT NULL,
  lease_id TEXT,
  leased_at TEXT,
  last_error TEXT,
  result_id TEXT,
  result_url TEXT,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_grants_expires ON upload_grants(expires_at);

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
