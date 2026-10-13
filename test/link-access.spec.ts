import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PASSWORD_HEADER, WRITE_PASSWORD_HEADER } from "../src/config";
import { access, auth, createSite, json, mint, mintAdmin, req } from "./helpers";

const CONTENT = "https://energon.example.com";

async function createFile(token: string, filename: string, body: string, headers: Record<string, string> = {}) {
  return json("/v1/files", { method: "POST", headers: auth(token, { "x-filename": filename, "content-type": "text/plain", ...headers }), body });
}

/** Runs `competing` just before the first UPDATE whose SQL contains `marker`: a write that lands after the PATCH read its row. */
async function withCompetingWrite<T>(marker: string, competing: string, action: () => Promise<T>): Promise<T> {
  const db = env.DB;
  const originalPrepare = db.prepare.bind(db);
  let injected = false;
  db.prepare = ((sql: string) => {
    const statement = originalPrepare(sql);
    if (injected || !sql.startsWith(marker)) return statement;
    const originalBind = statement.bind.bind(statement);
    return Object.assign(statement, {
      bind: (...values: unknown[]) => {
        const bound = originalBind(...values);
        const originalRun = bound.run.bind(bound);
        return Object.assign(bound, {
          run: async () => {
            injected = true;
            await originalPrepare(competing).run();
            return originalRun();
          },
        });
      },
    });
  }) as typeof db.prepare;
  try {
    return await action();
  } finally {
    db.prepare = originalPrepare;
    expect(injected).toBe(true);
  }
}

function patch(path: string, token: string, body: Record<string, unknown>) {
  return json(path, { method: "PATCH", headers: auth(token, { "content-type": "application/json" }), body: JSON.stringify(body) });
}

describe("link access", () => {
  it("serves a private file only through /v1", async () => {
    const token = await mint("la-file", "la-file@esperlabs.app");
    const created = await createFile(token, "answer.md", "# answer", { "x-energon-link-access": "private" });
    expect(created.status).toBe(201);
    expect(created.body.link_access).toBe("private");
    const publicUrl = `${CONTENT}/la-file/f/${created.body.id}/answer.md`;

    const refused = await json(publicUrl);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("link_private");
    expect(JSON.stringify(refused.body)).not.toContain("/v1");

    const page = await req(publicUrl, { headers: { accept: "text/html" } });
    expect(page.status).toBe(403);
    expect(page.headers.get("content-type")).toContain("text/html");

    const guest = await json(publicUrl, { method: "PUT", headers: { [WRITE_PASSWORD_HEADER]: "anything" }, body: "x" });
    expect(guest.status).toBe(403);
    expect(guest.body.error).toBe("link_private");

    const second = await mint("la-file-second-key", "la-file@esperlabs.app");
    const read = await req(`/v1/files/${created.body.id}`, { headers: auth(second) });
    expect(read.status).toBe(200);
    expect(read.headers.get("x-energon-link-access")).toBe("private");
    expect(await read.text()).toBe("# answer");
    expect(created.body.write_policy).toBe("owner");

    const listed = await json("/v1/files?q=answer.md", { headers: auth(token) });
    expect(listed.body.files.find((f: { id: string }) => f.id === created.body.id).link_access).toBe("private");
    const hub = await json(`/account/files/${created.body.id}`, { headers: access("la-file@esperlabs.app") });
    expect(hub.body.link_access).toBe("private");
  });

  it("refuses a share password on a private file replacement", async () => {
    const token = await mint("la-put", "la-put@esperlabs.app");
    const created = await createFile(token, "put.txt", "v1", { "x-energon-link-access": "private" });
    const withPassword = await json(`/v1/files/${created.body.id}`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/plain", "x-energon-set-password": "shh" }),
      body: "v2",
    });
    expect(withPassword.status).toBe(400);
    expect(withPassword.body.error).toBe("link_access_conflict");
    const plain = await json(`/v1/files/${created.body.id}`, { method: "PUT", headers: auth(token, { "content-type": "text/plain" }), body: "v2" });
    expect(plain.status).toBe(200);
    const row = await env.DB.prepare("SELECT link_access, password_hash FROM loose_files WHERE id = ?").bind(created.body.id).first();
    expect(row).toEqual({ link_access: "private", password_hash: null });
  });

  it("does not go private when a password lands between the read and the update", async () => {
    const token = await mint("la-race", "la-race@esperlabs.app");
    const file = await createFile(token, "race.txt", "race");
    const site = await createSite(token, "la-race");
    for (const [table, path, id] of [["loose_files", `/v1/files/${file.body.id}`, file.body.id], ["sites", `/v1/sites/${site.id}`, site.id]]) {
      const raced = await withCompetingWrite(`UPDATE ${table} SET`, `UPDATE ${table} SET password_hash = 'raced' WHERE id = '${id}'`,
        () => patch(path, token, { link_access: "private" }));
      expect(raced.status).toBe(409);
      expect(raced.body.error).toBe("link_access_conflict");
      const row = await env.DB.prepare(`SELECT link_access FROM ${table} WHERE id = ?`).bind(id).first();
      expect(row).toEqual({ link_access: "public" });
    }
  });

  it("does not set a password when the object goes private between the read and the update", async () => {
    const token = await mint("la-race-pw", "la-race-pw@esperlabs.app");
    const file = await createFile(token, "race-pw.txt", "race");
    const raced = await withCompetingWrite("UPDATE loose_files SET", `UPDATE loose_files SET link_access = 'private' WHERE id = '${file.body.id}'`,
      () => patch(`/v1/files/${file.body.id}`, token, { password: "shh" }));
    expect(raced.status).toBe(409);
    expect(raced.body.error).toBe("link_access_conflict");
    const row = await env.DB.prepare("SELECT password_hash FROM loose_files WHERE id = ?").bind(file.body.id).first();
    expect(row).toEqual({ password_hash: null });
  });

  it("hides a private object from every other account", async () => {
    const owner = await mint("la-hide-owner", "la-hide@esperlabs.app");
    const other = await mint("la-hide-other", "la-hide-other@esperlabs.app");
    const file = await createFile(owner, "hidden.md", "hidden", { "x-energon-write-policy": "org" });
    const site = await createSite(owner, "la-hidden", { write_policy: "org" });
    await req(`/v1/sites/${site.id}/files/index.html`, { method: "PUT", headers: auth(owner, { "content-type": "text/html" }), body: "<p>s</p>" });
    // The other account writes first, so it is involved and would list both while they are public.
    await req(`/v1/files/${file.body.id}`, { method: "PUT", headers: auth(other, { "content-type": "text/plain" }), body: "edited" });
    await req(`/v1/sites/${site.id}/files/note.txt`, { method: "PUT", headers: auth(other, { "content-type": "text/plain" }), body: "n" });
    expect((await json("/v1/files?q=hidden.md", { headers: auth(other) })).body.files).toHaveLength(1);

    const fileGone = await patch(`/v1/files/${file.body.id}`, owner, { link_access: "private" });
    expect(fileGone.body).toMatchObject({ link_access: "private", write_policy: "owner" });
    const siteGone = await patch(`/v1/sites/${site.id}`, owner, { link_access: "private" });
    expect(siteGone.body).toMatchObject({ link_access: "private", write_policy: "owner" });

    expect((await req(`/v1/files/${file.body.id}`, { headers: auth(other) })).status).toBe(404);
    expect((await req(`/v1/sites/${site.id}`, { headers: auth(other) })).status).toBe(404);
    expect((await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(other) })).status).toBe(404);
    expect((await req(`/v1/sites/${site.id}/export`, { headers: auth(other) })).status).toBe(404);
    expect((await json(`/v1/files/${file.body.id}/duplicate`, { method: "POST", headers: auth(other, { "content-type": "application/json" }), body: "{}" })).status).toBe(404);
    expect((await req(`/v1/files/${file.body.id}`, { method: "PUT", headers: auth(other, { "content-type": "text/plain" }), body: "x" })).status).toBe(404);
    expect((await req(`/v1/files/${file.body.id}`, { method: "DELETE", headers: auth(other) })).status).toBe(404);
    expect((await req(`/v1/sites/${site.id}`, { method: "DELETE", headers: auth(other) })).status).toBe(404);
    expect((await req(`/v1/sites/${site.id}/import`, { method: "POST", headers: auth(other, { "content-type": "application/zip" }), body: "x" })).status).toBe(404);
    const deploy = await json(`/v1/sites/${site.id}/deployments`, {
      method: "POST",
      headers: auth(other, { "content-type": "application/json" }),
      body: JSON.stringify({ expected_version: 1, files: [] }),
    });
    expect(deploy.body.error).toBe("deployment_missing");
    const grant = (target: Record<string, unknown>) =>
      json("/v1/grants", { method: "POST", headers: auth(other, { "content-type": "application/json" }), body: JSON.stringify({ target }) });
    expect((await grant({ type: "file", id: file.body.id })).status).toBe(404);
    expect((await grant({ type: "site_path", site_id: site.id, path: "note.txt" })).status).toBe(404);
    expect((await json("/v1/files?q=hidden.md", { headers: auth(other) })).body.files).toHaveLength(0);
    expect((await json("/v1/sites?q=la-hidden", { headers: auth(other) })).body.sites).toHaveLength(0);
    expect((await json(`/account/files/${file.body.id}`, { headers: access("la-hide-other@esperlabs.app") })).status).toBe(404);

    expect((await req(`/v1/files/${file.body.id}`, { headers: auth(owner) })).status).toBe(200);
    expect((await json("/v1/files?q=hidden.md", { headers: auth(owner) })).body.files).toHaveLength(1);
  });

  it("lets an admin clean up another account's private work through admin cleanup", async () => {
    const owner = await mint("la-admin-owner", "la-admin@esperlabs.app");
    const file = await createFile(owner, "la-admin.md", "a", { "x-energon-link-access": "private" });
    const site = await createSite(owner, "la-admin", { link_access: "private" });
    const admin = await mintAdmin("la-admin-ops");
    const post = (body: unknown) =>
      json("/v1/admin/cleanup", { method: "POST", headers: auth(admin, { "content-type": "application/json" }), body: JSON.stringify(body) });

    expect((await req(`/v1/files/${file.body.id}`, { headers: auth(admin) })).status).toBe(404);
    const ttlPreview = await post({ target: { sites: [site.id] }, action: "set_ttl" });
    expect(ttlPreview.body.eligible).toBe(1);
    const ttl = await post({ target: { sites: [site.id] }, action: "set_ttl", confirm: ttlPreview.body.confirm });
    expect(ttl.body.applied.total).toBe(1);
    const delPreview = await post({ target: { sites: [site.id], files: [file.body.id] }, action: "delete" });
    expect(delPreview.body.eligible).toBe(2);
    const deleted = await post({ target: { sites: [site.id], files: [file.body.id] }, action: "delete", confirm: delPreview.body.confirm });
    expect(deleted.body.applied.total).toBe(2);
    expect(deleted.body.skipped.total).toBe(0);
  });

  it("stores owner write policy when an org PATCH lands between the private PATCH's read and update", async () => {
    const token = await mint("la-race-org", "la-race-org@esperlabs.app");
    const file = await createFile(token, "race-org.txt", "race", { "x-energon-write-policy": "owner" });
    const site = await createSite(token, "la-race-org", { write_policy: "owner" });
    for (const [table, path, id] of [["loose_files", `/v1/files/${file.body.id}`, file.body.id], ["sites", `/v1/sites/${site.id}`, site.id]]) {
      const raced = await withCompetingWrite(`UPDATE ${table} SET`, `UPDATE ${table} SET write_policy = 'org' WHERE id = '${id}'`,
        () => patch(path, token, { link_access: "private" }));
      expect(raced.status).toBe(200);
      const row = await env.DB.prepare(`SELECT link_access, write_policy FROM ${table} WHERE id = ?`).bind(id).first();
      expect(row).toEqual({ link_access: "private", write_policy: "owner" });
    }
  });

  it("refuses org writes on a private object", async () => {
    const token = await mint("la-org", "la-org@esperlabs.app");
    const created = await createFile(token, "o.txt", "o", { "x-energon-link-access": "private", "x-energon-write-policy": "org" });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("link_access_conflict");
    const priv = await createFile(token, "p.txt", "p", { "x-energon-link-access": "private" });
    const org = await patch(`/v1/files/${priv.body.id}`, token, { write_policy: "org" });
    expect(org.status).toBe(400);
    expect(org.body.error).toBe("link_access_conflict");
    const opened = await patch(`/v1/files/${priv.body.id}`, token, { link_access: "public", write_policy: "org" });
    expect(opened.body).toMatchObject({ link_access: "public", write_policy: "org" });
  });

  it("refuses a private file created with a password", async () => {
    const token = await mint("la-conflict", "la-conflict@esperlabs.app");
    const res = await createFile(token, "c.txt", "c", { "x-energon-link-access": "private", "x-energon-set-password": "shh" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("link_access_conflict");
    const bad = await createFile(token, "d.txt", "d", { "x-energon-link-access": "org" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad_link_access");
  });

  it("makes a site private only when its passwords are cleared in the same request", async () => {
    const token = await mint("la-site", "la-site@esperlabs.app");
    const site = await createSite(token, "la-site", { password: "share-it", write_password: "write-it" });
    expect(site.body.link_access).toBe("public");
    const put = await req(`/v1/sites/${site.id}/files/index.html`, { method: "PUT", headers: auth(token, { "content-type": "text/html" }), body: "<p>hi</p>" });
    expect(put.status).toBeLessThan(300);
    const path = `/v1/sites/${site.id}`;
    const pub = `${CONTENT}/la-site/s/${site.id}/la-site/index.html`;

    const kept = await patch(path, token, { link_access: "private" });
    expect(kept.status).toBe(409);
    expect(kept.body.error).toBe("link_access_conflict");
    expect((await req(pub, { headers: { [PASSWORD_HEADER]: "share-it" } })).status).toBe(200);

    const priv = await patch(path, token, { link_access: "private", password: "", write_password: "" });
    expect(priv.status).toBe(200);
    expect(priv.body).toMatchObject({ link_access: "private", password_protected: false, write_password_protected: false });
    expect((await json(pub)).body.error).toBe("link_private");
    expect((await req(`${CONTENT}/la-site/s/${site.id}/la-site/`)).status).toBe(403);
    const guest = await json(pub, { method: "PUT", headers: { [WRITE_PASSWORD_HEADER]: "write-it" }, body: "x" });
    expect(guest.body.error).toBe("link_private");
    expect((await req(`/v1/sites/${site.id}/files/index.html`, { headers: auth(token) })).status).toBe(200);
    expect((await json(path, { headers: auth(token) })).body.link_access).toBe("private");

    const pw = await patch(path, token, { password: "again" });
    expect(pw.status).toBe(400);
    expect(pw.body.error).toBe("link_access_conflict");

    const reopened = await patch(path, token, { link_access: "public", password: "again" });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ link_access: "public", password_protected: true });
    expect((await req(pub)).status).toBe(401);
    expect((await req(pub, { headers: { [PASSWORD_HEADER]: "again" } })).status).toBe(200);
  });

  it("refuses the gate form and guest deletes on a private site created private", async () => {
    const token = await mint("la-site-create", "la-site-create@esperlabs.app");
    const site = await createSite(token, "la-site-create", { link_access: "private" });
    expect(site.status).toBe(201);
    expect(site.body.link_access).toBe("private");
    const base = `${CONTENT}/la-site-create/s/${site.id}/la-site-create/`;
    const form = await req(base, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=anything" });
    expect(form.status).toBe(403);
    const removed = await json(`${base}index.html`, { method: "DELETE", headers: { [WRITE_PASSWORD_HEADER]: "anything" } });
    expect(removed.status).toBe(403);
    expect(removed.body.error).toBe("link_private");
  });

  it("creates a private file from a multipart field and keeps a file password from going private", async () => {
    const token = await mint("la-multipart", "la-multipart@esperlabs.app");
    const body = new FormData();
    body.set("file", new File(["m"], "m.txt", { type: "text/plain" }));
    body.set("link_access", "private");
    const created = await json("/v1/files", { method: "POST", headers: auth(token), body });
    expect(created.status).toBe(201);
    expect(created.body.link_access).toBe("private");

    const locked = await createFile(token, "locked.txt", "l", { "x-energon-set-password": "shh" });
    const kept = await patch(`/v1/files/${locked.body.id}`, token, { link_access: "private" });
    expect(kept.status).toBe(409);
    expect(kept.body.error).toBe("link_access_conflict");
  });

  it("lets only the creator change link access", async () => {
    const owner = await mint("la-owner", "la-owner@esperlabs.app");
    const other = await mint("la-other", "la-other@esperlabs.app");
    const created = await createFile(owner, "org.txt", "org", { "x-energon-write-policy": "org" });
    const denied = await patch(`/v1/files/${created.body.id}`, other, { link_access: "private" });
    expect(denied.status).toBe(403);
    const allowed = await patch(`/v1/files/${created.body.id}`, owner, { link_access: "private" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.link_access).toBe("private");
  });

  it("does not copy link access to a duplicate unless asked", async () => {
    const token = await mint("la-dup", "la-dup@esperlabs.app");
    const created = await createFile(token, "dup.txt", "dup", { "x-energon-link-access": "private" });
    const plain = await json(`/v1/files/${created.body.id}/duplicate`, { method: "POST", headers: auth(token, { "content-type": "application/json" }), body: "{}" });
    expect(plain.body.link_access).toBe("public");
    const priv = await json(`/v1/files/${created.body.id}/duplicate`, {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ link_access: "private" }),
    });
    expect(priv.body.link_access).toBe("private");
  });

  it("creates a private file from a new_file grant", async () => {
    const token = await mint("la-grant", "la-grant@esperlabs.app");
    const conflict = await json("/v1/grants", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ target: { type: "new_file", filename: "g.txt", link_access: "private", password: "shh" } }),
    });
    expect(conflict.status).toBe(400);
    expect(conflict.body.error).toBe("link_access_conflict");

    const minted = await json("/v1/grants", {
      method: "POST",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ target: { type: "new_file", filename: "g.txt", link_access: "private" } }),
    });
    expect(minted.status).toBe(201);
    expect(minted.body.target.link_access).toBe("private");
    const uploaded = await json(minted.body.upload_url, { method: "PUT", headers: { authorization: `Bearer ${minted.body.secret}` }, body: "granted" });
    expect(uploaded.status).toBe(201);
    expect((await json(uploaded.body.url)).body.error).toBe("link_private");
    const status = await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) });
    expect(status.body.target.link_access).toBe("private");
  });
});
