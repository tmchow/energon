import type { InstanceIdentity } from '../page-data';
import type { StatsPayload } from '../page-data';
import type { BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget, TokenStatus } from '../token-status';

export type Preset = { id: string; label: string };
export type RetentionPolicy = { presets: Preset[]; default_ttl: string; allow_unlimited: boolean; write_policy: string; file_bytes?: number };
export type TokenPolicy = { presets: Preset[]; default: string; allow_never: boolean };
export type Token = { id: string; label: string; hint: string | null; recoverable?: boolean; status: TokenStatus; revoked: boolean; expired: boolean; created_at: string; last_used_at: string | null; expires_at: string | null; admin?: boolean };
export type { BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget, TokenStatus };
export type CatalogItem = {
  url: string; created_by: string; last_written_by: string | null;
  created_at: string; updated_at: string | null; expires_at: string | null; last_read_at?: string | null; size: number;
  password_protected: boolean; write_password_protected?: boolean; written_via?: string | null; write_policy: string;
} & ({ slug: string; file_count: number; id: string; filename?: never } | { id: string; filename: string; slug?: never; file_count?: never });
export type CatalogData = {
  email: string | null; sites: CatalogItem[]; files: CatalogItem[]; sites_total: number; files_total: number;
  sites_cursor: string | null; files_cursor: string | null; tokens?: Token[];
};
export type HubData = CatalogData & { handle: string | null; origin: string; content_origin: string; policy: RetentionPolicy; words: readonly string[]; query?: { q: string; scope: string; sort: string }; admin?: boolean };
export type LinkAccess = {
  password_protected: boolean;
  password?: string | null;
  write_password_protected?: boolean;
  write_password?: string | null;
};
export type TokensData = { email: string; tokens: Token[]; token_env: string; token_policy: TokenPolicy; now: number; admin?: boolean; admin_token_policy?: TokenPolicy };
export type AdminSample = {
  kind: 'site' | 'file'; ref: string; name: string; owner: string; bytes: number;
  expires_at: string | null; updated_at: string; last_read_at: string | null;
};
export type CleanupPreview = {
  action: string; ttl?: string; executed: false; matched: number; eligible: number; bytes: number;
  skipped: { total: number; by_reason: Record<string, number>; sample: { kind: string; ref: string; reason: string }[] };
  sample: AdminSample[]; confirm: string;
};
export type CleanupResult = {
  action: string; ttl?: string; executed: true;
  applied: { total: number; bytes: number; objects: { kind: string; ref: string; name: string; bytes: number; expires_at?: string | null }[] };
  skipped: { total: number; by_reason: Record<string, number>; sample: { kind: string; ref: string; reason: string }[] };
  failed: { total: number; objects: { kind: string; ref: string; error: string }[] };
};
export type AdminAuditEvent = {
  id: string; at: string; actor_email: string; token_id: string | null; action: string;
  target: Record<string, unknown>; matched: number; eligible: number; applied: number; skipped: number; failed: number; confirm: string | null;
};
export type AdminData = {
  email: string; admin: boolean; policy: RetentionPolicy; default_ttl: string;
  audit: AdminAuditEvent[]; audit_total: number; audit_cursor: string | null;
};
export type SetupData = { email: string; identity: InstanceIdentity; install: string; admin?: boolean };
export type ConnectData = { email: string; host: string; connection: { id: string; label: string; expires_at: string }; token_policy: TokenPolicy };
export type GateData = { action: string; wrong: boolean; limited?: boolean; passwordHeader: string };
export type MarkdownData = { filename: string; rawHref: string; html: string; size?: number; updatedAt?: string };
export type PageProps = (
  | { page: 'hub'; data: HubData }
  | { page: 'tokens'; data: TokensData }
  | { page: 'setup'; data: SetupData }
  | { page: 'connect'; data: ConnectData }
  | { page: 'stats'; data: StatsPayload }
  | { page: 'about'; data: { email: string; admin?: boolean } }
  | { page: 'admin'; data: AdminData }
  | { page: 'gate'; data: GateData }
  | { page: 'markdown'; data: MarkdownData }
) & { footer?: string };
