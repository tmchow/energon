import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { access, auth, createSite, json, mint, req } from "./helpers";

describe("host and route contracts", () => {
  it("serves authentication instructions before login and links them from discovery and token errors", async () => {
    const response = await req("/auth.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toContain("https://hub.energon.example.com/tokens");
    const head = await req("/auth.md", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await req("/auth.md", { method: "POST" })).status).toBe(405);
    expect((await json("/v1/help")).body.auth_url).toBe("https://hub.energon.example.com/auth.md");
    expect(await (await req("/llms.txt")).text()).toContain("https://hub.energon.example.com/auth.md");
    expect(await (await req("/llms.txt")).text()).toContain("Guest write password");
    const contentHelp = await json("https://energon.example.com/v1/help");
    expect(contentHelp.status).toBe(404);
    expect(contentHelp.body.message).toContain("GET /llms.txt");
    for (const path of ["/v1", "/v1/", "/v1/whoami"]) {
      const rejected = await json(path);
      expect(rejected.status).toBe(401);
      expect(rejected.body.auth_url).toBe("https://hub.energon.example.com/auth.md");
    }
  });

  it("blocks the human hub on workers.dev and keeps /v1/health up", async () => {
    const hub = await req("https://energon.workers.dev/");
    expect(hub.status).toBe(403);
    const text = await hub.text();
    expect(text).toContain("energon.example.com");

    const account = await req("https://energon.workers.dev/account");
    expect(account.status).toBe(403);

    const health = await json("https://energon.workers.dev/v1/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
  });

  it("serves the OpenAPI contract without a token and points help at it", async () => {
    const res = await req("/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toContain('"servers":[{"url":"https://hub.energon.example.com"}]');

    const doc = await json("/v1/openapi.json");
    expect(doc.body.openapi).toBe("3.1.0");
    expect(doc.body.servers).toEqual([{ url: "https://hub.energon.example.com" }]);
    expect(doc.body.paths["/v1/sites"].post.operationId).toBe("createSite");

    const head = await req("/v1/openapi.json", { method: "HEAD" });
    expect(head.status).toBe(200);
    const post = await json("/v1/openapi.json", { method: "POST" });
    expect(post.status).toBe(405);

    const again = await json("/v1/openapi.json");
    expect(again.body.servers).toEqual([{ url: "https://hub.energon.example.com" }]);
    expect(again.body.servers[0].description).toBeUndefined();

    const help = await json("/v1/help");
    expect(help.body.openapi).toBe("https://hub.energon.example.com/v1/openapi.json");
    expect(help.body.routes["GET /v1/openapi.json"]).toBe("OpenAPI 3.1 HTTP contract, no auth");
  });

  it("redirects a site URL without a trailing slash", async () => {
    const token = await mint("slash");
    const site_slash_me = await createSite(token, "slash-me");
    const res = await req(`/ada/s/${site_slash_me.id}/slash-me`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://energon.example.com/ada/s/${site_slash_me.id}/slash-me/`);
  });

  it("redirects hub content links and keeps account routes off the content origin", async () => {
    const token = await mint("content-origin");
    const site_content_origin = await createSite(token, "content-origin");
    const hub = await req(`https://hub.energon.example.com/ada/s/${site_content_origin.id}/content-origin/`, { redirect: "manual" });
    expect(hub.status).toBe(302);
    expect(hub.headers.get("location")).toBe(`https://energon.example.com/ada/s/${site_content_origin.id}/content-origin/`);

    const content = await req(`https://energon.example.com/ada/s/${site_content_origin.id}/content-origin/`);
    expect(content.headers.get("access-control-allow-origin")).toBe("https://hub.energon.example.com");

    const corsToken = await mint("cors-file");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(corsToken, { "X-Filename": "space file.txt", "content-type": "text/plain" }),
      body: "content",
    });
    const file = await req(`https://energon.example.com/ada/f/${created.body.id}/space%20file.txt`, { redirect: "manual" });
    expect(file.status).toBe(302);
    expect(file.headers.get("location")).toBe(`https://energon.example.com/ada/f/${created.body.id}/space_file.txt`);
    expect(file.headers.get("access-control-allow-origin")).toBe("https://hub.energon.example.com");

    const account = await req("https://energon.example.com/account/tokens", {
      headers: { "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app" },
    });
    expect(account.status).toBe(404);

    const mermaid = await req("https://energon.example.com/static/mermaid/mermaid.esm.min.mjs");
    expect(mermaid.status).toBe(200);
    expect(mermaid.headers.get("content-type")).toMatch(/javascript|ecmascript/);
    expect(mermaid.headers.get("access-control-allow-origin")).toBe("*");
    const mermaidSrc = await mermaid.text();
    expect(mermaidSrc).toContain("chunks/mermaid.esm.min/");
    expect(mermaidSrc.length).toBeGreaterThan(1_000);
  });

  it("rejects a non-Energon bearer and a bad site slug", async () => {
    const bad = await json("/v1/sites", { headers: { authorization: "Bearer not-a-token" } });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("unauthorized");
    expect(bad.body.message).toContain("ee_live_");

    const help = await json("/v1/help");
    expect(help.body.auth).toBe("Authorization: Bearer ee_live_<secret>");
    expect(help.body.token_prefix).toBe("ee_live_");

    const token = await mint("bad-slug");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "Bad Slug" }),
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("bad_slug");
  });

  it("rejects malformed URL encoding without turning it into a 500", async () => {
    const malformed = await json("/ada/s/%ZZ/demo/");

    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("bad_path");
  });
});

describe("hub account API", () => {
  it("exposes list totals and cursors without leaking token secrets", async () => {
    const email = "hub-data@esperlabs.app";
    const token = await mint("listed", email);
    const res = await req("/account/data", { headers: access(email) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    const data = (await res.json()) as {
      email: string;
      sites: unknown[];
      files: unknown[];
      sites_total: number;
      files_total: number;
      sites_cursor: string | null;
      files_cursor: string | null;
      tokens: { label: string }[];
    };
    expect(data.email).toBe(email);
    expect(data.sites).toEqual(expect.any(Array));
    expect(data.files).toEqual(expect.any(Array));
    expect(data).toHaveProperty("sites_total");
    expect(data).toHaveProperty("files_total");
    expect(data).toHaveProperty("sites_cursor");
    expect(data).toHaveProperty("files_cursor");
    expect(data.tokens.some((t) => t.label === "listed")).toBe(true);
    expect(JSON.stringify(data)).not.toContain(token);
  });

  it("defaults list pages to 25 so a missing limit is not 1", async () => {
    const token = await mint("default-limit", "limit@esperlabs.app");
    for (const name of ["one.txt", "two.txt", "three.txt"]) {
      await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": name, "content-type": "text/plain" }),
        body: name,
      });
    }
    const listed = await json("/v1/files", { headers: auth(token) });
    expect(listed.status).toBe(200);
    expect(listed.body.files.length).toBe(3);
    expect(listed.body.total).toBe(3);
    expect(listed.body.next_cursor).toBeFalsy();
  });

  it("deletes a site and a loose file from the hub account routes", async () => {
    const email = "hub-del@esperlabs.app";
    const token = await mint("hub-del", email);
    const site_hub_gone = await createSite(token, "hub-gone");
    await json(`/v1/sites/${site_hub_gone.id}/files/bye.txt`, { method: "PUT", headers: auth(token), body: "bye" });
    const siteDel = await json(`/account/sites/${site_hub_gone.id}`, { method: "DELETE", headers: access(email) });
    expect(siteDel.status).toBe(200);
    expect(siteDel.body.deleted).toBe(site_hub_gone.id);
    expect((await req(`/hub-del/s/${site_hub_gone.id}/hub-gone/bye.txt`)).status).toBe(404);

    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "gone.txt", "content-type": "text/plain" }),
      body: "bye",
    });
    const path = new URL(created.body.url).pathname;
    const fileDel = await json(`/account/files/${created.body.id}`, { method: "DELETE", headers: access(email) });
    expect(fileDel.status).toBe(200);
    expect((await req(path)).status).toBe(404);
  });

  it("rejects account mutations from another origin and form bodies", async () => {
    const email = "csrf@esperlabs.app";
    const token = await mint("csrf-key", email);
    const site_csrf_site = await createSite(token, "csrf-site");

    const missing = await json(`/account/sites/${site_csrf_site.id}`, {
      method: "PATCH",
      headers: {
        "Cf-Access-Authenticated-User-Email": email,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "stolen" }),
    });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toBe("bad_origin");

    const cross = await json(`/account/sites/${site_csrf_site.id}`, {
      method: "PATCH",
      headers: access(email, {
        origin: "https://energon.example.com",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ password: "stolen" }),
    });
    expect(cross.status).toBe(403);
    expect(cross.body.error).toBe("bad_origin");

    const form = await json(`/account/sites/${site_csrf_site.id}`, {
      method: "PATCH",
      headers: access(email, { "content-type": "application/x-www-form-urlencoded" }),
      body: "password=stolen",
    });
    expect(form.status).toBe(415);
    expect(form.body.error).toBe("bad_content_type");

    const minted = await req("/account/tokens", {
      method: "POST",
      headers: access(email, { "content-type": "application/json" }),
      body: JSON.stringify({ label: "no-store" }),
    });
    expect(minted.status).toBe(201);
    expect(minted.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("DELETE /v1/whoami revokes only the calling token", async () => {
    const email = "self@esperlabs.app";
    const mine = await mint("self-done", email);
    const other = await mint("self-keep", email);
    expect((await json("/v1/whoami", { method: "DELETE" })).status).toBe(401);

    const revoked = await req("/v1/whoami", { method: "DELETE", headers: auth(mine) });
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("cache-control")).toMatch(/no-store/);
    expect(await revoked.json()).toEqual({ ok: true, revoked: true, label: "self-done" });

    const dead = await json("/v1/whoami", { headers: auth(mine) });
    expect(dead.status).toBe(401);
    expect(dead.body.error).toBe("unauthorized");
    expect((await json("/v1/whoami", { method: "DELETE", headers: auth(mine) })).status).toBe(401);
    expect((await json("/v1/whoami", { headers: auth(other) })).body.label).toBe("self-keep");

    const listed = await json("/account/data", { headers: access(email) });
    const byLabel = Object.fromEntries(listed.body.tokens.map((t: { label: string; status: string }) => [t.label, t.status]));
    expect(byLabel).toMatchObject({ "self-done": "revoked", "self-keep": "live" });
    expect((await json("/v1/help")).body.routes["DELETE /v1/whoami"]).toContain("self only");
  });

  it("bulk revokes stale or all tokens only after a matching preview confirm", async () => {
    const email = "bulk@esperlabs.app";
    const headers = access(email, { "content-type": "application/json" });
    const fresh = await mint("bulk-fresh", email);
    const idle = await mint("bulk-idle", email);
    const expired = await mint("bulk-expired", email, undefined, "1d");
    await env.DB.prepare(`UPDATE tokens SET created_at = ? WHERE label = ? AND user_email = ?`)
      .bind("2000-01-01T00:00:00.000Z", "bulk-idle", email)
      .run();
    await env.DB.prepare(`UPDATE tokens SET expires_at = ? WHERE label = ? AND user_email = ?`)
      .bind("2000-01-02T00:00:00.000Z", "bulk-expired", email)
      .run();

    expect((await json("/v1/whoami", { headers: auth(idle) })).status).toBe(200);
    await env.DB.prepare(`UPDATE tokens SET last_used_at = created_at WHERE label = ? AND user_email = ?`).bind("bulk-idle", email).run();

    const listed = await json("/account/data", { headers: access(email) });
    const byLabel = Object.fromEntries(listed.body.tokens.map((t: { label: string; status: string }) => [t.label, t.status]));
    expect(byLabel).toMatchObject({ "bulk-fresh": "live", "bulk-idle": "stale", "bulk-expired": "expired" });

    const badTarget = await json("/account/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ target: "some" }) });
    expect(badTarget.status).toBe(400);
    expect(badTarget.body.error).toBe("bad_target");

    const stalePreview = await json("/account/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ target: "stale" }) });
    expect(stalePreview.status).toBe(200);
    expect(stalePreview.body).toMatchObject({ target: "stale", executed: false, matched: 1 });
    expect(stalePreview.body.sample.map((t: { label: string }) => t.label)).toEqual(["bulk-idle"]);
    expect(stalePreview.body.confirm).toMatch(/^[0-9a-f]{32}$/);

    const drift = await json("/account/tokens/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "all", confirm: stalePreview.body.confirm }),
    });
    expect(drift.status).toBe(409);
    expect(drift.body.error).toBe("token_revoke_drift");
    expect(drift.body.matched).toBe(3);
    expect((await json("/v1/whoami", { headers: auth(fresh) })).status).toBe(200);

    const staleDone = await json("/account/tokens/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "stale", confirm: stalePreview.body.confirm }),
    });
    expect(staleDone.status).toBe(200);
    expect(staleDone.body).toEqual({ ok: true, target: "stale", executed: true, revoked: 1 });
    expect((await json("/v1/whoami", { headers: auth(idle) })).status).toBe(401);
    expect((await json("/v1/whoami", { headers: auth(fresh) })).status).toBe(200);

    const allPreview = await json("/account/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ target: "all" }) });
    expect(allPreview.body.matched).toBe(2);
    const allDone = await json("/account/tokens/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "all", confirm: allPreview.body.confirm }),
    });
    expect(allDone.body).toEqual({ ok: true, target: "all", executed: true, revoked: 2 });
    expect((await json("/v1/whoami", { headers: auth(fresh) })).status).toBe(401);
    expect((await json("/v1/whoami", { headers: auth(expired) })).body.error).toBe("unauthorized");
    const after = await json("/account/data", { headers: access(email) });
    expect(after.body.tokens.every((t: { status: string }) => t.status === "revoked")).toBe(true);

    const again = await json("/account/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ target: "all" }) });
    expect(again.body.matched).toBe(0);
  });

  it("bulk revoke handles more tokens than one D1 statement can bind", async () => {
    const email = "bulk-many@esperlabs.app";
    const headers = access(email, { "content-type": "application/json" });
    const count = 105;
    const secrets = [];
    for (let i = 0; i < count; i++) secrets.push(await mint(`many-${i}`, email));

    const preview = await json("/account/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ target: "all" }) });
    expect(preview.body.matched).toBe(count);
    const done = await json("/account/tokens/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "all", confirm: preview.body.confirm }),
    });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true, target: "all", executed: true, revoked: count });
    expect((await json("/v1/whoami", { headers: auth(secrets[0]) })).status).toBe(401);
    expect((await json("/v1/whoami", { headers: auth(secrets[count - 1]) })).status).toBe(401);
  });

  it("mints admin tokens only for ADMIN_EMAILS and keeps connect at account scope", async () => {
    const refused = await json("/account/tokens", {
      method: "POST",
      headers: access("ada@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "nope", scope: "admin", ttl: "1d" }),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("forbidden_admin");

    const minted = await json("/account/tokens", {
      method: "POST",
      headers: access("admin@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "ops", scope: "admin" }),
    });
    expect(minted.status).toBe(201);
    expect(minted.body.scope).toBe("admin");
    expect(minted.body.token).toMatch(/^ee_live_/);
    expect(Date.parse(minted.body.expires_at) - Date.now()).toBeLessThan(2 * 86400 * 1000);
    const who = await json("/v1/whoami", { headers: auth(minted.body.token) });
    expect(who.body).toMatchObject({
      email: "admin@esperlabs.app",
      label: "ops",
      scope: "admin",
      admin: true,
    });
    const listed = await json("/account/data", { headers: access("admin@esperlabs.app") });
    const row = listed.body.tokens.find((t: { label: string }) => t.label === "ops");
    expect(row.scope).toBe("admin");
    expect(row.hint).toMatch(/^ee_live_admin…/);

    const never = await json("/account/tokens", {
      method: "POST",
      headers: access("admin@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "forever", scope: "admin", ttl: "never" }),
    });
    expect(never.status).toBe(400);
    expect(never.body.error).toBe("bad_ttl");

    const account = await json("/account/tokens", {
      method: "POST",
      headers: access("admin@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "plain" }),
    });
    expect(account.status).toBe(201);
    expect(account.body.scope).toBe("account");
    const plain = await json("/v1/whoami", { headers: auth(account.body.token) });
    expect(plain.body.admin).toBe(false);
    expect(plain.body.scope).toBe("account");
  });
});
