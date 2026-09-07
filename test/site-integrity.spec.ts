import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_FILES } from "../src/config";
import { auth, createSite as postSite, json, mint, req } from "./helpers";
import { withD1Trigger } from "./mutation-harness";

const D1_BATCH_LIMIT = 100;

async function createSite(token: string, slug: string, files: Record<string, string> = { "index.html": "original" }) {
  const created = await postSite(token, slug);
  if (created.status !== 201) throw new Error(`createSite ${slug} failed: ${created.status}`);
  for (const [path, body] of Object.entries(files)) {
    await json(`/v1/sites/${created.id}/files/${path}`, {
      method: "PUT",
      headers: auth(token),
      body,
    });
  }
  return created;
}

describe("site mutation integrity", () => {
  it("restores every affected path when an import fails after an R2 write", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-import");
    const site = await createSite(token, "integrity-import", { "a.txt": "old-a", "b.txt": "old-b" });
    const bucket = env.BUCKET;
    const originalPut = bucket.put.bind(bucket);
    let writes = 0;
    bucket.put = async (...args) => {
      writes += 1;
      if (writes === 2) throw new Error("injected import storage failure");
      return originalPut(...args);
    };
    try {
      const zipped = zipSync({ "a.txt": strToU8("new-a"), "b.txt": strToU8("new-b") });
      const response = await json(`/v1/sites/${site.id}/import`, {
        method: "POST",
        headers: auth(token, { "content-type": "application/zip" }),
        body: zipped,
      });
      expect(response.status).toBe(500);
    } finally {
      bucket.put = originalPut;
    }
    for (const path of ["a.txt", "b.txt"]) {
      const response = await req(`/v1/sites/${site.id}/files/${path}`, { headers: auth(token) });
      expect(await response.text()).toBe(`old-${path[0]}`);
    }
  });

  it("restores bytes and metadata when an import metadata write fails", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-import-db");
    const site = await createSite(token, "integrity-import-db", { "a.txt": "old-a", "b.txt": "old-b" });
    const response = await withD1Trigger(
      env.DB,
      "fail_native_import_metadata",
      `CREATE TRIGGER fail_native_import_metadata
       BEFORE UPDATE OF size ON site_files
       WHEN NEW.site_id = '${site.id}' AND NEW.path = 'a.txt' AND NEW.size = 9
       BEGIN
         SELECT RAISE(ABORT, 'test import metadata abort');
       END`,
      () => json(`/v1/sites/${site.id}/import`, {
        method: "POST",
        headers: auth(token, { "content-type": "application/zip" }),
        body: zipSync({ "a.txt": strToU8("new-alpha"), "b.txt": strToU8("new-b") }),
      }),
    );
    expect(response.status).toBe(500);
    const listing = await json(`/v1/sites/${site.id}`, { headers: auth(token) });
    expect(listing.body.files.map((file: { path: string; size: number }) => [file.path, file.size])).toEqual([
      ["a.txt", 5],
      ["b.txt", 5],
    ]);
    for (const path of ["a.txt", "b.txt"]) {
      const response = await req(`/v1/sites/${site.id}/files/${path}`, { headers: auth(token) });
      expect(await response.text()).toBe(`old-${path[0]}`);
    }
  });

  it("keeps max-size import metadata batches within the D1 statement limit", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-import-batch-limit");
    const site = await createSite(token, "integrity-import-batch-limit", {});
    const db = env.DB;
    const originalBatch = db.batch.bind(db);
    const batchSizes: number[] = [];
    db.batch = async (statements) => {
      batchSizes.push(statements.length);
      if (statements.length > D1_BATCH_LIMIT) throw new Error("D1 batch statement limit exceeded");
      return originalBatch(statements);
    };
    try {
      const files = Object.fromEntries(
        Array.from({ length: MAX_IMPORT_FILES }, (_, index) => [`file-${index.toString().padStart(3, "0")}.txt`, strToU8(String(index))]),
      );
      const response = await json(`/v1/sites/${site.id}/import`, {
        method: "POST",
        headers: auth(token, { "content-type": "application/zip" }),
        body: zipSync(files),
      });
      expect(response.status).toBe(200);
    } finally {
      db.batch = originalBatch;
    }
    expect(batchSizes).toEqual([D1_BATCH_LIMIT, D1_BATCH_LIMIT]);
  }, 15_000);

  it("cleans up a duplicate when a later R2 copy fails", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-duplicate");
    const source = await createSite(token, "integrity-source", { "a.txt": "a", "b.txt": "b" });
    const bucket = env.BUCKET;
    const originalPut = bucket.put.bind(bucket);
    let destinationWrites = 0;
    bucket.put = async (key, ...args) => {
      if (typeof key === "string" && key.startsWith("sites/") && !key.includes(`/${source.id}/`)) {
        destinationWrites += 1;
        if (destinationWrites === 2) throw new Error("injected duplicate storage failure");
      }
      return originalPut(key, ...args);
    };
    try {
      const response = await json("/v1/sites", {
        method: "POST",
        headers: auth(token, { "content-type": "application/json" }),
        body: JSON.stringify({ slug: "integrity-copy", duplicate_from: source.id }),
      });
      expect(response.status).toBe(500);
    } finally {
      bucket.put = originalPut;
    }
    const listing = await json("/v1/sites?q=integrity-copy", { headers: auth(token) });
    expect((listing.body.sites || []).some((s: { slug: string }) => s.slug === "integrity-copy")).toBe(false);
  });

  it("cleans up a duplicate when destination metadata fails", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-duplicate-db");
    const source = await createSite(token, "integrity-source-db", { "a.txt": "a", "b.txt": "b" });
    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.startsWith("INSERT INTO site_files")) throw new Error("injected duplicate metadata failure");
      return originalPrepare(sql);
    }) as typeof db.prepare;
    try {
      const response = await json("/v1/sites", {
        method: "POST",
        headers: auth(token, { "content-type": "application/json" }),
        body: JSON.stringify({ slug: "integrity-copy-db", duplicate_from: source.id }),
      });
      expect(response.status).toBe(500);
    } finally {
      db.prepare = originalPrepare;
    }
    const listing = await json("/v1/sites?q=integrity-copy-db", { headers: auth(token) });
    expect((listing.body.sites || []).some((s: { slug: string }) => s.slug === "integrity-copy-db")).toBe(false);
  });

  it("keeps a site file when its delete metadata batch fails", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-delete-file");
    const site = await createSite(token, "integrity-delete-file");
    const db = env.DB;
    const originalBatch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error("injected delete metadata failure");
    };
    try {
      const response = await json(`/v1/sites/${site.id}/files/index.html`, {
        method: "DELETE",
        headers: auth(token),
      });
      expect(response.status).toBe(500);
    } finally {
      db.batch = originalBatch;
    }
    const file = await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) });
    expect(await file.text()).toBe("original");
  });

  it("restores a site when its R2 deletion fails after staging", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-delete-site-r2");
    const site = await createSite(token, "integrity-delete-site-r2");
    const bucket = env.BUCKET;
    const originalDelete = bucket.delete.bind(bucket);
    bucket.delete = async (keys) => {
      const values = Array.isArray(keys) ? keys : [keys];
      if (values.some((key) => key.includes(`sites/ada/${site.id}/`))) {
        throw new Error("injected site deletion failure");
      }
      return originalDelete(keys);
    };
    try {
      const response = await json(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(token) });
      expect(response.status).toBe(500);
    } finally {
      bucket.delete = originalDelete;
    }
    const file = await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) });
    expect(await file.text()).toBe("original");
  });

  it("does not turn a failed backup copy into a rollback failure", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("site-integrity-delete-site-staging");
    const site = await createSite(token, "integrity-delete-site-staging");
    const bucket = env.BUCKET;
    const originalPut = bucket.put.bind(bucket);
    bucket.put = async (key, ...args) => {
      if (typeof key === "string" && key.includes("sites/.integrity-backup/")) throw new Error("injected backup staging failure");
      return originalPut(key, ...args);
    };
    try {
      const response = await json(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(token) });
      expect(response.status).toBe(500);
      expect(response.body.error).not.toBe("site_delete_rollback_failed");
    } finally {
      bucket.put = originalPut;
    }
  });
});
