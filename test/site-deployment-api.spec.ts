import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/http";
import { auth, createSite, json, mint, req } from "./helpers";
import { zipSync, strToU8 } from "fflate";

describe("deployment API", () => {
  it("imports ZIP through bounded preparation and keeps legacy merge behavior", async () => {
    const token = await mint("zip-deployment-api");
    const site = await createSite(token, "zip-deployment-api");
    await req(`/v1/sites/${site.id}/files/keep.txt`, { method: "PUT", headers: auth(token), body: "keep" });
    const archive = zipSync({ "index.html": strToU8("new page"), "app.js": strToU8("code") });
    const imported = await json(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(token), body: archive });
    expect(imported.status).toBe(200);
    expect(imported.body.written).toEqual(["index.html", "app.js"]);
    expect(await (await req(site.url)).text()).toBe("new page");
    expect(await (await req(`${site.url}keep.txt`)).text()).toBe("keep");
  });
  it("stages a manifest, explicitly prepares and commits, and replays the receipt", async () => {
    const token = await mint("deployment-api");
    const site = await createSite(token, "deployment-api");
    const path = `/v1/sites/${site.id}/deployments`;
    const body = JSON.stringify({ expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
      files: [{ path: "index.html", size: 5, sha256: await sha256Hex("hello"), content_type: "text/html" }] });
    const created = await json(path, { method: "POST", headers: auth(token), body });
    expect(created.status).toBe(201);
    const session = `${path}/${created.body.deployment_id}`;
    expect((await json(`${session}/prepare`, { method: "POST", headers: auth(token) })).status).toBe(409);
    expect((await req(`${session}/files/index.html`, { method: "PUT", headers: auth(token), body: "hello" })).status).toBe(201);
    expect((await req(`${session}/files/index.html`, { method: "PUT", headers: auth(token), body: "hello" })).status).toBe(200);
    expect((await json(`${session}/prepare`, { method: "POST", headers: auth(token) })).body.state).toBe("ready");
    const committed = await json(`${session}/commit`, { method: "POST", headers: auth(token) });
    expect(committed.status).toBe(200);
    expect(committed.body.url).toBe(site.url);
    const publicRead = await req(site.url);
    expect(await publicRead.text()).toBe("hello");
    expect(publicRead.headers.get("x-energon-site-version")).toBe(committed.body.version_id);
    const listing = await json("/v1/sites", { headers: auth(token) });
    expect(listing.body.sites.find((item: { id: string }) => item.id === site.id)).toMatchObject({
      version_id: committed.body.version_id, content_generation: 1,
    });
    expect(await (await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) })).text()).toBe("hello");
    const replay = await json(`${session}/commit`, { method: "POST", headers: auth(token) });
    expect(replay.body).toEqual(committed.body);
    expect((await json(path, { method: "POST", headers: auth(token), body })).body.deployment_id).toBe(created.body.deployment_id);
  });

  it("keeps sessions private and makes abort retries idempotent", async () => {
    const owner = await mint("deployment-owner");
    const other = await mint("deployment-other", "other@esperlabs.app");
    const site = await createSite(owner, "deployment-private");
    const base = `/v1/sites/${site.id}/deployments`;
    const created = await json(base, { method: "POST", headers: auth(owner), body: JSON.stringify({
      expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`, files: [],
    }) });
    expect(created.status).toBe(201);
    const path = `${base}/${created.body.deployment_id}`;
    expect((await req(path, { headers: auth(other) })).status).toBe(403);
    expect((await req(path, { method: "DELETE", headers: auth(owner) })).status).toBe(204);
    expect((await req(path, { method: "DELETE", headers: auth(owner) })).status).toBe(204);
    expect((await req(`${path}/commit`, { method: "POST", headers: auth(owner) })).status).toBe(409);
  });
});

it("does not receipt an upload after preparation ownership is lost", async () => {
  const { env } = await import("cloudflare:test");
  const token = await mint("lost-upload-owner");
  const site = await createSite(token, "lost-upload-owner");
  const created = await json(`/v1/sites/${site.id}/deployments`, { method: "POST", headers: auth(token), body: JSON.stringify({
    expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
    files: [{ path: "index.html", size: 5, sha256: await sha256Hex("hello"), content_type: "text/html" }],
  }) });
  const id = created.body.deployment_id;
  const original = env.BUCKET.createMultipartUpload.bind(env.BUCKET);
  env.BUCKET.createMultipartUpload = async (...args) => {
    const upload = await original(...args);
    const complete = upload.complete.bind(upload);
    upload.complete = async parts => {
      const result = await complete(parts);
      await env.DB.prepare("UPDATE site_deployments SET prepare_owner = 'other-owner' WHERE id = ?").bind(id).run();
      return result;
    };
    return upload;
  };
  try {
    const result = await json(`/v1/sites/${site.id}/deployments/${id}/files/index.html`, { method: "PUT", headers: auth(token), body: "hello" });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("deployment_conflict");
    expect(await env.DB.prepare("SELECT path FROM site_version_files WHERE version_id = (SELECT version_id FROM site_deployments WHERE id = ?)").bind(id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT prepare_owner FROM site_deployments WHERE id = ?").bind(id).first()).toEqual({ prepare_owner: "other-owner" });
  } finally { env.BUCKET.createMultipartUpload = original; }
});

it("leases the selected base while copying unchanged ZIP merge files", async () => {
  const { env } = await import("cloudflare:test");
  const { retireVersion } = await import("../src/site-storage");
  const token = await mint("merge-read-lease");
  const site = await createSite(token, "merge-read-lease");
  await req(`/v1/sites/${site.id}/files/keep.txt`, { method: "PUT", headers: auth(token), body: "keep" });
  const base = await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(site.id).first<{ active_version_id: string }>();
  const file = await env.DB.prepare("SELECT object_key FROM site_version_files WHERE version_id = ?").bind(base!.active_version_id).first<{ object_key: string }>();
  const original = env.BUCKET.get.bind(env.BUCKET);
  let checked = false;
  env.BUCKET.get = (async (...args: Parameters<R2Bucket["get"]>) => {
    if (args[0] === file!.object_key) {
      checked = true;
      const leases = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_operation_leases WHERE version_id = ? AND expires_at > ?")
        .bind(base!.active_version_id, new Date().toISOString()).first<{ n: number }>();
      expect(leases!.n).toBeGreaterThan(0);
      await env.DB.prepare("UPDATE site_versions SET state = 'superseded', superseded_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(base!.active_version_id).run();
      expect(await retireVersion(env.DB, base!.active_version_id)).toBe(false);
    }
    return original(...args);
  }) as R2Bucket["get"];
  try {
    const result = await json(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(token), body: zipSync({ "new.txt": strToU8("new") }) });
    expect(result.status).toBe(200);
    expect(checked).toBe(true);
    expect(await (await req(`${site.url}keep.txt`)).text()).toBe("keep");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM site_operation_leases WHERE version_id = ?").bind(base!.active_version_id).first<{ n: number }>())!.n).toBe(0);
  } finally { env.BUCKET.get = original; }
});


it("cancels a stalled request body when preparation renewal loses ownership", async () => {
  const { env } = await import("cloudflare:test");
  const { requireToken } = await import("../src/auth");
  const { deploymentApi } = await import("../src/site-deployment-api");
  const token = await mint("cancel-lost-owner");
  const site = await createSite(token, "cancel-lost-owner");
  const created = await json(`/v1/sites/${site.id}/deployments`, { method: "POST", headers: auth(token), body: JSON.stringify({
    expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
    files: [{ path: "index.html", size: 5, sha256: await sha256Hex("hello"), content_type: "text/html" }],
  }) });
  const id = created.body.deployment_id;

  const actor = await requireToken(new Request("http://localhost", { headers: auth(token) }), env);

  const callbacks: Array<() => void> = [];
  const original = globalThis.setInterval;
  const timer = vi.spyOn(globalThis, "setInterval").mockImplementation((callback, delay, ...args) => {
    if (delay === 30_000) callbacks.push(() => (callback as (...values: unknown[]) => void)(...args));
    return original(callback, delay, ...args);
  });
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { started(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  try {

    const result = deploymentApi(new Request("http://localhost/upload", { method: "PUT", body }), env, actor, site.id, id, "files", "index.html");
    await reading;
    await env.DB.prepare("UPDATE site_deployments SET prepare_owner = 'replacement' WHERE id = ?").bind(id).run();
    expect(callbacks.length).toBeGreaterThan(0);
    for (const callback of callbacks) callback();
    const response = await result;
    expect(response.status).toBe(409);
    expect(cancelled).toBe(true);
    expect(await env.DB.prepare("SELECT path FROM site_version_files WHERE version_id = (SELECT version_id FROM site_deployments WHERE id = ?)").bind(id).first()).toBeNull();
  } finally { timer.mockRestore(); }
});


it("requires the controlled baseline before new legacy deployment or import sessions", async () => {
  const { env } = await import("cloudflare:test");
  const token = await mint("legacy-session-barrier");
  const site = await createSite(token, "legacy-session-barrier");
  await env.DB.prepare("INSERT INTO site_files (site_id,path,size,content_type,updated_at,last_written_by) VALUES (?,'old.txt',3,'text/plain',?,'ada@esperlabs.app')")
    .bind(site.id, new Date().toISOString()).run();
  await env.BUCKET.put(`sites/${site.handle}/${site.id}/old.txt`, "old");
  const created = await json(`/v1/sites/${site.id}/deployments`, { method: "POST", headers: auth(token), body: JSON.stringify({
    expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`, files: [],
  }) });
  expect(created.status).toBe(409);
  expect(created.body.error).toBe("site_busy");
  const imported = await json(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(token), body: zipSync({ "new.txt": strToU8("new") }) });
  expect(imported.status).toBe(409);
  expect(imported.body.error).toBe("site_busy");
  expect(await env.DB.prepare("SELECT id FROM site_deployments WHERE site_id = ?").bind(site.id).first()).toBeNull();
  expect(await (await env.BUCKET.get(`sites/${site.handle}/${site.id}/old.txt`))!.text()).toBe("old");
});

it("resumes a synchronous import after a transient seal failure using the same retry identity", async () => {
  const { env } = await import("cloudflare:test");
  const token = await mint("sync-import-recovery");
  const site = await createSite(token, "sync-import-recovery");
  const key = `${Date.now()}.${crypto.randomUUID()}`;
  const archive = zipSync({ "index.html": strToU8("recovered") });
  const send = () => json(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(token, { "Idempotency-Key": key }), body: archive });
  await env.DB.prepare(`CREATE TRIGGER fail_recovery_seal BEFORE UPDATE OF state ON site_versions
    WHEN NEW.site_id = '${site.id}' AND NEW.state = 'sealed' BEGIN SELECT RAISE(ABORT, 'temporary seal failure'); END;`).run();
  try {
    expect((await send()).status).toBe(500);
    const staged = await env.DB.prepare("SELECT id, state FROM site_deployments WHERE site_id = ? AND idempotency_key = ?")
      .bind(site.id, key).first<{ id: string; state: string }>();
    expect(staged?.state).toBe("uploading");
    await env.DB.exec("DROP TRIGGER fail_recovery_seal");
    expect((await send()).status).toBe(200);
    expect(await (await req(site.url)).text()).toBe("recovered");
    const completed = await env.DB.prepare("SELECT id, state FROM site_deployments WHERE site_id = ? AND idempotency_key = ?")
      .bind(site.id, key).first();
    expect(completed).toEqual({ id: staged!.id, state: "committed" });
  } finally { await env.DB.exec("DROP TRIGGER IF EXISTS fail_recovery_seal"); }
});

it("applies ZIP expansion limits to archive entries rather than retained baseline bytes", async () => {
  const { env } = await import("cloudflare:test");
  const { requireToken } = await import("../src/auth");
  const { importSiteArchive } = await import("../src/site-deployment-api");
  const token = await mint("zip-retained-byte-limit");
  const site = await createSite(token, "zip-retained-byte-limit");
  expect((await req(`/v1/sites/${site.id}/files/keep.txt`, { method: "PUT", headers: auth(token), body: "large retained file" })).status).toBe(201);
  const actor = await requireToken(new Request("http://localhost", { headers: auth(token) }), env);
  const response = await importSiteArchive(new Request(`http://localhost/v1/sites/${site.id}/import`, {
    method: "POST", headers: auth(token), body: zipSync({ "new.txt": strToU8("new") }),
  }), { ...env, MAX_ZIP_EXTRACTED_BYTES: "3" }, actor, site.id);
  expect(response.status).toBe(200);
  expect(await (await req(`${site.url}keep.txt`)).text()).toBe("large retained file");
  expect(await (await req(`${site.url}new.txt`)).text()).toBe("new");
});

it("permits an over-limit baseline ZIP repair but rejects growth before reserving copies", async () => {
  const { env } = await import("cloudflare:test");
  const token = await mint("zip-grandfather-count");
  const site = await createSite(token, "zip-grandfather-count");
  const version = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO site_versions (id,site_id,state,created_at) VALUES (?,?,'candidate',?)")
    .bind(version, site.id, new Date().toISOString()).run();
  const digest = await sha256Hex("");
  const paths = Array.from({ length: 201 }, (_, i) => `file-${i}.txt`);
  for (const path of paths) {
    const key = `site-versions/${site.id}/${version}/${path}`;
    await env.BUCKET.put(key, "");
    await env.DB.prepare("INSERT INTO site_version_files (version_id,path,allocation_id,object_key,size,sha256,content_type) VALUES (?,?,?,?,0,?,'text/plain; charset=utf-8')")
      .bind(version, path, crypto.randomUUID(), key, digest).run();
  }
  await env.DB.prepare("UPDATE site_versions SET state = 'active', file_count = 201 WHERE id = ?").bind(version).run();
  await env.DB.prepare("UPDATE sites SET active_version_id = ?, content_generation = 1, conversion_state = 'versioned' WHERE id = ?")
    .bind(version, site.id).run();
  const repaired = await json(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(token), body: zipSync({ "file-0.txt": strToU8("fixed") }) });
  expect(repaired.status).toBe(200);
  expect(await (await req(`${site.url}file-0.txt`)).text()).toBe("fixed");
  const key = `${Date.now()}.${crypto.randomUUID()}`;
  const rejected = await json(`/v1/sites/${site.id}/import`, {
    method: "POST", headers: auth(token, { "Idempotency-Key": key }), body: zipSync({ "new.txt": strToU8("new") }),
  });
  expect(rejected.status).toBe(400);
  expect(rejected.body.error).toBe("too_many_files");
  const rows = (await env.DB.prepare(`SELECT a.kind FROM storage_allocations a JOIN site_deployments d ON d.id = a.deployment_id
    WHERE d.site_id = ? AND d.idempotency_key = ?`).bind(site.id, key).all<{ kind: string }>()).results;
  expect(rows.map(row => row.kind)).toEqual(["input:\0archive"]);
  expect((await req(`${site.url}new.txt`)).status).toBe(404);
}, 120_000);

it("does not terminate a synchronous import when another retry holds preparation ownership", async () => {
  const { env } = await import("cloudflare:test");
  const token = await mint("sync-import-locked-retry");
  const site = await createSite(token, "sync-import-locked-retry");
  const key = `${Date.now()}.${crypto.randomUUID()}`;
  const archive = zipSync({ "index.html": strToU8("winner") });
  const staged = await json(`/v1/sites/${site.id}/import`, {
    method: "POST", headers: auth(token, { "Idempotency-Key": key, Prefer: "respond-async" }), body: archive,
  });
  expect(staged.status).toBe(202);
  await env.DB.prepare("UPDATE site_deployments SET prepare_owner = 'concurrent-retry', prepare_expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() + 120_000).toISOString(), staged.body.deployment_id).run();
  const send = () => json(`/v1/sites/${site.id}/import`, {
    method: "POST", headers: auth(token, { "Idempotency-Key": key }), body: archive,
  });
  expect((await send()).status).toBe(409);
  const row = await env.DB.prepare("SELECT state, prepare_owner, last_error FROM site_deployments WHERE id = ?")
    .bind(staged.body.deployment_id).first<{ state: string; prepare_owner: string; last_error: string }>();
  expect(row).toMatchObject({ state: "uploading", prepare_owner: "concurrent-retry" });
  expect(row!.last_error).toContain("Another preparation");
  await env.DB.prepare("UPDATE site_deployments SET prepare_owner = NULL, prepare_expires_at = NULL WHERE id = ?")
    .bind(staged.body.deployment_id).run();
  expect((await send()).status).toBe(200);
  expect(await (await req(site.url)).text()).toBe("winner");
});
