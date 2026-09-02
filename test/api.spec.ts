import { unzipSync, zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { GATE_COOKIE, hashSharePassword, unlockToken } from "../src/gate";
import { auth, json, mint, req } from "./helpers";

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
    expect(text).toContain("company");
    expect(text).toContain("ENERGON_TOKEN");
    expect(text).toContain("/v1/help");
    expect(text).toContain("user (global) scope");
    expect(text).toContain("unless the human asked for that");
    expect(text).not.toMatch(/ee_live_[A-Za-z0-9]+/);
  });

  it("minted tokens are shown once and cannot be recovered", async () => {
    const email = "reveal@esperlabs.app";
    const token = await mint("keep-me", email);
    const listed = await json("/account/data", {
      headers: { "Cf-Access-Authenticated-User-Email": email },
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
    expect(body.retention.write_policy).toBe("instance");
  });

  it("curl without token to /v1/sites is 401 pointing at hub", async () => {
    const { status, body } = await json("/v1/sites");
    expect(status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(body.hub).toBe("https://hub.energon.example.com/account");
    expect(body.message).toContain("/tokens");
    expect(body.message).toContain("ENERGON_TOKEN");
  });

  it("create site, PUT index.html, serve it, 409 without overwrite", async () => {
    const token = await mint("laptop");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "demo", overwrite: false }),
    });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe("https://energon.example.com/ada/s/demo/");
    expect(created.body.handle).toBe("ada");
    expect(created.body.created).toBe(true);
    expect(created.body.password_protected).toBe(false);

    const put = await json("/v1/sites/demo/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>hello demo</h1>",
    });
    expect(put.status).toBe(201);
    expect(put.body.url).toBe("https://energon.example.com/ada/s/demo/index.html");
    expect(put.body.api_url).toBe("https://hub.energon.example.com/v1/sites/demo/files/index.html");

    const viaApi = await req("/v1/sites/demo/files/index.html", { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toContain("hello demo");

    const page = await req("/ada/s/demo/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello demo");
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(page.headers.get("cache-control")).toMatch(/public/);
    expect(page.headers.get("cache-control")).toMatch(/s-maxage=31536000/);

    const again = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "demo" }),
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("site_exists");
    expect(again.body.file_count).toBe(1);
    expect(again.body.last_written_by).toBe("ada@esperlabs.app");
    expect(again.body.hint).toContain("overwrite");
    expect(again.body.url).toContain("/ada/s/demo/");

    const listing = await json("/v1/sites/demo", { headers: auth(token) });
    expect(listing.status).toBe(200);
    expect(listing.body.files).toHaveLength(1);
  });

  it("overwrite claims slug without wiping files; second PUT keeps both", async () => {
    const token = await mint("ci");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "keep-both" }),
    });
    await json("/v1/sites/keep-both/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>one</h1>",
    });
    const claim = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "keep-both", overwrite: true }),
    });
    expect(claim.status).toBe(200);
    expect(claim.body.created).toBe(false);

    const put2 = await json("/v1/sites/keep-both/files/notes.md", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/markdown" }),
      body: "hello",
    });
    expect(put2.status).toBe(201);

    const listing = await json("/v1/sites/keep-both", { headers: auth(token) });
    const paths = listing.body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(["index.html", "notes.md"]);
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "notes-site" }),
    });
    await json("/v1/sites/notes-site/files/notes.md", {
      method: "PUT",
      headers: auth(token),
      body: "# notes",
    });
    const index = await req("/ada/s/notes-site/");
    expect(index.status).toBe(200);
    const html = await index.text();
    expect(html).toContain("No index.html or index.md");
    expect(html).toContain("notes.md");

    const file = await req("/ada/s/notes-site/notes.md");
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "wrapped" }),
    });
    const zipped = zipSync({
      "my-site/index.html": strToU8("<h1>root</h1>"),
      "my-site/css/app.css": strToU8("body{color:red}"),
    });
    const imported = await json("/v1/sites/wrapped/import", {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipped,
    });
    expect(imported.status).toBe(200);
    expect(imported.body.written.sort()).toEqual(["css/app.css", "index.html"]);
    const page = await req("/ada/s/wrapped/");
    expect(await page.text()).toContain("root");
  });

  it("26 MB file is 413 mentioning the 25 MB cap", async () => {
    const token = await mint("big");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "big-site" }),
    });
    const tooBig = await json("/v1/sites/big-site/files/huge.bin", {
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
      headers: { "Cf-Access-Authenticated-User-Email": email },
    });
    const id = listed.body.tokens.find((t: { label: string }) => t.label === "to-revoke").id;
    const revoked = await json(`/account/tokens/${id}/revoke`, {
      method: "POST",
      headers: { "Cf-Access-Authenticated-User-Email": email },
    });
    expect(revoked.status).toBe(200);
    const put = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "after-revoke" }),
    });
    expect(put.status).toBe(401);
    expect(put.body.message).toContain("/account");
  });

  it("two users' tokens can both write the same site", async () => {
    const ada = await mint("ada-key", "ada-two@esperlabs.app");
    const bob = await mint("bob-key", "bob@esperlabs.app");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "shared" }),
    });
    await json("/v1/sites/shared/files/a.txt", {
      method: "PUT",
      headers: auth(ada),
      body: "ada",
    });
    await json("/v1/sites/shared/files/b.txt", {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    const listing = await json("/v1/sites/shared", { headers: auth(ada) });
    const paths = listing.body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(["a.txt", "b.txt"]);
    expect(listing.body.last_written_by).toBe("bob@esperlabs.app");
    expect(listing.body.write_policy).toBe("instance");
  });

  it("owner write_policy 403s a second token on mutate and lets the creator flip it", async () => {
    const ada = await mint("ada-owner", "ada-owner@esperlabs.app");
    const bob = await mint("bob-owner", "bob-owner@esperlabs.app");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "private-draft", write_policy: "owner" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.write_policy).toBe("owner");
    const listing = await json("/v1/sites/private-draft", { headers: auth(ada) });
    expect(listing.status).toBe(200);
    expect(listing.body.write_policy).toBe("owner");
    const bobPut = await json("/v1/sites/private-draft/files/b.txt", {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    expect(bobPut.status).toBe(403);
    expect(bobPut.body.error).toBe("forbidden_write");
    const bobPatch = await json("/v1/sites/private-draft", {
      method: "PATCH",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "instance" }),
    });
    expect(bobPatch.status).toBe(403);
    expect(bobPatch.body.error).toBe("forbidden_write_policy");
    const adaPatch = await json("/v1/sites/private-draft", {
      method: "PATCH",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "instance" }),
    });
    expect(adaPatch.status).toBe(200);
    expect(adaPatch.body.write_policy).toBe("instance");
    const bobPutAfter = await json("/v1/sites/private-draft/files/b.txt", {
      method: "PUT",
      headers: auth(bob),
      body: "bob",
    });
    expect(bobPutAfter.status).toBe(201);
    const adaLock = await json("/v1/sites/private-draft", {
      method: "PATCH",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ write_policy: "owner" }),
    });
    expect(adaLock.status).toBe(200);
    const bobDelete = await json("/v1/sites/private-draft", {
      method: "DELETE",
      headers: auth(bob),
    });
    expect(bobDelete.status).toBe(403);
  });

  it("a new IdP subject with a reused email cannot write owner-only objects or keep old tokens", async () => {
    const email = "reused@esperlabs.app";
    const tokenA = await mint("keep-a", email, { "Cf-Access-Authenticated-User-Sub": "sub-a" });
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(tokenA, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "owned-draft", write_policy: "owner" }),
    });
    expect(created.status).toBe(201);
    const tokenB = await mint("keep-b", email, { "Cf-Access-Authenticated-User-Sub": "sub-b" });
    const whoA = await json("/v1/whoami", { headers: auth(tokenA) });
    expect(whoA.status).toBe(401);
    const stolen = await json("/v1/sites/owned-draft/files/b.txt", {
      method: "PUT",
      headers: auth(tokenB),
      body: "nope",
    });
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe("forbidden_write");
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "source-draft", write_policy: "owner", password: "secret-pw" }),
    });
    await json("/v1/sites/source-draft/files/index.html", {
      method: "PUT",
      headers: auth(ada, { "content-type": "text/html" }),
      body: "<h1>source</h1>",
    });
    const bobPut = await json("/v1/sites/source-draft/files/x.txt", {
      method: "PUT",
      headers: auth(bob),
      body: "nope",
    });
    expect(bobPut.status).toBe(403);
    const copied = await json("/v1/sites", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "source-draft-2", duplicate_from: "source-draft" }),
    });
    expect(copied.status).toBe(201);
    expect(copied.body.duplicated).toBe(true);
    expect(copied.body.duplicated_from).toBe("source-draft");
    expect(copied.body.file_count).toBe(1);
    expect(copied.body.password_protected).toBe(false);
    expect(copied.body.write_policy).toBe("instance");
    expect(copied.body.handle).not.toBe(copied.body.duplicated_from);
    const listing = await json("/v1/sites/source-draft-2", { headers: auth(bob) });
    expect(listing.status).toBe(200);
    expect(listing.body.created_by).toBe("bob-dup@esperlabs.app");
    expect(listing.body.write_policy).toBe("instance");
    expect(listing.body.password_protected).toBe(false);
    expect(listing.body.files.map((f: { path: string }) => f.path)).toEqual(["index.html"]);
    const bytes = await req("/v1/sites/source-draft-2/files/index.html", { headers: auth(bob) });
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("<h1>source</h1>");
    const bobEdit = await json("/v1/sites/source-draft-2/files/note.txt", {
      method: "PUT",
      headers: auth(bob),
      body: "mine",
    });
    expect(bobEdit.status).toBe(201);
    const clash = await json("/v1/sites", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "source-draft-2", duplicate_from: "source-draft" }),
    });
    expect(clash.status).toBe(409);
    const overwriteDup = await json("/v1/sites", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "other", duplicate_from: "source-draft", overwrite: true }),
    });
    expect(overwriteDup.status).toBe(400);
    expect(overwriteDup.body.error).toBe("bad_duplicate");
  });

  it("duplicate_from copies a loose file to a new id", async () => {
    const ada = await mint("ada-file-dup", "ada-file-dup@esperlabs.app");
    const bob = await mint("bob-file-dup", "bob-file-dup@esperlabs.app");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(ada, { "X-Filename": "notes.txt", "X-Energon-Write-Policy": "owner" }),
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
    expect(copied.body.write_policy).toBe("instance");
    expect(copied.body.created_by).toBe("bob-file-dup@esperlabs.app");
    const listed = await json("/v1/files", { headers: auth(bob) });
    const row = listed.body.files.find((f: { id: string }) => f.id === copied.body.id);
    expect(row.created_by).toBe("bob-file-dup@esperlabs.app");
    expect(row.write_policy).toBe("instance");
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(writer, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "handoff" }),
    });
    await json("/v1/sites/handoff/files/brief.md", {
      method: "PUT",
      headers: auth(writer, { "content-type": "text/markdown" }),
      body: "# brief\nfor the other session",
    });
    const got = await req("/v1/sites/handoff/files/brief.md", { headers: auth(reader) });
    expect(got.status).toBe(200);
    expect(await got.text()).toContain("other session");
  });

  it("whoami returns token label and owner email", async () => {
    const token = await mint("whoami-key", "who@esperlabs.app");
    const me = await json("/v1/whoami", { headers: auth(token) });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("who@esperlabs.app");
    expect(me.body.label).toBe("whoami-key");
  });

  it("rejects zip path traversal", async () => {
    const token = await mint("zip-trav");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "safe-zip" }),
    });
    const zipped = zipSync({ "../secret.txt": strToU8("nope") });
    const imported = await json("/v1/sites/safe-zip/import", {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipped,
    });
    expect(imported.status).toBe(400);
    expect(imported.body.error).toBe("bad_zip_path");
  });

  it("site slugs are not reserved; account is a fine site name", async () => {
    const token = await mint("reserved");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "account" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe("https://energon.example.com/ada/s/account/");
  });

  it("DELETE site removes files", async () => {
    const token = await mint("deleter");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "temp-site" }),
    });
    await json("/v1/sites/temp-site/files/bye.txt", {
      method: "PUT",
      headers: auth(token),
      body: "bye",
    });
    const del = await json("/v1/sites/temp-site", { method: "DELETE", headers: auth(token) });
    expect(del.status).toBe(200);
    const got = await req("/ada/s/temp-site/bye.txt");
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
      headers: {
        "content-type": "application/json",
        "Cf-Access-Authenticated-User-Email": "label@esperlabs.app",
      },
      body: JSON.stringify({ label: "   " }),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("bad_label");
  });

  it("optional share password gates the public URL, not /v1", async () => {
    const token = await mint("pw-site");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "gated", overwrite: false, password: "hunter2" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.password_protected).toBe(true);
    expect(created.body.password).toBe("hunter2");

    const listed = await json("/v1/sites/gated", { headers: auth(token) });
    expect(listed.status).toBe(200);
    expect(listed.body.password_protected).toBe(true);
    expect(listed.body).not.toHaveProperty("password");

    await json("/v1/sites/gated/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>secret page</h1>",
    });

    const viaApi = await req("/v1/sites/gated/files/index.html", { headers: auth(token) });
    expect(viaApi.status).toBe(200);
    expect(await viaApi.text()).toContain("secret page");

    const blocked = await req("/ada/s/gated/");
    expect(blocked.status).toBe(401);
    const html = await blocked.text();
    expect(html).toContain("password-protected");
    expect(html).toContain("X-Energon-Password");

    const asJson = await json("/ada/s/gated/", { headers: { accept: "application/json" } });
    expect(asJson.status).toBe(401);
    expect(asJson.body.error).toBe("password_required");

    const wrong = await json("/ada/s/gated/", { headers: { "X-Energon-Password": "nope" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("password_required");

    const unlocked = await req("/ada/s/gated/", { headers: { "X-Energon-Password": "hunter2" } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toContain("secret page");
    expect(unlocked.headers.get("cache-control")).toMatch(/no-store/);

    const cookieVal = await unlockToken(await hashSharePassword("hunter2"));
    const viaCookie = await req("/ada/s/gated/", {
      headers: { cookie: `${GATE_COOKIE}=${cookieVal}` },
    });
    expect(viaCookie.status).toBe(200);
    expect(await viaCookie.text()).toContain("secret page");
  }, 15_000);

  it("share password guesses are rate limited per object and source", async () => {
    const token = await mint("pw-limit", "limit@esperlabs.app");
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "gated-limit", password: "correct-horse" }),
    });
    await json("/v1/sites/gated-limit/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>limited</h1>",
    });
    const ip = { "CF-Connecting-IP": "203.0.113.88", accept: "application/json", "X-Energon-Password": "wrong" };
    for (let i = 0; i < 20; i++) {
      const wrong = await json("/limit/s/gated-limit/", { headers: ip });
      expect(wrong.status).toBe(401);
    }
    const blocked = await json("/limit/s/gated-limit/", { headers: ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
    const lockedCorrect = await json("/limit/s/gated-limit/", {
      headers: { "CF-Connecting-IP": "203.0.113.88", accept: "application/json", "X-Energon-Password": "correct-horse" },
    });
    expect(lockedCorrect.status).toBe(429);
    const other = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "gated-limit-b", password: "correct-horse" }),
    });
    expect(other.status).toBe(201);
    await json("/v1/sites/gated-limit-b/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>other</h1>",
    });
    const otherIp = await req("/limit/s/gated-limit-b/", {
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "patch-me" }),
    });
    const set = await json("/v1/sites/patch-me", {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ password: "later" }),
    });
    expect(set.status).toBe(200);
    expect(set.body.password_protected).toBe(true);
    expect(set.body.password).toBe("later");
    const listing = await json("/v1/sites/patch-me", { headers: auth(token) });
    expect(listing.status).toBe(200);
    expect(listing.body.password_protected).toBe(true);
    expect(listing.body).not.toHaveProperty("password");
    const cleared = await json("/v1/sites/patch-me", {
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(ada, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "ada-only" }),
    });
    await json("/v1/sites", {
      method: "POST",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "bob-then-ada" }),
    });
    await json("/v1/sites/bob-then-ada/files/note.md", { method: "PUT", headers: auth(ada), body: "hi" });

    const adaList = await json("/v1/sites", { headers: auth(ada) });
    const adaSlugs = (adaList.body.sites || []).map((s: { slug: string }) => s.slug).sort();
    expect(adaSlugs).toContain("ada-only");
    expect(adaSlugs).toContain("bob-then-ada");

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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "docs" }),
    });
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
    await json("/v1/sites/docs/files/notes.md", {
      method: "PUT",
      headers: auth(token),
      body: md,
    });
    await json("/v1/sites/docs/files/index.md", {
      method: "PUT",
      headers: auth(token),
      body: "# Docs home",
    });

    const raw = await req("/ada/s/docs/notes.md");
    expect(raw.headers.get("content-type")).toMatch(/markdown/);
    expect(await raw.text()).toBe(md);

    const forced = await req("/ada/s/docs/notes.md?raw=1", {
      headers: { accept: "text/html" },
    });
    expect(forced.headers.get("content-type")).toMatch(/markdown/);
    expect(await forced.text()).toBe(md);

    const page = await req("/ada/s/docs/notes.md", { headers: { accept: "text/html" } });
    expect(page.headers.get("content-type")).toMatch(/html/);
    const html = await page.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("cdn.jsdelivr.net/npm/mermaid");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).not.toContain("http://example.com/a.png");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("?raw=1");

    const home = await req("/ada/s/docs/", { headers: { accept: "text/html" } });
    expect(await home.text()).toContain("<h1>Docs home</h1>");

    await json("/v1/sites/docs/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>HTML wins</h1>",
    });
    const htmlHome = await req("/ada/s/docs/");
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "pack-me" }),
    });
    const empty = await json("/v1/sites/pack-me/export", { headers: auth(token) });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("empty_site");

    await json("/v1/sites/pack-me/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>packed</h1>",
    });
    await json("/v1/sites/pack-me/files/css/app.css", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/css" }),
      body: "body{color:navy}",
    });

    const noAuth = await json("/v1/sites/pack-me/export");
    expect(noAuth.status).toBe(401);

    const exported = await req("/v1/sites/pack-me/export", { headers: auth(token) });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toMatch(/zip/);
    expect(exported.headers.get("content-disposition")).toContain("pack-me.zip");
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/i);
    const unpacked = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(Object.keys(unpacked).sort()).toEqual(["css/app.css", "index.html"]);
    expect(new TextDecoder().decode(unpacked["index.html"])).toContain("packed");
    expect(new TextDecoder().decode(unpacked["css/app.css"])).toContain("navy");

    const hubZip = await req("/account/sites/pack-me/export", {
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
    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "gated-zip", password: "hunter2" }),
    });
    await json("/v1/sites/gated-zip/files/secret.txt", {
      method: "PUT",
      headers: auth(token),
      body: "hidden",
    });
    const exported = await req("/v1/sites/gated-zip/export", { headers: auth(token) });
    expect(exported.status).toBe(200);
    const unpacked = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(new TextDecoder().decode(unpacked["secret.txt"])).toBe("hidden");
  });

  it("create accepts ttl and expired public URLs are 410", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-clock");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "ephemeral", overwrite: false, ttl: "7d" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.ttl).toBe("7d");
    expect(created.body.expires_at).toMatch(/T/);

    await json("/v1/sites/ephemeral/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>soon gone</h1>",
    });

    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "ephemeral")
      .run();

    const gone = await req("/ada/s/ephemeral/");
    expect(gone.status).toBe(410);
    expect(await gone.text()).toMatch(/expired/i);
  });

  it("API GET of an expired site is 410 and schedules purge", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-api-purge");
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "api-gone", overwrite: false, ttl: "7d" }),
    });
    expect(created.status).toBe(201);
    await json("/v1/sites/api-gone/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>soon gone</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "api-gone")
      .run();

    const apiGone = await json("/v1/sites/api-gone/files/index.html", { headers: auth(token) });
    expect(apiGone.status).toBe(410);
    expect(apiGone.body.error).toBe("expired");

    const row = await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("api-gone").first();
    expect(row).toBeNull();
  });

  it("expired site can be deleted, revived with PATCH ttl, or recreated", async () => {
    const { env } = await import("cloudflare:test");
    const token = await mint("ttl-owner");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "delete-dead", overwrite: false, ttl: "1d" }),
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "delete-dead")
      .run();
    const deleted = await json("/v1/sites/delete-dead", { method: "DELETE", headers: auth(token) });
    expect(deleted.status).toBe(200);
    const missing = await json("/v1/sites/delete-dead", { headers: auth(token) });
    expect(missing.status).toBe(404);

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "revive-me", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/revive-me/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>back</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "revive-me")
      .run();
    const revived = await json("/v1/sites/revive-me", {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(revived.status).toBe(200);
    expect(revived.body.ttl).toBe("7d");
    const live = await req("/v1/sites/revive-me/files/index.html", { headers: auth(token) });
    expect(live.status).toBe(200);
    expect(await live.text()).toBe("<h1>back</h1>");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "reclaim", overwrite: false, ttl: "1d" }),
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "reclaim")
      .run();
    const recreated = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "reclaim", overwrite: false }),
    });
    expect(recreated.status).toBe(201);
    expect(recreated.body.created).toBe(true);
  });

  it("purge does not delete a site or file after TTL is reset", async () => {
    const { env } = await import("cloudflare:test");
    const { purgeExpiredSite, purgeExpiredFile } = await import("../src/expire");
    const token = await mint("ttl-cas");

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "still-here", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/still-here/files/index.html", {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>keep</h1>",
    });
    await env.DB.prepare(`UPDATE sites SET expires_at = ? WHERE slug = ?`)
      .bind("2000-01-01T00:00:00.000Z", "still-here")
      .run();
    await json("/v1/sites/still-here", {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "7d" }),
    });
    expect(await purgeExpiredSite(env, undefined, "ada", "still-here")).toBe(false);
    const siteLive = await req("/v1/sites/still-here/files/index.html", { headers: auth(token) });
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

    await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "retry-site", overwrite: false, ttl: "1d" }),
    });
    await json("/v1/sites/retry-site/files/index.html", {
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
      await expect(purgeExpiredSite(env, undefined, "ada", "retry-site")).rejects.toThrow("r2 unavailable");
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
    const siteFile = await env.DB.prepare(`SELECT path FROM site_files WHERE slug = ?`).bind("retry-site").first();
    expect(siteFile).toEqual({ path: "index.html" });

    expect(await purgeExpiredFile(env, undefined, fileId, "ada", "retry.txt")).toBe(true);
    expect(await env.DB.prepare(`SELECT id FROM loose_files WHERE id = ?`).bind(fileId).first()).toBeNull();
    expect(await purgeExpiredSite(env, undefined, "ada", "retry-site")).toBe(true);
    expect(await env.DB.prepare(`SELECT slug FROM sites WHERE slug = ?`).bind("retry-site").first()).toBeNull();
    expect(await env.DB.prepare(`SELECT path FROM site_files WHERE slug = ?`).bind("retry-site").first()).toBeNull();
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

  it("rejects minting from an email domain this instance does not allow", async () => {
    const { env } = await import("cloudflare:test");
    const { status, body } = await json("/account/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Cf-Access-Authenticated-User-Email": "ada@gmail.com",
      },
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
    const created = await json("/v1/sites", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ slug: "extend-me", overwrite: false, ttl: "1d" }),
    });
    expect(created.status).toBe(201);
    const patched = await json("/v1/sites/extend-me", {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ ttl: "30d" }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.ttl).toBe("30d");
    const exp = Date.parse(patched.body.expires_at);
    expect(exp - Date.now()).toBeGreaterThan(20 * 86400 * 1000);
  });
});
