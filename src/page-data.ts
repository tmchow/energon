export type InstanceIdentity = {
  skill: string;
  plugin: string;
  marketplace: string;
  repo: string;
  tokenEnv: string;
  tokenPrefix: string;
  origin: string;
};

type Bucket = {
  sites: number;
  files: number;
  bytes: number;
};

export type PersonStats = {
  email: string;
  handle: string;
  sites: number;
  files: number;
  bytes: number;
};

export type PlatformHeadroom = {
  used_bytes: number;
  limit_bytes: number;
};

export type FileRecoveryItem = {
  allocation_id: string;
  file_id: string | null;
  filename: string | null;
  operation: string | null;
  state: string;
  created_at: string;
  cleanup_error: string | null;
  snapshot_retained: boolean;
  recovery_required: boolean;
};

export type AdminHealthSnapshot = {
  site_conversions?: { enabled: boolean; pending: number; items: Array<{ site_id: string; slug: string; phase: string; last_error: string | null }> };
  file_recoveries?: { pending: number; recovery_required: number; items: FileRecoveryItem[] };
  quota: {
    used_bytes: number;
    catalog_bytes: number; pending_cleanup_bytes?: number; cleanup_failed_allocations?: number;
    limit_bytes: number;
  };
  expired_awaiting_purge: number;
  stale_purge_claims: number;
  locked_gates: number;
  locked_scopes: string[];
  sites: number;
  files: number;
  people: number;
};

export type QuotaRecomputeResult = {
  used_before: number;
  used_after: number;
};

export type SweepNowResult = {
  swept: { sites: number; files: number };
  expired_remaining: number;
};

export type GateUnlockResult = {
  scope: string;
  unlocked: boolean;
};

export type UpstreamStatus = "current" | "update" | "unknown" | "failed";

export type UpstreamSnapshot = {
  status: UpstreamStatus;
  this_version: string | null;
  latest_tag: string | null;
  latest_url: string | null;
  published_at: string | null;
  docs_url: string;
};

export type StatsPayload = {
  email: string;
  admin?: boolean;
  you: Bucket;
  system: Bucket & { people: number };
  platform: PlatformHeadroom;
  people: PersonStats[];
};

