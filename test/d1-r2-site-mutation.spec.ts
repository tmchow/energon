import { env } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { totalStoredBytes } from "../src/http";
import { sweepSiteStorage } from "../src/site-storage";
import { auth, json, mint, req } from "./helpers";
import { createSiteFixture, snapshotR2Prefix, withD1Trigger, withMutationLog } from "./mutation-harness";

async function snapshotPublished(siteId: string) {
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(siteId).first<{ active_version_id: string }>();
  const files = (await env.DB.prepare("SELECT * FROM site_version_files WHERE version_id = ? ORDER BY path")
    .bind(site!.active_version_id).all()).results;
  const keys = new Set(files.map(file => file.object_key));
  const objects = (await snapshotR2Prefix(env.BUCKET, `site-versions/${siteId}/${site!.active_version_id}/`)).filter(object => keys.has(object.key));
  return { site, files, objects };
}
async function allocations(siteId: string) {
  return (await env.DB.prepare("SELECT id, object_key, reserved_bytes, state FROM storage_allocations WHERE site_id = ? ORDER BY id")
    .bind(siteId).all<{ id: string; object_key: string; reserved_bytes: number; state: string }>()).results;
}
async function used() {
  return Number((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())!.used);
}
async function verifyRetainedFailure(siteId: string, before: Awaited<ReturnType<typeof snapshotPublished>>, beforeAllocations: Awaited<ReturnType<typeof allocations>>, beforeUsed: number) {
  expect(await snapshotPublished(siteId)).toEqual(before);
  const previous = new Set(beforeAllocations.map(allocation => allocation.id));
  const added = (await allocations(siteId)).filter(allocation => !previous.has(allocation.id));
  expect(added.length).toBeGreaterThan(0);
  const charged = added.filter(allocation => allocation.state !== "released");
  expect(charged.length).toBeGreaterThan(0);
  expect(await used()).toBe(beforeUsed + charged.reduce((sum, allocation) => sum + allocation.reserved_bytes, 0));
  expect(await used()).toBe(await totalStoredBytes(env.DB));
  for (let pass = 0; pass < 4; pass++) {
    await sweepSiteStorage(env.DB, env.BUCKET);
    const remaining = (await allocations(siteId)).filter(allocation => added.some(item => item.id === allocation.id) && allocation.state !== "released");
    if (!remaining.length) break;
  }
  for (const allocation of added) {
    expect((await env.DB.prepare("SELECT state FROM storage_allocations WHERE id = ?").bind(allocation.id).first())?.state).toBe("released");
    expect(await env.BUCKET.head(allocation.object_key)).toBeNull();
  }
  expect(await snapshotPublished(siteId)).toEqual(before);
  expect(await used()).toBe(await totalStoredBytes(env.DB));
}

describe("mock-free site mutation integrity", () => {
  it("preserves the published version when a native catalog insert aborts after the candidate R2 write", async () => {
    await withMutationLog("site-file-native-d1-abort", async log => {
      const token = await mint("site-file-native-d1-abort");
      const fixture = await createSiteFixture(token, "native-abort-put", { "index.html": "original" });
      const before = await snapshotPublished(fixture.id), beforeAllocations = await allocations(fixture.id), beforeUsed = await used();
      log.snapshot("setup", "before", { version: before.site?.active_version_id, files: before.files.length, objects: before.objects.length, used: beforeUsed });
      const response = await withD1Trigger(env.DB, "fail_native_site_file_insert", `CREATE TRIGGER fail_native_site_file_insert
        BEFORE INSERT ON site_version_files
        WHEN NEW.path = 'index.html' AND NEW.size = 11 AND EXISTS (SELECT 1 FROM site_versions WHERE id = NEW.version_id AND site_id = '${fixture.id}')
        BEGIN SELECT RAISE(ABORT, 'test native D1 abort'); END`, () => json(`/v1/sites/${fixture.id}/files/index.html`, {
          method: "PUT", headers: auth(token), body: "replacement",
        }));
      expect(response.status).toBe(500);
      await verifyRetainedFailure(fixture.id, before, beforeAllocations, beforeUsed);
      log.write("assert", "published_version_preserved_and_failed_candidate_reclaimed");
    });
  });

  it("preserves all 50 published paths when the final pointer transaction aborts", async () => {
    await withMutationLog("site-import-batch-edge-native-d1-abort", async log => {
      const token = await mint("site-import-batch-edge");
      const fixture = await createSiteFixture(token, "batch-edge-import");
      const original = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`path-${String(i).padStart(2, "0")}.txt`, strToU8(`old-${i}`)]));
      expect((await json(`/v1/sites/${fixture.id}/import`, { method: "POST", headers: auth(token), body: zipSync(original) })).status).toBe(200);
      await sweepSiteStorage(env.DB, env.BUCKET);
      const before = await snapshotPublished(fixture.id), beforeAllocations = await allocations(fixture.id), beforeUsed = await used();
      log.snapshot("setup", "before", { version: before.site?.active_version_id, files: before.files.length, objects: before.objects.length, used: beforeUsed });
      const replacement = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`path-${String(i).padStart(2, "0")}.txt`, strToU8(`replacement-${i}`)]));
      const response = await withD1Trigger(env.DB, "fail_native_site_finalization", `CREATE TRIGGER fail_native_site_finalization
        BEFORE UPDATE OF active_version_id ON sites WHEN OLD.id = '${fixture.id}' AND NEW.active_version_id != OLD.active_version_id
        BEGIN SELECT RAISE(ABORT, 'test final site pointer abort'); END`, () => json(`/v1/sites/${fixture.id}/import`, {
          method: "POST", headers: auth(token), body: zipSync(replacement),
        }));
      expect(response.status).toBe(500);
      expect(before.files).toHaveLength(50);
      expect(before.objects).toHaveLength(50);
      const pending = await env.DB.prepare("SELECT id, state FROM site_deployments WHERE site_id = ? AND state = 'ready'")
        .bind(fixture.id).first<{ id: string; state: string }>();
      expect(pending?.state).toBe("ready");
      const retained = await allocations(fixture.id);
      await sweepSiteStorage(env.DB, env.BUCKET);
      expect(await allocations(fixture.id)).toEqual(retained);
      expect(await snapshotPublished(fixture.id)).toEqual(before);
      expect((await req(`/v1/sites/${fixture.id}/deployments/${pending!.id}`, { method: "DELETE", headers: auth(token) })).status).toBe(204);
      await verifyRetainedFailure(fixture.id, before, beforeAllocations, beforeUsed);
      log.write("assert", "all_50_paths_preserved_and_aborted_candidate_reclaimed");
    });
  });

  it("preserves the live pointer and all bytes when the deletion tombstone aborts", async () => {
    await withMutationLog("site-delete-native-d1-abort", async log => {
      const token = await mint("site-delete-native-abort");
      const fixture = await createSiteFixture(token, "delete-tombstone-abort", {
        "index.html": "<h1>original</h1>", "app.css": "body { color: teal; }", "notes.txt": "preserve me",
      });
      const before = await snapshotPublished(fixture.id), beforeAllocations = await allocations(fixture.id), beforeUsed = await used();
      log.snapshot("setup", "before", { version: before.site?.active_version_id, files: before.files.length, objects: before.objects.length, used: beforeUsed });
      const response = await withD1Trigger(env.DB, "fail_native_site_delete", `CREATE TRIGGER fail_native_site_delete
        BEFORE UPDATE OF lifecycle_state ON sites WHEN OLD.id = '${fixture.id}' AND NEW.lifecycle_state = 'deleted'
        BEGIN SELECT RAISE(ABORT, 'test site tombstone abort'); END`, () => json(`/v1/sites/${fixture.id}`, { method: "DELETE", headers: auth(token) }));
      expect(response.status).toBe(500);
      expect(await snapshotPublished(fixture.id)).toEqual(before);
      expect(await allocations(fixture.id)).toEqual(beforeAllocations);
      expect(await used()).toBe(beforeUsed);
      expect(await used()).toBe(await totalStoredBytes(env.DB));
      log.write("assert", "tombstone_rolled_back_without_deleting_bytes");
    });
  });
});
