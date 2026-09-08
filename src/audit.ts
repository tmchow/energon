import { json, nanoid, publicOrigin } from "./http";
import { requireAdmin, requireToken } from "./auth";
import type { Actor, Env } from "./types";

export const AUDIT_DEFAULT_LIMIT = 25;
export const AUDIT_MAX_LIMIT = 50;

export type AdminAuditAction = "cleanup";

export type AdminAuditInput = {
  action: AdminAuditAction;
  executed: boolean;
  actionKind?: string | null;
  ttl?: string | null;
  target: unknown;
  matched?: number | null;
  eligible?: number | null;
  applied?: number | null;
  skipped?: number | null;
  failed?: number | null;
  bytes?: number | null;
  confirm?: string | null;
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

type AuditRow = {
  id: string;
  created_at: string;
  actor_email: string;
  token_id: string | null;
  token_hint: string | null;
  action: string;
  executed: number;
  action_kind: string | null;
  ttl: string | null;
  target_json: string;
  matched: number | null;
  eligible: number | null;
  applied: number | null;
  skipped: number | null;
  failed: number | null;
  bytes: number | null;
  confirm: string | null;
};

function parseTarget(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function fromRow(row: AuditRow): AdminAuditEvent {
  return {
    id: row.id,
    created_at: row.created_at,
    actor_email: row.actor_email,
    token_id: row.token_id,
    token_hint: row.token_hint,
    action: row.action,
    executed: Boolean(row.executed),
    action_kind: row.action_kind,
    ttl: row.ttl,
    target: parseTarget(row.target_json),
    matched: row.matched,
    eligible: row.eligible,
    applied: row.applied,
    skipped: row.skipped,
    failed: row.failed,
    bytes: row.bytes,
    confirm: row.confirm,
  };
}

async function tokenHintFor(env: Env, actor: Actor): Promise<string | null> {
  if (!actor.tokenId) return null;
  const row = await env.DB.prepare(`SELECT token_hint FROM tokens WHERE id = ?`)
    .bind(actor.tokenId)
    .first<{ token_hint: string | null }>();
  return row?.token_hint ?? null;
}

export async function recordAdminAudit(env: Env, actor: Actor, input: AdminAuditInput): Promise<AdminAuditEvent> {
  const id = nanoid(12);
  const created_at = new Date().toISOString();
  const token_hint = actor.tokenId ? await tokenHintFor(env, actor) : null;
  const target_json = JSON.stringify(input.target ?? {});
  await env.DB.prepare(
    `INSERT INTO admin_audit (
       id, created_at, actor_email, token_id, token_hint, action, executed, action_kind, ttl,
       target_json, matched, eligible, applied, skipped, failed, bytes, confirm
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      created_at,
      actor.email,
      actor.tokenId ?? null,
      token_hint,
      input.action,
      input.executed ? 1 : 0,
      input.actionKind ?? null,
      input.ttl ?? null,
      target_json,
      input.matched ?? null,
      input.eligible ?? null,
      input.applied ?? null,
      input.skipped ?? null,
      input.failed ?? null,
      input.bytes ?? null,
      input.confirm ?? null,
    )
    .run();
  return {
    id,
    created_at,
    actor_email: actor.email,
    token_id: actor.tokenId ?? null,
    token_hint,
    action: input.action,
    executed: input.executed,
    action_kind: input.actionKind ?? null,
    ttl: input.ttl ?? null,
    target: input.target ?? {},
    matched: input.matched ?? null,
    eligible: input.eligible ?? null,
    applied: input.applied ?? null,
    skipped: input.skipped ?? null,
    failed: input.failed ?? null,
    bytes: input.bytes ?? null,
    confirm: input.confirm ?? null,
  };
}

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

export async function listAdminAudit(
  env: Env,
  url: URL,
): Promise<{ events: AdminAuditEvent[]; next_cursor: string | null }> {
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const sql = cursor
    ? `SELECT * FROM admin_audit
       WHERE created_at < ? OR (created_at = ? AND id < ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    : `SELECT * FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT ?`;
  const binds = cursor ? [cursor.created_at, cursor.created_at, cursor.id, limit + 1] : [limit + 1];
  const rows = await env.DB.prepare(sql).bind(...binds).all<AuditRow>();
  const found = rows.results || [];
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return {
    events: page.map(fromRow),
    next_cursor: found.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

export async function requireAdminActor(request: Request, env: Env): Promise<Actor> {
  const actor = await requireToken(request, env);
  requireAdmin(actor, publicOrigin(env));
  return actor;
}

export async function adminAuditResponse(request: Request, env: Env): Promise<Response> {
  await requireAdminActor(request, env);
  return json(await listAdminAudit(env, new URL(request.url)));
}
