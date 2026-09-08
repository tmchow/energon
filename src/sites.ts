import { privateCacheControl, publicCacheControl, purgeContent, siteCacheTag, sitePrefix } from "./cache";
import {
  composeClauses,
  criteriaSql,
  nextSiteCursor,
  siteCursorSql,
  takePage,
  type ListPage,
  type ListQuery,
} from "./catalog";
import { brandMark, documentShell, escapeHtml } from "./chrome";
import { MAX_IMPORT_FILES, PRODUCT, RESERVED_SLUGS, SLUG_RE, formatBytes, siteKey } from "./config";
import {
  expiredError,
  expiredHtml,
  isExpired,
  isPurgeClaimed,
  isWriteClaimed,
  PURGE_CLAIM_LIKE,
  purgeExpiredSite,
  remainingCacheSeconds,
  schedulePurgeExpiredSite,
} from "./expire";
import { isMarkdownName, respondMarkdown } from "./markdown";
import { maybeUnlockWithWritePassword, passwordEcho, passwordHashFromInput, protectContent, assignPasswordStore, hubLinkAccessFields, storedPasswordSecret, writePasswordHashFromInput } from "./gate";
import { ensureUser } from "./handles";
import { mintObjectId } from "./ids";
import { ApiError, applyIsolation, assertStorageRoom, basename, contentDisposition, copyR2Object, deletePrefix, htmlPage, json, jsonMaybeSecret, nanoid, normalizeRelPath, publicOrigin, releaseStorage, secretJson, tooLarge, wantsDownload } from "./http";
import { contentTypeFor } from "./mime";
import {
  OWNER_WRITE_SQL,
  assertCanMutate,
  assertCanSetWritePolicy,
  canSetWritePolicy,
  instancePolicy,
  ownerWriteBinds,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
} from "./policy";
import { noteRead } from "./reads";
import type { Actor, Env, SiteFileRow, SiteRow } from "./types";
import { isSiteId, sitePublicUrl } from "./urls";
import { packZip, unpackZip } from "./zip";

const SITE_SELECT =
  `id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret, written_via, last_read_at`;
const D1_BATCH_MAX_STATEMENTS = 100;

type R2Snapshot = {
  key: string;
  bytes: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
};
type R2State = { key: string; snapshot: R2Snapshot | null };

async function snapshotR2Object(bucket: R2Bucket, key: string): Promise<R2Snapshot | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    key,
    bytes: await object.bytes(),
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}

async function restoreR2Snapshots(bucket: R2Bucket, states: R2State[]): Promise<void> {
  let failed = false;
  for (const { key, snapshot } of states) {
    try {
      if (snapshot) {
        await bucket.put(snapshot.key, snapshot.bytes, {
          httpMetadata: snapshot.httpMetadata,
          customMetadata: snapshot.customMetadata,
        });
      } else {
        await bucket.delete(key);
      }
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw new ApiError(500, "storage_rollback_failed", "The request failed and storage rollback also failed. Retry after storage recovers.");
  }
}

async function restoreR2State(bucket: R2Bucket, key: string, snapshot: R2Snapshot | null): Promise<void> {
  await restoreR2Snapshots(bucket, [{ key, snapshot }]);
}

function siteFileUpsert(
  env: Env,
  siteId: string,
  path: string,
  size: number,
  contentType: string,
  updatedAt: string,
  lastWrittenBy: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_id, path) DO UPDATE SET
       size = excluded.size,
       content_type = excluded.content_type,
       updated_at = excluded.updated_at,
       last_written_by = excluded.last_written_by`,
  ).bind(siteId, path, size, contentType, updatedAt, lastWrittenBy);
}

async function deleteCreatedSiteMetadata(env: Env, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM site_files WHERE site_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM sites WHERE id = ?`).bind(id),
  ]);
}

async function listR2Keys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteR2Keys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

async function restoreSiteFileRows(
  env: Env,
  siteId: string,
  paths: string[],
  previousRows: Map<string, SiteFileRow>,
  previousSite: SiteRow,
): Promise<void> {
  const pathBatchSize = Math.floor((D1_BATCH_MAX_STATEMENTS - 1) / 2);
  for (let i = 0; i < paths.length || i === 0; i += pathBatchSize) {
    const statements: D1PreparedStatement[] = [];
    for (const path of paths.slice(i, i + pathBatchSize)) {
      statements.push(env.DB.prepare(`DELETE FROM site_files WHERE site_id = ? AND path = ?`).bind(siteId, path));
      const previous = previousRows.get(path);
      if (previous) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            previous.site_id,
            previous.path,
            previous.size,
            previous.content_type,
            previous.updated_at,
            previous.last_written_by,
          ),
        );
      }
    }
    if (i + pathBatchSize >= paths.length) {
      statements.push(
        env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE id = ?`).bind(
          previousSite.updated_at,
          previousSite.last_written_by,
          siteId,
        ),
      );
    }
    await env.DB.batch(statements);
  }
}

async function rollbackSiteStorage(
  env: Env,
  key: string,
  snapshot: R2Snapshot | null,
  originalError: unknown,
): Promise<never> {
  try {
    await restoreR2State(env.BUCKET, key, snapshot);
  } catch {
    throw new ApiError(500, "storage_rollback_failed", "The request failed and storage rollback also failed. Retry after storage recovers.");
  }
  throw originalError;
}

export function assertSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw new ApiError(
      400,
      "bad_slug",
      `Slug '${slug}' is invalid. Use 1–63 characters: lowercase letters, numbers, and hyphens, not starting or ending with a hyphen. Example: lunch-poll.`,
    );
  }
  if (RESERVED_SLUGS.has(s)) {
    throw new ApiError(
      400,
      "reserved_slug",
      `Slug '${s}' is reserved by ${PRODUCT}. Pick another name.`,
    );
  }
  return s;
}

export function assertFilePath(path: string): string {
  const decoded = safeDecode(path);
  const normalized = normalizeRelPath(decoded);
  if (!normalized) {
    throw new ApiError(
      400,
      "bad_path",
      `Path '${path}' is not a safe relative file path. Remove leading slashes and '..' segments.`,
    );
  }
  return normalized;
}

function safeDecode(path: string): string {
  try {
    return path
      .split("/")
      .map((p) => decodeURIComponent(p))
      .join("/");
  } catch {
    throw new ApiError(400, "bad_path", "That path is not valid URL encoding.");
  }
}

async function writeSite(
  env: Env,
  actor: Actor,
  id: string,
  assignments: string,
  values: unknown[],
): Promise<void> {
  const updated = await env.DB.prepare(
    `UPDATE sites SET ${assignments}, written_via = NULL WHERE id = ? AND last_written_by NOT LIKE ? AND ${OWNER_WRITE_SQL}`,
  )
    .bind(...values, id, PURGE_CLAIM_LIKE, ...ownerWriteBinds(actor))
    .run();
  if (!Number(updated.meta?.changes ?? 0)) {
    await throwSiteMutationConflict(env, id);
  }
}

async function throwSiteMutationConflict(env: Env, id: string): Promise<never> {
  const still = await getSiteById(env, id);
  if (!still || isPurgeClaimed(still.last_written_by) || isExpired(still.expires_at)) {
    throw expiredError("site");
  }
  if (isWriteClaimed(still.last_written_by)) {
    throw new ApiError(409, "site_busy", "Another write is in progress; retry this update.");
  }
  throw new ApiError(403, "forbidden_write", "Only the creator can write this.");
}

export async function getSiteById(env: Env, id: string): Promise<SiteRow | null> {
  if (!isSiteId(id)) return null;
  return env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE id = ?`).bind(id).first<SiteRow>();
}

async function findSiteForActor(env: Env, id: string): Promise<SiteRow | null> {
  return getSiteById(env, id);
}

async function fileCount(env: Env, siteId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_files WHERE site_id = ?`)
    .bind(siteId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export function involvedInSite(
  actor: Actor,
  site: { created_by: string; last_written_by: string | null; owner_id?: string | null },
): boolean {
  const email = actor.email.toLowerCase();
  if (site.created_by.toLowerCase() === email) return true;
  if (site.last_written_by && site.last_written_by.toLowerCase() === email) return true;
  return Boolean(actor.userId && site.owner_id === actor.userId);
}

export async function createSite(
  env: Env,
  actor: Actor,
  slugRaw: string,
  password?: string,
  ctx?: ExecutionContext,
  ttl?: unknown,
  writePolicy?: unknown,
  writePassword?: string,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const slug = assertSlug(slugRaw);
  const user = await ensureUser(env, actor.email, actor.idpSub);
  const handle = user.handle;
  const hash = await passwordHashFromInput(password);
  const writeHash = await writePasswordHashFromInput(writePassword);
  const policy = instancePolicy(env);
  const id = await mintObjectId(env, "sites");
  const url = sitePublicUrl(env, handle, id, slug);
  const resolved = resolveExpiresAt(policy, ttl);
  const storedWrite = resolveCreateWritePolicy(env, writePolicy);
  const ts = new Date().toISOString();
  const stored = hash === undefined ? null : hash;
  const storedWritePw = writeHash === undefined ? null : writeHash;
  await env.DB.prepare(
    `INSERT INTO sites (id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, handle, slug, user.id, ts, ts, actor.email, actor.email, stored, storedPasswordSecret(stored, password), resolved.expiresAt, storedWrite, storedWritePw, storedPasswordSecret(storedWritePw, writePassword))
    .run();
  return {
    status: 201,
    body: {
      id,
      slug,
      handle,
      url,
      created: true,
      password_protected: Boolean(stored),
      password: passwordEcho(password, stored) ?? null,
      write_password_protected: Boolean(storedWritePw),
      write_password: passwordEcho(writePassword, storedWritePw) ?? null,
      ttl: resolved.ttl,
      expires_at: resolved.expiresAt,
      write_policy: storedWrite,
    },
  };
}

export async function duplicateSite(
  env: Env,
  actor: Actor,
  fromIdRaw: string,
  newSlugRaw: string,
  ctx?: ExecutionContext,
  ttl?: unknown,
  writePolicy?: unknown,
  password?: string,
  writePassword?: string,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const source = await requireSite(env, actor, fromIdRaw, { ctx });
  const files = await env.DB.prepare(
    `SELECT path, size, content_type FROM site_files WHERE site_id = ? ORDER BY path`,
  )
    .bind(source.id)
    .all<{ path: string; size: number; content_type: string }>();
  const listed = files.results || [];
  if (listed.length > MAX_IMPORT_FILES) {
    throw new ApiError(
      400,
      "too_many_files",
      `That site has ${listed.length} files. ${PRODUCT} copies at most ${MAX_IMPORT_FILES} files. Split the site, then retry.`,
    );
  }
  const total = listed.reduce((n, f) => n + Number(f.size || 0), 0);
  const reserved = await assertStorageRoom(env.DB, total, 0, instancePolicy(env).platformBytes);
  let destId = "";
  const copiedKeys: string[] = [];
  try {
    const created = await createSite(env, actor, newSlugRaw, password, ctx, ttl, writePolicy, writePassword);
    destId = String(created.body.id);
    const destHandle = String(created.body.handle);
    const ts = new Date().toISOString();
    for (const f of listed) {
      const destinationKey = siteKey(destHandle, destId, f.path);
      await copyR2Object(env.BUCKET, siteKey(source.handle, source.id, f.path), destinationKey);
      copiedKeys.push(destinationKey);
      await env.DB.prepare(
        `INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(destId, f.path, f.size, f.content_type, ts, actor.email)
        .run();
    }
    if (listed.length) {
      await writeSite(env, actor, destId, "updated_at = ?, last_written_by = ?", [ts, actor.email]);
    }
    return {
      status: 201,
      body: {
        ...created.body,
        duplicated: true,
        duplicated_from: source.id,
        file_count: listed.length,
      },
    };
  } catch (err) {
    let cleanupError = false;
    try {
      await deleteR2Keys(env.BUCKET, copiedKeys);
    } catch {
      cleanupError = true;
    }
    if (destId) {
      try {
        await deleteCreatedSiteMetadata(env, destId);
      } catch {
        cleanupError = true;
      }
    }
    if (cleanupError) {
      throw new ApiError(500, "site_copy_rollback_failed", "The site copy failed and automatic cleanup also failed. Retry after storage recovers.");
    }
    await releaseStorage(env.DB, reserved);
    throw err;
  }
}

export async function patchSite(
  env: Env,
  actor: Actor,
  idRaw: string,
  patch: { password?: string; write_password?: string; ttl?: unknown; setTtl?: boolean; write_policy?: unknown },
  ctx?: ExecutionContext,
  authority?: "admin",
): Promise<Response> {
  const wantsWrite = Object.prototype.hasOwnProperty.call(patch, "write_policy");
  const wantsWritePassword = Object.prototype.hasOwnProperty.call(patch, "write_password");
  const wantsSharePassword = patch.password !== undefined;
  const wantsOther = wantsSharePassword || Boolean(patch.setTtl);
  const site = await requireSite(env, actor, idRaw, {
    allowExpired: Boolean(patch.setTtl),
    ctx,
    mutate: wantsOther,
    authority,
  });
  let nextWrite = resolveWritePolicy(site.write_policy);
  if (wantsWrite) {
    assertCanSetWritePolicy(actor, site.created_by, site.owner_id);
    const parsed = requestedWritePolicy(patch.write_policy);
    if (parsed === "invalid" || parsed === null) {
      throw new ApiError(400, "bad_write_policy", "write_policy must be owner or org.");
    }
    nextWrite = parsed;
  }
  const writeHash = await writePasswordHashFromInput(patch.write_password);
  if (wantsWritePassword || wantsSharePassword) {
    assertCanSetWritePolicy(actor, site.created_by, site.owner_id);
  }
  const hash = await passwordHashFromInput(patch.password);
  const ts = new Date().toISOString();
  const resolved = patch.setTtl ? resolveExpiresAt(instancePolicy(env), patch.ttl) : null;
  const notClaimed = `last_written_by NOT LIKE ?`;
  const ttlOnlyAdmin = authority === "admin" && resolved !== null && hash === undefined && writeHash === undefined && !wantsWrite;
  if (hash !== undefined || writeHash !== undefined || resolved || wantsWrite) {
    const assignments = ttlOnlyAdmin ? ["expires_at = ?"] : ["updated_at = ?", "last_written_by = ?", "written_via = NULL"];
    const values: unknown[] = ttlOnlyAdmin && resolved ? [resolved.expiresAt] : [ts, actor.email];
    if (!ttlOnlyAdmin) {
      if (hash !== undefined) {
        assignPasswordStore(assignments, values, hash, patch.password, "password_hash", "password_secret");
      }
      if (writeHash !== undefined) {
        assignPasswordStore(assignments, values, writeHash, patch.write_password, "write_password_hash", "write_password_secret");
      }
      if (resolved) {
        assignments.push("expires_at = ?");
        values.push(resolved.expiresAt);
      }
      if (wantsWrite) {
        assignments.push("write_policy = ?");
        values.push(nextWrite);
      }
    }
    const writeSql = authority === "admin" ? "1=1" : OWNER_WRITE_SQL;
    const writeBinds = authority === "admin" ? [] : ownerWriteBinds(actor);
    const updated = await env.DB.prepare(
      `UPDATE sites SET ${assignments.join(", ")} WHERE id = ? AND ${notClaimed} AND ${writeSql}`,
    )
      .bind(...values, site.id, PURGE_CLAIM_LIKE, ...writeBinds)
      .run();
    if (!Number(updated.meta?.changes ?? 0)) {
      const still = await getSiteById(env, site.id);
      if (!still || isPurgeClaimed(still.last_written_by) || isExpired(still.expires_at)) {
        throw expiredError("site");
      }
      if (isWriteClaimed(still.last_written_by)) {
        throw new ApiError(409, "site_busy", "Another write is in progress; retry this update.");
      }
      throw new ApiError(403, "forbidden_write", "Only the creator can write this.");
    }
  }
  if (hash !== undefined || writeHash !== undefined || resolved) {
    await purgeContent(ctx, [sitePrefix(site.handle, site.id)]);
  }
  const protectedNow = hash === undefined ? Boolean(site.password_hash) : Boolean(hash);
  const writeProtectedNow = writeHash === undefined ? Boolean(site.write_password_hash) : Boolean(writeHash);
  const body = {
    id: site.id,
    slug: site.slug,
    handle: site.handle,
    url: sitePublicUrl(env, site.handle, site.id, site.slug),
    password_protected: protectedNow,
    password: passwordEcho(patch.password, hash) ?? null,
    write_password_protected: writeProtectedNow,
    write_password: passwordEcho(patch.write_password, writeHash) ?? null,
    expires_at: resolved ? resolved.expiresAt : site.expires_at ?? null,
    ttl: resolved ? resolved.ttl : undefined,
    write_policy: nextWrite,
  };
  return jsonMaybeSecret(body);
}

export async function requireSite(
  env: Env,
  actor: Actor,
  id: string,
  opts?: { allowExpired?: boolean; ctx?: ExecutionContext; mutate?: boolean; authority?: "admin" },
): Promise<SiteRow> {
  const origin = publicOrigin(env);
  const site = await findSiteForActor(env, id);
  if (!site) {
    throw new ApiError(
      404,
      "site_not_found",
      `Site '${id}' does not exist. Create it first with POST /v1/sites {"slug":"…"}, then PUT files. See ${origin}/v1/help.`,
      { hint: `POST ${origin}/v1/sites with {"slug":"…"}` },
    );
  }
  if (isPurgeClaimed(site.last_written_by)) {
    try {
      await purgeExpiredSite(env, opts?.ctx, site.handle, site.id);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    if (!opts?.allowExpired) throw expiredError("site");
    const still = await findSiteForActor(env, id);
    if (!still) throw expiredError("site");
    if (opts.mutate && opts.authority !== "admin") assertCanMutate(actor, still);
    return still;
  }
  if (isExpired(site.expires_at) && !opts?.allowExpired) {
    try {
      await purgeExpiredSite(env, opts?.ctx, site.handle, site.id);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    throw expiredError("site");
  }
  if (opts?.mutate && opts.authority !== "admin") assertCanMutate(actor, site);
  return site;
}

export async function putSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  pathRaw: string,
  bytes: Uint8Array,
  hintType: string | null,
): Promise<{ url: string; api_url: string; created: boolean; path: string; size: number; content_type: string }> {
  const path = assertFilePath(pathRaw);
  const policy = instancePolicy(env);
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);
  const site = await requireSite(env, actor, idRaw, { ctx, mutate: true });
  const existing = await env.DB.prepare(
    `SELECT size, content_type, updated_at, last_written_by FROM site_files WHERE site_id = ? AND path = ?`,
  )
    .bind(site.id, path)
    .first<{ size: number; content_type: string; updated_at: string; last_written_by: string }>();
  if (!existing) {
    const count = await fileCount(env, site.id);
    if (count >= MAX_IMPORT_FILES) {
      throw new ApiError(
        400,
        "too_many_files",
        `That site already has ${MAX_IMPORT_FILES} files. ${PRODUCT} caps a site at ${MAX_IMPORT_FILES} files. Delete some paths, then retry.`,
      );
    }
  }
  const contentType = contentTypeFor(path, bytes, hintType);
  const key = siteKey(site.handle, site.id, path);
  const ts = new Date().toISOString();
  const previous = await snapshotR2Object(env.BUCKET, key);
  const reserved = await assertStorageRoom(env.DB, bytes.byteLength, existing?.size ?? 0, policy.platformBytes);
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
    const wrote = await env.DB.batch([
      siteFileUpsert(env, site.id, path, bytes.byteLength, contentType, ts, actor.email),
      env.DB.prepare(
        `UPDATE sites SET updated_at = ?, last_written_by = ?, written_via = NULL WHERE id = ? AND last_written_by NOT LIKE ? AND ${OWNER_WRITE_SQL}`,
      ).bind(ts, actor.email, site.id, PURGE_CLAIM_LIKE, ...ownerWriteBinds(actor)),
    ]);
    if (!Number(wrote[1]?.meta?.changes ?? 0)) {
      if (existing) {
        await siteFileUpsert(
          env,
          site.id,
          path,
          existing.size,
          existing.content_type,
          existing.updated_at,
          existing.last_written_by,
        ).run();
      } else {
        await env.DB.prepare(`DELETE FROM site_files WHERE site_id = ? AND path = ?`).bind(site.id, path).run();
      }
      await throwSiteMutationConflict(env, site.id);
    }
  } catch (err) {
    try {
      await restoreR2State(env.BUCKET, key, previous);
    } catch {
      throw new ApiError(
        500,
        "storage_rollback_failed",
        "The request failed and storage rollback also failed. Retry after storage recovers.",
      );
    }
    await releaseStorage(env.DB, reserved);
    throw err;
  }
  await releaseStorage(env.DB, (existing?.size ?? 0) - bytes.byteLength);

  const origin = publicOrigin(env);
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]);
  return {
    url: sitePublicUrl(env, site.handle, site.id, site.slug, path),
    api_url: `${origin}/v1/sites/${site.id}/files/${path}`,
    created: !existing,
    path,
    size: bytes.byteLength,
    content_type: contentType,
  };
}

export async function getSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  pathRaw: string,
): Promise<Response> {
  const path = assertFilePath(pathRaw);
  const site = await requireSite(env, actor, idRaw, { ctx });
  const obj = await env.BUCKET.get(siteKey(site.handle, site.id, path));
  if (!obj) {
    throw new ApiError(404, "file_not_found", `No file at ${sitePublicPathHint(site.handle, site.id, site.slug, path)}.`);
  }
  noteRead(env, ctx, { table: "sites", id: site.id, last_read_at: site.last_read_at });
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function importSiteZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  zipBytes: Uint8Array,
): Promise<{ id: string; slug: string; url: string; written: string[] }> {
  const policy = instancePolicy(env);
  if (zipBytes.byteLength > policy.fileBytes) throw tooLarge(zipBytes.byteLength, "", policy.fileBytes);
  const site = await requireSite(env, actor, idRaw, { ctx, mutate: true });
  const files = unpackZip(zipBytes, policy.fileBytes);
  const existingRows = await env.DB.prepare(
    `SELECT site_id, path, size, content_type, updated_at, last_written_by FROM site_files WHERE site_id = ?`,
  )
    .bind(site.id)
    .all<SiteFileRow>();
  const existingMap = new Map((existingRows.results || []).map((r) => [r.path, r.size]));
  let additional = 0;
  let replacing = 0;
  for (const f of files) {
    additional += f.bytes.byteLength;
    replacing += existingMap.get(f.path) ?? 0;
  }
  const reserved = await assertStorageRoom(env.DB, additional, replacing, policy.platformBytes);

  const ts = new Date().toISOString();
  const written: string[] = [];
  const upserts: D1PreparedStatement[] = [];
  const previousRows = new Map<string, SiteFileRow>();
  const snapshots: R2State[] = [];
  const affectedPaths = files.map((f) => f.path);
  for (const row of existingRows.results || []) previousRows.set(row.path, row);
  try {
    for (const f of files) {
      const key = siteKey(site.handle, site.id, f.path);
      const previous = await snapshotR2Object(env.BUCKET, key);
      snapshots.push({ key, snapshot: previous });
      const contentType = contentTypeFor(f.path, f.bytes, null);
      await env.BUCKET.put(key, f.bytes, { httpMetadata: { contentType } });
      upserts.push(siteFileUpsert(env, site.id, f.path, f.bytes.byteLength, contentType, ts, actor.email));
      written.push(f.path);
    }
    for (let i = 0; i < upserts.length; i += D1_BATCH_MAX_STATEMENTS) {
      await env.DB.batch(upserts.slice(i, i + D1_BATCH_MAX_STATEMENTS));
    }
    await writeSite(env, actor, site.id, "updated_at = ?, last_written_by = ?", [ts, actor.email]);
  } catch (err) {
    try {
      await restoreR2Snapshots(env.BUCKET, snapshots);
      await restoreSiteFileRows(env, site.id, affectedPaths, previousRows, site);
    } catch {
      throw new ApiError(500, "site_import_rollback_failed", "The site import failed and automatic rollback also failed. Retry after storage recovers.");
    }
    await releaseStorage(env.DB, reserved);
    throw err;
  }
  await releaseStorage(env.DB, replacing - additional);
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]);
  return { id: site.id, slug: site.slug, url: sitePublicUrl(env, site.handle, site.id, site.slug), written };
}

export async function exportSiteZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
): Promise<Response> {
  const site = await requireSite(env, actor, idRaw, { ctx });
  const rows = await env.DB.prepare(
    `SELECT path, size FROM site_files WHERE site_id = ? ORDER BY path`,
  )
    .bind(site.id)
    .all<{ path: string; size: number }>();
  const listed = rows.results || [];
  if (listed.length === 0) {
    throw new ApiError(400, "empty_site", `Site '${site.slug}' has no files to zip.`);
  }
  if (listed.length > MAX_IMPORT_FILES) {
    throw new ApiError(
      400,
      "too_many_files",
      `That site has ${listed.length} files. ${PRODUCT} exports at most ${MAX_IMPORT_FILES} files per zip. Split the site, then retry.`,
    );
  }
  const policy = instancePolicy(env);
  const total = listed.reduce((n, r) => n + Number(r.size || 0), 0);
  if (total > policy.fileBytes) {
    throw new ApiError(
      413,
      "too_large",
      `That site is over the ${formatBytes(policy.fileBytes)} export cap (${(total / (1024 * 1024)).toFixed(1)} MB of files). ${PRODUCT} zips at most ${formatBytes(policy.fileBytes)} so a download stays small. Split the site, then retry.`,
      { limit_bytes: policy.fileBytes, actual_bytes: total },
    );
  }
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const row of listed) {
    const obj = await env.BUCKET.get(siteKey(site.handle, site.id, row.path));
    if (!obj) {
      throw new ApiError(
        500,
        "export_failed",
        `Site file '${row.path}' is missing from storage. Re-upload that path, then retry.`,
      );
    }
    files.push({ path: row.path, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  const zip = packZip(files, policy.fileBytes);
  noteRead(env, ctx, { table: "sites", id: site.id, last_read_at: site.last_read_at });
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", contentDisposition("attachment", `${site.slug}.zip`));
  headers.set("cache-control", "no-store");
  headers.set("content-length", String(zip.byteLength));
  return new Response(zip, { headers });
}

export async function deleteSite(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  authority?: "admin",
): Promise<void> {
  let site: SiteRow;
  try {
    site = await requireSite(env, actor, idRaw, { allowExpired: true, mutate: true, ctx, authority });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
  if (isPurgeClaimed(site.last_written_by)) {
    try {
      await purgeExpiredSite(env, ctx, site.handle, site.id);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    return;
  }
  const sitePrefixKey = `sites/${site.handle}/${site.id}/`;
  const listedKeys = await listR2Keys(env.BUCKET, sitePrefixKey);
  const backupPrefix = `sites/.integrity-backup/${nanoid(16)}/`;
  const backups: { sourceKey: string; backupKey: string }[] = [];
  const usage = await env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total FROM site_files WHERE site_id = ?`,
  )
    .bind(site.id)
    .first<{ total: number }>();
  let siteDeleted = false;
  try {
    for (const sourceKey of listedKeys) {
      const backupKey = `${backupPrefix}${sourceKey.slice(sitePrefixKey.length)}`;
      await copyR2Object(env.BUCKET, sourceKey, backupKey);
      backups.push({ sourceKey, backupKey });
    }
    await deletePrefix(env.BUCKET, `sites/${site.handle}/${site.id}/`);
    const writeSql = authority === "admin" ? "1=1" : OWNER_WRITE_SQL;
    const writeBinds = authority === "admin" ? [] : ownerWriteBinds(actor);
    const wrote = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM site_files WHERE site_id = ? AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND last_written_by NOT LIKE ? AND ${writeSql})`,
      ).bind(site.id, site.id, PURGE_CLAIM_LIKE, ...writeBinds),
      env.DB.prepare(
        `DELETE FROM sites WHERE id = ? AND last_written_by NOT LIKE ? AND ${writeSql}`,
      ).bind(site.id, PURGE_CLAIM_LIKE, ...writeBinds),
    ]);
    siteDeleted = Number(wrote[1]?.meta?.changes ?? 0) > 0;
    const still = await getSiteById(env, site.id);
    if (still) {
      if (isPurgeClaimed(still.last_written_by) || isExpired(still.expires_at)) {
        throw expiredError("site");
      }
      throw new ApiError(403, "forbidden_write", "Only the creator can write this.");
    }
  } catch (err) {
    try {
      await Promise.all(backups.map(({ sourceKey, backupKey }) => copyR2Object(env.BUCKET, backupKey, sourceKey)));
      await deleteR2Keys(env.BUCKET, backups.map(({ backupKey }) => backupKey));
    } catch {
      throw new ApiError(500, "site_delete_rollback_failed", "The site deletion failed and automatic rollback also failed. Retry after storage recovers.");
    }
    throw err;
  }
  try {
    await deleteR2Keys(env.BUCKET, backups.map(({ backupKey }) => backupKey));
  } finally {
    try {
      await purgeContent(ctx, [sitePrefix(site.handle, site.id)]);
    } finally {
      if (siteDeleted) await releaseStorage(env.DB, Number(usage?.total ?? 0));
    }
  }
}

export async function deleteSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  pathRaw: string,
): Promise<void> {
  const path = assertFilePath(pathRaw);
  const site = await requireSite(env, actor, idRaw, { ctx, mutate: true });
  const existing = await env.DB.prepare(
    `SELECT path, size FROM site_files WHERE site_id = ? AND path = ?`,
  )
    .bind(site.id, path)
    .first<{ path: string; size: number }>();
  if (!existing) {
    throw new ApiError(404, "file_not_found", `No file at ${sitePublicPathHint(site.handle, site.id, site.slug, path)}.`);
  }
  const key = siteKey(site.handle, site.id, path);
  const previous = await snapshotR2Object(env.BUCKET, key);
  await env.BUCKET.delete(key);
  const ts = new Date().toISOString();
  try {
    const wrote = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM site_files WHERE site_id = ? AND path = ? AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND last_written_by NOT LIKE ? AND ${OWNER_WRITE_SQL})`,
      ).bind(site.id, path, site.id, PURGE_CLAIM_LIKE, ...ownerWriteBinds(actor)),
      env.DB.prepare(
        `UPDATE sites SET updated_at = ?, last_written_by = ?, written_via = NULL WHERE id = ? AND last_written_by NOT LIKE ? AND ${OWNER_WRITE_SQL}`,
      ).bind(ts, actor.email, site.id, PURGE_CLAIM_LIKE, ...ownerWriteBinds(actor)),
    ]);
    if (!Number(wrote[1]?.meta?.changes ?? 0)) {
      await throwSiteMutationConflict(env, site.id);
    }
    if (!Number(wrote[0]?.meta?.changes ?? 0)) return;
  } catch (err) {
    await rollbackSiteStorage(env, key, previous, err);
  }
  try {
    await purgeContent(ctx, [sitePrefix(site.handle, site.id)]);
  } finally {
    await releaseStorage(env.DB, existing.size);
  }
}

export async function listSiteJson(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
): Promise<Response> {
  const site = await requireSite(env, actor, idRaw, { ctx });
  const origin = publicOrigin(env);
  const files = await env.DB.prepare(
    `SELECT site_id, path, size, content_type, updated_at, last_written_by FROM site_files
     WHERE site_id = ? ORDER BY path`,
  )
    .bind(site.id)
    .all<SiteFileRow>();
  return json({
    id: site.id,
    slug: site.slug,
    handle: site.handle,
    url: sitePublicUrl(env, site.handle, site.id, site.slug),
    created_at: site.created_at,
    updated_at: site.updated_at,
    created_by: site.created_by,
    last_written_by: site.last_written_by,
    password_protected: Boolean(site.password_hash),
    write_password_protected: Boolean(site.write_password_hash),
    written_via: site.written_via ?? null,
    expires_at: site.expires_at ?? null,
    last_read_at: site.last_read_at ?? null,
    write_policy: resolveWritePolicy(site.write_policy),
    files: (files.results || []).map((f) => ({
      ...f,
      handle: site.handle,
      slug: site.slug,
      url: sitePublicUrl(env, site.handle, site.id, site.slug, f.path),
      api_url: `${origin}/v1/sites/${site.id}/files/${f.path}`,
    })),
  });
}

export async function hubSiteLinkAccess(env: Env, actor: Actor, idRaw: string): Promise<Response> {
  const site = await requireSite(env, actor, idRaw);
  if (!involvedInSite(actor, site)) {
    throw new ApiError(
      404,
      "site_not_found",
      `Site '${idRaw}' does not exist. Create it first with POST /v1/sites {"slug":"…"}, then PUT files. See ${publicOrigin(env)}/v1/help.`,
      { hint: `POST ${publicOrigin(env)}/v1/sites with {"slug":"…"}` },
    );
  }
  return secretJson({
    id: site.id,
    slug: site.slug,
    handle: site.handle,
    url: sitePublicUrl(env, site.handle, site.id, site.slug),
    ...hubLinkAccessFields(canSetWritePolicy(actor, site.created_by, site.owner_id), site),
  });
}

export async function listSitesJson(env: Env, email: string, query: ListQuery, ownerId?: string): Promise<Response> {
  const page = await listSitesFor(env, email, query, ownerId);
  return json({ sites: page.items, total: page.total, next_cursor: page.next_cursor });
}

export async function listSitesFor(
  env: Env,
  email: string,
  query: ListQuery,
  ownerId?: string,
): Promise<
  ListPage<{
    id: string;
    slug: string;
    handle: string;
    url: string;
    created_at: string;
    updated_at: string;
    created_by: string;
    last_written_by: string;
    file_count: number;
    size: number;
    password_protected: boolean;
    write_password_protected: boolean;
    written_via: string | null;
    expires_at: string | null;
    last_read_at: string | null;
    write_policy: string;
  }>
> {
  const criteria = criteriaSql("sites", query, email, ownerId);
  const cursor = siteCursorSql(query);
  const clauses = composeClauses(criteria, cursor);
  // A HAVING filter (min_size) only exists per group, so the total must count groups, not rows.
  const countSql = criteria.having
    ? `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM sites s
         LEFT JOIN site_files f ON s.id = f.site_id
         WHERE ${criteria.where}
         GROUP BY s.id
         HAVING ${criteria.having})`
    : `SELECT COUNT(*) AS n FROM sites s WHERE ${criteria.where}`;
  const countRow = await env.DB.prepare(countSql)
    .bind(...criteria.whereBinds, ...criteria.havingBinds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.handle, s.slug, s.created_at, s.updated_at, s.created_by, s.last_written_by,
            s.password_hash, s.write_password_hash, s.written_via, s.expires_at, s.last_read_at, s.write_policy,
            COUNT(f.path) AS file_count, COALESCE(SUM(f.size), 0) AS size
     FROM sites s
     LEFT JOIN site_files f ON s.id = f.site_id
     WHERE ${clauses.where}
     GROUP BY s.id
     ${clauses.having ? `HAVING ${clauses.having}` : ""}
     ORDER BY ${cursor.order}
     LIMIT ?`,
  )
    .bind(...clauses.binds, query.limit + 1)
    .all<{
      id: string;
      handle: string;
      slug: string;
      created_at: string;
      updated_at: string;
      created_by: string;
      last_written_by: string;
      password_hash: string | null;
      write_password_hash: string | null;
      written_via: string | null;
      expires_at: string | null;
      last_read_at: string | null;
      write_policy: string | null;
      file_count: number;
      size: number;
    }>();
  const page = takePage(rows.results || [], query.limit);
  const items = page.items.map((s) => {
    const { password_hash, write_password_hash, write_policy, ...rest } = s;
    return {
      ...rest,
      url: sitePublicUrl(env, s.handle, s.id, s.slug),
      password_protected: Boolean(password_hash),
      write_password_protected: Boolean(write_password_hash),
      written_via: s.written_via ?? null,
      expires_at: s.expires_at ?? null,
      last_read_at: s.last_read_at ?? null,
      write_policy: resolveWritePolicy(write_policy),
    };
  });
  const last = page.items[page.items.length - 1];
  return {
    items,
    total,
    next_cursor: page.hasMore && last ? nextSiteCursor(query.sort, last) : null,
  };
}

export async function serveSite(
  env: Env,
  ctx: ExecutionContext,
  handleRaw: string,
  idRaw: string,
  slugRaw: string,
  pathRaw: string,
  request: Request,
): Promise<Response> {
  const handle = handleRaw.trim().toLowerCase();
  if (!isSiteId(idRaw)) {
    return htmlPage(`<!doctype html><meta charset="utf-8"><title>Not found</title><p>No such site.</p>`, 404, {
      "cache-control": "no-store",
    });
  }
  let slug: string;
  try {
    slug = assertSlug(slugRaw);
  } catch {
    return htmlPage(`<!doctype html><meta charset="utf-8"><title>Not found</title><p>No such site.</p>`, 404, {
      "cache-control": "no-store",
    });
  }
  const site = await getSiteById(env, idRaw);
  if (!site || site.handle !== handle || site.slug !== slug) {
    return htmlPage(
      `<!doctype html><meta charset="utf-8"><title>Not found</title><p>Site '${escapeHtml(slug)}' does not exist.</p>`,
      404,
      { "cache-control": "no-store" },
    );
  }
  if (isExpired(site.expires_at)) {
    schedulePurgeExpiredSite(env, ctx, handle, site.id);
    return expiredHtml("site");
  }

  const cookiePath = `/${handle}/s/${site.id}/${slug}/`;
  const unlocked = await maybeUnlockWithWritePassword(request, env, site.write_password_hash, cookiePath);
  if (unlocked instanceof Response) return unlocked;
  const gated = unlocked === "unlocked"
    ? null
    : await protectContent(request, site.password_hash, cookiePath, slug, env, site.write_password_hash);
  if (gated) return gated;
  if (request.method === "POST") {
    return json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
  }
  // Stamp only when stored bytes are served; 404s and the generated listing do not count.
  const read = () => noteRead(env, ctx, { table: "sites", id: site.id, last_read_at: site.last_read_at });

  const remaining = remainingCacheSeconds(site.expires_at);
  const cacheable = !site.password_hash && unlocked !== "unlocked";
  const wantsIndex = pathRaw === "" || pathRaw === "/";
  if (wantsIndex) {
    const index = await env.BUCKET.get(siteKey(handle, site.id, "index.html"));
    if (index) {
      read();
      return serveObject(index, "text/html; charset=utf-8", cacheable, siteCacheTag(handle, site.id), remaining);
    }
    const indexMd = await env.BUCKET.get(siteKey(handle, site.id, "index.md"));
    if (indexMd) {
      read();
      return respondMarkdown(request, indexMd, "index.md");
    }
    return htmlPage(await fileListHtml(env, site), 200, {
      "cache-control": cacheable ? publicCacheControl(remaining) : privateCacheControl(),
      "cache-tag": siteCacheTag(handle, site.id),
    });
  }

  let path: string;
  try {
    path = assertFilePath(pathRaw);
  } catch {
    return htmlPage(`<!doctype html><meta charset="utf-8"><title>Not found</title><p>Bad path.</p>`, 404, {
      "cache-control": "no-store",
    });
  }
  const obj = await env.BUCKET.get(siteKey(handle, site.id, path));
  if (!obj) {
    return htmlPage(
      `<!doctype html><meta charset="utf-8"><title>Not found</title><p>No file at ${escapeHtml(sitePublicPathHint(handle, site.id, slug, path))}.</p>`,
      404,
      { "cache-control": "no-store" },
    );
  }
  read();
  if (isMarkdownName(path)) return respondMarkdown(request, obj, path);
  const type = obj.httpMetadata?.contentType || "application/octet-stream";
  return serveObject(obj, type, cacheable, siteCacheTag(handle, site.id), remaining, {
    filename: basename(path),
    download: wantsDownload(request),
  });
}

async function fileListHtml(env: Env, site: SiteRow): Promise<string> {
  const files = await env.DB.prepare(
    `SELECT path, size, content_type, updated_at FROM site_files WHERE site_id = ? ORDER BY path`,
  )
    .bind(site.id)
    .all<{ path: string; size: number; content_type: string; updated_at: string }>();
  const rows = (files.results || [])
    .map(
      (f) =>
        `<tr><td><a href="${escapeHtml(f.path)}">${escapeHtml(f.path)}</a></td><td class="num">${escapeHtml(formatBytes(f.size))}</td><td>${escapeHtml(f.content_type)}</td></tr>`,
    )
    .join("");
  const list = rows
    ? `<table class="data"><thead><tr><th>Path</th><th class="num">Size</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty"><strong>Empty site</strong>No files yet.</p>`;
  return documentShell({
    title: `${site.slug} — ${PRODUCT}`,
    bodyClass: "page-listing",
    body: `<header class="top"><div class="top-inner">
      <a class="brand" href="/"><div class="mark">${brandMark()}</div><div><div class="name">${escapeHtml(PRODUCT)}</div></div></a>
      <a class="who" href="/">Back to hub</a>
    </div></header>
    <main class="wrap">
      <h1>/${escapeHtml(site.handle)}/s/${escapeHtml(site.id)}/${escapeHtml(site.slug)}/</h1>
      <p class="crumb">No index.html or index.md. Updated ${escapeHtml(site.updated_at)}.</p>
      <section class="card"><div class="card-body tight">${list}</div></section>
    </main>`,
  });
}

function sitePublicPathHint(handle: string, id: string, slug: string, path: string): string {
  return `/${handle}/s/${id}/${slug}/${path}`;
}

function serveObject(
  obj: R2ObjectBody,
  contentType: string,
  cacheable: boolean,
  tag: string,
  remainingSeconds?: number | null,
  extra?: { filename?: string; download?: boolean },
): Response {
  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("x-content-type-options", "nosniff");
  applyIsolation(headers, contentType);
  headers.set("cache-control", cacheable ? publicCacheControl(remainingSeconds) : privateCacheControl());
  if (cacheable) headers.set("cache-tag", tag);
  headers.set("etag", obj.httpEtag);
  if (obj.size != null) headers.set("content-length", String(obj.size));
  if (extra?.filename) {
    headers.set("content-disposition", contentDisposition(extra.download ? "attachment" : "inline", extra.filename));
  } else if (extra?.download) {
    headers.set("content-disposition", "attachment");
  }
  return new Response(obj.body, { headers });
}
