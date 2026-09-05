import type { InstanceIdentity } from '../page-data';
import type { StatsPayload } from '../page-data';

export type Preset = { id: string; label: string };
export type RetentionPolicy = { presets: Preset[]; default_ttl: string; allow_unlimited: boolean; write_policy: string; file_bytes?: number };
export type TokenPolicy = { presets: Preset[]; default: string; allow_never: boolean };
export type Token = { id: string; label: string; hint: string | null; recoverable?: boolean; revoked: boolean; expired: boolean; created_at: string; last_used_at: string | null; expires_at: string | null };
export type CatalogItem = {
  url: string; created_by: string; last_written_by: string | null;
  created_at: string; updated_at: string | null; expires_at: string | null; size: number;
  password_protected: boolean; write_policy: string;
} & ({ slug: string; file_count: number; id?: never; filename?: never } | { id: string; filename: string; slug?: never; file_count?: never });
export type CatalogData = {
  email: string | null; sites: CatalogItem[]; files: CatalogItem[]; sites_total: number; files_total: number;
  sites_cursor: string | null; files_cursor: string | null; tokens?: Token[];
};
export type HubData = CatalogData & { handle: string | null; origin: string; content_origin: string; policy: RetentionPolicy; words: readonly string[]; query?: { q: string; scope: string; sort: string } };
export type TokensData = { email: string; tokens: Token[]; token_env: string; token_policy: TokenPolicy; now: number };
export type SetupData = { email: string; identity: InstanceIdentity; install: string };
export type ConnectData = { email: string; connection: { id: string; label: string; expires_at: string }; token_policy: TokenPolicy };
export type GateData = { action: string; wrong: boolean; limited?: boolean; passwordHeader: string };
export type MarkdownData = { filename: string; rawHref: string; html: string; size?: number; updatedAt?: string };
export type PageProps = (
  | { page: 'hub'; data: HubData }
  | { page: 'tokens'; data: TokensData }
  | { page: 'setup'; data: SetupData }
  | { page: 'connect'; data: ConnectData }
  | { page: 'stats'; data: StatsPayload }
  | { page: 'about'; data: { email: string } }
  | { page: 'gate'; data: GateData }
  | { page: 'markdown'; data: MarkdownData }
) & { footer?: string };
