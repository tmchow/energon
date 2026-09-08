import { env } from "cloudflare:test";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_FILES } from "../src/config";
import { GATE_COOKIE, hashSharePassword, unlockToken } from "../src/gate";
import { auth, access, createSite, json, mint, mintAdmin, req } from "./helpers";

describe("Energon", () => {
  it("GET /v1/health is unauthenticated", async () => {
    const { status, body } = await json("/v1/health");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("GET /llms.txt is public and has no secrets", async () => {
    const res = await req("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/markdown/);
    const text = await res.text();
    expect(text).toContain("Energon");
    expect(text).toContain("agent-native publishing");
    expect(text).toContain("ENERGON_TOKEN");
    expect(text).toContain("/v1/help");
    expect(text).toContain("user (global) scope");
    expect(text).toContain("unless the human asked for that");
    expect(text).toContain("token_expired");
    expect(text).not.toMatch(/ee_live_[A-Za-z0-9]+/);
  });

  it("minted tokens are shown once and cannot be recovered", async () => {
    const email = "reveal@esperlabs.app";
    const token = await mint("keep-me", email);
    const listed = await json("/account/data", {
      headers: access(email),
    });
    const row = listed.body.tokens.find((t: { label: string }) => t.label === "keep-me");
    expect(row.recoverable).toBe(false);
    expect(row.hint).toBe(`ee_live_…${token.slice(-4)}`);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    const shown = await json(`/account/tokens/${row.id}`, {
      headers: { "Cf-Access-Authenticated-User-Email": email },
    });
    expect(shown.status).toBe(404);
    expect(shown.body.token).toBeUndefined();
  });

  it("GET /v1/help is unauthenticated and describes the API", async () => {
    const { status, body } = await json("/v1/help");
    expect(status).toBe(200);
    expect(body.env).toBe("ENERGON_TOKEN");
    expect(body.content_origin).toBe("https://energon.example.com");
    expect(body.account).toContain("/account");
    expect(body.limits.file_bytes).toBe(25 * 1024 * 1024);
    expect(body.limits.zip_bytes).toBe(25 * 1024 * 1024);
    expect(body.limits.platform_bytes).toBe(20 * 1024 * 1024 * 1024);
    expect(body.limits.max_import_files).toBe(200);
    expect(body.retention.file_bytes).toBe(25 * 1024 * 1024);
    expect(body.retention.allow_unlimited).toBe(true);
    expect(body.retention.default_ttl).toBe("never");
    expect(body.retention.presets.some((p: { id: string; label: string }) => p.id === "90d" && p.label === "3 months")).toBe(
      true,
    );
    expect(body.retention.presets.at(-1)).toMatchObject({ id: "never", label: "Never" });
    expect(body.retention.write_policy).toBe("org");
    expect(body.tokens.default).toBe("90d");
    expect(body.tokens.allow_never).toBe(true);
    expect(body.tokens.tokens_url).toBe("https://hub.energon.example.com/tokens");
    expect(body.tokens.presets.map((p: { id: string }) => p.id)).toEqual(["1d", "7d", "30d", "60d", "90d", "180d", "365d", "never"]);
    expect(body.sop.some((line: string) => line.includes("token_expired") && line.includes("/tokens"))).toBe(true);
  });

  it("curl without token to /v1/sites is 401 pointing at hub", async () => {
    const { status, body } = await json("/v1/sites");
    expect(status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(body.hub).toBe("https://hub.energon.example.com/account");
    expect(body.message).toContain("/tokens");
    expect(body.message).toContain("ENERGON_TOKEN");
  });

  it("create site, PUT index.html, serve it, duplicate slug creates new site", async () => {
    const token = await mint("laptop");
    const created = await createSite(token, "demo", { overwrite: false });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe(`https://energon.example.com/ada/s/${created.body.id}/demo/`);
    expect(created.body.handle).toBe("ada");
    expect(created.body.created).toBe(true);
    expect(created.body.password_protected).toBe(false);

    const put = await json(`/v1/sites/${created.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>hello demo</h1>",
    });
    expect(put.status).toBe(201);
    expect(put.body.url).toBe(`https://energon.example.com/ada/s/${created.body.id}/demo/index.html`);
    expect(put.body.api_url).toBe(`https://hub.energon.example.com/v1/sites/${created.body.id}/files/index.html`);

    const viaApi = await req(`/v1/sites/${created.body.id}/files/index.html`, { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toContain("hello demo");

    const page = await req(`/ada/s/${created.body.id}/demo/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello demo");
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(page.headers.get("cache-control")).toMatch(/public/);
    expect(page.headers.get("cache-control")).toMatch(/s-maxage=86400/);
    expect(page.headers.get("content-security-policy")).toContain("sandbox");
    expect(page.headers.get("content-security-policy")).not.toContain("allow-same-origin");

    const again = await createSite(token, "demo");
    expect(again.status).toBe(201);
    expect(again.body.created).toBe(true);
    expect(again.body.id).not.toBe(created.body.id);
    expect(again.body.url).toContain(`/ada/s/${again.body.id}/demo/`);

    const listing = await json(`/v1/sites/${created.body.id}`, { headers: auth(token) });
    expect(listing.status).toBe(200);
    expect(listing.body.files).toHaveLength(1);
  });

  it("duplicate slug sites are independent", async () => {
    const token = await mint("ci");
    const first = await createSite(token, "keep-both");
    await json(`/v1/sites/${first.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>one</h1>",
    });
    const second = await createSite(token, "keep-both");
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.id);

    const put2 = await json(`/v1/sites/${second.id}/files/notes.md`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/markdown" }),
      body: "hello",
    });
    expect(put2.status).toBe(201);

    const firstListing = await json(`/v1/sites/${first.id}`, { headers: auth(token) });
    expect(firstListing.body.files.map((f: { path: string }) => f.path)).toEqual(["index.html"]);
    const secondListing = await json(`/v1/sites/${second.id}`, { headers: auth(token) });
    expect(secondListing.body.files.map((f: { path: string }) => f.path)).toEqual(["notes.md"]);
  });

  it("PUT to unknown slug is 404 and does not create", async () => {
    const token = await mint("put-unknown");
    const put = await json("/v1/sites/ghost/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>nope</h1>",
    });
    expect(put.status).toBe(404);
    expect(put.body.error).toBe("site_not_found");
    expect(put.body.message).toContain("POST /v1/sites");

    const sites = await json("/v1/sites", { headers: auth(token) });
    const slugs = (sites.body.sites || []).map((s: { slug: string }) => s.slug);
    expect(slugs).not.toContain("ghost");
  });

  it("site with only notes.md serves a file list at / and the file at /notes.md", async () => {
    const token = await mint("notes-only");
    const site_notes_site = await createSite(token, "notes-site");
    await json(`/v1/sites/${site_notes_site.id}/files/notes.md`, {
      method: "PUT",
      headers: auth(token),
      body: "# notes",
    });
    const index = await req(`/ada/s/${site_notes_site.id}/notes-site/`);
    expect(index.status).toBe(200);
    const html = await index.text();
    expect(html).toContain("No index.html or index.md");
    expect(html).toContain("notes.md");
    expect(html).not.toMatch(/@esperlabs\.app/);

    const file = await req(`/ada/s/${site_notes_site.id}/notes-site/notes.md`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toMatch(/markdown/);
    expect(await file.text()).toBe("# notes");
  });

  it("loose file POST returns a unique URL that downloads", async () => {
    const token = await mint("loose");
    const a = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "hello.txt", "content-type": "text/plain" }),
      body: "hello world",
    });
    expect(a.status).toBe(201);
    expect(a.body.url).toMatch(/^https:\/\/energon\.example\.com\/ada\/f\/[A-Za-z0-9]{6}\/hello\.txt$/);
    expect(a.body.handle).toBe("ada");
    expect(a.body.api_url).toBe(`https://hub.energon.example.com/v1/files/${a.body.id}`);
    const viaApi = await req(`/v1/files/${a.body.id}`, { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toBe("hello world");
    const path = new URL(a.body.url).pathname;
    const got = await req(path);
    expect(got.status).toBe(200);
    expect(got.headers.get("location")).toBeNull();
    expect(await got.text()).toBe("hello world");

    const b = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "hello.txt", "content-type": "text/plain" }),
      body: "hello world",
    });
    expect(b.body.url).not.toBe(a.body.url);

    const spaced = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "My Notes.md", "content-type": "text/markdown" }),
      body: "notes",
    });
    expect(spaced.body.url).toMatch(/\/ada\/f\/[A-Za-z0-9]{6}\/My_Notes\.md$/);
    expect(spaced.body.filename).toBe("My Notes.md");
    const spacedGet = await req(new URL(spaced.body.url).pathname);
    expect(spacedGet.status).toBe(200);
    expect(await spacedGet.text()).toBe("notes");
  });

  it("PUT /v1/files/{id} replaces bytes and keeps the same URL", async () => {
    const token = await mint("revise");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "notes.md", "content-type": "text/markdown" }),
      body: "# v1",
    });
    expect(created.status).toBe(201);
    const replaced = await json(`/v1/files/${created.body.id}`, {
      method: "PUT",
      headers: auth(token, { "X-Filename": "notes.md", "content-type": "text/markdown" }),
      body: "# v2\nrevised",
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.replaced).toBe(true);
    expect(replaced.body.id).toBe(created.body.id);
    expect(replaced.body.url).toBe(created.body.url);
    expect(replaced.body.api_url).toBe(created.body.api_url);
    const viaApi = await req(`/v1/files/${created.body.id}`, { headers: auth(token) });
    expect(await viaApi.text()).toBe("# v2\nrevised");
    const missing = await json("/v1/files/doesnotexist00000000000", {
      method: "PUT",
      headers: auth(token, { "X-Filename": "x.txt" }),
      body: "nope",
    });
    expect(missing.status).toBe(404);
  });

  it("failed password validation leaves renamed loose-file content intact", async () => {
    const token = await mint("invalid-password-rename");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "old.txt", "content-type": "text/plain" }),
      body: "original",
    });

    const replaced = await json(`/v1/files/${created.body.id}`, {
      method: "PUT",
      headers: auth(token, {
        "X-Filename": "new.txt",
        "X-Energon-Set-Password": "x".repeat(129),
        "content-type": "text/plain",
      }),
      body: "replacement",
    });
    expect(replaced.status).toBe(400);
    expect(replaced.body.error).toBe("bad_password");

    const viaApi = await req(`/v1/files/${created.body.id}`, { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toBe("original");

    const publicFile = await req(new URL(created.body.url).pathname);
    expect(publicFile.status).toBe(200);
    expect(await publicFile.text()).toBe("original");
  });

  it("POST a zip to /v1/files stays a zip, not a site", async () => {
    const token = await mint("zip-loose");
    const zipped = zipSync({ "index.html": strToU8("<h1>inside</h1>") });
    const posted = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "site.zip", "content-type": "application/zip" }),
      body: zipped,
    });
    expect(posted.status).toBe(201);
    expect(posted.body.filename).toBe("site.zip");
    const path = new URL(posted.body.url).pathname;
    const got = await req(path);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toMatch(/zip/);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("import zip with wrapping folder puts index.html at site root", async () => {
    const token = await mint("import");
    const site_wrapped = await createSite(token, "wrapped");
    const zipped = zipSync({
      "my-site/index.html": strToU8("<h1>root</h1>"),
      "my-site/css/app.css": strToU8("body{color:red}"),
    });
    const imported = await json(`/v1/sites/${site_wrapped.id}/import`, {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipped,
    });
    expect(imported.status).toBe(200);
    expect(imported.body.written.sort()).toEqual(["css/app.css", "index.html"]);
    const page = await req(`/ada/s/${site_wrapped.id}/wrapped/`);
    expect(await page.text()).toContain("root");
  });

  it("26 MB file is 413 mentioning the 25 MB cap", async () => {
    const token = await mint("big");
    const site_big_site = await createSite(token, "big-site");
    const tooBig = await json(`/v1/sites/${site_big_site.id}/files/huge.bin`, {
      method: "PUT",
      headers: auth(token, { "content-length": String(26 * 1024 * 1024) }),
      body: "x",
    });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe("too_large");
    expect(tooBig.body.message).toContain("25 MB");
  });

  it("revoked token cannot PUT", async () => {
    const email = "revoker@esperlabs.app";
    const token = await mint("to-revoke", email);
    const listed = await json("/account/data", {
      headers: access(email),
    });
    const id = listed.body.tokens.find((t: { label: string }) => t.label === "to-revoke").id;
    const revoked = await json(`/account/tokens/${id}/revoke`, {
      method: "POST",
      headers: access(email),
    });
    expect(revoked.status).toBe(200);
    const put = await createSite(token, "after-revoke");
    expect(put.status).toBe(401);
    expect(put.body.message).toContain("/auth.md");
    expect(put.body.message).toContain("/tokens");
  });

  describe("token lifetime", () => {
    const DAY = 86400 * 1000;
    const near = (iso: string, expectedMs: number) => Math.abs(Date.parse(iso) - expectedMs) < 60 * 1000;

    it("stores the chosen preset and authenticates until it passes", async () => {
      const email = "ttl-seven@esperlabs.app";
      const before = Date.now();
      const created = await json("/account/tokens", {
        method: "POST",
        headers: access(email, { "content-type": "application/json" }),
        body: JSON.stringify({ label: "ci", ttl: "7d" }),
      });
      expect(created.status).toBe(201);
      expect(near(created.body.expires_at, before + 7 * DAY)).toBe(true);
      const me = await json("/v1/whoami", { headers: auth(created.body.token) });
      expect(me.status).toBe(200);
    });

    it("defaults to 90 days when ttl is omitted", async () => {
      const email = "ttl-default@esperlabs.app";
      const before = Date.now();
      await mint("default-life", email);
      const listed = await json("/account/data", { headers: access(email) });
      const row = listed.body.tokens.find((t: { label: string }) => t.label === "default-life");
      expect(near(row.expires_at, before + 90 * DAY)).toBe(true);
      expect(row.expired).toBe(false);
    });

    it("rejects a ttl outside the preset list", async () => {
      const bad = await json("/account/tokens", {
        method: "POST",
        headers: access("ttl-bad@esperlabs.app", { "content-type": "application/json" }),
        body: JSON.stringify({ label: "odd", ttl: "3h" }),
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("bad_ttl");
      expect(bad.body.message).toContain("1d, 7d, 30d, 60d, 90d, 180d, 365d, never");
    });

  it("mints a never-expiring token on the default Energon", async () => {
      const email = "ttl-never@esperlabs.app";
      await mint("forever", email, undefined, "never");
      const listed = await json("/account/data", { headers: access(email) });
      const row = listed.body.tokens.find((t: { label: string }) => t.label === "forever");
      expect(row.expires_at).toBeNull();
      expect(row.expired).toBe(false);
    });

    it("lists an expired token as expired and still lets its owner revoke it", async () => {
      const { env } = await import("cloudflare:test");
      const email = "ttl-expired@esperlabs.app";
      await mint("stale", email, undefined, "1d");
      await env.DB.prepare(`UPDATE tokens SET expires_at = ? WHERE label = ? AND user_email = ?`)
        .bind("2000-01-01T00:00:00.000Z", "stale", email)
        .run();
      await mint("garbled", email);
      await env.DB.prepare(`UPDATE tokens SET expires_at = ? WHERE label = ? AND user_email = ?`)
        .bind("not-a-date", "garbled", email)
        .run();

      const listed = await json("/account/data", { headers: access(email) });
      const stale = listed.body.tokens.find((t: { label: string }) => t.label === "stale");
      const garbled = listed.body.tokens.find((t: { label: string }) => t.label === "garbled");
      expect(stale.expired).toBe(true);
      expect(garbled.expired).toBe(true);

      const foreign = await json(`/account/tokens/${stale.id}/revoke`, {
        method: "POST",
        headers: access("someone-else@esperlabs.app"),
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body.error).toBe("token_not_found");

      const revoked = await json(`/account/tokens/${stale.id}/revoke`, { method: "POST", headers: access(email) });
      expect(revoked.status).toBe(200);
      const after = await json("/account/data", { headers: access(email) });
      expect(after.body.tokens.find((t: { label: string }) => t.label === "stale").revoked).toBe(true);
    });
  });

  it("two users' tokens can both write the same site", async () => {
    const ada = await mint("ada-key", "ada-two@esperlabs.app");
    const bob = await mint("bob-key", "bob@esperlabs.app");
    const site_shared = await createSite(ada, "shared");
    await json(`/v1/sites/${site_shared.id}/files/a.txt`, {
      method: "PUT",
      headers: auth(ada),
      body: "ada",
    });
    await json(`/v1/sites/${site_shared.id}/files/b.txt`, {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    const listing = await json(`/v1/sites/${site_shared.id}`, { headers: auth(ada) });
    const paths = listing.body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(["a.txt", "b.txt"]);
    expect(listing.body.last_written_by).toBe("bob@esperlabs.app");
    expect(listing.body.write_policy).toBe("org");
  });

  it("owner write_policy 403s a second token on mutate and lets the creator flip it", async () => {
    const ada = await mint("ada-owner", "ada-owner@esperlabs.app");
    const bob = await mint("bob-owner", "bob-owner@esperlabs.app");
    const created = await createSite(ada, "private-draft", { write_policy: "owner" });
    expect(created.status).toBe(201);
    expect(created.body.write_policy).toBe("owner");
    const listing = await json(`/v1/sites/${created.body.id}`, { headers: auth(ada) });
    expect(listing.status).toBe(200);
    expect(listing.body.write_policy).toBe("owner");
    const bobPut = await json(`/v1/sites/${created.body.id}/files/b.txt`, {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    expect(bobPut.status).toBe(403);
    expect(bobPut.body.error).toBe("forbidden_write");
    const bobPatch = await json(`/v1/sites/${created.body.id}`, {
      method: "PATCH",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "org" }),
    });
    expect(bobPatch.status).toBe(403);
    expect(bobPatch.body.error).toBe("forbidden_write_policy");
    const adaPatch = await json(`/v1/sites/${created.body.id}`, {
      method: "PATCH",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "org" }),
    });
    expect(adaPatch.status).toBe(200);
    expect(adaPatch.body.write_policy).toBe("org");
    const bobPutAfter = await json(`/v1/sites/${created.body.id}/files/b.txt`, {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    expect(bobPutAfter.status).toBe(201);
    const adaLock = await json(`/v1/sites/${created.body.id}`, {
      method: "PATCH",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "owner" }),
    });
    expect(adaLock.status).toBe(200);
    const bobDelete = await json(`/v1/sites/${created.body.id}`, {
      method: "DELETE",
      headers: auth(bob),
    });
    expect(bobDelete.status).toBe(403);
  });

  it("a new IdP subject with a reused email cannot write owner-only objects or keep old tokens", async () => {
    const email = "reused@esperlabs.app";
    const tokenA = await mint("keep-a", email, { "Cf-Access-Authenticated-User-Sub": "sub-a" });
    const created = await createSite(tokenA, "owned-draft", { write_policy: "owner" });
    expect(created.status).toBe(201);
    const tokenB = await mint("keep-b", email, { "Cf-Access-Authenticated-User-Sub": "sub-b" });
    const whoA = await json("/v1/whoami", { headers: auth(tokenA) });
    expect(whoA.status).toBe(401);
    const stolen = await json(`/v1/sites/${created.body.id}/files/b.txt`, {
      method: "PUT",
      headers: auth(tokenB),
      body: "nope",
    });
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe("forbidden_write");
    const catalog = await json("/v1/sites", { headers: auth(tokenB) });
    expect((catalog.body.sites || []).map((s: { slug: string }) => s.slug)).not.toContain("owned-draft");
    const listed = await json("/account/data", {
      headers: {
        "Cf-Access-Authenticated-User-Email": email,
        "Cf-Access-Authenticated-User-Sub": "sub-b",
      },
    });
    const labels = (listed.body.tokens || [])
      .filter((t: { revoked: boolean }) => !t.revoked)
      .map((t: { label: string }) => t.label);
    expect(labels).toContain("keep-b");
    expect(labels).not.toContain("keep-a");
  });

  it("duplicate_from copies a site without password or write policy and the duplicator owns it", async () => {
    const ada = await mint("ada-dup", "ada-dup@esperlabs.app");
    const bob = await mint("bob-dup", "bob-dup@esperlabs.app");
    const site_source_draft = await createSite(ada, "source-draft", { write_policy: "owner", password: "secret-pw", write_password: "guest-write-ok" });
    await json(`/v1/sites/${site_source_draft.id}/files/index.html`, {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/html" }),
      body: "<h1>source</h1>",
    });
    const bobPut = await json(`/v1/sites/${site_source_draft.id}/files/x.txt`, {
      method: "PUT",
      headers: auth(bob),
      body: "nope",
    });
    expect(bobPut.status).toBe(403);
    const copied = await createSite(bob, "source-draft-2", { duplicate_from: site_source_draft.id });
    expect(copied.status).toBe(201);
    expect(copied.body.duplicated).toBe(true);
    expect(copied.body.duplicated_from).toBe(site_source_draft.id);
    expect(copied.body.file_count).toBe(1);
    expect(copied.body.password_protected).toBe(false);
    expect(copied.body.write_password_protected).toBe(false);
    expect(copied.body.write_policy).toBe("org");
    expect(copied.body.handle).not.toBe(copied.body.duplicated_from);
    const listing = await json(`/v1/sites/${copied.body.id}`, { headers: auth(bob) });
    expect(listing.status).toBe(200);
    expect(listing.body.created_by).toBe("bob-dup@esperlabs.app");
    expect(listing.body.write_policy).toBe("org");
    expect(listing.body.password_protected).toBe(false);
    expect(listing.body.write_password_protected).toBe(false);
    expect(listing.body.files.map((f: { path: string }) => f.path)).toEqual(["index.html"]);
    const bytes = await req(`/v1/sites/${copied.body.id}/files/index.html`, { headers: auth(bob) });
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("<h1>source</h1>");
    const bobEdit = await json(`/v1/sites/${copied.body.id}/files/note.txt`, {
      method: "PUT",
      headers: auth(bob),
      body: "mine",
    });
    expect(bobEdit.status).toBe(201);
    const clash = await createSite(bob, "source-draft-2", { duplicate_from: site_source_draft.id });
    expect(clash.status).toBe(201);
    expect(clash.body.id).not.toBe(copied.body.id);
    const overwriteDup = await createSite(bob, "other", { duplicate_from: site_source_draft.id, overwrite: true });
    expect(overwriteDup.status).toBe(400);
    expect(overwriteDup.body.error).toBe("bad_duplicate");
  });

  it("duplicate_from copies a loose file to a new id", async () => {
    const ada = await mint("ada-file-dup", "ada-file-dup@esperlabs.app");
    const bob = await mint("bob-file-dup", "bob-file-dup@esperlabs.app");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "notes.txt", "X-Energon-Write-Policy": "owner", "X-Energon-Set-Write-Password": "guest-write-ok" }),
      body: "original-bytes",
    });
    expect(created.status).toBe(201);
    const copied = await json("/v1/files", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ duplicate_from: created.body.id, filename: "notes-copy.txt" }),
    });
    expect(copied.status).toBe(201);
    expect(copied.body.duplicated).toBe(true);
    expect(copied.body.duplicated_from).toBe(created.body.id);
    expect(copied.body.id).not.toBe(created.body.id);
    expect(copied.body.filename).toBe("notes-copy.txt");
    expect(copied.body.write_policy).toBe("org");
    expect(copied.body.write_password_protected).toBe(false);
    expect(copied.body.created_by).toBe("bob-file-dup@esperlabs.app");
    const listed = await json("/v1/files", { headers: auth(bob) });
    const row = listed.body.files.find((f: { id: string }) => f.id === copied.body.id);
    expect(row.created_by).toBe("bob-file-dup@esperlabs.app");
    expect(row.write_policy).toBe("org");
    expect(row.write_password_protected).toBe(false);
    const got = await req(`/v1/files/${copied.body.id}`, { headers: auth(bob) });
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("original-bytes");
    const missing = await json("/v1/files", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ duplicate_from: "zzzzzz" }),
    });
    expect(missing.status).toBe(404);
  });

  it("POST /v1/files with application/json and X-Filename still uploads the file", async () => {
    const token = await mint("json-file", "json-file@esperlabs.app");
    const payload = '{"hello":true}';
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json", "X-Filename": "data.json" }),
      body: payload,
    });
    expect(created.status).toBe(201);
    expect(created.body.filename).toBe("data.json");
    expect(created.body.duplicated).toBeUndefined();
    const got = await req(`/v1/files/${created.body.id}`, { headers: auth(token) });
    expect(got.status).toBe(200);
    expect(await got.text()).toBe(payload);
    const asFile = '{"duplicate_from":"looks-like-a-request"}';
    const second = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json", "X-Filename": "looks.json" }),
      body: asFile,
    });
    expect(second.status).toBe(201);
    expect(second.body.duplicated).toBeUndefined();
    expect(await (await req(`/v1/files/${second.body.id}`, { headers: auth(token) })).text()).toBe(asFile);
  });

  it("owner write_policy on a loose file 403s a second token", async () => {
    const ada = await mint("ada-file-owner", "ada-file-owner@esperlabs.app");
    const bob = await mint("bob-file-owner", "bob-file-owner@esperlabs.app");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "notes.txt", "X-Energon-Write-Policy": "owner" }),
      body: "hello",
    });
    expect(created.status).toBe(201);
    expect(created.body.write_policy).toBe("owner");
    const listed = await json("/v1/files", { headers: auth(ada) });
    const row = listed.body.files.find((f: { id: string }) => f.id === created.body.id);
    expect(row.write_policy).toBe("owner");
    const got = await req(`/v1/files/${created.body.id}`, { headers: auth(ada) });
    expect(got.status).toBe(200);
    expect(got.headers.get("x-energon-write-policy")).toBe("owner");
    expect(await got.text()).toBe("hello");
    const bobPut = await json(`/v1/files/${created.body.id}`, {
      method: "PUT",
      headers: auth(bob, { "X-Filename": "notes.txt" }),
      body: "bob",
    });
    expect(bobPut.status).toBe(403);
    expect(bobPut.body.error).toBe("forbidden_write");
    const bobDel = await json(`/v1/files/${created.body.id}`, {
      method: "DELETE",
      headers: auth(bob),
    });
    expect(bobDel.status).toBe(403);
  });

  it("another token can fetch published bytes over /v1", async () => {
    const writer = await mint("writer", "writer@esperlabs.app");
    const reader = await mint("reader", "reader@esperlabs.app");
    const site_handoff = await createSite(writer, "handoff");
    await json(`/v1/sites/${site_handoff.id}/files/brief.md`, {
      method: "PUT",
      headers: auth(writer, { "content-type": "text/markdown" }),
      body: "# brief\nfor the other session",
    });
    const got = await req(`/v1/sites/${site_handoff.id}/files/brief.md`, { headers: auth(reader) });
    expect(got.status).toBe(200);
    expect(await got.text()).toContain("other session");
  });

  it("whoami returns token label, owner email, and expiry", async () => {
    const token = await mint("whoami-key", "who@esperlabs.app");
    const me = await json("/v1/whoami", { headers: auth(token) });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("who@esperlabs.app");
    expect(me.body.label).toBe("whoami-key");
    expect(me.body.scope).toBe("account");
    expect(me.body.admin).toBe(false);
    expect(Date.parse(me.body.expires_at)).toBeGreaterThan(Date.now() + 89 * 86400 * 1000);

    const forever = await mint("whoami-forever", "who@esperlabs.app", undefined, "never");
    const meForever = await json("/v1/whoami", { headers: auth(forever) });
    expect(meForever.body.expires_at).toBeNull();
  });

  it("expired token gets a terminal token_expired 401 and no usage bump", async () => {
    const { env } = await import("cloudflare:test");
    const email = "expired-writer@esperlabs.app";
    const token = await mint("dead-key", email, undefined, "1d");
    await env.DB.prepare(`UPDATE tokens SET expires_at = ? WHERE label = ? AND user_email = ?`)
      .bind("2000-01-01T00:00:00.000Z", "dead-key", email)
      .run();

    const put = await json("/v1/sites/x/files/a.txt", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/plain" }),
      body: "late",
    });
    expect(put.status).toBe(401);
    expect(put.body.error).toBe("token_expired");
    for (const clause of ["/tokens", "ENERGON_TOKEN", "2000-01-01", "mint", "cannot be extended", "Do not retry", "Do not invent"]) {
      expect(put.body.message).toContain(clause);
    }
    expect(put.body).toMatchObject({ expired_at: "2000-01-01T00:00:00.000Z", tokens_url: "https://hub.energon.example.com/tokens" });
    expect(put.body.hub).toBeDefined();
    for (const leak of ["token_hash", "token_hint", "user_email", "user_id"]) {
      expect(put.body).not.toHaveProperty(leak);
    }
    const row = await env.DB.prepare(`SELECT last_used_at FROM tokens WHERE label = ? AND user_email = ?`)
      .bind("dead-key", email)
      .first<{ last_used_at: string | null }>();
    expect(row?.last_used_at).toBeNull();
  });

  it("grandfathered NULL expiry still authenticates and revoked wins over expired", async () => {
    const { env } = await import("cloudflare:test");
    const email = "legacy-holder@esperlabs.app";
    const legacy = await mint("legacy-key", email, undefined, "1d");
    await env.DB.prepare(`UPDATE tokens SET expires_at = NULL, created_at = ? WHERE label = ? AND user_email = ?`)
      .bind("2024-01-01T00:00:00.000Z", "legacy-key", email)
      .run();
    const me = await json("/v1/whoami", { headers: auth(legacy) });
    expect(me.status).toBe(200);
    expect(me.body.expires_at).toBeNull();

    const both = await mint("both-key", email, undefined, "1d");
    const listed = await json("/account/data", { headers: access(email) });
    const id = listed.body.tokens.find((t: { label: string }) => t.label === "both-key").id;
    await json(`/account/tokens/${id}/revoke`, { method: "POST", headers: access(email) });
    await env.DB.prepare(`UPDATE tokens SET expires_at = ? WHERE id = ?`).bind("2000-01-01T00:00:00.000Z", id).run();
    const res = await json("/v1/whoami", { headers: auth(both) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("rejects zip path traversal", async () => {
    const token = await mint("zip-trav");
    const site_safe_zip = await createSite(token, "safe-zip");
    const zipped = zipSync({ "../secret.txt": strToU8("nope") });
    const imported = await json(`/v1/sites/${site_safe_zip.id}/import`, {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipped,
    });
    expect(imported.status).toBe(400);
    expect(imported.body.error).toBe("bad_zip_path");
  });

  it("site slugs are not reserved; account is a fine site name", async () => {
    const token = await mint("reserved");
    const created = await createSite(token, "account");
    expect(created.status).toBe(201);
    expect(created.body.url).toBe(`https://energon.example.com/ada/s/${created.body.id}/account/`);
  });

  it("DELETE site removes files", async () => {
    const token = await mint("deleter");
    const site_temp_site = await createSite(token, "temp-site");
    await json(`/v1/sites/${site_temp_site.id}/files/bye.txt`, {
      method: "PUT",
      headers: auth(token),
      body: "bye",
    });
    const del = await json(`/v1/sites/${site_temp_site.id}`, { method: "DELETE", headers: auth(token) });
    expect(del.status).toBe(200);
    const got = await req(`/ada/s/${site_temp_site.id}/temp-site/bye.txt`);
    expect(got.status).toBe(404);
  });

  it("DELETE a loose file removes the object", async () => {
    const token = await mint("del-file");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "gone.txt", "content-type": "text/plain" }),
      body: "bye",
    });
    expect(created.status).toBe(201);
    const path = new URL(created.body.url).pathname;
    const del = await json(`/v1/files/${created.body.id}`, { method: "DELETE", headers: auth(token) });
    expect(del.status).toBe(200);
    const missing = await req(path);
    expect(missing.status).toBe(404);
    const viaApi = await json(`/v1/files/${created.body.id}`, { headers: auth(token) });
    expect(viaApi.status).toBe(404);
  });

  it("lists page with a keyset cursor and search the full set", async () => {
    const token = await mint("pager", "pager@esperlabs.app");
    for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) {
      await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": name, "content-type": "text/plain" }),
        body: name,
      });
    }
    const first = await json("/v1/files?sort=name&limit=2", { headers: auth(token) });
    expect(first.status).toBe(200);
    expect(first.body.total).toBeGreaterThanOrEqual(3);
    expect(first.body.files).toHaveLength(2);
    expect(first.body.files.map((f: { filename: string }) => f.filename)).toEqual(["alpha.txt", "beta.txt"]);
    expect(first.body.next_cursor).toBeTruthy();

    const second = await json("/v1/files?sort=name&limit=2&cursor=" + encodeURIComponent(first.body.next_cursor), {
      headers: auth(token),
    });
    expect(second.body.files.map((f: { filename: string }) => f.filename)).toContain("gamma.txt");

    const found = await json("/v1/files?q=gamma", { headers: auth(token) });
    expect(found.body.files.map((f: { filename: string }) => f.filename)).toEqual(["gamma.txt"]);
    expect(found.body.total).toBe(1);
  });

  it("minting a token requires a label", async () => {
    const empty = await json("/account/tokens", {
      method: "POST",
      headers: access("label@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "   " }),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("bad_label");
  });

  it("optional share password gates the public URL, not /v1", async () => {
    const token = await mint("pw-site");
    const created = await createSite(token, "gated", { overwrite: false, password: "hunter2" });
    expect(created.status).toBe(201);
    expect(created.body.password_protected).toBe(true);
    expect(created.body.password).toBe("hunter2");

    const listed = await json(`/v1/sites/${created.body.id}`, { headers: auth(token) });
    expect(listed.status).toBe(200);
    expect(listed.body.password_protected).toBe(true);
    expect(listed.body).not.toHaveProperty("password");

    const hub = await json(`/account/sites/${created.body.id}`, { headers: access("ada@esperlabs.app") });
    expect(hub.status).toBe(200);
    expect(hub.body.password).toBe("hunter2");
    expect(hub.body.password_protected).toBe(true);
    expect(hub.body.write_password_protected).toBe(false);
    expect(hub.body.write_password).toBeNull();

    await json(`/v1/sites/${created.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>secret page</h1>",
    });

    const viaApi = await req(`/v1/sites/${created.body.id}/files/index.html`, { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toContain("secret page");

    const blocked = await req(`/ada/s/${created.body.id}/gated/`);
    expect(blocked.status).toBe(401);
    const html = await blocked.text();
    expect(html).toContain("password-protected");
    expect(html).toContain("X-Energon-Password");

    const asJson = await json(`/ada/s/${created.body.id}/gated/`, { headers: { accept: "application/json" } });
    expect(asJson.status).toBe(401);
    expect(asJson.body.error).toBe("password_required");

    const wrong = await json(`/ada/s/${created.body.id}/gated/`, { headers: { "X-Energon-Password": "nope" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("password_required");

    const unlocked = await req(`/ada/s/${created.body.id}/gated/`, { headers: { "X-Energon-Password": "hunter2" } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toContain("secret page");
    expect(unlocked.headers.get("cache-control")).toMatch(/no-store/);
    expect(unlocked.headers.get("content-security-policy")).toContain("sandbox");

    const cookieVal = await unlockToken(await hashSharePassword("hunter2"));
    const viaCookie = await req(`/ada/s/${created.body.id}/gated/`, {
      headers: { cookie: `${GATE_COOKIE}=${cookieVal}` },
    });
    expect(viaCookie.status).toBe(200);
    expect(await viaCookie.text()).toContain("secret page");

    const formOk = await req(`/ada/s/${created.body.id}/gated/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
      redirect: "manual",
    });
    expect(formOk.status).toBe(303);

    const multipart = await req(`/ada/s/${created.body.id}/gated/`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\nhunter2\r\n--x--",
    });
    expect(multipart.status).toBe(415);

    const huge = await req(`/ada/s/${created.body.id}/gated/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "99999",
      },
      body: "password=hunter2",
    });
    expect(huge.status).toBe(413);
  }, 15_000);

  it("Hub site phrase GET requires catalog involvement", async () => {
    const token = await mint("phrase-owner");
    const created = await createSite(token, "phrase-leak", { overwrite: false, password: "correct-horse" });
    expect(created.status).toBe(201);

    const stranger = await json(`/account/sites/${created.body.id}`, { headers: access("bob@esperlabs.app") });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error).toBe("site_not_found");
    expect(JSON.stringify(stranger.body)).not.toContain("correct-horse");

    const owner = await json(`/account/sites/${created.body.id}`, { headers: access("ada@esperlabs.app") });
    expect(owner.status).toBe(200);
    expect(owner.body.password).toBe("correct-horse");
  });

  it("share password guesses are rate limited per object and source", async () => {
    const token = await mint("pw-limit", "limit@esperlabs.app");
    const site_gated_limit = await createSite(token, "gated-limit", { password: "correct-horse" });
    await json(`/v1/sites/${site_gated_limit.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>limited</h1>",
    });
    const ip = { "CF-Connecting-IP": "203.0.113.88", accept: "application/json", "X-Energon-Password": "wrong" };
    for (let i = 0; i < 20; i++) {
      const wrong = await json(`/limit/s/${site_gated_limit.id}/gated-limit/`, { headers: ip });
      expect(wrong.status).toBe(401);
    }
    const blocked = await json(`/limit/s/${site_gated_limit.id}/gated-limit/`, { headers: ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
    const lockedCorrect = await json(`/limit/s/${site_gated_limit.id}/gated-limit/`, {
      headers: { "CF-Connecting-IP": "203.0.113.88", accept: "application/json", "X-Energon-Password": "correct-horse" },
    });
    expect(lockedCorrect.status).toBe(429);
    const other = await createSite(token, "gated-limit-b", { password: "correct-horse" });
    expect(other.status).toBe(201);
    await json(`/v1/sites/${other.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>other</h1>",
    });
    const otherIp = await req(`/limit/s/${other.body.id}/gated-limit-b/`, {
      headers: { "CF-Connecting-IP": "203.0.113.90", "X-Energon-Password": "correct-horse" },
    });
    expect(otherIp.status).toBe(200);
    expect(await otherIp.text()).toContain("other");
  }, 20_000);

  it("optional share password on a loose file", async () => {
    const token = await mint("pw-file");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, {
        "X-Filename": "secret.txt",
        "X-Energon-Set-Password": "abc",
        "content-type": "text/plain",
      }),
      body: "hidden",
    });
    expect(created.status).toBe(201);
    expect(created.body.password_protected).toBe(true);
    expect(created.body.password).toBe("abc");
    const listed = await json("/v1/files", { headers: auth(token) });
    const row = (listed.body.files || []).find((f: { id: string }) => f.id === created.body.id);
    expect(row.password_protected).toBe(true);
    expect(row).not.toHaveProperty("password");
    const hub = await json(`/account/files/${created.body.id}`, { headers: access("ada@esperlabs.app") });
    expect(hub.status).toBe(200);
    expect(hub.body.password).toBe("abc");
    expect(hub.body.password_protected).toBe(true);
    const path = new URL(created.body.url).pathname;

    const viaApi = await req(`/v1/files/${created.body.id}`, { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toBe("hidden");

    const blocked = await req(path);
    expect(blocked.status).toBe(401);
    const unlocked = await req(path, { headers: { "X-Energon-Password": "abc" } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toBe("hidden");
  }, 15_000);

  it("PATCH sets a share password", async () => {
    const token = await mint("pw-patch");
    const site_patch_me = await createSite(token, "patch-me");
    const set = await json(`/v1/sites/${site_patch_me.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ password: "later" }),
    });
    expect(set.status).toBe(200);
    expect(set.body.password_protected).toBe(true);
    expect(set.body.password).toBe("later");
    const listing = await json(`/v1/sites/${site_patch_me.id}`, { headers: auth(token) });
    expect(listing.status).toBe(200);
    expect(listing.body.password_protected).toBe(true);
    expect(listing.body).not.toHaveProperty("password");
    const hub = await json(`/account/sites/${site_patch_me.id}`, { headers: access("ada@esperlabs.app") });
    expect(hub.status).toBe(200);
    expect(hub.body.password).toBe("later");
    const cleared = await json(`/v1/sites/${site_patch_me.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ password: "" }),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.password_protected).toBe(false);
    expect(cleared.body.password).toBeNull();
  }, 15_000);

  it("directory lists only sites and files you created or last wrote", async () => {
    const ada = await mint("list-ada", "list-ada@esperlabs.app");
    const bob = await mint("list-bob", "list-bob@esperlabs.app");
    const cam = await mint("list-cam", "list-cam@esperlabs.app");
    const site_ada_only = await createSite(ada, "ada-only");
    const site_bob_then_ada = await createSite(bob, "bob-then-ada");
    await json(`/v1/sites/${site_bob_then_ada.id}/files/note.md`, { method: "PUT", headers: auth(ada), body: "hi" });

    const adaList = await json("/v1/sites", { headers: auth(ada) });
    const adaSlugs = (adaList.body.sites || []).map((s: { slug: string }) => s.slug).sort();
    expect(adaSlugs).toContain("ada-only");
    expect(adaSlugs).toContain("bob-then-ada");
    expect(site_ada_only.id).toBeTruthy();

    const camList = await json("/v1/sites", { headers: auth(cam) });
    const camSlugs = (camList.body.sites || []).map((s: { slug: string }) => s.slug);
    expect(camSlugs).not.toContain("ada-only");
    expect(camSlugs).not.toContain("bob-then-ada");

    const edited = await json("/v1/sites?scope=edited&created_by=list-bob@esperlabs.app", { headers: auth(ada) });
    expect((edited.body.sites || []).map((s: { slug: string }) => s.slug)).toEqual(["bob-then-ada"]);

    const dump = await json("/v1/sites?created_by=list-ada@esperlabs.app", { headers: auth(cam) });
    expect(dump.body.sites || []).toEqual([]);
  });

  it("same email prefix in two domains gets two reserved handles", async () => {
    const a = await mint("a", "ada@esperlabs.app");
    const b = await mint("b", "ada@esperlabs.ai");
    const first = await json("/v1/files", {
      method: "POST",
      headers: auth(a, { "X-Filename": "a.txt", "content-type": "text/plain" }),
      body: "a",
    });
    const second = await json("/v1/files", {
      method: "POST",
      headers: auth(b, { "X-Filename": "b.txt", "content-type": "text/plain" }),
      body: "b",
    });
    expect(first.body.handle).toBe("ada");
    expect(second.body.handle).toBe("ada-2");
    expect(first.body.url).toContain("/ada/f/");
    expect(second.body.url).toContain("/ada-2/f/");
  });

  it("browsers render .md, curl and ?raw=1 stay source, index.md is a homepage", async () => {
    const token = await mint("md");
    const site_docs = await createSite(token, "docs");
    const md = [
      "# Hello",
      "",
      "A [link](javascript:alert(1)) and <script>alert(1)</script>.",
      "",
      "![ok](https://example.com/a.png)",
      "![nope](http://example.com/a.png)",
      "",
      "```mermaid",
      "graph LR",
      "  A-->B",
      "```",
      "",
    ].join("\n");
    await json(`/v1/sites/${site_docs.id}/files/notes.md`, {
      method: "PUT",
      headers: auth(token),
      body: md,
    });
    await json(`/v1/sites/${site_docs.id}/files/index.md`, {
      method: "PUT",
      headers: auth(token),
      body: "# Docs home",
    });

    const raw = await req(`/ada/s/${site_docs.id}/docs/notes.md`);
    expect(raw.headers.get("content-type")).toMatch(/markdown/);
    expect(await raw.text()).toBe(md);

    const forced = await req(`/ada/s/${site_docs.id}/docs/notes.md?raw=1`, {
      headers: { accept: "text/html" },
    });
    expect(forced.headers.get("content-type")).toMatch(/markdown/);
    expect(await forced.text()).toBe(md);

    const page = await req(`/ada/s/${site_docs.id}/docs/notes.md`, { headers: { accept: "text/html" } });
    expect(page.headers.get("content-type")).toMatch(/html/);
    const html = await page.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("/static/mermaid/mermaid.esm.min.mjs");
    expect(html).toContain('securityLevel: "strict"');
    expect(html).not.toContain("jsdelivr");
    expect(html).not.toContain("cdn.jsdelivr");
    expect(page.headers.get("content-security-policy")).toContain("sandbox");
    expect(page.headers.get("content-security-policy")).toContain("script-src http://127.0.0.1");
    expect(page.headers.get("content-security-policy")).not.toContain("jsdelivr");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).not.toContain("http://example.com/a.png");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("?raw=1");

    const home = await req(`/ada/s/${site_docs.id}/docs/`, { headers: { accept: "text/html" } });
    const homeHtml = await home.text();
    expect(homeHtml).toContain("<h1>Docs home</h1>");
    expect(homeHtml).not.toContain("/static/mermaid/");

    await json(`/v1/sites/${site_docs.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>HTML wins</h1>",
    });
    const htmlHome = await req(`/ada/s/${site_docs.id}/docs/`);
    expect(await htmlHome.text()).toBe("<h1>HTML wins</h1>");

    const loose = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "brief.md", "content-type": "text/markdown" }),
      body: "## Brief",
    });
    const loosePath = new URL(loose.body.url).pathname;
    const loosePage = await req(loosePath, { headers: { accept: "text/html" } });
    expect(await loosePage.text()).toContain("<h2>Brief</h2>");
    const viaApi = await req(`/v1/files/${loose.body.id}`, { headers: auth(token) });
    expect(await viaApi.text()).toBe("## Brief");
  });

  it("exports a site as a zip and downloads a loose file without zipping it", async () => {
    const token = await mint("export-zip");
    const site_pack_me = await createSite(token, "pack-me");
    const empty = await json(`/v1/sites/${site_pack_me.id}/export`, { headers: auth(token) });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("empty_site");

    await json(`/v1/sites/${site_pack_me.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>packed</h1>",
    });
    await json(`/v1/sites/${site_pack_me.id}/files/css/app.css`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/css" }),
      body: "body{color:navy}",
    });

    const noAuth = await json(`/v1/sites/${site_pack_me.id}/export`);
    expect(noAuth.status).toBe(401);

    const exported = await req(`/v1/sites/${site_pack_me.id}/export`, { headers: auth(token) });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toMatch(/zip/);
    expect(exported.headers.get("content-disposition")).toContain("pack-me.zip");
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/i);
    const unpacked = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(Object.keys(unpacked).sort()).toEqual(["css/app.css", "index.html"]);
    expect(new TextDecoder().decode(unpacked["index.html"])).toContain("packed");
    expect(new TextDecoder().decode(unpacked["css/app.css"])).toContain("navy");

    const hubZip = await req(`/account/sites/${site_pack_me.id}/export`, {
      headers: { "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app" },
    });
    expect(hubZip.status).toBe(200);
    expect(hubZip.headers.get("content-disposition")).toContain("pack-me.zip");

    const loose = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "notes.md", "content-type": "text/markdown" }),
      body: "# keep me",
    });
    const path = new URL(loose.body.url).pathname;
    const inline = await req(path, { headers: { accept: "text/html" } });
    expect(inline.headers.get("content-type")).toMatch(/html/);
    expect(inline.headers.get("content-disposition") || "").not.toMatch(/attachment/i);

    const downloaded = await req(`${path}?download=1`, { headers: { accept: "text/html" } });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toMatch(/markdown/);
    expect(downloaded.headers.get("content-disposition")).toMatch(/attachment/i);
    expect(downloaded.headers.get("content-disposition")).toContain("notes.md");
    expect(await downloaded.text()).toBe("# keep me");

    const viaApi = await req(`/v1/files/${loose.body.id}?download=1`, { headers: auth(token) });
    expect(viaApi.headers.get("content-disposition")).toMatch(/attachment/i);
    expect(await viaApi.text()).toBe("# keep me");

    const hubFile = await req(`/account/files/${loose.body.id}/download`, {
      headers: { "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app" },
    });
    expect(hubFile.status).toBe(200);
    expect(hubFile.headers.get("content-disposition")).toMatch(/attachment/i);
    expect(hubFile.headers.get("content-disposition")).toContain("notes.md");
    expect(await hubFile.text()).toBe("# keep me");
  });

  it("exports a passworded site without the share password", async () => {
    const token = await mint("export-gated");
    const site_gated_zip = await createSite(token, "gated-zip", { password: "hunter2" });
    await json(`/v1/sites/${site_gated_zip.id}/files/secret.txt`, {
      method: "PUT",
      headers: auth(token),
      body: "hidden",
    });
    const exported = await req(`/v1/sites/${site_gated_zip.id}/export`, { headers: auth(token) });
    expect(exported.status).toBe(200);
    const unpacked = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(new TextDecoder().decode(unpacked["secret.txt"])).toBe("hidden");
  });

  it("exports owned sites and loose files as one zip with a manifest", async () => {
    const ada = await mint("owned-export-ada", "export-ada@esperlabs.app");
    const bob = await mint("owned-export-bob", "export-bob@esperlabs.app");
    const empty = await mint("owned-export-empty", "export-empty@esperlabs.app");

    const siteAlpha = await createSite(ada, "owned-alpha", { password: "ada-share-secret" });
    await json(`/v1/sites/${siteAlpha.id}/files/index.html`, {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/html" }),
      body: "<h1>alpha</h1>",
    });
    await json(`/v1/sites/${siteAlpha.id}/files/css/app.css`, {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/css" }),
      body: "body{color:navy}",
    });
    const siteBeta = await createSite(ada, "owned-beta");
    await json(`/v1/sites/${siteBeta.id}/files/notes.md`, {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/markdown" }),
      body: "# beta",
    });

    const one = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "owned-one.md", "content-type": "text/markdown" }),
      body: "one",
    });
    const two = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "owned-two.md", "content-type": "text/markdown" }),
      body: "two",
    });
    const three = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "owned-three.md", "content-type": "text/markdown" }),
      body: "three",
    });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(three.status).toBe(201);

    const bobSite = await createSite(bob, "owned-bob-site");
    await json(`/v1/sites/${bobSite.id}/files/index.html`, {
      method: "PUT",
      headers: auth(bob, { "content-type": "text/html" }),
      body: "<h1>bob</h1>",
    });
    await json(`/v1/sites/${bobSite.id}/files/guest.md`, {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/markdown" }),
      body: "ada edited this",
    });
    const bobFile = await json("/v1/files", {
      method: "POST",
      headers: auth(bob, { "X-Filename": "owned-bob.md", "content-type": "text/plain" }),
      body: "bob-only",
    });
    expect(bobFile.status).toBe(201);

    const noAuth = await json("/v1/export");
    expect(noAuth.status).toBe(401);

    const vacant = await json("/v1/export", { headers: auth(empty) });
    expect(vacant.status).toBe(400);
    expect(vacant.body.error).toBe("empty_export");
    expect(vacant.body.message).toContain("own");

    const exported = await req("/v1/export", { headers: auth(ada) });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toMatch(/zip/);
    expect(exported.headers.get("content-disposition")).toContain("export-ada-owned.zip");
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/i);
    const unpacked = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const names = Object.keys(unpacked).sort();
    expect(names).toContain("manifest.json");
    expect(names).toContain(`sites/${siteAlpha.id}/index.html`);
    expect(names).toContain(`sites/${siteAlpha.id}/css/app.css`);
    expect(names).toContain(`sites/${siteBeta.id}/notes.md`);
    expect(names).toContain(`files/${one.body.id}/owned-one.md`);
    expect(names).toContain(`files/${two.body.id}/owned-two.md`);
    expect(names).toContain(`files/${three.body.id}/owned-three.md`);
    expect(names.some((name) => name.includes(bobSite.id))).toBe(false);
    expect(names.some((name) => name.includes(String(bobFile.body.id)))).toBe(false);
    expect(new TextDecoder().decode(unpacked[`sites/${siteAlpha.id}/index.html`])).toContain("alpha");
    expect(new TextDecoder().decode(unpacked[`files/${one.body.id}/owned-one.md`])).toBe("one");

    const manifest = JSON.parse(new TextDecoder().decode(unpacked["manifest.json"]));
    expect(manifest.scope).toBe("owned");
    expect(manifest.owner).toEqual({ email: "export-ada@esperlabs.app", handle: "export-ada" });
    expect(manifest.sites.map((site: { id: string }) => site.id).sort()).toEqual([siteAlpha.id, siteBeta.id].sort());
    expect(manifest.files.map((file: { filename: string }) => file.filename).sort()).toEqual([
      "owned-one.md",
      "owned-three.md",
      "owned-two.md",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("ada-share-secret");
    expect(manifest).not.toHaveProperty("password");
    const alpha = manifest.sites.find((site: { id: string }) => site.id === siteAlpha.id);
    expect(alpha.slug).toBe("owned-alpha");
    expect(alpha.url).toContain(`/export-ada/s/${siteAlpha.id}/owned-alpha/`);
    expect(alpha.size).toBeGreaterThan(0);
    expect(alpha.file_count).toBe(2);
    expect(alpha.write_policy).toBe("org");
    expect(alpha.archive_path).toBe(`sites/${siteAlpha.id}/`);
    expect(alpha.expires_at === null || typeof alpha.expires_at === "string").toBe(true);

    const hubZip = await req("/account/export", { headers: access("export-ada@esperlabs.app") });
    expect(hubZip.status).toBe(200);
    expect(hubZip.headers.get("content-disposition")).toContain("export-ada-owned.zip");
    const hubNames = Object.keys(unzipSync(new Uint8Array(await hubZip.arrayBuffer()))).sort();
    expect(hubNames).toEqual(names);
  });

  it("refuses an owned-content zip over the file-count cap", async () => {
    const token = await mint("owned-export-cap", "export-cap@esperlabs.app");
    const site = await createSite(token, "owned-cap");
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_IMPORT_FILES; i += 1) {
      entries[`f${i}.txt`] = strToU8("x");
    }
    const imported = await json(`/v1/sites/${site.id}/import`, {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipSync(entries),
    });
    expect(imported.status).toBe(200);
    const extra = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "owned-cap-extra.md", "content-type": "text/plain" }),
      body: "x",
    });
    expect(extra.status).toBe(201);

    const exported = await json("/v1/export", { headers: auth(token) });
    expect(exported.status).toBe(400);
    expect(exported.body.error).toBe("too_many_files");
    expect(exported.body.limit_files).toBe(MAX_IMPORT_FILES);
    expect(exported.body.actual_files).toBe(MAX_IMPORT_FILES + 1);
    expect(exported.body.sites).toBe(1);
    expect(exported.body.files).toBe(1);
    expect(exported.body.message).toContain("GET /v1/sites/{id}/export");
  }, 30_000);

  it("create accepts ttl and expired public URLs are 410", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-clock");
    const created = await createSite(token, "ephemeral", { overwrite: false, ttl: "7d" });
    expect(created.status).toBe(201);
    expect(created.body.ttl).toBe("7d");
    expect(created.body.expires_at).toMatch(/T/);

    await json(`/v1/sites/${created.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>soon gone</h1>",
    });

    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "ephemeral")
      .run();

    const gone = await req(`/ada/s/${created.body.id}/ephemeral/`);
    expect(gone.status).toBe(410);
    expect(await gone.text()).toMatch(/expired/i);
  });

  it("API GET of an expired site is 410 and schedules purge", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-api-purge");
    const created = await createSite(token, "api-gone", { overwrite: false, ttl: "7d" });
    expect(created.status).toBe(201);
    await json(`/v1/sites/${created.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>soon gone</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "api-gone")
      .run();

    const apiGone = await json(`/v1/sites/${created.body.id}/files/index.html`, { headers: auth(token) });
    expect(apiGone.status).toBe(410);
    expect(apiGone.body.error).toBe("expired");

    const row = await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("api-gone").first();
    expect(row).toBeNull();
  });

  it("expired site can be deleted, revived with PATCH ttl, or recreated", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-owner");

    const site_delete_dead = await createSite(token, "delete-dead", { overwrite: false, ttl: "1d" });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "delete-dead")
      .run();
    const deleted = await json(`/v1/sites/${site_delete_dead.id}`, { method: "DELETE", headers: auth(token) });
    expect(deleted.status).toBe(200);
    const missing = await json(`/v1/sites/${site_delete_dead.id}`, { headers: auth(token) });
    expect(missing.status).toBe(404);

    const site_revive_me = await createSite(token, "revive-me", { overwrite: false, ttl: "1d" });
    await json(`/v1/sites/${site_revive_me.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>back</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "revive-me")
      .run();
    const revived = await json(`/v1/sites/${site_revive_me.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(revived.status).toBe(200);
    expect(revived.body.ttl).toBe("7d");
    const live = await req(`/v1/sites/${site_revive_me.id}/files/index.html`, { headers: auth(token) });
    expect(live.status).toBe(200);
    expect(await live.text()).toBe("<h1>back</h1>");

    const site_reclaim = await createSite(token, "reclaim", { overwrite: false, ttl: "1d" });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", site_reclaim.id)
      .run();
    const recreated = await createSite(token, "reclaim", { overwrite: false });
    expect(recreated.status).toBe(201);
    expect(recreated.body.created).toBe(true);
    expect(recreated.body.id).not.toBe(site_reclaim.id);
  });

  it("purge does not delete a site or file after TTL is reset", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredSite, purgeExpiredFile } = await import("../src/expire");
    const token = await mint("ttl-cas");

    const site_still_here = await createSite(token, "still-here", { overwrite: false, ttl: "1d" });
    await json(`/v1/sites/${site_still_here.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>keep</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "still-here")
      .run();
    await json(`/v1/sites/${site_still_here.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(await purgeExpiredSite(env, undefined, "ada", site_still_here.id)).toBe(false);
    const siteLive = await req(`/v1/sites/${site_still_here.id}/files/index.html`, { headers: auth(token) });
    expect(siteLive.status).toBe(200);
    expect(await siteLive.text()).toBe("<h1>keep</h1>");

    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "keep.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "keep",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", fileId)
      .run();
    await json(`/v1/files/${fileId}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(await purgeExpiredFile(env, undefined, fileId, "ada", "keep.txt")).toBe(false);
    const fileLive = await req(`/v1/files/${fileId}`, { headers: auth(token) });
    expect(fileLive.status).toBe(200);
    expect(await fileLive.text()).toBe("keep");
  });

  it("keeps catalog rows when expiry R2 delete fails so cron can retry", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredFile, purgeExpiredSite } = await import("../src/expire");
    const token = await mint("ttl-r2-retry");
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "retry.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "retry-me",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", fileId)
      .run();

    const site_retry_site = await createSite(token, "retry-site", { overwrite: false, ttl: "1d" });
    await json(`/v1/sites/${site_retry_site.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>retry</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "retry-site")
      .run();

    const bucket = env.BUCKET as R2Bucket & { delete: R2Bucket["delete"] };
    const originalDelete = bucket.delete.bind(bucket);
    bucket.delete = async () => {
      throw new Error("r2 unavailable");
    };
    try {
      await expect(purgeExpiredFile(env, undefined, fileId, "ada", "retry.txt")).rejects.toThrow("r2 unavailable");
      await expect(purgeExpiredSite(env, undefined, "ada", site_retry_site.id)).rejects.toThrow("r2 unavailable");
    } finally {
      bucket.delete = originalDelete;
    }

    const fileRow = await env.DB.prepare(`SELECT id, expires_at FROM loose_files WHERE id = ?`).bind(fileId).first<{
      id: string;
      expires_at: string;
    }>();
    expect(fileRow?.id).toBe(fileId);
    expect(fileRow?.expires_at).toBe("2000-01-01T00:00:00.000Z");
    const siteRow = await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("retry-site").first();
    expect(siteRow).toEqual({ slug: "retry-site" });
    const siteFile = await env.DB.prepare(`SELECT path FROM site_files WHERE site_id = ?`).bind(site_retry_site.id).first();
    expect(siteFile).toEqual({ path: "index.html" });

    expect(await purgeExpiredFile(env, undefined, fileId, "ada", "retry.txt")).toBe(true);
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toBeNull();
    expect(await purgeExpiredSite(env, undefined, "ada", site_retry_site.id)).toBe(true);
    expect(await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("retry-site").first()).toBeNull();
    expect(await env.DB.prepare(`SELECT path FROM site_files WHERE site_id = ?`).bind(site_retry_site.id).first()).toBeNull();
  });

  it("API GET of an expired loose file is 410 and schedules purge", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-file-purge");
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "bye.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "bye",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", fileId)
      .run();
    const gone = await json(`/v1/files/${fileId}`, { headers: auth(token) });
    expect(gone.status).toBe(410);
    expect(gone.body.error).toBe("expired");
    const row = await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first();
    expect(row).toBeNull();
  });

  it("API GET of an expired file is 410 even if R2 purge throws", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-file-410");
    const uploaded = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "stuck.txt", "content-type": "text/plain", "X-TTL": "1d" }),
      body: "stuck",
    });
    const fileId = uploaded.body.id as string;
    await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
      .bind("2000-01-01T00:00:00.000Z", fileId)
      .run();
    const bucket = env.BUCKET as R2Bucket & { delete: R2Bucket["delete"] };
    const originalDelete = bucket.delete.bind(bucket);
    bucket.delete = async () => {
      throw new Error("r2 unavailable");
    };
    try {
      const gone = await json(`/v1/files/${fileId}`, { headers: auth(token) });
      expect(gone.status).toBe(410);
      expect(gone.body.error).toBe("expired");
    } finally {
      bucket.delete = originalDelete;
    }
  });

  it("rejects minting from an email domain this Energon does not allow", async () => {
    const { env } = await import("cloudflare:test");
    const { status, body } = await json("/account/tokens", {
      method: "POST",
      headers: access("ada@gmail.com", { "content-type": "application/json" }),
      body: JSON.stringify({ label: "stranger" }),
    });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden_domain");

    const hub = await json("/", { headers: { "Cf-Access-Authenticated-User-Email": "ada@gmail.com" } });
    expect(hub.status).toBe(403);
    const data = await json("/account/data", { headers: { "Cf-Access-Authenticated-User-Email": "ada@gmail.com" } });
    expect(data.status).toBe(403);
    expect(await env.DB.prepare(`SELECT email FROM users WHERE email = ?`).bind("ada@gmail.com").first()).toBeNull();
  });

  it("PATCH ttl resets expiry from now", async () => {
    const token = await mint("ttl-patch");
    const created = await createSite(token, "extend-me", { overwrite: false, ttl: "1d" });
    expect(created.status).toBe(201);
    const patched = await json(`/v1/sites/${created.body.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "30d" }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.ttl).toBe("30d");
    const exp = Date.parse(patched.body.expires_at);
    expect(exp - Date.now()).toBeGreaterThan(20 * 86400 * 1000);
  });

  describe("cleanup", () => {
    type Named = { filename?: string; slug?: string };
    const names = (items: Named[]): string[] => items.map((item) => item.filename ?? item.slug ?? "");
    const post = (token: string, body: unknown) =>
      json("/v1/cleanup", { method: "POST", headers: auth(token, { "content-type": "application/json" }), body: JSON.stringify(body) });
    const upload = async (token: string, name: string, bytes: string, extra?: Record<string, string>) => {
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": name, "content-type": "text/plain", ...extra }),
        body: bytes,
      });
      expect(created.status).toBe(201);
      return created.body.id as string;
    };
    const site = async (token: string, slug: string, files: Record<string, string>, extra?: Record<string, unknown>) => {
      const created = await json("/v1/sites", {
        method: "POST",
        headers: auth(token, { "content-type": "application/json" }),
        body: JSON.stringify({ slug, ...extra }),
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      for (const [path, body] of Object.entries(files)) {
        const put = await json(`/v1/sites/${id}/files/${path}`, { method: "PUT", headers: auth(token), body });
        expect(put.status).toBe(201);
      }
      return { id, handle: created.body.handle as string, slug };
    };

    it("lists filter by expiry, size, and age, and the hub tolerates malformed filters", async () => {
      const email = "clean-list@esperlabs.app";
      const token = await mint("clean-list", email);
      await upload(token, "tiny.txt", "a");
      await upload(token, "mid.txt", "m".repeat(1500), { "X-Energon-TTL": "1d" });
      await upload(token, "huge.txt", "h".repeat(4000));

      const never = await json("/v1/files?expires=never", { headers: auth(token) });
      expect(never.status).toBe(200);
      expect(names(never.body.files).sort()).toEqual(["huge.txt", "tiny.txt"]);
      expect(never.body.total).toBe(2);

      const soon = await json(`/v1/files?expires_before=${encodeURIComponent(new Date(Date.now() + 2 * 86400 * 1000).toISOString())}`, {
        headers: auth(token),
      });
      expect(names(soon.body.files)).toEqual(["mid.txt"]);
      const notYet = await json(`/v1/files?expires_before=${encodeURIComponent(new Date(Date.now() + 3600 * 1000).toISOString())}`, {
        headers: auth(token),
      });
      expect(notYet.body.files).toEqual([]);
      expect(notYet.body.total).toBe(0);

      const big = await json("/v1/files?min_size=1kb", { headers: auth(token) });
      expect(names(big.body.files).sort()).toEqual(["huge.txt", "mid.txt"]);
      expect(big.body.total).toBe(2);

      const bySize = await json("/v1/files?sort=size", { headers: auth(token) });
      expect(names(bySize.body.files)).toEqual(["huge.txt", "mid.txt", "tiny.txt"]);
      const sizePage = await json("/v1/files?sort=size&limit=2", { headers: auth(token) });
      expect(names(sizePage.body.files)).toEqual(["huge.txt", "mid.txt"]);
      expect(sizePage.body.next_cursor).toBeTruthy();
      const sizeRest = await json(`/v1/files?sort=size&limit=2&cursor=${encodeURIComponent(sizePage.body.next_cursor)}`, {
        headers: auth(token),
      });
      expect(names(sizeRest.body.files)).toEqual(["tiny.txt"]);
      expect(sizeRest.body.next_cursor).toBeNull();

      const newest = await json("/v1/files", { headers: auth(token) });
      const oldest = await json("/v1/files?sort=age", { headers: auth(token) });
      expect(names(oldest.body.files)).toEqual(names(newest.body.files).reverse());

      const stale = await json(`/v1/files?updated_before=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, {
        headers: auth(token),
      });
      expect(stale.body.total).toBe(3);
      const ancient = await json("/v1/files?updated_before=2000-01-01", { headers: auth(token) });
      expect(ancient.body.total).toBe(0);
      expect(ancient.body.files).toEqual([]);

      await site(token, "cl-empty", {});
      await site(token, "cl-small", { "a.txt": "0123456789" });
      await site(token, "cl-big", { "a.txt": "x".repeat(3000), "b.txt": "y".repeat(100) });
      const bigSites = await json("/v1/sites?min_size=1kb", { headers: auth(token) });
      expect(names(bigSites.body.sites)).toEqual(["cl-big"]);
      expect(bigSites.body.total).toBe(1);
      const sitesBySize = await json("/v1/sites?sort=size", { headers: auth(token) });
      expect(names(sitesBySize.body.sites)).toEqual(["cl-big", "cl-small", "cl-empty"]);
      expect(sitesBySize.body.sites[0].size).toBe(3100);
      const sitePage = await json("/v1/sites?sort=size&limit=1", { headers: auth(token) });
      expect(names(sitePage.body.sites)).toEqual(["cl-big"]);
      expect(sitePage.body.total).toBe(3);
      const siteRest = await json(`/v1/sites?sort=size&limit=1&cursor=${encodeURIComponent(sitePage.body.next_cursor)}`, {
        headers: auth(token),
      });
      expect(names(siteRest.body.sites)).toEqual(["cl-small"]);
      const bigOnly = await json("/v1/sites?min_size=1kb&sort=size&limit=1", { headers: auth(token) });
      expect(bigOnly.body.total).toBe(1);
      expect(bigOnly.body.next_cursor).toBeNull();

      const emptyA = await site(token, "cl-dup", {});
      const emptyB = await site(token, "cl-dup", {});
      const emptyFirst = await json("/v1/sites?q=cl-dup&sort=size&limit=1", { headers: auth(token) });
      expect(emptyFirst.body.total).toBe(2);
      expect(emptyFirst.body.sites).toHaveLength(1);
      expect(emptyFirst.body.next_cursor).toBeTruthy();
      const emptyRest = await json(
        `/v1/sites?q=cl-dup&sort=size&limit=1&cursor=${encodeURIComponent(emptyFirst.body.next_cursor)}`,
        { headers: auth(token) },
      );
      expect(emptyRest.body.sites).toHaveLength(1);
      expect(emptyRest.body.next_cursor).toBeNull();
      expect([emptyFirst.body.sites[0].id, emptyRest.body.sites[0].id].sort()).toEqual([emptyA.id, emptyB.id].sort());
      expect(Object.keys(bigSites.body.sites[0])).not.toContain("owner_id");
      expect(Object.keys(never.body.files[0])).not.toContain("owner_id");

      const hub = await req("/?min_size=lots&expires=soon&expires_before=never&updated_before=x&sort=size", {
        headers: { "Cf-Access-Authenticated-User-Email": email },
      });
      expect(hub.status).toBe(200);
      const data = await json("/account/data?min_size=1kb&sort=size", { headers: { "Cf-Access-Authenticated-User-Email": email } });
      expect(data.status).toBe(200);
      expect(names(data.body.files)).toEqual(["huge.txt", "mid.txt"]);
      expect(names(data.body.sites)).toEqual(["cl-big"]);
    });

    it("lists and cleanup stay involvement-scoped", async () => {
      const owner = await mint("clean-scope-a", "clean-scope-a@esperlabs.app");
      const other = await mint("clean-scope-b", "clean-scope-b@esperlabs.app");
      await upload(owner, "mine.txt", "mine");
      await site(owner, "scope-mine", { "a.txt": "a" });
      const theirs = await json("/v1/files?expires=never&created_by=clean-scope-a@esperlabs.app", { headers: auth(other) });
      expect(theirs.body.files).toEqual([]);
      expect(theirs.body.total).toBe(0);
      const preview = await post(other, { target: {}, action: "delete" });
      expect(preview.status).toBe(200);
      expect(preview.body.matched).toBe(0);
      expect(preview.body.eligible).toBe(0);
      const narrowed = await post(other, { target: { created_by: "clean-scope-a@esperlabs.app" }, action: "delete" });
      expect(narrowed.body.matched).toBe(0);
      const mine = await post(owner, { target: {}, action: "delete" });
      expect(mine.body.matched).toBe(2);
      expect(mine.body.eligible).toBe(2);
    });

    it("previews a delete without confirm and executes with it", async () => {
      const token = await mint("clean-exec", "clean-exec@esperlabs.app");
      const created = await site(token, "prev-site", { "index.html": "<h1>bye</h1>" });
      const id = await upload(token, "prev.txt", "12345");

      const preview = await post(token, { target: { sites: [created.id], files: [id, "nope00"] }, action: "delete" });
      expect(preview.status).toBe(200);
      expect(preview.body.executed).toBe(false);
      expect(preview.body.action).toBe("delete");
      expect(preview.body.matched).toBe(3);
      expect(preview.body.eligible).toBe(2);
      expect(preview.body.bytes).toBe("<h1>bye</h1>".length + 5);
      expect(preview.body.confirm).toMatch(/^[0-9a-f]{32}$/);
      expect(preview.body.ttl).toBeUndefined();
      expect(preview.body.skipped).toEqual({ total: 1, by_reason: { not_found: 1 }, sample: [{ kind: "file", ref: "nope00", reason: "not_found" }] });
      expect(preview.body.sample).toEqual([
        expect.objectContaining({ kind: "site", ref: created.id, name: "prev-site", bytes: 12, expires_at: null }),
        expect.objectContaining({ kind: "file", ref: id, name: "prev.txt", bytes: 5 }),
      ]);
      expect((await json(`/v1/sites/${created.id}`, { headers: auth(token) })).status).toBe(200);
      expect((await req(`/v1/files/${id}`, { headers: auth(token) })).status).toBe(200);

      const missing = await post(token, { target: { sites: ["nosuch", "Bad Slug!"] }, action: "delete" });
      expect(missing.body.eligible).toBe(0);
      expect(missing.body.skipped.by_reason).toEqual({ not_found: 2 });
      expect(missing.body.skipped.sample.map((s: { ref: string }) => s.ref)).toEqual(["nosuch", "Bad Slug!"]);

      const executed = await post(token, { target: { sites: [created.id], files: [id, "nope00"] }, action: "delete", confirm: preview.body.confirm });
      expect(executed.status).toBe(200);
      expect(executed.body.executed).toBe(true);
      expect(executed.body.applied.total).toBe(2);
      expect(executed.body.applied.bytes).toBe(17);
      expect(executed.body.applied.objects.map((o: { ref: string }) => o.ref)).toEqual([created.id, id]);
      expect(executed.body.failed).toEqual({ total: 0, objects: [] });
      expect(executed.body.skipped.by_reason).toEqual({ not_found: 1 });
      expect((await json(`/v1/sites/${created.id}`, { headers: auth(token) })).status).toBe(404);
      expect((await req(`/v1/files/${id}`, { headers: auth(token) })).status).toBe(404);
      expect((await req(`/${created.handle}/s/${created.id}/prev-site/index.html`)).status).toBe(404);

      const replay = await post(token, { target: { sites: [created.id], files: [id, "nope00"] }, action: "delete", confirm: preview.body.confirm });
      expect(replay.status).toBe(409);
      expect(replay.body.error).toBe("cleanup_drift");
      expect(replay.body.eligible).toBe(0);
      expect(replay.body.skipped.by_reason).toEqual({ not_found: 3 });
      expect(replay.body.confirm).toMatch(/^[0-9a-f]{32}$/);
      expect(replay.body.confirm).not.toBe(preview.body.confirm);
    });

    it("rejects a mismatched confirm with a fresh preview and deletes nothing", async () => {
      const token = await mint("clean-drift", "clean-drift@esperlabs.app");
      const id = await upload(token, "keep.txt", "keep");
      const drift = await post(token, { target: { files: [id] }, action: "delete", confirm: "0".repeat(32) });
      expect(drift.status).toBe(409);
      expect(drift.body.error).toBe("cleanup_drift");
      expect(drift.body.executed).toBe(false);
      expect(drift.body.eligible).toBe(1);
      expect(drift.body.confirm).toMatch(/^[0-9a-f]{32}$/);
      expect((await req(`/v1/files/${id}`, { headers: auth(token) })).status).toBe(200);

      const otherAction = await post(token, { target: { files: [id] }, action: "expire", confirm: drift.body.confirm });
      expect(otherAction.status).toBe(409);
      expect(otherAction.body.error).toBe("cleanup_drift");

      const junk = await post(token, { target: { files: [id] }, action: "delete", confirm: "yes" });
      expect(junk.status).toBe(400);
      expect(junk.body.error).toBe("bad_confirm");
      expect((await req(`/v1/files/${id}`, { headers: auth(token) })).status).toBe(200);
    });

    it("skips owner-only objects the caller cannot write instead of failing the batch", async () => {
      const ada = await mint("clean-own-a", "clean-own-a@esperlabs.app");
      const bob = await mint("clean-own-b", "clean-own-b@esperlabs.app");
      const created = await site(ada, "shared-then-locked", { "a.txt": "ada" }, { write_policy: "owner" });
      // Bob as last writer of an owner-only site: involved, so it lists for him, but never writable.
      await env.DB.prepare(`UPDATE sites SET last_written_by = ? WHERE id = ?`)
        .bind("clean-own-b@esperlabs.app", created.id)
        .run();
      const bobList = await json("/v1/sites", { headers: auth(bob) });
      expect(names(bobList.body.sites)).toEqual(["shared-then-locked"]);

      const bobPreview = await post(bob, { target: {}, action: "delete" });
      expect(bobPreview.status).toBe(200);
      expect(bobPreview.body.matched).toBe(1);
      expect(bobPreview.body.eligible).toBe(0);
      expect(bobPreview.body.bytes).toBe(0);
      expect(bobPreview.body.skipped).toEqual({
        total: 1,
        by_reason: { not_writable: 1 },
        sample: [{ kind: "site", ref: created.id, reason: "not_writable" }],
      });
      const bobExecute = await post(bob, { target: {}, action: "delete", confirm: bobPreview.body.confirm });
      expect(bobExecute.status).toBe(200);
      expect(bobExecute.body.applied.total).toBe(0);
      expect(bobExecute.body.skipped.by_reason).toEqual({ not_writable: 1 });
      expect((await json(`/v1/sites/${created.id}`, { headers: auth(ada) })).status).toBe(200);

      const adaPreview = await post(ada, { target: { kind: "sites", q: "locked" }, action: "delete" });
      expect(adaPreview.body.eligible).toBe(1);
      expect(adaPreview.body.bytes).toBe(3);
    });

    it("expire sets a 30m grace and leaves sooner expiries alone", async () => {
      const token = await mint("clean-expire", "clean-expire@esperlabs.app");
      const created = await site(token, "exp-site", { "a.txt": "a" });
      const forever = await upload(token, "forever.txt", "f");
      const soon = await upload(token, "soon.txt", "s", { "X-Energon-TTL": "5m" });

      expect((await post(token, { target: {}, action: "expire", ttl: "1h" })).body.error).toBe("bad_action");
      expect((await post(token, { target: {}, action: "set_ttl" })).body.error).toBe("ttl_required");
      expect((await post(token, { target: {}, action: "nuke" })).body.error).toBe("bad_action");
      const setTtl = await post(token, { target: { files: [forever] }, action: "set_ttl", ttl: "2d" });
      expect(setTtl.status).toBe(200);
      expect(setTtl.body.ttl).toBe("2d");

      const preview = await post(token, { target: {}, action: "expire" });
      expect(preview.status).toBe(200);
      expect(preview.body.ttl).toBe("30m");
      expect(preview.body.matched).toBe(3);
      expect(preview.body.eligible).toBe(2);
      expect(preview.body.skipped).toEqual({ total: 1, by_reason: { already_expiring: 1 }, sample: [{ kind: "file", ref: soon, reason: "already_expiring" }] });
      expect(preview.body.confirm).not.toBe(setTtl.body.confirm);

      const before = Date.now();
      const executed = await post(token, { target: {}, action: "expire", confirm: preview.body.confirm });
      expect(executed.status).toBe(200);
      expect(executed.body.ttl).toBe("30m");
      expect(executed.body.applied.total).toBe(2);
      for (const applied of executed.body.applied.objects) {
        const at = Date.parse(applied.expires_at);
        expect(at - before).toBeGreaterThan(29 * 60 * 1000);
        expect(at - before).toBeLessThan(31 * 60 * 1000);
      }
      const siteNow = await json(`/v1/sites/${created.id}`, { headers: auth(token) });
      expect(Date.parse(siteNow.body.expires_at) - before).toBeLessThan(31 * 60 * 1000);
      const soonRow = await env.DB.prepare(`SELECT expires_at FROM loose_files WHERE id = ?`).bind(soon).first<{ expires_at: string }>();
      expect(Date.parse(soonRow!.expires_at) - before).toBeLessThan(6 * 60 * 1000);

      const again = await post(token, { target: {}, action: "expire" });
      expect(again.body.eligible).toBe(0);
      expect(again.body.skipped.by_reason).toEqual({ already_expiring: 3 });
    });

    it("refuses more than 100 eligible objects or an unbounded scan with 413", async () => {
      const email = "clean-many@esperlabs.app";
      const token = await mint("clean-many", email);
      const ts = new Date().toISOString();
      const insert = (id: string, writePolicy: string, ownerId: string | null) =>
        env.DB.prepare(
          `INSERT INTO loose_files (id, handle, owner_id, filename, size, content_type, created_at, created_by, updated_at, last_written_by, write_policy)
           VALUES (?, 'clean-many', ?, ?, 10, 'text/plain', ?, ?, ?, ?, ?)`,
        ).bind(id, ownerId, `${id}.txt`, ts, email, ts, email, writePolicy);
      const ids = Array.from({ length: 101 }, (_, i) => `mny${String(i).padStart(3, "0")}`);
      for (let i = 0; i < ids.length; i += 100) {
        await env.DB.batch(ids.slice(i, i + 100).map((id) => insert(id, "org", null)));
      }

      const tooMany = await post(token, { target: { kind: "files" }, action: "delete" });
      expect(tooMany.status).toBe(413);
      expect(tooMany.body.error).toBe("cleanup_too_many");
      expect(tooMany.body).toMatchObject({ limit: 100, matched: 101, eligible: 101, bytes: 1010 });
      expect(tooMany.body.skipped.total).toBe(0);
      expect(tooMany.body.confirm).toBeUndefined();

      const explicit = await post(token, { target: { files: ids }, action: "delete" });
      expect(explicit.status).toBe(413);
      expect(explicit.body).toMatchObject({ error: "cleanup_too_many", limit: 100, matched: 101 });
      expect(explicit.body.eligible).toBeUndefined();

      const hundred = await post(token, { target: { files: ids.slice(0, 100) }, action: "delete" });
      expect(hundred.status).toBe(200);
      expect(hundred.body.eligible).toBe(100);
      expect(hundred.body.sample).toHaveLength(10);

      const lockedIds = Array.from({ length: 300 }, (_, i) => `lck${String(i).padStart(3, "0")}`);
      for (let i = 0; i < lockedIds.length; i += 100) {
        await env.DB.batch(lockedIds.slice(i, i + 100).map((id) => insert(id, "owner", "u-someone-else")));
      }
      const truncated = await post(token, { target: { kind: "files", q: "lck" }, action: "delete" });
      expect(truncated.status).toBe(200);
      expect(truncated.body.eligible).toBe(0);
      expect(truncated.body.skipped.by_reason).toEqual({ not_writable: 300 });
      const overflow = await post(token, { target: { kind: "files" }, action: "delete" });
      expect(overflow.status).toBe(413);
      expect(overflow.body.error).toBe("cleanup_too_many");
      expect(overflow.body.matched).toBe(300);
      expect(overflow.body.message).toContain("Narrow the target");
    });

    it("rejects malformed targets with bad_target or bad_query", async () => {
      const token = await mint("clean-bad", "clean-bad@esperlabs.app");
      const cases: [unknown, string][] = [
        [{ action: "delete" }, "bad_target"],
        [{ target: "everything", action: "delete" }, "bad_target"],
        [{ target: { files: ["abc123"], q: "x" }, action: "delete" }, "bad_target"],
        [{ target: { files: "abc123" }, action: "delete" }, "bad_target"],
        [{ target: { files: [""] }, action: "delete" }, "bad_target"],
        [{ target: { folders: ["x"] }, action: "delete" }, "bad_target"],
        [{ target: { kind: "folders" }, action: "delete" }, "bad_target"],
        [{ target: { min_size: "lots" }, action: "delete" }, "bad_query"],
        [{ target: { expires: "soon", updated_before: 12 }, action: "delete" }, "bad_query"],
        [{ target: { expires: "never", expires_before: "2026-01-01" }, action: "delete" }, "bad_query"],
        [{ target: {}, action: "delete", ttl: "1d" }, "bad_action"],
        [{ target: {}, action: "set_ttl", ttl: "forever-ish" }, "bad_ttl"],
        [{ target: {} }, "bad_action"],
      ];
      for (const [body, code] of cases) {
        const res = await post(token, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error, JSON.stringify(body)).toBe(code);
      }
      const badQuery = await post(token, { target: { expires: "soon", updated_before: 12 }, action: "delete" });
      expect(badQuery.body.fields.sort()).toEqual(["expires", "updated_before"]);
      const noAuth = await json("/v1/cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(noAuth.status).toBe(401);
      const wrongMethod = await json("/v1/cleanup", { headers: auth(token) });
      expect(wrongMethod.status).toBe(404);
    });
  });

  describe("last_read_at", () => {
    const email = "reader@esperlabs.app";

    async function lastRead(table: "sites" | "loose_files", id: string): Promise<string | null> {
      const row = await env.DB.prepare(`SELECT last_read_at FROM ${table} WHERE id = ?`).bind(id).first<{ last_read_at: string | null }>();
      return row?.last_read_at ?? null;
    }

    // waitUntil settles after the response; poll instead of sleeping a fixed time.
    async function settledLastRead(table: "sites" | "loose_files", id: string): Promise<string> {
      for (let i = 0; i < 50; i++) {
        const value = await lastRead(table, id);
        if (value) return value;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`${table} ${id} never recorded a read`);
    }

    it("is null until a public read, then holds inside the throttle window", async () => {
      const token = await mint("reader-site", email);
      const created = await createSite(token, "read-me");
      await req(`/v1/sites/${created.id}/files/index.html`, {
        method: "PUT",
        headers: auth(token, { "content-type": "text/html" }),
        body: "<h1>read me</h1>",
      });
      expect(await lastRead("sites", created.id)).toBeNull();
      const before = await json("/v1/sites?q=read-me", { headers: auth(token) });
      expect(before.body.sites.find((s: { id: string }) => s.id === created.id).last_read_at).toBeNull();

      const page = await req(`/${created.handle}/s/${created.id}/read-me/`);
      expect(page.status).toBe(200);
      const first = await settledLastRead("sites", created.id);
      expect(Date.parse(first)).toBeGreaterThan(Date.now() - 60_000);

      await req(`/${created.handle}/s/${created.id}/read-me/index.html`);
      await new Promise((r) => setTimeout(r, 50));
      expect(await lastRead("sites", created.id)).toBe(first);

      const listed = await json("/v1/sites?q=read-me", { headers: auth(token) });
      expect(listed.body.sites.find((s: { id: string }) => s.id === created.id).last_read_at).toBe(first);
      const detail = await json(`/v1/sites/${created.id}`, { headers: auth(token) });
      expect(detail.body.last_read_at).toBe(first);
      const hub = await json("/account/data?q=read-me", { headers: access(email) });
      expect(hub.body.sites.find((s: { id: string }) => s.id === created.id).last_read_at).toBe(first);
    });

    it("ignores 404s and the generated listing on a public site", async () => {
      const token = await mint("reader-miss", email);
      const created = await createSite(token, "missing-read");
      await req(`/v1/sites/${created.id}/files/about.html`, {
        method: "PUT",
        headers: auth(token, { "content-type": "text/html" }),
        body: "<h1>about</h1>",
      });

      const listing = await req(`/${created.handle}/s/${created.id}/missing-read/`);
      expect(listing.status).toBe(200);
      const missing = await req(`/${created.handle}/s/${created.id}/missing-read/nope.html`);
      expect(missing.status).toBe(404);
      const badPath = await req(`/${created.handle}/s/${created.id}/missing-read/..%2Fx`);
      expect(badPath.status).toBe(404);
      await new Promise((r) => setTimeout(r, 100));
      expect(await lastRead("sites", created.id)).toBeNull();

      const hit = await req(`/${created.handle}/s/${created.id}/missing-read/about.html`);
      expect(hit.status).toBe(200);
      await settledLastRead("sites", created.id);
    });

    it("rewrites once the stored stamp is older than the throttle window", async () => {
      const token = await mint("reader-stale", email);
      const created = await createSite(token, "stale-read");
      await req(`/v1/sites/${created.id}/files/index.html`, {
        method: "PUT",
        headers: auth(token, { "content-type": "text/html" }),
        body: "<h1>stale</h1>",
      });
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare(`UPDATE sites SET last_read_at = ? WHERE id = ?`).bind(old, created.id).run();

      const viaApi = await req(`/v1/sites/${created.id}/files/index.html`, { headers: auth(token) });
      expect(viaApi.status).toBe(200);
      for (let i = 0; i < 50 && (await lastRead("sites", created.id)) === old; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(Date.parse(await settledLastRead("sites", created.id))).toBeGreaterThan(Date.parse(old));
    });

    it("records loose file reads from the public URL and /v1", async () => {
      const token = await mint("reader-file", email);
      const posted = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "read.txt", "content-type": "text/plain" }),
        body: "read me",
      });
      expect(posted.status).toBe(201);
      const id = String(posted.body.id);
      expect(await lastRead("loose_files", id)).toBeNull();

      const viaApi = await req(`/v1/files/${id}`, { headers: auth(token) });
      expect(viaApi.status).toBe(200);
      const first = await settledLastRead("loose_files", id);

      const pub = await req(new URL(posted.body.url).pathname);
      expect(pub.status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      expect(await lastRead("loose_files", id)).toBe(first);

      const listed = await json("/v1/files?q=read.txt", { headers: auth(token) });
      expect(listed.body.files.find((f: { id: string }) => f.id === id).last_read_at).toBe(first);
      const hub = await json("/account/data?q=read.txt", { headers: access(email) });
      expect(hub.body.files.find((f: { id: string }) => f.id === id).last_read_at).toBe(first);
    });

    it("stamps an owned zip the same way a site zip does", async () => {
      const token = await mint("reader-owned-zip", email);
      const created = await createSite(token, "owned-read-zip");
      await json(`/v1/sites/${created.id}/files/index.html`, {
        method: "PUT",
        headers: auth(token, { "content-type": "text/html" }),
        body: "<h1>owned zip</h1>",
      });
      const posted = await json("/v1/files", {
        method: "POST",
        headers: auth(token, { "X-Filename": "owned-read.zip.md", "content-type": "text/plain" }),
        body: "owned",
      });
      expect(posted.status).toBe(201);
      const fileId = String(posted.body.id);
      expect(await lastRead("sites", created.id)).toBeNull();
      expect(await lastRead("loose_files", fileId)).toBeNull();

      const exported = await req("/v1/export", { headers: auth(token) });
      expect(exported.status).toBe(200);
      await settledLastRead("sites", created.id);
      await settledLastRead("loose_files", fileId);
    });
  });

  describe("admin health", () => {
    it("returns quota and pending-purge counts for an admin token only", async () => {
      const admin = await mintAdmin("health-ops");
      const listed = await json("/v1/admin/health", { headers: auth(admin) });
      expect(listed.status).toBe(200);
      expect(listed.body.quota.limit_bytes).toBe(20 * 1024 * 1024 * 1024);
      expect(listed.body.quota.used_bytes).toBeGreaterThanOrEqual(0);
      expect(listed.body.quota.catalog_bytes).toBeGreaterThanOrEqual(0);
      expect(listed.body.expired_awaiting_purge).toBeGreaterThanOrEqual(0);
      expect(listed.body.stale_purge_claims).toBeGreaterThanOrEqual(0);
      expect(listed.body.locked_gates).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(listed.body.locked_scopes)).toBe(true);
      const raw = JSON.stringify(listed.body);
      expect(raw).not.toContain(admin);
      expect(raw).not.toMatch(/password/i);

      const noAuth = await json("/v1/admin/health");
      expect(noAuth.status).toBe(401);

      const account = await mint("health-plain", "admin@esperlabs.app");
      const asAccount = await json("/v1/admin/health", { headers: auth(account) });
      expect(asAccount.status).toBe(403);
      expect(asAccount.body.error).toBe("forbidden_admin");
    });
  });

  describe("admin audit", () => {
    it("records nothing until an admin action, and never leaks secrets", async () => {
      const admin = await mintAdmin("audit-empty");
      const listed = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(listed.status).toBe(200);
      expect(listed.body.events).toEqual([]);
      const raw = JSON.stringify(listed.body);
      expect(raw).not.toContain("password");
      expect(raw).not.toContain(admin);

      const noAuth = await json("/v1/admin/audit");
      expect(noAuth.status).toBe(401);
    });
  });

  describe("admin repairs", () => {
    const post = (path: string, token: string, body?: unknown) =>
      json(path, {
        method: "POST",
        headers: auth(token, body === undefined ? undefined : { "content-type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it("recomputes platform_quota.used from catalog SUM(size)", async () => {
      const owner = await mint("repair-quota-owner");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(owner, { "X-Filename": "vhealth-quota.md", "content-type": "text/plain" }),
        body: "quota-bytes",
      });
      expect(created.status).toBe(201);
      const catalog = await env.DB.prepare(
        `SELECT
          (SELECT COALESCE(SUM(size), 0) FROM site_files) +
          (SELECT COALESCE(SUM(size), 0) FROM loose_files) AS total`,
      ).first<{ total: number }>();
      const catalogBytes = Number(catalog?.total ?? 0);
      await env.DB.prepare(`UPDATE platform_quota SET used = ? WHERE id = 1`).bind(9_001_000_000).run();

      const outsider = await mint("repair-quota-ada", "ada@esperlabs.app");
      const refused = await post("/v1/admin/quota/recompute", outsider);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("forbidden_admin");

      const admin = await mintAdmin("repair-quota-ops");
      const result = await post("/v1/admin/quota/recompute", admin);
      expect(result.status).toBe(200);
      expect(result.body.used_before).toBe(9_001_000_000);
      expect(result.body.used_after).toBe(catalogBytes);
      expect(JSON.stringify(result.body)).not.toContain(admin);
      expect(JSON.stringify(result.body)).not.toContain("quota-bytes");

      const ledger = await env.DB.prepare(`SELECT used FROM platform_quota WHERE id = 1`).first<{ used: number }>();
      expect(Number(ledger?.used)).toBe(catalogBytes);
      const health = await json("/v1/admin/health", { headers: auth(admin) });
      expect(health.body.quota.used_bytes).toBe(catalogBytes);
      expect(health.body.quota.catalog_bytes).toBe(catalogBytes);

      const audit = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(audit.body.events.some((e: { action: string; executed: boolean }) => e.action === "quota_recompute" && e.executed)).toBe(true);
    });

    it("sweeps expired rows once and reports how many remain", async () => {
      const owner = await mint("repair-sweep-owner");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(owner, { "X-Filename": "vhealth-sweep.md", "content-type": "text/plain" }),
        body: "sweep-me",
      });
      expect(created.status).toBe(201);
      const fileId = created.body.id as string;
      await env.DB.prepare(`UPDATE loose_files SET expires_at = ? WHERE id = ?`)
        .bind("2000-01-01T00:00:00.000Z", fileId)
        .run();
      const waiting = await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first();
      expect(waiting).not.toBeNull();

      const outsider = await mint("repair-sweep-ada", "ada@esperlabs.app");
      const refused = await post("/v1/admin/sweep", outsider);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("forbidden_admin");

      const admin = await mintAdmin("repair-sweep-ops");
      let remaining = Number.POSITIVE_INFINITY;
      let last: { status: number; body: { swept?: { sites: number; files: number }; expired_remaining?: number } } | undefined;
      for (let i = 0; i < 4 && remaining > 0; i++) {
        last = await post("/v1/admin/sweep", admin);
        expect(last.status).toBe(200);
        expect(last.body.swept).toMatchObject({ sites: expect.any(Number), files: expect.any(Number) });
        remaining = Number(last.body.expired_remaining);
        const gone = await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first();
        if (!gone) break;
      }
      expect(last?.body.swept).toBeDefined();
      expect(JSON.stringify(last?.body)).not.toContain("sweep-me");
      expect(JSON.stringify(last?.body)).not.toContain(admin);
      const gone = await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first();
      expect(gone).toBeNull();
      expect(remaining).toBeGreaterThanOrEqual(0);

      const audit = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(audit.body.events.some((e: { action: string; executed: boolean }) => e.action === "sweep" && e.executed)).toBe(true);
    });

    it("unlocks a locked share gate by scope", async () => {
      const scope = "obj:/ada/f/vhealth-lock/vhealth-gate.md";
      await env.DB.prepare(`INSERT OR REPLACE INTO gate_attempts (scope, fails, window_start) VALUES (?, ?, ?)`)
        .bind(scope, 20, new Date().toISOString())
        .run();

      const admin = await mintAdmin("repair-unlock-ops");
      const listed = await json("/v1/admin/health", { headers: auth(admin) });
      expect(listed.body.locked_scopes).toContain(scope);

      const noauthMalformed = await json("/v1/admin/gates/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(noauthMalformed.status).toBe(401);
      expect(noauthMalformed.body.error).toBe("unauthorized");

      const noauthEmpty = await json("/v1/admin/gates/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(noauthEmpty.status).toBe(401);
      expect(noauthEmpty.body.error).toBe("unauthorized");

      const empty = await post("/v1/admin/gates/unlock", admin, { scope: "  " });
      expect(empty.status).toBe(400);
      expect(empty.body.error).toBe("bad_target");

      const notObject = await json("/v1/admin/gates/unlock", {
        method: "POST",
        headers: auth(admin, { "content-type": "application/json" }),
        body: "[]",
      });
      expect(notObject.status).toBe(400);
      expect(notObject.body.error).toBe("bad_json");

      const outsider = await mint("repair-unlock-ada", "ada@esperlabs.app");
      const refused = await post("/v1/admin/gates/unlock", outsider, { scope });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("forbidden_admin");

      const unlocked = await post("/v1/admin/gates/unlock", admin, { scope });
      expect(unlocked.status).toBe(200);
      expect(unlocked.body).toEqual({ scope, unlocked: true });
      expect(JSON.stringify(unlocked.body)).not.toContain(admin);

      const row = await env.DB.prepare(`SELECT scope FROM gate_attempts WHERE scope = ?`).bind(scope).first();
      expect(row).toBeNull();
      const after = await json("/v1/admin/health", { headers: auth(admin) });
      expect(after.body.locked_scopes).not.toContain(scope);

      const again = await post("/v1/admin/gates/unlock", admin, { scope });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ scope, unlocked: false });

      const audit = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(audit.body.events.some((e: { action: string }) => e.action === "gate_unlock")).toBe(true);
      expect(JSON.stringify(audit.body)).not.toContain(admin);
    });
  });

  describe("admin cleanup", () => {
    const post = (token: string, body: unknown) =>
      json("/v1/admin/cleanup", { method: "POST", headers: auth(token, { "content-type": "application/json" }), body: JSON.stringify(body) });

    it("sets a 7d ttl on another account's work and records the action", async () => {
      const ownerToken = await mint("admin-clean-owner", "ada@esperlabs.app");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(ownerToken, { "X-Filename": "vadmin-old.md", "content-type": "text/plain", "X-Energon-Write-Policy": "owner" }),
        body: "keep-me",
      });
      expect(created.status).toBe(201);
      expect(created.body.expires_at).toBeNull();
      const fileId = created.body.id as string;
      const handle = created.body.handle as string;

      const outsider = await mint("admin-clean-ada", "ada@esperlabs.app");
      const refused = await post(outsider, { target: { owner: handle, q: "vadmin-old" }, action: "set_ttl" });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("forbidden_admin");

      const admin = await mintAdmin("admin-clean-ops");
      const scoped = await post(admin, { target: { scope: "involved" }, action: "delete" });
      expect(scoped.status).toBe(400);
      expect(scoped.body.error).toBe("bad_target");

      const expire = await post(admin, { target: { files: [fileId] }, action: "expire" });
      expect(expire.status).toBe(400);
      expect(expire.body.error).toBe("expire_not_own");

      const preview = await post(admin, { target: { owner: handle, q: "vadmin-old", expires: "never" }, action: "set_ttl" });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ executed: false, action: "set_ttl", ttl: "7d", eligible: 1 });
      expect(preview.body.sample[0]).toMatchObject({ kind: "file", ref: fileId, name: "vadmin-old.md", owner: handle, last_read_at: null });
      expect(JSON.stringify(preview.body)).not.toContain("keep-me");
      expect(JSON.stringify(preview.body)).not.toMatch(/password/i);

      const listedBefore = await json("/v1/files?q=vadmin-old", { headers: auth(ownerToken) });
      expect(listedBefore.body.files.find((f: { id: string }) => f.id === fileId).expires_at).toBeNull();

      const executed = await post(admin, {
        target: { owner: handle, q: "vadmin-old", expires: "never" },
        action: "set_ttl",
        confirm: preview.body.confirm,
      });
      expect(executed.status).toBe(200);
      expect(executed.body.executed).toBe(true);
      expect(executed.body.applied.total).toBe(1);
      expect(Date.parse(executed.body.applied.objects[0].expires_at) - Date.now()).toBeGreaterThan(6 * 86400 * 1000);

      const listed = await json("/v1/files?q=vadmin-old", { headers: auth(ownerToken) });
      const row = listed.body.files.find((f: { id: string }) => f.id === fileId);
      expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(6 * 86400 * 1000);
      expect(row.last_written_by).toBe("ada@esperlabs.app");
      expect(row.updated_at).toBe(listedBefore.body.files.find((f: { id: string }) => f.id === fileId).updated_at);

      const audit = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(audit.status).toBe(200);
      expect(audit.body.events.some((e: { executed: boolean; action: string }) => e.action === "cleanup" && e.executed)).toBe(true);
      expect(audit.body.events.some((e: { executed: boolean }) => !e.executed)).toBe(true);
      expect(JSON.stringify(audit.body)).not.toContain(admin);
    });

    it("deletes another account's owner-policy file", async () => {
      const ownerToken = await mint("admin-del-owner", "ada@esperlabs.app");
      const created = await json("/v1/files", {
        method: "POST",
        headers: auth(ownerToken, { "X-Filename": "vadmin-del.md", "content-type": "text/plain", "X-Energon-Write-Policy": "owner" }),
        body: "drop-me",
      });
      expect(created.status).toBe(201);
      const fileId = created.body.id as string;

      const admin = await mintAdmin("admin-del-ops");
      const preview = await post(admin, { target: { files: [fileId] }, action: "delete" });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ executed: false, action: "delete", eligible: 1 });

      const executed = await post(admin, { target: { files: [fileId] }, action: "delete", confirm: preview.body.confirm });
      expect(executed.status).toBe(200);
      expect(executed.body.executed).toBe(true);
      expect(executed.body.applied.total).toBe(1);
      expect(executed.body.skipped.total).toBe(0);

      const listed = await json("/v1/files?q=vadmin-del", { headers: auth(ownerToken) });
      expect(listed.body.files.find((f: { id: string }) => f.id === fileId)).toBeUndefined();
    });
  });

  describe("admin tokens", () => {
    it("lists another account's tokens as metadata only", async () => {
      const ownerToken = await mint("vadmin-tok-owner", "ada@esperlabs.app");
      const admin = await mintAdmin("vadmin-tok-ops");
      const listed = await json("/v1/admin/tokens?owner=ada", { headers: auth(admin) });
      expect(listed.status).toBe(200);
      const row = listed.body.tokens.find((t: { label: string }) => t.label === "vadmin-tok-owner");
      expect(row).toMatchObject({
        owner_email: "ada@esperlabs.app",
        owner_handle: "ada",
        label: "vadmin-tok-owner",
        scope: "account",
        status: "live",
      });
      expect(Object.keys(row).sort()).toEqual(
        [
          "created_at",
          "expired",
          "expires_at",
          "hint",
          "id",
          "label",
          "last_used_at",
          "owner_email",
          "owner_handle",
          "recoverable",
          "revoked",
          "scope",
          "status",
        ].sort(),
      );
      expect(JSON.stringify(listed.body)).not.toContain(ownerToken);
      expect(JSON.stringify(listed.body)).not.toContain("token_hash");
      expect(JSON.stringify(listed.body)).not.toContain("token_secret");

      const paged = await json("/v1/admin/tokens?owner=ada&limit=1", { headers: auth(admin) });
      expect(paged.body.tokens).toHaveLength(1);
      expect(typeof paged.body.next_cursor === "string" || paged.body.next_cursor === null).toBe(true);
    });

    it("revokes another account's tokens and records preview plus execute", async () => {
      const ownerEmail = "tok-api@esperlabs.app";
      const ownerToken = await mint("vadmin-tok-live", ownerEmail);
      const admin = await mintAdmin("vadmin-tok-revoke-ops");
      const preview = await json("/v1/admin/tokens/revoke", {
        method: "POST",
        headers: auth(admin, { "content-type": "application/json" }),
        body: JSON.stringify({ owner: "tok-api", target: "all" }),
      });
      expect(preview.status).toBe(200);
      expect(preview.body.executed).toBe(false);
      expect(preview.body.matched).toBeGreaterThanOrEqual(1);
      expect(preview.body.sample.some((t: { label: string }) => t.label === "vadmin-tok-live")).toBe(true);

      const executed = await json("/v1/admin/tokens/revoke", {
        method: "POST",
        headers: auth(admin, { "content-type": "application/json" }),
        body: JSON.stringify({ owner: "tok-api", target: "all", confirm: preview.body.confirm }),
      });
      expect(executed.status).toBe(200);
      expect(executed.body).toMatchObject({ ok: true, target: "all", executed: true });
      expect(executed.body.revoked).toBe(preview.body.matched);
      expect((await json("/v1/whoami", { headers: auth(ownerToken) })).status).toBe(401);

      const audit = await json("/v1/admin/audit", { headers: auth(admin) });
      expect(audit.body.events.some((e: { action: string; executed: boolean }) => e.action === "tokens" && !e.executed)).toBe(true);
      expect(audit.body.events.some((e: { action: string; executed: boolean }) => e.action === "tokens" && e.executed)).toBe(true);
      expect(JSON.stringify(audit.body)).not.toContain(admin);
      expect(JSON.stringify(audit.body)).not.toContain(ownerToken);
    });
  });
});
