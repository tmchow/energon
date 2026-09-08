import { json, publicOrigin, totalStoredBytes, usedStorage } from "./http";
import { requireAdmin, requireHuman } from "./auth";
import { requireAdminActor } from "./audit";
import { GATE_MAX_FAILS, GATE_WINDOW_MS } from "./gate";
import { PURGE_CLAIM_LIKE, staleClaimCutoff } from "./expire";
import { instancePolicy } from "./policy";
import type { AdminHealthSnapshot } from "./page-data";
import type { Env } from "./types";

async function count(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const stmt = env.DB.prepare(sql);
  const row = await (binds.length ? stmt.bind(...binds) : stmt).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function loadAdminHealth(env: Env, now = Date.now()): Promise<AdminHealthSnapshot> {
  const iso = new Date(now).toISOString();
  const staleBefore = staleClaimCutoff(now);
  const gateWindowStart = new Date(now - GATE_WINDOW_MS).toISOString();
  const [
    usedBytes,
    catalogBytes,
    sites,
    looseFiles,
    siteFiles,
    people,
    expiredSites,
    expiredFiles,
    staleSites,
    staleFiles,
    locked,
  ] = await Promise.all([
    usedStorage(env.DB),
    totalStoredBytes(env.DB),
    count(env, `SELECT COUNT(*) AS n FROM sites`),
    count(env, `SELECT COUNT(*) AS n FROM loose_files`),
    count(env, `SELECT COUNT(*) AS n FROM site_files`),
    count(env, `SELECT COUNT(*) AS n FROM users`),
    count(env, `SELECT COUNT(*) AS n FROM sites WHERE expires_at IS NOT NULL AND expires_at <= ?`, iso),
    count(env, `SELECT COUNT(*) AS n FROM loose_files WHERE expires_at IS NOT NULL AND expires_at <= ?`, iso),
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
    env.DB.prepare(
      `SELECT scope FROM gate_attempts WHERE fails >= ? AND window_start >= ? ORDER BY scope`,
    )
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
    expired_awaiting_purge: expiredSites + expiredFiles,
    stale_purge_claims: staleSites + staleFiles,
    locked_gates: lockedScopes.length,
    locked_scopes: lockedScopes,
    sites,
    files: looseFiles + siteFiles,
    people,
  };
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
