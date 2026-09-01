-- Stable account id + forever handle reservations. Published object.handle is a snapshot.
-- CREATE TABLE / ADD COLUMN here are not idempotent. If users or owner_id
-- already exist, stamp this file in d1_migrations instead of applying it.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE handle_reservations (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO users (id, email, handle, created_at)
SELECT lower(hex(randomblob(8))), email, handle, created_at FROM handles;

INSERT INTO handle_reservations (handle, user_id, created_at)
SELECT u.handle, u.id, u.created_at FROM users u;

DROP TABLE handles;

ALTER TABLE sites ADD COLUMN owner_id TEXT;
ALTER TABLE loose_files ADD COLUMN owner_id TEXT;

UPDATE sites SET owner_id = (SELECT id FROM users WHERE users.email = sites.created_by) WHERE owner_id IS NULL;
UPDATE loose_files SET owner_id = (SELECT id FROM users WHERE users.email = loose_files.created_by) WHERE owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_handle_reservations_user ON handle_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_id);
CREATE INDEX IF NOT EXISTS idx_loose_files_owner ON loose_files(owner_id);
