import { getUser, getUserByHandle, type User } from "./handles";
import {
  bulkRevokeOutcomeResponse,
  bulkRevokeTokens,
  readTokenScope,
  requireAdmin,
  requireHuman,
  requireToken,
  type BulkRevokeOutcome,
  type TokenListing,
} from "./auth";
import { tokenStatus } from "./token-status";
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT, recordAdminAudit } from "./audit";
import { ApiError, publicOrigin, secretJson } from "./http";
import type { Actor, Env } from "./types";

export type AdminTokenRow = TokenListing & {
  owner_email: string;
  owner_handle: string;
};

export type AdminTokenList = {
  tokens: AdminTokenRow[];
  next_cursor: string | null;
};

type AdminTokenListRow = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  token_hint: string | null;
  expires_at: string | null;
  scope: string | null;
  owner_email: string;
  owner_handle: string | null;
};

function parseLimit(raw: string | null): number {
  if (raw == null || raw === "") return AUDIT_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return AUDIT_DEFAULT_LIMIT;
  return Math.min(AUDIT_MAX_LIMIT, Math.max(1, Math.round(n)));
}

function decodeCursor(raw: string | null): { created_at: string; id: string } | null {
  if (!raw) return null;
  const cut = raw.indexOf("|");
  if (cut <= 0) return null;
  const created_at = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (!created_at || !id) return null;
  return { created_at, id };
}

export async function resolveOwner(env: Env, raw: string): Promise<User | null> {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return getUser(env, trimmed);
  return getUserByHandle(env, trimmed);
}

function toListing(row: AdminTokenListRow, now: number): AdminTokenRow {
  const status = tokenStatus(row, now);
  return {
    id: row.id,
    label: row.label,
    hint: row.token_hint,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at ?? null,
    scope: readTokenScope(row.scope),
    status,
    expired: status === "expired",
    revoked: status === "revoked",
    recoverable: false,
    owner_email: row.owner_email,
    owner_handle: row.owner_handle || "",
  };
}

export async function listAdminTokens(env: Env, url: URL, now = Date.now()): Promise<AdminTokenList> {
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const ownerRaw = url.searchParams.get("owner");
  const owner = ownerRaw && ownerRaw.trim() ? await resolveOwner(env, ownerRaw) : null;
  if (ownerRaw && ownerRaw.trim() && !owner) {
    return { tokens: [], next_cursor: null };
  }

  const columns = `t.id, t.label, t.created_at, t.last_used_at, t.revoked_at, t.token_hint, t.expires_at, t.scope,
       COALESCE(u.email, t.user_email) AS owner_email,
       COALESCE(u.handle, '') AS owner_handle`;
  const join = `FROM tokens t
       LEFT JOIN users u ON u.id = t.user_id OR (t.user_id IS NULL AND u.email = t.user_email)`;
  const order = `ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;

  let sql: string;
  const binds: unknown[] = [];
  const ownerClause = owner ? `(t.user_id = ? OR (t.user_id IS NULL AND t.user_email = ?))` : null;
  if (owner && cursor) {
    sql = `SELECT ${columns} ${join}
       WHERE ${ownerClause}
         AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
       ${order}`;
    binds.push(owner.id, owner.email, cursor.created_at, cursor.created_at, cursor.id, limit + 1);
  } else if (owner) {
    sql = `SELECT ${columns} ${join} WHERE ${ownerClause} ${order}`;
    binds.push(owner.id, owner.email, limit + 1);
  } else if (cursor) {
    sql = `SELECT ${columns} ${join}
       WHERE t.created_at < ? OR (t.created_at = ? AND t.id < ?)
       ${order}`;
    binds.push(cursor.created_at, cursor.created_at, cursor.id, limit + 1);
  } else {
    sql = `SELECT ${columns} ${join} ${order}`;
    binds.push(limit + 1);
  }

  const rows = await env.DB.prepare(sql).bind(...binds).all<AdminTokenListRow>();
  const found = rows.results || [];
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return {
    tokens: page.map((row) => toListing(row, now)),
    next_cursor: found.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

export async function adminTokensListResponse(request: Request, env: Env): Promise<Response> {
  const actor = await requireToken(request, env);
  requireAdmin(actor, publicOrigin(env));
  return secretJson(await listAdminTokens(env, new URL(request.url)));
}

export async function hubAdminTokensListResponse(
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, "access">,
): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return secretJson(await listAdminTokens(env, new URL(request.url)));
}

function parseOwnerField(body: Record<string, unknown>): string {
  const raw = body.owner;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ApiError(400, "bad_owner", "owner must be a handle or email.");
  }
  return raw.trim();
}

async function recordTokensAudit(
  env: Env,
  actor: Actor,
  owner: string,
  body: Record<string, unknown>,
  outcome: BulkRevokeOutcome,
): Promise<void> {
  const preview = outcome.kind === "executed" ? null : outcome.preview;
  const result = outcome.kind === "executed" ? outcome.result : null;
  await recordAdminAudit(env, actor, {
    action: "tokens",
    executed: outcome.kind === "executed",
    actionKind: (preview ?? result)?.target,
    target: { owner },
    matched: preview?.matched ?? result?.revoked ?? null,
    eligible: preview?.matched ?? result?.revoked ?? null,
    applied: result?.revoked ?? null,
    confirm: preview?.confirm ?? (typeof body.confirm === "string" ? body.confirm : null),
  });
}

export async function revokeAdminTokens(
  env: Env,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<Response> {
  const ownerRaw = parseOwnerField(body);
  const owner = await resolveOwner(env, ownerRaw);
  if (!owner) {
    throw new ApiError(400, "bad_owner", "No account matches that owner.");
  }
  const outcome = await bulkRevokeTokens(env, owner.email, owner.id, body, {
    excludeIds: actor.tokenId ? [actor.tokenId] : [],
  });
  await recordTokensAudit(env, actor, ownerRaw, body, outcome);
  return bulkRevokeOutcomeResponse(
    env,
    outcome,
    "Those tokens changed since that preview. Review this fresh preview and resend with its confirm.",
  );
}
