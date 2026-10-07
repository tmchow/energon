import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../src/db";
import { canonicalDeploymentIntent, commitDeployment, createDeployment, recordDeploymentFile, sealDeployment } from "../src/site-deployments";
import type { DeploymentIntent } from "../src/types";
import { withD1Trigger } from "./mutation-harness";

const now = new Date("2026-10-07T12:00:00.000Z");
const authority = { email: "owner@example.com", userId: "owner", via: "access" as const };
const intent = { mode: "replace" as const, files: [] };
const key = (time = now.getTime()) => `${time}.${crypto.randomUUID()}`;

async function fixture() {
  await ensureSchema(env.DB);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO sites (id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by)
    VALUES (?, 'owner', ?, 'owner', ?, ?, ?, ?)`).bind(id, id, now.toISOString(), now.toISOString(), authority.email, authority.email).run();
  const create = (idempotencyKey = key(), input: DeploymentIntent = intent, at = now) => createDeployment(env.DB, {
    siteId: id, ownerId: "owner", baseGeneration: 0, idempotencyKey, intent: input,
  }, at);
  const ready = async (baseGeneration = 0) => {
    const deployment = await createDeployment(env.DB, { siteId: id, ownerId: "owner", baseGeneration, idempotencyKey: key(), intent }, now);
    await sealDeployment(env.DB, deployment.id, now);
    return deployment;
  };
  const commit = (deploymentId: string, at = now) => commitDeployment(env.DB, deploymentId, authority, `https://content.example.com/owner/s/${id}`, at);
  return { id, create, ready, commit };
}

describe("native D1 deployment publication", () => {
  it("publishes exactly one concurrent ready session for a base generation", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.ready(), f.ready()]);
    const results = await Promise.allSettled([f.commit(a.id), f.commit(b.id)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const row = await env.DB.prepare("SELECT active_version_id, content_generation FROM sites WHERE id = ?").bind(f.id).first();
    expect(row?.content_generation).toBe(1);
    const receipts = await env.DB.prepare("SELECT id FROM site_deployments WHERE site_id = ? AND receipt_json IS NOT NULL").bind(f.id).all();
    expect(receipts.results).toHaveLength(1);
  });

  it("has no later side effects when the first transition affects zero rows", async () => {
    const f = await fixture();
    const a = await f.ready();
    await env.DB.prepare("UPDATE sites SET content_generation = 3 WHERE id = ?").bind(f.id).run();
    const before = await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first();
    await expect(f.commit(a.id)).rejects.toMatchObject({ code: "deployment_conflict" });
    expect(await env.DB.prepare("SELECT active_version_id, content_generation FROM sites WHERE id = ?").bind(f.id).first())
      .toEqual({ active_version_id: null, content_generation: 3 });
    expect(await env.DB.prepare("SELECT state, commit_attempt, receipt_json FROM site_deployments WHERE id = ?").bind(a.id).first())
      .toEqual({ state: "ready", commit_attempt: null, receipt_json: null });
    expect(await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first()).toEqual(before);
  });

  it("rolls back a native SQL error after the tentative transition", async () => {
    const f = await fixture();
    const a = await f.ready();
    await withD1Trigger(env.DB, "fail_deployment_pointer", `CREATE TRIGGER fail_deployment_pointer
      BEFORE UPDATE OF active_version_id ON sites WHEN NEW.id = '${f.id}'
      BEGIN SELECT RAISE(ABORT, 'publication fault'); END`, async () => {
      await expect(f.commit(a.id)).rejects.toThrow("publication fault");
    });
    expect(await env.DB.prepare("SELECT state, commit_attempt, receipt_json FROM site_deployments WHERE id = ?").bind(a.id).first())
      .toEqual({ state: "ready", commit_attempt: null, receipt_json: null });
    expect(await env.DB.prepare("SELECT active_version_id, content_generation FROM sites WHERE id = ?").bind(f.id).first())
      .toEqual({ active_version_id: null, content_generation: 0 });
    await expect(f.commit(a.id)).resolves.toMatchObject({ deploymentId: a.id });
  });

  it("returns the original durable receipt after a newer publication", async () => {
    const f = await fixture();
    const a = await f.ready();
    const original = await f.commit(a.id);
    const b = await f.ready(1);
    await f.commit(b.id);
    expect(await f.commit(a.id)).toEqual(original);
    expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(f.id).first())?.active_version_id).toBe(b.version_id);
  });

  it("binds retry identity to intent and expires unseen keys after pruning", async () => {
    const f = await fixture();
    const identity = key();
    const a = await f.create(identity);
    expect((await f.create(identity)).id).toBe(a.id);
    await expect(f.create(identity, { ...intent, mode: "merge" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(f.create(key(now.getTime() - 3_600_000))).resolves.toBeDefined();
    await expect(f.create(key(now.getTime() - 3_600_001))).rejects.toMatchObject({ code: "idempotency_expired" });
    await expect(f.create(key(now.getTime() + 300_000))).resolves.toBeDefined();
    await expect(f.create(key(now.getTime() + 300_001))).rejects.toMatchObject({ code: "idempotency_expired" });
    await env.DB.prepare("DELETE FROM site_deployments WHERE id = ?").bind(a.id).run();
    await expect(f.create(identity, intent, new Date(now.getTime() + 8 * 86_400_000))).rejects.toMatchObject({ code: "idempotency_expired" });
  });
});

it("bootstraps an independent native 0005-shaped binding without losing identities", async () => {
  const names = ["sites", "site_files", "loose_files", "tokens", "users", "handle_reservations", "agent_connections", "admin_audit",
    "upload_grants", "gate_attempts", "platform_quota", "site_versions", "site_version_files", "site_deployments", "site_operation_leases", "storage_allocations", "site_conversions", "site_version_files_insert_guard", "site_version_files_update_guard", "site_version_files_delete_guard", "site_deployments_intent_guard"];
  const prefix = `legacy_${crypto.randomUUID().replaceAll("-", "")}_`;
  const rewrite = (sql: string) => sql.replace(new RegExp(`\\b(${names.join("|")}|idx_\\w+)\\b`, "g"), name => prefix + name);
  const legacy = { prepare: (sql: string) => env.DB.prepare(rewrite(sql)) } as D1Database;
  await legacy.prepare(`CREATE TABLE sites (handle TEXT, slug TEXT, created_at TEXT, updated_at TEXT,
    created_by TEXT, last_written_by TEXT, password_hash TEXT, PRIMARY KEY(handle, slug))`).run();
  await legacy.prepare(`CREATE TABLE site_files (handle TEXT, slug TEXT, path TEXT, size INTEGER, content_type TEXT,
    updated_at TEXT, last_written_by TEXT, PRIMARY KEY(handle, slug, path))`).run();
  await legacy.prepare(`CREATE TABLE loose_files (id TEXT PRIMARY KEY, filename TEXT, size INTEGER, content_type TEXT,
    created_at TEXT, created_by TEXT, handle TEXT)`).run();
  await legacy.prepare(`CREATE TABLE tokens (id TEXT PRIMARY KEY, user_email TEXT, label TEXT, token_hash TEXT,
    token_secret TEXT, created_at TEXT, last_used_at TEXT, revoked_at TEXT)`).run();
  await legacy.prepare(`INSERT INTO sites VALUES ('old', 'page', ?, ?, 'old@example.com', 'old@example.com', 'password')`)
    .bind(now.toISOString(), now.toISOString()).run();
  await legacy.prepare(`INSERT INTO site_files VALUES ('old', 'page', 'index.html', 9, 'text/html', ?, 'old@example.com')`)
    .bind(now.toISOString()).run();
  await ensureSchema(legacy);
  const site = await legacy.prepare("SELECT id, handle, password_hash, active_version_id, content_generation FROM sites").first();
  expect(site).toMatchObject({ handle: "old", password_hash: "password", active_version_id: null, content_generation: 0 });
  expect(site?.id).toBeTruthy();
  expect((await legacy.prepare("SELECT site_id FROM site_files").first())?.site_id).toBe(site?.id);
  await ensureSchema(legacy);
  expect((await legacy.prepare("SELECT id FROM sites").first())?.id).toBe(site?.id);
});

it("consumes a bound grant atomically and rolls back all effects on a late SQL failure", async () => {
  const f = await fixture();
  const deployment = await f.ready();
  const tokenId = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO tokens (id, user_email, user_id, label, token_hash, created_at)
    VALUES (?, ?, 'owner', 'deployment', ?, ?)`).bind(tokenId, authority.email, tokenId, now.toISOString()).run();
  await env.DB.prepare(`INSERT INTO upload_grants (id, secret_hash, token_id, user_email, user_id, target_kind, site_id,
    max_bytes, state, created_at, expires_at, deployment_id, deployment_intent_hash, deployment_base_generation)
    VALUES (?, ?, ?, ?, 'owner', 'site_deployment', ?, 100, 'unused', ?, ?, ?, ?, 0)`)
    .bind(grantId, grantId, tokenId, authority.email, f.id, now.toISOString(), new Date(now.getTime() + 60_000).toISOString(), deployment.id, deployment.intent_hash).run();
  const actor = { ...authority, via: "grant" as const, grantId };
  const commit = () => commitDeployment(env.DB, deployment.id, actor, "https://content.example.com/grant", now);
  await withD1Trigger(env.DB, "fail_deployment_receipt", `CREATE TRIGGER fail_deployment_receipt
    BEFORE UPDATE OF receipt_json ON site_deployments WHEN NEW.id = '${deployment.id}'
    BEGIN SELECT RAISE(ABORT, 'receipt fault'); END`, async () => {
    await expect(commit()).rejects.toThrow("receipt fault");
  });
  expect((await env.DB.prepare("SELECT state FROM upload_grants WHERE id = ?").bind(grantId).first())?.state).toBe("unused");
  expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(f.id).first())?.active_version_id).toBeNull();
  await env.DB.prepare("UPDATE sites SET content_generation = 1 WHERE id = ?").bind(f.id).run();
  await expect(commit()).rejects.toMatchObject({ code: "deployment_conflict" });
  expect((await env.DB.prepare("SELECT state FROM upload_grants WHERE id = ?").bind(grantId).first())?.state).toBe("unused");
  await env.DB.prepare("UPDATE sites SET content_generation = 0 WHERE id = ?").bind(f.id).run();
  const result = await commit();
  expect((await env.DB.prepare("SELECT state FROM upload_grants WHERE id = ?").bind(grantId).first())?.state).toBe("consumed");
  expect(await commit()).toEqual(result);
  await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ?").bind(now.toISOString(), tokenId).run();
  await expect(commit()).rejects.toMatchObject({ code: "deployment_forbidden" });
});

it("seals a complete manifest and prevents later mutation of its receipts", async () => {
  const f = await fixture();
  const file = { path: "index.html", size: 4, sha256: "a".repeat(64), contentType: "text/html" };
  const deployment = await createDeployment(env.DB, { siteId: f.id, ownerId: "owner", baseGeneration: 0,
    idempotencyKey: key(), intent: { mode: "replace", files: [file] } }, now);
  await expect(sealDeployment(env.DB, deployment.id, now)).rejects.toMatchObject({ code: "deployment_incomplete" });
  const allocationId = crypto.randomUUID();
  const objectKey = `site-versions/${f.id}/${deployment.version_id}/${allocationId}`;
  await env.DB.prepare(`INSERT INTO storage_allocations
    (id, owner_id, site_id, version_id, deployment_id, kind, object_key, reserved_bytes, actual_bytes, state, attempt_id, created_at)
    VALUES (?, 'owner', ?, ?, ?, 'version', ?, 4, 4, 'stored', ?, ?)`)
    .bind(allocationId, f.id, deployment.version_id, deployment.id, objectKey, allocationId, now.toISOString()).run();
  await recordDeploymentFile(env.DB, deployment.id, { version_id: deployment.version_id, path: file.path,
    allocation_id: allocationId, object_key: objectKey, size: file.size, sha256: file.sha256, content_type: file.contentType }, now);
  await sealDeployment(env.DB, deployment.id, now);
  await expect(env.DB.prepare("UPDATE site_version_files SET sha256 = 'other' WHERE version_id = ?").bind(deployment.version_id).run())
    .rejects.toThrow("immutable");
  await expect(env.DB.prepare("DELETE FROM site_version_files WHERE version_id = ?").bind(deployment.version_id).run())
    .rejects.toThrow("retired");
  await expect(env.DB.prepare("UPDATE site_deployments SET base_generation = 4 WHERE id = ?").bind(deployment.id).run())
    .rejects.toThrow("immutable");
  await expect(f.commit(deployment.id)).resolves.toMatchObject({ versionId: deployment.version_id });
});

it("canonicalizes file order and rejects ambiguous or duplicated paths", () => {
  const a = { path: "a.txt", size: 1, sha256: "a".repeat(64), contentType: "text/plain" };
  const b = { ...a, path: "b.txt" };
  expect(canonicalDeploymentIntent({ mode: "replace", files: [b, a] })).toBe(canonicalDeploymentIntent({ mode: "replace", files: [a, b] }));
  expect(() => canonicalDeploymentIntent({ mode: "replace", files: [a, a] })).toThrow();
  expect(() => canonicalDeploymentIntent({ mode: "replace", files: [{ ...a, path: "../a.txt" }] })).toThrow();
});

it("enforces the preparation deadline and preserves a concurrently claimed site", async () => {
  const f = await fixture();
  const deployment = await f.ready();
  await expect(f.commit(deployment.id, new Date(now.getTime() + 3_600_000))).rejects.toMatchObject({ code: "deployment_expired" });
  await env.DB.prepare("UPDATE sites SET lifecycle_state = 'deleted' WHERE id = ?").bind(f.id).run();
  await expect(f.commit(deployment.id)).rejects.toMatchObject({ code: "deployment_conflict" });
  expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(f.id).first())?.active_version_id).toBeNull();
});
