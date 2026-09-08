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

export type AdminHealthSnapshot = {
  quota: {
    used_bytes: number;
    catalog_bytes: number;
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

export type StatsPayload = {
  email: string;
  admin?: boolean;
  you: Bucket;
  system: Bucket & { people: number };
  platform: PlatformHeadroom;
  people: PersonStats[];
};

