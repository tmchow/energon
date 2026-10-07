import { ApiError, json, publicOrigin, recomputeStorage, totalStoredBytes, usedStorage } from "./http";
import { requireAdmin, requireHuman } from "./auth";
import { recordAdminAudit } from "./audit";
import { GATE_MAX_FAILS, GATE_WINDOW_MS } from "./gate";
import { d1Changed, LEGACY_RECOVERY_REQUIRED_SQL, PURGE_CLAIM_LIKE, staleClaimCutoff, sweepExpired, UNRESOLVED_LEGACY_SQL } from "./expire";
import { instancePolicy } from "./policy";
import type { Actor, Env } from "./types";
import type { AdminHealthSnapshot, FileRecoveryItem, GateUnlockResult, QuotaRecomputeResult, SweepNowResult } from "./page-data";
import { storageCleanupStatus } from "./site-storage";
import { SITE_FILE_COUNT_SQL, SITE_FILE_TOTALS_JOIN_SQL } from "./catalog";

async function count(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const stmt = env.DB.prepare(sql);
  const row = await (binds.length ? stmt.bind(...binds) : stmt).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function countExpired(env: Env, now = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const sites = await count(env, `SELECT COUNT(*) AS n FROM sites WHERE lifecycle_state = 'live' AND expires_at IS NOT NULL AND expires_at <= ?`, iso);
  const files = await count(env, `SELECT COUNT(*) AS n FROM loose_files WHERE expires_at IS NOT NULL AND expires_at <= ?`, iso);
  return sites + files;
}

export async function loadAdminHealth(env: Env, now = Date.now()): Promise<AdminHealthSnapshot> {
  const staleBefore = staleClaimCutoff(now);
  const gateWindowStart = new Date(now - GATE_WINDOW_MS).toISOString();
  const [usedBytes, catalogBytes, sites, looseFiles, siteFiles, people, expired, staleSites, staleFiles, locked] =
    await Promise.all([
      usedStorage(env.DB),
      totalStoredBytes(env.DB),
      count(env, `SELECT COUNT(*) AS n FROM sites WHERE lifecycle_state = 'live'`),
      count(env, `SELECT COUNT(*) AS n FROM loose_files`),
      count(env, `SELECT ${SITE_FILE_COUNT_SQL} AS n FROM sites s ${SITE_FILE_TOTALS_JOIN_SQL} WHERE s.lifecycle_state = 'live'`),
      count(env, `SELECT COUNT(*) AS n FROM users`),
      countExpired(env, now),
      count(
        env,
        `SELECT COUNT(*) AS n FROM sites WHERE last_written_by LIKE ? AND (updated_at IS NULL OR updated_at <= ?)`,
        PURGE_CLAIM_LIKE,
        staleBefore,
      ),
      count(
        env,
        `SELECT COUNT(*) AS n FROM loose_files WHERE last_written_by LIKE ? AND (updated_at IS NULL OR updated_at <= ?)`,
        PURGE_CLAIM_LIKE,
        staleBefore,
      ),
      env.DB.prepare(`SELECT scope FROM gate_attempts WHERE fails >= ? AND window_start >= ? ORDER BY scope`)
        .bind(GATE_MAX_FAILS, gateWindowStart)
        .all<{ scope: string }>(),
    ]);
  const lockedScopes = (locked.results || []).map((row) => row.scope);
  const [cleanup, fileRecoveries] = await Promise.all([storageCleanupStatus(env.DB), loadFileRecoveries(env, now)]);
  const conversions = await env.DB.prepare(`SELECT s.id AS site_id, s.slug, COALESCE(c.phase, 'pending') AS phase, c.last_error
    FROM sites s LEFT JOIN site_conversions c ON c.site_id = s.id
    WHERE s.lifecycle_state = 'live' AND s.active_version_id IS NULL
    ORDER BY c.last_error IS NOT NULL DESC, COALESCE(c.updated_at, s.created_at), s.id LIMIT 25`).all<{ site_id: string; slug: string; phase: string; last_error: string | null }>();
  return {
    quota: {
      used_bytes: usedBytes,
      catalog_bytes: catalogBytes,
      limit_bytes: instancePolicy(env).platformBytes,
      pending_cleanup_bytes: cleanup.pendingBytes,
      cleanup_failed_allocations: cleanup.failedAllocations,
    },
    site_conversions: {
      enabled: env.SITE_VERSIONING_ENABLED === "true",
      pending: await count(env, "SELECT COUNT(*) AS n FROM sites WHERE lifecycle_state = 'live' AND active_version_id IS NULL"),
      items: conversions.results,
    },
    file_recoveries: fileRecoveries,
    expired_awaiting_purge: expired,
    stale_purge_claims: staleSites + staleFiles,
    locked_gates: lockedScopes.length,
    locked_scopes: lockedScopes,
    sites,
    files: looseFiles + siteFiles,
    people,
  };
}

type FileRecoveryRow = Omit<FileRecoveryItem, "snapshot_retained" | "recovery_required"> & { snapshot_retained: number; recovery_required: number };

async function loadFileRecoveries(env: Env, now: number): Promise<AdminHealthSnapshot["file_recoveries"]> {
  const iso = new Date(now).toISOString();
  const [totals, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS pending, COALESCE(SUM(${LEGACY_RECOVERY_REQUIRED_SQL}), 0) AS required
      FROM storage_allocations a WHERE ${UNRESOLVED_LEGACY_SQL}`).bind(iso).first<{ pending: number; required: number }>(),
    env.DB.prepare(`SELECT a.id AS allocation_id, json_extract(a.recovery_json, '$.fileId') AS file_id,
      f.filename, json_extract(a.recovery_json, '$.operation') AS operation, a.state, a.created_at, a.cleanup_error,
      json_extract(a.recovery_json, '$.snapshotKey') IS NOT NULL AS snapshot_retained,
      ${LEGACY_RECOVERY_REQUIRED_SQL} AS recovery_required
    FROM storage_allocations a LEFT JOIN loose_files f ON f.id = json_extract(a.recovery_json, '$.fileId')
    WHERE ${UNRESOLVED_LEGACY_SQL}
    ORDER BY recovery_required DESC, a.created_at, a.id LIMIT 25`).bind(iso).all<FileRecoveryRow>(),
  ]);
  return {
    pending: Number(totals?.pending ?? 0),
    recovery_required: Number(totals?.required ?? 0),
    items: rows.results.map((row) => ({
      ...row,
      snapshot_retained: Boolean(row.snapshot_retained),
      recovery_required: Boolean(row.recovery_required),
    })),
  };
}

export async function recomputeQuota(env: Env, actor: Actor): Promise<QuotaRecomputeResult> {
  const result = await recomputeStorage(env.DB);
  await recordAdminAudit(env, actor, {
    action: "quota_recompute",
    executed: true,
    target: {},
    matched: result.before,
    applied: result.after,
  });
  return { used_before: result.before, used_after: result.after };
}

export async function sweepNow(env: Env, ctx: ExecutionContext, actor: Actor): Promise<SweepNowResult> {
  const swept = await sweepExpired(env, ctx);
  const expired_remaining = await countExpired(env);
  await recordAdminAudit(env, actor, {
    action: "sweep",
    executed: true,
    target: {},
    applied: swept.sites + swept.files,
    matched: expired_remaining,
  });
  return { swept, expired_remaining };
}

export async function unlockGate(env: Env, actor: Actor, body: unknown): Promise<GateUnlockResult> {
  const scope = parseUnlockScope(body);
  const deleted = await env.DB.prepare(`DELETE FROM gate_attempts WHERE scope = ?`).bind(scope).run();
  const unlocked = d1Changed(deleted);
  await recordAdminAudit(env, actor, {
    action: "gate_unlock",
    executed: true,
    target: { scope },
    applied: unlocked ? 1 : 0,
  });
  return { scope, unlocked };
}

function parseUnlockScope(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "bad_json", "Send a JSON object body.");
  }
  const scope = (body as { scope?: unknown }).scope;
  if (typeof scope !== "string" || !scope.trim()) {
    throw new ApiError(400, "bad_target", "Give the gate scope to unlock, such as obj:/handle/f/id/ or ip:.");
  }
  return scope.trim();
}

export async function hubAdminHealthResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await loadAdminHealth(env));
}

export async function hubAdminRecomputeResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await recomputeQuota(env, actor));
}

export async function hubAdminSweepResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await sweepNow(env, ctx, actor));
}

export async function hubAdminUnlockResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  body: unknown,
): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await unlockGate(env, actor, body));
}
