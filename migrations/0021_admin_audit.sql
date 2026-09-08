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
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
