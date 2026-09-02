import { describe, expect, it } from "vitest";
import { access, auth, json, mint, req } from "./helpers";

describe("host and route contracts", () => {
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
});

describe("hub account API", () => {
  it("exposes list totals and cursors without leaking token secrets", async () => {
    const email = "hub-data@esperlabs.app";
    const token = await mint("listed", email);
    const data = await json("/account/data", { headers: access(email) });
    expect(data.status).toBe(200);
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
});
