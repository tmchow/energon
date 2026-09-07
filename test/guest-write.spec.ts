import { env } from "cloudflare:test";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_FILES, WRITE_PASSWORD_HEADER } from "../src/config";
import { GATE_MAX_FAILS } from "../src/gate";
import { GUEST_WRITE_401_MESSAGE } from "../src/guest-write-protocol";
import { access, auth, createSite, json, mint, req } from "./helpers";

const CONTENT = "https://energon.example.com";
const HUB = "https://hub.energon.example.com";
const WRITE = { [WRITE_PASSWORD_HEADER]: "guest-write-ok" };

function secretLeak(body: unknown): string[] {
  const blob = JSON.stringify(body);
  return ["_hash", "energon-wpw:", "energon-pw:"].filter((needle) => blob.includes(needle));
}

describe("guest write password", () => {
  it("lets a site guest add, replace, and delete paths without a token", async () => {
    const token = await mint("guest-site", "guest-site@esperlabs.app");
    const created = await createSite(token, "guest-site", { write_password: "guest-write-ok", write_policy: "owner" });
    expect(created.status).toBe(201);
    expect(created.body.write_password).toBe("guest-write-ok");
    expect(created.body.write_password_protected).toBe(true);
    expect(secretLeak(created.body)).toEqual([]);

    const listed = await json(`/v1/sites/${created.body.id}`, { headers: auth(token) });
    expect(listed.body.write_password_protected).toBe(true);
    expect(listed.body).not.toHaveProperty("write_password");
    expect(listed.body).not.toHaveProperty("write_password_hash");
    expect(listed.body.last_written_by).toBe("guest-site@esperlabs.app");

    const hub = await json(`/account/sites/${created.body.id}`, { headers: access("guest-site@esperlabs.app") });
    expect(hub.status).toBe(200);
    expect(hub.body.write_password).toBe("guest-write-ok");
    expect(hub.body.write_password_protected).toBe(true);
    expect(secretLeak(hub.body)).toEqual([]);

    const added = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/note.txt`, {
      method: "PUT",
      headers: { ...WRITE, "content-type": "text/plain" },
      body: "from-guest",
    });
    expect(added.status).toBe(201);
    expect(added.body.hub).toBeUndefined();
    expect(added.body.api_url).toBeUndefined();
    expect(added.body.path).toBe("note.txt");

    const got = await req(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/note.txt`);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("from-guest");

    const replaced = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/note.txt`, {
      method: "PUT",
      headers: WRITE,
      body: "replaced",
    });
    expect(replaced.status).toBe(200);

    const removed = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/note.txt`, { method: "DELETE", headers: WRITE });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true, path: "note.txt" });
    expect(removed.body.hub).toBeUndefined();

    const missing = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/note.txt`, { method: "DELETE", headers: WRITE });
    expect(missing.status).toBe(404);

    const home = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/index.html`, {
      method: "PUT",
      headers: WRITE,
      body: "<h1>home</h1>",
    });
    expect(home.status).toBe(201);
    const last = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/index.html`, { method: "DELETE", headers: WRITE });
    expect(last.status).toBe(200);
    const root = await req(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/`);
    expect(root.status).toBe(200);

    const directory = await req(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/`, { method: "DELETE", headers: WRITE });
    expect(directory.status).toBe(405);
    expect(directory.headers.get("allow")).toBe("GET");
    const directoryBody = await directory.json() as { error?: string; message?: string; hub?: string };
    expect(JSON.stringify(directoryBody)).not.toContain(WRITE_PASSWORD_HEADER);

    const shareHeader = await json(`${CONTENT}/guest-site/s/${created.body.id}/guest-site/x.txt`, {
      method: "PUT",
      headers: { "X-Energon-Password": "guest-write-ok" },
      body: "nope",
    });
    expect(shareHeader.status).toBe(401);
    expect(shareHeader.body.message).toBe(GUEST_WRITE_401_MESSAGE);

    const after = await json(`/v1/sites/${created.body.id}`, { headers: auth(token) });
    expect(after.body.last_written_by).toBe("guest-site@esperlabs.app");
    expect(after.body.written_via).toBe("write_password");
    expect(secretLeak(after.body)).toEqual([]);
  });

  it("lets a file guest replace bytes including empty and forbids DELETE", async () => {
    const token = await mint("guest-file", "guest-file@esperlabs.app");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, {
        "X-Filename": "guest.bin",
        "X-Energon-Set-Write-Password": "guest-write-ok",
        "content-type": "application/octet-stream",
      }),
      body: "abc",
    });
    expect(created.status).toBe(201);
    expect(created.body.write_password).toBe("guest-write-ok");
    const url = created.body.url as string;
    expect(url).toContain("/guest-file/f/");

    const emptied = await req(url, { method: "PUT", headers: WRITE, body: "" });
    expect(emptied.status).toBe(200);
    const again = await req(url);
    expect(again.status).toBe(200);
    expect(again.headers.get("content-type")).toMatch(/application\/octet-stream/);
    expect(await again.arrayBuffer().then((buf) => buf.byteLength)).toBe(0);

    const del = await req(url, { method: "DELETE", headers: WRITE });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("GET");
    const delBody = await del.json() as { error?: string; hub?: string };
    expect(JSON.stringify(delBody)).not.toContain(WRITE_PASSWORD_HEADER);
    expect(delBody.hub).toBeUndefined();

    const still = await req(url);
    expect(still.status).toBe(200);
  });

  it("binds identical phrases to the header that carried them and ignores the gate cookie", async () => {
    const token = await mint("guest-bound", "guest-bound@esperlabs.app");
    const created = await createSite(token, "guest-bound", { password: "same-phrase", write_password: "same-phrase" });
    expect(created.status).toBe(201);
    await json(`/v1/sites/${created.body.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>ok</h1>",
    });
    const publicUrl = `${CONTENT}/guest-bound/s/${created.body.id}/guest-bound/index.html`;

    const readHeader = await json(publicUrl, {
      method: "PUT",
      headers: { "X-Energon-Password": "same-phrase" },
      body: "stolen",
    });
    expect(readHeader.status).toBe(401);

    const form = await req(`${CONTENT}/guest-bound/s/${created.body.id}/guest-bound/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=same-phrase",
      redirect: "manual",
    });
    expect(form.status).toBe(303);
    const cookie = form.headers.get("set-cookie") || "";
    expect(cookie).toContain("energon_gate=");
    const cookiePut = await json(publicUrl, {
      method: "PUT",
      headers: { cookie: cookie.split(";")[0]! },
      body: "via-cookie",
    });
    expect(cookiePut.status).toBe(401);
    const cookieDel = await json(publicUrl, {
      method: "DELETE",
      headers: { cookie: cookie.split(";")[0]! },
    });
    expect(cookieDel.status).toBe(401);

    const ok = await json(publicUrl, { method: "PUT", headers: { [WRITE_PASSWORD_HEADER]: "same-phrase" }, body: "guest" });
    expect(ok.status).toBe(200);
  });

  it("accepts the write password on the HTML gate for reading and still ignores the cookie for write", async () => {
    const token = await mint("guest-gate", "guest-gate@esperlabs.app");
    const site_guest_gate = await createSite(token, "guest-gate", { password: "view-secret", write_password: "guest-write-ok" });
    await json(`/v1/sites/${site_guest_gate.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>gated</h1>",
    });
    const publicUrl = `${CONTENT}/guest-gate/s/${site_guest_gate.id}/guest-gate/index.html`;
    const rootUrl = `${CONTENT}/guest-gate/s/${site_guest_gate.id}/guest-gate/`;

    const locked = await req(rootUrl);
    expect(locked.status).toBe(401);
    expect(await locked.text()).toContain("Ask the person who sent you this link for the password.");

    const shareHeaderWrong = await json(publicUrl, {
      headers: { "X-Energon-Password": "guest-write-ok", accept: "application/json" },
    });
    expect(shareHeaderWrong.status).toBe(401);

    const writeGet = await req(publicUrl, { headers: WRITE });
    expect(writeGet.status).toBe(200);
    expect(await writeGet.text()).toContain("gated");

    const formWrite = await req(rootUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=guest-write-ok",
      redirect: "manual",
    });
    expect(formWrite.status).toBe(303);
    const cookie = (formWrite.headers.get("set-cookie") || "").split(";")[0]!;
    expect(cookie).toContain("energon_gate=");

    const cookieGet = await req(publicUrl, { headers: { cookie } });
    expect(cookieGet.status).toBe(200);
    expect(await cookieGet.text()).toContain("gated");

    const cookiePut = await json(publicUrl, {
      method: "PUT",
      headers: { cookie },
      body: "via-cookie",
    });
    expect(cookiePut.status).toBe(401);
    const cookieDel = await json(publicUrl, { method: "DELETE", headers: { cookie } });
    expect(cookieDel.status).toBe(401);

    const formShare = await req(rootUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=view-secret",
      redirect: "manual",
    });
    expect(formShare.status).toBe(303);

    const ok = await json(publicUrl, { method: "PUT", headers: WRITE, body: "guest" });
    expect(ok.status).toBe(200);
  });

  it("keeps write-guess lockout off share-password GET and share-guess lockout off write PUT", async () => {
    const token = await mint("guest-rl", "guest-rl@esperlabs.app");
    const site_guest_rl_write = await createSite(token, "guest-rl-write", { password: "view-secret", write_password: "guest-write-ok" });
    await json(`/v1/sites/${site_guest_rl_write.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>rl-write</h1>",
    });
    const writeUrl = `${CONTENT}/guest-rl/s/${site_guest_rl_write.id}/guest-rl-write/index.html`;
    const writeIp = { "CF-Connecting-IP": "203.0.113.41" };
    for (let i = 0; i < GATE_MAX_FAILS; i++) {
      const wrong = await json(writeUrl, {
        method: "PUT",
        headers: { ...writeIp, [WRITE_PASSWORD_HEADER]: "nope" },
        body: "x",
      });
      expect(wrong.status).toBe(401);
    }
    const writeBlocked = await json(writeUrl, {
      method: "PUT",
      headers: { ...writeIp, [WRITE_PASSWORD_HEADER]: "guest-write-ok" },
      body: "x",
    });
    expect(writeBlocked.status).toBe(429);
    const shareStill = await req(writeUrl, {
      headers: { ...writeIp, "X-Energon-Password": "view-secret" },
    });
    expect(shareStill.status).toBe(200);
    expect(await shareStill.text()).toContain("rl-write");

    const site_guest_rl_read = await createSite(token, "guest-rl-read", { password: "view-secret", write_password: "guest-write-ok" });
    await json(`/v1/sites/${site_guest_rl_read.id}/files/index.html`, {
      method: "PUT",
      headers: auth(token, { "content-type": "text/html" }),
      body: "<h1>rl-read</h1>",
    });
    const readUrl = `${CONTENT}/guest-rl/s/${site_guest_rl_read.id}/guest-rl-read/index.html`;
    const readIp = { "CF-Connecting-IP": "203.0.113.42", accept: "application/json", "X-Energon-Password": "wrong" };
    for (let i = 0; i < GATE_MAX_FAILS; i++) {
      const wrong = await json(readUrl, { headers: readIp });
      expect(wrong.status).toBe(401);
    }
    const readBlocked = await json(readUrl, { headers: readIp });
    expect(readBlocked.status).toBe(429);
    const writeStill = await json(readUrl, {
      method: "PUT",
      headers: { "CF-Connecting-IP": "203.0.113.42", [WRITE_PASSWORD_HEADER]: "guest-write-ok" },
      body: "guest",
    });
    expect(writeStill.status).toBe(200);
  }, 20_000);

  it("returns 405 when the write password is unset and 401 when it is wrong", async () => {
    const token = await mint("guest-unset", "guest-unset@esperlabs.app");
    const site_guest_unset = await createSite(token, "guest-unset");
    const unset = await json(`${CONTENT}/guest-unset/s/${site_guest_unset.id}/guest-unset/a.txt`, { method: "PUT", headers: WRITE, body: "x" });
    expect(unset.status).toBe(405);
    expect(JSON.stringify(unset.body)).not.toContain(WRITE_PASSWORD_HEADER);

    await json(`/v1/sites/${site_guest_unset.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ write_password: "guest-write-ok" }),
    });
    const wrong = await json(`${CONTENT}/guest-unset/s/${site_guest_unset.id}/guest-unset/a.txt`, {
      method: "PUT",
      headers: { [WRITE_PASSWORD_HEADER]: "nope" },
      body: "x",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe(GUEST_WRITE_401_MESSAGE);

    await json(`/v1/sites/${site_guest_unset.id}`, {
      method: "PATCH",
      headers: auth(token, { "content-type": "application/json" }),
      body: JSON.stringify({ write_password: "" }),
    });
    const cleared = await json(`${CONTENT}/guest-unset/s/${site_guest_unset.id}/guest-unset/a.txt`, { method: "PUT", headers: WRITE, body: "x" });
    expect(cleared.status).toBe(405);
  });

  it("rejects a coworker setting a write password and does not copy it on duplicate", async () => {
    const ada = await mint("guest-ada", "guest-ada@esperlabs.app");
    const bob = await mint("guest-bob", "guest-bob@esperlabs.app");
    const created = await createSite(ada, "guest-owned", { write_policy: "owner", write_password: "guest-write-ok" });
    expect(created.status).toBe(201);
    const bobPatch = await json(`/v1/sites/${created.body.id}`, {
      method: "PATCH",
      headers: auth(bob, { "content-type": "application/json" }),
      body: JSON.stringify({ write_password: "stolen" }),
    });
    expect(bobPatch.status).toBe(403);
    expect(bobPatch.body.error).toBe("forbidden_write_policy");
    const bobOverwrite = await createSite(bob, "guest-owned", { write_password: "stolen" });
    expect(bobOverwrite.status).toBe(201);
    expect(bobOverwrite.body.id).not.toBe(created.body.id);
    expect(bobOverwrite.body.handle).toBe("guest-bob");
    const adaGuest = await json(`${CONTENT}/guest-ada/s/${created.body.id}/guest-owned/kept.txt`, {
      method: "PUT",
      headers: WRITE,
      body: "still-ada",
    });
    expect(adaGuest.status).toBe(201);
    const stolen = await json(`${CONTENT}/guest-ada/s/${created.body.id}/guest-owned/kept.txt`, {
      method: "PUT",
      headers: { [WRITE_PASSWORD_HEADER]: "stolen" },
      body: "nope",
    });
    expect(stolen.status).toBe(401);

    const copied = await createSite(bob, "guest-owned-2", { duplicate_from: created.body.id });
    expect(copied.status).toBe(201);
    expect(copied.body.write_password_protected).toBe(false);
    const guestOnCopy = await json(`${CONTENT}/guest-bob/s/${copied.body.id}/guest-owned-2/x.txt`, {
      method: "PUT",
      headers: WRITE,
      body: "x",
    });
    expect(guestOnCopy.status).toBe(405);
  });

  it("redirects hub-origin PUT with 307 and keeps content-host /v1/help as a content-only 404", async () => {
    const token = await mint("guest-redir", "guest-redir@esperlabs.app");
    const site_guest_redir = await createSite(token, "guest-redir", { write_password: "guest-write-ok" });
    const hubPut = await req(`${HUB}/guest-redir/s/${site_guest_redir.id}/guest-redir/n.txt`, {
      method: "PUT",
      headers: WRITE,
      body: "x",
      redirect: "manual",
    });
    expect(hubPut.status).toBe(307);
    expect(hubPut.headers.get("location")).toBe(`${CONTENT}/guest-redir/s/${site_guest_redir.id}/guest-redir/n.txt`);

    const help = await json(`${CONTENT}/v1/help`);
    expect(help.status).toBe(404);
    expect(help.body.message).toContain("GET /llms.txt");
    expect(help.body.hub).toBeUndefined();

    const contentLlms = await (await req(`${CONTENT}/llms.txt`)).text();
    expect(contentLlms).toContain(WRITE_PASSWORD_HEADER);
    expect(contentLlms).not.toContain("/v1");
    expect(contentLlms).not.toContain("/auth.md");
    expect(contentLlms).not.toContain("/tokens");
    expect(contentLlms).not.toContain("/connect");

    const hubLlms = await (await req(`${HUB}/llms.txt`)).text();
    expect(hubLlms).toContain("Guest write password");
    expect(hubLlms).toContain(WRITE_PASSWORD_HEADER);
  });

  it("caps a new guest site path at MAX_IMPORT_FILES", async () => {
    const token = await mint("guest-cap", "guest-cap@esperlabs.app");
    const site_guest_cap = await createSite(token, "guest-cap", { write_password: "guest-write-ok" });
    const files = Object.fromEntries(
      Array.from({ length: MAX_IMPORT_FILES }, (_, i) => [`f${i}.txt`, strToU8("x")]),
    );
    const imported = await json(`/v1/sites/${site_guest_cap.id}/import`, {
      method: "POST",
      headers: auth(token, { "content-type": "application/zip" }),
      body: zipSync(files),
    });
    expect(imported.status).toBe(200);
    const extra = await json(`${CONTENT}/guest-cap/s/${site_guest_cap.id}/guest-cap/overflow.txt`, { method: "PUT", headers: WRITE, body: "x" });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe("too_many_files");
    const replace = await json(`${CONTENT}/guest-cap/s/${site_guest_cap.id}/guest-cap/f0.txt`, { method: "PUT", headers: WRITE, body: "y" });
    expect(replace.status).toBe(200);
    const del = await json(`${CONTENT}/guest-cap/s/${site_guest_cap.id}/guest-cap/f0.txt`, { method: "DELETE", headers: WRITE });
    expect(del.status).toBe(200);
  }, 15_000);

  it("omits hub from a guest 500", async () => {
    const token = await mint("guest-500", "guest-500@esperlabs.app");
    const site_guest_500 = await createSite(token, "guest-500", { write_password: "guest-write-ok" });
    const originalPut = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = async () => {
      throw new Error("r2 down");
    };
    try {
      const failed = await json(`${CONTENT}/guest-500/s/${site_guest_500.id}/guest-500/x.txt`, { method: "PUT", headers: WRITE, body: "x" });
      expect(failed.status).toBe(500);
      expect(failed.body.error).toBe("internal");
      expect(failed.body.hub).toBeUndefined();
      expect(JSON.stringify(failed.body)).not.toContain("/v1/help");
      expect(JSON.stringify(failed.body)).not.toContain("/account");
    } finally {
      env.BUCKET.put = originalPut;
    }
  });
});
