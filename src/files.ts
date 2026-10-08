import { fileCacheTag, filePrefix, privateCacheControl, publicCacheControl, purgeContent } from "./cache";
import {
  composeClauses,
  criteriaSql,
  nextFileCursor,
  fileCursorSql,
  takePage,
  type ListPage,
  type ListQuery,
} from "./catalog";
import { CONTENT_GENERATION_HEADER, EXPECTED_VERSION_HEADER, fileKey } from "./config";
import { mintObjectId } from "./ids";
import {
  expiredError,
  expiredHtml,
  claimLooseFileForDelete,
  claimLooseFileForWrite,
  fileRecoveryRequired,
  finalizeLooseFileWriteClaim,
  isExpired,
  isPurgeClaimed,
  isStaleClaim,
  isWriteClaimed,
  looseFileBusy,
  looseFileReservation,
  PURGE_CLAIM_LIKE,
  NO_LOOSE_RECOVERY_SQL,
  purgeExpiredFile,
  restoreLooseFileWriteClaim,
  remainingCacheSeconds,
  schedulePurgeExpiredFile,
  staleClaimCutoff,
  WRITE_CLAIM_LIKE,
  d1Changed,
  type LooseFileWriteClaim,
} from "./expire";
import { consumeGrantStatement, grantBusy, grantCommitFailure, GRANT_LEASE_SQL, grantLeaseBinds, type GrantGuard } from "./grant-guard";
import { ensureHandle, ensureUser } from "./handles";
import { maybeUnlockWithWritePassword, passwordEcho, passwordField, passwordHashFromInput, protectContent, readSetPasswordHeader, readSetWritePasswordHeader, assignPasswordStore, hubLinkAccessFields, storedPasswordSecret, writePasswordField, writePasswordHashFromInput } from "./gate";
import { filePublicUrl, isFileId, urlFilename } from "./urls";
import {
  ApiError,
  applyIsolation,
  assertStorageRoom,
  legacyHandoffStatement,
  legacyQuotaStatement,
  markLegacyReservation,
  type StorageReservation,
  basename,
  contentOrigin,
  contentDisposition,
  copyR2Object,
  json,
  jsonMaybeSecret,
  publicOrigin,
  discardR2Snapshots,
  releaseStorage,
  restoreR2Object,
  secretJson,
  snapshotR2Object,
  tooLarge,
  wantsDownload,
  type R2ObjectSnapshot,
} from "./http";
import { isMarkdownName, respondMarkdown } from "./markdown";
import { contentTypeFor } from "./mime";
import {
  assertCanMutate,
  assertCanSetWritePolicy,
  canSetWritePolicy,
  instancePolicy,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
  ttlFromRequest,
  writePolicyFromRequest,
  type ResolvedTtl,
} from "./policy";
import { noteRead } from "./reads";
import type { Actor, Env, LooseFileRow } from "./types";
import { cleanupLegacyReservation } from "./site-storage";
import { putUpload, readUploadForm, uploadFromFile, withUpload, type Upload } from "./upload";

async function recoverLooseCreation(env: Env, reservation: StorageReservation, wrote: boolean, error: unknown): Promise<void> {
  const row = await env.DB.prepare("SELECT state FROM storage_allocations WHERE id = ?").bind(reservation.id).first<{ state: string }>();
  if (row?.state === "released") return;
  if (!wrote) {
    await markLegacyReservation(env.DB, reservation, "uncertain", { error });
    return;
  }
  await markLegacyReservation(env.DB, reservation, "cleanup_pending", { error, cleanupKey: reservation.recovery!.targetKey });
  await cleanupLegacyReservation(env.DB, env.BUCKET, reservation.id).catch(cleanupError => console.error("Loose-file cleanup pending", reservation.id, cleanupError));
}

export function assertFilename(raw: string, fallback: string): string {
  const filename = basename(raw).slice(0, 180) || fallback;
  if (filename === "." || filename === ".." || filename.includes("/")) {
    throw new ApiError(400, "bad_filename", "Give a simple filename, not a path.");
  }
  return filename;
}

/** Absent means an unconditional write; anything present must be a content_generation. */
export function readExpectedVersion(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^[1-9][0-9]{0,14}$/.test(value)) {
    throw new ApiError(400, "bad_expected_version", "expected_version must be the file's content_generation, a positive integer.");
  }
  return Number(value);
}

export function expectedVersionHeader(request: Request): number | undefined {
  return readExpectedVersion(request.headers.get(EXPECTED_VERSION_HEADER));
}

export function fileConflict(current: number, expected: number): ApiError {
  return new ApiError(
    409,
    "file_conflict",
    `The file is at content_generation ${current}, not ${expected}. Read it again and reconcile before replacing it.`,
    { content_generation: current, expected_version: expected },
  );
}

export function assertGeneration(current: number, expected: number | undefined): void {
  if (expected !== undefined && current !== expected) throw fileConflict(current, expected);
}

/** The WHERE fragment that makes a replacement commit conditional on the expected generation. */
export function generationGuard(expected: number | undefined): { sql: string; binds: number[] } {
  return expected === undefined ? { sql: "", binds: [] } : { sql: " AND content_generation = ?", binds: [expected] };
}

/** A stale expected_version on a file blocked on storage recovery reports the recovery: reconciling and retrying cannot succeed. */
export async function generationConflict(env: Env, id: string, current: number, expected: number): Promise<ApiError> {
  return await looseFileReservation(env.DB, id) === "recovery_required" ? fileRecoveryRequired() : fileConflict(current, expected);
}

/** Explains a guarded replacement commit that matched no row because the file moved past the expected generation. */
export async function throwIfGenerationMoved(env: Env, id: string, expected: number | undefined): Promise<void> {
  if (expected === undefined) return;
  const row = await env.DB.prepare(`SELECT content_generation FROM loose_files WHERE id = ?`).bind(id).first<{ content_generation: number }>();
  if (row && row.content_generation !== expected) throw await generationConflict(env, id, row.content_generation, expected);
}

export async function createLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  filenameRaw: string,
  upload: Upload,
  hintType: string | null,
  password?: string,
  ttl?: unknown,
  writePolicy?: unknown,
  writePassword?: string,
  guard?: GrantGuard,
): Promise<Response> {
  const policy = instancePolicy(env);
  if (upload.size > policy.fileBytes) throw tooLarge(upload.size, "", policy.fileBytes);
  const filename = assertFilename(filenameRaw, "file");
  contentOrigin(env);
  const user = await ensureUser(env, actor.email, actor.idpSub);
  const handle = user.handle;
  const id = await mintFileId(env);
  const contentType = contentTypeFor(filename, upload.head, hintType);
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const writeHash = await writePasswordHashFromInput(writePassword);
  const stored = hash === undefined ? null : hash;
  const storedWritePw = writeHash === undefined ? null : writeHash;
  const resolved = resolveExpiresAt(policy, ttl);
  const storedWrite = resolveCreateWritePolicy(env, writePolicy);
  const key = fileKey(id, filename);
  const url = filePublicUrl(env, handle, id, filename);
  const columns = `id, handle, owner_id, filename, size, content_type, created_at, created_by, updated_at, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret`;
  const values = [id, handle, user.id, filename, upload.size, contentType, ts, actor.email, ts, actor.email, stored, storedPasswordSecret(stored, password), resolved.expiresAt, storedWrite, storedWritePw, storedPasswordSecret(storedWritePw, writePassword)];
  const reserved = await assertStorageRoom(env.DB, upload.size, 0, policy.platformBytes,
    { fileId: id, targetKey: key, operation: "create", ownerId: user.id });
  let wrote = false;
  await markLegacyReservation(env.DB, reserved, "writing");
  try {
    await putUpload(env.BUCKET, key, upload, { httpMetadata: { contentType } });
    wrote = true;
    await markLegacyReservation(env.DB, reserved, "stored");
    if (guard) {
      const now = new Date(ts);
      const [inserted] = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO loose_files (${columns}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GRANT_LEASE_SQL}`,
        ).bind(...values, ...grantLeaseBinds(guard, now)),
        legacyHandoffStatement(env.DB, reserved),
        consumeGrantStatement(env, guard, now, { id, url }, `EXISTS (SELECT 1 FROM storage_allocations WHERE id = ? AND state = 'released')`, [reserved.id]),
        legacyQuotaStatement(env.DB),
      ]);
      if (!d1Changed(inserted)) {
        throw (await grantCommitFailure(env, guard)) ?? grantBusy();
      }
    } else {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO loose_files (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values),
        legacyHandoffStatement(env.DB, reserved),
        legacyQuotaStatement(env.DB),
      ]);
    }
  } catch (err) {
    await recoverLooseCreation(env, reserved, wrote, err);
    throw err;
  }
  const origin = publicOrigin(env);
  const api_url = `${origin}/v1/files/${id}`;
  await purgeContent(ctx, [filePrefix(handle, id)]);
  const body = {
    url,
    api_url,
    id,
    handle,
    filename,
    size: upload.size,
    content_type: contentType,
    password_protected: Boolean(stored),
    password: passwordEcho(password, stored) ?? null,
    write_password_protected: Boolean(storedWritePw),
    write_password: passwordEcho(writePassword, storedWritePw) ?? null,
    ttl: resolved.ttl,
    expires_at: resolved.expiresAt,
    write_policy: storedWrite,
    content_generation: 1,
  };
  return jsonMaybeSecret(body, 201);
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
  writePassword?: string,
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
  const filename = assertFilename(filenameRaw || source.filename, source.filename);
  const user = await ensureUser(env, actor.email, actor.idpSub);
  const handle = user.handle;
  const id = await mintFileId(env);
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const writeHash = await writePasswordHashFromInput(writePassword);
  const stored = hash === undefined ? null : hash;
  const storedWritePw = writeHash === undefined ? null : writeHash;
  const resolved = resolveExpiresAt(policy, ttl);
  const storedWrite = resolveCreateWritePolicy(env, writePolicy);
  const newKey = fileKey(id, filename);
  const reserved = await assertStorageRoom(env.DB, source.size, 0, policy.platformBytes,
    { fileId: id, targetKey: newKey, operation: "duplicate", ownerId: user.id });
  let wrote = false;
  await markLegacyReservation(env.DB, reserved, "writing");
  try {
    await copyR2Object(env.BUCKET, fileKey(source.id, source.filename), newKey);
    wrote = true;
    await markLegacyReservation(env.DB, reserved, "stored");
    await env.DB.batch([env.DB.prepare(
      `INSERT INTO loose_files (id, handle, owner_id, filename, size, content_type, created_at, created_by, updated_at, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, handle, user.id, filename, source.size, source.content_type, ts, actor.email, ts, actor.email, stored, storedPasswordSecret(stored, password), resolved.expiresAt, storedWrite, storedWritePw, storedPasswordSecret(storedWritePw, writePassword)),
      legacyHandoffStatement(env.DB, reserved),
      legacyQuotaStatement(env.DB),
    ]);
  } catch (err) {
    await recoverLooseCreation(env, reserved, wrote, err);
    throw err;
  }
  const origin = publicOrigin(env);
  const url = filePublicUrl(env, handle, id, filename);
  await purgeContent(ctx, [filePrefix(handle, id)]);
  const body = {
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
    write_password_protected: Boolean(storedWritePw),
    write_password: passwordEcho(writePassword, storedWritePw) ?? null,
    ttl: resolved.ttl,
    expires_at: resolved.expiresAt,
    write_policy: storedWrite,
    content_generation: 1,
    duplicated: true,
    duplicated_from: source.id,
  };
  return jsonMaybeSecret(body, 201);
}

function duplicateFromHeader(request: Request): string {
  return (request.headers.get("X-Energon-Duplicate-From") || request.headers.get("x-energon-duplicate-from") || "").trim();
}

function filenameHeader(request: Request): string | null {
  return request.headers.get("X-Filename") || request.headers.get("x-filename");
}

function formOrHeader(form: FormData, formKey: string, header: string | undefined): string | undefined {
  const formPw = form.get(formKey);
  return header ?? (typeof formPw === "string" ? formPw : undefined);
}

function formPassword(request: Request, form: FormData): string | undefined {
  return formOrHeader(form, "password", readSetPasswordHeader(request));
}

function formWritePassword(request: Request, form: FormData): string | undefined {
  return formOrHeader(form, "write_password", readSetWritePasswordHeader(request));
}

async function postLooseJson(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  request: Request,
  origin: string,
): Promise<Response> {
  const filename = filenameHeader(request);
  const fromHeader = duplicateFromHeader(request);
  // X-Filename means the body is file bytes (including application/json).
  // duplicate_from in that JSON is content, not a copy request, unless the header is set.
  if (filename && !fromHeader) {
    return withUpload(request, env, instancePolicy(env).fileBytes, origin, (upload) => createLooseFile(
      env,
      ctx,
      actor,
      filename,
      upload,
      "application/json",
      readSetPasswordHeader(request),
      ttlFromRequest(request),
      writePolicyFromRequest(request),
      readSetWritePasswordHeader(request),
    ));
  }
  const text = await request.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = null;
  }
  const fromBody = body && typeof body.duplicate_from === "string" ? body.duplicate_from.trim() : "";
  const from = fromHeader || fromBody || "";
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
      body ? writePasswordField(body) : readSetWritePasswordHeader(request),
    );
  }
  throw new ApiError(
    400,
    "missing_file",
    'Send duplicate_from to copy an existing file, or upload bytes (multipart field "file" / raw body plus X-Filename).',
  );
}

async function postLooseMultipart(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  request: Request,
  origin: string,
): Promise<Response> {
  const form = await readUploadForm(request, instancePolicy(env).fileBytes, origin);
  const formDup = form.get("duplicate_from");
  const from = (typeof formDup === "string" && formDup.trim()) || duplicateFromHeader(request) || "";
  if (from) {
    if (form.get("file") instanceof File) {
      throw new ApiError(
        400,
        "bad_duplicate",
        "Send duplicate_from or a file, not both. duplicate_from copies existing bytes.",
      );
    }
    const formName = form.get("filename");
    return duplicateLooseFile(
      env,
      ctx,
      actor,
      from,
      typeof formName === "string" ? formName : null,
      formPassword(request, form),
      ttlFromRequest(request, form),
      writePolicyFromRequest(request, form),
      formWritePassword(request, form),
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
  return createLooseFile(
    env,
    ctx,
    actor,
    file.name,
    await uploadFromFile(file),
    file.type || null,
    formPassword(request, form),
    ttlFromRequest(request, form),
    writePolicyFromRequest(request, form),
    formWritePassword(request, form),
  );
}

export async function postLooseFromRequest(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  request: Request,
): Promise<Response> {
  const origin = publicOrigin(env);
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    return postLooseJson(env, ctx, actor, request, origin);
  }
  if (ctype.includes("multipart/form-data")) {
    return postLooseMultipart(env, ctx, actor, request, origin);
  }
  const from = duplicateFromHeader(request);
  if (from) {
    return duplicateLooseFile(
      env,
      ctx,
      actor,
      from,
      filenameHeader(request),
      readSetPasswordHeader(request),
      ttlFromRequest(request),
      writePolicyFromRequest(request),
      readSetWritePasswordHeader(request),
    );
  }
  const filename = filenameHeader(request);
  if (!filename) {
    throw new ApiError(
      400,
      "missing_filename",
      "Raw uploads need header X-Filename (for example notes.md), or send multipart field file.",
    );
  }
  return withUpload(request, env, instancePolicy(env).fileBytes, origin, (upload) => createLooseFile(
    env,
    ctx,
    actor,
    filename,
    upload,
    request.headers.get("content-type"),
    readSetPasswordHeader(request),
    ttlFromRequest(request),
    writePolicyFromRequest(request),
    readSetWritePasswordHeader(request),
  ));
}

async function acquireLooseFileReplacementClaim(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
  existing: Pick<LooseFileRow, "handle" | "filename" | "expires_at" | "created_by" | "last_written_by" | "updated_at">,
) {
  const claim = await claimLooseFileForWrite(env, id, existing, actor);
  if (claim) return claim;
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
  throw await looseFileBusy(env, id, "Another write is in progress; retry this replacement.");
}

async function commitLooseFileReplacement(
  env: Env,
  id: string,
  claimToken: string,
  replacement: {
    handle: string;
    filename: string;
    size: number;
    contentType: string;
    ts: string;
    hash: string | null | undefined;
    password: string | undefined;
    expectedVersion: number | undefined;
  },
  guard: GrantGuard | undefined,
  reserved: Awaited<ReturnType<typeof assertStorageRoom>>,
  previousObject: { key: string; bytes: number } | undefined,
): Promise<number> {
  const { handle, filename, size, contentType, ts, hash, password, expectedVersion } = replacement;
  const assignments = [
    "handle = COALESCE(handle, ?)",
    "filename = ?",
    "size = ?",
    "content_type = ?",
    "updated_at = ?",
    "last_written_by = ?",
    "content_generation = content_generation + 1",
  ];
  const values: unknown[] = [handle, filename, size, contentType, ts, claimToken];
  assignPasswordStore(assignments, values, hash, password, "password_hash", "password_secret");
  const conditional = generationGuard(expectedVersion);
  const where = [id, claimToken, ...conditional.binds];
  const update = `UPDATE loose_files SET ${assignments.join(", ")} WHERE id = ? AND last_written_by = ?${conditional.sql}`;
  let updated: D1Result<{ content_generation: number }>;
  if (guard) {
    const now = new Date(ts);
    const live = `(expires_at IS NULL OR expires_at > ?)`;
    [updated] = await env.DB.batch<{ content_generation: number }>([
      env.DB.prepare(`${update} AND ${live} AND ${GRANT_LEASE_SQL} RETURNING content_generation`).bind(...values, ...where, ts, ...grantLeaseBinds(guard, now)),
      legacyHandoffStatement(env.DB, reserved, previousObject),
      consumeGrantStatement(
        env,
        guard,
        now,
        { id, url: filePublicUrl(env, handle, id, filename) },
        `EXISTS (SELECT 1 FROM storage_allocations WHERE id = ? AND state IN ('released', 'cleanup_pending'))`,
        [reserved.id],
      ),
      legacyQuotaStatement(env.DB),
    ]);
  } else {
    [updated] = await env.DB.batch<{ content_generation: number }>([
      env.DB.prepare(`${update} RETURNING content_generation`).bind(...values, ...where),
      legacyHandoffStatement(env.DB, reserved, previousObject),
      legacyQuotaStatement(env.DB),
    ]);
  }
  if (!d1Changed(updated)) {
    const grantProblem = guard ? await grantCommitFailure(env, guard) : null;
    if (grantProblem) throw grantProblem;
    await throwIfGenerationMoved(env, id, expectedVersion);
    throw new ApiError(409, "file_write_lost", "The file changed during replacement; retry.");
  }
  return updated.results[0]!.content_generation;
}

type ReplaceableLooseFile = Pick<
  LooseFileRow,
  "id" | "handle" | "filename" | "size" | "content_type" | "expires_at" | "created_by" | "last_written_by" | "updated_at" | "write_policy" | "owner_id" | "password_hash" | "content_generation"
>;

async function loadReplaceableLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
): Promise<ReplaceableLooseFile> {
  const existing = await env.DB.prepare(
    `SELECT id, handle, filename, size, content_type, expires_at, created_by, last_written_by, updated_at, write_policy, owner_id, password_hash, content_generation FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<ReplaceableLooseFile>();
  if (!existing) {
    throw new ApiError(
      404,
      "file_not_found",
      `No loose file '${id}'. Create it first with POST /v1/files, then PUT /v1/files/{id} to replace it.`,
    );
  }
  if (isWriteClaimed(existing.last_written_by) && !isStaleClaim(existing.updated_at)) {
    throw await looseFileBusy(env, id, "Another write is in progress; retry this replacement.");
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
  return existing;
}

type LooseFileReplacementState = {
  id: string;
  claim: LooseFileWriteClaim;
  guard: GrantGuard | undefined;
  newKey: string;
  renamed: boolean;
  reserved: StorageReservation | number;
  previousState: R2ObjectSnapshot | null;
  metadataCommitted: boolean;
  wroteObject: boolean;
  writeStarted: boolean;
};

/** Returns whether the pre-write snapshot must be retained. */
async function rollBackLooseFileReplacement(env: Env, err: unknown, state: LooseFileReplacementState): Promise<boolean> {
  const { id, claim, guard, newKey, renamed, reserved, previousState, wroteObject, writeStarted } = state;
  let metadataCommitted = state.metadataCommitted;
  if (typeof reserved !== "number") {
    const persisted = await env.DB.prepare("SELECT state FROM storage_allocations WHERE id = ?").bind(reserved.id).first<{ state: string }>();
    metadataCommitted ||= persisted?.state === "released" || persisted?.state === "cleanup_pending";
  }
  if (metadataCommitted) return false;
  let restoreFailed = false;
  if (wroteObject) {
    await restoreR2Object(env.BUCKET, newKey, renamed ? null : previousState).catch(() => {
      restoreFailed = true;
    });
  }
  await restoreLooseFileWriteClaim(env, id, claim).catch(() => {
    restoreFailed = true;
  });
  const uncertainWrite = writeStarted && !wroteObject;
  if (!restoreFailed && !uncertainWrite) {
    await releaseStorage(env.DB, reserved);
    return false;
  }
  if (typeof reserved !== "number") await markLegacyReservation(env.DB, reserved, "uncertain", { error: err, snapshotKey: previousState?.stagedKey });
  // A grant must not be released for a retry while storage and the catalog may disagree.
  if (guard) {
    throw new ApiError(500, "storage_rollback_failed", "The upload failed and storage could not be restored. Ask for a new grant.");
  }
  return true;
}

export async function putLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
  upload: Upload,
  filenameRaw: string | null,
  hintType: string | null,
  password?: string,
  guard?: GrantGuard,
  expectedVersion?: number,
): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const policy = instancePolicy(env);
  if (upload.size > policy.fileBytes) throw tooLarge(upload.size, "", policy.fileBytes);
  const existing = await loadReplaceableLooseFile(env, ctx, actor, id);
  let filename = existing.filename;
  if (filenameRaw) {
    filename = assertFilename(filenameRaw, existing.filename);
  }
  contentOrigin(env);
  // A grant upload never chooses the type: the uploading machine is less trusted than the file's publisher.
  const contentType = guard && existing.content_type ? existing.content_type : contentTypeFor(filename, upload.head, hintType);
  const ts = new Date().toISOString();
  const hash = await passwordHashFromInput(password);
  const handle = existing.handle || (await ensureHandle(env, actor.email, actor.idpSub));
  const oldKey = fileKey(id, existing.filename);
  const newKey = fileKey(id, filename);
  const renamed = newKey !== oldKey;
  const claim = await acquireLooseFileReplacementClaim(env, ctx, actor, id, existing);
  let reserved: StorageReservation | number = 0;
  let previousState: R2ObjectSnapshot | null = null;
  let metadataCommitted = false;
  let wroteObject = false;
  let writeStarted = false;
  let retainSnapshot = false;
  let contentGeneration = 0;
  try {
    // After the claim, so file_busy and file_recovery_required outrank a stale generation; before any bytes move.
    // The commit repeats the check atomically.
    assertGeneration(existing.content_generation, expectedVersion);
    reserved = await assertStorageRoom(env.DB, upload.size, existing.size, policy.platformBytes,
      { fileId: id, targetKey: newKey, operation: "replace", ownerId: existing.owner_id || actor.email, claimToken: claim.token });
    previousState = renamed ? null : await snapshotR2Object(env, oldKey);
    await markLegacyReservation(env.DB, reserved, "writing", { snapshotKey: previousState?.stagedKey });
    writeStarted = true;
    await putUpload(env.BUCKET, newKey, upload, { httpMetadata: { contentType } });
    wroteObject = true;
    await markLegacyReservation(env.DB, reserved, "stored", { snapshotKey: previousState?.stagedKey });
    contentGeneration = await commitLooseFileReplacement(env, id, claim.token,
      { handle, filename, size: upload.size, contentType, ts, hash, password, expectedVersion }, guard, reserved,
      renamed ? { key: oldKey, bytes: existing.size } : undefined);
    metadataCommitted = true;
    if (renamed) {
      const reservationId = reserved.id;
      await cleanupLegacyReservation(env.DB, env.BUCKET, reservationId, new Date(), claim.token)
        .catch(error => {
          console.error("Loose-file rename cleanup pending", reservationId, error);
        });
    }
  } catch (err) {
    // Stays true if rollback itself throws: the snapshot may be the only copy of the old bytes.
    retainSnapshot = true;
    retainSnapshot = await rollBackLooseFileReplacement(env, err, {
      id, claim, guard, newKey, renamed, reserved, previousState, metadataCommitted, wroteObject, writeStarted,
    });
    throw err;
  } finally {
    if (!retainSnapshot) await discardR2Snapshots(env.BUCKET, [previousState]);
  }
  await finalizeLooseFileWriteClaim(env, id, claim.token, actor.email).catch((err) => {
    console.error("loose file write claim release failed", err);
  });
  const origin = publicOrigin(env);
  const url = filePublicUrl(env, handle, id, filename);
  await purgeContent(ctx, [filePrefix(handle, id)]);
  return json({
    url,
    api_url: `${origin}/v1/files/${id}`,
    id,
    handle,
    filename,
    size: upload.size,
    content_type: contentType,
    replaced: true,
    content_generation: contentGeneration,
    password_protected: hash === undefined ? Boolean(existing.password_hash) : Boolean(hash),
    password: passwordEcho(password, hash) ?? null,
  });
}

type LooseFilePatch = { password?: string; write_password?: string; ttl?: unknown; setTtl?: boolean; write_policy?: unknown };

async function prepareLooseFilePatch(
  actor: Actor,
  existing: Pick<LooseFileRow, "created_by" | "owner_id" | "write_policy">,
  patch: LooseFilePatch,
  asAdmin: boolean,
) {
  const wantsWrite = Object.prototype.hasOwnProperty.call(patch, "write_policy");
  const wantsWritePassword = Object.prototype.hasOwnProperty.call(patch, "write_password");
  const wantsSharePassword = patch.password !== undefined;
  const wantsOther = wantsSharePassword || Boolean(patch.setTtl);
  if (wantsOther && !asAdmin) assertCanMutate(actor, existing);
  let nextWrite = resolveWritePolicy(existing.write_policy);
  if (wantsWrite) {
    assertCanSetWritePolicy(actor, existing.created_by, existing.owner_id);
    const parsed = requestedWritePolicy(patch.write_policy);
    if (parsed === "invalid" || parsed === null) {
      throw new ApiError(400, "bad_write_policy", "write_policy must be owner or org.");
    }
    nextWrite = parsed;
  }
  const writeHash = await writePasswordHashFromInput(patch.write_password);
  if (wantsWritePassword || wantsSharePassword) {
    assertCanSetWritePolicy(actor, existing.created_by, existing.owner_id);
  }
  const hash = await passwordHashFromInput(patch.password);
  return { wantsWrite, nextWrite, writeHash, hash };
}

function looseFilePatchAssignments(
  actor: Actor,
  patch: LooseFilePatch,
  prepared: Awaited<ReturnType<typeof prepareLooseFilePatch>>,
  resolved: ResolvedTtl | null,
  ts: string,
  asAdmin: boolean,
) {
  const { wantsWrite, nextWrite, writeHash, hash } = prepared;
  const ttlOnlyAdmin = asAdmin && Boolean(patch.setTtl) && hash === undefined && writeHash === undefined && !wantsWrite;
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (hash !== undefined || writeHash !== undefined || resolved || wantsWrite) {
    if (!ttlOnlyAdmin) {
      assignments.push("updated_at = ?", "last_written_by = ?", "written_via = NULL");
      values.push(ts, actor.email);
    }
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
  return { assignments, values };
}

export async function patchLoose(
  env: Env,
  actor: Actor,
  id: string,
  patch: LooseFilePatch,
  ctx?: ExecutionContext,
  asAdmin = false,
): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const existing = await env.DB.prepare(
    `SELECT id, handle, filename, password_hash, write_password_hash, expires_at, created_by, last_written_by, updated_at, write_policy, owner_id, content_generation FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      password_hash: string | null;
      write_password_hash: string | null;
      expires_at: string | null;
      created_by: string;
      last_written_by: string | null;
      updated_at: string | null;
      write_policy: string | null;
      owner_id: string | null;
      content_generation: number;
    }>();
  if (!existing) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (isWriteClaimed(existing.last_written_by) && !isStaleClaim(existing.updated_at)) {
    throw await looseFileBusy(env, id, "Another write is in progress; retry this update.");
  }
  if (isPurgeClaimed(existing.last_written_by) || (isExpired(existing.expires_at) && !patch.setTtl)) {
    try {
      await purgeExpiredFile(env, ctx, existing.id, existing.handle, existing.filename);
    } catch (err) {
      console.error("purgeExpiredFile failed", err);
    }
    throw expiredError("file");
  }
  const prepared = await prepareLooseFilePatch(actor, existing, patch, asAdmin);
  const { nextWrite, writeHash, hash } = prepared;
  const ts = new Date().toISOString();
  const handle = existing.handle || (await ensureHandle(env, actor.email, actor.idpSub));
  const resolved = patch.setTtl ? resolveExpiresAt(instancePolicy(env), patch.ttl) : null;
  const notClaimed = `ifnull(last_written_by, '') NOT LIKE ? AND (ifnull(last_written_by, '') NOT LIKE ? OR updated_at IS NULL OR updated_at <= ?)`;
  const claimGuards = [PURGE_CLAIM_LIKE, WRITE_CLAIM_LIKE, staleClaimCutoff()] as const;
  const { assignments, values } = looseFilePatchAssignments(actor, patch, prepared, resolved, ts, asAdmin);
  if (assignments.length) {
    const updated = await env.DB.prepare(
      `UPDATE loose_files SET ${assignments.join(", ")} WHERE id = ? AND ${notClaimed} AND ${NO_LOOSE_RECOVERY_SQL}`,
    )
      .bind(...values, id, ...claimGuards)
      .run();
    if (!d1Changed(updated)) await throwLooseFileMutationConflict(env, id);
  }
  if (hash !== undefined || writeHash !== undefined || resolved) {
    await purgeContent(ctx, [filePrefix(handle, id)]);
  }
  const origin = publicOrigin(env);
  const protectedNow = hash === undefined ? Boolean(existing.password_hash) : Boolean(hash);
  const writeProtectedNow = writeHash === undefined ? Boolean(existing.write_password_hash) : Boolean(writeHash);
  const body = {
    id,
    handle,
    filename: existing.filename,
    url: filePublicUrl(env, handle, id, existing.filename),
    api_url: `${origin}/v1/files/${id}`,
    password_protected: protectedNow,
    password: passwordEcho(patch.password, hash) ?? null,
    write_password_protected: writeProtectedNow,
    write_password: passwordEcho(patch.write_password, writeHash) ?? null,
    expires_at: resolved ? resolved.expiresAt : existing.expires_at ?? null,
    ttl: resolved ? resolved.ttl : undefined,
    write_policy: nextWrite,
    content_generation: existing.content_generation,
  };
  return jsonMaybeSecret(body);
}

export function involvedInLoose(
  actor: Actor,
  row: { created_by: string; last_written_by: string | null; owner_id?: string | null },
): boolean {
  const email = actor.email.toLowerCase();
  if (row.created_by.toLowerCase() === email) return true;
  if (row.last_written_by && row.last_written_by.toLowerCase() === email) return true;
  return Boolean(actor.userId && row.owner_id === actor.userId);
}

export async function hubLooseLinkAccess(env: Env, actor: Actor, id: string): Promise<Response> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, created_by, last_written_by, owner_id, password_hash, password_secret, write_password_hash, write_password_secret, expires_at FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      created_by: string;
      last_written_by: string | null;
      owner_id: string | null;
      password_hash: string | null;
      password_secret: string | null;
      write_password_hash: string | null;
      write_password_secret: string | null;
      expires_at: string | null;
    }>();
  if (!row || !involvedInLoose(actor, row)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (isExpired(row.expires_at)) throw expiredError("file");
  const handle = row.handle || (await ensureHandle(env, actor.email, actor.idpSub));
  return secretJson({
    id: row.id,
    handle,
    filename: row.filename,
    url: filePublicUrl(env, handle, row.id, row.filename),
    ...hubLinkAccessFields(canSetWritePolicy(actor, row.created_by, row.owner_id), row),
  });
}

async function throwLooseFileMutationConflict(env: Env, id: string): Promise<never> {
  const current = await env.DB.prepare(`SELECT last_written_by FROM loose_files WHERE id = ?`)
    .bind(id)
    .first<{ last_written_by: string | null }>();
  const reservation = current && await looseFileReservation(env.DB, id);
  if (reservation === "recovery_required") throw fileRecoveryRequired();
  if (reservation || isWriteClaimed(current?.last_written_by)) {
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
    const policy = instancePolicy(env);
    const form = await readUploadForm(request, policy.fileBytes, origin);
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(
        400,
        "missing_file",
        'Send multipart form field "file", or a raw body with optional X-Filename.',
      );
    }
    if (file.size > policy.fileBytes) throw tooLarge(file.size, origin, policy.fileBytes);
    const expectedVersion = readExpectedVersion(formOrHeader(form, "expected_version", request.headers.get(EXPECTED_VERSION_HEADER) ?? undefined));
    return putLooseFile(env, ctx, actor, id, await uploadFromFile(file), file.name || null, file.type || null, formPassword(request, form), undefined, expectedVersion);
  }
  const filename = filenameHeader(request);
  const expectedVersion = expectedVersionHeader(request);
  return withUpload(request, env, instancePolicy(env).fileBytes, origin, (upload) => putLooseFile(
    env,
    ctx,
    actor,
    id,
    upload,
    filename,
    request.headers.get("content-type"),
    readSetPasswordHeader(request),
    undefined,
    expectedVersion,
  ));
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
    `SELECT id, handle, filename, content_type, expires_at, write_policy, last_read_at, content_generation FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      content_type: string;
      expires_at: string | null;
      write_policy: string | null;
      last_read_at: string | null;
      content_generation: number;
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
  noteRead(env, ctx, { table: "loose_files", id: row.id, last_read_at: row.last_read_at });
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || row.content_type || "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", contentDisposition(opts?.attachment ? "attachment" : "inline", row.filename));
  headers.set("x-energon-write-policy", resolveWritePolicy(row.write_policy));
  headers.set(CONTENT_GENERATION_HEADER, String(row.content_generation));
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function deleteLooseFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  id: string,
  asAdmin = false,
): Promise<void> {
  if (!isFileId(id)) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  const row = await env.DB.prepare(
    `SELECT id, handle, filename, size, expires_at, created_by, last_written_by, updated_at, write_policy, owner_id FROM loose_files WHERE id = ?`,
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
      owner_id: string | null;
    }>();
  if (!row) {
    throw new ApiError(404, "file_not_found", "No loose file with that id.");
  }
  if (!asAdmin) assertCanMutate(actor, row);
  if (isWriteClaimed(row.last_written_by) && !isStaleClaim(row.updated_at)) {
    throw await looseFileBusy(env, id, "Another write is in progress; retry this deletion.");
  }
  if (isPurgeClaimed(row.last_written_by)) throw expiredError("file");
  const claim = await claimLooseFileForDelete(
    env,
    id,
    row,
    actor,
    asAdmin,
  );
  if (!claim) {
    const current = await env.DB.prepare(`SELECT last_written_by FROM loose_files WHERE id = ?`)
      .bind(id)
      .first<{ last_written_by: string | null }>();
    if (!current) throw expiredError("file");
    if (isPurgeClaimed(current.last_written_by)) throw expiredError("file");
    throw await looseFileBusy(env, id, "The file changed during deletion; retry.");
  }
  const key = fileKey(row.id, row.filename);
  let previousState: R2ObjectSnapshot | null = null;
  let storageDeleted = false;
  try {
    previousState = await snapshotR2Object(env, key);
    await env.BUCKET.delete(key);
    storageDeleted = true;
    const dropped = await env.DB.prepare(`DELETE FROM loose_files WHERE id = ? AND last_written_by = ?`)
      .bind(id, claim.token)
      .run();
    if (!d1Changed(dropped)) {
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
    await restoreLooseFileWriteClaim(env, id, claim).catch(() => undefined);
    throw failure;
  } finally {
    await discardR2Snapshots(env.BUCKET, [previousState]);
  }
  try {
    if (row.handle) await purgeContent(ctx, [filePrefix(row.handle, id)]);
  } finally {
    await releaseStorage(env.DB, row.size);
  }
}

export async function listLooseJson(env: Env, email: string, query: ListQuery, ownerId?: string): Promise<Response> {
  const page = await listLooseFor(env, email, query, ownerId);
  return json({ files: page.items, total: page.total, next_cursor: page.next_cursor });
}

export async function listLooseFor(
  env: Env,
  email: string,
  query: ListQuery,
  ownerId?: string,
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
    content_generation: number;
    password_protected: boolean;
    write_password_protected: boolean;
    written_via: string | null;
    expires_at: string | null;
    last_read_at: string | null;
    write_policy: string;
  }>
> {
  const origin = publicOrigin(env);
  const criteria = criteriaSql("files", query, email, ownerId);
  const cursor = fileCursorSql(query);
  const clauses = composeClauses(criteria, cursor);
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM loose_files WHERE ${criteria.where}`,
  )
    .bind(...criteria.whereBinds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT id, handle, filename, size, content_type, created_at, created_by, updated_at, last_written_by, content_generation, password_hash, write_password_hash, written_via, expires_at, last_read_at, write_policy
     FROM loose_files
     WHERE ${clauses.where}
     ORDER BY ${cursor.order}
     LIMIT ?`,
  )
    .bind(...clauses.binds, query.limit + 1)
    .all<LooseFileRow>();
  const page = takePage(rows.results || [], query.limit);
  const items = page.items.map((f) => {
    const { password_hash, write_password_hash, write_policy, ...rest } = f;
    return {
      ...rest,
      url: f.handle ? filePublicUrl(env, f.handle, f.id, f.filename) : `${origin}/v1/files/${f.id}`,
      api_url: `${origin}/v1/files/${f.id}`,
      password_protected: Boolean(password_hash),
      write_password_protected: Boolean(write_password_hash),
      written_via: f.written_via ?? null,
      expires_at: f.expires_at ?? null,
      last_read_at: f.last_read_at ?? null,
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
    `SELECT id, handle, filename, password_hash, write_password_hash, expires_at, last_read_at, content_generation FROM loose_files WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      handle: string | null;
      filename: string;
      password_hash: string | null;
      write_password_hash: string | null;
      expires_at: string | null;
      last_read_at: string | null;
      content_generation: number;
    }>();
  if (!row || (row.handle && row.handle !== handle)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (isExpired(row.expires_at)) {
    schedulePurgeExpiredFile(env, ctx, row.id, row.handle, row.filename);
    return expiredHtml("file");
  }

  const cookiePath = `/${handle}/f/${id}/`;
  const unlocked = await maybeUnlockWithWritePassword(request, env, row.write_password_hash, cookiePath);
  if (unlocked instanceof Response) return unlocked;
  const gated = unlocked === "unlocked"
    ? null
    : await protectContent(request, row.password_hash, cookiePath, row.filename, env, row.write_password_hash);
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
  noteRead(env, ctx, { table: "loose_files", id: row.id, last_read_at: row.last_read_at });
  if (isMarkdownName(row.filename)) {
    const rendered = await respondMarkdown(request, obj, row.filename);
    rendered.headers.set(CONTENT_GENERATION_HEADER, String(row.content_generation));
    return rendered;
  }
  const remaining = remainingCacheSeconds(row.expires_at);
  const cacheable = !row.password_hash && unlocked !== "unlocked";
  const headers = new Headers();
  const contentType = obj.httpMetadata?.contentType || "application/octet-stream";
  headers.set("content-type", contentType);
  headers.set("x-content-type-options", "nosniff");
  applyIsolation(headers, contentType);
  headers.set(
    "content-disposition",
    contentDisposition(wantsDownload(request) ? "attachment" : "inline", row.filename),
  );
  headers.set("cache-control", cacheable ? publicCacheControl(remaining) : privateCacheControl());
  if (cacheable) headers.set("cache-tag", fileCacheTag(id));
  headers.set("etag", obj.httpEtag);
  headers.set(CONTENT_GENERATION_HEADER, String(row.content_generation));
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

async function mintFileId(env: Env): Promise<string> {
  return mintObjectId(env, "loose_files");
}
