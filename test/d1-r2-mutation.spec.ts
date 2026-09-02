import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { auth, json, mint } from "./helpers";
import { mutationSnapshotSummary, snapshotLooseFileMutation, withMutationLog } from "./mutation-harness";

describe("D1/R2 mutation integrity", () => {
  it("keeps catalog, object keys, and quota aligned across rename and delete", async () => {
    await withMutationLog("loose-file-rename-delete", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("d1-r2-mutation");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "before.txt", "content-type": "text/plain" }),
        body: "before",
      });
      expect(created.status).toBe(201);

      const id = String(created.body.id);
      const initial = await snapshotLooseFileMutation(env, id);
      log.snapshot("setup", "created", mutationSnapshotSummary(initial));
      expect(initial.file).toMatchObject({
        filename: "before.txt",
        size: 6,
        content_type: "text/plain; charset=utf-8",
        last_written_by: "ada@esperlabs.app",
      });
      expect(initial.objects).toEqual([
        expect.objectContaining({
          key: `files/${id}/before.txt`,
          size: 6,
          body: Array.from(new TextEncoder().encode("before")),
          http_metadata: expect.objectContaining({ content_type: "text/plain; charset=utf-8" }),
        }),
      ]);
      expect(initial.quota_used).toBe(6);
      expect(initial.catalog_bytes).toBe(6);

      log.write("act", "phase_start", { mutation: "rename" });
      const replaced = await json(`/v1/files/${id}`, {
        method: "PUT",
        headers: auth(token, { "X-Filename": "after.txt", "content-type": "text/plain" }),
        body: "replacement",
      });
      expect(replaced.status).toBe(200);

      const renamed = await snapshotLooseFileMutation(env, id);
      log.snapshot("assert", "renamed", mutationSnapshotSummary(renamed));
      expect(renamed.file).toMatchObject({
        filename: "after.txt",
        size: 11,
        content_type: "text/plain; charset=utf-8",
        last_written_by: "ada@esperlabs.app",
      });
      expect(renamed.objects).toEqual([
        expect.objectContaining({
          key: `files/${id}/after.txt`,
          size: 11,
          body: Array.from(new TextEncoder().encode("replacement")),
          http_metadata: expect.objectContaining({ content_type: "text/plain; charset=utf-8" }),
        }),
      ]);
      expect(renamed.quota_used).toBe(11);
      expect(renamed.catalog_bytes).toBe(11);

      log.write("act", "phase_start", { mutation: "delete" });
      const deleteResponse = await json(`/v1/files/${id}`, { method: "DELETE", headers: auth(token) });
      expect(deleteResponse.status).toBe(200);

      const deleted = await snapshotLooseFileMutation(env, id);
      log.snapshot("assert", "deleted", mutationSnapshotSummary(deleted));
      expect(deleted.file).toBeNull();
      expect(deleted.objects).toEqual([]);
      expect(deleted.quota_used).toBe(0);
      expect(deleted.catalog_bytes).toBe(0);
    });
  });
});
