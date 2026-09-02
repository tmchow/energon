import { privateCacheControl, publicCacheControl, purgeContent, siteCacheTag, sitePrefix } from "./cache";
import {
  involvementSql,
  likeNeedle,
  nextSiteCursor,
  siteCursorSql,
  takePage,
  type ListPage,
  type ListQuery,
} from "./catalog";
import { brandMark, documentShell } from "./chrome";
import { MAX_IMPORT_FILES, PRODUCT, RESERVED_SLUGS, SLUG_RE, formatBytes, siteKey } from "./config";
import {
  expiredError,
  expiredHtml,
  isExpired,
  isPurgeClaimed,
  PURGE_CLAIM_LIKE,
  purgeExpiredSite,
  remainingCacheSeconds,
  schedulePurgeExpiredSite,
} from "./expire";
import { isMarkdownName, respondMarkdown } from "./markdown";
import { passwordEcho, passwordHashFromInput, protectContent } from "./gate";
import { ensureHandle, ensureUser } from "./handles";
import { ApiError, assertStorageRoom, basename, contentDisposition, copyR2Object, deletePrefix, htmlPage, json, nanoid, normalizeRelPath, publicOrigin, tooLarge, wantsDownload } from "./http";
import { contentTypeFor } from "./mime";
import {
  assertCanMutate,
  assertCanSetWritePolicy,
  instancePolicy,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
} from "./policy";
import type { Actor, Env, SiteFileRow, SiteRow } from "./types";
import { sitePublicUrl } from "./urls";
import { packZip, unpackZip } from "./zip";

const SITE_SELECT =
  `handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, expires_at, write_policy`;

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
  handle: string,
  slug: string,
  path: string,
  size: number,
  contentType: string,
  updatedAt: string,
  lastWrittenBy: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(handle, slug, path) DO UPDATE SET
       size = excluded.size,
       content_type = excluded.content_type,
       updated_at = excluded.updated_at,
       last_written_by = excluded.last_written_by`,
  ).bind(handle, slug, path, size, contentType, updatedAt, lastWrittenBy);
}

async function deleteCreatedSiteMetadata(env: Env, handle: string, slug: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ?`).bind(handle, slug),
    env.DB.prepare(`DELETE FROM sites WHERE handle = ? AND slug = ?`).bind(handle, slug),
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
  handle: string,
  slug: string,
  paths: string[],
  previousRows: Map<string, SiteFileRow>,
  previousSite: SiteRow,
): Promise<void> {
  const pathBatchSize = Math.floor((100 - 1) / 2);
  for (let i = 0; i < paths.length || i === 0; i += pathBatchSize) {
    const statements: D1PreparedStatement[] = [];
    for (const path of paths.slice(i, i + pathBatchSize)) {
      statements.push(env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ? AND path = ?`).bind(handle, slug, path));
      const previous = previousRows.get(path);
      if (previous) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            previous.handle,
            previous.slug,
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
        env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`).bind(
          previousSite.updated_at,
          previousSite.last_written_by,
          handle,
          slug,
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

export async function getSite(env: Env, handle: string, slug: string): Promise<SiteRow | null> {
  return env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE handle = ? AND slug = ?`)
    .bind(handle, slug)
    .first<SiteRow>();
}

async function findSiteForActor(env: Env, actor: Actor, slug: string): Promise<SiteRow | null> {
  const handle = await ensureHandle(env, actor.email, actor.idpSub);
  const mine = await getSite(env, handle, slug);
  if (mine) return mine;
  const rows = await env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE slug = ?`)
    .bind(slug)
    .all<SiteRow>();
  const found = rows.results || [];
  if (found.length === 1) return found[0]!;
  return null;
}

async function fileCount(env: Env, handle: string, slug: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_files WHERE handle = ? AND slug = ?`)
    .bind(handle, slug)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function createSite(
  env: Env,
  actor: Actor,
  slugRaw: string,
  overwrite: boolean,
  password?: string,
  ctx?: ExecutionContext,
  ttl?: unknown,
  writePolicy?: unknown,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const slug = assertSlug(slugRaw);
  const user = await ensureUser(env, actor.email, actor.idpSub);
  const handle = user.handle;
  let existing = await getSite(env, handle, slug);
  if (existing && (isExpired(existing.expires_at) || isPurgeClaimed(existing.last_written_by))) {
    const purged = await purgeExpiredSite(env, ctx, handle, slug);
    existing = purged ? null : await getSite(env, handle, slug);
    if (existing && isPurgeClaimed(existing.last_written_by)) {
      throw expiredError("site");
    }
  }
  const url = sitePublicUrl(env, handle, slug);
  const hash = await passwordHashFromInput(password);
  const policy = instancePolicy(env);
  if (!existing) {
    const resolved = resolveExpiresAt(policy, ttl);
    const storedWrite = resolveCreateWritePolicy(env, writePolicy);
    const ts = new Date().toISOString();
    const stored = hash === undefined ? null : hash;
    await env.DB.prepare(
      `INSERT INTO sites (handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, expires_at, write_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(handle, slug, user.id, ts, ts, actor.email, actor.email, stored, resolved.expiresAt, storedWrite)
      .run();
    return {
      status: 201,
      body: {
        slug,
        handle,
        url,
        created: true,
        password_protected: Boolean(stored),
        password: passwordEcho(password, stored) ?? null,
        ttl: resolved.ttl,
        expires_at: resolved.expiresAt,
        write_policy: storedWrite,
      },
    };
  }
  if (!overwrite) {
    const count = await fileCount(env, handle, slug);
    throw new ApiError(
      409,
      "site_exists",
      `Site '${slug}' already exists at ${url} (last written by ${existing.last_written_by}). To write into it, POST again with overwrite: true. To keep both, pick a new slug.`,
      {
        url,
        handle,
        last_written_by: existing.last_written_by,
        updated_at: existing.updated_at,
        file_count: count,
        password_protected: Boolean(existing.password_hash),
        expires_at: existing.expires_at ?? null,
        hint: "Retry with {\"slug\":\"" + slug + "\",\"overwrite\":true} to claim this bucket. That does not delete existing files. Or pick a new slug.",
      },
    );
  }
  assertCanMutate(actor, existing);
  const ts = new Date().toISOString();
  const resolved = ttl === undefined ? null : resolveExpiresAt(policy, ttl);
  if (hash === undefined && !resolved) {
    await env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`)
      .bind(ts, actor.email, handle, slug)
      .run();
  } else if (hash === undefined && resolved) {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, expires_at = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, resolved.expiresAt, handle, slug)
      .run();
  } else if (resolved) {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, password_hash = ?, expires_at = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, hash, resolved.expiresAt, handle, slug)
      .run();
    purgeContent(ctx, [sitePrefix(handle, slug)]);
  } else {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, password_hash = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, hash, handle, slug)
      .run();
    purgeContent(ctx, [sitePrefix(handle, slug)]);
  }
  return {
    status: 200,
    body: {
      slug,
      handle,
      url,
      created: false,
      claimed: true,
      password_protected: hash === undefined ? Boolean(existing.password_hash) : Boolean(hash),
      password: passwordEcho(password, hash) ?? null,
      expires_at: resolved ? resolved.expiresAt : existing.expires_at ?? null,
      ttl: resolved ? resolved.ttl : undefined,
      write_policy: resolveWritePolicy(existing.write_policy),
    },
  };
}

export async function duplicateSite(
  env: Env,
  actor: Actor,
  fromSlugRaw: string,
  newSlugRaw: string,
  ctx?: ExecutionContext,
  ttl?: unknown,
  writePolicy?: unknown,
  password?: string,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const fromSlug = assertSlug(fromSlugRaw);
  const source = await requireSite(env, actor, fromSlug, { ctx });
  const files = await env.DB.prepare(
    `SELECT path, size, content_type FROM site_files WHERE handle = ? AND slug = ? ORDER BY path`,
  )
    .bind(source.handle, source.slug)
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
  await assertStorageRoom(env.DB, total, 0, instancePolicy(env).platformBytes);

  const created = await createSite(env, actor, newSlugRaw, false, password, ctx, ttl, writePolicy);
  const destHandle = String(created.body.handle);
  const destSlug = String(created.body.slug);
  const ts = new Date().toISOString();
  const copiedKeys: string[] = [];
  try {
    for (const f of listed) {
      const destinationKey = siteKey(destHandle, destSlug, f.path);
      await copyR2Object(env.BUCKET, siteKey(source.handle, source.slug, f.path), destinationKey);
      copiedKeys.push(destinationKey);
      await env.DB.prepare(
        `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(destHandle, destSlug, f.path, f.size, f.content_type, ts, actor.email)
        .run();
    }
    if (listed.length) {
      await env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`)
        .bind(ts, actor.email, destHandle, destSlug)
        .run();
    }
  } catch (err) {
    let cleanupError = false;
    try {
      await deleteR2Keys(env.BUCKET, copiedKeys);
    } catch {
      cleanupError = true;
    }
    try {
      await deleteCreatedSiteMetadata(env, destHandle, destSlug);
    } catch {
      cleanupError = true;
    }
    if (cleanupError) {
      throw new ApiError(500, "site_copy_rollback_failed", "The site copy failed and automatic cleanup also failed. Retry after storage recovers.");
    }
    throw err;
  }
  return {
    status: 201,
    body: {
      ...created.body,
      duplicated: true,
      duplicated_from: source.slug,
      file_count: listed.length,
    },
  };
}

export async function patchSite(
  env: Env,
  actor: Actor,
  slugRaw: string,
  patch: { password?: string; ttl?: unknown; setTtl?: boolean; write_policy?: unknown },
  ctx?: ExecutionContext,
): Promise<Response> {
  const slug = assertSlug(slugRaw);
  const wantsWrite = Object.prototype.hasOwnProperty.call(patch, "write_policy");
  const wantsOther = patch.password !== undefined || Boolean(patch.setTtl);
  const site = await requireSite(env, actor, slug, {
    allowExpired: Boolean(patch.setTtl),
    ctx,
    mutate: wantsOther,
  });
  let nextWrite = resolveWritePolicy(site.write_policy);
  if (wantsWrite) {
    assertCanSetWritePolicy(actor, site.created_by, site.owner_id);
    const parsed = requestedWritePolicy(patch.write_policy);
    if (parsed === "invalid" || parsed === null) {
      throw new ApiError(400, "bad_write_policy", "write_policy must be owner or instance.");
    }
    nextWrite = parsed;
  }
  const hash = await passwordHashFromInput(patch.password);
  const ts = new Date().toISOString();
  const resolved = patch.setTtl ? resolveExpiresAt(instancePolicy(env), patch.ttl) : null;
  const notClaimed = `last_written_by NOT LIKE ?`;
  if (hash !== undefined || resolved || wantsWrite) {
    const assignments = ["updated_at = ?", "last_written_by = ?"];
    const values: unknown[] = [ts, actor.email];
    if (hash !== undefined) {
      assignments.push("password_hash = ?");
      values.push(hash);
    }
    if (resolved) {
      assignments.push("expires_at = ?");
      values.push(resolved.expiresAt);
    }
    if (wantsWrite) {
      assignments.push("write_policy = ?");
      values.push(nextWrite);
    }
    const updated = await env.DB.prepare(
      `UPDATE sites SET ${assignments.join(", ")} WHERE handle = ? AND slug = ? AND ${notClaimed}`,
    )
      .bind(...values, site.handle, slug, PURGE_CLAIM_LIKE)
      .run();
    if (!Number(updated.meta?.changes ?? 0)) throw expiredError("site");
  }
  if (hash !== undefined || resolved) {
    purgeContent(ctx, [sitePrefix(site.handle, slug)]);
  }
  const protectedNow = hash === undefined ? Boolean(site.password_hash) : Boolean(hash);
  return json({
    slug,
    handle: site.handle,
    url: sitePublicUrl(env, site.handle, slug),
    password_protected: protectedNow,
    password: passwordEcho(patch.password, hash) ?? null,
    expires_at: resolved ? resolved.expiresAt : site.expires_at ?? null,
    ttl: resolved ? resolved.ttl : undefined,
    write_policy: nextWrite,
  });
}

export async function requireSite(
  env: Env,
  actor: Actor,
  slug: string,
  opts?: { allowExpired?: boolean; ctx?: ExecutionContext; mutate?: boolean },
): Promise<SiteRow> {
  const origin = publicOrigin(env);
  const site = await findSiteForActor(env, actor, slug);
  if (!site) {
    throw new ApiError(
      404,
      "site_not_found",
      `Site '${slug}' does not exist. Create it first with POST /v1/sites {"slug":"${slug}"}, then PUT files. See ${origin}/v1/help.`,
      { hint: `POST ${origin}/v1/sites with {"slug":"${slug}"}` },
    );
  }
  if (isPurgeClaimed(site.last_written_by)) {
    try {
      await purgeExpiredSite(env, opts?.ctx, site.handle, site.slug);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    if (!opts?.allowExpired) throw expiredError("site");
    const still = await findSiteForActor(env, actor, slug);
    if (!still) throw expiredError("site");
    if (opts.mutate) assertCanMutate(actor, still);
    return still;
  }
  if (isExpired(site.expires_at) && !opts?.allowExpired) {
    try {
      await purgeExpiredSite(env, opts?.ctx, site.handle, site.slug);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    throw expiredError("site");
  }
  if (opts?.mutate) assertCanMutate(actor, site);
  return site;
}

export async function putSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  slugRaw: string,
  pathRaw: string,
  bytes: Uint8Array,
  hintType: string | null,
): Promise<{ url: string; api_url: string; created: boolean; path: string; size: number; content_type: string }> {
  const slug = assertSlug(slugRaw);
  const path = assertFilePath(pathRaw);
  const policy = instancePolicy(env);
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);
  const site = await requireSite(env, actor, slug, { ctx, mutate: true });
  const existing = await env.DB.prepare(
    `SELECT size FROM site_files WHERE handle = ? AND slug = ? AND path = ?`,
  )
    .bind(site.handle, slug, path)
    .first<{ size: number }>();
  await assertStorageRoom(env.DB, bytes.byteLength, existing?.size ?? 0, policy.platformBytes);

  const contentType = contentTypeFor(path, bytes, hintType);
  const key = siteKey(site.handle, slug, path);
  const ts = new Date().toISOString();
  const previous = await snapshotR2Object(env.BUCKET, key);
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.batch([
      siteFileUpsert(env, site.handle, slug, path, bytes.byteLength, contentType, ts, actor.email),
      env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`).bind(
        ts,
        actor.email,
        site.handle,
        slug,
      ),
    ]);
  } catch (err) {
    await rollbackSiteStorage(env, key, previous, err);
  }

  const origin = publicOrigin(env);
  purgeContent(ctx, [sitePrefix(site.handle, slug)]);
  return {
    url: sitePublicUrl(env, site.handle, slug, path),
    api_url: `${origin}/v1/sites/${slug}/files/${path}`,
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
  slugRaw: string,
  pathRaw: string,
): Promise<Response> {
  const slug = assertSlug(slugRaw);
  const path = assertFilePath(pathRaw);
  const site = await requireSite(env, actor, slug, { ctx });
  const obj = await env.BUCKET.get(siteKey(site.handle, slug, path));
  if (!obj) {
    throw new ApiError(404, "file_not_found", `No file at ${sitePublicPathHint(site.handle, slug, path)}.`);
  }
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function importSiteZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  slugRaw: string,
  zipBytes: Uint8Array,
): Promise<{ slug: string; url: string; written: string[] }> {
  const policy = instancePolicy(env);
  if (zipBytes.byteLength > policy.fileBytes) throw tooLarge(zipBytes.byteLength, "", policy.fileBytes);
  const slug = assertSlug(slugRaw);
  const site = await requireSite(env, actor, slug, { ctx, mutate: true });
  const files = unpackZip(zipBytes, policy.fileBytes);
  const existingRows = await env.DB.prepare(`SELECT handle, slug, path, size, content_type, updated_at, last_written_by FROM site_files WHERE handle = ? AND slug = ?`)
    .bind(site.handle, slug)
    .all<SiteFileRow>();
  const existingMap = new Map((existingRows.results || []).map((r) => [r.path, r.size]));
  let additional = 0;
  let replacing = 0;
  for (const f of files) {
    additional += f.bytes.byteLength;
    replacing += existingMap.get(f.path) ?? 0;
  }
  await assertStorageRoom(env.DB, additional, replacing, policy.platformBytes);

  const ts = new Date().toISOString();
  const written: string[] = [];
  const previousRows = new Map<string, SiteFileRow>();
  const snapshots: R2State[] = [];
  const affectedPaths = files.map((f) => f.path);
  for (const row of existingRows.results || []) previousRows.set(row.path, row);
  try {
    for (const f of files) {
      const key = siteKey(site.handle, slug, f.path);
      const previous = await snapshotR2Object(env.BUCKET, key);
      snapshots.push({ key, snapshot: previous });
      const contentType = contentTypeFor(f.path, f.bytes, null);
      await env.BUCKET.put(key, f.bytes, { httpMetadata: { contentType } });
      await siteFileUpsert(env, site.handle, slug, f.path, f.bytes.byteLength, contentType, ts, actor.email).run();
      written.push(f.path);
    }
    await env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`)
      .bind(ts, actor.email, site.handle, slug)
      .run();
  } catch (err) {
    try {
      await restoreR2Snapshots(env.BUCKET, snapshots);
      await restoreSiteFileRows(env, site.handle, slug, affectedPaths, previousRows, site);
    } catch {
      throw new ApiError(500, "site_import_rollback_failed", "The site import failed and automatic rollback also failed. Retry after storage recovers.");
    }
    throw err;
  }
  purgeContent(ctx, [sitePrefix(site.handle, slug)]);
  return { slug, url: sitePublicUrl(env, site.handle, slug), written };
}

export async function exportSiteZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  slugRaw: string,
): Promise<Response> {
  const slug = assertSlug(slugRaw);
  const site = await requireSite(env, actor, slug, { ctx });
  const rows = await env.DB.prepare(
    `SELECT path, size FROM site_files WHERE handle = ? AND slug = ? ORDER BY path`,
  )
    .bind(site.handle, slug)
    .all<{ path: string; size: number }>();
  const listed = rows.results || [];
  if (listed.length === 0) {
    throw new ApiError(400, "empty_site", `Site '${slug}' has no files to zip.`);
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
    const obj = await env.BUCKET.get(siteKey(site.handle, slug, row.path));
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
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", contentDisposition("attachment", `${slug}.zip`));
  headers.set("cache-control", "no-store");
  headers.set("content-length", String(zip.byteLength));
  return new Response(zip, { headers });
}

export async function deleteSite(env: Env, ctx: ExecutionContext | undefined, actor: Actor, slugRaw: string): Promise<void> {
  const slug = assertSlug(slugRaw);
  let site: SiteRow;
  try {
    site = await requireSite(env, actor, slug, { allowExpired: true, mutate: true, ctx });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
  if (isPurgeClaimed(site.last_written_by)) {
    try {
      await purgeExpiredSite(env, ctx, site.handle, site.slug);
    } catch (err) {
      console.error("purgeExpiredSite failed", err);
    }
    return;
  }
  const sitePrefixKey = `sites/${site.handle}/${slug}/`;
  const listedKeys = await listR2Keys(env.BUCKET, sitePrefixKey);
  const backupPrefix = `sites/.integrity-backup/${nanoid(16)}/`;
  const backups: { sourceKey: string; backupKey: string }[] = [];
  try {
    for (const sourceKey of listedKeys) {
      const backupKey = `${backupPrefix}${sourceKey.slice(sitePrefixKey.length)}`;
      await copyR2Object(env.BUCKET, sourceKey, backupKey);
      backups.push({ sourceKey, backupKey });
    }
    await deletePrefix(env.BUCKET, `sites/${site.handle}/${slug}/`);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ?`).bind(site.handle, slug),
      env.DB.prepare(`DELETE FROM sites WHERE handle = ? AND slug = ?`).bind(site.handle, slug),
    ]);
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
    purgeContent(ctx, [sitePrefix(site.handle, slug)]);
  }
}

export async function deleteSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  slugRaw: string,
  pathRaw: string,
): Promise<void> {
  const slug = assertSlug(slugRaw);
  const path = assertFilePath(pathRaw);
  const site = await requireSite(env, actor, slug, { ctx, mutate: true });
  const existing = await env.DB.prepare(
    `SELECT path FROM site_files WHERE handle = ? AND slug = ? AND path = ?`,
  )
    .bind(site.handle, slug, path)
    .first();
  if (!existing) {
    throw new ApiError(404, "file_not_found", `No file at ${sitePublicPathHint(site.handle, slug, path)}.`);
  }
  const key = siteKey(site.handle, slug, path);
  const previous = await snapshotR2Object(env.BUCKET, key);
  await env.BUCKET.delete(key);
  const ts = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ? AND path = ?`).bind(site.handle, slug, path),
      env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`).bind(
        ts,
        actor.email,
        site.handle,
        slug,
      ),
    ]);
  } catch (err) {
    await rollbackSiteStorage(env, key, previous, err);
  }
  purgeContent(ctx, [sitePrefix(site.handle, slug)]);
}

export async function listSiteJson(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  slugRaw: string,
): Promise<Response> {
  const slug = assertSlug(slugRaw);
  const site = await requireSite(env, actor, slug, { ctx });
  const origin = publicOrigin(env);
  const files = await env.DB.prepare(
    `SELECT handle, slug, path, size, content_type, updated_at, last_written_by FROM site_files
     WHERE handle = ? AND slug = ? ORDER BY path`,
  )
    .bind(site.handle, slug)
    .all<SiteFileRow>();
  return json({
    slug,
    handle: site.handle,
    url: sitePublicUrl(env, site.handle, slug),
    created_at: site.created_at,
    updated_at: site.updated_at,
    created_by: site.created_by,
    last_written_by: site.last_written_by,
    password_protected: Boolean(site.password_hash),
    expires_at: site.expires_at ?? null,
    write_policy: resolveWritePolicy(site.write_policy),
    files: (files.results || []).map((f) => ({
      ...f,
      url: sitePublicUrl(env, site.handle, slug, f.path),
      api_url: `${origin}/v1/sites/${slug}/files/${f.path}`,
    })),
  });
}

export async function listSitesJson(env: Env, email: string, query: ListQuery): Promise<Response> {
  const page = await listSitesFor(env, email, query);
  return json({ sites: page.items, total: page.total, next_cursor: page.next_cursor });
}

export async function listSitesFor(
  env: Env,
  email: string,
  query: ListQuery,
): Promise<
  ListPage<{
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
    expires_at: string | null;
    write_policy: string;
  }>
> {
  const where = involvementSql("s.created_by", "s.last_written_by", email, query);
  const binds: unknown[] = [...where.binds];
  let search = "";
  const needle = likeNeedle(query.q);
  if (needle) {
    search = ` AND s.slug LIKE ?`;
    binds.push(needle);
  }
  const cursor = siteCursorSql(query);
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sites s WHERE ${where.sql}${search}`,
  )
    .bind(...binds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT s.handle, s.slug, s.created_at, s.updated_at, s.created_by, s.last_written_by,
            s.password_hash, s.expires_at, s.write_policy,
            COUNT(f.path) AS file_count, COALESCE(SUM(f.size), 0) AS size
     FROM sites s
     LEFT JOIN site_files f ON s.handle = f.handle AND s.slug = f.slug
     WHERE ${where.sql}${search}${cursor.sql}
     GROUP BY s.handle, s.slug
     ORDER BY ${cursor.order}
     LIMIT ?`,
  )
    .bind(...binds, ...cursor.binds, query.limit + 1)
    .all<{
      handle: string;
      slug: string;
      created_at: string;
      updated_at: string;
      created_by: string;
      last_written_by: string;
      password_hash: string | null;
      expires_at: string | null;
      write_policy: string | null;
      file_count: number;
      size: number;
    }>();
  const page = takePage(rows.results || [], query.limit);
  const items = page.items.map((s) => {
    const { password_hash, write_policy, ...rest } = s;
    return {
      ...rest,
      url: sitePublicUrl(env, s.handle, s.slug),
      password_protected: Boolean(password_hash),
      expires_at: s.expires_at ?? null,
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
  slugRaw: string,
  pathRaw: string,
  request: Request,
): Promise<Response> {
  const handle = handleRaw.trim().toLowerCase();
  let slug: string;
  try {
    slug = assertSlug(slugRaw);
  } catch {
    return htmlPage(`<!doctype html><meta charset="utf-8"><title>Not found</title><p>No such site.</p>`, 404, {
      "cache-control": "no-store",
    });
  }
  const site = await getSite(env, handle, slug);
  if (!site) {
    return htmlPage(
      `<!doctype html><meta charset="utf-8"><title>Not found</title><p>Site '${escapeHtml(slug)}' does not exist.</p>`,
      404,
      { "cache-control": "no-store" },
    );
  }
  if (isExpired(site.expires_at)) {
    schedulePurgeExpiredSite(env, ctx, handle, slug);
    return expiredHtml("site");
  }

  const cookiePath = `/${handle}/s/${slug}/`;
  const gated = await protectContent(request, site.password_hash, cookiePath, slug, env);
  if (gated) return gated;
  if (request.method === "POST") {
    return json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
  }

  const remaining = remainingCacheSeconds(site.expires_at);
  const cacheable = !site.password_hash;
  const wantsIndex = pathRaw === "" || pathRaw === "/";
  if (wantsIndex) {
    const index = await env.BUCKET.get(siteKey(handle, slug, "index.html"));
    if (index) return serveObject(index, "text/html; charset=utf-8", cacheable, siteCacheTag(handle, slug), remaining);
    const indexMd = await env.BUCKET.get(siteKey(handle, slug, "index.md"));
    if (indexMd) return respondMarkdown(request, indexMd, "index.md");
    return htmlPage(await fileListHtml(env, site), 200, {
      "cache-control": cacheable ? publicCacheControl(remaining) : privateCacheControl(),
      "cache-tag": siteCacheTag(handle, slug),
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
  const obj = await env.BUCKET.get(siteKey(handle, slug, path));
  if (!obj) {
    return htmlPage(
      `<!doctype html><meta charset="utf-8"><title>Not found</title><p>No file at ${escapeHtml(sitePublicPathHint(handle, slug, path))}.</p>`,
      404,
      { "cache-control": "no-store" },
    );
  }
  if (isMarkdownName(path)) return respondMarkdown(request, obj, path);
  const type = obj.httpMetadata?.contentType || "application/octet-stream";
  return serveObject(obj, type, cacheable, siteCacheTag(handle, slug), remaining, {
    filename: basename(path),
    download: wantsDownload(request),
  });
}

async function fileListHtml(env: Env, site: SiteRow): Promise<string> {
  const files = await env.DB.prepare(
    `SELECT path, size, content_type, updated_at FROM site_files WHERE handle = ? AND slug = ? ORDER BY path`,
  )
    .bind(site.handle, site.slug)
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
      <h1>/${escapeHtml(site.handle)}/s/${escapeHtml(site.slug)}/</h1>
      <p class="crumb">No index.html or index.md. Last written by ${escapeHtml(site.last_written_by)} at ${escapeHtml(site.updated_at)}.</p>
      <section class="card"><div class="card-body tight">${list}</div></section>
    </main>`,
  });
}

function sitePublicPathHint(handle: string, slug: string, path: string): string {
  return `/${handle}/s/${slug}/${path}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
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
