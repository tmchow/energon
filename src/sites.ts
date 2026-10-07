import { acquireVersionLease, releaseVersionLease, startVersionLeaseHeartbeat } from "./site-storage";
import { SITE_FILE_COUNT_SQL, SITE_SIZE_SQL, SITE_FILE_TOTALS_JOIN_SQL } from "./catalog";
import { publishSiteChanges, snapshotFiles } from "./site-snapshot";
import { canonicalDeploymentIntent } from "./site-deployments";
import { withSiteRead } from "./site-reads";
import { withSiteBodyCache } from "./site-cache";
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
import { MAX_IMPORT_FILES, PRODUCT, RESERVED_SLUGS, SLUG_RE, formatBytes } from "./config";
import {
  d1Changed,
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
import { maybeUnlockWithWritePassword, passwordEcho, passwordField, passwordHashFromInput, protectContent, assignPasswordStore, hubLinkAccessFields, storedPasswordSecret, writePasswordField, writePasswordHashFromInput } from "./gate";
import { ensureUser } from "./handles";
import { mintObjectId } from "./ids";
import { type GrantGuard } from "./grant-guard";
import { ApiError, applyIsolation, basename, contentDisposition, htmlPage, json, jsonMaybeSecret, normalizeRelPath, publicOrigin, secretJson, sha256Hex, tooLarge, wantsDownload } from "./http";
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
import { type Upload } from "./upload";
import { packZip } from "./zip";

const SITE_SELECT =
  `id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret, written_via, last_read_at, active_version_id, content_generation, lifecycle_state, conversion_state`;
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
  return env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE id = ? AND lifecycle_state = 'live'`).bind(id).first<SiteRow>();
}

async function findSiteForActor(env: Env, id: string): Promise<SiteRow | null> {
  return getSiteById(env, id);
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
  lifecycleState = "live",
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
  const versionId = crypto.randomUUID();
  const manifestHash = await sha256Hex(canonicalDeploymentIntent({ mode: "replace", files: [] }));
  // Create the empty snapshot with its pointer so cron cannot mistake a new site for legacy storage.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sites (id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, password_secret, expires_at, write_policy, write_password_hash, write_password_secret, lifecycle_state, active_version_id, conversion_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'versioned')`,
    ).bind(id, handle, slug, user.id, ts, ts, actor.email, actor.email, stored, storedPasswordSecret(stored, password), resolved.expiresAt, storedWrite, storedWritePw, storedPasswordSecret(storedWritePw, writePassword), lifecycleState, versionId),
    env.DB.prepare(
      `INSERT INTO site_versions (id, site_id, state, manifest_hash, created_at, sealed_at)
       VALUES (?, ?, 'active', ?, ?, ?)`,
    ).bind(versionId, id, manifestHash, ts, ts),
  ]);
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

export async function postSite(
  env: Env,
  actor: Actor,
  body: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const from = typeof body.duplicate_from === "string" ? body.duplicate_from.trim() : "";
  if (from) {
    if (body.overwrite === true) {
      throw new ApiError(
        400,
        "bad_duplicate",
        "duplicate_from creates a new site. Omit overwrite and pick a new slug.",
      );
    }
    return duplicateSite(
      env,
      actor,
      from,
      String(body.slug || ""),
      ctx,
      body.ttl,
      body.write_policy,
      passwordField(body),
      writePasswordField(body),
    );
  }
  return createSite(
    env,
    actor,
    String(body.slug || ""),
    passwordField(body),
    ctx,
    body.ttl,
    body.write_policy,
    writePasswordField(body),
  );
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
  const lease = source.active_version_id ? await acquireVersionLease(env.DB, source.active_version_id, "duplicate") : null;
  const controller = new AbortController();
  const heartbeat = lease ? startVersionLeaseHeartbeat(env.DB, lease, error => controller.abort(error)) : null;
  let destId: string | undefined;
  try {
    const files = await snapshotFiles(env, source);
    if (files.length > MAX_IMPORT_FILES) throw new ApiError(400, "too_many_files", `Copies support at most ${MAX_IMPORT_FILES} files.`);
    const created = await createSite(env, actor, newSlugRaw, password, ctx, ttl, writePolicy, writePassword, "creating");
    destId = String(created.body.id);
    const destination = (await env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE id = ?`).bind(destId).first<SiteRow>())!;
    heartbeat?.assertActive();
    await publishSiteChanges(env, destination, { ...actor, activateHidden: true }, files.map(file => ({
      path: file.path, upload: { size: file.size, head: new Uint8Array(), stagedKey: file.object_key }, contentType: file.content_type,
    })), sitePublicUrl(env, destination.handle, destination.id, destination.slug), controller.signal);
    return { status: 201, body: { ...created.body, duplicated: true, duplicated_from: source.id, file_count: files.length } };
  } catch (error) {
    if (destId) await env.DB.prepare("UPDATE sites SET lifecycle_state = 'deleted', active_version_id = NULL WHERE id = ? AND lifecycle_state = 'creating'").bind(destId).run();
    throw error;
  } finally {
    heartbeat?.stop();
    if (lease) await releaseVersionLease(env.DB, lease);
  }
}

type SitePatch = {
  password?: string;
  write_password?: string;
  ttl?: unknown;
  setTtl?: boolean;
  write_policy?: unknown;
};

async function prepareSitePatch(
  env: Env,
  actor: Actor,
  site: SiteRow,
  patch: SitePatch,
  fields: { writePolicy: boolean; writePassword: boolean; sharePassword: boolean },
) {
  let nextWrite = resolveWritePolicy(site.write_policy);
  if (fields.writePolicy) {
    assertCanSetWritePolicy(actor, site.created_by, site.owner_id);
    const parsed = requestedWritePolicy(patch.write_policy);
    if (parsed === "invalid" || parsed === null) {
      throw new ApiError(400, "bad_write_policy", "write_policy must be owner or org.");
    }
    nextWrite = parsed;
  }
  const writeHash = await writePasswordHashFromInput(patch.write_password);
  if (fields.writePassword || fields.sharePassword) {
    assertCanSetWritePolicy(actor, site.created_by, site.owner_id);
  }
  const hash = await passwordHashFromInput(patch.password);
  const ts = new Date().toISOString();
  const resolved = patch.setTtl ? resolveExpiresAt(instancePolicy(env), patch.ttl) : null;
  return { nextWrite, writeHash, hash, ts, resolved, wantsWrite: fields.writePolicy };
}

function sitePatchAssignments(
  actor: Actor,
  patch: SitePatch,
  prepared: Awaited<ReturnType<typeof prepareSitePatch>>,
  asAdmin: boolean,
): { assignments: string[]; values: unknown[] } | null {
  const { hash, writeHash, resolved, wantsWrite, ts, nextWrite } = prepared;
  const ttlOnlyAdmin = asAdmin && Boolean(patch.setTtl) && hash === undefined && writeHash === undefined && !wantsWrite;
  if (hash === undefined && writeHash === undefined && !resolved && !wantsWrite) return null;
  const assignments: string[] = [];
  const values: unknown[] = [];
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
  return { assignments, values };
}

export async function patchSite(
  env: Env,
  actor: Actor,
  idRaw: string,
  patch: SitePatch,
  ctx?: ExecutionContext,
  asAdmin = false,
): Promise<Response> {
  const fields = {
    writePolicy: Object.prototype.hasOwnProperty.call(patch, "write_policy"),
    writePassword: Object.prototype.hasOwnProperty.call(patch, "write_password"),
    sharePassword: patch.password !== undefined,
  };
  const wantsOther = fields.sharePassword || Boolean(patch.setTtl);
  const site = await requireSite(env, actor, idRaw, {
    allowExpired: Boolean(patch.setTtl),
    ctx,
    mutate: wantsOther,
    asAdmin,
  });
  const prepared = await prepareSitePatch(env, actor, site, patch, fields);
  const { hash, writeHash, resolved, nextWrite } = prepared;
  const notClaimed = `last_written_by NOT LIKE ?`;
  const update = sitePatchAssignments(actor, patch, prepared, asAdmin);
  if (update) {
    const writeGuard = asAdmin
      ? { sql: "1 = 1", binds: [] as unknown[] }
      : { sql: OWNER_WRITE_SQL, binds: [...ownerWriteBinds(actor)] };
    const updated = await env.DB.prepare(
      `UPDATE sites SET ${update.assignments.join(", ")} WHERE id = ? AND lifecycle_state = 'live' AND ${notClaimed} AND ${writeGuard.sql}`,
    )
      .bind(...update.values, site.id, PURGE_CLAIM_LIKE, ...writeGuard.binds)
      .run();
    if (!d1Changed(updated)) {
      await throwSiteMutationConflict(env, site.id);
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
  opts?: { allowExpired?: boolean; ctx?: ExecutionContext; mutate?: boolean; asAdmin?: boolean },
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
    if (opts.mutate && !opts.asAdmin) assertCanMutate(actor, still);
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
  if (opts?.mutate && !opts.asAdmin) assertCanMutate(actor, site);
  return site;
}

export async function putSiteFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
  pathRaw: string,
  upload: Upload,
  hintType: string | null,
  guard?: GrantGuard,
): Promise<{ url: string; api_url: string; created: boolean; path: string; size: number; content_type: string }> {
  const path = assertFilePath(pathRaw);
  const policy = instancePolicy(env);
  if (upload.size > policy.fileBytes) throw tooLarge(upload.size, "", policy.fileBytes);
  const site = await requireSite(env, actor, idRaw, { ctx, mutate: true });
  const existing = (await snapshotFiles(env, site)).find(file => file.path === path);
  const contentType = guard && existing?.content_type ? existing.content_type : contentTypeFor(path, upload.head, hintType);
  const url = sitePublicUrl(env, site.handle, site.id, site.slug, path);
  await publishSiteChanges(env, site, { ...actor, legacyGrant: guard }, [{ path, upload, contentType }], url);
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]).catch(error => console.error("Site cache purge pending", error));
  return { url, api_url: `${publicOrigin(env)}/v1/sites/${site.id}/files/${path}`, created: !existing,
    path, size: upload.size, content_type: contentType };
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
  return withSiteRead(env, site, "api", async snapshot => {
  const obj = await snapshot.get(path);
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
  });
}

export async function exportSiteZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
): Promise<Response> {
  const site = await requireSite(env, actor, idRaw, { ctx });
  return withSiteRead(env, site, "export", async snapshot => {
  const listed = await snapshot.files();
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
  if (total > policy.zipExportBytes) {
    throw new ApiError(
      413,
      "too_large",
      `That site is over the ${formatBytes(policy.zipExportBytes)} export cap (${(total / (1024 * 1024)).toFixed(1)} MB of files). ${PRODUCT} zips at most ${formatBytes(policy.zipExportBytes)} so a download stays small. Split the site, then retry.`,
      { limit_bytes: policy.zipExportBytes, actual_bytes: total },
    );
  }
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const row of listed) {
    const obj = await snapshot.get(row.path);
    if (!obj) {
      throw new ApiError(
        500,
        "export_failed",
        `Site file '${row.path}' is missing from storage. Re-upload that path, then retry.`,
      );
    }
    files.push({ path: row.path, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  const zip = packZip(files, policy.zipExportBytes);
  noteRead(env, ctx, { table: "sites", id: site.id, last_read_at: site.last_read_at });
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", contentDisposition("attachment", `${site.slug}.zip`));
  headers.set("cache-control", "no-store");
  headers.set("content-length", String(zip.byteLength));
  return new Response(zip, { headers });
  });
}

export async function deleteSite(env: Env, ctx: ExecutionContext | undefined, actor: Actor, idRaw: string, asAdmin = false): Promise<void> {
  const site = await getSiteById(env, idRaw);
  if (!site) throw new ApiError(404, "site_not_found", "Site not found.");
  if (!asAdmin) assertCanMutate(actor, site);
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`UPDATE sites SET lifecycle_state = 'deleted', active_version_id = NULL, updated_at = ?
    WHERE id = ? AND lifecycle_state = 'live' AND ${asAdmin ? "1 = 1" : OWNER_WRITE_SQL}`)
    .bind(now, site.id, ...(asAdmin ? [] : ownerWriteBinds(actor))).run();
  if (!d1Changed(changed)) await throwSiteMutationConflict(env, site.id);
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]).catch(error => console.error("Site cache purge pending", error));
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
  if (!(await snapshotFiles(env, site)).some(file => file.path === path))
    throw new ApiError(404, "file_not_found", `No file at ${path}.`);
  await publishSiteChanges(env, site, actor, [{ path, delete: true }], sitePublicUrl(env, site.handle, site.id, site.slug));
  await purgeContent(ctx, [sitePrefix(site.handle, site.id)]).catch(error => console.error("Site cache purge pending", error));
}

export async function listSiteJson(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  idRaw: string,
): Promise<Response> {
  const site = await requireSite(env, actor, idRaw, { ctx });
  const origin = publicOrigin(env);
  return withSiteRead(env, site, "listing", async snapshot => {
  const files = await snapshot.files();
  return json({
    id: site.id,
    version_id: site.active_version_id ?? null,
    content_generation: site.content_generation ?? 0,
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
    files: files.map((f) => ({
      ...f,
      handle: site.handle,
      slug: site.slug,
      url: sitePublicUrl(env, site.handle, site.id, site.slug, f.path),
      api_url: `${origin}/v1/sites/${site.id}/files/${f.path}`,
    })),
  });
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
    version_id: string | null;
    content_generation: number;
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
         ${SITE_FILE_TOTALS_JOIN_SQL}
         WHERE s.lifecycle_state = 'live' AND ${criteria.where}
         GROUP BY s.id
         HAVING ${criteria.having})`
    : `SELECT COUNT(*) AS n FROM sites s WHERE s.lifecycle_state = 'live' AND ${criteria.where}`;
  const countRow = await env.DB.prepare(countSql)
    .bind(...criteria.whereBinds, ...criteria.havingBinds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.handle, s.slug, s.created_at, s.updated_at, s.created_by, s.last_written_by,
            s.password_hash, s.write_password_hash, s.written_via, s.expires_at, s.last_read_at, s.write_policy,
            s.active_version_id AS version_id, s.content_generation,
            ${SITE_FILE_COUNT_SQL} AS file_count, ${SITE_SIZE_SQL} AS size
     FROM sites s
     ${SITE_FILE_TOTALS_JOIN_SQL}
     WHERE s.lifecycle_state = 'live' AND ${clauses.where}
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
      version_id: string | null;
      content_generation: number;
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

  return withSiteRead(env, site, "visitor", async snapshot => {
  if (snapshot.versionId) {
    const index = pathRaw === "" || pathRaw === "/";
    let paths: string[];
    try { paths = index ? ["index.html", "index.md"] : [assertFilePath(pathRaw)]; }
    catch { return htmlPage("<!doctype html><title>Not found</title><p>Bad path.</p>", 404, { "cache-control": "private, no-store" }); }
    for (const path of paths) {
      const file = await snapshot.metadata(path);
      if (!file) continue;
      read();
      const type = index && path === "index.html" ? "text/html; charset=utf-8" : file.content_type;
      const headers = new Headers({ "content-type": type, "content-length": String(file.size),
        etag: `"${file.sha256}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
      applyIsolation(headers, type);
      if (!index) headers.set("content-disposition", contentDisposition(wantsDownload(request) ? "attachment" : "inline", basename(path)));
      return withSiteBodyCache(env, ctx, request, { siteId: site.id, versionId: snapshot.versionId,
        path, objectKey: file.object_key, representation: "raw", rendererRevision: "1",
        publicUngated: !site.password_hash && unlocked !== "unlocked", markdown: isMarkdownName(path),
        download: wantsDownload(request), expiresAt: site.expires_at ?? null, headers }, async () => {
        const object = await snapshot.get(path);
        if (!object) throw new ApiError(500, "export_failed", "The selected version is missing a stored file.");
        if (isMarkdownName(path)) return respondMarkdown(request, object, path);
        return new Response(object.body, { headers });
      });
    }
    if (index) return htmlPage(await fileListHtml(site, await snapshot.files()), 200, { "cache-control": "private, no-store" });
    return htmlPage("<!doctype html><title>Not found</title><p>No file at this path.</p>", 404, { "cache-control": "private, no-store" });
  }
  const remaining = remainingCacheSeconds(site.expires_at);
  const cacheable = !site.password_hash && unlocked !== "unlocked";
  const wantsIndex = pathRaw === "" || pathRaw === "/";
  if (wantsIndex) {
    const index = await snapshot.get("index.html");
    if (index) {
      read();
      return serveObject(index, "text/html; charset=utf-8", cacheable, siteCacheTag(handle, site.id), remaining);
    }
    const indexMd = await snapshot.get("index.md");
    if (indexMd) {
      read();
      return respondMarkdown(request, indexMd, "index.md");
    }
    return htmlPage(await fileListHtml(site, await snapshot.files()), 200, {
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
  const obj = await snapshot.get(path);
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
  });
}

async function fileListHtml(site: SiteRow, files: SiteFileRow[]): Promise<string> {
  const rows = files
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
