import { describe, expect, it } from "vitest";
import { auth, json, mint, req } from "./helpers";

describe("TTL purge claims", () => {
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
