import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_PASSWORD_HEADER } from "../src/config";
import { access, auth, json, mint, mintAdmin, req } from "./helpers";

const EMAIL = "recover@esperlabs.app";
const hour = 3_600_000;

type Seed = { state: string; cleanupError?: string; writerExpiresAt?: number };

async function publish(token: string, name: string) {
  const created = await json("/v1/files", {
    method: "POST",
    headers: auth(token, { "X-Filename": name, "X-Energon-Set-Write-Password": "guest-write-ok" }),
    body: "original",
  });
  expect(created.status).toBe(201);
  return created.body as { id: string; url: string };
}

async function seedReservation(fileId: string, seed: Seed): Promise<string> {
  const id = crypto.randomUUID();
  const recovery = { fileId, targetKey: `files/${fileId}/x`, ownerId: EMAIL, operation: "replace", snapshotKey: "site-staging/snapshots/s" };
  await env.DB.prepare(`INSERT INTO storage_allocations (id, owner_id, kind, reserved_bytes, attempt_id, created_at, recovery_json, state, cleanup_error, writer_expires_at)
    VALUES (?, ?, 'legacy_reservation', 1, ?, ?, ?, ?, ?, ?)`)
    .bind(id, EMAIL, id, new Date().toISOString(), JSON.stringify(recovery), seed.state, seed.cleanupError ?? null,
      new Date(Date.now() + (seed.writerExpiresAt ?? hour)).toISOString())
    .run();
  return id;
}

async function release(allocationId: string) {
  await env.DB.prepare("UPDATE storage_allocations SET state = 'released' WHERE id = ?").bind(allocationId).run();
}

async function mutations(token: string, file: { id: string; url: string }) {
  const put = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, { "content-type": "text/plain" }), body: "v2" });
  const hubPut = await json(`/account/files/${file.id}`, { method: "PUT", headers: access(EMAIL, { "content-type": "text/plain" }), body: "v2" });
  const patch = await json(`/v1/files/${file.id}`, {
    method: "PATCH", headers: auth(token, { "content-type": "application/json" }), body: JSON.stringify({ ttl: "7d" }),
  });
  const guest = await json(file.url, { method: "PUT", headers: { [WRITE_PASSWORD_HEADER]: "guest-write-ok" }, body: "guest" });
  const del = await json(`/v1/files/${file.id}`, { method: "DELETE", headers: auth(token) });
  return { put: put.body.error, hubPut: hubPut.body.error, patch: patch.body.error, guest: guest.body.error, delete: del.body.error };
}

describe("loose-file storage recovery", () => {
  it.each([
    ["an uncertain outcome", { state: "uncertain", cleanupError: "injected" }, "file_recovery_required"],
    ["a recorded cleanup error", { state: "cleanup_pending", cleanupError: "injected" }, "file_recovery_required"],
    ["a writer past its window", { state: "writing", writerExpiresAt: -hour }, "file_recovery_required"],
    ["a writer inside its window", { state: "writing" }, "file_busy"],
  ] as const)("answers every mutation path for %s with %s and leaves the bytes", async (_name, seed, code) => {
    const token = await mint(`recover-${seed.state}-${code}`, EMAIL);
    const file = await publish(token, "recover.txt");
    const allocation = await seedReservation(file.id, seed);
    try {
      expect(await mutations(token, file)).toEqual({ put: code, hubPut: code, patch: code, guest: code, delete: code });
      expect(await (await req(`/v1/files/${file.id}`, { headers: auth(token) })).text()).toBe("original");
    } finally {
      await release(allocation);
    }
  });

  it("fails an upload grant terminally instead of handing it back for retry", async () => {
    const token = await mint("recover-grant", EMAIL);
    const file = await publish(token, "grant.txt");
    const minted = await json("/v1/grants", {
      method: "POST", headers: auth(token, { "content-type": "application/json" }), body: JSON.stringify({ target: { type: "file", id: file.id } }),
    });
    const allocation = await seedReservation(file.id, { state: "uncertain", cleanupError: "injected" });
    try {
      const upload = (body: string) => SELF.fetch(minted.body.upload_url, { method: "PUT", headers: { authorization: `Bearer ${minted.body.secret}` }, body });
      const first = await upload("v2");
      expect(first.status).toBe(410);
      expect(await first.json()).toMatchObject({ error: "grant_failed", reason: "file_recovery_required" });
      const status = await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) });
      expect(status.body).toMatchObject({ state: "failed", last_error: "file_recovery_required" });
    } finally {
      await release(allocation);
    }
  });

  it("reports recovery or busy before a stale expected_version on every conditional path", async () => {
    const token = await mint("recover-conditional", EMAIL);
    const file = await publish(token, "conditional.txt");
    const target = JSON.stringify({ target: { type: "file", id: file.id, expected_version: 1 } });
    const grant = await json("/v1/grants", { method: "POST", headers: auth(token, { "content-type": "application/json" }), body: target });
    expect((await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token), body: "v2" })).body.content_generation).toBe(2);
    const stale = { "X-Energon-Expected-Version": "1" };
    const attempt = async () => ({
      put: (await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, stale), body: "stale" })).body.error,
      guest: (await json(file.url, { method: "PUT", headers: { [WRITE_PASSWORD_HEADER]: "guest-write-ok", ...stale }, body: "stale" })).body.error,
      mint: (await json("/v1/grants", { method: "POST", headers: auth(token, { "content-type": "application/json" }), body: target })).body.error,
    });
    expect(await attempt()).toEqual({ put: "file_conflict", guest: "file_conflict", mint: "file_conflict" });

    const busy = await seedReservation(file.id, { state: "writing" });
    try {
      expect(await attempt()).toMatchObject({ put: "file_busy", guest: "file_busy" });
    } finally {
      await release(busy);
    }
    const stuck = await seedReservation(file.id, { state: "uncertain", cleanupError: "injected" });
    try {
      expect(await attempt()).toEqual({ put: "file_recovery_required", guest: "file_recovery_required", mint: "file_recovery_required" });
      const redeemed = await SELF.fetch(grant.body.upload_url, { method: "PUT", headers: { authorization: `Bearer ${grant.body.secret}` }, body: "old draft" });
      expect(await redeemed.json()).toMatchObject({ error: "grant_failed", reason: "file_recovery_required" });
      expect(await (await req(`/v1/files/${file.id}`, { headers: auth(token) })).text()).toBe("v2");
    } finally {
      await release(stuck);
    }
  });

  it("lists unresolved reservations on admin health, recovery-required first", async () => {
    const token = await mint("recover-health", EMAIL);
    const busy = await publish(token, "busy.txt");
    const stuck = await publish(token, "stuck.txt");
    const pending = await seedReservation(busy.id, { state: "writing" });
    const required = await seedReservation(stuck.id, { state: "uncertain", cleanupError: "injected delete failure" });
    try {
      const admin = await mintAdmin("recover-health-admin");
      const health = await json("/v1/admin/health", { headers: auth(admin) });
      expect(health.status).toBe(200);
      const recoveries = health.body.file_recoveries;
      expect(recoveries.pending).toBeGreaterThanOrEqual(2);
      expect(recoveries.recovery_required).toBeGreaterThanOrEqual(1);
      const ours = recoveries.items.filter((item: { allocation_id: string }) => [pending, required].includes(item.allocation_id));
      expect(ours).toEqual([
        {
          allocation_id: required, file_id: stuck.id, filename: "stuck.txt", operation: "replace", state: "uncertain",
          created_at: expect.any(String), cleanup_error: "injected delete failure", snapshot_retained: true, recovery_required: true,
        },
        expect.objectContaining({ allocation_id: pending, file_id: busy.id, state: "writing", recovery_required: false }),
      ]);
      expect(JSON.stringify(health.body)).not.toContain("guest-write-ok");
      expect(JSON.stringify(health.body)).not.toContain("site-staging/snapshots");
    } finally {
      await release(pending);
      await release(required);
    }
  });
});
