import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../src/db";
import { acquireVersionLease, cleanupAllocation, markAllocationStored, renewVersionLease, reserveAllocation, retireVersion, writeAllocation } from "../src/site-storage";

const now = new Date("2026-10-07T12:00:00.000Z");

async function reserve(bytes: number, cap: number) {
  return reserveAllocation(env.DB, { ownerId: "owner", kind: "candidate", bytes, cap, key: `test/${crypto.randomUUID()}` }, now);
}

describe("durable site storage", () => {
  it.each(["", "complete file"])("writes and verifies multipart content %j", async content => {
    await ensureSchema(env.DB);
    const allocation = await reserveAllocation(env.DB, {
      ownerId: "owner", kind: "candidate", bytes: content.length, cap: Number.MAX_SAFE_INTEGER,
      key: `test/${crypto.randomUUID()}`,
    });
    const result = await writeAllocation(env.DB, env.BUCKET, allocation, new Response(content).body!);
    expect(result.size).toBe(content.length);
    expect(await (await env.BUCKET.get(allocation.object_key!))?.text()).toBe(content);
    await cleanupAllocation(env.DB, env.BUCKET, allocation.id);
    expect(await env.BUCKET.head(allocation.object_key!)).toBeNull();
  });

  it("fences a recorded multipart attempt before releasing its charge", async () => {
    await ensureSchema(env.DB);
    const allocation = await reserve(10, Number.MAX_SAFE_INTEGER);
    const multipart = await env.BUCKET.createMultipartUpload(allocation.object_key!);
    await env.DB.prepare("UPDATE storage_allocations SET multipart_id = ?, state = 'writing' WHERE id = ?")
      .bind(multipart.uploadId, allocation.id).run();
    await cleanupAllocation(env.DB, env.BUCKET, allocation.id, now, allocation.attempt_id);
    await expect(multipart.uploadPart(1, "late bytes")).rejects.toThrow();
    await expect(markAllocationStored(env.DB, allocation.id, allocation.attempt_id, 10, now)).rejects.toThrow();
    expect(await env.BUCKET.head(allocation.object_key!)).toBeNull();
  });

  it("admits only one competing allocation and charges it exactly once", async () => {
    await ensureSchema(env.DB);
    const before = Number((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>())?.used);
    const results = await Promise.allSettled([reserve(100, before + 100), reserve(100, before + 100)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used).toBe(before + 100);
  });

  it("retains charges on deletion failure and releases once after retry", async () => {
    await ensureSchema(env.DB);
    const allocation = await reserve(20, Number.MAX_SAFE_INTEGER);
    await env.BUCKET.put(allocation.object_key!, "twenty");
    await markAllocationStored(env.DB, allocation.id, allocation.attempt_id, 6, now);
    const before = (await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used;
    const original = env.BUCKET.delete.bind(env.BUCKET);
    env.BUCKET.delete = async () => { throw new Error("delete unavailable"); };
    try {
      await expect(cleanupAllocation(env.DB, env.BUCKET, allocation.id, now)).rejects.toThrow("delete unavailable");
    } finally { env.BUCKET.delete = original; }
    expect((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used).toBe(before);
    await cleanupAllocation(env.DB, env.BUCKET, allocation.id, now);
    const after = (await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used;
    await cleanupAllocation(env.DB, env.BUCKET, allocation.id, now);
    expect((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used).toBe(after);
    expect(await env.BUCKET.head(allocation.object_key!)).toBeNull();
  });

  it("protects active readers and refuses renewal after retirement", async () => {
    await ensureSchema(env.DB);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO site_versions (id, site_id, state, created_at, superseded_at) VALUES (?, 'site', 'superseded', ?, ?)")
      .bind(id, now.toISOString(), new Date(now.getTime() - 600_000).toISOString()).run();
    const lease = await acquireVersionLease(env.DB, id, "export", now);
    expect(await retireVersion(env.DB, id, now)).toBe(false);
    expect(await renewVersionLease(env.DB, lease, now)).toBe(true);
    const later = new Date(now.getTime() + 180_000);
    expect(await retireVersion(env.DB, id, later)).toBe(true);
    expect(await renewVersionLease(env.DB, lease, later)).toBe(false);
    await expect(acquireVersionLease(env.DB, id, "read", later)).rejects.toThrow();
  });
});

it("repair preserves concurrent candidate and loose-file reservations", async () => {
  const { assertStorageRoom, recomputeStorage, releaseStorage } = await import("../src/http");
  await ensureSchema(env.DB);
  await recomputeStorage(env.DB);
  const before = Number((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first())?.used);
  const candidate = await reserve(123, Number.MAX_SAFE_INTEGER);
  const legacy = await assertStorageRoom(env.DB, 456, 0, Number.MAX_SAFE_INTEGER);
  expect((await recomputeStorage(env.DB)).after).toBe(before + 579);
  await releaseStorage(env.DB, legacy);
  await releaseStorage(env.DB, legacy);
  expect((await recomputeStorage(env.DB)).after).toBe(before + 123);
  await cleanupAllocation(env.DB, env.BUCKET, candidate.id, now);
});

it("holds a crash-after-complete allocation through repair and retries a crash after deletion", async () => {
  const { withD1Trigger } = await import("./mutation-harness");
  const { recomputeStorage } = await import("../src/http");
  await ensureSchema(env.DB);
  const allocation = await reserveAllocation(env.DB, { ownerId: "owner", kind: "upload", bytes: 5,
    cap: Number.MAX_SAFE_INTEGER, key: `crash/${crypto.randomUUID()}` });
  const multipart = await env.BUCKET.createMultipartUpload(allocation.object_key!);
  await env.DB.prepare("UPDATE storage_allocations SET state = 'writing', multipart_id = ? WHERE id = ?")
    .bind(multipart.uploadId, allocation.id).run();
  const part = await multipart.uploadPart(1, "hello");
  await multipart.complete([part]);
  const before = (await recomputeStorage(env.DB)).after;
  await withD1Trigger(env.DB, "fail_allocation_release", `CREATE TRIGGER fail_allocation_release BEFORE UPDATE OF state ON storage_allocations
    WHEN NEW.id = '${allocation.id}' AND NEW.state = 'released' BEGIN SELECT RAISE(ABORT, 'crash after delete'); END`, async () => {
    await expect(cleanupAllocation(env.DB, env.BUCKET, allocation.id, new Date(), allocation.attempt_id)).rejects.toThrow("crash after delete");
  });
  expect(await env.BUCKET.head(allocation.object_key!)).toBeNull();
  expect((await recomputeStorage(env.DB)).after).toBe(before);
  expect((await env.DB.prepare("SELECT cleanup_error FROM storage_allocations WHERE id = ?").bind(allocation.id).first())?.cleanup_error).toContain("crash after delete");
  await cleanupAllocation(env.DB, env.BUCKET, allocation.id);
  expect((await recomputeStorage(env.DB)).after).toBe(before - 5);
});

it("does not let cleanup cancel a live writer without its attempt identity", async () => {
  await ensureSchema(env.DB);
  const allocation = await reserveAllocation(env.DB, { ownerId: "owner", kind: "upload", bytes: 3,
    cap: Number.MAX_SAFE_INTEGER, key: `live/${crypto.randomUUID()}` });
  await env.DB.prepare("UPDATE storage_allocations SET state = 'writing' WHERE id = ?").bind(allocation.id).run();
  await cleanupAllocation(env.DB, env.BUCKET, allocation.id);
  expect((await env.DB.prepare("SELECT state FROM storage_allocations WHERE id = ?").bind(allocation.id).first())?.state).toBe("writing");
  await cleanupAllocation(env.DB, env.BUCKET, allocation.id, new Date(), allocation.attempt_id);
});

it("retains both catalog and pending legacy charge after a crash before handoff", async () => {
  const { assertStorageRoom, recomputeStorage, releaseStorage } = await import("../src/http");
  await ensureSchema(env.DB);
  const before = (await recomputeStorage(env.DB)).after;
  const reservation = await assertStorageRoom(env.DB, 9, 0, Number.MAX_SAFE_INTEGER);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO loose_files (id, filename, size, content_type, created_at, created_by)
    VALUES (?, 'crash.txt', 9, 'text/plain', ?, 'owner')`).bind(id, now.toISOString()).run();
  expect((await recomputeStorage(env.DB)).after).toBe(before + 18);
  await releaseStorage(env.DB, reservation);
  expect((await recomputeStorage(env.DB)).after).toBe(before + 9);
  await releaseStorage(env.DB, reservation);
  expect((await recomputeStorage(env.DB)).after).toBe(before + 9);
});

it("releases a read lease only after stream completion or cancellation", async () => {
  const { leaseVersionStream } = await import("../src/site-storage");
  await ensureSchema(env.DB);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO site_versions (id, site_id, state, created_at) VALUES (?, 'stream-site', 'active', ?)")
    .bind(id, new Date().toISOString()).run();
  const lease = await acquireVersionLease(env.DB, id, "stream");
  const stream = leaseVersionStream(env.DB, lease, new Response("streamed").body!);
  expect(await env.DB.prepare("SELECT id FROM site_operation_leases WHERE id = ?").bind(lease.id).first()).not.toBeNull();
  expect(await new Response(stream).text()).toBe("streamed");
  expect(await env.DB.prepare("SELECT id FROM site_operation_leases WHERE id = ?").bind(lease.id).first()).toBeNull();
  const cancelled = await acquireVersionLease(env.DB, id, "cancel");
  const body = leaseVersionStream(env.DB, cancelled, new ReadableStream());
  await body.cancel();
  expect(await env.DB.prepare("SELECT id FROM site_operation_leases WHERE id = ?").bind(cancelled.id).first()).toBeNull();
});

it("reclaims expired candidate files while preserving a live winner", async () => {
  const { sweepSiteStorage } = await import("../src/site-storage");
  await ensureSchema(env.DB);
  const versionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO site_versions (id, site_id, state, created_at) VALUES (?, 'expired-site', 'candidate', ?)")
    .bind(versionId, now.toISOString()).run();
  await env.DB.prepare(`INSERT INTO site_deployments (id, site_id, owner_id, version_id, base_generation, mode, input_json,
    intent_hash, idempotency_key, created_at, deadline) VALUES (?, 'expired-site', 'owner', ?, 0, 'replace', '{}', 'hash', ?, ?, ?)`)
    .bind(sessionId, versionId, sessionId, now.toISOString(), now.toISOString()).run();
  const allocation = await reserveAllocation(env.DB, { ownerId: "owner", versionId, deploymentId: sessionId,
    kind: "candidate", bytes: 3, cap: Number.MAX_SAFE_INTEGER, key: `expired/${crypto.randomUUID()}` }, now);
  await env.BUCKET.put(allocation.object_key!, "old");
  await markAllocationStored(env.DB, allocation.id, allocation.attempt_id, 3, now);
  await env.DB.prepare(`INSERT INTO site_version_files (version_id,path,allocation_id,object_key,size,sha256,content_type)
    VALUES (?, 'old.txt', ?, ?, 3, 'hash', 'text/plain')`).bind(versionId, allocation.id, allocation.object_key).run();
  await cleanupAllocation(env.DB, env.BUCKET, allocation.id, now);
  expect(await env.BUCKET.head(allocation.object_key!)).not.toBeNull();
  await sweepSiteStorage(env.DB, env.BUCKET, new Date(now.getTime() + 3_600_000));
  expect(await env.BUCKET.head(allocation.object_key!)).toBeNull();
  expect((await env.DB.prepare("SELECT state FROM site_versions WHERE id = ?").bind(versionId).first())?.state).toBe("retired");
});

it("keeps a lease heartbeat failure permanent and aborts a waiting stream", async () => {
  const { vi } = await import("vitest");
  const { leaseVersionStream, startVersionLeaseHeartbeat } = await import("../src/site-storage");
  await ensureSchema(env.DB);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO site_versions (id, site_id, state, created_at) VALUES (?, 'heartbeat-site', 'active', ?)")
    .bind(id, new Date().toISOString()).run();
  const lease = await acquireVersionLease(env.DB, id, "heartbeat");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const heartbeat = startVersionLeaseHeartbeat(env.DB, lease);
  try {
    await env.DB.prepare("DELETE FROM site_operation_leases WHERE id = ?").bind(lease.id).run();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(() => heartbeat.assertActive()).toThrow("expired");
  } finally { heartbeat.stop(); vi.useRealTimers(); }
  const streamingLease = await acquireVersionLease(env.DB, id, "stream-heartbeat");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let cancelled = false;
  const stream = leaseVersionStream(env.DB, streamingLease, new ReadableStream({ cancel() { cancelled = true; } }));
  const read = stream.getReader().read();
  const rejection = expect(read).rejects.toThrow("expired");
  try {
    await env.DB.prepare("DELETE FROM site_operation_leases WHERE id = ?").bind(streamingLease.id).run();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(cancelled).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("charges raw staging and rollback snapshots until their physical cleanup", async () => {
  const { IN_MEMORY_BYTES } = await import("../src/config");
  const { withUpload } = await import("../src/upload");
  const { discardR2Snapshots, recomputeStorage, snapshotR2Object } = await import("../src/http");
  await ensureSchema(env.DB);
  const before = (await recomputeStorage(env.DB)).after;
  const size = IN_MEMORY_BYTES + 1;
  let remaining = size;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!remaining) { controller.close(); return; }
      const length = Math.min(1024 * 1024, remaining);
      remaining -= length;
      controller.enqueue(new Uint8Array(length));
    },
  });
  const request = new Request("https://example.com/upload", { method: "PUT", headers: { "content-length": String(size) }, body });
  await withUpload(request, env, size, "https://example.com", async upload => {
    expect(upload.allocationId).toBeTruthy();
    expect((await recomputeStorage(env.DB)).after).toBe(before + size);
    const snapshot = await snapshotR2Object(env, upload.stagedKey!);
    expect(snapshot?.allocation).toBeTruthy();
    expect((await recomputeStorage(env.DB)).after).toBe(before + size * 2);
    await discardR2Snapshots(env.BUCKET, [snapshot]);
    expect((await recomputeStorage(env.DB)).after).toBe(before + size);
  });
  expect((await recomputeStorage(env.DB)).after).toBe(before);
}, 15_000);


it("sweeps a quiescent failed loose-file creation without releasing a live attempt", async () => {
  const { assertStorageRoom, markLegacyReservation, recomputeStorage } = await import("../src/http");
  const { sweepLegacyReservations } = await import("../src/site-storage");
  await ensureSchema(env.DB);
  const fileId = crypto.randomUUID();
  const key = `files/${fileId}/orphan.txt`;
  const reservation = await assertStorageRoom(env.DB, 6, 0, Number.MAX_SAFE_INTEGER,
    { fileId, targetKey: key, operation: "create", ownerId: "owner" });
  await markLegacyReservation(env.DB, reservation, "writing");
  await env.BUCKET.put(key, "orphan");
  const before = (await recomputeStorage(env.DB)).after;
  await sweepLegacyReservations(env.DB, env.BUCKET, new Date(Date.now() + 86_400_000));
  expect((await recomputeStorage(env.DB)).after).toBe(before);
  expect(await env.BUCKET.head(key)).not.toBeNull();
  await markLegacyReservation(env.DB, reservation, "cleanup_pending", { cleanupKey: key });
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect(await env.BUCKET.head(key)).toBeNull();
  expect((await recomputeStorage(env.DB)).after).toBe(before - 6);
  await sweepLegacyReservations(env.DB, env.BUCKET);
  expect((await recomputeStorage(env.DB)).after).toBe(before - 6);
});
