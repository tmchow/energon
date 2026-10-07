import { publishSiteChanges, snapshotFiles } from "./site-snapshot";
import { filePrefix, purgeContent, sitePrefix } from "./cache";
import {
  WRITE_PASSWORD_HEADER,
  WRITTEN_VIA_WRITE_PASSWORD,
  fileKey,
} from "./config";
import {
  PURGE_CLAIM_LIKE,
  WRITE_CLAIM_LIKE,
  d1Changed,
  expiredError,
  isExpired,
  isPurgeClaimed,
  isStaleClaim,
  isWriteClaimed,
  looseFileBusy,
  newWriteToken,
  NO_LOOSE_RECOVERY_SQL,
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
  discardR2Snapshots,
  releaseStorage,
  restoreR2Object,
  snapshotR2Object,
  tooLarge,
  type R2ObjectSnapshot,
} from "./http";
import { contentTypeFor } from "./mime";
import { instancePolicy } from "./policy";
import { assertFilePath, assertSlug, getSiteById } from "./sites";
import type { Env, SiteRow, WriteAuthority } from "./types";
import { putUpload, withUpload, type Upload } from "./upload";
import { filePublicUrl, isFileId, isSiteId, sitePublicUrl, urlFilename } from "./urls";

type GuestLooseRow = {
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
};

export const FORBIDDEN_PUT_HEADERS = [
  "x-filename",
  "x-energon-set-password",
  "x-energon-set-write-password",
  "x-energon-duplicate-from",
  "x-energon-ttl",
  "x-energon-write-policy",
];

export type LooseTarget = {
  kind: "loose";
  handle: string;
  id: string;
  filenameSeg: string;
};

export type SiteTarget = {
  kind: "site";
  handle: string;
  id: string;
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
    console.error(err instanceof Error ? err.stack || err.message : err);
    return guestJson({ error: "internal", message: "Something went wrong. Try again." }, 500);
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
    .first<GuestLooseRow>();
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

  return withUpload(request, env, instancePolicy(env).fileBytes, contentOrigin(env), (upload) =>
    guestPutLoose(env, ctx, request, target, row, authority, objectPath, upload));
}

async function guestPutLoose(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  target: LooseTarget,
  row: GuestLooseRow,
  authority: WriteAuthority,
  objectPath: string,
  upload: Upload,
): Promise<Response> {
  const policy = instancePolicy(env);
  if (upload.size > policy.fileBytes) throw tooLarge(upload.size, "", policy.fileBytes);

  if (isWriteClaimed(row.last_written_by) && !isStaleClaim(row.updated_at)) {
    throw await looseFileBusy(env, row.id, "Another write is in progress; retry this replacement.");
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
    throw await looseFileBusy(env, row.id, "Another write is in progress; retry this replacement.");
  }

  const key = fileKey(row.id, row.filename);
  let reserved: Awaited<ReturnType<typeof assertStorageRoom>> | number = 0;
  let previousState: R2ObjectSnapshot | null = null;
  let metadataCommitted = false;
  let wroteObject = false;
  const ts = new Date().toISOString();
  try {
    reserved = await assertStorageRoom(env.DB, upload.size, row.size, policy.platformBytes);
    previousState = await snapshotR2Object(env, key);
    await putUpload(env.BUCKET, key, upload, { httpMetadata: { contentType: row.content_type } });
    wroteObject = true;
    const updated = await env.DB.prepare(
      `UPDATE loose_files
       SET size = ?, updated_at = ?, written_via = ?
       WHERE id = ? AND last_written_by = ? AND write_password_hash = ?`,
    )
      .bind(upload.size, ts, WRITTEN_VIA_WRITE_PASSWORD, row.id, claim.token, authority.hash)
      .run();
    if (!d1Changed(updated)) {
      throw new ApiError(409, "file_write_lost", "The file changed during replacement; retry.");
    }
    metadataCommitted = true;
  } catch (err) {
    if (!metadataCommitted) {
      if (wroteObject) await restoreR2Object(env.BUCKET, key, previousState);
      await restoreLooseFileWriteClaim(env, row.id, claim);
      await releaseStorage(env.DB, reserved);
    }
    throw err;
  } finally {
    await discardR2Snapshots(env.BUCKET, [previousState]);
  }
  await releaseStorage(env.DB, reserved);
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
      size: upload.size,
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
  if (!isSiteId(target.id)) throw notFoundSite();
  let slug: string;
  try {
    slug = assertSlug(target.slug);
  } catch {
    throw notFoundSite();
  }
  const site = await getSiteById(env, target.id);
  if (!site || site.handle !== target.handle || site.slug !== slug) throw notFoundSite();
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

  const objectPath = `/${site.handle}/s/${site.id}/${slug}/`;
  const authority = await authorizeWrite(env, request, site.write_password_hash, objectPath);
  if (method === "PUT") rejectForbiddenPutHeaders(request);

  const writer = accountWriter(site.last_written_by, site.created_by);
  if (method === "DELETE") {
    return guestDeleteSitePath(env, ctx, request, site, path, authority, objectPath);
  }
  return guestPutSitePath(env, ctx, request, site, path, authority, objectPath, writer);
}

type GuestSiteFileRow = { size: number; content_type: string };

async function guestPutSitePath(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  site: SiteRow,
  path: string,
  authority: WriteAuthority,
  objectPath: string,
  writer: string,
): Promise<Response> {
  const existing = (await snapshotFiles(env, site)).find(file => file.path === path) ?? null;
  return withUpload(request, env, instancePolicy(env).fileBytes, contentOrigin(env), (upload) =>
    writeGuestSitePath(env, ctx, request, site, path, authority, objectPath, writer, existing, upload));
}

async function writeGuestSitePath(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  site: SiteRow,
  path: string,
  authority: WriteAuthority,
  objectPath: string,
  writer: string,
  existing: GuestSiteFileRow | null,
  upload: Upload,
): Promise<Response> {
  const policy = instancePolicy(env);
  if (upload.size > policy.fileBytes) throw tooLarge(upload.size, "", policy.fileBytes);
  const contentType = contentTypeFor(path, upload.head, request.headers.get("content-type"));
  await publishSiteChanges(env, site, { email: writer, userId: site.owner_id ?? undefined, via: "access",
    writePasswordHash: authority.hash, writtenVia: WRITTEN_VIA_WRITE_PASSWORD }, [{ path, upload, contentType }],
    sitePublicUrl(env, site.handle, site.id, site.slug, path));
  await clearGateAttempts(env, writeGateScopes(request, objectPath));
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]).catch(error => console.error("Site cache purge pending", error));
  return guestJson(
    {
      url: sitePublicUrl(env, site.handle, site.id, site.slug, path),
      path,
      size: upload.size,
      content_type: contentType,
    },
    existing ? 200 : 201,
  );
}

async function guestDeleteSitePath(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  site: SiteRow,
  path: string,
  authority: WriteAuthority,
  objectPath: string,
): Promise<Response> {
  if (!(await snapshotFiles(env, site)).some(file => file.path === path))
    throw new ApiError(404, "file_not_found", `No file at ${path}.`);
  await publishSiteChanges(env, site, { email: accountWriter(site.last_written_by, site.created_by),
    userId: site.owner_id ?? undefined, via: "access", writePasswordHash: authority.hash,
    writtenVia: WRITTEN_VIA_WRITE_PASSWORD }, [{ path, delete: true }], sitePublicUrl(env, site.handle, site.id, site.slug));
  await clearGateAttempts(env, writeGateScopes(request, objectPath));
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]).catch(error => console.error("Site cache purge pending", error));
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
       AND (ifnull(last_written_by, '') NOT LIKE ? OR updated_at IS NULL OR updated_at <= ?)
       AND ${NO_LOOSE_RECOVERY_SQL}`,
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
  if (value.includes("@") && !isPurgeClaimed(value) && !isWriteClaimed(value)) return value;
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
