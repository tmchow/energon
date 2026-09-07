import { filePrefix, purgeContent, sitePrefix } from "./cache";
import {
  MAX_IMPORT_FILES,
  WRITE_PASSWORD_HEADER,
  WRITTEN_VIA_WRITE_PASSWORD,
  fileKey,
  siteKey,
} from "./config";
import {
  PURGE_CLAIM_LIKE,
  WRITE_CLAIM_LIKE,
  expiredError,
  isExpired,
  isPurgeClaimed,
  isStaleClaim,
  isWriteClaimed,
  newWriteToken,
  restoreLooseFileWriteClaim,
  staleClaimCutoff,
  type LooseFileWriteClaim,
} from "./expire";
import {
  clearGateAttempts,
  gateIsBlocked,
  hashesEqual,
  hashWritePassword,
  offeredWritePassword,
  recordGateFailures,
  writeGateScopes,
} from "./gate";
import { GUEST_WRITE_401_MESSAGE } from "./guest-write-protocol";
import {
  ApiError,
  assertStorageRoom,
  basename,
  contentOrigin,
  readBodyCapped,
  releaseStorage,
  tooLarge,
} from "./http";
import { contentTypeFor } from "./mime";
import { instancePolicy } from "./policy";
import { assertFilePath, assertSlug, getSite } from "./sites";
import type { Env, WriteAuthority } from "./types";
import { filePublicUrl, isFileId, sitePublicUrl, urlFilename } from "./urls";

const FORBIDDEN_PUT_HEADERS = [
  "x-filename",
  "x-energon-set-password",
  "x-energon-set-write-password",
  "x-energon-duplicate-from",
  "x-energon-ttl",
  "x-energon-write-policy",
];

type R2Snapshot = {
  bytes: Uint8Array;
  httpMetadata: R2HTTPMetadata | undefined;
  customMetadata: Record<string, string> | undefined;
};

export type LooseTarget = {
  kind: "loose";
  handle: string;
  id: string;
  filenameSeg: string;
};

export type SiteTarget = {
  kind: "site";
  handle: string;
  slug: string;
  rawPath: string;
};

export type GuestTarget = LooseTarget | SiteTarget;

export async function guestWrite(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  target: GuestTarget,
): Promise<Response> {
  try {
    return await guestWriteInner(env, ctx, request, target);
  } catch (err) {
    if (err instanceof ApiError) {
      return guestJson({ error: err.code, message: err.message, ...err.extra }, err.status);
    }
    throw err;
  }
}

async function guestWriteInner(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  target: GuestTarget,
): Promise<Response> {
  contentOrigin(env);
  const method = request.method;
  if (target.kind === "loose") return guestLoose(env, ctx, request, target, method);
  return guestSite(env, ctx, request, target, method);
}

async function guestLoose(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  target: LooseTarget,
  method: string,
): Promise<Response> {
  if (!isFileId(target.id)) throw notFoundFile();
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, size, content_type, expires_at, created_by, last_written_by, updated_at, write_password_hash
     FROM loose_files WHERE id = ?`,
  )
    .bind(target.id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      size: number;
      content_type: string;
      expires_at: string | null;
      created_by: string;
      last_written_by: string | null;
      updated_at: string | null;
      write_password_hash: string | null;
    }>();
  if (!row || (row.handle && row.handle !== target.handle)) throw notFoundFile();
  if (isPurgeClaimed(row.last_written_by) || isExpired(row.expires_at)) throw expiredError("file");

  if (method !== "PUT") {
    return methodNotAllowed("GET");
  }
  if (!row.write_password_hash) return methodNotAllowed("GET");

  const objectPath = `/${target.handle}/f/${row.id}/`;
  const authority = await authorizeWrite(env, request, row.write_password_hash, objectPath);
  rejectForbiddenPutHeaders(request);

  let filenameSeg: string;
  try {
    filenameSeg = basename(decodeURIComponent(target.filenameSeg));
  } catch {
    throw notFoundFile();
  }
  if (filenameSeg !== urlFilename(row.filename)) throw notFoundFile();

  const policy = instancePolicy(env);
  const bytes = await readBodyCapped(request, policy.fileBytes, contentOrigin(env));
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);

  if (isWriteClaimed(row.last_written_by) && !isStaleClaim(row.updated_at)) {
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this replacement.");
  }

  const claim = await claimLooseGuestWrite(env, row.id, row, authority.hash);
  if (!claim) {
    const current = await env.DB.prepare(
      `SELECT expires_at, last_written_by, write_password_hash FROM loose_files WHERE id = ?`,
    )
      .bind(row.id)
      .first<{ expires_at: string | null; last_written_by: string | null; write_password_hash: string | null }>();
    if (!current || isPurgeClaimed(current.last_written_by) || isExpired(current.expires_at)) {
      throw expiredError("file");
    }
    if (!current.write_password_hash || !hashesEqual(current.write_password_hash, authority.hash)) {
      return writePasswordRequired();
    }
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this replacement.");
  }

  const key = fileKey(row.id, row.filename);
  let reserved = 0;
  let previousState: R2Snapshot | null = null;
  let metadataCommitted = false;
  let wroteObject = false;
  const ts = new Date().toISOString();
  try {
    reserved = await assertStorageRoom(env.DB, bytes.byteLength, row.size, policy.platformBytes);
    previousState = await snapshotR2Object(env.BUCKET, key);
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: row.content_type } });
    wroteObject = true;
    const updated = await env.DB.prepare(
      `UPDATE loose_files
       SET size = ?, updated_at = ?, written_via = ?
       WHERE id = ? AND last_written_by = ? AND write_password_hash = ?`,
    )
      .bind(bytes.byteLength, ts, WRITTEN_VIA_WRITE_PASSWORD, row.id, claim.token, authority.hash)
      .run();
    if (!d1Changed(updated)) {
      throw new ApiError(409, "file_write_lost", "The file changed during replacement; retry.");
    }
    metadataCommitted = true;
  } catch (err) {
    if (!metadataCommitted) {
      if (wroteObject) await restoreR2Object(env.BUCKET, key, previousState).catch(() => undefined);
      await restoreLooseFileWriteClaim(env, row.id, claim).catch(() => undefined);
      await releaseStorage(env.DB, reserved);
    }
    throw err;
  }
  await releaseStorage(env.DB, row.size - bytes.byteLength);
  await env.DB.prepare(`UPDATE loose_files SET last_written_by = ? WHERE id = ? AND last_written_by = ?`)
    .bind(claim.restoreWriter, row.id, claim.token)
    .run()
    .catch((err) => {
      console.error("loose file guest write claim release failed", err);
    });
  await clearGateAttempts(env, writeGateScopes(request, objectPath));
  const handle = row.handle || target.handle;
  await purgeContent(ctx, [filePrefix(handle, row.id)]);
  return guestJson(
    {
      url: filePublicUrl(env, handle, row.id, row.filename),
      filename: row.filename,
      size: bytes.byteLength,
      content_type: row.content_type,
    },
    200,
  );
}

async function guestSite(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  target: SiteTarget,
  method: string,
): Promise<Response> {
  let slug: string;
  try {
    slug = assertSlug(target.slug);
  } catch {
    throw notFoundSite();
  }
  const site = await getSite(env, target.handle, slug);
  if (!site) throw notFoundSite();
  if (isPurgeClaimed(site.last_written_by) || isExpired(site.expires_at)) throw expiredError("site");

  const rawPath = target.rawPath;
  const isDirectory = rawPath === "" || rawPath === "/";
  if (isDirectory) return methodNotAllowed("GET");

  let path: string;
  try {
    path = assertFilePath(rawPath);
  } catch {
    throw new ApiError(
      400,
      "bad_path",
      `Path '${rawPath}' is not a safe relative file path. Remove leading slashes and '..' segments.`,
    );
  }

  if (method !== "PUT" && method !== "DELETE") {
    return methodNotAllowed("GET, PUT, DELETE");
  }
  if (!site.write_password_hash) return methodNotAllowed("GET");

  const objectPath = `/${site.handle}/s/${slug}/`;
  const authority = await authorizeWrite(env, request, site.write_password_hash, objectPath);
  if (method === "PUT") rejectForbiddenPutHeaders(request);

  const writer = accountWriter(site.last_written_by, site.created_by);
  if (method === "DELETE") {
    return guestDeleteSitePath(env, ctx, request, site.handle, slug, path, authority, objectPath);
  }
  return guestPutSitePath(env, ctx, request, site.handle, slug, path, authority, objectPath, writer);
}

async function guestPutSitePath(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  handle: string,
  slug: string,
  path: string,
  authority: WriteAuthority,
  objectPath: string,
  writer: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    `SELECT size, content_type, updated_at, last_written_by FROM site_files WHERE handle = ? AND slug = ? AND path = ?`,
  )
    .bind(handle, slug, path)
    .first<{ size: number; content_type: string; updated_at: string; last_written_by: string }>();
  if (!existing) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_files WHERE handle = ? AND slug = ?`)
      .bind(handle, slug)
      .first<{ n: number }>();
    if (Number(count?.n ?? 0) >= MAX_IMPORT_FILES) {
      throw new ApiError(
        400,
        "too_many_files",
        `That site already has ${MAX_IMPORT_FILES} files. Replace or delete a path, then retry.`,
      );
    }
  }
  const policy = instancePolicy(env);
  const bytes = await readBodyCapped(request, policy.fileBytes, contentOrigin(env));
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);
  const contentType = contentTypeFor(path, bytes, request.headers.get("content-type"));
  const key = siteKey(handle, slug, path);
  const ts = new Date().toISOString();
  const previous = await snapshotR2Object(env.BUCKET, key);
  const reserved = await assertStorageRoom(env.DB, bytes.byteLength, existing?.size ?? 0, policy.platformBytes);
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
    const wrote = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(handle, slug, path) DO UPDATE SET
           size = excluded.size,
           content_type = excluded.content_type,
           updated_at = excluded.updated_at,
           last_written_by = excluded.last_written_by`,
      ).bind(handle, slug, path, bytes.byteLength, contentType, ts, writer),
      env.DB.prepare(
        `UPDATE sites SET updated_at = ?, written_via = ? WHERE handle = ? AND slug = ? AND write_password_hash = ? AND last_written_by NOT LIKE ?`,
      ).bind(ts, WRITTEN_VIA_WRITE_PASSWORD, handle, slug, authority.hash, PURGE_CLAIM_LIKE),
    ]);
    if (!d1Changed(wrote[1]!)) {
      if (existing) {
        await env.DB.prepare(
          `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(handle, slug, path) DO UPDATE SET
             size = excluded.size,
             content_type = excluded.content_type,
             updated_at = excluded.updated_at,
             last_written_by = excluded.last_written_by`,
        )
          .bind(handle, slug, path, existing.size, existing.content_type, existing.updated_at, existing.last_written_by)
          .run();
      } else {
        await env.DB.prepare(`DELETE FROM site_files WHERE handle = ? AND slug = ? AND path = ?`)
          .bind(handle, slug, path)
          .run();
      }
      throw new ApiError(409, "site_write_lost", "The site changed during replacement; retry.");
    }
  } catch (err) {
    try {
      await restoreR2Object(env.BUCKET, key, previous);
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
  await clearGateAttempts(env, writeGateScopes(request, objectPath));
  await purgeContent(ctx, [sitePrefix(handle, slug)]);
  return guestJson(
    {
      url: sitePublicUrl(env, handle, slug, path),
      path,
      size: bytes.byteLength,
      content_type: contentType,
    },
    existing ? 200 : 201,
  );
}

async function guestDeleteSitePath(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  handle: string,
  slug: string,
  path: string,
  authority: WriteAuthority,
  objectPath: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    `SELECT path, size, content_type, updated_at, last_written_by FROM site_files WHERE handle = ? AND slug = ? AND path = ?`,
  )
    .bind(handle, slug, path)
    .first<{ path: string; size: number; content_type: string; updated_at: string; last_written_by: string }>();
  if (!existing) {
    throw new ApiError(404, "file_not_found", `No file at /${handle}/s/${slug}/${path}.`);
  }
  const ts = new Date().toISOString();
  const deleted = await env.DB.prepare(
    `DELETE FROM site_files WHERE handle = ? AND slug = ? AND path = ?
     AND EXISTS (SELECT 1 FROM sites WHERE handle = ? AND slug = ? AND write_password_hash = ? AND last_written_by NOT LIKE ?)`,
  )
    .bind(handle, slug, path, handle, slug, authority.hash, PURGE_CLAIM_LIKE)
    .run();
  if (!d1Changed(deleted)) {
    const still = await getSite(env, handle, slug);
    if (!still || isPurgeClaimed(still.last_written_by) || isExpired(still.expires_at)) throw expiredError("site");
    if (!still.write_password_hash || !hashesEqual(still.write_password_hash, authority.hash)) {
      return writePasswordRequired();
    }
    throw new ApiError(409, "site_write_lost", "The site changed during replacement; retry.");
  }
  const key = siteKey(handle, slug, path);
  try {
    await env.BUCKET.delete(key);
  } catch (err) {
    await env.DB.prepare(
      `INSERT INTO site_files (handle, slug, path, size, content_type, updated_at, last_written_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(handle, slug, path, existing.size, existing.content_type, existing.updated_at, existing.last_written_by)
      .run()
      .catch(() => undefined);
    throw err;
  }
  await env.DB.prepare(
    `UPDATE sites SET updated_at = ?, written_via = ? WHERE handle = ? AND slug = ? AND write_password_hash = ? AND last_written_by NOT LIKE ?`,
  )
    .bind(ts, WRITTEN_VIA_WRITE_PASSWORD, handle, slug, authority.hash, PURGE_CLAIM_LIKE)
    .run();
  await clearGateAttempts(env, writeGateScopes(request, objectPath));
  try {
    await purgeContent(ctx, [sitePrefix(handle, slug)]);
  } finally {
    await releaseStorage(env.DB, existing.size);
  }
  return guestJson({ deleted: true, path }, 200);
}

async function authorizeWrite(
  env: Env,
  request: Request,
  expectedHash: string,
  objectPath: string,
): Promise<WriteAuthority> {
  const scopes = writeGateScopes(request, objectPath);
  if (await gateIsBlocked(env, scopes)) {
    throw new ApiError(429, "rate_limited", "Too many password attempts. Try again later.");
  }
  const offered = offeredWritePassword(request);
  if (offered === null || !hashesEqual(await hashWritePassword(offered), expectedHash)) {
    if (offered !== null) await recordGateFailures(env, scopes);
    throw new ApiError(401, "password_required", GUEST_WRITE_401_MESSAGE);
  }
  return { kind: "writePassword", hash: expectedHash };
}

async function claimLooseGuestWrite(
  env: Env,
  id: string,
  state: { expires_at: string | null; last_written_by: string | null; updated_at: string | null; created_by: string },
  writeHash: string,
): Promise<LooseFileWriteClaim | null> {
  const now = new Date().toISOString();
  const token = newWriteToken();
  const claimed = await env.DB.prepare(
    `UPDATE loose_files SET last_written_by = ?, updated_at = ?
     WHERE id = ? AND write_password_hash = ?
       AND (expires_at IS NULL OR expires_at > ?)
       AND ifnull(last_written_by, '') NOT LIKE ?
       AND (ifnull(last_written_by, '') NOT LIKE ? OR updated_at IS NULL OR updated_at <= ?)`,
  )
    .bind(token, now, id, writeHash, now, PURGE_CLAIM_LIKE, WRITE_CLAIM_LIKE, staleClaimCutoff())
    .run();
  if (!d1Changed(claimed)) return null;
  return {
    restoreWriter: isWriteClaimed(state.last_written_by) ? state.created_by : state.last_written_by || state.created_by,
    restoreUpdatedAt: state.updated_at,
    token,
  };
}

function rejectForbiddenPutHeaders(request: Request): void {
  const ctype = (request.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("multipart/form-data")) {
    throw new ApiError(400, "bad_content_type", "Guest PUT accepts raw bytes only.");
  }
  for (const name of FORBIDDEN_PUT_HEADERS) {
    if (request.headers.get(name) !== null) {
      throw new ApiError(
        400,
        "bad_request",
        `Guest PUT does not accept ${name}. Send raw bytes and ${WRITE_PASSWORD_HEADER} only.`,
      );
    }
  }
}

function accountWriter(emailLike: string | null | undefined, fallback: string): string {
  const value = (emailLike || "").trim();
  if (value.includes("@") && !value.startsWith("__energon_")) return value;
  return fallback;
}

function notFoundFile(): ApiError {
  return new ApiError(404, "file_not_found", "No loose file with that id.");
}

function notFoundSite(): ApiError {
  return new ApiError(404, "site_not_found", "No such site.");
}

function methodNotAllowed(allow: string): Response {
  return guestJson({ error: "method_not_allowed", message: "Method not allowed." }, 405, { allow });
}

function writePasswordRequired(): Response {
  return guestJson({ error: "password_required", message: GUEST_WRITE_401_MESSAGE }, 401);
}

function guestJson(data: unknown, status: number, extra?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function d1Changed(result: { meta?: { changes?: number } }): boolean {
  return Number(result.meta?.changes ?? 0) > 0;
}

async function snapshotR2Object(bucket: R2Bucket, key: string): Promise<R2Snapshot | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    bytes: await object.bytes(),
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}

async function restoreR2Object(bucket: R2Bucket, key: string, snapshot: R2Snapshot | null): Promise<void> {
  if (!snapshot) {
    await bucket.delete(key);
    return;
  }
  await bucket.put(key, snapshot.bytes, {
    httpMetadata: snapshot.httpMetadata,
    customMetadata: snapshot.customMetadata,
  });
}
