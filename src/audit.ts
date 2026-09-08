import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, decodeCursor, encodeCursor } from "./catalog";
import { nanoid, secretJson } from "./http";
import type { Actor, Env } from "./types";

const TARGET_JSON_MAX = 8192;
const SECRET_KEY = /password|token|secret|authorization/i;

export type AdminAuditWrite = {
  action: string;
  target: unknown;
  matched?: number;
  eligible?: number;
  applied?: number;
  skipped?: number;
  failed?: number;
  confirm?: string | null;
};

export type AdminAuditEvent = {
  id: string;
  at: string;
  actor_email: string;
  token_id: string | null;
  action: string;
  target: Record<string, unknown>;
  matched: number;
  eligible: number;
  applied: number;
  skipped: number;
  failed: number;
  confirm: string | null;
};

type AuditRow = {
  id: string;
  at: string;
  actor_email: string;
  token_id: string | null;
  action: string;
  target_json: string;
  matched: number;
  eligible: number;
  applied: number;
  skipped: number;
  failed: number;
  confirm: string | null;
};

export function sanitizeAuditTarget(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item) => item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
      continue;
    }
    if (typeof value === "object") out[key] = sanitizeAuditTarget(value);
  }
  return out;
}

function count(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export async function recordAdminAudit(env: Env, actor: Actor, write: AdminAuditWrite): Promise<AdminAuditEvent> {
  const target = sanitizeAuditTarget(write.target);
  let targetJson = JSON.stringify(target);
  if (targetJson.length > TARGET_JSON_MAX) targetJson = JSON.stringify({ truncated: true });
  const action = write.action.trim().slice(0, 64) || "unknown";
  const event: AdminAuditEvent = {
    id: nanoid(12),
    at: new Date().toISOString(),
    actor_email: actor.email,
    token_id: actor.tokenId ?? null,
    action,
    target,
    matched: count(write.matched),
    eligible: count(write.eligible),
    applied: count(write.applied),
    skipped: count(write.skipped),
    failed: count(write.failed),
    confirm: write.confirm ?? null,
  };
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, at, actor_email, token_id, action, target_json, matched, eligible, applied, skipped, failed, confirm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.id,
      event.at,
      event.actor_email,
      event.token_id,
      event.action,
      targetJson,
      event.matched,
      event.eligible,
      event.applied,
      event.skipped,
      event.failed,
      event.confirm,
    )
    .run();
  return event;
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIST_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.round(parsed)));
}

function parseAuditCursor(raw: string | null): { at: string; id: string } | null {
  const parts = decodeCursor(raw);
  if (!parts || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { at: parts[0], id: parts[1] };
}

function publicEvent(row: AuditRow): AdminAuditEvent {
  let target: Record<string, unknown> = {};
  try {
    target = sanitizeAuditTarget(JSON.parse(row.target_json));
  } catch {
    target = {};
  }
  return {
    id: row.id,
    at: row.at,
    actor_email: row.actor_email,
    token_id: row.token_id,
    action: row.action,
    target,
    matched: row.matched,
    eligible: row.eligible,
    applied: row.applied,
    skipped: row.skipped,
    failed: row.failed,
    confirm: row.confirm,
  };
}

export async function listAdminAudit(
  env: Env,
  url: URL,
): Promise<{ events: AdminAuditEvent[]; total: number; next_cursor: string | null }> {
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = parseAuditCursor(url.searchParams.get("cursor"));
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit`).first<{ n: number }>();
  const total = totalRow?.n ?? 0;
  const page = cursor
    ? await env.DB.prepare(
        `SELECT id, at, actor_email, token_id, action, target_json, matched, eligible, applied, skipped, failed, confirm
         FROM admin_audit
         WHERE at < ? OR (at = ? AND id < ?)
         ORDER BY at DESC, id DESC
         LIMIT ?`,
      )
        .bind(cursor.at, cursor.at, cursor.id, limit + 1)
        .all<AuditRow>()
    : await env.DB.prepare(
        `SELECT id, at, actor_email, token_id, action, target_json, matched, eligible, applied, skipped, failed, confirm
         FROM admin_audit
         ORDER BY at DESC, id DESC
         LIMIT ?`,
      )
        .bind(limit + 1)
        .all<AuditRow>();
  const rows = page.results || [];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice.at(-1);
  return {
    events: slice.map(publicEvent),
    total,
    next_cursor: hasMore && last ? encodeCursor([last.at, last.id]) : null,
  };
}

export async function auditListResponse(env: Env, url: URL): Promise<Response> {
  return secretJson(await listAdminAudit(env, url));
}
