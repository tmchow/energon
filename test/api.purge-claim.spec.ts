import { describe, expect, it } from "vitest";
import { auth, json, mint, req } from "./helpers";

describe("TTL purge claims", () => {
  it("blocks replacement while a loose-file deletion owns the write claim", async () => {
    const { env } = await import("cloudflare:test");
    const { deleteLooseFile, putLooseFile } = await import("../src/files");
    const token = await mint("delete-write-claim");
    const actor = { email: "ada@esperlabs.app", via: "token" } as const;
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "delete-race.txt", "content-type": "text/plain" }),
      body: "before",
    });
    const fileId = uploaded.body.id as string;
    const key = `files/${fileId}/delete-race.txt`;
    const bucket = env.BUCKET as R2Bucket & { delete: R2Bucket["delete"] };
    const originalDelete = bucket.delete.bind(bucket);
    let replacementError: unknown;
    bucket.delete = async (objectKey) => {
      const result = await originalDelete(objectKey);
      if (objectKey === key) {
        replacementError = await putLooseFile(
          env,
          undefined,
          actor,
          fileId,
          new TextEncoder().encode("replacement"),
          "delete-race.txt",
          "text/plain",
        ).catch((error: unknown) => error);
      }
      return result;
    };

    try {
      await deleteLooseFile(env, undefined, actor, fileId);
    } finally {
      bucket.delete = originalDelete;
    }

    expect(replacementError).toMatchObject({ status: 409, code: "file_busy" });
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toBeNull();
    expect(await env.BUCKET.get(key)).toBeNull();
  });

  it("keeps a replacement claim while purge observes the newly written bytes", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredFile } = await import("../src/expire");
    const token = await mint("ttl-replacement-claim");

    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "before.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "before",
    });
    const fileId = uploaded.body.id as string;
    const bucket = env.BUCKET as R2Bucket & { put: R2Bucket["put"] };
    const originalPut = bucket.put.bind(bucket);
    let purgeResult: boolean | undefined;
    bucket.put = async (key, value, options) => {
      const result = await originalPut(key, value, options);
      if (key === `files/${fileId}/after.txt` && purgeResult === undefined) {
        await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
          .bind("2000-01-01T00:00:00.000Z", fileId)
          .run();
        purgeResult = await purgeExpiredFile(env, undefined, fileId, "ada", "before.txt");
      }
      return result;
    };
    try {
      const replaced = await json(`/v1/files/${fileId}`, {
        method: "PUT",
        headers: auth(token, { "X-Filename": "after.txt", "content-type": "text/plain" }),
        body: "after",
      });
      expect(replaced.status).toBe(200);
    } finally {
      bucket.put = originalPut;
    }

    expect(purgeResult).toBe(false);
    const row = await env.DB.prepare(`SELECT id, filename, last_written_by FROM loose_files WHERE id = ?`)
      .bind(fileId)
      .first<{ id: string; filename: string; last_written_by: string }>();
    expect(row?.id).toBe(fileId);
    expect(row?.filename).toBe("after.txt");
    expect(row?.last_written_by).toBe("ada@esperlabs.app");
    const object = await env.BUCKET.get(`files/${fileId}/after.txt`);
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe("after");
  });

  it("does not write after expiry claims a row between its snapshot and write claim", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredFile } = await import("../src/expire");
    const { putLooseFile } = await import("../src/files");
    const token = await mint("ttl-purge-first");

    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "purge-first.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "before",
    });
    const fileId = uploaded.body.id as string;
    const bucket = env.BUCKET as R2Bucket & {
      delete: R2Bucket["delete"];
      put: R2Bucket["put"];
    };
    const originalDelete = bucket.delete.bind(bucket);
    const originalPut = bucket.put.bind(bucket);
    let deleteStarted!: () => void;
    const deleteReady = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let replacementPuts = 0;
    bucket.delete = async (key) => {
      deleteStarted();
      await deleteGate;
      return originalDelete(key);
    };
    bucket.put = async (key, value, options) => {
      replacementPuts += 1;
      return originalPut(key, value, options);
    };

    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    let snapshotPaused = false;
    let purgePromise: Promise<boolean> | undefined;
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (snapshotPaused || !sql.includes("SELECT id, handle, filename, size, expires_at, created_by, last_written_by, updated_at, write_policy, owner_id FROM loose_files WHERE id = ?")) {
        return statement;
      }
      snapshotPaused = true;
      const originalBind = statement.bind.bind(statement);
      return {
        ...statement,
        bind: (...bindArgs: unknown[]) => {
          const bound = originalBind(...bindArgs);
          const originalFirst = bound.first.bind(bound) as (...args: unknown[]) => Promise<unknown>;
          return {
            ...bound,
            first: async (...firstArgs: unknown[]) => {
              const row = await originalFirst(...firstArgs);
              await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
                .bind("2000-01-01T00:00:00.000Z", fileId)
                .run();
              purgePromise = purgeExpiredFile(env, undefined, fileId, "ada", "purge-first.txt");
              await deleteReady;
              return row;
            },
          };
        },
      };
    }) as typeof db.prepare;
    try {
      const replacement = putLooseFile(
        env,
        undefined,
        { email: "ada@esperlabs.app", via: "token" },
        fileId,
        new TextEncoder().encode("after"),
        "purge-first.txt",
        "text/plain",
      );
      await expect(replacement).rejects.toMatchObject({ status: 410 });
      releaseDelete();
      expect(await purgePromise).toBe(true);
    } finally {
      db.prepare = originalPrepare;
      bucket.delete = originalDelete;
      bucket.put = originalPut;
      releaseDelete();
    }

    expect(replacementPuts).toBe(0);
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toBeNull();
    expect(await env.BUCKET.get(`files/${fileId}/purge-first.txt`)).toBeNull();
  });

  it("reclaims stale write claims for PUT and PATCH", async () => {
    const { env } = await import("cloudflare:test");
    const { WRITE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-stale-write-claim");
    const staleAt = "2000-01-01T00:00:00.000Z";

    const putUpload = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "stale-put.txt", "content-type": "text/plain" }),
      body: "before",
    });
    const putId = putUpload.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
      .bind(`${WRITE_CLAIM}:abandoned-put`, staleAt, putId)
      .run();

    const replaced = await json(`/v1/files/${putId}`, {
      method: "PUT",
      headers: auth(token, { "X-Filename": "stale-put.txt", "content-type": "text/plain" }),
      body: "after",
    });
    expect(replaced.status).toBe(200);
    expect(await (await env.BUCKET.get(`files/${putId}/stale-put.txt`))!.text()).toBe("after");

    const patchUpload = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "stale-patch.txt", "content-type": "text/plain" }),
      body: "patch",
    });
    const patchId = patchUpload.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
      .bind(`${WRITE_CLAIM}:abandoned-patch`, staleAt, patchId)
      .run();

    const patched = await json(`/v1/files/${patchId}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ password: "secret", ttl: "7d", write_policy: "owner" }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ password_protected: true, write_policy: "owner" });

    const rows = await env.DB.prepare(
      `SELECT id, last_written_by, write_policy FROM loose_files WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(putId, patchId)
      .all<{ id: string; last_written_by: string; write_policy: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.last_written_by === "ada@esperlabs.app")).toBe(true);
    expect(rows.results.find((row) => row.id === patchId)?.write_policy).toBe("owner");
  });

  it("rejects active write claims for PUT and PATCH", async () => {
    const { env } = await import("cloudflare:test");
    const { WRITE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-active-write-claim");
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "active.txt", "content-type": "text/plain" }),
      body: "before",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
      .bind(`${WRITE_CLAIM}:active`, new Date().toISOString(), fileId)
      .run();

    const replaced = await json(`/v1/files/${fileId}`, {
      method: "PUT",
      headers: auth(token, { "X-Filename": "active.txt", "content-type": "text/plain" }),
      body: "after",
    });
    expect(replaced.status).toBe(409);
    expect(replaced.body.error).toBe("file_busy");

    const patched = await json(`/v1/files/${fileId}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(patched.status).toBe(409);
    expect(patched.body.error).toBe("file_busy");
    expect(await (await env.BUCKET.get(`files/${fileId}/active.txt`))!.text()).toBe("before");
  });

  it("returns file_busy when a write claim wins each PATCH update race", async () => {
    const { env } = await import("cloudflare:test");
    const { WRITE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-patch-write-races");
    const cases = [
      {
        name: "password and ttl",
        body: { password: "secret", ttl: "7d" },
        sql: "password_hash = ?, password_secret = ?, expires_at = ?",
      },
      { name: "password", body: { password: "secret" }, sql: "password_hash = ?, password_secret = ? WHERE" },
      { name: "ttl", body: { ttl: "7d" }, sql: "expires_at = ? WHERE" },
      {
        name: "write policy",
        body: { write_policy: "owner" },
        sql: "written_via = NULL, write_policy = ? WHERE",
      },
      {
        name: "password and write policy",
        body: { password: "secret", write_policy: "owner" },
        sql: "password_hash = ?, password_secret = ?, write_policy = ? WHERE",
      },
      {
        name: "write password",
        body: { write_password: "secret" },
        sql: "write_password_hash = ?, write_password_secret = ? WHERE",
      },
    ];

    for (const race of cases) {
      const uploaded = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": `${race.name}.txt`, "content-type": "text/plain" }),
        body: "before",
      });
      const fileId = uploaded.body.id as string;
      const db = env.DB;
      const originalPrepare = db.prepare.bind(db);
      let injected = false;
      db.prepare = ((sql: string) => {
        const statement = originalPrepare(sql);
        if (injected || !sql.includes("UPDATE loose_files") || !sql.includes(race.sql)) return statement;
        const originalBind = statement.bind.bind(statement);
        return {
          ...statement,
          bind: (...bindArgs: unknown[]) => {
            const bound = originalBind(...bindArgs);
            const originalRun = bound.run.bind(bound);
            return Object.assign(bound, {
              run: async () => {
                injected = true;
                await originalPrepare(
                  `UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`,
                )
                  .bind(`${WRITE_CLAIM}:${race.name}`, new Date().toISOString(), fileId)
                  .run();
                return originalRun();
              },
            });
          },
        };
      }) as typeof db.prepare;

      try {
        const patched = await json(`/v1/files/${fileId}`, {
          method: "PATCH",
          headers: auth(token, { "content-type": "application/json" }),
          body: JSON.stringify(race.body),
        });
        expect(patched.status, race.name).toBe(409);
        expect(patched.body.error, race.name).toBe("file_busy");
        expect(injected, race.name).toBe(true);
      } finally {
        db.prepare = originalPrepare;
      }
    }
  });

  it("does not partially apply a multi-field PATCH when a write claim wins", async () => {
    const { env } = await import("cloudflare:test");
    const { WRITE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-patch-atomicity");
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "atomic.txt", "content-type": "text/plain" }),
      body: "before",
    });
    const fileId = uploaded.body.id as string;
    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    let injected = false;
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (injected || !sql.includes("password_hash = ?, password_secret = ?, write_policy = ? WHERE")) return statement;
      const originalBind = statement.bind.bind(statement);
      return {
        ...statement,
        bind: (...bindArgs: unknown[]) => {
          const bound = originalBind(...bindArgs);
          const originalRun = bound.run.bind(bound);
          return Object.assign(bound, {
            run: async () => {
              injected = true;
              await originalPrepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
                .bind(`${WRITE_CLAIM}:atomicity`, new Date().toISOString(), fileId)
                .run();
              return originalRun();
            },
          });
        },
      };
    }) as typeof db.prepare;

    try {
      const patched = await json(`/v1/files/${fileId}`, {
        method: "PATCH",
        headers: auth(token, { "content-type": "application/json" }),
        body: JSON.stringify({ password: "secret", write_policy: "owner" }),
      });
      expect(patched.status).toBe(409);
      expect(patched.body.error).toBe("file_busy");
    } finally {
      db.prepare = originalPrepare;
    }

    expect(injected).toBe(true);
    const row = await env.DB.prepare(`SELECT password_hash, write_policy FROM loose_files WHERE id = ?`)
      .bind(fileId)
      .first<{ password_hash: string | null; write_policy: string }>();
    expect(row?.password_hash).toBeNull();
    expect(row?.write_policy).toBe("instance");
  });

  it("does not partially apply a multi-field site PATCH when purge claims", async () => {
    const { env } = await import("cloudflare:test");
    const { PURGE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-site-patch-atomicity");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "atomic-site" }),
    });
    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    let injected = false;
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (injected || !sql.includes("password_hash = ?, password_secret = ?, write_policy = ? WHERE")) return statement;
      const originalBind = statement.bind.bind(statement);
      return {
        ...statement,
        bind: (...bindArgs: unknown[]) => {
          const bound = originalBind(...bindArgs);
          const originalRun = bound.run.bind(bound);
          return Object.assign(bound, {
            run: async () => {
              injected = true;
              await originalPrepare(`UPDATE sites SET last_written_by = ? WHERE slug = ?`)
                .bind(`${PURGE_CLAIM}:atomicity`, "atomic-site")
                .run();
              return originalRun();
            },
          });
        },
      };
    }) as typeof db.prepare;

    try {
      const patched = await json("/v1/sites/atomic-site", {
        method: "PATCH",
        headers: auth(token, { "content-type": "application/json" }),
        body: JSON.stringify({ password: "secret", write_policy: "owner" }),
      });
      expect(patched.status).toBe(410);
      expect(patched.body.error).toBe("expired");
    } finally {
      db.prepare = originalPrepare;
    }

    expect(injected).toBe(true);
    const row = await env.DB.prepare(`SELECT password_hash, write_policy FROM sites WHERE slug = ?`)
      .bind("atomic-site")
      .first<{ password_hash: string | null; write_policy: string }>();
    expect(row?.password_hash).toBeNull();
    expect(row?.write_policy).toBe("instance");
  });

  it("purge claims before deleting R2 so a concurrent PATCH ttl cannot orphan bytes", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredSite, purgeExpiredFile } = await import("../src/expire");
    const token = await mint("ttl-race");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "race-site", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/race-site/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>race</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "race-site")
      .run();

    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "race.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "race",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", fileId)
      .run();

    const bucket = env.BUCKET as R2Bucket & { delete: R2Bucket["delete"] };
    const originalDelete = bucket.delete.bind(bucket);
    let siteRevive: { status: number; body: { error?: string } } | undefined;
    let fileRevive: { status: number; body: { error?: string } } | undefined;
    bucket.delete = async (key) => {
      if (siteRevive === undefined) {
        siteRevive = await json("/v1/sites/race-site", {
          method: "PATCH",
          headers: auth(token, { "content-type": "application/json" }),
          body: JSON.stringify({ ttl: "7d" }),
        });
      } else if (fileRevive === undefined) {
        fileRevive = await json(`/v1/files/${fileId}`, {
          method: "PATCH",
          headers: auth(token, { "content-type": "application/json" }),
          body: JSON.stringify({ ttl: "7d" }),
        });
      }
      return originalDelete(key);
    };
    try {
      expect(await purgeExpiredSite(env, undefined, "ada", "race-site")).toBe(true);
      expect(await purgeExpiredFile(env, undefined, fileId, "ada", "race.txt")).toBe(true);
    } finally {
      bucket.delete = originalDelete;
    }

    expect(siteRevive?.status).toBe(410);
    expect(siteRevive?.body.error).toBe("expired");
    expect(fileRevive?.status).toBe(410);
    expect(fileRevive?.body.error).toBe("expired");
    expect(await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("race-site").first()).toBeNull();
    expect(await env.DB.prepare(`SELECT path FROM site_files WHERE slug = ?`).bind("race-site").first()).toBeNull();
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toBeNull();
    const siteBytes = await req("/v1/sites/race-site/files/index.html", { headers: auth(token) });
    expect(siteBytes.status).toBe(404);
    const fileBytes = await req(`/v1/files/${fileId}`, { headers: auth(token) });
    expect(fileBytes.status).toBe(404);
  });

  it("second purger does not delete R2 while another isolate holds a fresh claim", async () => {
    const { env } = await import("cloudflare:test");
    const { PURGE_CLAIM, purgeExpiredSite, purgeExpiredFile } = await import("../src/expire");
    const token = await mint("ttl-held-claim");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "held-site", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/held-site/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>held</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ?, last_written_by = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", `${PURGE_CLAIM}:held`, "held-site")
      .run();

    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "held.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "held",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ?, last_written_by = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", `${PURGE_CLAIM}:held`, fileId)
      .run();

    expect(await purgeExpiredSite(env, undefined, "ada", "held-site")).toBe(false);
    expect(await purgeExpiredFile(env, undefined, fileId, "ada", "held.txt")).toBe(false);
    expect(await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("held-site").first()).toEqual({
      slug: "held-site",
    });
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toEqual({
      id: fileId,
    });
    const siteObj = await env.BUCKET.get("sites/ada/held-site/index.html");
    expect(siteObj).not.toBeNull();
    expect(await siteObj!.text()).toBe("<h1>held</h1>");
    const fileObj = await env.BUCKET.get(`files/${fileId}/held.txt`);
    expect(fileObj).not.toBeNull();
    expect(await fileObj!.text()).toBe("held");
  });

  it("drops site_files before releasing the sites primary key", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredSite } = await import("../src/expire");
    const token = await mint("ttl-pk-order");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "pk-order", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/pk-order/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>order</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "pk-order")
      .run();

    const db = env.DB;
    const originalPrepare = db.prepare.bind(db);
    let filesWhenSitesDeleted: { path: string } | null | undefined;
    db.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (!sql.includes("DELETE FROM sites") || sql.includes("site_files")) return stmt;
      const origBind = stmt.bind.bind(stmt);
      return {
        ...stmt,
        bind: (...args: unknown[]) => {
          const bound = origBind(...args);
          const origRun = bound.run.bind(bound);
          return Object.assign(bound, {
            run: async () => {
              filesWhenSitesDeleted = await originalPrepare(`SELECT path FROM site_files WHERE slug = ?`)
                .bind("pk-order")
                .first<{ path: string }>();
              return origRun();
            },
          });
        },
      };
    }) as typeof db.prepare;
    try {
      expect(await purgeExpiredSite(env, undefined, "ada", "pk-order")).toBe(true);
    } finally {
      db.prepare = originalPrepare;
    }
    expect(filesWhenSitesDeleted).toBeNull();
    expect(await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("pk-order").first()).toBeNull();
  });

  it("DELETE of a claimed site is 200 and POST recreates after a stale claim", async () => {
    const { env } = await import("cloudflare:test");
    const { PURGE_CLAIM } = await import("../src/expire");
    const token = await mint("ttl-claimed-write");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "claimed-del", overwrite: false, ttl: "1d" }),
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ?, last_written_by = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", `${PURGE_CLAIM}:fresh`, "claimed-del")
      .run();
    const deleted = await json("/v1/sites/claimed-del", { method: "DELETE", headers: auth(token) });
    expect(deleted.status).toBe(200);

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "stale-recreate", overwrite: false, ttl: "1d" }),
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ?, last_written_by = ?, updated_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", `${PURGE_CLAIM}:stale`, "2000-01-01T00:00:00.000Z", "stale-recreate")
      .run();
    const recreated = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "stale-recreate", overwrite: false }),
    });
    expect(recreated.status).toBe(201);
    expect(recreated.body.created).toBe(true);
  });
});
