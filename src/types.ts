export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
  CONTENT_ORIGIN?: string;
  REQUIRE_ACCESS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
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
  AGENT_SKILLS_DISCOVERY?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  ADMIN_EMAILS?: string;
  MAX_FILE_BYTES?: string;
  MAX_ZIP_BYTES?: string;
  MAX_ZIP_IMPORT_BYTES?: string;
  MAX_ZIP_EXTRACTED_BYTES?: string;
  MAX_ZIP_EXPORT_BYTES?: string;
  MAX_PLATFORM_BYTES?: string;
  SITE_VERSIONING_ENABLED?: string;
  WRITE_POLICY?: string;
  FOOTER_TEXT?: string;
  /** Test and local override. Production omits this and fetches GitHub. */
  UPSTREAM_RELEASE_JSON?: string;
}

export type TokenScope = "account" | "admin";

export type Actor = {
  email: string;
  userId?: string;
  idpSub?: string;
  via: "token" | "access" | "grant";
  tokenId?: string;
  tokenLabel?: string;
  tokenExpiresAt?: string | null;
  tokenScope?: TokenScope;
  admin?: boolean;
};

export type SiteRow = {
  active_version_id?: string | null;
  content_generation?: number;
  lifecycle_state?: string;
  conversion_state?: string;
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
  content_generation: number;
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
  scope?: string | null;
};

export type DeploymentManifestFile = { path: string; size: number; sha256: string; contentType: string };
export type DeploymentIntent = {
  mode: "replace" | "merge";
  files?: DeploymentManifestFile[];
  archive?: { size: number; sha256: string; maxExtractedBytes: number; maxFiles: number };
};
export type DeploymentReceipt = {
  deploymentId: string;
  versionId: string;
  outcome: "committed";
  url: string;
  committedAt: string;
};
export type SiteDeploymentRow = {
  id: string;
  site_id: string;
  owner_id: string;
  version_id: string;
  base_generation: number;
  mode: "replace" | "merge";
  input_json: string;
  intent_hash: string;
  idempotency_key: string;
  state: "uploading" | "ready" | "committing" | "committed" | "aborted" | "expired" | "failed";
  created_at: string;
  deadline: string;
  prepare_cursor: string | null;
  prepare_owner: string | null;
  prepare_expires_at: string | null;
  commit_attempt: string | null;
  terminal_at: string | null;
  receipt_expires_at: string | null;
  receipt_json: string | null;
  last_error: string | null;
};
export type SiteVersionFileRow = {
  version_id: string;
  path: string;
  allocation_id: string;
  object_key: string;
  size: number;
  sha256: string;
  content_type: string;
};

export type DeploymentGrantRow = {
  id: string;
  secret_hash: string;
  token_id: string;
  user_email: string;
  user_id: string;
  target_kind: "site_deployment";
  site_id: string;
  deployment_id: string;
  deployment_intent_hash: string;
  deployment_base_generation: number;
  max_bytes: number;
  state: "unused" | "consumed" | "revoked";
  expires_at: string;
  receipt_expires_at: string | null;
};
