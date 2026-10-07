import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../src/db";
import { parseListQuery } from "../src/catalog";
import { listHubCatalog } from "../src/hub-catalog";
import {
  siteBodyCacheKey,
  withSiteBodyCache,
  type SiteCacheSelection,
} from "../src/site-cache";

async function fixture(content = "selected-version") {
  await ensureSchema(env.DB);
  const versionId = crypto.randomUUID(),
    siteId = crypto.randomUUID();
  const objectKey = `site-cache/${versionId}`;
  await env.DB.prepare(
    "INSERT INTO site_versions (id, site_id, state, created_at) VALUES (?, ?, 'active', ?)",
  )
    .bind(versionId, siteId, new Date().toISOString())
    .run();
  await env.BUCKET.put(objectKey, content);
  const selection: SiteCacheSelection = {
    siteId,
    versionId,
    objectKey,
    path: "index.html",
    representation: "raw",
    rendererRevision: "1",
    publicUngated: true,
    markdown: false,
    download: false,
    expiresAt: null,
    headers: {
      "content-type": "text/html",
      "x-current-policy": "current",
      "cache-control": "public",
    },
  };
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(task: Promise<unknown>) {
      tasks.push(task);
    },
  };
  const read = vi.fn(
    async () =>
      new Response((await env.BUCKET.get(objectKey))!.body, {
        headers: selection.headers,
      }),
  );
  const cache = await caches.open(`test-${versionId}`);
  return { selection, tasks, ctx, read, cache };
}
const request = () => new Request("https://content.example.test/site");

describe("versioned site cache", () => {
  it("fills independently, then hits without reading the visitor source and rebuilds headers", async () => {
    const f = await fixture();
    const response = await withSiteBodyCache(
      env,
      f.ctx,
      request(),
      f.selection,
      f.read,
      f.cache,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await Promise.all(f.tasks);
    expect(await response.text()).toBe("selected-version");
    const hit = await f.cache.match(siteBodyCacheKey(f.selection));
    expect(hit).toBeDefined();
    expect(hit!.headers.get("x-current-policy")).toBeNull();
    await hit!.body?.cancel();
    const headers = { "x-current-policy": "changed" };
    const cached = await withSiteBodyCache(
      env,
      f.ctx,
      request(),
      { ...f.selection, headers },
      f.read,
      f.cache,
    );
    expect(await cached.text()).toBe("selected-version");
    expect(cached.headers.get("x-current-policy")).toBe("changed");
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_operation_leases WHERE version_id = ?",
        )
          .bind(f.selection.versionId)
          .first()
      )?.n,
    ).toBe(0);
  });
  it("isolates versions, sites, paths, representations and renderer revisions", async () => {
    const f = await fixture();
    const key = siteBodyCacheKey(f.selection).url;
    for (const field of [
      "versionId",
      "siteId",
      "path",
      "representation",
      "rendererRevision",
    ] as const) {
      expect(
        siteBodyCacheKey({ ...f.selection, [field]: "different" }).url,
      ).not.toBe(key);
    }
    await f.cache.put(
      siteBodyCacheKey(f.selection),
      new Response("old", {
        headers: { "cache-control": "public, max-age=3600" },
      }),
    );
    const next = await withSiteBodyCache(
      env,
      undefined,
      request(),
      { ...f.selection, versionId: "next" },
      f.read,
      f.cache,
    );
    expect(await next.text()).toBe("selected-version");
  });
  it("falls back on match failures and suppresses fill errors", async () => {
    const f = await fixture();
    const broken = {
      match: async () => {
        throw new Error("cache unavailable");
      },
      put: async () => {
        throw new Error("put failed");
      },
    } as unknown as Cache;
    const response = await withSiteBodyCache(
      env,
      f.ctx,
      request(),
      f.selection,
      f.read,
      broken,
    );
    expect(await response.text()).toBe("selected-version");
    await Promise.all(f.tasks);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_operation_leases WHERE version_id = ?",
        )
          .bind(f.selection.versionId)
          .first()
      )?.n,
    ).toBe(0);
  });
  it("bypasses private, markdown, download, expired, range and HEAD requests", async () => {
    const f = await fixture();
    const cache = { match: vi.fn(), put: vi.fn() } as unknown as Cache;
    for (const selection of [
      { ...f.selection, publicUngated: false },
      { ...f.selection, markdown: true },
      { ...f.selection, download: true },
      { ...f.selection, expiresAt: new Date(0).toISOString() },
    ])
      await (
        await withSiteBodyCache(env, f.ctx, request(), selection, f.read, cache)
      ).body?.cancel();
    for (const req of [
      new Request(request(), { headers: { range: "bytes=0-2" } }),
      new Request(request(), { method: "HEAD" }),
      new Request(request(), { headers: { "if-none-match": "anything" } }),
    ]) {
      await (
        await withSiteBodyCache(env, f.ctx, req, f.selection, f.read, cache)
      ).body?.cancel();
    }
    expect(cache.match).not.toHaveBeenCalled();
    expect(f.tasks).toHaveLength(0);
  });
  it("tolerates silently declined storage and caps internal TTL by site expiry", async () => {
    const f = await fixture();
    const controls: string[] = [];
    const cache = {
      match: async () => undefined,
      put: async (_key: Request, response: Response) => {
        controls.push(response.headers.get("cache-control")!);
        await response.body?.cancel();
      },
    } as unknown as Cache;
    const selection = {
      ...f.selection,
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
    };
    for (let i = 0; i < 2; i++) {
      const response = await withSiteBodyCache(
        env,
        f.ctx,
        request(),
        selection,
        f.read,
        cache,
      );
      expect(await response.text()).toBe("selected-version");
      await Promise.all(f.tasks);
    }
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control).toMatch(/^public, max-age=\d+$/);
      expect(Number(control.split("=")[1])).toBeLessThanOrEqual(20);
    }
  });
  it("does not cache failures and strips competing CDN directives", async () => {
    const f = await fixture();
    const response = await withSiteBodyCache(
      env,
      f.ctx,
      request(),
      f.selection,
      async () =>
        new Response("missing", {
          status: 404,
          headers: {
            "cdn-cache-control": "public",
            "cloudflare-cdn-cache-control": "public",
            "surrogate-control": "public",
          },
        }),
      f.cache,
    );
    expect(response.status).toBe(404);
    expect(f.tasks).toHaveLength(0);
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    expect(response.headers.get("surrogate-control")).toBeNull();
  });
  it("releases the fill lease at its deadline even if cache.put never resolves", async () => {
    const f = await fixture();
    let putStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      putStarted = resolve;
    });
    let putFinished!: () => void;
    const stalled = new Promise<void>((resolve) => {
      putFinished = resolve;
    });
    const cache = {
      match: async () => undefined,
      put: async () => {
        putStarted();
        await stalled;
      },
    } as unknown as Cache;
    vi.useFakeTimers();
    try {
      const response = await withSiteBodyCache(
        env,
        f.ctx,
        request(),
        f.selection,
        f.read,
        cache,
      );
      await started;
      await vi.advanceTimersByTimeAsync(20_001);
      await Promise.all(f.tasks);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM site_operation_leases WHERE version_id = ?",
          )
            .bind(f.selection.versionId)
            .first()
        )?.n,
      ).toBe(0);
      expect(await response.text()).toBe("selected-version");
    } finally {
      putFinished();
      vi.useRealTimers();
    }
  });
});

describe("hub active-version aggregates", () => {
  it("counts only selected files, preserves legacy totals and hides non-live destinations", async () => {
    await ensureSchema(env.DB);
    const email = `${crypto.randomUUID()}@example.test`;
    async function site(lifecycle = "live") {
      const id = crypto.randomUUID(),
        now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO sites (id, handle, slug, created_at, updated_at, created_by, last_written_by, lifecycle_state)
        VALUES (?, 'cache-test', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, id, now, now, email, email, lifecycle)
        .run();
      await env.DB.prepare(
        `INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
        VALUES (?, 'legacy', 100, 'text/plain', ?, ?)`,
      )
        .bind(id, now, email)
        .run();
      return id;
    }
    const legacy = await site(),
      current = await site();
    await site("deleting");
    await site("creating");
    const version = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO site_versions (id, site_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(version, current, new Date().toISOString())
      .run();
    for (const size of [3, 7]) {
      await env.DB.prepare(
        `INSERT INTO site_version_files (version_id, path, allocation_id, object_key, size, sha256, content_type)
        VALUES (?, ?, ?, ?, ?, 'digest', 'text/plain')`,
      )
        .bind(
          version,
          String(size),
          crypto.randomUUID(),
          crypto.randomUUID(),
          size,
        )
        .run();
    }
    await env.DB.prepare("UPDATE sites SET active_version_id = ? WHERE id = ?")
      .bind(version, current)
      .run();
    const query = parseListQuery(
      new URL("https://example.test/?kind=sites&sort=size"),
    );
    const page = await listHubCatalog(env, email, query);
    expect(page.total).toBe(2);
    expect(
      page.items.map((item) => ({
        id: item.id,
        size: item.size,
        count: item.kind === "site" ? item.file_count : null,
      })),
    ).toEqual([
      { id: legacy, size: 100, count: 1 },
      { id: current, size: 10, count: 2 },
    ]);
    const filtered = await listHubCatalog(env, email, {
      ...query,
      minSize: 20,
    });
    expect(filtered.items.map((item) => item.id)).toEqual([legacy]);
  });
});
