import type { AdminHealthSnapshot, GateUnlockResult, InstanceIdentity, QuotaRecomputeResult, SweepNowResult } from '../page-data';
import type { StatsPayload } from '../page-data';
import type { BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget, TokenStatus } from '../token-status';

export type Preset = { id: string; label: string };
export type RetentionPolicy = { presets: Preset[]; default_ttl: string; allow_unlimited: boolean; write_policy: string; file_bytes?: number };
export type TokenPolicy = { presets: Preset[]; default: string; allow_never: boolean };
export type Token = { id: string; label: string; hint: string | null; recoverable?: boolean; status: TokenStatus; revoked: boolean; expired: boolean; created_at: string; last_used_at: string | null; expires_at: string | null; scope: 'account' | 'admin' };
export type AdminToken = Token & { owner_email: string; owner_handle: string };
export type { BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget, TokenStatus };
export type CatalogItem = {
  url: string; created_by: string; last_written_by: string | null;
  created_at: string; updated_at: string | null; expires_at: string | null; last_read_at?: string | null; size: number;
  password_protected: boolean; write_password_protected?: boolean; written_via?: string | null; write_policy: string;
} & ({ slug: string; file_count: number; id: string; filename?: never } | { id: string; filename: string; slug?: never; file_count?: never });
export type CatalogData = {
  email: string | null; admin?: boolean; sites: CatalogItem[]; files: CatalogItem[]; sites_total: number; files_total: number;
  sites_cursor: string | null; files_cursor: string | null; tokens?: Token[];
};
export type HubQuery = {
  q: string;
  scope: string;
  sort: string;
  expires?: { kind: 'never' } | { kind: 'before'; at: string };
  updatedBefore?: string;
  minSize?: number;
};
export type HubData = CatalogData & { handle: string | null; origin: string; content_origin: string; policy: RetentionPolicy; words: readonly string[]; query?: HubQuery };
export type LinkAccess = {
  password_protected: boolean;
  password?: string | null;
  write_password_protected?: boolean;
  write_password?: string | null;
};
export type TokensData = { email: string; tokens: Token[]; token_env: string; token_policy: TokenPolicy; now: number; admin: boolean; admin_token_policy: TokenPolicy };
export type SetupData = { email: string; admin?: boolean; identity: InstanceIdentity; install: string };
export type ConnectEndedKind = 'expired' | 'approved' | 'denied';
export type ConnectData = {
  email: string;
  host: string;
  connection: { id: string; label: string; expires_at: string } | null;
  ended_kind: ConnectEndedKind | null;
  token_policy: TokenPolicy;
};
export type GateData = { action: string; wrong: boolean; limited?: boolean; passwordHeader: string };
export type MarkdownData = { filename: string; rawHref: string; html: string; size?: number; updatedAt?: string };
export type AdminCleanupObject = {
  kind: 'site' | 'file';
  ref: string;
  name: string;
  owner: string;
  bytes: number;
  expires_at: string | null;
  updated_at: string;
  last_read_at: string | null;
};
export type AdminCleanupPreview = {
  action: 'delete' | 'set_ttl' | 'expire';
  ttl?: string;
  executed: false;
  matched: number;
  eligible: number;
  bytes: number;
  skipped: { total: number; by_reason?: Record<string, number> };
  sample: AdminCleanupObject[];
  confirm: string;
};
export type AdminCleanupResult = {
  action: 'delete' | 'set_ttl' | 'expire';
  ttl?: string;
  executed: true;
  applied: { total: number; bytes: number };
  skipped: { total: number };
  failed: { total: number };
};
export type AdminAuditEvent = {
  id: string;
  created_at: string;
  actor_email: string;
  token_id: string | null;
  token_hint: string | null;
  action: string;
  executed: boolean;
  action_kind: string | null;
  ttl: string | null;
  target: unknown;
  matched: number | null;
  eligible: number | null;
  applied: number | null;
  skipped: number | null;
  failed: number | null;
  bytes: number | null;
  confirm: string | null;
};
export type { AdminHealthSnapshot, GateUnlockResult, QuotaRecomputeResult, SweepNowResult };
export type AdminData = { email: string; handle: string; admin: boolean; policy: RetentionPolicy; health: AdminHealthSnapshot };
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
