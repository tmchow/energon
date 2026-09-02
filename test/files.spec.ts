import { describe, expect, it } from "vitest";
import { putLooseFile } from "../src/files";
import type { Actor, Env } from "../src/types";

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
                filename: "old.txt",
                size: 8,
                expires_at: null,
                created_by: "ada@esperlabs.app",
                last_written_by: "ada@esperlabs.app",
                write_policy: "instance",
              };
            }
            if (sql.includes("COALESCE(SUM(size)")) return { total: 8 };
            if (sql.includes("SELECT password_hash")) return { password_hash: null };
            return null;
          },
          async run() {
            return sql.includes("UPDATE loose_files") ? { meta: { changes: 1 } } : {};
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://energon.example.com",
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
      new TextEncoder().encode("replacement"),
      "new.txt",
      "text/plain",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filename: "new.txt", replaced: true });
    expect(new TextDecoder().decode(objects.get(newKey)?.bytes)).toBe("replacement");
    expect(purged).toEqual([["/ada/f/Abc123/"]]);
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
                write_policy: "instance",
              };
            }
            if (sql.includes("COALESCE(SUM(size)")) return { total: 8 };
            return null;
          },
          async run() {
            throw new Error("injected D1 failure");
          },
        };
      },
    };
    const env = {
      DB: db,
      BUCKET: bucket,
      PUBLIC_ORIGIN: "https://energon.example.com",
    } as unknown as Env;
    const actor: Actor = { email: "ada@esperlabs.app", via: "token" };

    await expect(
      putLooseFile(env, undefined, actor, "Abc123", new TextEncoder().encode("replacement"), "notes.txt", "text/plain"),
    ).rejects.toThrow("injected D1 failure");

    expect(new TextDecoder().decode(objects.get(key)?.bytes)).toBe("original");
    expect(objects.get(key)?.contentType).toBe("text/plain");
  });
});
