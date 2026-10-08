import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createLooseFile, deleteLooseFile, patchLoose, putLooseFile } from "../src/files";
import { uploadFromBytes } from "../src/upload";
import type { Actor, Env } from "../src/types";
import { auth, json, mint } from "./helpers";

describe("patchLoose preparation", () => {
  it("distinguishes omitted fields from present undefined fields without mutating the file", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("patch-field-presence");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "field-presence.txt" }),
      body: "original",
    });
    const id = String(created.body.id);
    const before = await env.DB.prepare("SELECT * FROM loose_files WHERE id = ?").bind(id).first();
    const creator: Actor = { email: "ada@esperlabs.app", via: "token" };
    const coworker: Actor = { email: "bob@esperlabs.app", via: "token" };

    expect((await patchLoose(env, coworker, id, {})).status).toBe(200);
    await expect(patchLoose(env, coworker, id, { write_password: undefined })).rejects.toMatchObject({
      status: 403,
      code: "forbidden_write_policy",
      message: "Only the creator can change who can write this.",
    });
    await expect(patchLoose(env, creator, id, { write_policy: undefined })).rejects.toMatchObject({
      status: 400,
      code: "bad_write_policy",
      message: "write_policy must be owner or org.",
    });
    expect(await env.DB.prepare("SELECT * FROM loose_files WHERE id = ?").bind(id).first()).toEqual(before);
  });

  it("retains policy authorization, write-password validation, and share-password authorization precedence", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("patch-validation-order");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "validation-order.txt" }),
      body: "original",
    });
    const id = String(created.body.id);
    const before = await env.DB.prepare("SELECT * FROM loose_files WHERE id = ?").bind(id).first();
    const coworker: Actor = { email: "bob@esperlabs.app", via: "token" };
    const overlong = "x".repeat(129);

    await expect(patchLoose(env, coworker, id, { write_policy: "invalid", write_password: overlong })).rejects.toMatchObject({
      status: 403,
      code: "forbidden_write_policy",
    });
    await expect(patchLoose(env, coworker, id, { write_password: overlong, password: overlong })).rejects.toMatchObject({
      status: 400,
      code: "bad_password",
      message: "Write password is too long (max 128 characters).",
    });
    await expect(patchLoose(env, coworker, id, { password: overlong })).rejects.toMatchObject({
      status: 403,
      code: "forbidden_write_policy",
    });
    expect(await env.DB.prepare("SELECT * FROM loose_files WHERE id = ?").bind(id).first()).toEqual(before);
  });
});

describe("putLooseFile", () => {
  it("succeeds and purges cached content when renamed-file cleanup fails", async () => {
    const oldKey = "files/Abc123/old.txt";
    const newKey = "files/Abc123/new.txt";
    const objects = new Map([
      [oldKey, { bytes: new TextEncoder().encode("original"), contentType: "text/plain" }],
    ]);
    const bucket = {
      async get(objectKey: string) {
        const object = objects.get(objectKey);
        if (!object) return null;
        return {
          bytes: async () => object.bytes.slice(),
          httpMetadata: { contentType: object.contentType },
        };
      },
      async put(objectKey: string, value: ArrayBufferView, options?: R2PutOptions) {
        objects.set(objectKey, {
          bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
          contentType: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType || "",
        });
        return {};
      },
      async delete(objectKey: string) {
        if (objectKey === oldKey) throw new Error("injected R2 delete failure");
        objects.delete(objectKey);
      },
    };
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id FROM storage_allocations")) return { id: "reservation" };
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "old.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                write_policy: "org",
              };
            }
            if (sql.includes("COALESCE(SUM(size)")) return { total: 8 };
            if (sql.includes("SELECT password_hash")) return { password_hash: null };
            return null;
          },
          async run() {
            return sql.includes("UPDATE loose_files") ? { meta: { changes: 1 }, results: [{ content_generation: 2 }] } : {};
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const purged: string[][] = [];
    const ctx = {
      cache: {
        async purge({ pathPrefixes }: { pathPrefixes: string[] }) {
          purged.push(pathPrefixes);
        },
      },
      waitUntil(promise: Promise<unknown>) {
        void promise;
      },
    } as unknown as ExecutionContext;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    const response = await putLooseFile(
      env,
      ctx,
      actor,
      "Abc123",
      uploadFromBytes(new TextEncoder().encode("replacement")),
      "new.txt",
      "text/plain",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filename: "new.txt", replaced: true });
    expect(new TextDecoder().decode(objects.get(newKey)?.bytes)).toBe("replacement");
    expect(purged).toEqual([["/ada/f/Abc123/"]]);
  });

  it("fails the replacement when cache purge rejects", async () => {
    const key = "files/Abc123/notes.txt";
    const objects = new Map([
      [key, { bytes: new TextEncoder().encode("original"), contentType: "text/plain" }],
    ]);
    const bucket = {
      async get() {
        return {
          bytes: async () => objects.get(key)!.bytes.slice(),
          httpMetadata: { contentType: "text/plain" },
        };
      },
      async put() {
        return {};
      },
      async delete() {},
    };
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id FROM storage_allocations")) return { id: "reservation" };
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                write_policy: "org",
              };
            }
            if (sql.includes("COALESCE(SUM(size)")) return { total: 8 };
            if (sql.includes("SELECT password_hash")) return { password_hash: null };
            return null;
          },
          async run() {
            return sql.includes("UPDATE loose_files") ? { meta: { changes: 1 }, results: [{ content_generation: 2 }] } : {};
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const ctx = {
      cache: {
        async purge() {
          throw new Error("purge rejected");
        },
      },
      waitUntil() {},
    } as unknown as ExecutionContext;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };
    await expect(
      putLooseFile(env, ctx, actor, "Abc123", uploadFromBytes(new TextEncoder().encode("replacement")), "notes.txt", "text/plain"),
    ).rejects.toThrow(/purge rejected/);
  });

  it("restores same-filename content when the D1 update fails", async () => {
    const key = "files/Abc123/notes.txt";
    const objects = new Map([
      [key, { bytes: new TextEncoder().encode("original"), contentType: "text/plain" }],
    ]);
    const bucket = {
      async get(objectKey: string) {
        const object = objects.get(objectKey);
        if (!object) return null;
        return {
          bytes: async () => object.bytes.slice(),
          httpMetadata: { contentType: object.contentType },
        };
      },
      async put(objectKey: string, value: ArrayBufferView, options?: R2PutOptions) {
        objects.set(objectKey, {
          bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
          contentType: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType || "",
        });
        return {};
      },
      async delete(objectKey: string) {
        objects.delete(objectKey);
      },
    };
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                write_policy: "org",
              };
            }
            if (sql.includes("COALESCE(SUM(size)")) return { total: 8 };
            return null;
          },
          async run() {
            if (sql.includes("platform_quota")) return { meta: { changes: 1 } };
            throw new Error("injected D1 failure");
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    await expect(
      putLooseFile(env, undefined, actor, "Abc123", uploadFromBytes(new TextEncoder().encode("replacement")), "notes.txt", "text/plain"),
    ).rejects.toThrow("injected D1 failure");

    expect(new TextDecoder().decode(objects.get(key)?.bytes)).toBe("original");
    expect(objects.get(key)?.contentType).toBe("text/plain");
  });

  it("rejects a replacement before writing when the content origin is unavailable", async () => {
    let writes = 0;
    const bucket = {
      async get() {
        return null;
      },
      async put() {
        writes += 1;
      },
      async delete() {},
    };
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                size: 8,
                created_by: "ada@esperlabs.app",
                write_policy: "owner",
              };
            }
            return null;
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    await expect(
      putLooseFile(env, undefined, actor, "Abc123", uploadFromBytes(new TextEncoder().encode("replacement")), "notes.txt", "text/plain"),
    ).rejects.toMatchObject({ status: 503, code: "content_origin_not_configured" });
    expect(writes).toBe(0);
  });

  it("does not reserve storage when the write claim is lost", async () => {
    let quotaIncrements = 0;
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                updated_at: "2026-09-02T00:00:00.000Z",
                write_policy: "org",
              };
            }
            if (sql.includes("SELECT expires_at, last_written_by")) {
              return { expires_at: null, last_written_by: "ada@esperlabs.app" };
            }
            return null;
          },
          async run() {
            if (sql.includes("platform_quota") && sql.includes("used + ?")) {
              quotaIncrements += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: { async get() { return null; }, async put() {}, async delete() {} },
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };
    await expect(
      putLooseFile(env, undefined, actor, "Abc123", uploadFromBytes(new TextEncoder().encode("replacement")), "notes.txt", "text/plain"),
    ).rejects.toMatchObject({ status: 409, code: "file_busy" });
    expect(quotaIncrements).toBe(0);
  });

  it("releases the write claim when the storage cap rejects the replacement", async () => {
    let claimReleases = 0;
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id, handle, filename, size")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                updated_at: "2026-09-02T00:00:00.000Z",
                write_policy: "org",
              };
            }
            if (sql.includes("SELECT used FROM platform_quota")) {
              return { used: 20 * 1024 * 1024 * 1024 };
            }
            return null;
          },
          async run() {
            if (sql.includes("SET last_written_by = ?, updated_at = ? WHERE id = ? AND last_written_by = ?")) {
              claimReleases += 1;
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE loose_files SET last_written_by = ?, updated_at = ?")) {
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE loose_files SET last_written_by = ? WHERE id = ?")) {
              claimReleases += 1;
              return { meta: { changes: 1 } };
            }
            if (sql.includes("platform_quota") && sql.includes("used + ?")) {
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: { async get() { return null; }, async put() {}, async delete() {} },
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };
    await expect(
      putLooseFile(env, undefined, actor, "Abc123", uploadFromBytes(new TextEncoder().encode("replacement")), "notes.txt", "text/plain"),
    ).rejects.toMatchObject({ status: 413, code: "storage_cap" });
    expect(claimReleases).toBe(1);
  });
});

describe("createLooseFile", () => {
  it("does not reserve storage when write_policy is invalid", async () => {
    let quotaIncrements = 0;
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("FROM users")) {
              return { id: "u1", email: "ada@esperlabs.app", handle: "ada", idp_sub: null };
            }
            return null;
          },
          async run() {
            if (sql.includes("platform_quota") && sql.includes("used + ?")) {
              quotaIncrements += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: { async put() {}, async delete() {} },
      PUBLIC_ORIGIN: "https://hub.energon.example.com",
      CONTENT_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };
    await expect(
      createLooseFile(env, undefined, actor, "notes.txt", uploadFromBytes(new TextEncoder().encode("hi")), "text/plain", undefined, undefined, "nope"),
    ).rejects.toMatchObject({ status: 400, code: "bad_write_policy" });
    expect(quotaIncrements).toBe(0);
  });
});

describe("deleteLooseFile", () => {
  it("reports a row removed during claim acquisition as expired", async () => {
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("SELECT id, handle, filename")) {
              return {
                id: "Abc123",
                handle: "ada",
                filename: "notes.txt",
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                updated_at: "2026-09-02T00:00:00.000Z",
                write_policy: "owner",
              };
            }
            return null;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: { get: async () => null, delete: async () => undefined },
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    await expect(deleteLooseFile(env, undefined, actor, "Abc123")).rejects.toMatchObject({
      status: 410,
      code: "expired",
    });
  });

  it("restores file bytes when the D1 delete fails", async () => {
    const key = "files/Abc123/notes.txt";
    const original = new TextEncoder().encode("original");
    const objects = new Map<string, Uint8Array>([[key, original]]);
    const bucket = {
      async get(objectKey: string) {
        const bytes = objects.get(objectKey);
        if (!bytes) return null;
        return {
          bytes: async () => bytes.slice(),
          httpMetadata: { contentType: "text/plain" },
          customMetadata: { retained: "yes" },
        };
      },
      async delete(objectKey: string) {
        objects.delete(objectKey);
      },
      async put(objectKey: string, value: Uint8Array) {
        objects.set(objectKey, value.slice());
      },
    };
    let lastWrittenBy = "ada@esperlabs.app";
    const db = {
      async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(statement => statement.run())); },
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            if (!sql.includes("SELECT id, handle, filename")) return null;
            return {
              id: "Abc123",
              handle: "ada",
              filename: "notes.txt",
              expires_at: null,
              created_by: "ada@esperlabs.app",
              last_written_by: lastWrittenBy,
              updated_at: "2026-09-02T00:00:00.000Z",
              write_policy: "owner",
            };
          },
          async run() {
            if (sql.includes("updated_at = ?")) {
              lastWrittenBy = String(values[0]);
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("DELETE")) throw new Error("injected D1 delete failure");
            if (sql.includes("SET last_written_by = ?")) {
              lastWrittenBy = String(values[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
    const env = { DB: db, BUCKET: bucket } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    await expect(deleteLooseFile(env, undefined, actor, "Abc123")).rejects.toThrow(
      "injected D1 delete failure",
    );

    expect(new TextDecoder().decode(objects.get(key))).toBe("original");
    expect(lastWrittenBy).toBe("ada@esperlabs.app");
  });
});

describe("loose file content generation", () => {
  async function created(token: string, filename: string, body: string) {
    const res = await json("/v1/files", { method: "POST", headers: auth(token, { "X-Filename": filename, "content-type": "text/plain" }), body });
    expect(res.body.content_generation).toBe(1);
    return res.body as { id: string; url: string };
  }

  async function state(id: string) {
    const row = await env.DB.prepare("SELECT content_generation, size, last_written_by FROM loose_files WHERE id = ?").bind(id)
      .first<{ content_generation: number; size: number; last_written_by: string }>();
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM storage_allocations WHERE kind = 'legacy_reservation'
      AND state != 'released' AND json_extract(recovery_json, '$.fileId') = ?`).bind(id).first<{ n: number }>();
    const quota = await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>();
    return { ...row, pending: pending?.n, quota: quota?.used };
  }

  async function readBack(token: string, id: string) {
    const res = await SELF.fetch(`http://127.0.0.1/v1/files/${id}`, { headers: auth(token) });
    return { text: await res.text(), generation: res.headers.get("X-Energon-Content-Generation") };
  }

  it("counts byte replacements but not metadata patches", async () => {
    const token = await mint("generation-count");
    const file = await created(token, "count.txt", "one");
    const patched = await json(`/v1/files/${file.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ password: "pw", ttl: "7d", write_policy: "org", write_password: "wpw" }),
    });
    expect(patched.body.content_generation).toBe(1);
    const replaced = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, { "X-Filename": "renamed.txt" }), body: "two" });
    expect(replaced.body.content_generation).toBe(2);
    expect(await readBack(token, file.id)).toEqual({ text: "two", generation: "2" });
    const listed = await json("/v1/files?q=renamed.txt", { headers: auth(token) });
    expect(listed.body.files.find((f: { id: string }) => f.id === file.id).content_generation).toBe(2);
  });

  it("replaces only at the expected generation, over raw and multipart bodies", async () => {
    const token = await mint("generation-conditional");
    const file = await created(token, "draft.txt", "draft");
    const matched = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, { "X-Energon-Expected-Version": "1" }), body: "newer" });
    expect(matched.status).toBe(200);
    expect(matched.body.content_generation).toBe(2);
    const before = await state(file.id);

    const stale = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, { "X-Energon-Expected-Version": "1" }), body: "stale!" });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "file_conflict", content_generation: 2, expected_version: 1 });
    const form = new FormData();
    form.set("file", new File(["stale form"], "draft.txt", { type: "text/plain" }));
    form.set("expected_version", "1");
    const staleForm = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token), body: form });
    expect(staleForm.status).toBe(409);
    expect(staleForm.body.error).toBe("file_conflict");

    expect(await state(file.id)).toEqual(before);
    expect(await readBack(token, file.id)).toEqual({ text: "newer", generation: "2" });
    const malformed = await json(`/v1/files/${file.id}`, { method: "PUT", headers: auth(token, { "X-Energon-Expected-Version": "two" }), body: "x" });
    expect(malformed.body.error).toBe("bad_expected_version");
  });

  it("refuses at the commit when another replacement lands after the pre-check, and restores the bytes", async () => {
    const token = await mint("generation-commit-race");
    const file = await created(token, "race.txt", "original");
    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    let raced = false;
    // Lands a competing replacement right after putLooseFile reads the row it pre-checks.
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (raced || !sql.startsWith("SELECT id, handle, filename, size, content_type, expires_at")) return statement;
      raced = true;
      return {
        ...statement,
        bind: (...args: unknown[]) => {
          const bound = statement.bind(...args);
          return {
            ...bound,
            first: async () => {
              const row = await bound.first();
              await originalPrepare("UPDATE loose_files SET content_generation = content_generation + 1 WHERE id = ?").bind(file.id).run();
              return row;
            },
          };
        },
      };
    }) as typeof db.prepare;
    const before = { quota: (await state(file.id)).quota };
    try {
      await expect(
        putLooseFile(env, undefined, { email: "ada@esperlabs.app", via: "token" }, file.id, uploadFromBytes(new TextEncoder().encode("stale")), null, "text/plain", undefined, undefined, 1),
      ).rejects.toMatchObject({ status: 409, code: "file_conflict", extra: { content_generation: 2 } });
    } finally {
      db.prepare = originalPrepare;
    }
    expect(raced).toBe(true);
    expect(await state(file.id)).toMatchObject({ content_generation: 2, size: 8, last_written_by: "ada@esperlabs.app", pending: 0, quota: before.quota });
    expect((await readBack(token, file.id)).text).toBe("original");
  });
});
