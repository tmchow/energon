import { MAX_IMPORT_FILES, siteKey } from "./config";
import { ApiError } from "./http";
import { instancePolicy } from "./policy";
import { commitDeployment, createDeployment, DeploymentError, recordDeploymentFile, sealDeployment, type DeploymentAuthority } from "./site-deployments";
import { acquireVersionLease, releaseVersionLease, reserveAllocation, startVersionLeaseHeartbeat, writeAllocation } from "./site-storage";
import type { Env, SiteRow } from "./types";
import { abortableBody, type Upload } from "./upload";
import { ensureLegacyReadVersion, ensureSiteSnapshotBaseline } from "./site-version-migrate";
import { grantCommitFailure } from "./grant-guard";

type SnapshotFile = { path: string; size: number; content_type: string; object_key: string; sha256?: string };
export type SiteChange = { path: string; upload: Upload; contentType: string } | { path: string; delete: true };

export async function snapshotFiles(env: Env, site: SiteRow): Promise<SnapshotFile[]> {
  await ensureSiteSnapshotBaseline(env, site);
  if (site.active_version_id) return (await env.DB.prepare("SELECT path, size, content_type, object_key, sha256 FROM site_version_files WHERE version_id = ? ORDER BY path")
    .bind(site.active_version_id).all<SnapshotFile>()).results;
  return (await env.DB.prepare("SELECT path, size, content_type FROM site_files WHERE site_id = ? ORDER BY path")
    .bind(site.id).all<SnapshotFile>()).results.map(file => ({ ...file, object_key: siteKey(site.handle, site.id, file.path) }));
}

export async function publishSiteChanges(env: Env, site: SiteRow, actor: DeploymentAuthority, changes: SiteChange[], url: string, sourceSignal?: AbortSignal): Promise<void> {
  const lease = site.lifecycle_state === "creating" ? null : await acquireVersionLease(env.DB,
    site.active_version_id ?? await ensureLegacyReadVersion(env.DB, site), "copy");
  const controller = new AbortController();
  const abortFromSource = () => controller.abort(sourceSignal!.reason);
  sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  if (sourceSignal?.aborted) abortFromSource();
  const assertActive = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  const heartbeat = lease ? startVersionLeaseHeartbeat(env.DB, lease, error => controller.abort(error)) : null;
  let deploymentId: string | undefined;
  try {
    assertActive();
    const previous = await snapshotFiles(env, site);
    const files = new Map<string, SnapshotFile | Extract<SiteChange, { upload: Upload }>>(previous.map(file => [file.path, file]));
    for (const change of changes) {
      if ("delete" in change) files.delete(change.path);
      else files.set(change.path, change);
    }
    if (files.size > MAX_IMPORT_FILES && files.size > previous.length)
      throw new ApiError(400, "too_many_files", `Sites accept at most ${MAX_IMPORT_FILES} files.`);
    const deployment = await createDeployment(env.DB, { siteId: site.id, ownerId: actor.userId ?? site.owner_id!,
      baseGeneration: site.content_generation ?? 0, idempotencyKey: `${Date.now()}.${crypto.randomUUID()}`, intent: { mode: "merge", files: [] }, allowHidden: actor.activateHidden });
    deploymentId = deployment.id;
    const allocations = [];
    for (const file of files.values()) {
      const allocation = await reserveAllocation(env.DB, { ownerId: deployment.owner_id, siteId: actor.activateHidden ? undefined : site.id,
        versionId: deployment.version_id, deploymentId: deployment.id, kind: "candidate",
        bytes: "upload" in file ? file.upload.size : file.size, cap: instancePolicy(env).platformBytes,
        key: `site-versions/${site.id}/${deployment.version_id}/${crypto.randomUUID()}` });
      allocations.push({ file, allocation });
    }
    for (const { file, allocation } of allocations) {
      assertActive();
      let body: ReadableStream<Uint8Array>;
      if ("upload" in file && file.upload.stagedKey === undefined) body = new Response(file.upload.body).body!;
      else {
        const key = "upload" in file ? file.upload.stagedKey! : file.object_key;
        const object = await env.BUCKET.get(key);
        if (!object) throw new ApiError(500, "export_failed", `Site file '${file.path}' is missing from storage.`);
        body = object.body;
      }
      const contentType = "upload" in file ? file.contentType : file.content_type;
      const result = await writeAllocation(env.DB, env.BUCKET, allocation,
        abortableBody(body, controller.signal),
        "upload" in file ? undefined : file.sha256, contentType);
      assertActive();
      await recordDeploymentFile(env.DB, deployment.id, { version_id: deployment.version_id, path: file.path,
        allocation_id: allocation.id, object_key: allocation.object_key!, size: result.size, sha256: result.sha256, content_type: contentType });
    }
    assertActive();
    await sealDeployment(env.DB, deployment.id, new Date(), undefined,
      previous.length > MAX_IMPORT_FILES ? site.active_version_id ?? undefined : undefined);
    assertActive();
    await commitDeployment(env.DB, deployment.id, actor, url);
  } catch (error) {
    if (deploymentId) {
      const now = new Date();
      await env.DB.prepare(`UPDATE site_deployments SET state = 'failed', terminal_at = ?, receipt_expires_at = ?
        WHERE id = ? AND state NOT IN ('committed', 'committing')`)
        .bind(now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString(), deploymentId).run()
        .catch(failure => console.error("Deployment cleanup pending", deploymentId, failure));
    }
    if (actor.legacyGrant) {
      const failure = await grantCommitFailure(env, actor.legacyGrant);
      if (failure) throw failure;
    }
    if (error instanceof DeploymentError) throw new ApiError(error.code === "deployment_forbidden" ? 403 : 409,
      error.code === "deployment_forbidden" ? "forbidden_write" : "site_busy", error.message);
    throw error;
  } finally {
    heartbeat?.stop();
    sourceSignal?.removeEventListener("abort", abortFromSource);
    if (lease) await releaseVersionLease(env.DB, lease);
  }
}
