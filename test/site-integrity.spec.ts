import { env } from "cloudflare:test";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_FILES } from "../src/config";
import { hashSharePassword, hashWritePassword } from "../src/gate";
import { sweepSiteStorage } from "../src/site-storage";
import { getSiteById, patchSite } from "../src/sites";
import { auth, createSite as postSite, json, mint, req } from "./helpers";
import { withD1Trigger } from "./mutation-harness";

describe("site metadata patch integrity", () => {
  it("commits combined access and retention fields before purging, and skips purging unchanged content", async () => {
    const token = await mint("site-patch-combined");
    const site = await postSite(token, "site-patch-combined");
    const actor = { email: "ada@esperlabs.app", via: "token" } as const;
    const purgeSnapshots: unknown[] = [];
    const ctx = {
      cache: {
        purge: async (options: { pathPrefixes: string[] }) => {
          expect(options.pathPrefixes).toEqual([`/ada/s/${site.id}/`]);
          purgeSnapshots.push(await getSiteById(env, site.id));
        },
      },
    } as unknown as ExecutionContext;

    const response = await patchSite(env, actor, site.id, {
      password: " view-pw ", write_password: " write-pw ", setTtl: true, ttl: "7d", write_policy: "owner",
    }, ctx);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(body).toMatchObject({
      password_protected: true, password: "view-pw", write_password_protected: true, write_password: "write-pw",
      ttl: "7d", write_policy: "owner",
    });
    const committed = await getSiteById(env, site.id);
    expect(committed).toMatchObject({
      password_hash: await hashSharePassword("view-pw"), password_secret: "view-pw",
      write_password_hash: await hashWritePassword("write-pw"), write_password_secret: "write-pw",
      expires_at: (body as { expires_at: string }).expires_at, write_policy: "owner", last_written_by: actor.email,
      written_via: null,
    });
    expect(purgeSnapshots).toEqual([committed]);

    await patchSite(env, actor, site.id, {}, ctx);
    expect(await getSiteById(env, site.id)).toEqual(committed);
    await patchSite(env, actor, site.id, { write_policy: "org" }, ctx);
    expect((await getSiteById(env, site.id))?.write_policy).toBe("org");
    expect(purgeSnapshots).toHaveLength(1);
  });

  it("keeps attribution for admin TTL-only patches without bypassing creator checks or validation order", async () => {
    const token = await mint("site-patch-admin-ttl");
    const site = await postSite(token, "site-patch-admin-ttl", { write_policy: "owner" });
    const timestamp = "2026-01-01T00:00:00.000Z";
    await env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ?, written_via = ? WHERE id = ?`)
      .bind(timestamp, "guest", "write_password", site.id).run();
    const admin = { email: "admin@esperlabs.app", via: "token", admin: true } as const;
    const response = await patchSite(env, admin, site.id, { setTtl: true, ttl: "7d" }, undefined, true);
    expect(await response.json()).toMatchObject({ ttl: "7d", write_policy: "owner" });
    const committed = await getSiteById(env, site.id);
    expect(committed).toMatchObject({ updated_at: timestamp, last_written_by: "guest", written_via: "write_password" });

    for (const patch of [{ password: "view-pw" }, { write_password: undefined }, { write_policy: "invalid" }]) {
      await expect(patchSite(env, admin, site.id, patch, undefined, true)).rejects.toMatchObject({
        status: 403, code: "forbidden_write_policy", message: "Only the creator can change who can write this.",
      });
    }
    await expect(patchSite(env, admin, site.id, {
      write_password: "x".repeat(129), password: "view-pw", setTtl: true, ttl: "invalid",
    }, undefined, true)).rejects.toMatchObject({
      status: 400, code: "bad_password", message: "Write password is too long (max 128 characters).",
    });
    expect(await getSiteById(env, site.id)).toEqual(committed);
  });
});

async function createSite(token: string, slug: string, files: Record<string, string> = { "index.html": "original" }) {
  const created = await postSite(token, slug);
  expect(created.status).toBe(201);
  for (const [path, body] of Object.entries(files)) {
    expect((await json(`/v1/sites/${created.id}/files/${path}`, { method: "PUT", headers: auth(token), body })).status).toBe(201);
  }
  return created;
}

async function snapshot(id: string) {
  const site = await env.DB.prepare("SELECT active_version_id, content_generation, lifecycle_state FROM sites WHERE id = ?").bind(id)
    .first<{ active_version_id: string; content_generation: number; lifecycle_state: string }>();
  const files = (await env.DB.prepare("SELECT path, object_key, size FROM site_version_files WHERE version_id = ? ORDER BY path")
    .bind(site!.active_version_id).all<{ path: string; object_key: string; size: number }>()).results;
  return { site, files, bytes: await Promise.all(files.map(async file => [file.path, await (await env.BUCKET.get(file.object_key))!.text()])) };
}

async function failPart<T>(number: number, run: () => Promise<T>) {
  const original = env.BUCKET.createMultipartUpload.bind(env.BUCKET);
  let parts = 0;
  env.BUCKET.createMultipartUpload = async (...args) => {
    const upload = await original(...args);
    const uploadPart = upload.uploadPart.bind(upload);
    upload.uploadPart = async (...partArgs) => {
      if (++parts === number) throw new Error("injected multipart failure");
      return uploadPart(...partArgs);
    };
    return upload;
  };
  try { const result = await run(); expect(parts).toBeGreaterThanOrEqual(number); return result; } finally { env.BUCKET.createMultipartUpload = original; }
}

function importZip(token: string, id: string, files: Record<string, string>) {
  return json(`/v1/sites/${id}/import`, { method: "POST", headers: auth(token, { "content-type": "application/zip" }),
    body: zipSync(Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, strToU8(bytes)]))) });
}

function failPublication<T>(id: string, run: () => Promise<T>) {
  return withD1Trigger(env.DB, "fail_publication", `CREATE TRIGGER fail_publication BEFORE UPDATE OF active_version_id ON sites
    WHEN OLD.id = '${id}' AND NEW.active_version_id IS NOT OLD.active_version_id
    BEGIN SELECT RAISE(ABORT, 'injected publication failure'); END`, run);
}

describe("site mutation integrity", () => {
  it("keeps the complete old version after a later multipart import write fails", async () => {
    const token = await mint("integrity-multipart");
    const site = await createSite(token, "integrity-multipart", { "a.txt": "old-a", "b.txt": "old-b" });
    const before = await snapshot(site.id);
    const response = await failPart(3, () => importZip(token, site.id, { "a.txt": "new-a", "b.txt": "new-b" }));
    expect(response.status).toBe(500);
    expect(await snapshot(site.id)).toEqual(before);
  });

  it("keeps the old pointer and bytes after native publication abort and retains candidate charges", async () => {
    const token = await mint("integrity-native");
    const site = await createSite(token, "integrity-native", { "a.txt": "old-a", "b.txt": "old-b" });
    const before = await snapshot(site.id);
    const response = await failPublication(site.id, () => importZip(token, site.id, { "a.txt": "new-alpha", "b.txt": "new-b" }));
    expect(response.status).toBe(500);
    expect(await snapshot(site.id)).toEqual(before);
    const pending = await env.DB.prepare("SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM storage_allocations WHERE site_id = ? AND version_id != ? AND state != 'released'")
      .bind(site.id, before.site!.active_version_id).first<{ bytes: number }>();
    expect(pending!.bytes).toBeGreaterThan(0);
    for (const [path, bytes] of before.bytes) expect(await (await req(`/v1/sites/${site.id}/files/${path}`, { headers: auth(token) })).text()).toBe(bytes);
  });

  it("imports all 200 files without exceeding the D1 statement limit", async () => {
    const token = await mint("integrity-limit");
    const site = await createSite(token, "integrity-limit", {});
    const original = env.DB.batch.bind(env.DB);
    const sizes: number[] = [];
    env.DB.batch = async statements => { sizes.push(statements.length); expect(statements.length).toBeLessThanOrEqual(100); return original(statements); };
    const files = Object.fromEntries(Array.from({ length: MAX_IMPORT_FILES }, (_, i) => [`file-${String(i).padStart(3, "0")}.txt`, String(i)]));
    try { expect((await importZip(token, site.id, files)).status).toBe(200); } finally { env.DB.batch = original; }
    expect(sizes.length).toBeGreaterThan(0);
    expect((await snapshot(site.id)).bytes).toEqual(Object.entries(files));
  }, 15_000);

  it("hides a duplicate after its later storage write fails and preserves its source", async () => {
    const token = await mint("integrity-copy");
    const source = await createSite(token, "integrity-source", { "a.txt": "a", "b.txt": "b" });
    const before = await snapshot(source.id);
    const response = await failPart(2, () => json("/v1/sites", { method: "POST", headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "integrity-copy", duplicate_from: source.id }) }));
    expect(response.status).toBe(500);
    expect(await snapshot(source.id)).toEqual(before);
    expect((await json("/v1/sites?q=integrity-copy", { headers: auth(token) })).body.sites).toEqual([]);
  });

  it("hides a duplicate after native publication failure", async () => {
    const token = await mint("integrity-copy-db");
    const source = await createSite(token, "integrity-source-db");
    const before = await snapshot(source.id);
    const response = await withD1Trigger(env.DB, "fail_duplicate", `CREATE TRIGGER fail_duplicate BEFORE UPDATE OF active_version_id ON sites
      WHEN NEW.slug = 'integrity-copy-db' AND NEW.active_version_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'duplicate abort'); END`,
    () => json("/v1/sites", { method: "POST", headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "integrity-copy-db", duplicate_from: source.id }) }));
    expect(response.status).toBe(500);
    expect(await snapshot(source.id)).toEqual(before);
    expect((await json("/v1/sites?q=integrity-copy-db", { headers: auth(token) })).body.sites).toEqual([]);
  });

  it("finishes a duplicate from its selected version across publication and cleanup", async () => {
    const token = await mint("duplicate-selected-version");
    const source = await createSite(token, "duplicate-selected-source", { "a.txt": "old-a", "b.txt": "old-b" });
    const before = await snapshot(source.id);
    const original = env.BUCKET.get.bind(env.BUCKET);
    let interrupted = false;
    env.BUCKET.get = (async (...args: Parameters<R2Bucket["get"]>) => {
      if (!interrupted && args[0] === before.files[0].object_key) {
        interrupted = true;
        expect((await importZip(token, source.id, { "a.txt": "new-a", "b.txt": "new-b" })).status).toBe(200);
        await env.DB.prepare("UPDATE site_versions SET superseded_at = ? WHERE id = ?")
          .bind("2000-01-01T00:00:00.000Z", before.site!.active_version_id).run();
        await sweepSiteStorage(env.DB, env.BUCKET);
        expect(await original(before.files[1].object_key)).not.toBeNull();
      }
      return original(...args);
    }) as R2Bucket["get"];
    try {
      const result = await json("/v1/sites", { method: "POST", headers: auth(token),
        body: JSON.stringify({ slug: "duplicate-selected-copy", duplicate_from: source.id }) });
      expect(result.status).toBe(201);
      expect(interrupted).toBe(true);
      expect((await snapshot(result.body.id)).bytes).toEqual(before.bytes);
      expect((await snapshot(source.id)).bytes).toEqual([["a.txt", "new-a"], ["b.txt", "new-b"]]);
    } finally { env.BUCKET.get = original; }
  });

  it("keeps a file after its deletion publication fails", async () => {
    const token = await mint("integrity-file-delete");
    const site = await createSite(token, "integrity-file-delete");
    const before = await snapshot(site.id);
    expect((await failPublication(site.id, () => json(`/v1/sites/${site.id}/files/index.html`, { method: "DELETE", headers: auth(token) }))).status).toBe(500);
    expect(await snapshot(site.id)).toEqual(before);
  });

  it("does not publish a duplicate after its source lease is lost during copying", async () => {
    const token = await mint("duplicate-lost-lease");
    const source = await createSite(token, "duplicate-lost-source");
    const before = await snapshot(source.id);
    const original = env.BUCKET.get.bind(env.BUCKET);
    let interrupted = false;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    env.BUCKET.get = (async (...args: Parameters<R2Bucket["get"]>) => {
      if (!interrupted && args[0] === before.files[0].object_key) {
        interrupted = true;
        await env.DB.prepare("DELETE FROM site_operation_leases WHERE version_id = ? AND operation = 'duplicate'")
          .bind(before.site!.active_version_id).run();
        await vi.advanceTimersByTimeAsync(30_000);
      }
      return original(...args);
    }) as R2Bucket["get"];
    try {
      const result = await json("/v1/sites", { method: "POST", headers: auth(token),
        body: JSON.stringify({ slug: "duplicate-lost-copy", duplicate_from: source.id }) });
      expect(interrupted).toBe(true);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect((await json("/v1/sites?q=duplicate-lost-copy", { headers: auth(token) })).body.sites).toEqual([]);
    } finally { env.BUCKET.get = original; vi.useRealTimers(); }
  });

  it("retains deleted bytes and charges when cleanup fails, then releases after confirmed deletion", async () => {
    const token = await mint("integrity-cleanup");
    const site = await createSite(token, "integrity-cleanup");
    const before = await snapshot(site.id);
    const allocation = await env.DB.prepare("SELECT id FROM storage_allocations WHERE object_key = ?").bind(before.files[0].object_key).first<{ id: string }>();
    const original = env.BUCKET.delete.bind(env.BUCKET);
    env.BUCKET.delete = async keys => { if ((Array.isArray(keys) ? keys : [keys]).includes(before.files[0].object_key)) throw new Error("cleanup unavailable"); return original(keys); };
    try {
      expect((await json(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(token) })).status).toBe(200);
      await sweepSiteStorage(env.DB, env.BUCKET, new Date(Date.now() + 3 * 60_000));
      await sweepSiteStorage(env.DB, env.BUCKET, new Date(Date.now() + 10 * 60_000));
      expect((await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) })).status).toBe(404);
      expect(await (await env.BUCKET.get(before.files[0].object_key))!.text()).toBe("original");
      expect(await env.DB.prepare("SELECT state, released_at, cleanup_error FROM storage_allocations WHERE id = ?").bind(allocation!.id).first())
        .toMatchObject({ state: "deleting", released_at: null, cleanup_error: "Error: cleanup unavailable" });
    } finally { env.BUCKET.delete = original; }
    const charged = await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>();
    expect(charged!.used).toBeGreaterThanOrEqual(before.files[0].size);
    await sweepSiteStorage(env.DB, env.BUCKET, new Date(Date.now() + 15 * 60_000));
    const released = await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>();
    expect(released!.used).toBeLessThanOrEqual(charged!.used - before.files[0].size);
    expect(await env.BUCKET.get(before.files[0].object_key)).toBeNull();
    expect(await env.DB.prepare("SELECT state FROM storage_allocations WHERE id = ?").bind(allocation!.id).first()).toEqual({ state: "released" });
  });

  it("keeps the site live when its logical deletion transaction aborts", async () => {
    const token = await mint("integrity-tombstone");
    const site = await createSite(token, "integrity-tombstone");
    const before = await snapshot(site.id);
    const response = await withD1Trigger(env.DB, "fail_tombstone", `CREATE TRIGGER fail_tombstone BEFORE UPDATE OF lifecycle_state ON sites
      WHEN OLD.id = '${site.id}' AND NEW.lifecycle_state = 'deleted' BEGIN SELECT RAISE(ABORT, 'tombstone abort'); END`,
    () => json(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(token) }));
    expect(response.status).toBe(500);
    expect(await snapshot(site.id)).toEqual(before);
  });
});
