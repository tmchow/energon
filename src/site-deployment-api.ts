import { MAX_IMPORT_FILES } from "./config";
import { ApiError, publicOrigin, readJson, secretJson, sha256Hex, tooLarge } from "./http";
import { assertCanMutate, instancePolicy } from "./policy";
import { getSiteById } from "./sites";
import { commitDeployment, createDeployment, DeploymentError, getDeployment, recordDeploymentFile, sealDeployment, type DeploymentAuthority } from "./site-deployments";
import { acquireVersionLease, releaseVersionLease, startVersionLeaseHeartbeat, cleanupAllocation, reserveAllocation, writeAllocation, type StorageAllocation, type VersionLease } from "./site-storage";
import { sitePublicUrl } from "./urls";
import type { Actor, DeploymentIntent, DeploymentManifestFile, Env, SiteDeploymentRow } from "./types";
import { indexSiteZip, streamSiteZipEntry, type SiteZipIndex } from "./site-zip";
import { contentTypeFor } from "./mime";
import { snapshotFiles } from "./site-snapshot";
import { ensureLegacyReadVersion, ensureSiteSnapshotBaseline } from "./site-version-migrate";
import { abortableBody, readUpload, sha256OfBytes } from "./upload";

const ARCHIVE_PATH = "\0archive";

function inputIntent(body: Record<string, unknown>): DeploymentIntent {
  if (body.mode !== undefined && body.mode !== "replace") throw new DeploymentError("invalid_intent", "Whole-site deployments replace the site.");
  if (body.archive && typeof body.archive === "object") {
    if (body.files !== undefined) throw new DeploymentError("invalid_intent", "Choose a manifest or an archive, not both.");
    const archive = body.archive as Record<string, unknown>;
    return { mode: "replace", archive: { size: Number(archive.size), sha256: String(archive.sha256),
      maxExtractedBytes: Number(archive.max_extracted_bytes ?? 500 * 1024 * 1024), maxFiles: Number(archive.max_files ?? 200) } };
  }
  if (!Array.isArray(body.files)) throw new DeploymentError("invalid_intent", "A deployment needs a manifest or archive descriptor.");
  return { mode: "replace", files: body.files.map(file => ({ path: file?.path, size: file?.size,
    sha256: file?.sha256, contentType: file?.content_type ?? "application/octet-stream" })) };
}

type PreparationLock = { id: string; signal: AbortSignal; abort(error: unknown): void; assertActive(): Promise<void>; stop(): void };

async function lockPreparation(env: Env, deployment: SiteDeploymentRow): Promise<PreparationLock> {
  const owner = crypto.randomUUID();
  const now = new Date();
  const result = await env.DB.prepare(`UPDATE site_deployments SET prepare_owner = ?, prepare_expires_at = ?
    WHERE id = ? AND state = 'uploading' AND deadline > ?
      AND (prepare_owner IS NULL OR prepare_expires_at <= ?)`)
    .bind(owner, new Date(now.getTime() + 120_000).toISOString(), deployment.id, now.toISOString(), now.toISOString()).run();
  if (!result.meta.changes) throw new DeploymentError("deployment_conflict", "Another preparation is in progress or this session is closed.");
  const controller = new AbortController();
  let renewal: Promise<void> | undefined;
  const assertActive = async () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!renewal) {
      const now = new Date();
      renewal = env.DB.prepare(`UPDATE site_deployments SET prepare_expires_at = ?
        WHERE id = ? AND prepare_owner = ? AND prepare_expires_at > ? AND deadline > ? AND state = 'uploading'`)
        .bind(new Date(now.getTime() + 120_000).toISOString(), deployment.id, owner, now.toISOString(), now.toISOString()).run()
        .then(result => { if (!result.meta.changes) throw new DeploymentError("deployment_conflict", "Preparation ownership was lost."); })
        .catch(error => { controller.abort(error); throw error; }).finally(() => { renewal = undefined; });
    }
    await renewal;
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const timer = setInterval(() => { void assertActive().catch(() => undefined); }, 30_000);
  return { id: owner, signal: controller.signal, abort: error => controller.abort(error), assertActive, stop() { clearInterval(timer); } };
}

async function unlockPreparation(env: Env, id: string, owner: PreparationLock): Promise<void> {
  owner.stop();
  await env.DB.prepare("UPDATE site_deployments SET prepare_owner = NULL, prepare_expires_at = NULL WHERE id = ? AND prepare_owner = ?")
    .bind(id, owner.id).run();
}

async function inputAllocation(env: Env, deployment: SiteDeploymentRow, file: { path: string; size: number }): Promise<StorageAllocation> {
  const kind = `input:${file.path}`;
  const existing = await env.DB.prepare(`SELECT * FROM storage_allocations WHERE deployment_id = ? AND kind = ?
    AND state IN ('reserved', 'writing', 'stored') ORDER BY created_at DESC LIMIT 1`)
    .bind(deployment.id, kind).first<StorageAllocation>();
  if (existing) return existing;
  const attempt = crypto.randomUUID();
  return reserveAllocation(env.DB, { ownerId: deployment.owner_id, siteId: deployment.site_id,
    deploymentId: deployment.id, versionId: deployment.version_id, kind, bytes: file.size,
    cap: instancePolicy(env).platformBytes,
    key: `site-versions/${deployment.site_id}/${deployment.version_id}/${attempt}/${await sha256Hex(file.path)}` });
}

async function reserveInputs(env: Env, deployment: SiteDeploymentRow): Promise<void> {
  if (deployment.state !== "uploading") return;
  const owner = await lockPreparation(env, deployment);
  try {
    const intent: DeploymentIntent = JSON.parse(deployment.input_json);
    for (const file of intent.files ?? [{ path: ARCHIVE_PATH, size: intent.archive!.size }]) await inputAllocation(env, deployment, file);
    await owner.assertActive();
  } finally { await unlockPreparation(env, deployment.id, owner); }
}

async function uploadArchive(request: Request, env: Env, deployment: SiteDeploymentRow, authorize?: () => Promise<void>): Promise<Response> {
  const intent: DeploymentIntent = JSON.parse(deployment.input_json);
  if (!intent.archive) throw new DeploymentError("invalid_intent", "This session uses a file manifest.");
  const owner = await lockPreparation(env, deployment);
  try {
    const allocation = await inputAllocation(env, deployment, { path: ARCHIVE_PATH, size: intent.archive.size });
    if (allocation.state === "stored") await verifyReplay(request, { path: ARCHIVE_PATH, ...intent.archive, contentType: "application/zip" }, owner.signal);
    else await writeAllocation(env.DB, env.BUCKET, allocation, abortableBody(request.body ?? new Response("").body!, owner.signal), intent.archive.sha256, "application/zip");
    await authorize?.();
    await owner.assertActive();
    return secretJson({ stored: true }, allocation.state === "stored" ? 200 : 201);
  } finally { await unlockPreparation(env, deployment.id, owner); }
}

type ArchiveProgress = { index: SiteZipIndex; next: number; copies: Awaited<ReturnType<typeof snapshotFiles>>; copyNext: number };

async function prepareArchive(env: Env, deployment: SiteDeploymentRow, actor: DeploymentAuthority, authorize?: () => Promise<void>): Promise<void> {
  if (deployment.state === "ready" || deployment.state === "committed") return;
  const owner = await lockPreparation(env, deployment);
  let lease: VersionLease | undefined;
  let heartbeat: ReturnType<typeof startVersionLeaseHeartbeat> | undefined;
  try {
    const site = await getSiteById(env, deployment.site_id);
    if (!site || site.content_generation !== deployment.base_generation) throw new DeploymentError("deployment_conflict", "The site's version changed during preparation.");
    const intent: DeploymentIntent = JSON.parse(deployment.input_json);
    const policy = instancePolicy(env);
    if (deployment.mode === "merge") {
      lease = await acquireVersionLease(env.DB, site.active_version_id ?? await ensureLegacyReadVersion(env.DB, site), "archive-merge");
      heartbeat = startVersionLeaseHeartbeat(env.DB, lease, owner.abort);
    }
    let progress: ArchiveProgress;
    if (!deployment.prepare_cursor) {
      const archive = await inputAllocation(env, deployment, { path: ARCHIVE_PATH, size: intent.archive!.size });
      if (archive.state !== "stored") throw new DeploymentError("deployment_incomplete", "Upload the archive before preparing it.");
      const index = await indexSiteZip(env.BUCKET, archive.object_key!, { maxArchiveBytes: policy.zipBytes,
        maxFileBytes: policy.fileBytes, maxTotalBytes: Math.min(policy.zipExtractedBytes, intent.archive!.maxExtractedBytes),
        maxFiles: intent.archive!.maxFiles, maxRecords: 2000, maxDirectoryBytes: 4 * 1024 * 1024, maxNameBytes: 1024 });
      const paths = new Set(index.entries.map(entry => entry.path));
      const baseline = deployment.mode === "merge" ? await snapshotFiles(env, site) : [];
      const copies = baseline.filter(file => !paths.has(file.path));
      if (index.entries.length + copies.length > Math.max(MAX_IMPORT_FILES, baseline.length))
        throw new ApiError(400, "too_many_files", `A ZIP merge cannot grow a site beyond ${MAX_IMPORT_FILES} files.`);
      for (const entry of [...index.entries, ...copies]) await inputAllocation(env, deployment, entry);
      progress = { index, next: 0, copies, copyNext: 0 };
    } else progress = JSON.parse(deployment.prepare_cursor);
    const entry = progress.index.entries[progress.next];
    const copy = !entry ? progress.copies[progress.copyNext] : undefined;
    const file = entry ?? copy;
    if (file) {
      const allocation = await inputAllocation(env, deployment, file);
      let result: { size: number; sha256: string };
      const contentType = entry ? contentTypeFor(entry.path, new Uint8Array()) : copy!.content_type;
      if (allocation.state === "stored" && allocation.result_sha256) result = { size: allocation.actual_bytes!, sha256: allocation.result_sha256 };
      else {
        let body: ReadableStream<Uint8Array>;
        if (entry) body = streamSiteZipEntry(env.BUCKET, progress.index.archive, entry, {
          maxFileBytes: policy.fileBytes, maxTotalBytes: Math.min(policy.zipExtractedBytes, intent.archive!.maxExtractedBytes),
          totalBytes: progress.index.entries.slice(0, progress.next).reduce((sum, row) => sum + row.size, 0),
        });
        else {
          const source = await env.BUCKET.get(copy!.object_key);
          if (!source) throw new DeploymentError("deployment_conflict", "A source file is no longer available.");
          body = source.body;
        }
        result = await writeAllocation(env.DB, env.BUCKET, allocation, abortableBody(body, owner.signal), copy?.sha256, contentType);
      }
      await authorize?.();
      await owner.assertActive();
      heartbeat?.assertActive();
      await recordDeploymentFile(env.DB, deployment.id, { version_id: deployment.version_id, path: file.path,
        allocation_id: allocation.id, object_key: allocation.object_key!, size: result.size, sha256: result.sha256,
        content_type: contentType }, new Date(), actor);
      if (entry) progress.next++; else progress.copyNext++;
    }
    await owner.assertActive();
    const saved = await env.DB.prepare("UPDATE site_deployments SET prepare_cursor = ? WHERE id = ? AND prepare_owner = ? AND state = 'uploading'")
      .bind(JSON.stringify(progress), deployment.id, owner.id).run();
    if (!saved.meta.changes) throw new DeploymentError("deployment_conflict", "Preparation ownership was lost.");
    if (progress.next === progress.index.entries.length && progress.copyNext === progress.copies.length) {
      await authorize?.();
      await owner.assertActive();
      heartbeat?.assertActive();
      await sealDeployment(env.DB, deployment.id, new Date(), actor, deployment.mode === "merge" ? site.active_version_id ?? undefined : undefined);
    }
  } finally {
    heartbeat?.stop();
    try { if (lease) await releaseVersionLease(env.DB, lease); }
    finally { await unlockPreparation(env, deployment.id, owner); }
  }
}

export async function deploymentStatus(env: Env, deployment: SiteDeploymentRow): Promise<Record<string, unknown>> {
  const intent: DeploymentIntent = JSON.parse(deployment.input_json);
  const [catalog, archiveMissing] = await Promise.all([
    env.DB.prepare("SELECT path FROM site_version_files WHERE version_id = ? ORDER BY path")
      .bind(deployment.version_id).all<{ path: string }>(),
    deployment.state === "uploading" && intent.archive
      ? env.DB.prepare("SELECT id FROM storage_allocations WHERE deployment_id = ? AND kind = ? AND state = 'stored' LIMIT 1")
        .bind(deployment.id, `input:${ARCHIVE_PATH}`).first().then(archive => !archive)
      : false,
  ]);
  const files = catalog.results;
  const stored = new Set(files.map(file => file.path));
  const missing = intent.files?.filter(file => !stored.has(file.path)).map(file => file.path) ?? [];
  const receipt = deployment.receipt_json ? JSON.parse(deployment.receipt_json) : null;
  return {
    deployment_id: deployment.id, state: deployment.state, expected_version: deployment.base_generation,
    expires_at: deployment.deadline, status_url: `${publicOrigin(env)}/v1/sites/${deployment.site_id}/deployments/${deployment.id}`,
    progress: { stored_files: files.length, missing_paths: missing },
    next_action: deployment.state === "ready" ? "commit" : deployment.state === "uploading" ? missing.length || archiveMissing ? "upload" : "prepare" : null,
    ...(receipt ? { version_id: receipt.versionId, url: receipt.url, completed_at: receipt.committedAt, result_expires_at: deployment.receipt_expires_at } : {}),
  };
}

async function requireSession(env: Env, actor: Actor, siteId: string, id: string): Promise<SiteDeploymentRow> {
  const deployment = await getDeployment(env.DB, id);
  if (!deployment || deployment.site_id !== siteId) throw new DeploymentError("deployment_missing", "This deployment is no longer available.");
  if (deployment.owner_id !== actor.userId) throw new DeploymentError("deployment_forbidden", "This deployment belongs to another account.");
  if (deployment.receipt_expires_at && deployment.receipt_expires_at <= new Date().toISOString())
    throw new DeploymentError("deployment_expired", "This deployment receipt has expired.");
  return deployment;
}

async function verifyReplay(request: Request, file: DeploymentManifestFile, signal?: AbortSignal): Promise<void> {
  const digest = new crypto.DigestStream("SHA-256");
  let size = 0;
  const result = digest.digest.then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join(""));
  result.catch(() => undefined);
  const input = request.body ?? new Response("").body!;
  const body = signal ? abortableBody(input, signal) : input;
  await body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    size += chunk.length;
    if (size > file.size) throw new DeploymentError("invalid_intent", "Upload exceeds the declared length.");
    controller.enqueue(chunk);
  } })).pipeTo(digest);
  if (size !== file.size || await result !== file.sha256) throw new DeploymentError("invalid_intent", "Upload does not match the manifest.");
}

async function uploadFile(env: Env, deployment: SiteDeploymentRow, path: string, request: Request, actor: DeploymentAuthority, authorize?: () => Promise<void>): Promise<Response> {
  const intent: DeploymentIntent = JSON.parse(deployment.input_json);
  const file = intent.files?.find(file => file.path === path);
  if (!file) throw new DeploymentError("invalid_intent", "The path is not declared by this deployment.");
  const existing = await env.DB.prepare("SELECT path FROM site_version_files WHERE version_id = ? AND path = ?")
    .bind(deployment.version_id, path).first();
  if (existing) {
    await verifyReplay(request, file);
    await authorize?.();
    return secretJson({ path, stored: true }, 200);
  }
  const owner = await lockPreparation(env, deployment);
  try {
    const allocation = await inputAllocation(env, deployment, file);
    if (allocation.state === "stored") await verifyReplay(request, file, owner.signal);
    const result = allocation.state === "stored" ? { size: file.size, sha256: file.sha256 }
      : await writeAllocation(env.DB, env.BUCKET, allocation, abortableBody(request.body ?? new Response("").body!, owner.signal), file.sha256, file.contentType);
    await authorize?.();
    await owner.assertActive();
    await recordDeploymentFile(env.DB, deployment.id, { version_id: deployment.version_id, path,
      allocation_id: allocation.id, object_key: allocation.object_key!, size: result.size, sha256: result.sha256, content_type: file.contentType }, new Date(), actor);
    await owner.assertActive();
    return secretJson({ path, stored: true }, 201);
  } finally { await unlockPreparation(env, deployment.id, owner); }
}

export async function deploymentApi(request: Request, env: Env, actor: DeploymentAuthority, siteId: string, id?: string, action?: string, path?: string, authorize?: () => Promise<void>): Promise<Response> {
  try {
    await authorize?.();
    if (!id) {
      const site = await getSiteById(env, siteId);
      if (!site || site.lifecycle_state !== "live") throw new DeploymentError("deployment_missing", "Site not found.");
      assertCanMutate(actor, site);
      const body = await readJson(request);
      if (typeof body.expected_version !== "number") throw new DeploymentError("invalid_intent", "expected_version must be the site's content generation.");
      const intent = inputIntent(body);
      const policy = instancePolicy(env);
      if (intent.archive) {
        if (intent.archive.size > policy.zipBytes) throw tooLarge(intent.archive.size, publicOrigin(env), policy.zipBytes);
        if (body.archive && typeof body.archive === "object" && !("max_extracted_bytes" in body.archive)) intent.archive.maxExtractedBytes = policy.zipExtractedBytes;
        if (intent.archive.maxExtractedBytes > policy.zipExtractedBytes) throw new DeploymentError("invalid_intent", "Archive expansion exceeds the configured limit.");
      }
      for (const file of intent.files ?? []) if (file.size > policy.fileBytes) throw tooLarge(file.size, publicOrigin(env), policy.fileBytes);
      const key = String(body.idempotency_key ?? request.headers.get("idempotency-key") ?? "");
      const previous = await env.DB.prepare("SELECT id FROM site_deployments WHERE owner_id = ? AND site_id = ? AND idempotency_key = ?")
        .bind(actor.userId!, siteId, key).first();
      if (!previous) await ensureSiteSnapshotBaseline(env, site);
      const deployment = await createDeployment(env.DB, { siteId, ownerId: actor.userId!,
        baseGeneration: Number(body.expected_version), idempotencyKey: key, intent });
      await reserveInputs(env, deployment);
      return secretJson(await deploymentStatus(env, deployment), previous ? 200 : 201);
    }
    const deployment = await requireSession(env, actor, siteId, id);
    if (request.method === "GET") return secretJson(await deploymentStatus(env, deployment));
    if (request.method === "DELETE") {
      if (deployment.state === "committed") throw new DeploymentError("deployment_conflict", "A published deployment cannot be aborted.");
      const now = new Date();
      await env.DB.prepare(`UPDATE site_deployments SET state = 'aborted', terminal_at = ?, receipt_expires_at = ?
        WHERE id = ? AND state IN ('uploading', 'ready', 'preparing')`)
        .bind(now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString(), id).run();
      if ((await getDeployment(env.DB, id))?.state === "committed") throw new DeploymentError("deployment_conflict", "The deployment published before it could be aborted.");
      return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
    }
    if (action === "archive") return await uploadArchive(request, env, deployment, authorize);
    if (action === "files") return await uploadFile(env, deployment, path!, request, actor, authorize);
    if (action === "prepare") {
      if (JSON.parse(deployment.input_json).archive) await prepareArchive(env, deployment, actor, authorize);
      else {
        await authorize?.();
        await sealDeployment(env.DB, id, new Date(), actor);
      }
    } else if (action === "commit") {
      const site = await getSiteById(env, siteId);
      const url = site ? sitePublicUrl(env, site.handle, site.id, site.slug) : "";
      await commitDeployment(env.DB, id, actor, url);
    } else throw new DeploymentError("invalid_intent", "Unknown deployment action.");
    const updated = (await getDeployment(env.DB, id))!;
    return secretJson(await deploymentStatus(env, updated), action === "prepare" && updated.state !== "ready" ? 202 : 200);
  } catch (error) {
    if (!(error instanceof DeploymentError)) throw error;
    const status = error.code === "invalid_intent" ? 400 : error.code === "deployment_forbidden" ? 403
      : ["deployment_missing", "deployment_expired", "idempotency_expired"].includes(error.code) ? 410 : 409;
    return secretJson({ error: error.code, message: error.message }, status);
  }
}

export async function importSiteArchive(request: Request, env: Env, actor: Actor, siteId: string, _ctx?: ExecutionContext): Promise<Response> {
  const site = await getSiteById(env, siteId);
  if (!site) throw new ApiError(404, "site_not_found", "Site not found.");
  assertCanMutate(actor, site);
  const policy = instancePolicy(env);
  const upload = await readUpload(request, env, policy.zipBytes, publicOrigin(env));
  let adopted = false;
  let deployment: SiteDeploymentRow | null = null;
  const asynchronous = request.headers.get("prefer")?.split(",").map(value => value.trim()).includes("respond-async");
  try {
    let sha256: string;
    if (upload.allocationId) {
      const allocation = await env.DB.prepare("SELECT result_sha256 FROM storage_allocations WHERE id = ?").bind(upload.allocationId)
        .first<{ result_sha256: string }>();
      if (!allocation?.result_sha256) throw new Error("Staged archive checksum is missing");
      sha256 = allocation.result_sha256;
    } else {
      const bytes = await new Response(upload.body).arrayBuffer();
      sha256 = await sha256OfBytes(new Uint8Array(bytes));
    }
    const idempotencyKey = request.headers.get("idempotency-key") ?? `${Date.now()}.${crypto.randomUUID()}`;
    const previous = await env.DB.prepare("SELECT * FROM site_deployments WHERE owner_id = ? AND site_id = ? AND idempotency_key = ?")
      .bind(actor.userId!, siteId, idempotencyKey).first<SiteDeploymentRow>();
    if (!previous) await ensureSiteSnapshotBaseline(env, site);
    deployment = await createDeployment(env.DB, { siteId, ownerId: actor.userId!, baseGeneration: previous?.base_generation ?? site.content_generation ?? 0,
      idempotencyKey, intent: { mode: "merge", archive: { size: upload.size, sha256, maxExtractedBytes: policy.zipExtractedBytes, maxFiles: 200 } } });
    if (deployment.state === "uploading") {
      const owner = await lockPreparation(env, deployment);
      try {
        const existing = await env.DB.prepare("SELECT id FROM storage_allocations WHERE deployment_id = ? AND kind = ? AND state = 'stored'")
          .bind(deployment.id, `input:${ARCHIVE_PATH}`).first();
        if (!existing) {
          if (upload.allocationId) {
            await env.DB.prepare("UPDATE storage_allocations SET owner_id = ?, site_id = ?, version_id = ?, deployment_id = ?, kind = ? WHERE id = ? AND state = 'stored'")
              .bind(actor.userId!, siteId, deployment.version_id, deployment.id, `input:${ARCHIVE_PATH}`, upload.allocationId).run();
            adopted = true;
          } else {
            const allocation = await inputAllocation(env, deployment, { path: ARCHIVE_PATH, size: upload.size });
            await writeAllocation(env.DB, env.BUCKET, allocation, abortableBody(new Response(upload.body).body!, owner.signal), sha256, "application/zip");
          }
        }
        await owner.assertActive();
      } finally { await unlockPreparation(env, deployment.id, owner); }
    }
    if (asynchronous) {
      const status = await deploymentStatus(env, deployment);
      if (new URL(request.url).pathname.startsWith("/account/")) status.status_url = new URL(String(status.status_url)).pathname.replace("/v1/", "/account/");
      return secretJson(status, deployment.state === "committed" ? 200 : 202);
    }
    while (deployment.state === "uploading") {
      await prepareArchive(env, deployment, actor);
      deployment = (await getDeployment(env.DB, deployment.id))!;
    }
    await commitDeployment(env.DB, deployment.id, actor, sitePublicUrl(env, site.handle, site.id, site.slug));
    const progress: ArchiveProgress | null = deployment.prepare_cursor ? JSON.parse(deployment.prepare_cursor) : null;
    return secretJson({ id: siteId, slug: site.slug, url: sitePublicUrl(env, site.handle, site.id, site.slug), written: progress?.index.entries.map(entry => entry.path) ?? [] });
  } catch (error) {
    if (deployment && !asynchronous) {
      const permanent = error instanceof ApiError && ["invalid_zip", "bad_zip_path", "empty_zip", "too_many_files", "too_large"].includes(error.code);
      const now = new Date();
      await env.DB.prepare(`UPDATE site_deployments SET last_error = ?,
        state = CASE WHEN ? THEN 'failed' ELSE state END,
        terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END,
        receipt_expires_at = CASE WHEN ? THEN ? ELSE receipt_expires_at END
        WHERE id = ? AND state IN ('uploading', 'ready')`)
        .bind(error instanceof Error ? error.message : String(error), Number(permanent), Number(permanent), now.toISOString(), Number(permanent),
          new Date(now.getTime() + 7 * 86_400_000).toISOString(), deployment.id).run()
        .catch(recordError => console.error("Import error receipt pending", recordError));
    }
    if (error instanceof DeploymentError) throw new ApiError(409, "site_busy", error.message);
    throw error;
  } finally {
    if (upload.allocationId && !adopted) await cleanupAllocation(env.DB, env.BUCKET, upload.allocationId).catch(error => console.error("Archive cleanup pending", error));
  }
}
