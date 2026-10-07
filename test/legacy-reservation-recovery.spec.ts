import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { ensureSchema } from "../src/db";
import { createLooseFile, putLooseFile } from "../src/files";
import { recomputeStorage } from "../src/http";
import { sweepLegacyReservations } from "../src/site-storage";
import { uploadFromBytes } from "../src/upload";
import type { Actor } from "../src/types";

const actor: Actor = { email: "recovery@esperlabs.app", via: "access" };
const upload = (value: string) => uploadFromBytes(new TextEncoder().encode(value));

it("keeps an uncertain orphan deletion charged and diagnostic on sweep", async () => {
  await ensureSchema(env.DB);
  const before = (await recomputeStorage(env.DB)).after;
  await env.DB.prepare(`CREATE TRIGGER fail_recovery_insert BEFORE INSERT ON loose_files
    WHEN NEW.filename = 'orphan.txt' BEGIN SELECT RAISE(ABORT, 'injected catalog failure'); END`).run();
  const originalDelete = env.BUCKET.delete.bind(env.BUCKET);
  env.BUCKET.delete = async () => { throw new Error("injected delete failure"); };
  try {
    await expect(createLooseFile(env, undefined, actor, "orphan.txt", upload("orphan"), "text/plain")).rejects.toThrow();
  } finally {
    env.BUCKET.delete = originalDelete;
    await env.DB.prepare("DROP TRIGGER fail_recovery_insert").run();
  }
  const reservation = await env.DB.prepare(`SELECT id, state, recovery_json, cleanup_error FROM storage_allocations
    WHERE json_extract(recovery_json, '$.targetKey') LIKE '%/orphan.txt'`).first<{
      id: string; state: string; recovery_json: string; cleanup_error: string;
    }>();
  expect(reservation?.state).toBe("uncertain");
  expect(reservation?.cleanup_error).toContain("injected delete failure");
  expect((await recomputeStorage(env.DB)).after).toBe(before + 6);
  const key = JSON.parse(reservation!.recovery_json).targetKey;
  expect(await env.BUCKET.head(key)).not.toBeNull();
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect(await env.BUCKET.head(key)).not.toBeNull();
  expect((await recomputeStorage(env.DB)).after).toBe(before + 6);
});

it("fences uncertain rename cleanup without deleting the published target", async () => {
  await ensureSchema(env.DB);
  const created = await (await createLooseFile(env, undefined, actor, "before.txt", upload("before"), "text/plain")).json<{ id: string }>();
  const before = (await recomputeStorage(env.DB)).after;
  const oldKey = `files/${created.id}/before.txt`;
  const newKey = `files/${created.id}/after.txt`;
  const originalDelete = env.BUCKET.delete.bind(env.BUCKET);
  env.BUCKET.delete = async keys => {
    if (keys === oldKey) throw new Error("injected rename cleanup failure");
    return originalDelete(keys);
  };
  try {
    const result = await putLooseFile(env, undefined, actor, created.id, upload("after"), "after.txt", "text/plain");
    expect(result.status).toBe(200);
  } finally { env.BUCKET.delete = originalDelete; }
  expect((await recomputeStorage(env.DB)).after).toBe(before + 5);
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect(await env.BUCKET.head(oldKey)).not.toBeNull();
  expect(await (await env.BUCKET.get(newKey))?.text()).toBe("after");
  expect((await recomputeStorage(env.DB)).after).toBe(before + 5);
  await env.DB.prepare("UPDATE loose_files SET updated_at = '2000-01-01' WHERE id = ?").bind(created.id).run();
  await expect(putLooseFile(env, undefined, actor, created.id, upload("renamed back"), "before.txt", "text/plain"))
    .rejects.toMatchObject({ code: "file_recovery_required" });
});

it("rolls back the catalog when its reservation handoff aborts", async () => {
  await ensureSchema(env.DB);
  const before = (await recomputeStorage(env.DB)).after;
  await env.DB.prepare(`CREATE TRIGGER fail_recovery_handoff BEFORE UPDATE OF state ON storage_allocations
    WHEN OLD.kind = 'legacy_reservation' AND OLD.state = 'stored' AND NEW.state = 'released'
    BEGIN SELECT RAISE(ABORT, 'injected handoff failure'); END`).run();
  try {
    await expect(createLooseFile(env, undefined, actor, "handoff.txt", upload("handoff"), "text/plain")).rejects.toThrow();
  } finally { await env.DB.prepare("DROP TRIGGER fail_recovery_handoff").run(); }
  expect(await env.DB.prepare("SELECT id FROM loose_files WHERE filename = 'handoff.txt'").first()).toBeNull();
  expect((await recomputeStorage(env.DB)).after).toBe(before);
});


it("keeps a delayed deletion fenced even after its file claim ages", async () => {
  await ensureSchema(env.DB);
  const created = await (await createLooseFile(env, undefined, actor, "delayed-before.txt", upload("before"), "text/plain")).json<{ id: string }>();
  const oldKey = `files/${created.id}/delayed-before.txt`;
  const originalDelete = env.BUCKET.delete.bind(env.BUCKET);
  let release!: () => void;
  let reached!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  env.BUCKET.delete = async keys => {
    if (keys === oldKey) { reached(); await paused; }
    return originalDelete(keys);
  };
  const replacement = putLooseFile(env, undefined, actor, created.id, upload("after"), "delayed-after.txt", "text/plain");
  try {
    await started;
    await env.DB.prepare("UPDATE loose_files SET updated_at = '2000-01-01' WHERE id = ?").bind(created.id).run();
    await expect(putLooseFile(env, undefined, actor, created.id, upload("newer"), "delayed-before.txt", "text/plain"))
      .rejects.toMatchObject({ code: "file_busy" });
    await sweepLegacyReservations(env.DB, env.BUCKET, new Date(Date.now() + 86_400_000));
  } finally { release(); env.BUCKET.delete = originalDelete; }
  expect((await replacement).status).toBe(200);
  expect(await env.BUCKET.head(oldKey)).toBeNull();
  expect(await (await env.BUCKET.get(`files/${created.id}/delayed-after.txt`))?.text()).toBe("after");
  expect((await putLooseFile(env, undefined, actor, created.id, upload("newer"), "delayed-before.txt", "text/plain")).status).toBe(200);
  expect(await (await env.BUCKET.get(oldKey))?.text()).toBe("newer");
});

it("finishes known pending rename cleanup left between catalog handoff and deletion", async () => {
  const { assertStorageRoom, markLegacyReservation } = await import("../src/http");
  await ensureSchema(env.DB);
  const created = await (await createLooseFile(env, undefined, actor, "current.txt", upload("current"), "text/plain")).json<{ id: string }>();
  const before = (await recomputeStorage(env.DB)).after;
  const oldKey = `files/${created.id}/abandoned-old.txt`;
  const reservation = await assertStorageRoom(env.DB, 3, 0, Number.MAX_SAFE_INTEGER,
    { fileId: created.id, targetKey: `files/${created.id}/current.txt`, operation: "replace", ownerId: actor.email });
  await env.BUCKET.put(oldKey, "old");
  await markLegacyReservation(env.DB, reservation, "cleanup_pending", { cleanupKey: oldKey });
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect(await env.BUCKET.head(oldKey)).toBeNull();
  expect(await (await env.BUCKET.get(`files/${created.id}/current.txt`))?.text()).toBe("current");
  expect((await recomputeStorage(env.DB)).after).toBe(before);
});

it("finishes pending rename cleanup when the publishing process left its write claim", async () => {
  const { assertStorageRoom, markLegacyReservation } = await import("../src/http");
  const { newWriteToken } = await import("../src/expire");
  const { cleanupLegacyReservation } = await import("../src/site-storage");
  await ensureSchema(env.DB);
  const created = await (await createLooseFile(env, undefined, actor, "claimed-current.txt", upload("current"), "text/plain")).json<{ id: string }>();
  const before = (await recomputeStorage(env.DB)).after;
  const oldKey = `files/${created.id}/claimed-old.txt`;
  const claimToken = newWriteToken();
  await env.DB.prepare("UPDATE loose_files SET last_written_by = ? WHERE id = ?").bind(claimToken, created.id).run();
  const reservation = await assertStorageRoom(env.DB, 3, 0, Number.MAX_SAFE_INTEGER,
    { fileId: created.id, targetKey: `files/${created.id}/claimed-current.txt`, operation: "replace", ownerId: actor.email, claimToken });
  await env.BUCKET.put(oldKey, "old");
  await markLegacyReservation(env.DB, reservation, "cleanup_pending", { cleanupKey: oldKey });
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect(await env.BUCKET.head(oldKey)).toBeNull();
  expect((await recomputeStorage(env.DB)).after).toBe(before);
  await env.DB.prepare("UPDATE loose_files SET updated_at = '2000-01-01' WHERE id = ?").bind(created.id).run();
  expect((await putLooseFile(env, undefined, actor, created.id, upload("newer"), "claimed-old.txt", "text/plain")).status).toBe(200);
  await cleanupLegacyReservation(env.DB, env.BUCKET, reservation.id, new Date(), claimToken);
  expect(await (await env.BUCKET.get(oldKey))?.text()).toBe("newer");
});
