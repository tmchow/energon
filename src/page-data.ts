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

export type StatsPayload = {
  email: string;
  admin?: boolean;
  you: Bucket;
  system: Bucket & { people: number };
  people: PersonStats[];
};

