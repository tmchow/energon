CREATE TABLE agent_connections (
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

CREATE INDEX idx_connections_ip_created ON agent_connections(ip_hash, created_at);
CREATE INDEX idx_connections_created ON agent_connections(created_at);
CREATE INDEX idx_connections_expires ON agent_connections(expires_at);
