import { MAX_FILE_BYTES, MAX_PLATFORM_BYTES, PRODUCT } from "./config";
import { ApiError } from "./http";
import type { Actor, Env } from "./types";

export type WritePolicy = "owner" | "instance";

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Code-owned catalog. Instance policy intersects this with MAX_TTL. */
export const TTL_CATALOG = ["30m", "1h", "1d", "7d", "14d", "30d", "60d", "90d", "180d", "365d"] as const;

const HUMAN_BY_ID: Record<string, string> = {
  "30m": "30 minutes",
  "1h": "1 hour",
  "1d": "1 day",
  "7d": "7 days",
  "14d": "14 days",
  "30d": "1 month",
  "60d": "2 months",
  "90d": "3 months",
  "180d": "6 months",
  "365d": "1 year",
  never: "Never",
};

export type TtlPreset = {
  id: string;
  seconds: number | null;
  label: string;
};

export type InstancePolicy = {
  allowUnlimited: boolean;
  defaultTtl: string;
  maxSeconds: number | null;
  presets: TtlPreset[];
  allowedEmailDomains: string[];
  fileBytes: number;
  platformBytes: number;
  writePolicy: WritePolicy;
};

export type ResolvedTtl = {
  expiresAt: string | null;
  ttl: string;
};

function flag(value: string | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function csv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** `25mb`, `5 MB`, `20gb`, or a positive integer of bytes. */
export function parseByteSize(raw: string | undefined): number | null {
  const s = (raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/.exec(s);
  if (!match) return null;
  const n = Number(match[1]);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const mul = match[2] === "gb" ? 1024 ** 3 : match[2] === "mb" ? 1024 ** 2 : match[2] === "kb" ? 1024 : 1;
  const bytes = Math.round(n * mul);
  return bytes > 0 ? bytes : null;
}

export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const match = /^(\d+)(s|m|h|d)$/.exec(s);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n * UNIT_SECONDS[match[2]!];
}

export function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const d = seconds / 86400;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (seconds % 3600 === 0) {
    const h = seconds / 3600;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/** Picker / catalog copy: 90d → "3 months", 365d → "1 year". */
export function formatTtlLabel(id: string, seconds?: number | null): string {
  const key = id.trim().toLowerCase();
  if (key in HUMAN_BY_ID) return HUMAN_BY_ID[key]!;
  if (seconds != null) return formatDuration(seconds);
  const parsed = parseDuration(key);
  return parsed != null ? formatDuration(parsed) : id;
}

function durationId(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function isNever(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const s = value.trim().toLowerCase();
  return s === "" || s === "never" || s === "none" || s === "unlimited";
}

export function instancePolicy(
  env: Pick<
    Env,
    | "ALLOW_UNLIMITED_RETENTION"
    | "DEFAULT_TTL"
    | "MAX_TTL"
    | "TTL_PRESETS"
    | "ALLOWED_EMAIL_DOMAINS"
    | "MAX_FILE_BYTES"
    | "MAX_PLATFORM_BYTES"
    | "WRITE_POLICY"
  >,
): InstancePolicy {
  const allowUnlimited = flag(env.ALLOW_UNLIMITED_RETENTION);
  const requested = csv(env.TTL_PRESETS);
  const ids = (requested.length ? requested : [...TTL_CATALOG]).filter((id) => parseDuration(id) != null);

  const maxRaw = (env.MAX_TTL || "").trim().toLowerCase();
  let maxSeconds: number | null;
  if (maxRaw === "" || maxRaw === "never") {
    maxSeconds = allowUnlimited ? null : parseDuration("30d");
  } else {
    maxSeconds = parseDuration(maxRaw);
    if (maxSeconds == null) maxSeconds = allowUnlimited ? null : parseDuration("30d");
  }

  const presets: TtlPreset[] = [];
  for (const id of ids) {
    const seconds = parseDuration(id);
    if (seconds == null) continue;
    if (maxSeconds != null && seconds > maxSeconds) continue;
    presets.push({ id, seconds, label: formatTtlLabel(id, seconds) });
  }
  if (allowUnlimited) presets.push({ id: "never", seconds: null, label: formatTtlLabel("never") });

  let defaultTtl = (env.DEFAULT_TTL || "").trim().toLowerCase();
  if (!defaultTtl) defaultTtl = allowUnlimited ? "never" : "7d";
  if (defaultTtl === "never" && !allowUnlimited) defaultTtl = "7d";
  if (defaultTtl !== "never") {
    const seconds = parseDuration(defaultTtl);
    if (seconds == null || (maxSeconds != null && seconds > maxSeconds)) {
      defaultTtl = presets.find((p) => p.id !== "never")?.id || "7d";
    } else if (!presets.some((p) => p.id === defaultTtl)) {
      presets.unshift({ id: defaultTtl, seconds, label: formatTtlLabel(defaultTtl, seconds) });
    }
  }

  return {
    allowUnlimited,
    defaultTtl,
    maxSeconds,
    presets,
    allowedEmailDomains: csv(env.ALLOWED_EMAIL_DOMAINS),
    fileBytes: parseByteSize(env.MAX_FILE_BYTES) ?? MAX_FILE_BYTES,
    platformBytes: parseByteSize(env.MAX_PLATFORM_BYTES) ?? MAX_PLATFORM_BYTES,
    writePolicy: parseWritePolicyEnv(env.WRITE_POLICY),
  };
}

export function policyPublic(policy: InstancePolicy): Record<string, unknown> {
  return {
    allow_unlimited: policy.allowUnlimited,
    default_ttl: policy.defaultTtl,
    max_ttl: policy.maxSeconds == null ? "never" : durationId(policy.maxSeconds),
    presets: policy.presets,
    allowed_email_domains: policy.allowedEmailDomains,
    file_bytes: policy.fileBytes,
    zip_bytes: policy.fileBytes,
    platform_bytes: policy.platformBytes,
    write_policy: policy.writePolicy,
  };
}

export function resolveExpiresAt(policy: InstancePolicy, input: unknown, now = new Date()): ResolvedTtl {
  const raw = input === undefined ? policy.defaultTtl : input;
  if (isNever(raw)) {
    if (!policy.allowUnlimited) {
      throw new ApiError(
        400,
        "ttl_required",
        `This ${PRODUCT} instance does not keep content forever. Pass ttl as one of: ${policy.presets.map((p) => p.id).join(", ")}.`,
        { presets: policy.presets.map((p) => p.id), default_ttl: policy.defaultTtl },
      );
    }
    return { expiresAt: null, ttl: "never" };
  }

  let seconds: number | null = null;
  let ttl = "";
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    seconds = raw;
    ttl = durationId(raw);
  } else if (typeof raw === "string") {
    seconds = parseDuration(raw);
    ttl = raw.trim().toLowerCase();
  }
  if (seconds == null) {
    throw new ApiError(
      400,
      "bad_ttl",
      `ttl must be a preset (${policy.presets.map((p) => p.id).join(", ")}), a duration like 7d, or a positive number of seconds.`,
      { presets: policy.presets.map((p) => p.id) },
    );
  }
  if (policy.maxSeconds != null && seconds > policy.maxSeconds) {
    const capId = durationId(policy.maxSeconds);
    throw new ApiError(
      400,
      "ttl_too_long",
      `This instance caps retention at ${formatTtlLabel(capId, policy.maxSeconds)}. Pick a shorter ttl.`,
      { max_ttl: capId, presets: policy.presets.map((p) => p.id) },
    );
  }
  return {
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
    ttl,
  };
}

export function emailAllowed(policy: InstancePolicy, email: string): boolean {
  if (policy.allowedEmailDomains.length === 0) return true;
  const domain = String(email || "")
    .split("@")[1]
    ?.trim()
    .toLowerCase();
  if (!domain) return false;
  return policy.allowedEmailDomains.includes(domain);
}

export function forbiddenDomain(policy: InstancePolicy): ApiError {
  const list = policy.allowedEmailDomains.join(", ");
  return new ApiError(
    403,
    "forbidden_domain",
    `${PRODUCT} on this instance only allows emails at ${list}.`,
    { allowed_email_domains: policy.allowedEmailDomains },
  );
}

/** Unset or unrecognized instance var → owner (public-safe). */
export function parseWritePolicyEnv(raw: string | undefined): WritePolicy {
  return (raw || "").trim().toLowerCase() === "instance" ? "instance" : "owner";
}

/** Stored NULL / junk → instance so legacy rows stay writable. */
export function resolveWritePolicy(stored: string | null | undefined): WritePolicy {
  return stored === "owner" ? "owner" : "instance";
}

/** Request field. Empty/omitted → null (use instance default). Junk → invalid. */
export function requestedWritePolicy(raw: unknown): WritePolicy | "invalid" | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (v === "owner" || v === "instance") return v;
  return "invalid";
}

export function resolveCreateWritePolicy(env: Pick<Env, "WRITE_POLICY">, requested: unknown): WritePolicy {
  const parsed = requestedWritePolicy(requested);
  if (parsed === "invalid") {
    throw new ApiError(400, "bad_write_policy", "write_policy must be owner or instance.");
  }
  return parsed ?? instancePolicy(env).writePolicy;
}

export function writePolicyFromRequest(request: Request, form?: FormData): unknown {
  const header = request.headers.get("X-Energon-Write-Policy") || request.headers.get("x-energon-write-policy");
  if (header != null && header.trim() !== "") return header.trim();
  if (form) {
    const value = form.get("write_policy");
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function canMutate(
  actor: Actor,
  row: { created_by: string; write_policy?: string | null; owner_id?: string | null },
): boolean {
  if (resolveWritePolicy(row.write_policy) === "instance") return true;
  if (actor.userId) return Boolean(row.owner_id) && actor.userId === row.owner_id;
  return actor.email.toLowerCase() === String(row.created_by || "").toLowerCase();
}

/** Atomic D1 predicate matching canMutate. Bind ownerWriteBinds(actor). */
export const OWNER_WRITE_SQL = `(ifnull(write_policy, 'instance') != 'owner' OR (? IS NOT NULL AND owner_id = ?) OR (? IS NULL AND lower(created_by) = lower(?)))`;

export function ownerWriteBinds(actor: Actor): [string | null, string, string | null, string] {
  const id = actor.userId ?? null;
  return [id, id ?? "", id, actor.email];
}

export function assertCanMutate(
  actor: Actor,
  row: { created_by: string; write_policy?: string | null; owner_id?: string | null },
): void {
  if (canMutate(actor, row)) return;
  throw new ApiError(403, "forbidden_write", "Only the creator can write this.");
}

export function assertCanSetWritePolicy(actor: Actor, createdBy: string, ownerId?: string | null): void {
  if (actor.userId) {
    if (ownerId && actor.userId === ownerId) return;
    throw new ApiError(403, "forbidden_write_policy", "Only the creator can change who can write this.");
  }
  if (actor.email.toLowerCase() === String(createdBy || "").toLowerCase()) return;
  throw new ApiError(403, "forbidden_write_policy", "Only the creator can change who can write this.");
}

export function ttlFromRequest(request: Request, form?: FormData): unknown {
  const header = request.headers.get("X-Energon-TTL") || request.headers.get("x-energon-ttl");
  if (header != null && header.trim() !== "") return header.trim();
  if (form) {
    const value = form.get("ttl");
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}
