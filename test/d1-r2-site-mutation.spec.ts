import { env } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { auth, json, mint } from "./helpers";
import {
  createSiteFixture,
  mutationSnapshotSummary,
  snapshotSiteMutation,
  withD1Trigger,
  withMutationLog,
} from "./mutation-harness";

describe("mock-free site mutation integrity", () => {
  it("restores a site file after a native D1 abort follows the R2 write", async () => {
    await withMutationLog("site-file-native-d1-abort", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("site-file-native-d1-abort");
      const slug = "native-abort-put";
      await createSiteFixture(token, slug, { "index.html": "original" });
      const before = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("setup", "before", mutationSnapshotSummary(before));

      const response = await withD1Trigger(
        env.DB,
        "fail_native_site_file_update",
        `CREATE TRIGGER fail_native_site_file_update
         BEFORE UPDATE OF size ON site_files
         WHEN NEW.slug = '${slug}' AND NEW.path = 'index.html' AND NEW.size = 11
         BEGIN
           SELECT RAISE(ABORT, 'test native D1 abort');
         END`,
        async () => {
          log.write("act", "phase_start", { mutation: "site_file_replace", failure: "native_d1_abort" });
          return json(`/v1/sites/${slug}/files/index.html`, {
            method: "PUT",
            headers: auth(token),
            body: "replacement",
          });
        },
      );
      expect(response.status).toBe(500);

      const after = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("assert", "after", mutationSnapshotSummary(after));
      expect(after).toEqual(before);
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });

  it("restores all 50 paths when final import metadata aborts across the D1 batch edge", async () => {
    await withMutationLog("site-import-batch-edge-native-d1-abort", async (log) => {
      log.write("setup", "phase_start", { paths: 50 });
      const token = await mint("site-import-batch-edge");
      const slug = "batch-edge-import";
      await createSiteFixture(token, slug);
      const originalFiles = Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [`path-${index.toString().padStart(2, "0")}.txt`, strToU8(`old-${index}`)]),
      );
      const initialImport = await json(`/v1/sites/${slug}/import`, {
        method: "POST",
        headers: auth(token, { "content-type": "application/zip" }),
        body: zipSync(originalFiles),
      });
      expect(initialImport.status).toBe(200);
      await env.DB.prepare(`UPDATE sites SET last_written_by = ? WHERE handle = ? AND slug = ?`)
        .bind("baseline-writer@esperlabs.app", "ada", slug)
        .run();

      const before = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("setup", "before", mutationSnapshotSummary(before));
      const replacementFiles = Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [`path-${index.toString().padStart(2, "0")}.txt`, strToU8(`replacement-${index}`)]),
      );

      const response = await withD1Trigger(
        env.DB,
        "fail_native_site_finalization",
        `CREATE TRIGGER fail_native_site_finalization
         BEFORE UPDATE OF last_written_by ON sites
         WHEN NEW.slug = '${slug}'
           AND OLD.last_written_by = 'baseline-writer@esperlabs.app'
           AND NEW.last_written_by = 'ada@esperlabs.app'
         BEGIN
           SELECT RAISE(ABORT, 'test final site metadata abort');
         END`,
        async () => {
          log.write("act", "phase_start", { mutation: "site_import", paths: 50, failure: "native_d1_abort" });
          return json(`/v1/sites/${slug}/import`, {
            method: "POST",
            headers: auth(token, { "content-type": "application/zip" }),
            body: zipSync(replacementFiles),
          });
        },
      );
      expect(response.status).toBe(500);

      const after = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("assert", "after", mutationSnapshotSummary(after));
      expect(after).toEqual(before);
      expect(after.files).toHaveLength(50);
      expect(after.backup_objects).toEqual([]);
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });

  it("restores a deleted site and removes every integrity backup after a native D1 abort", async () => {
    await withMutationLog("site-delete-backup-native-d1-abort", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("site-delete-backup-abort");
      const slug = "delete-backup-abort";
      await createSiteFixture(token, slug, {
        "index.html": "<h1>original</h1>",
        "app.css": "body { color: teal; }",
        "notes.txt": "preserve me",
      });
      const before = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("setup", "before", mutationSnapshotSummary(before));

      const response = await withD1Trigger(
        env.DB,
        "fail_native_site_delete",
        `CREATE TRIGGER fail_native_site_delete
         BEFORE DELETE ON sites
         WHEN OLD.slug = '${slug}'
         BEGIN
           SELECT RAISE(ABORT, 'test site delete abort');
         END`,
        async () => {
          log.write("act", "phase_start", { mutation: "site_delete", failure: "native_d1_abort" });
          return json(`/v1/sites/${slug}`, { method: "DELETE", headers: auth(token) });
        },
      );
      expect(response.status).toBe(500);

      const after = await snapshotSiteMutation(env, "ada", slug);
      log.snapshot("assert", "after", mutationSnapshotSummary(after));
      expect(after).toEqual(before);
      expect(after.backup_objects).toEqual([]);
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });
});
