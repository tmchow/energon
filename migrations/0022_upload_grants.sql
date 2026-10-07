CREATE TABLE upload_grants (
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

CREATE INDEX idx_upload_grants_expires ON upload_grants(expires_at);
