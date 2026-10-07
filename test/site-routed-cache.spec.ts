import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { siteBodyCacheKey } from "../src/site-cache";
import { sha256Hex } from "../src/http";
import { auth, createSite, json, mint, req } from "./helpers";

it("checks the current version and access before serving warmed site bodies without a purge", async () => {
  const token = await mint("routed-site-cache");
  const site = await createSite(token, "routed-site-cache");
  const api = `/v1/sites/${site.id}`;
  expect((await req(`${api}/files/index.html`, { method: "PUT", headers: auth(token), body: "A" })).status).toBe(201);
  const first = (await json(api, { headers: auth(token) })).body;
  const key = (versionId: string) => siteBodyCacheKey({ siteId: site.id, versionId, path: "index.html", objectKey: "",
    representation: "raw", rendererRevision: "1", publicUngated: true, markdown: false, download: false,
    expiresAt: null, headers: {} });
  await caches.default.put(key(first.version_id), new Response("A cached", { headers: { "cache-control": "public, max-age=3600" } }));
  expect(await (await req(site.url)).text()).toBe("A cached");
  const created = await json(`${api}/deployments`, { method: "POST", headers: auth(token), body: JSON.stringify({
    expected_version: first.content_generation, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
    files: [{ path: "index.html", size: 1, sha256: await sha256Hex("B"), content_type: "text/html" }],
  }) });
  expect(created.status).toBe(201);
  const session = `${api}/deployments/${created.body.deployment_id}`;
  expect((await req(`${session}/files/index.html`, { method: "PUT", headers: auth(token), body: "B" })).status).toBe(201);
  expect((await req(`${session}/prepare`, { method: "POST", headers: auth(token) })).status).toBe(200);
  const committed = await json(`${session}/commit`, { method: "POST", headers: auth(token) });
  expect(committed.status).toBe(200);
  const selected = await req(site.url);
  expect(await selected.text()).toBe("B");
  expect(selected.headers.get("x-energon-site-version")).toBe(committed.body.version_id);
  expect(selected.headers.get("cache-control")).toBe("private, no-store");
  expect(await caches.default.match(key(first.version_id))).toBeDefined();
  await caches.default.put(key(committed.body.version_id), new Response("B cached", { headers: { "cache-control": "public, max-age=3600" } }));
  expect((await req(api, { method: "PATCH", headers: auth(token), body: JSON.stringify({ password: "cache-door" }) })).status).toBe(200);
  expect(await (await req(site.url)).text()).not.toBe("B cached");
  expect(await (await req(site.url, { headers: { "X-Energon-Password": "cache-door" } })).text()).toBe("B");
  await env.DB.prepare("UPDATE sites SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", site.id).run();
  expect((await req(site.url)).status).toBe(410);
  expect((await req(api, { method: "DELETE", headers: auth(token) })).status).toBe(404);
  expect((await req(site.url)).status).toBe(404);
});

it("disables outer caching for legacy content and returns 404 after logical deletion", async () => {
  const token = await mint("legacy-site-cache");
  const site = await createSite(token, "legacy-site-cache");
  await env.DB.prepare("UPDATE sites SET active_version_id = NULL, conversion_state = 'legacy' WHERE id = ?").bind(site.id).run();
  await env.BUCKET.put(`sites/${site.handle}/${site.id}/index.html`, "legacy", {
    httpMetadata: { contentType: "text/html" },
  });
  const before = await req(site.url);
  expect(await before.text()).toBe("legacy");
  expect(before.headers.get("cache-control")).toBe("private, no-store");
  expect(before.headers.get("cache-tag")).toBeNull();
  expect((await req(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(token) })).status).toBe(200);
  const after = await req(site.url);
  expect(after.status).toBe(404);
  expect(after.headers.get("cache-control")).toBe("private, no-store");
});
