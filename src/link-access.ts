import { ApiError, htmlPage, json } from "./http";
import { canSetWritePolicy, requestedWritePolicy, resolveCreateWritePolicy, type WritePolicy } from "./policy";
import type { Actor, Env } from "./types";

export type LinkAccess = "public" | "private";

export const LINK_ACCESS_HEADER = "X-Energon-Link-Access";

const PRIVATE_PASSWORD_MESSAGE =
  "A private link cannot have a share password or write password. Set link_access to public in the same request to add one.";
const PRIVATE_WRITE_POLICY_MESSAGE =
  "Only the creator can write private work, so write_policy must be owner. Set link_access to public in the same request to let the org write.";

/** WHERE fragment for a write that opens the object to others: it must still be public when it commits. */
export const STILL_PUBLIC_SQL = "ifnull(link_access, 'public') = 'public'";

export function privatePasswordConflict(): ApiError {
  return new ApiError(400, "link_access_conflict", PRIVATE_PASSWORD_MESSAGE);
}

function privateWritePolicyConflict(): ApiError {
  return new ApiError(400, "link_access_conflict", PRIVATE_WRITE_POLICY_MESSAGE);
}

/** Stored value to effective access. Anything but `private` (including legacy NULL) is public. */
export function storedLinkAccess(raw: string | null | undefined): LinkAccess {
  return raw === "private" ? "private" : "public";
}

/** A private object exists only for its creating account; everyone else, admins aside, gets not found. */
export function hiddenFrom(
  actor: Actor,
  row: { link_access?: string | null; created_by: string; owner_id?: string | null },
): boolean {
  return storedLinkAccess(row.link_access) === "private" && !canSetWritePolicy(actor, row.created_by, row.owner_id);
}

/** Request value: missing, null, or empty means unchanged; anything else must be public or private. */
export function requestedLinkAccess(raw: unknown): LinkAccess | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
  if (value === "") return undefined;
  if (value === "public" || value === "private") return value;
  throw new ApiError(400, "bad_link_access", "link_access must be public or private.");
}

export function linkAccessFromRequest(request: Request, form?: FormData): unknown {
  const header = request.headers.get(LINK_ACCESS_HEADER);
  if (header != null && header.trim() !== "") return header.trim();
  const value = form?.get("link_access");
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** New objects default to public. A private object is created without either password and owner-only for writes. */
export function resolveCreateAccess(
  env: Pick<Env, "WRITE_POLICY">,
  raw: unknown,
  writePolicy: unknown,
  passwordHash: string | null,
  writeHash: string | null,
): { access: LinkAccess; writePolicy: WritePolicy } {
  const access = requestedLinkAccess(raw) ?? "public";
  const resolvedWrite = resolveCreateWritePolicy(env, writePolicy);
  if (access === "public") return { access, writePolicy: resolvedWrite };
  if (passwordHash || writeHash) throw privatePasswordConflict();
  if (requestedWritePolicy(writePolicy) === "org") throw privateWritePolicyConflict();
  return { access, writePolicy: "owner" };
}

/** A password field from a PATCH: undefined = unchanged, null = cleared, string = set. */
type PasswordChange = string | null | undefined;

export type LinkAccessPatch = {
  next: LinkAccess;
  /** True when the stored link_access column must be written. */
  changed: boolean;
  /** The write policy to store: private work is always owner. */
  writePolicy: WritePolicy;
  /** True when write_policy must be written as owner: going private always writes it, since a concurrent PATCH may have set org after this read. */
  forcedOwner: boolean;
  /** True when cached public bytes must be purged. A retry after a failed purge finds access unchanged, so every PATCH that leaves the object private purges. */
  purge: boolean;
  /** WHERE fragment that keeps a concurrent write from leaving a private object with a password or org writes. */
  guardSql: string;
};

/**
 * Validates a PATCH against the invariants that a private object has no share or write password
 * and only its creator writes it. Going private keeps any existing password only if the same request clears it.
 */
export function patchLinkAccess(
  current: string | null | undefined,
  raw: unknown,
  existing: { password: boolean; writePassword: boolean; writePolicy: WritePolicy },
  change: { password: PasswordChange; writePassword: PasswordChange; writePolicy: WritePolicy | undefined },
): LinkAccessPatch {
  const stored = storedLinkAccess(current);
  const requested = requestedLinkAccess(raw);
  const next = requested ?? stored;
  const guards: string[] = [];
  if (next === "private") {
    if (change.password || change.writePassword) throw privatePasswordConflict();
    if (change.writePolicy === "org") throw privateWritePolicyConflict();
    const keepsPassword = change.password === undefined && existing.password;
    const keepsWritePassword = change.writePassword === undefined && existing.writePassword;
    if (keepsPassword || keepsWritePassword) {
      throw new ApiError(
        409,
        "link_access_conflict",
        'This object has a share password or write password. Send "password": "" and "write_password": "" in the same request to remove them and make the link private.',
        { password_protected: existing.password, write_password_protected: existing.writePassword },
      );
    }
    if (change.password === undefined) guards.push("password_hash IS NULL");
    if (change.writePassword === undefined) guards.push("write_password_hash IS NULL");
  } else if (requested === undefined && (change.password || change.writePassword || change.writePolicy === "org")) {
    guards.push(STILL_PUBLIC_SQL);
  }
  const changed = requested !== undefined && requested !== stored;
  const requestedWrite = change.writePolicy ?? existing.writePolicy;
  return {
    next,
    changed,
    writePolicy: next === "private" ? "owner" : requestedWrite,
    forcedOwner: next === "private" && (changed || requestedWrite !== "owner"),
    purge: changed || next === "private",
    guardSql: guards.length ? guards.join(" AND ") : "1 = 1",
  };
}

/** After a guarded PATCH changed nothing: throws if it lost a race with a write that changed access or passwords. */
export async function assertLinkAccessGuard(db: D1Database, table: "sites" | "loose_files", id: string, guardSql: string): Promise<void> {
  const guarded = await db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ? AND ${guardSql}`).bind(id).first();
  if (!guarded) {
    throw new ApiError(409, "link_access_conflict", "Link access or a password changed while this update ran. Read the object again and retry.");
  }
}

// Content-host bodies never name the hub origin or /v1; key holders already know where the API is.
const LINK_PRIVATE_MESSAGE = "This link is private. Only its owner's API keys for this Energon can read it, through the API, by the id in this URL.";

/** Every public-URL request to a private object. Browsers get a page; everything else gets JSON. */
export function linkPrivateResponse(request: Request): Response {
  const headers = { "cache-control": "no-store" };
  if ((request.headers.get("accept") || "").includes("text/html")) {
    return htmlPage(
      `<!doctype html><meta charset="utf-8"><title>Private link</title><p>This link is private. Only its owner can read it, through the API.</p>`,
      403,
      headers,
    );
  }
  return json({ error: "link_private", message: LINK_PRIVATE_MESSAGE }, 403, headers);
}

export function linkPrivateError(): ApiError {
  return new ApiError(403, "link_private", LINK_PRIVATE_MESSAGE);
}
