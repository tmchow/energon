import { fileCacheTag, filePrefix, privateCacheControl, publicCacheControl, purgeContent } from "./cache";
import {
  involvementSql,
  likeNeedle,
  nextFileCursor,
  fileCursorSql,
  takePage,
  type ListPage,
  type ListQuery,
} from "./catalog";
import { FILE_ID_LEN, fileKey } from "./config";
import {
  expiredError,
  expiredHtml,
  claimLooseFileForDelete,
  claimLooseFileForWrite,
  isExpired,
  isPurgeClaimed,
  isStaleClaim,
  isWriteClaimed,
  PURGE_CLAIM_LIKE,
  purgeExpiredFile,
  releaseLooseFileWriteClaim,
  remainingCacheSeconds,
  schedulePurgeExpiredFile,
  staleClaimCutoff,
  WRITE_CLAIM_LIKE,
} from "./expire";
import { ensureHandle, ensureUser } from "./handles";
import { listSitesFor } from "./sites";
import { passwordEcho, passwordField, passwordHashFromInput, protectContent, readSetPasswordHeader } from "./gate";
import { filePublicUrl, isFileId, urlFilename } from "./urls";
import {
  ApiError,
  assertStorageRoom,
  basename,
  contentOrigin,
  contentDisposition,
  copyR2Object,
  json,
  nanoid,
  publicOrigin,
  readBodyCapped,
  tooLarge,
  wantsDownload,
} from "./http";
import { isMarkdownName, respondMarkdown } from "./markdown";
import { contentTypeFor } from "./mime";
import {
  assertCanMutate,
  assertCanSetWritePolicy,
  instancePolicy,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
  ttlFromRequest,
  writePolicyFromRequest,
} from "./policy";
import type { Actor, Env, LooseFileRow } from "./types";

type R2Snapshot = {
  bytes: Uint8Array;
  httpMetadata: R2HTTPMetadata | undefined;
  customMetadata: Record<string, string> | undefined;
};

export async function createLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  filenameRaw: string,
  bytes: Uint8Array,
  hintType: string | null,
  password?: string,
  ttl?: unknown,
  writePolicy?: unknown,
): Promise<Response> {
  const policy = instancePolicy(env);
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);
  const filename = basename(filenameRaw).slice(0, 180) || "file";
  if (filename === "." || filename === ".." || filename.includes("/")) {
    throw new ApiError(400, "bad_filename", "Give a simple filename, not a path.");
  }
  contentOrigin(env);
  await assertStorageRoom(env.DB, bytes.byteLength, 0, policy.platformBytes);
  const user = await ensureUser(env, actor.email);
  const handle = user.handle;
  const id = await mintFileId(env);
  const contentType = contentTypeFor(filename, bytes, hintType);
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const stored = hash === undefined ? null : hash;
  const resolved = resolveExpiresAt(policy, ttl);
  const storedWrite = resolveCreateWritePolicy(env, writePolicy);
  const key = fileKey(id, filename);
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare(
      `INSERT INTO loose_files (id, handle, owner_id, filename, size, content_type, created_at, created_by, updated_at, last_written_by, password_hash, expires_at, write_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, handle, user.id, filename, bytes.byteLength, contentType, ts, actor.email, ts, actor.email, stored, resolved.expiresAt, storedWrite)
      .run();
  } catch (err) {
    await env.BUCKET.delete(key).catch(() => undefined);
    throw err;
  }
  const origin = publicOrigin(env);
  const url = filePublicUrl(env, handle, id, filename);
  const api_url = `${origin}/v1/files/${id}`;
  purgeContent(ctx, [filePrefix(handle, id)]);
  return json(
    {
      url,
      api_url,
      id,
      handle,
      filename,
      size: bytes.byteLength,
      content_type: contentType,
      password_protected: Boolean(stored),
      password: passwordEcho(password, stored) ?? null,
      ttl: resolved.ttl,
      expires_at: resolved.expiresAt,
      write_policy: storedWrite,
    },
    201,
  );
}

export async function duplicateLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  fromIdRaw: string,
  filenameRaw?: string | null,
  password?: string,
  ttl?: unknown,
  writePolicy?: unknown,
): Promise<Response> {
  const fromId = fromIdRaw.trim();
  if (!isFileId(fromId)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const source = await env.DB.prepare(
    `SELECT id, handle, filename, size, content_type, expires_at FROM loose_files WHERE id = ?`,
  )
    .bind(fromId)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      size: number;
      content_type: string;
      expires_at: string | null;
    }>();
  if (!source) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (isExpired(source.expires_at)) {
    try {
      await purgeExpiredFile(env, ctx, source.id, source.handle, source.filename);
    } catch (err) {
      console.error("purgeExpiredFile failed", err);
    }
    throw expiredError("file");
  }
  contentOrigin(env);
  const policy = instancePolicy(env);
  await assertStorageRoom(env.DB, source.size, 0, policy.platformBytes);
  const user = await ensureUser(env, actor.email);
  const handle = user.handle;
  const id = await mintFileId(env);
  const filename = basename(filenameRaw || source.filename).slice(0, 180) || source.filename;
  if (filename === "." || filename === ".." || filename.includes("/")) {
    throw new ApiError(400, "bad_filename", "Give a simple filename, not a path.");
  }
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const stored = hash === undefined ? null : hash;
  const resolved = resolveExpiresAt(policy, ttl);
  const storedWrite = resolveCreateWritePolicy(env, writePolicy);
  const newKey = fileKey(id, filename);
  try {
    await copyR2Object(env.BUCKET, fileKey(source.id, source.filename), newKey);
    await env.DB.prepare(
      `INSERT INTO loose_files (id, handle, owner_id, filename, size, content_type, created_at, created_by, updated_at, last_written_by, password_hash, expires_at, write_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, handle, user.id, filename, source.size, source.content_type, ts, actor.email, ts, actor.email, stored, resolved.expiresAt, storedWrite)
      .run();
  } catch (err) {
    await env.BUCKET.delete(newKey).catch(() => undefined);
    throw err;
  }
  const origin = publicOrigin(env);
  const url = filePublicUrl(env, handle, id, filename);
  purgeContent(ctx, [filePrefix(handle, id)]);
  return json(
    {
      url,
      api_url: `${origin}/v1/files/${id}`,
      id,
      handle,
      filename,
      size: source.size,
      content_type: source.content_type,
      created_by: actor.email,
      password_protected: Boolean(stored),
      password: passwordEcho(password, stored) ?? null,
      ttl: resolved.ttl,
      expires_at: resolved.expiresAt,
      write_policy: storedWrite,
      duplicated: true,
      duplicated_from: source.id,
    },
    201,
  );
}

export async function postLooseFromRequest(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  request: Request,
): Promise<Response> {
  const origin = publicOrigin(env);
  const headerDup =
    request.headers.get("X-Energon-Duplicate-From") || request.headers.get("x-energon-duplicate-from");
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    const text = await request.text();
    const filename = request.headers.get("X-Filename") || request.headers.get("x-filename");
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }
    const fromHeader = headerDup && headerDup.trim();
    const fromBody = body && typeof body.duplicate_from === "string" ? body.duplicate_from.trim() : "";
    // X-Filename means the body is file bytes (including application/json).
    // duplicate_from in that JSON is content, not a copy request, unless the header is set.
    const from = fromHeader || (!filename && fromBody) || "";
    if (from) {
      return duplicateLooseFile(
        env,
        ctx,
        actor,
        from,
        (body && typeof body.filename === "string" ? body.filename : null) || filename || null,
        body ? passwordField(body) : readSetPasswordHeader(request),
        body ? body.ttl : ttlFromRequest(request),
        body ? body.write_policy : writePolicyFromRequest(request),
      );
    }
    if (filename) {
      const bytes = new TextEncoder().encode(text);
      const policy = instancePolicy(env);
      if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, origin, policy.fileBytes);
      return createLooseFile(
        env,
        ctx,
        actor,
        filename,
        bytes,
        "application/json",
        readSetPasswordHeader(request),
        ttlFromRequest(request),
        writePolicyFromRequest(request),
      );
    }
    throw new ApiError(
      400,
      "missing_file",
      'Send duplicate_from to copy an existing file, or upload bytes (multipart field "file" / raw body plus X-Filename).',
    );
  }
  if (ctype.includes("multipart/form-data")) {
    const form = await request.formData();
    const formDup = form.get("duplicate_from");
    const from =
      (typeof formDup === "string" && formDup.trim()) || (headerDup && headerDup.trim()) || "";
    if (from) {
      if (form.get("file") instanceof File) {
        throw new ApiError(
          400,
          "bad_duplicate",
          "Send duplicate_from or a file, not both. duplicate_from copies existing bytes.",
        );
      }
      const formName = form.get("filename");
      const formPw = form.get("password");
      const password =
        readSetPasswordHeader(request) ?? (typeof formPw === "string" ? formPw : undefined);
      return duplicateLooseFile(
        env,
        ctx,
        actor,
        from,
        typeof formName === "string" ? formName : null,
        password,
        ttlFromRequest(request, form),
        writePolicyFromRequest(request, form),
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(
        400,
        "missing_file",
        'Send multipart form field "file", or a raw body with header X-Filename.',
      );
    }
    const policy = instancePolicy(env);
    if (file.size > policy.fileBytes) throw tooLarge(file.size, origin, policy.fileBytes);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const formPw = form.get("password");
    const password =
      readSetPasswordHeader(request) ?? (typeof formPw === "string" ? formPw : undefined);
    return createLooseFile(
      env,
      ctx,
      actor,
      file.name,
      bytes,
      file.type || null,
      password,
      ttlFromRequest(request, form),
      writePolicyFromRequest(request, form),
    );
  }
  if (headerDup && headerDup.trim()) {
    const filename = request.headers.get("X-Filename") || request.headers.get("x-filename");
    return duplicateLooseFile(
      env,
      ctx,
      actor,
      headerDup.trim(),
      filename,
      readSetPasswordHeader(request),
      ttlFromRequest(request),
      writePolicyFromRequest(request),
    );
  }
  const filename = request.headers.get("X-Filename") || request.headers.get("x-filename");
  if (!filename) {
    throw new ApiError(
      400,
      "missing_filename",
      "Raw uploads need header X-Filename (for example notes.md), or send multipart field file.",
    );
  }
  const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, origin);
  return createLooseFile(
    env,
    ctx,
    actor,
    filename,
    bytes,
    request.headers.get("content-type"),
    readSetPasswordHeader(request),
    ttlFromRequest(request),
    writePolicyFromRequest(request),
  );
}

export async function putLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
  bytes: Uint8Array,
  filenameRaw: string | null,
  hintType: string | null,
  password?: string,
): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const policy = instancePolicy(env);
  if (bytes.byteLength > policy.fileBytes) throw tooLarge(bytes.byteLength, "", policy.fileBytes);
  const existing = await env.DB.prepare(
    `SELECT id, handle, filename, size, expires_at, created_by, last_written_by, updated_at, write_policy FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      size: number;
      expires_at: string | null;
      created_by: string;
      last_written_by: string | null;
      updated_at: string | null;
      write_policy: string | null;
    }>();
  if (!existing) {
    throw new ApiError(
      404,
      "file_not_found",
      `No loose file '${id}'. Create it first with POST /v1/files, then PUT /v1/files/{id} to replace it.`,
    );
  }
  if (isWriteClaimed(existing.last_written_by) && !isStaleClaim(existing.updated_at)) {
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this replacement.");
  }
  if (isPurgeClaimed(existing.last_written_by) || isExpired(existing.expires_at)) {
    try {
      await purgeExpiredFile(env, ctx, existing.id, existing.handle, existing.filename);
    } catch (err) {
      console.error("purgeExpiredFile failed", err);
    }
    throw expiredError("file");
  }
  assertCanMutate(actor, existing);
  let filename = existing.filename;
  if (filenameRaw) {
    filename = basename(filenameRaw).slice(0, 180) || existing.filename;
    if (filename === "." || filename === ".." || filename.includes("/")) {
      throw new ApiError(400, "bad_filename", "Give a simple filename, not a path.");
    }
  }
  contentOrigin(env);
  await assertStorageRoom(env.DB, bytes.byteLength, existing.size, policy.platformBytes);
  const contentType = contentTypeFor(filename, bytes, hintType);
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const handle = existing.handle || (await ensureHandle(env, actor.email));
  const oldKey = fileKey(id, existing.filename);
  const newKey = fileKey(id, filename);
  const renamed = newKey !== oldKey;
  const claim = await claimLooseFileForWrite(
    env,
    id,
    existing.expires_at,
    existing.last_written_by,
    existing.created_by,
  );
  if (!claim) {
    const current = await env.DB.prepare(`SELECT expires_at, last_written_by FROM loose_files WHERE id = ?`)
      .bind(id)
      .first<{ expires_at: string | null; last_written_by: string | null }>();
    if (!current || isPurgeClaimed(current.last_written_by) || isExpired(current.expires_at)) {
      try {
        await purgeExpiredFile(env, ctx, id, existing.handle, existing.filename);
      } catch (err) {
        console.error("purgeExpiredFile failed", err);
      }
      throw expiredError("file");
    }
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this replacement.");
  }
  let previousState: R2Snapshot | null = null;
  let metadataCommitted = false;
  try {
    previousState = renamed ? null : await snapshotR2Object(env.BUCKET, oldKey);
    await env.BUCKET.put(newKey, bytes, { httpMetadata: { contentType } });
    if (hash === undefined) {
      const updated = await env.DB.prepare(
        `UPDATE loose_files
         SET handle = COALESCE(handle, ?), filename = ?, size = ?, content_type = ?, updated_at = ?, last_written_by = ?
         WHERE id = ? AND last_written_by = ?`,
      )
        .bind(handle, filename, bytes.byteLength, contentType, ts, claim.token, id, claim.token)
        .run();
      if (!Number(updated.meta?.changes ?? 0)) {
        throw new ApiError(409, "file_write_lost", "The file changed during replacement; retry.");
      }
    } else {
      const updated = await env.DB.prepare(
        `UPDATE loose_files
         SET handle = COALESCE(handle, ?), filename = ?, size = ?, content_type = ?, updated_at = ?, last_written_by = ?, password_hash = ?
         WHERE id = ? AND last_written_by = ?`,
      )
        .bind(handle, filename, bytes.byteLength, contentType, ts, claim.token, hash, id, claim.token)
        .run();
      if (!Number(updated.meta?.changes ?? 0)) {
        throw new ApiError(409, "file_write_lost", "The file changed during replacement; retry.");
      }
    }
    metadataCommitted = true;
    if (renamed) await env.BUCKET.delete(oldKey).catch(() => undefined);
  } catch (err) {
    if (!metadataCommitted) {
      await restoreR2Object(env.BUCKET, newKey, renamed ? null : previousState).catch(() => undefined);
      await releaseLooseFileWriteClaim(env, id, claim.token, claim.restoreWriter).catch(() => undefined);
    }
    throw err;
  }
  await releaseLooseFileWriteClaim(env, id, claim.token, actor.email).catch((err) => {
    console.error("loose file write claim release failed", err);
  });
  const origin = publicOrigin(env);
  const url = filePublicUrl(env, handle, id, filename);
  purgeContent(ctx, [filePrefix(handle, id)]);
  const row = await env.DB.prepare(`SELECT password_hash FROM loose_files WHERE id = ?`)
    .bind(id)
    .first<{ password_hash: string | null }>();
  return json({
    url,
    api_url: `${origin}/v1/files/${id}`,
    id,
    handle,
    filename,
    size: bytes.byteLength,
    content_type: contentType,
    replaced: true,
    password_protected: Boolean(row?.password_hash),
    password: passwordEcho(password, hash) ?? null,
  });
}

export async function patchLoose(
  env: Env,
  actor: Actor,
  id: string,
  patch: { password?: string; ttl?: unknown; setTtl?: boolean; write_policy?: unknown },
  ctx?: ExecutionContext,
): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const existing = await env.DB.prepare(
    `SELECT id, handle, filename, password_hash, expires_at, created_by, last_written_by, updated_at, write_policy FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      password_hash: string | null;
      expires_at: string | null;
      created_by: string;
      last_written_by: string | null;
      updated_at: string | null;
      write_policy: string | null;
    }>();
  if (!existing) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (isWriteClaimed(existing.last_written_by) && !isStaleClaim(existing.updated_at)) {
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this update.");
  }
  if (isPurgeClaimed(existing.last_written_by) || (isExpired(existing.expires_at) && !patch.setTtl)) {
    try {
      await purgeExpiredFile(env, ctx, existing.id, existing.handle, existing.filename);
    } catch (err) {
      console.error("purgeExpiredFile failed", err);
    }
    throw expiredError("file");
  }
  const wantsWrite = Object.prototype.hasOwnProperty.call(patch, "write_policy");
  const wantsOther = patch.password !== undefined || Boolean(patch.setTtl);
  if (wantsOther) assertCanMutate(actor, existing);
  let nextWrite = resolveWritePolicy(existing.write_policy);
  if (wantsWrite) {
    assertCanSetWritePolicy(actor, existing.created_by);
    const parsed = requestedWritePolicy(patch.write_policy);
    if (parsed === "invalid" || parsed === null) {
      throw new ApiError(400, "bad_write_policy", "write_policy must be owner or instance.");
    }
    nextWrite = parsed;
  }
  const hash = await passwordHashFromInput(patch.password);
  const ts = new Date().toISOString();
  const handle = existing.handle || (await ensureHandle(env, actor.email));
  const resolved = patch.setTtl ? resolveExpiresAt(instancePolicy(env), patch.ttl) : null;
  const notClaimed = `ifnull(last_written_by, '') NOT LIKE ? AND (ifnull(last_written_by, '') NOT LIKE ? OR updated_at IS NULL OR updated_at <= ?)`;
  const claimGuards = [PURGE_CLAIM_LIKE, WRITE_CLAIM_LIKE, staleClaimCutoff()] as const;
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
      `UPDATE loose_files SET ${assignments.join(", ")} WHERE id = ? AND ${notClaimed}`,
    )
      .bind(...values, id, ...claimGuards)
      .run();
    if (!Number(updated.meta?.changes ?? 0)) await throwLooseFileMutationConflict(env, id);
  }
  if (hash !== undefined || resolved) {
    purgeContent(ctx, [filePrefix(handle, id)]);
  }
  const origin = publicOrigin(env);
  const protectedNow = hash === undefined ? Boolean(existing.password_hash) : Boolean(hash);
  return json({
    id,
    handle,
    filename: existing.filename,
    url: filePublicUrl(env, handle, id, existing.filename),
    api_url: `${origin}/v1/files/${id}`,
    password_protected: protectedNow,
    password: passwordEcho(patch.password, hash) ?? null,
    expires_at: resolved ? resolved.expiresAt : existing.expires_at ?? null,
    ttl: resolved ? resolved.ttl : undefined,
    write_policy: nextWrite,
  });
}

async function throwLooseFileMutationConflict(env: Env, id: string): Promise<never> {
  const current = await env.DB.prepare(`SELECT last_written_by FROM loose_files WHERE id = ?`)
    .bind(id)
    .first<{ last_written_by: string | null }>();
  if (isWriteClaimed(current?.last_written_by)) {
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this update.");
  }
  throw expiredError("file");
}

export async function putLooseFromRequest(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
  request: Request,
): Promise<Response> {
  const origin = publicOrigin(env);
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(
        400,
        "missing_file",
        'Send multipart form field "file", or a raw body with optional X-Filename.',
      );
    }
    const policy = instancePolicy(env);
    if (file.size > policy.fileBytes) throw tooLarge(file.size, origin, policy.fileBytes);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const formPw = form.get("password");
    const password =
      readSetPasswordHeader(request) ?? (typeof formPw === "string" ? formPw : undefined);
    return putLooseFile(env, ctx, actor, id, bytes, file.name || null, file.type || null, password);
  }
  const filename = request.headers.get("X-Filename") || request.headers.get("x-filename");
  const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, origin);
  return putLooseFile(
    env,
    ctx,
    actor,
    id,
    bytes,
    filename,
    request.headers.get("content-type"),
    readSetPasswordHeader(request),
  );
}

export async function getLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  id: string,
  opts?: { attachment?: boolean },
): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, content_type, expires_at, write_policy FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      content_type: string;
      expires_at: string | null;
      write_policy: string | null;
    }>();
  if (!row) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (isExpired(row.expires_at)) {
    try {
      await purgeExpiredFile(env, ctx, row.id, row.handle, row.filename);
    } catch (err) {
      console.error("purgeExpiredFile failed", err);
    }
    throw expiredError("file");
  }
  const obj = await env.BUCKET.get(fileKey(row.id, row.filename));
  if (!obj) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || row.content_type || "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", contentDisposition(opts?.attachment ? "attachment" : "inline", row.filename));
  headers.set("x-energon-write-policy", resolveWritePolicy(row.write_policy));
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function deleteLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
): Promise<void> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, expires_at, created_by, last_written_by, updated_at, write_policy FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      expires_at: string | null;
      created_by: string;
      last_written_by: string | null;
      updated_at: string | null;
      write_policy: string | null;
    }>();
  if (!row) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  assertCanMutate(actor, row);
  if (isWriteClaimed(row.last_written_by) && !isStaleClaim(row.updated_at)) {
    throw new ApiError(409, "file_busy", "Another write is in progress; retry this deletion.");
  }
  if (isPurgeClaimed(row.last_written_by)) throw expiredError("file");
  const claim = await claimLooseFileForDelete(
    env,
    id,
    row.expires_at,
    row.last_written_by,
    row.created_by,
  );
  if (!claim) {
    const current = await env.DB.prepare(`SELECT last_written_by FROM loose_files WHERE id = ?`)
      .bind(id)
      .first<{ last_written_by: string | null }>();
    if (!current) throw new ApiError(404, "file_not_found", "No loose file with that id.");
    if (isPurgeClaimed(current.last_written_by)) throw expiredError("file");
    throw new ApiError(409, "file_busy", "The file changed during deletion; retry.");
  }
  const key = fileKey(row.id, row.filename);
  let previousState: R2Snapshot | null = null;
  let storageDeleted = false;
  try {
    previousState = await snapshotR2Object(env.BUCKET, key);
    await env.BUCKET.delete(key);
    storageDeleted = true;
    const dropped = await env.DB.prepare(`DELETE FROM loose_files WHERE id = ? AND last_written_by = ?`)
      .bind(id, claim.token)
      .run();
    if (!Number(dropped.meta?.changes ?? 0)) {
      throw new ApiError(409, "file_delete_lost", "The file changed during deletion; retry.");
    }
  } catch (err) {
    let failure = err;
    if (storageDeleted) {
      try {
        await restoreR2Object(env.BUCKET, key, previousState);
      } catch {
        failure = new ApiError(
          500,
          "file_delete_rollback_failed",
          "The file deletion failed and automatic rollback also failed. Retry after storage recovers.",
        );
      }
    }
    await releaseLooseFileWriteClaim(env, id, claim.token, claim.restoreWriter).catch(() => undefined);
    throw failure;
  }
  if (row.handle) purgeContent(ctx, [filePrefix(row.handle, id)]);
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

export async function listLooseJson(env: Env, email: string, query: ListQuery): Promise<Response> {
  const page = await listLooseFor(env, email, query);
  return json({ files: page.items, total: page.total, next_cursor: page.next_cursor });
}

export async function listLooseFor(
  env: Env,
  email: string,
  query: ListQuery,
): Promise<
  ListPage<{
    id: string;
    filename: string;
    url: string;
    api_url: string;
    size: number;
    content_type: string;
    created_at: string;
    created_by: string;
    updated_at: string | null;
    last_written_by: string | null;
    password_protected: boolean;
    expires_at: string | null;
    write_policy: string;
  }>
> {
  const origin = publicOrigin(env);
  const where = involvementSql("created_by", "last_written_by", email, query);
  const binds: unknown[] = [...where.binds];
  let search = "";
  const needle = likeNeedle(query.q);
  if (needle) {
    search = ` AND filename LIKE ?`;
    binds.push(needle);
  }
  const cursor = fileCursorSql(query);
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM loose_files WHERE ${where.sql}${search}`,
  )
    .bind(...binds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT id, handle, filename, size, content_type, created_at, created_by, updated_at, last_written_by, password_hash, expires_at, write_policy
     FROM loose_files
     WHERE ${where.sql}${search}${cursor.sql}
     ORDER BY ${cursor.order}
     LIMIT ?`,
  )
    .bind(...binds, ...cursor.binds, query.limit + 1)
    .all<LooseFileRow>();
  const page = takePage(rows.results || [], query.limit);
  const items = page.items.map((f) => {
    const { password_hash, write_policy, ...rest } = f;
    return {
      ...rest,
      url: f.handle ? filePublicUrl(env, f.handle, f.id, f.filename) : `${origin}/v1/files/${f.id}`,
      api_url: `${origin}/v1/files/${f.id}`,
      password_protected: Boolean(password_hash),
      expires_at: f.expires_at ?? null,
      write_policy: resolveWritePolicy(write_policy),
    };
  });
  const last = page.items[page.items.length - 1];
  return {
    items,
    total,
    next_cursor: page.hasMore && last ? nextFileCursor(query.sort, last) : null,
  };
}

export async function serveLoose(
  env: Env,
  ctx: ExecutionContext,
  handleRaw: string,
  id: string,
  filenameRaw: string,
  request: Request,
): Promise<Response> {
  if (!isFileId(id)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const handle = handleRaw.trim().toLowerCase();
  let filename: string;
  try {
    filename = decodeURIComponent(filenameRaw);
  } catch {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  filename = basename(filename);
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, password_hash, expires_at FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      password_hash: string | null;
      expires_at: string | null;
    }>();
  if (!row || (row.handle && row.handle !== handle)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (isExpired(row.expires_at)) {
    schedulePurgeExpiredFile(env, ctx, row.id, row.handle, row.filename);
    return expiredHtml("file");
  }

  const cookiePath = `/${handle}/f/${id}/`;
  const gated = await protectContent(request, row.password_hash, cookiePath, row.filename);
  if (gated) return gated;
  if (request.method === "POST") {
    return json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
  }

  const pretty = urlFilename(row.filename);
  if (filename !== pretty) {
    return Response.redirect(filePublicUrl(env, handle, id, row.filename), 302);
  }
  const obj = await env.BUCKET.get(fileKey(id, row.filename));
  if (!obj) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (isMarkdownName(row.filename)) {
    return respondMarkdown(request, obj, row.filename);
  }
  const remaining = remainingCacheSeconds(row.expires_at);
  const cacheable = !row.password_hash;
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "content-disposition",
    contentDisposition(wantsDownload(request) ? "attachment" : "inline", row.filename),
  );
  headers.set("cache-control", cacheable ? publicCacheControl(remaining) : privateCacheControl());
  if (cacheable) headers.set("cache-tag", fileCacheTag(id));
  headers.set("etag", obj.httpEtag);
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

async function mintFileId(env: Env): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const id = nanoid(FILE_ID_LEN);
    const exists = await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(id).first();
    if (!exists) return id;
  }
  throw new ApiError(500, "id_failed", "Could not mint a file id.");
}

export async function hubLists(
  env: Env,
  email: string,
  query: ListQuery,
): Promise<{
  sites: Awaited<ReturnType<typeof listSitesFor>>["items"];
  files: Awaited<ReturnType<typeof listLooseFor>>["items"];
  sites_total: number;
  files_total: number;
  sites_cursor: string | null;
  files_cursor: string | null;
}> {
  const [sites, files] = await Promise.all([listSitesFor(env, email, query), listLooseFor(env, email, query)]);
  return {
    sites: sites.items,
    files: files.items,
    sites_total: sites.total,
    files_total: files.total,
    sites_cursor: sites.next_cursor,
    files_cursor: files.next_cursor,
  };
}
