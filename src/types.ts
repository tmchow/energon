export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
  CONTENT_ORIGIN?: string;
  REQUIRE_ACCESS?: string;
  DEV_ACCESS_EMAIL?: string;
  INSTANCE_SLUG?: string;
  MARKETPLACE_NAME?: string;
  MARKETPLACE_REPO?: string;
  SKILL_NAME?: string;
  TOKEN_ENV?: string;
  TOKEN_PREFIX?: string;
  ALLOW_UNLIMITED_RETENTION?: string;
  DEFAULT_TTL?: string;
  MAX_TTL?: string;
  TTL_PRESETS?: string;
  ALLOW_UNLIMITED_TOKENS?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  MAX_FILE_BYTES?: string;
  MAX_PLATFORM_BYTES?: string;
  WRITE_POLICY?: string;
  FOOTER_TEXT?: string;
}

export type Actor = {
  email: string;
  userId?: string;
  idpSub?: string;
  via: "token" | "access";
  tokenId?: string;
  tokenLabel?: string;
  tokenExpiresAt?: string | null;
};

export type SiteRow = {
  id: string;
  handle: string;
  owner_id?: string | null;
  slug: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  last_written_by: string;
  password_hash?: string | null;
  password_secret?: string | null;
  expires_at?: string | null;
  write_policy?: string | null;
  write_password_hash?: string | null;
  write_password_secret?: string | null;
  written_via?: string | null;
  last_read_at?: string | null;
};

export type WriteAuthority = { kind: "writePassword"; hash: string };

export type SiteFileRow = {
  site_id: string;
  path: string;
  size: number;
  content_type: string;
  updated_at: string;
  last_written_by: string;
};

export type LooseFileRow = {
  id: string;
  handle: string | null;
  owner_id?: string | null;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
  created_by: string;
  updated_at: string | null;
  last_written_by: string | null;
  password_hash?: string | null;
  password_secret?: string | null;
  expires_at?: string | null;
  write_policy?: string | null;
  write_password_hash?: string | null;
  write_password_secret?: string | null;
  written_via?: string | null;
  last_read_at?: string | null;
};

export type TokenRow = {
  id: string;
  user_email: string;
  user_id?: string | null;
  label: string;
  token_hash: string;
  token_hint?: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at?: string | null;
};
