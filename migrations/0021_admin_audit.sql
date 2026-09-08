CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  token_id TEXT,
  action TEXT NOT NULL,
  target_json TEXT NOT NULL,
  matched INTEGER NOT NULL,
  eligible INTEGER NOT NULL,
  applied INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  confirm TEXT
);

CREATE INDEX idx_admin_audit_at ON admin_audit(at DESC, id DESC);
