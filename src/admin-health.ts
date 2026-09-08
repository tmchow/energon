import { ApiError, json, publicOrigin, recomputeStorage, totalStoredBytes, usedStorage } from "./http";
import { requireAdmin, requireHuman } from "./auth";
import { recordAdminAudit, requireAdminActor } from "./audit";
import { GATE_MAX_FAILS, GATE_WINDOW_MS } from "./gate";
import { d1Changed, PURGE_CLAIM_LIKE, staleClaimCutoff, sweepExpired } from "./expire";
import { instancePolicy } from "./policy";
import type { Actor, Env } from "./types";
import type { AdminHealthSnapshot, GateUnlockResult, QuotaRecomputeResult, SweepNowResult } from "./page-data";

async function count(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const stmt = env.DB.prepare(sql);
  const row = await (binds.length ? stmt.bind(...binds) : stmt).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function countExpired(env: Env, now = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const sites = await count(env, `SELECT COUNT(*) AS n FROM sites WHERE expires_at IS NOT NULL AND expires_at <= ?`, iso);
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
      count(env, `SELECT COUNT(*) AS n FROM sites`),
      count(env, `SELECT COUNT(*) AS n FROM loose_files`),
      count(env, `SELECT COUNT(*) AS n FROM site_files`),
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
  return {
    quota: {
      used_bytes: usedBytes,
      catalog_bytes: catalogBytes,
      limit_bytes: instancePolicy(env).platformBytes,
    },
    expired_awaiting_purge: expired,
    stale_purge_claims: staleSites + staleFiles,
    locked_gates: lockedScopes.length,
    locked_scopes: lockedScopes,
    sites,
    files: looseFiles + siteFiles,
    people,
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
    throw new ApiError(400, "bad_target", "Give the gate scope to unlock, such as obj:/handle/f/id/name or ip:.");
  }
  return scope.trim();
}

export async function adminHealthResponse(request: Request, env: Env): Promise<Response> {
  await requireAdminActor(request, env);
  return json(await loadAdminHealth(env));
}

export async function hubAdminHealthResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await loadAdminHealth(env));
}

export async function adminRecomputeResponse(request: Request, env: Env): Promise<Response> {
  const actor = await requireAdminActor(request, env);
  return json(await recomputeQuota(env, actor));
}

export async function hubAdminRecomputeResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await recomputeQuota(env, actor));
}

export async function adminSweepResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireAdminActor(request, env);
  return json(await sweepNow(env, ctx, actor));
}

export async function hubAdminSweepResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  requireAdmin(actor, publicOrigin(env));
  return json(await sweepNow(env, ctx, actor));
}

export async function adminUnlockResponse(request: Request, env: Env, body: unknown): Promise<Response> {
  const actor = await requireAdminActor(request, env);
  return json(await unlockGate(env, actor, body));
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
