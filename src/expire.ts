import { filePrefix, purgeContent, sitePrefix } from "./cache";
import { fileKey } from "./config";
import { ApiError, deletePrefix, htmlPage, releaseStorage } from "./http";
import { OWNER_WRITE_SQL, ownerWriteBinds } from "./policy";
import type { Actor, Env, LooseFileRow } from "./types";

const SWEEP_BATCH = 100;
const STALE_CLAIM_MS = 60_000;
const inFlight = new Set<string>();

/** In-place lock so a concurrent PATCH ttl cannot revive bytes we are about to delete. */
export const PURGE_CLAIM = "__energon_purging__";
export const PURGE_CLAIM_LIKE = `${PURGE_CLAIM}%`;
export const WRITE_CLAIM = "__energon_writing__";
export const WRITE_CLAIM_LIKE = `${WRITE_CLAIM}%`;

export function isPurgeClaimed(lastWrittenBy: string | null | undefined): boolean {
  return typeof lastWrittenBy === "string" && lastWrittenBy.startsWith(PURGE_CLAIM);
}

export function isWriteClaimed(lastWrittenBy: string | null | undefined): boolean {
  return typeof lastWrittenBy === "string" && lastWrittenBy.startsWith(WRITE_CLAIM);
}

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

type Claim = { expiresAt: string; restoreWriter: string; token: string; filename?: string; size?: number };

function newPurgeToken(): string {
  return `${PURGE_CLAIM}:${crypto.randomUUID()}`;
}

function newWriteToken(): string {
  return `${WRITE_CLAIM}:${crypto.randomUUID()}`;
}

export { newWriteToken };

export function staleClaimCutoff(now = Date.now()): string {
  return new Date(now - STALE_CLAIM_MS).toISOString();
}

export function isStaleClaim(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && now - t >= STALE_CLAIM_MS;
}

export type LooseFileWriteClaim = { restoreWriter: string; restoreUpdatedAt: string | null; token: string };
type LooseFileClaimState = Pick<LooseFileRow, "expires_at" | "last_written_by" | "updated_at" | "created_by">;

export async function claimLooseFileForWrite(
  env: Env,
  id: string,
  state: LooseFileClaimState,
  actor: Actor,
): Promise<LooseFileWriteClaim | null> {
  return claimLooseFile(env, id, state, false, actor);
}

export async function claimLooseFileForDelete(
  env: Env,
  id: string,
  state: LooseFileClaimState,
  actor: Actor,
): Promise<LooseFileWriteClaim | null> {
  return claimLooseFile(env, id, state, true, actor);
}

async function claimLooseFile(
  env: Env,
  id: string,
  state: LooseFileClaimState,
  allowExpired: boolean,
  actor: Actor,
): Promise<LooseFileWriteClaim | null> {
  const now = new Date().toISOString();
  const staleBefore = staleClaimCutoff();
  const token = newWriteToken();
  const claimed = await env.DB.prepare(
    `UPDATE loose_files SET last_written_by = ?, updated_at = ?
     WHERE id = ? AND (? = 1 OR expires_at IS NULL OR expires_at > ?)
       AND ((expires_at = ?) OR (expires_at IS NULL AND ? IS NULL))
       AND ifnull(last_written_by, '') = ?
       AND ifnull(last_written_by, '') NOT LIKE ?
       AND (ifnull(last_written_by, '') NOT LIKE ? OR updated_at IS NULL OR updated_at <= ?)
       AND ${OWNER_WRITE_SQL}`,
  )
    .bind(
      token,
      now,
      id,
      allowExpired ? 1 : 0,
      now,
      state.expires_at,
      state.expires_at,
      state.last_written_by ?? "",
      PURGE_CLAIM_LIKE,
      WRITE_CLAIM_LIKE,
      staleBefore,
      ...ownerWriteBinds(actor),
    )
    .run();
  if (!d1Changed(claimed)) return null;
  return {
    restoreWriter: isWriteClaimed(state.last_written_by) ? state.created_by : state.last_written_by || state.created_by,
    restoreUpdatedAt: state.updated_at,
    token,
  };
}

export async function finalizeLooseFileWriteClaim(
  env: Env,
  id: string,
  token: string,
  lastWrittenBy: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, written_via = NULL WHERE id = ? AND last_written_by = ?`)
    .bind(lastWrittenBy, id, token)
    .run();
}

export async function restoreLooseFileWriteClaim(
  env: Env,
  id: string,
  claim: LooseFileWriteClaim,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ? AND last_written_by = ?`,
  )
    .bind(claim.restoreWriter, claim.restoreUpdatedAt, id, claim.token)
    .run();
}

/**
 * Hold the slug until R2 is gone, then drop the catalog row.
 * Claim last_written_by first so a concurrent TTL reset cannot keep a live
 * catalog after this function has started deleting objects.
 */
export async function purgeExpiredSite(
  env: Env,
  ctx: ExecutionContext | undefined,
  handle: string,
  slug: string,
): Promise<boolean> {
  const key = `site:${handle}/${slug}`;
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    const claim = await claimExpiredSite(env, handle, slug);
    if (!claim) return false;

    try {
      await deletePrefix(env.BUCKET, `sites/${handle}/${slug}/`);
    } catch (err) {
      await env.DB.prepare(
        `UPDATE sites SET last_written_by = ? WHERE handle = ? AND slug = ? AND last_written_by = ?`,
      )
        .bind(claim.restoreWriter, handle, slug, claim.token)
        .run();
      throw err;
    }

    const usage = await env.DB.prepare(
      `SELECT COALESCE(SUM(size), 0) AS total FROM site_files WHERE handle = ? AND slug = ?`,
    )
      .bind(handle, slug)
      .first<{ total: number }>();
    await env.DB.prepare(
      `DELETE FROM site_files WHERE handle = ? AND slug = ?
       AND EXISTS (
         SELECT 1 FROM sites WHERE handle = ? AND slug = ? AND last_written_by = ? AND expires_at = ?
       )`,
    )
      .bind(handle, slug, handle, slug, claim.token, claim.expiresAt)
      .run();
    const dropped = await env.DB.prepare(
      `DELETE FROM sites WHERE handle = ? AND slug = ? AND last_written_by = ? AND expires_at IS NOT NULL AND expires_at = ?`,
    )
      .bind(handle, slug, claim.token, claim.expiresAt)
      .run();
    if (!d1Changed(dropped)) return false;
    try {
      await purgeContent(ctx, [sitePrefix(handle, slug)]);
    } finally {
      await releaseStorage(env.DB, Number(usage?.total ?? 0));
    }
    return true;
  } finally {
    inFlight.delete(key);
  }
}

export async function purgeExpiredFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  id: string,
  handle: string | null,
  filename: string,
): Promise<boolean> {
  const key = `file:${id}`;
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    const claim = await claimExpiredFile(env, id);
    if (!claim) return false;

    try {
      await env.BUCKET.delete(fileKey(id, claim.filename || filename));
    } catch (err) {
      await env.DB.prepare(`UPDATE loose_files SET last_written_by = ? WHERE id = ? AND last_written_by = ?`)
        .bind(claim.restoreWriter, id, claim.token)
        .run();
      throw err;
    }

    const dropped = await env.DB.prepare(
      `DELETE FROM loose_files WHERE id = ? AND last_written_by = ? AND expires_at IS NOT NULL AND expires_at = ?`,
    )
      .bind(id, claim.token, claim.expiresAt)
      .run();
    if (!d1Changed(dropped)) return false;
    try {
      if (handle) await purgeContent(ctx, [filePrefix(handle, id)]);
    } finally {
      await releaseStorage(env.DB, claim.size ?? 0);
    }
    return true;
  } finally {
    inFlight.delete(key);
  }
}

async function claimExpiredSite(env: Env, handle: string, slug: string): Promise<Claim | null> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT expires_at, last_written_by, created_by, updated_at FROM sites
     WHERE handle = ? AND slug = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(handle, slug, now)
    .first<{ expires_at: string; last_written_by: string; created_by: string; updated_at: string }>();
  if (!row) return null;
  if (isPurgeClaimed(row.last_written_by) && !isStaleClaim(row.updated_at)) {
    return null;
  }
  const token = newPurgeToken();
  const claimed = await env.DB.prepare(
    `UPDATE sites SET last_written_by = ?, updated_at = ?
     WHERE handle = ? AND slug = ? AND expires_at = ? AND expires_at <= ? AND last_written_by = ?`,
  )
    .bind(token, now, handle, slug, row.expires_at, now, row.last_written_by)
    .run();
  if (!d1Changed(claimed)) return null;
  const restoreWriter = isPurgeClaimed(row.last_written_by) ? row.created_by : row.last_written_by;
  return { expiresAt: row.expires_at, restoreWriter, token };
}

async function claimExpiredFile(env: Env, id: string): Promise<Claim | null> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT expires_at, filename, size, last_written_by, created_by, updated_at FROM loose_files
     WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(id, now)
    .first<{
      expires_at: string;
      filename: string;
      size: number;
      last_written_by: string | null;
      created_by: string;
      updated_at: string | null;
    }>();
  if (!row) return null;
  if ((isPurgeClaimed(row.last_written_by) || isWriteClaimed(row.last_written_by)) && !isStaleClaim(row.updated_at)) {
    return null;
  }
  const token = newPurgeToken();
  const claimed = await env.DB.prepare(
    `UPDATE loose_files SET last_written_by = ?, updated_at = ?
     WHERE id = ? AND expires_at = ? AND expires_at <= ? AND ifnull(last_written_by, '') = ?`,
  )
    .bind(token, now, id, row.expires_at, now, row.last_written_by ?? "")
    .run();
  if (!d1Changed(claimed)) return null;
  const restoreWriter = isPurgeClaimed(row.last_written_by) || isWriteClaimed(row.last_written_by)
    ? row.created_by
    : row.last_written_by || row.created_by;
  return { expiresAt: row.expires_at, restoreWriter, token, filename: row.filename, size: row.size };
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
