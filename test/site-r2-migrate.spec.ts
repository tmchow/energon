import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { siteKey } from "../src/config";
import { remapLegacySiteR2, resetLegacySiteR2RemapForTests } from "../src/site-r2-migrate";
import { auth, createSite, json, mint, req, sitePub } from "./helpers";

describe("legacy site R2 remap", () => {
  it("moves pre-migration slug keys onto the id prefix so public and API GETs work", async () => {
    const token = await mint("site-r2-remap");
    const site = await createSite(token, "legacy-r2-slug");
    expect(site.status).toBe(201);
    expect(site.id).toBeTruthy();
    expect(site.id).not.toBe(site.slug);

    await json(`/v1/sites/${site.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<p>from-legacy-prefix</p>",
    });

    const idKey = siteKey(site.handle, site.id, "index.html");
    const legacyKey = `sites/${site.handle}/${site.slug}/index.html`;
    const stored = await env.BUCKET.get(idKey);
    expect(stored).not.toBeNull();
    await env.BUCKET.put(legacyKey, await stored!.arrayBuffer(), {
      httpMetadata: stored!.httpMetadata,
      customMetadata: stored!.customMetadata,
    });
    await env.BUCKET.delete(idKey);

    expect(await env.BUCKET.get(idKey)).toBeNull();
    expect(await env.BUCKET.get(legacyKey)).not.toBeNull();

    const beforeApi = await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) });
    expect(beforeApi.status).toBe(404);
    const beforePublic = await req(sitePub(site.handle, site.id, site.slug, "index.html"));
    expect(beforePublic.status).toBe(404);

    resetLegacySiteR2RemapForTests();
    await remapLegacySiteR2(env);

    expect(await env.BUCKET.get(legacyKey)).toBeNull();
    const moved = await env.BUCKET.get(idKey);
    expect(moved).not.toBeNull();
    expect(await moved!.text()).toBe("<p>from-legacy-prefix</p>");

    const afterApi = await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) });
    expect(afterApi.status).toBe(200);
    expect(await afterApi.text()).toBe("<p>from-legacy-prefix</p>");

    const afterPublic = await req(sitePub(site.handle, site.id, site.slug, "index.html"));
    expect(afterPublic.status).toBe(200);
    expect(await afterPublic.text()).toBe("<p>from-legacy-prefix</p>");
  });

  it("is a no-op when objects are already under the id prefix", async () => {
    const token = await mint("site-r2-remap-idempotent");
    const site = await createSite(token, "already-id-prefix");
    expect(site.status).toBe(201);
    await json(`/v1/sites/${site.id}/files/ok.txt`, {
      method: "PUT",
      headers: auth(token),
      body: "stable",
    });
    const idKey = siteKey(site.handle, site.id, "ok.txt");
    resetLegacySiteR2RemapForTests();
    await remapLegacySiteR2(env);
    expect(await (await env.BUCKET.get(idKey))!.text()).toBe("stable");
  });

  it("purges the pre-id public path prefix so shared cache cannot keep serving slug URLs", async () => {
    const token = await mint("site-r2-remap-purge");
    const site = await createSite(token, "cached-slug-url");
    expect(site.status).toBe(201);
    expect(site.id).not.toBe(site.slug);

    const purged: string[][] = [];
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(task: Promise<unknown>) {
        pending.push(task);
      },
      cache: {
        async purge({ pathPrefixes }: { pathPrefixes: string[] }) {
          purged.push(pathPrefixes);
        },
      },
    } as unknown as ExecutionContext;

    resetLegacySiteR2RemapForTests();
    await remapLegacySiteR2(env, ctx);
    await Promise.all(pending);

    expect(purged).toHaveLength(1);
    expect(purged[0]).toContain(`/${site.handle}/s/${site.slug}/`);
  });

  it("latches remapped even when cache purge rejects so requests are not wedged", async () => {
    const token = await mint("site-r2-remap-purge-fail");
    const site = await createSite(token, "purge-fail-slug");
    expect(site.status).toBe(201);

    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(task: Promise<unknown>) {
        pending.push(task);
      },
      cache: {
        async purge() {
          throw new Error("purge rejected");
        },
      },
    } as unknown as ExecutionContext;

    resetLegacySiteR2RemapForTests();
    await expect(remapLegacySiteR2(env, ctx)).resolves.toBeUndefined();
    await Promise.all(pending);
    // Second call must be a latch hit, not another purge attempt that could throw into the request.
    await expect(remapLegacySiteR2(env, ctx)).resolves.toBeUndefined();
    expect(site.id).toBeTruthy();
  });
});
