const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agent_connections (
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
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL,
    created_at TEXT NOT NULL,
    idp_sub TEXT UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS handle_reservations (
    handle TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sites (
    handle TEXT NOT NULL,
    slug TEXT NOT NULL,
    owner_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    last_written_by TEXT NOT NULL,
    password_hash TEXT,
    expires_at TEXT,
    write_policy TEXT NOT NULL DEFAULT 'instance',
    write_password_hash TEXT,
    written_via TEXT,
    PRIMARY KEY (handle, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS site_files (
    handle TEXT NOT NULL,
    slug TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_written_by TEXT NOT NULL,
    PRIMARY KEY (handle, slug, path)
  )`,
  `CREATE TABLE IF NOT EXISTS loose_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT,
    last_written_by TEXT,
    password_hash TEXT,
    handle TEXT,
    owner_id TEXT,
    expires_at TEXT,
    write_policy TEXT NOT NULL DEFAULT 'instance',
    write_password_hash TEXT,
    written_via TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tokens (
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
    expires_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS gate_attempts (
    scope TEXT PRIMARY KEY,
    fails INTEGER NOT NULL,
    window_start TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_quota (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    used INTEGER NOT NULL
  )`,
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_connections_ip_created ON agent_connections(ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_connections_created ON agent_connections(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_connections_expires ON agent_connections(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_site_files_site ON site_files(handle, slug)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_files_created ON loose_files(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_email)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_idp_sub ON users(idp_sub)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique ON users(handle)`,
  `CREATE INDEX IF NOT EXISTS idx_handle_reservations_user ON handle_reservations(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_files_owner ON loose_files(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_created_by ON sites(created_by)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_written_by ON sites(last_written_by)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_updated_slug ON sites(updated_at DESC, handle DESC, slug DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_created_by ON loose_files(created_by)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_written_by ON loose_files(last_written_by)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_updated_id ON loose_files(updated_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_filename ON loose_files(filename)`,
  `CREATE INDEX IF NOT EXISTS idx_sites_expires_at ON sites(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_loose_expires_at ON loose_files(expires_at)`,
];

let columnsReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tokens'`)
    .first();
  if (columnsReady && existing) return;
  // Existing tokens marks an older schema that needs additive column upgrades.
  // CREATE TABLE does not reshape an old sites PK.
  for (const sql of TABLE_STATEMENTS) {
    await db.prepare(sql).run();
  }
  if (existing) {
    await ensureColumns(db, "loose_files", ["updated_at", "last_written_by", "password_hash", "handle", "owner_id", "expires_at", "write_policy", "write_password_hash", "written_via"]);
    await ensureColumns(db, "sites", ["password_hash", "handle", "owner_id", "expires_at", "write_policy", "write_password_hash", "written_via"]);
    await ensureColumns(db, "tokens", ["token_secret", "token_hint", "user_id", "expires_at"]);
    await ensureColumns(db, "users", ["idp_sub"]);
    await db.prepare(`UPDATE tokens SET token_secret = NULL WHERE token_secret IS NOT NULL`).run();
    await db.prepare(
      `UPDATE tokens SET user_id = (SELECT id FROM users WHERE users.email = tokens.user_email) WHERE user_id IS NULL`,
    ).run();
    await db.prepare(
      `UPDATE sites SET owner_id = (SELECT id FROM users WHERE users.email = sites.created_by) WHERE owner_id IS NULL OR owner_id = ''`,
    ).run();
    await db.prepare(
      `UPDATE loose_files SET owner_id = (SELECT id FROM users WHERE users.email = loose_files.created_by) WHERE owner_id IS NULL OR owner_id = ''`,
    ).run();
  }
  for (const sql of INDEX_STATEMENTS) {
    await db.prepare(sql).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO platform_quota (id, used) VALUES (1, 0)`).run();
  await db.prepare(
    `UPDATE platform_quota SET used = (
      (SELECT COALESCE(SUM(size), 0) FROM site_files) +
      (SELECT COALESCE(SUM(size), 0) FROM loose_files)
    ) WHERE id = 1 AND used = 0`,
  ).run();
  columnsReady = true;
}

async function ensureColumns(db: D1Database, table: string, needed: string[]): Promise<void> {
  const cols = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set((cols.results || []).map((c) => c.name));
  for (const name of needed) {
    if (!names.has(name)) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`).run();
    }
  }
}
