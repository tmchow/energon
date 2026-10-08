import { mintDeploymentGrant } from "./deployment-grants";
import { grantActor, parseBearer } from "./auth";
import { d1Changed, expiredError, isExpired, isPurgeClaimed } from "./expire";
import { assertFilename, createLooseFile, generationConflict, putLooseFile } from "./files";
import { hashesEqual, passwordHashFromInput, storedPasswordSecret, writePasswordHashFromInput } from "./gate";
import { GRANT_UPLOAD_PREFIX } from "./grant-protocol";
import { grantBusy, type GrantGuard } from "./grant-guard";
import { EXPECTED_VERSION_HEADER } from "./config";
import { FORBIDDEN_PUT_HEADERS } from "./guest-write";
import { ApiError, contentOrigin, json, nanoid, publicOrigin, secretJson, sha256Hex } from "./http";
import {
  assertCanMutate,
  grantClaimable,
  grantClaimCutoff,
  instancePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveGrantExpiresAt,
  tokenExpired,
} from "./policy";
import { assertFilePath, getSiteById, putSiteFile } from "./sites";
import type { Actor, Env } from "./types";
import { filePublicUrl, isFileId, isSiteId, sitePublicUrl } from "./urls";
import { withUpload, type Upload } from "./upload";

export const GRANT_UPLOAD_PATH = /^\/_grants\/([^/]+)$/;
export const GRANT_SECRET_PREFIX = "grant_";
const GRANT_ID_RE = /^[A-Za-z0-9]{24}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const PURGE_BATCH = 90;
const PURGE_MAX_BATCHES = 20;
const RETENTION_MS = 24 * 60 * 60 * 1000;

type TargetKind = "new_file" | "file" | "site_path" | "site_deployment";

type GrantRow = {
  id: string;
  secret_hash: string;
  token_id: string;
  user_email: string;
  user_id: string | null;
  target_kind: TargetKind;
  file_id: string | null;
  site_id: string | null;
  deployment_id: string | null;
  path: string | null;
  filename: string | null;
  file_ttl: string | null;
  file_write_policy: string | null;
  file_password: string | null;
  file_write_password: string | null;
  expected_version: number | null;
  max_bytes: number;
  sha256: string | null;
  state: "unused" | "uploading" | "consumed" | "failed";
  lease_id: string | null;
  last_error: string | null;
  result_id: string | null;
  result_url: string | null;
  created_at: string;
  consumed_at: string | null;
  expires_at: string;
};

type Target =
  | { kind: "new_file"; filename: string; ttl: string | null; writePolicy: string | null; password: string | null; writePassword: string | null }
  | { kind: "file"; fileId: string; url: string; expectedVersion: number | null }
  | { kind: "site_path"; siteId: string; path: string; url: string };

async function hashGrantSecret(secret: string): Promise<string> {
  return sha256Hex(`energon-grant:${secret}`);
}

function grantUploadUrl(env: Env, id: string): string {
  return `${contentOrigin(env)}${GRANT_UPLOAD_PREFIX}${id}`;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, "bad_request", `${field} must be a string.`);
  return value;
}

async function resolveTarget(env: Env, actor: Actor, raw: unknown): Promise<Target> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "bad_target", 'target must be an object with type "new_file", "file", or "site_path".');
  }
  const target = raw as Record<string, unknown>;
  if (target.expected_version !== undefined && target.type !== "file") {
    throw new ApiError(400, "bad_target", "target.expected_version applies only to a file target. Use a site_deployment for a conditional site replacement.");
  }
  if (target.type === "new_file") return resolveNewFileTarget(env, target);
  if (target.type === "file") return resolveFileTarget(env, actor, target);
  if (target.type === "site_path") return resolveSiteTarget(env, actor, target);
  throw new ApiError(400, "bad_target", 'target.type must be "new_file", "file", or "site_path".');
}

/** Stored as the trimmed phrase, like a file's password_secret, so the redeem can set it exactly as POST /v1/files would. */
async function readGrantPassword(raw: unknown, field: string, hash: (raw: string) => Promise<string | null | undefined>): Promise<string | null> {
  const value = optionalString(raw, field);
  if (value === null) return null;
  return storedPasswordSecret(await hash(value), value);
}

async function resolveNewFileTarget(env: Env, target: Record<string, unknown>): Promise<Target> {
  const filename = assertFilename(optionalString(target.filename, "target.filename") ?? "", "");
  if (!filename) throw new ApiError(400, "bad_filename", "target.filename is required for a new file.");
  const ttl = optionalString(target.ttl, "target.ttl");
  const writePolicy = optionalString(target.write_policy, "target.write_policy");
  resolveExpiresAt(instancePolicy(env), ttl ?? undefined);
  resolveCreateWritePolicy(env, writePolicy ?? undefined);
  const password = await readGrantPassword(target.password, "target.password", passwordHashFromInput);
  const writePassword = await readGrantPassword(target.write_password, "target.write_password", writePasswordHashFromInput);
  return { kind: "new_file", filename, ttl, writePolicy, password, writePassword };
}

function readGrantExpectedVersion(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1) {
    throw new ApiError(400, "bad_expected_version", "target.expected_version must be the file's content_generation, a positive integer.");
  }
  return raw;
}

async function resolveFileTarget(env: Env, actor: Actor, target: Record<string, unknown>): Promise<Target> {
  const fileId = optionalString(target.id, "target.id") ?? "";
  const expectedVersion = readGrantExpectedVersion(target.expected_version);
  const row = isFileId(fileId)
    ? await env.DB.prepare(
        `SELECT id, handle, filename, expires_at, created_by, last_written_by, write_policy, owner_id, content_generation FROM loose_files WHERE id = ?`,
      )
        .bind(fileId)
        .first<{ id: string; handle: string; filename: string; expires_at: string | null; created_by: string; last_written_by: string | null; write_policy: string | null; owner_id: string | null; content_generation: number }>()
    : null;
  if (!row) throw new ApiError(404, "file_not_found", "No loose file with that id.");
  if (isPurgeClaimed(row.last_written_by) || isExpired(row.expires_at)) throw expiredError("file");
  assertCanMutate(actor, row);
  if (expectedVersion !== null && expectedVersion !== row.content_generation) throw await generationConflict(env, row.id, row.content_generation, expectedVersion);
  return { kind: "file", fileId: row.id, url: filePublicUrl(env, row.handle, row.id, row.filename), expectedVersion };
}

async function resolveSiteTarget(env: Env, actor: Actor, target: Record<string, unknown>): Promise<Target> {
  const siteId = optionalString(target.site_id, "target.site_id") ?? "";
  const path = assertFilePath(optionalString(target.path, "target.path") ?? "");
  const site = isSiteId(siteId) ? await getSiteById(env, siteId) : null;
  if (!site) throw new ApiError(404, "site_not_found", "No such site.");
  if (isPurgeClaimed(site.last_written_by) || isExpired(site.expires_at)) throw expiredError("site");
  assertCanMutate(actor, site);
  return { kind: "site_path", siteId: site.id, path, url: sitePublicUrl(env, site.handle, site.id, site.slug, path) };
}

function readMaxBytes(env: Env, raw: unknown): number {
  const cap = instancePolicy(env).fileBytes;
  if (raw === undefined || raw === null) return cap;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new ApiError(400, "bad_request", "max_bytes must be a non-negative integer.");
  }
  return Math.min(raw, cap);
}

function readSha256(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !SHA256_RE.test(raw)) {
    throw new ApiError(400, "bad_request", "sha256 must be 64 hex characters.");
  }
  return raw.toLowerCase();
}

/** Unset new-file options are omitted, matching the request shape the OpenAPI target schema describes. */
function newFileTargetJson(filename: string | null, ttl: string | null, writePolicy: string | null) {
  return { type: "new_file", filename, ...(ttl ? { ttl } : {}), ...(writePolicy ? { write_policy: writePolicy } : {}) };
}

function fileTargetJson(id: string | null, expectedVersion: number | null) {
  return { type: "file", id, ...(expectedVersion === null ? {} : { expected_version: expectedVersion }) };
}

function targetJson(row: GrantRow) {
  if (row.target_kind === "site_deployment") return { type: "site_deployment", site_id: row.site_id, deployment_id: row.deployment_id };
  if (row.target_kind === "new_file") return newFileTargetJson(row.filename, row.file_ttl, row.file_write_policy);
  if (row.target_kind === "file") return fileTargetJson(row.file_id, row.expected_version);
  return { type: "site_path", site_id: row.site_id, path: row.path };
}

export async function mintGrant(env: Env, actor: Actor, body: Record<string, unknown>): Promise<Response> {
  if (!actor.tokenId) throw new ApiError(401, "unauthorized", "Upload grants are minted with an API token.");
  if (body.target && typeof body.target === "object" && (body.target as Record<string, unknown>).type === "site_deployment") return mintDeploymentGrant(env, actor, body);
  const target = await resolveTarget(env, actor, body.target);
  const maxBytes = readMaxBytes(env, body.max_bytes);
  const sha256 = readSha256(body.sha256);
  const now = new Date();
  const expiresAt = resolveGrantExpiresAt(body.expires_in, actor.tokenExpiresAt, now);
  const id = nanoid(24);
  const secret = `${GRANT_SECRET_PREFIX}${nanoid(43)}`;
  await env.DB.prepare(
    `INSERT INTO upload_grants (id, secret_hash, token_id, user_email, user_id, target_kind, file_id, site_id, path, filename, file_ttl, file_write_policy, file_password, file_write_password, expected_version, max_bytes, sha256, state, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unused', ?, ?)`,
  )
    .bind(
      id,
      await hashGrantSecret(secret),
      actor.tokenId,
      actor.email,
      actor.userId ?? null,
      target.kind,
      target.kind === "file" ? target.fileId : null,
      target.kind === "site_path" ? target.siteId : null,
      target.kind === "site_path" ? target.path : null,
      target.kind === "new_file" ? target.filename : null,
      target.kind === "new_file" ? target.ttl : null,
      target.kind === "new_file" ? target.writePolicy : null,
      target.kind === "new_file" ? target.password : null,
      target.kind === "new_file" ? target.writePassword : null,
      target.kind === "file" ? target.expectedVersion : null,
      maxBytes,
      sha256,
      now.toISOString(),
      expiresAt,
    )
    .run();
  return secretJson(
    {
      id,
      secret,
      upload_url: grantUploadUrl(env, id),
      method: "PUT",
      header: "Authorization",
      scheme: "Bearer",
      expires_at: expiresAt,
      max_bytes: maxBytes,
      sha256,
      target:
        target.kind === "new_file"
          ? {
              ...newFileTargetJson(target.filename, target.ttl, target.writePolicy),
              // Echoed once here, like POST /v1/files; GET /v1/grants/{id} never returns stored phrases.
              ...(target.password ? { password: target.password } : {}),
              ...(target.writePassword ? { write_password: target.writePassword } : {}),
            }
          : target.kind === "file"
            ? fileTargetJson(target.fileId, target.expectedVersion)
            : { type: "site_path", site_id: target.siteId, path: target.path },
      url: target.kind === "new_file" ? null : target.url,
      status_url: `${publicOrigin(env)}/v1/grants/${id}`,
    },
    201,
  );
}

function ownsGrant(actor: Actor, row: GrantRow): boolean {
  if (row.user_id && actor.userId) return row.user_id === actor.userId;
  return row.user_email.toLowerCase() === actor.email.toLowerCase();
}

function derivedState(row: GrantRow, now = Date.now()): GrantRow["state"] | "expired" {
  if ((row.state === "unused" || row.state === "uploading") && !grantClaimable(row.expires_at, now)) return "expired";
  return row.state;
}

export async function grantStatus(env: Env, actor: Actor, id: string): Promise<Response> {
  const row = GRANT_ID_RE.test(id)
    ? await env.DB.prepare(`SELECT * FROM upload_grants WHERE id = ?`).bind(id).first<GrantRow>()
    : null;
  if (!row || !ownsGrant(actor, row)) throw new ApiError(404, "grant_not_found", "No upload grant with that id.");
  return json({
    id: row.id,
    state: derivedState(row),
    target: targetJson(row),
    url: row.result_url,
    result_id: row.result_id,
    last_error: row.last_error,
    max_bytes: row.max_bytes,
    sha256: row.sha256,
    created_at: row.created_at,
    consumed_at: row.consumed_at,
    expires_at: row.expires_at,
  });
}

/** Grant rows are short-lived credentials, deleted a day after expiry in bounded batches. */
export async function purgeGrants(env: Env, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  let deleted = 0;
  for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
    const result = await env.DB.prepare(
      `DELETE FROM upload_grants WHERE id IN (SELECT g.id FROM upload_grants g
        WHERE (g.target_kind != 'site_deployment' AND g.expires_at < ?)
          OR (g.target_kind = 'site_deployment' AND COALESCE(
            g.receipt_expires_at, (SELECT d.receipt_expires_at FROM site_deployments d WHERE d.id = g.deployment_id),
            (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', d.deadline, '+7 days') FROM site_deployments d WHERE d.id = g.deployment_id),
            strftime('%Y-%m-%dT%H:%M:%fZ', g.expires_at, '+7 days')) <= ?) LIMIT ?)`,
    )
      .bind(cutoff, new Date(now).toISOString(), PURGE_BATCH)
      .run();
    const changes = Number(result.meta?.changes ?? 0);
    deleted += changes;
    if (changes < PURGE_BATCH) break;
  }
  return deleted;
}

function grantJson(data: unknown, status: number, extra?: Record<string, string>): Response {
  return json(data, status, { "cache-control": "no-store", ...extra });
}

/** Responses on the content origin never point at the hub or /v1: the uploading machine has no token. */
export async function redeemGrantRoute(env: Env, ctx: ExecutionContext, request: Request, rawId: string): Promise<Response> {
  if (request.method !== "PUT") {
    return grantJson({ error: "method_not_allowed", message: "Upload grants accept PUT only." }, 405, { allow: "PUT" });
  }
  try {
    return await redeemGrant(env, ctx, request, rawId);
  } catch (err) {
    if (err instanceof ApiError) {
      return grantJson({ error: err.code, message: err.message, ...err.extra }, err.status);
    }
    console.error(err instanceof Error ? err.stack || err.message : err);
    return grantJson({ error: "internal", message: "Something went wrong. Retry the upload." }, 500);
  }
}

function invalidGrant(): ApiError {
  return new ApiError(404, "grant_invalid", "No upload grant matches that id and secret.");
}

function grantUsed(row: Pick<GrantRow, "result_id" | "result_url">): ApiError {
  return new ApiError(410, "grant_used", "This grant was already used. Its upload is published.", { url: row.result_url, result_id: row.result_id });
}

function grantFailed(reason: string | null): ApiError {
  const message = reason === "file_recovery_required"
    ? "This grant can no longer be used: the file needs storage recovery, so a new grant would fail too. Ask its owner to have an administrator reconcile it."
    : "This grant can no longer be used. Ask for a new grant.";
  return new ApiError(410, "grant_failed", message, { reason });
}

function grantExpired(): ApiError {
  return new ApiError(410, "grant_expired", "This grant expired. Ask for a new grant.");
}

function rejectForbiddenHeaders(request: Request): void {
  const ctype = (request.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("multipart/form-data")) {
    throw new ApiError(400, "bad_content_type", "Upload grants accept raw bytes only.");
  }
  for (const name of [...FORBIDDEN_PUT_HEADERS, EXPECTED_VERSION_HEADER]) {
    if (request.headers.get(name) !== null) {
      throw new ApiError(400, "bad_request", `Upload grants do not accept ${name}. Send raw bytes and the Authorization header only.`);
    }
  }
}

async function failGrant(env: Env, id: string, from: { state: "unused" } | { leaseId: string }, reason: string): Promise<void> {
  // A lease-keyed transition must never touch a grant its own upload already consumed.
  const where = "state" in from ? `state = 'unused'` : `lease_id = ? AND state = 'uploading'`;
  const binds = "state" in from ? [] : [from.leaseId];
  await env.DB.prepare(
    `UPDATE upload_grants SET state = 'failed', last_error = ?, lease_id = NULL, leased_at = NULL, file_password = NULL, file_write_password = NULL WHERE id = ? AND ${where}`,
  )
    .bind(reason, id, ...binds)
    .run();
}

async function releaseGrant(env: Env, id: string, leaseId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE upload_grants SET state = 'unused', lease_id = NULL, leased_at = NULL WHERE id = ? AND lease_id = ? AND state = 'uploading'`,
  )
    .bind(id, leaseId)
    .run();
}

async function liveActor(env: Env, row: GrantRow, from: { state: "unused" } | { leaseId: string }): Promise<Actor> {
  const resolved = await grantActor(env, row.token_id);
  if ("actor" in resolved) return resolved.actor;
  const reason = resolved.rejected === "email" ? "email_not_allowed" : "token_revoked";
  await failGrant(env, row.id, from, reason);
  throw grantFailed(reason);
}

async function redeemGrant(env: Env, ctx: ExecutionContext, request: Request, rawId: string): Promise<Response> {
  const arrival = Date.now();
  const secret = parseBearer(request);
  if (!GRANT_ID_RE.test(rawId) || !secret) throw invalidGrant();
  const row = await env.DB.prepare(`SELECT * FROM upload_grants WHERE id = ?`).bind(rawId).first<GrantRow>();
  if (!row || row.target_kind === "site_deployment" || !hashesEqual(await hashGrantSecret(secret), row.secret_hash)) throw invalidGrant();
  rejectForbiddenHeaders(request);
  if (row.state === "consumed") throw grantUsed(row);
  if (row.state === "failed") throw grantFailed(row.last_error);
  if (tokenExpired(row.expires_at, arrival)) throw grantExpired();
  if (row.state === "uploading") throw grantBusy();
  await liveActor(env, row, { state: "unused" });

  const maxBytes = Math.min(row.max_bytes, instancePolicy(env).fileBytes);
  return withUpload(
    request,
    env,
    maxBytes,
    "",
    async (upload) => {
      const actor = await liveActor(env, row, { state: "unused" });
      const guard = await claimLease(env, row);
      try {
        return await commit(env, ctx, actor, row, upload, guard);
      } catch (err) {
        throw await settleFailure(env, row.id, guard, err);
      }
    },
    { sha256: row.sha256 },
  );
}

async function claimLease(env: Env, row: GrantRow): Promise<GrantGuard> {
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const claimed = await env.DB.prepare(
    `UPDATE upload_grants SET state = 'uploading', lease_id = ?, leased_at = ? WHERE id = ? AND state = 'unused' AND expires_at > ?`,
  )
    .bind(leaseId, now.toISOString(), row.id, grantClaimCutoff(now))
    .run();
  if (d1Changed(claimed)) return { grantId: row.id, leaseId };
  const current = await env.DB.prepare(`SELECT state, last_error, result_id, result_url FROM upload_grants WHERE id = ?`)
    .bind(row.id)
    .first<Pick<GrantRow, "state" | "last_error" | "result_id" | "result_url">>();
  if (current?.state === "consumed") throw grantUsed(current);
  if (current?.state === "failed") throw grantFailed(current.last_error);
  if (current?.state === "uploading") throw grantBusy();
  throw grantExpired();
}

async function commit(env: Env, ctx: ExecutionContext, actor: Actor, row: GrantRow, upload: Upload, guard: GrantGuard): Promise<Response> {
  if (row.target_kind === "new_file") {
    const res = await createLooseFile(env, ctx, actor, row.filename ?? "", upload, null, row.file_password ?? undefined, row.file_ttl ?? undefined, row.file_write_policy ?? undefined, row.file_write_password ?? undefined, guard);
    return looseResult(res, true);
  }
  if (row.target_kind === "file") {
    return looseResult(await putLooseFile(env, ctx, actor, row.file_id ?? "", upload, null, null, undefined, guard, row.expected_version ?? undefined), false);
  }
  const result = await putSiteFile(env, ctx, actor, row.site_id ?? "", row.path ?? "", upload, null, guard);
  return grantJson(
    { ok: true, created: result.created, url: result.url, site_id: row.site_id, path: result.path, size: result.size, content_type: result.content_type },
    result.created ? 201 : 200,
  );
}

async function looseResult(res: Response, created: boolean): Promise<Response> {
  const body = (await res.json()) as { url: string; id: string; size: number; content_type: string; content_generation: number };
  return grantJson({ ok: true, created, url: body.url, id: body.id, size: body.size, content_type: body.content_type, content_generation: body.content_generation }, created ? 201 : 200);
}

/** Retryable failures hand the grant back; permanent ones end it with a reason the status read can show. */
const RETRYABLE = new Set(["file_busy", "file_write_lost", "site_busy", "site_write_lost", "storage_cap"]);

async function settleFailure(env: Env, id: string, guard: GrantGuard, err: unknown): Promise<ApiError> {
  if (!(err instanceof ApiError)) {
    console.error(err instanceof Error ? err.stack || err.message : err);
    await releaseGrant(env, id, guard.leaseId);
    return new ApiError(500, "internal", "Something went wrong. Retry the upload.");
  }
  if (err.code === "grant_busy" || err.code === "grant_expired" || err.code === "storage_rollback_failed") return err;
  if (RETRYABLE.has(err.code) || (err.status >= 500 && err.code !== "content_origin_not_configured")) {
    await releaseGrant(env, id, guard.leaseId);
    return new ApiError(err.status, err.code, retryMessage(err.code), err.code === "storage_cap" ? err.extra : {});
  }
  const reason = err.code === "grant_failed" ? String(err.extra.reason ?? "token_revoked") : err.code;
  await failGrant(env, id, { leaseId: guard.leaseId }, reason);
  return grantFailed(reason);
}

function retryMessage(code: string): string {
  if (code === "storage_cap") return "This Energon is out of storage. Retry after space is freed.";
  return "The target changed while uploading. Retry the upload.";
}
