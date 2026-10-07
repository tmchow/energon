import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nowIso } from "../src/config";
import { WRITE_CLAIM } from "../src/expire";
import { putLooseFile } from "../src/files";
import type { Actor, Env } from "../src/types";
import { uploadFromBytes } from "../src/upload";
import { auth, json, mint } from "./helpers";
import {
  mutationSnapshotSummary,
  snapshotLooseFileMutation,
  withD1Trigger,
  withMutationLog,
} from "./mutation-harness";

describe("mock-free mutation claim ownership", () => {
  it("restores the claim timestamp and bytes when a native D1 replacement aborts", async () => {
    await withMutationLog("replacement-claim-native-d1-abort", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("replacement-claim-native-d1-abort");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "replace-abort.txt", "content-type": "text/plain" }),
        body: "original",
      });
      expect(created.status).toBe(201);
      const id = String(created.body.id);
      const before = await snapshotLooseFileMutation(env, id);
      log.snapshot("setup", "before", mutationSnapshotSummary(before));

      const response = await withD1Trigger(
        env.DB,
        "fail_native_loose_file_replace",
        `CREATE TRIGGER fail_native_loose_file_replace
         BEFORE UPDATE OF size ON loose_files
         WHEN OLD.id = '${id}' AND NEW.size = 11
         BEGIN
           SELECT RAISE(ABORT, 'test loose file replacement abort');
         END`,
        async () => {
          log.write("act", "phase_start", { mutation: "replace", failure: "native_d1_abort" });
          return json(`/v1/files/${id}`, {
            method: "PUT",
            headers: auth(token, { "X-Filename": "replace-abort.txt", "content-type": "text/plain" }),
            body: "replacement",
          });
        },
      );
      expect(response.status).toBe(500);

      const after = await snapshotLooseFileMutation(env, id);
      log.snapshot("assert", "after", mutationSnapshotSummary(after));
      expect(after).toEqual(before);
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });

  it("restores the write claim and object when a native D1 delete aborts after R2 deletion", async () => {
    await withMutationLog("delete-claim-native-d1-abort", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("delete-claim-native-d1-abort");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "delete-abort.txt", "content-type": "text/plain" }),
        body: "preserve",
      });
      expect(created.status).toBe(201);
      const id = String(created.body.id);
      const before = await snapshotLooseFileMutation(env, id);
      log.snapshot("setup", "before", mutationSnapshotSummary(before));

      const response = await withD1Trigger(
        env.DB,
        "fail_native_loose_file_delete",
        `CREATE TRIGGER fail_native_loose_file_delete
         BEFORE DELETE ON loose_files
         WHEN OLD.id = '${id}'
         BEGIN
           SELECT RAISE(ABORT, 'test loose file delete abort');
         END`,
        async () => {
          log.write("act", "phase_start", { mutation: "delete", failure: "native_d1_abort" });
          return json(`/v1/files/${id}`, { method: "DELETE", headers: auth(token) });
        },
      );
      expect(response.status).toBe(500);

      const after = await snapshotLooseFileMutation(env, id);
      log.snapshot("assert", "after", mutationSnapshotSummary(after));
      expect(after).toEqual(before);
      expect(after.file?.last_written_by).toBe("ada@esperlabs.app");
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });

  it("blocks a fresh write claim and reclaims the same claim after it becomes stale", async () => {
    await withMutationLog("write-claim-fresh-stale", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("write-claim-fresh-stale");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "claimed.txt", "content-type": "text/plain" }),
        body: "original",
      });
      expect(created.status).toBe(201);
      const id = String(created.body.id);
      const claim = `${WRITE_CLAIM}:real-binding-test`;
      await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
        .bind(claim, nowIso(), id)
        .run();
      const fresh = await snapshotLooseFileMutation(env, id);
      log.snapshot("setup", "fresh_claim", mutationSnapshotSummary(fresh));

      log.write("act", "phase_start", { mutation: "replace", claim_age: "fresh" });
      const blocked = await json(`/v1/files/${id}`, {
        method: "PUT",
        headers: auth(token, { "X-Filename": "claimed.txt", "content-type": "text/plain" }),
        body: "blocked replacement",
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("file_busy");
      expect(await snapshotLooseFileMutation(env, id)).toEqual(fresh);

      await env.DB.prepare(`UPDATE loose_files SET updated_at = ? WHERE id = ?`)
        .bind("2000-01-01T00:00:00.000Z", id)
        .run();
      log.write("act", "phase_start", { mutation: "replace", claim_age: "stale" });
      const replaced = await json(`/v1/files/${id}`, {
        method: "PUT",
        headers: auth(token, { "X-Filename": "reclaimed.txt", "content-type": "text/plain" }),
        body: "reclaimed",
      });
      expect(replaced.status).toBe(200);

      const after = await snapshotLooseFileMutation(env, id);
      log.snapshot("assert", "reclaimed", mutationSnapshotSummary(after));
      expect(after.file).toMatchObject({
        filename: "reclaimed.txt",
        size: 9,
        last_written_by: "ada@esperlabs.app",
      });
      expect(after.objects).toEqual([
        expect.objectContaining({
          key: `files/${id}/reclaimed.txt`,
          body: Array.from(new TextEncoder().encode("reclaimed")),
        }),
      ]);
      expect(after.quota_used).toBe(after.catalog_bytes);
    });
  });

  it("allows only coherent outcomes for competing real replacement requests", async () => {
    await withMutationLog("concurrent-replacement-allowed-outcomes", async (log) => {
      log.write("setup", "phase_start");
      const token = await mint("concurrent-replacement");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "start.txt", "content-type": "text/plain" }),
        body: "start",
      });
      expect(created.status).toBe(201);
      const id = String(created.body.id);

      for (let iteration = 0; iteration < 8; iteration += 1) {
        const left = { filename: `left-${iteration}.txt`, body: `left-body-${iteration}` };
        const right = { filename: `right-${iteration}.txt`, body: `right-body-${iteration}` };
        log.write("act", "concurrent_requests", { iteration, operations: [left.filename, right.filename] });
        const responses = await Promise.all([
          json(`/v1/files/${id}`, {
            method: "PUT",
            headers: auth(token, { "X-Filename": left.filename, "content-type": "text/plain" }),
            body: left.body,
          }),
          json(`/v1/files/${id}`, {
            method: "PUT",
            headers: auth(token, { "X-Filename": right.filename, "content-type": "text/plain" }),
            body: right.body,
          }),
        ]);
        const statuses = responses.map((response) => response.status).sort();
        expect([[200, 200], [200, 409]]).toContainEqual(statuses);

        const after = await snapshotLooseFileMutation(env, id);
        log.snapshot("assert", `iteration_${iteration}`, mutationSnapshotSummary(after));
        const winner = [left, right].find((candidate) => candidate.filename === after.file?.filename);
        expect(winner).toBeDefined();
        expect(after.file?.last_written_by).toBe("ada@esperlabs.app");
        expect(after.objects).toEqual([
          expect.objectContaining({
            key: `files/${id}/${winner!.filename}`,
            body: Array.from(new TextEncoder().encode(winner!.body)),
          }),
        ]);
        expect(after.quota_used).toBe(after.catalog_bytes);
      }
    });
  });
});

describe("loose-file replacement rollback with faults injected around real D1 and R2", () => {
  const actor: Actor = { email: "ada@esperlabs.app", via: "token" };
  const encode = (text: string) => new TextEncoder().encode(text);

  async function createLooseFile(label: string, filename: string): Promise<string> {
    const token = await mint(label);
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": filename, "content-type": "text/plain" }),
      body: "original",
    });
    expect(created.status).toBe(201);
    return String(created.body.id);
  }

  function reservationState(id: string): Promise<string | null> {
    return env.DB.prepare(
      `SELECT state FROM storage_allocations
       WHERE kind = 'legacy_reservation' AND json_extract(recovery_json, '$.fileId') = ? AND json_extract(recovery_json, '$.operation') = 'replace'`,
    ).bind(id).first<string>("state");
  }

  it("keeps a committed replacement when the D1 commit response is lost", async () => {
    const id = await createLooseFile("replace-commit-response-lost", "lost.txt");
    const lost = new Error("injected lost D1 commit response");
    const db = new Proxy(env.DB, {
      get(target, prop) {
        // The catalog commit is the only three-statement batch in a same-name replacement.
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (statements.length === 3) throw lost;
            return result;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      putLooseFile({ ...env, DB: db } as Env, undefined, actor, id, uploadFromBytes(encode("replacement")), "lost.txt", "text/plain"),
    ).rejects.toBe(lost);

    const after = await snapshotLooseFileMutation(env, id);
    expect(after.file?.size).toBe(11);
    expect(after.objects).toEqual([
      expect.objectContaining({ key: `files/${id}/lost.txt`, body: Array.from(encode("replacement")) }),
    ]);
    expect(after.quota_used).toBe(after.catalog_bytes);
    expect(await reservationState(id)).toBe("released");
  });

  it("holds the reservation as uncertain and rethrows the write error when restoring the old bytes fails", async () => {
    const id = await createLooseFile("replace-restore-fails", "restore.txt");
    const key = `files/${id}/restore.txt`;
    const before = await snapshotLooseFileMutation(env, id);
    let puts = 0;
    const bucket = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === "put") {
          return async (objectKey: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
            if (objectKey === key && ++puts === 2) throw new Error("injected R2 restore failure");
            return target.put(objectKey, value, options);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await withD1Trigger(
      env.DB,
      "fail_restore_loose_file_replace",
      `CREATE TRIGGER fail_restore_loose_file_replace
       BEFORE UPDATE OF size ON loose_files
       WHEN OLD.id = '${id}' AND NEW.size = 11
       BEGIN
         SELECT RAISE(ABORT, 'test loose file replacement abort before restore');
       END`,
      () =>
        expect(
          putLooseFile({ ...env, BUCKET: bucket } as Env, undefined, actor, id, uploadFromBytes(encode("replacement")), "restore.txt", "text/plain"),
        ).rejects.toThrow("test loose file replacement abort before restore"),
    );

    expect(puts).toBe(2);
    const after = await snapshotLooseFileMutation(env, id);
    expect(after.file).toEqual(before.file);
    expect(await reservationState(id)).toBe("uncertain");
  });
});
