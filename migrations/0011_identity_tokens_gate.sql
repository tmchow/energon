-- Hash-only tokens, IdP subject on users, and durable gate attempt counters.
-- CREATE / ADD COLUMN are not idempotent. Do not re-apply this file.
ALTER TABLE users ADD COLUMN idp_sub TEXT;
ALTER TABLE tokens ADD COLUMN token_hint TEXT;
ALTER TABLE tokens ADD COLUMN user_id TEXT;
UPDATE tokens SET token_secret = NULL WHERE token_secret IS NOT NULL;
UPDATE tokens SET user_id = (SELECT id FROM users WHERE users.email = tokens.user_email) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_idp_sub ON users(idp_sub);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
CREATE TABLE IF NOT EXISTS gate_attempts (
  scope TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
