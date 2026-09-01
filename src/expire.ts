import { filePrefix, purgeContent, sitePrefix } from "./cache";
import { fileKey } from "./config";
import { ApiError, deletePrefix, htmlPage } from "./http";
import type { Env } from "./types";

const SWEEP_BATCH = 100;

export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function remainingCacheSeconds(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - now) / 1000));
}

export function expiredError(kind: "site" | "file"): ApiError {
  return new ApiError(410, "expired", `That ${kind} has expired and is gone.`);
}

export function expiredHtml(kind: "site" | "file"): Response {
  return htmlPage(
    `<!doctype html><meta charset="utf-8"><title>Expired</title><p>This ${kind} expired and is gone.</p>`,
    410,
    { "cache-control": "no-store" },
  );
}

function d1Changed(result: { meta?: { changes?: number } }): boolean {
  return Number(result.meta?.changes ?? 0) > 0;
}

/** True when this row is still the expired generation we started sweeping. */
function stillExpiredGeneration(
  row: { expires_at: string | null } | null,
  claimedExpiresAt: string,
  now = Date.now(),
): boolean {
  return !!row && row.expires_at === claimedExpiresAt && isExpired(row.expires_at, now);
}

/**
 * Hold the slug until R2 is gone, then drop the catalog row.
 * A concurrent create cannot INSERT the same PK while the expired row remains.
 * If TTL was reset, skip the catalog delete so revived metadata stays.
 */
export async function purgeExpiredSite(
  env: Env,
  ctx: ExecutionContext | undefined,
  handle: string,
  slug: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT expires_at FROM sites WHERE handle = ? AND slug = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(handle, slug, now)
    .first<{ expires_at: string }>();
  if (!row) return false;

  await deletePrefix(env.BUCKET, `sites/${handle}/${slug}/`);

  const still = await env.DB.prepare(`SELECT expires_at FROM sites WHERE handle = ? AND slug = ?`)
    .bind(handle, slug)
    .first<{ expires_at: string | null }>();
  if (!stillExpiredGeneration(still, row.expires_at)) return false;

  await env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ?`).bind(handle, slug).run();
  const dropped = await env.DB.prepare(
    `DELETE FROM sites WHERE handle = ? AND slug = ? AND expires_at IS NOT NULL AND expires_at = ? AND expires_at <= ?`,
  )
    .bind(handle, slug, row.expires_at, now)
    .run();
  if (!d1Changed(dropped)) return false;
  purgeContent(ctx, [sitePrefix(handle, slug)]);
  return true;
}

export async function purgeExpiredFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  id: string,
  handle: string | null,
  filename: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT expires_at FROM loose_files WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(id, now)
    .first<{ expires_at: string }>();
  if (!row) return false;

  await env.BUCKET.delete(fileKey(id, filename));

  const still = await env.DB.prepare(`SELECT expires_at FROM loose_files WHERE id = ?`)
    .bind(id)
    .first<{ expires_at: string | null }>();
  if (!stillExpiredGeneration(still, row.expires_at)) return false;

  const dropped = await env.DB.prepare(
    `DELETE FROM loose_files WHERE id = ? AND expires_at IS NOT NULL AND expires_at = ? AND expires_at <= ?`,
  )
    .bind(id, row.expires_at, now)
    .run();
  if (!d1Changed(dropped)) return false;
  if (handle) purgeContent(ctx, [filePrefix(handle, id)]);
  return true;
}

export function schedulePurgeExpiredSite(
  env: Env,
  ctx: ExecutionContext | undefined,
  handle: string,
  slug: string,
): void {
  if (!ctx) return;
  ctx.waitUntil(purgeExpiredSite(env, ctx, handle, slug).catch(() => undefined));
}

export function schedulePurgeExpiredFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  id: string,
  handle: string | null,
  filename: string,
): void {
  if (!ctx) return;
  ctx.waitUntil(purgeExpiredFile(env, ctx, id, handle, filename).catch(() => undefined));
}

export async function sweepExpired(
  env: Env,
  ctx: ExecutionContext | undefined,
): Promise<{ sites: number; files: number }> {
  const now = new Date().toISOString();
  let sites = 0;
  let files = 0;

  const siteRows = await env.DB.prepare(
    `SELECT handle, slug FROM sites WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`,
  )
    .bind(now, SWEEP_BATCH)
    .all<{ handle: string; slug: string }>();
  for (const row of siteRows.results || []) {
    if (await purgeExpiredSite(env, ctx, row.handle, row.slug)) sites += 1;
  }

  const fileRows = await env.DB.prepare(
    `SELECT id, handle, filename FROM loose_files WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`,
  )
    .bind(now, SWEEP_BATCH)
    .all<{ id: string; handle: string | null; filename: string }>();
  for (const row of fileRows.results || []) {
    if (await purgeExpiredFile(env, ctx, row.id, row.handle, row.filename)) files += 1;
  }

  return { sites, files };
}
