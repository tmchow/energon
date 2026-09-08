export const PRODUCT = "Energon";
export const DEFAULT_PUBLIC_ORIGIN = "https://energon.example.com";
export const TOKEN_PREFIX = "ee_live_";
export const ENV_TOKEN = "ENERGON_TOKEN";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PLATFORM_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_IMPORT_FILES = 200;
export const TOKEN_SECRET_LEN = 32;
export const FILE_ID_LEN = 6;
export const FILE_ID_RE = /^[A-Za-z0-9]{6,12}$/;
/** Sites use the same capability-id shape as loose files. */
export const SITE_ID_LEN = FILE_ID_LEN;
export const SITE_ID_RE = FILE_ID_RE;
/** Edge hits skip the Worker, so this TTL bounds how far last_read_at can lag real public reads. Writes and deletes still purge early. */
export const PUBLIC_CACHE_SECONDS = 86400;
export const PASSWORD_HEADER = "X-Energon-Password";
export const SET_PASSWORD_HEADER = "X-Energon-Set-Password";
export const WRITE_PASSWORD_HEADER = "X-Energon-Write-Password";
export const SET_WRITE_PASSWORD_HEADER = "X-Energon-Set-Write-Password";
export const WRITTEN_VIA_WRITE_PASSWORD = "write_password";

export const RESERVED_HANDLES = new Set(["v1", "account", "static", "health", "about", "stats", "setup", "tokens", "admin"]);
/** Inserted after TOKEN_PREFIX so an admin secret is recognizable in a log without a second accepted prefix. */
export const ADMIN_TOKEN_INFIX = "adm_";
/** Safe default when an operator sets a TTL on content they do not own. */
export const ADMIN_CLEANUP_DEFAULT_TTL = "7d";
export const RESERVED_SLUGS = new Set<string>();

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function siteKey(handle: string, id: string, path: string): string {
  return `sites/${handle}/${id}/${path}`;
}

export function fileKey(id: string, filename: string): string {
  return `files/${id}/${filename}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatBytes(n: number): string {
  const bytes = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const trimmed = value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  return `${trimmed} ${units[i]}`;
}

export function formatCount(n: number): string {
  return Math.max(0, Math.round(Number.isFinite(n) ? n : 0)).toLocaleString("en-US");
}
