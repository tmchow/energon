import { describe, expect, it } from "vitest";
import { access, auth, json, mint, req } from "./helpers";

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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "slash-me" }),
    });
    const res = await req("/ada/s/slash-me", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://energon.example.com/ada/s/slash-me/");
  });

  it("redirects hub content links and keeps account routes off the content origin", async () => {
    const hub = await req("https://hub.energon.example.com/ada/s/content-origin/", { redirect: "manual" });
    expect(hub.status).toBe(302);
    expect(hub.headers.get("location")).toBe("https://energon.example.com/ada/s/content-origin/");

    const content = await req("https://energon.example.com/ada/s/content-origin/");
    expect(content.headers.get("access-control-allow-origin")).toBe("https://hub.energon.example.com");

    const token = await mint("cors-file");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "space file.txt", "content-type": "text/plain" }),
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
    const malformed = await json("/%/s/demo/");

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
    const data = { status: res.status, body: await res.json() };
    expect(data.body.email).toBe(email);
    expect(data.body.sites).toEqual(expect.any(Array));
    expect(data.body.files).toEqual(expect.any(Array));
    expect(data.body).toHaveProperty("sites_total");
    expect(data.body).toHaveProperty("files_total");
    expect(data.body).toHaveProperty("sites_cursor");
    expect(data.body).toHaveProperty("files_cursor");
    expect(data.body.tokens.some((t: { label: string }) => t.label === "listed")).toBe(true);
    expect(JSON.stringify(data.body)).not.toContain(token);
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "hub-gone" }),
    });
    await json("/v1/sites/hub-gone/files/bye.txt", { method: "PUT", headers: auth(token), body: "bye" });
    const siteDel = await json("/account/sites/hub-gone", { method: "DELETE", headers: access(email) });
    expect(siteDel.status).toBe(200);
    expect(siteDel.body.deleted).toBe("hub-gone");
    expect((await req("/hub-del/s/hub-gone/bye.txt")).status).toBe(404);

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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "csrf-site" }),
    });

    const missing = await json("/account/sites/csrf-site", {
      method: "PATCH",
      headers: {
        "Cf-Access-Authenticated-User-Email": email,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "stolen" }),
    });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toBe("bad_origin");

    const cross = await json("/account/sites/csrf-site", {
      method: "PATCH",
      headers: access(email, {
        origin: "https://energon.example.com",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ password: "stolen" }),
    });
    expect(cross.status).toBe(403);
    expect(cross.body.error).toBe("bad_origin");

    const form = await json("/account/sites/csrf-site", {
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
});
