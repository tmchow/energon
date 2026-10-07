import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { grantActor } from "../src/auth";
import { createLooseFile, putLooseFile } from "../src/files";
import type { GrantGuard } from "../src/grant-guard";
import { sha256Hex } from "../src/http";
import { putSiteFile } from "../src/sites";
import type { Actor } from "../src/types";
import { uploadFromBytes } from "../src/upload";
import { auth, createSite, json, mint } from "./helpers";

const bytes = (text: string) => uploadFromBytes(new TextEncoder().encode(text));

async function tokenIdFor(token: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM tokens WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ id: string }>();
  if (!row) throw new Error("token row missing");
  return row.id;
}

async function minter(label: string, email = "ada@esperlabs.app"): Promise<{ token: string; tokenId: string; actor: Actor }> {
  const token = await mint(label, email);
  const tokenId = await tokenIdFor(token);
  const resolved = await grantActor(env, tokenId);
  if (!("actor" in resolved)) throw new Error("grant actor rejected");
  return { token, tokenId, actor: resolved.actor };
}

/** A grant row already holding a lease, the state a redeem reaches just before the mutator runs. */
async function leasedGrant(
  tokenId: string,
  target: { kind: "new_file" | "file" | "site_path"; fileId?: string; siteId?: string; path?: string; filename?: string },
  expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(),
): Promise<GrantGuard> {
  const grantId = `g${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const leaseId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO upload_grants (id, secret_hash, token_id, user_email, target_kind, file_id, site_id, path, filename, max_bytes, state, lease_id, leased_at, created_at, expires_at)
     VALUES (?, 'x', ?, 'ada@esperlabs.app', ?, ?, ?, ?, ?, 1000000, 'uploading', ?, ?, ?, ?)`,
  )
    .bind(grantId, tokenId, target.kind, target.fileId ?? null, target.siteId ?? null, target.path ?? null, target.filename ?? null, leaseId, new Date().toISOString(), new Date().toISOString(), expiresAt)
    .run();
  return { grantId, leaseId };
}

async function grantRow(id: string) {
  return env.DB.prepare("SELECT state, result_id, result_url, last_error FROM upload_grants WHERE id = ?")
    .bind(id)
    .first<{ state: string; result_id: string | null; result_url: string | null; last_error: string | null }>();
}

async function quotaUsed(): Promise<number> {
  const row = await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>();
  return Number(row?.used ?? 0);
}

describe("grant guard on the account write paths", () => {
  it("creates a loose file and consumes the grant in one commit", async () => {
    const { tokenId, actor } = await minter("guard-create");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "notes.txt" });
    const res = await createLooseFile(env, undefined, actor, "notes.txt", bytes("hello"), null, undefined, undefined, undefined, undefined, guard);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    const row = await grantRow(guard.grantId);
    expect(row).toMatchObject({ state: "consumed", result_id: body.id, result_url: body.url });
  });

  it("does not create a loose file when the lease no longer matches", async () => {
    const { tokenId, actor } = await minter("guard-create-lost");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "lost.txt" });
    const before = await quotaUsed();
    const before_rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'lost-lease.txt'").first<{ n: number }>();
    await expect(
      createLooseFile(env, undefined, actor, "lost-lease.txt", bytes("nope"), null, undefined, undefined, undefined, undefined, { ...guard, leaseId: "someone-else" }),
    ).rejects.toMatchObject({ status: 409, code: "grant_busy" });
    const after_rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'lost-lease.txt'").first<{ n: number }>();
    expect(after_rows?.n).toBe(before_rows?.n);
    expect(await quotaUsed()).toBe(before);
    const listed = await env.BUCKET.list({ prefix: "files/" });
    expect(listed.objects.some((o) => o.key.endsWith("/lost-lease.txt"))).toBe(false);
    expect((await grantRow(guard.grantId))?.state).toBe("uploading");
  });

  it("publishes once when two commits race on one lease", async () => {
    const { tokenId, actor } = await minter("guard-race");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "race.txt" });
    const results = await Promise.allSettled([
      createLooseFile(env, undefined, actor, "race-once.txt", bytes("a"), null, undefined, undefined, undefined, undefined, guard),
      createLooseFile(env, undefined, actor, "race-once.txt", bytes("b"), null, undefined, undefined, undefined, undefined, guard),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'race-once.txt'").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("publishes nothing when the grant row disappears before the commit", async () => {
    const { tokenId, actor } = await minter("guard-vanish");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "vanish.txt" });
    await env.DB.prepare("DELETE FROM upload_grants WHERE id = ?").bind(guard.grantId).run();
    const before = await quotaUsed();
    await expect(
      createLooseFile(env, undefined, actor, "vanish.txt", bytes("x"), null, undefined, undefined, undefined, undefined, guard),
    ).rejects.toMatchObject({ code: "grant_busy" });
    expect(await quotaUsed()).toBe(before);
  });

  it("refuses a commit after the grant's expiry plus grace", async () => {
    const { tokenId, actor } = await minter("guard-expired");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "late.txt" }, new Date(Date.now() - 6 * 60 * 1000).toISOString());
    const before = await quotaUsed();
    await expect(
      createLooseFile(env, undefined, actor, "late.txt", bytes("x"), null, undefined, undefined, undefined, undefined, guard),
    ).rejects.toMatchObject({ status: 410, code: "grant_expired" });
    expect(await quotaUsed()).toBe(before);
  });

  it("refuses a commit after the minting token is revoked", async () => {
    const { tokenId, actor } = await minter("guard-revoked");
    const guard = await leasedGrant(tokenId, { kind: "new_file", filename: "revoked.txt" });
    await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), tokenId).run();
    const before = await quotaUsed();
    await expect(
      createLooseFile(env, undefined, actor, "revoked-commit.txt", bytes("x"), null, undefined, undefined, undefined, undefined, guard),
    ).rejects.toMatchObject({ status: 410, code: "grant_failed" });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'revoked-commit.txt'").first<{ n: number }>();
    expect(rows?.n).toBe(0);
    expect(await quotaUsed()).toBe(before);
  });

  it("replaces a loose file, keeps its stored content type, and consumes the grant", async () => {
    const { token, tokenId, actor } = await minter("guard-replace");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "README", "content-type": "text/plain" }),
      body: "first",
    });
    expect(created.body.content_type).toMatch(/text\/plain/);
    const guard = await leasedGrant(tokenId, { kind: "file", fileId: created.body.id });
    const res = await putLooseFile(env, undefined, actor, created.body.id, bytes("second"), null, null, undefined, guard);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { content_type: string }).content_type).toBe(created.body.content_type);
    expect(await grantRow(guard.grantId)).toMatchObject({ state: "consumed", result_id: created.body.id, result_url: created.body.url });
    const stored = await env.DB.prepare("SELECT content_type FROM loose_files WHERE id = ?").bind(created.body.id).first<{ content_type: string }>();
    expect(stored?.content_type).toBe(created.body.content_type);
  });

  it("leaves a loose file untouched when the replacement loses its lease", async () => {
    const { token, tokenId, actor } = await minter("guard-replace-lost");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "keep.txt" }),
      body: "original",
    });
    const guard = await leasedGrant(tokenId, { kind: "file", fileId: created.body.id });
    const before = await quotaUsed();
    await expect(
      putLooseFile(env, undefined, actor, created.body.id, bytes("replacement"), null, null, undefined, { ...guard, leaseId: "other" }),
    ).rejects.toMatchObject({ status: 409, code: "grant_busy" });
    const raw = await env.BUCKET.get(`files/${created.body.id}/keep.txt`);
    expect(await raw?.text()).toBe("original");
    expect(await quotaUsed()).toBe(before);
  });

  it("keeps the grant leased when a failed replacement cannot restore storage", async () => {
    const { token, tokenId, actor } = await minter("guard-rollback");
    const created = await json("/v1/files", {
      method: "POST",
      headers: auth(token, { "X-Filename": "fragile.txt" }),
      body: "original",
    });
    const guard = await leasedGrant(tokenId, { kind: "file", fileId: created.body.id });
    const put = env.BUCKET.put.bind(env.BUCKET);
    let puts = 0;
    env.BUCKET.put = (async (...args: Parameters<R2Bucket["put"]>) => {
      puts += 1;
      if (puts === 2) throw new Error("restore failed");
      return put(...args);
    }) as R2Bucket["put"];
    try {
      await expect(
        putLooseFile(env, undefined, actor, created.body.id, bytes("replacement"), null, null, undefined, { ...guard, leaseId: "other" }),
      ).rejects.toMatchObject({ status: 500, code: "storage_rollback_failed" });
    } finally {
      env.BUCKET.put = put;
    }
    expect((await grantRow(guard.grantId))?.state).toBe("uploading");
  });

  it("writes a new site path and consumes the grant", async () => {
    const { token, tokenId, actor } = await minter("guard-site");
    const site = await createSite(token, "guard-site");
    const guard = await leasedGrant(tokenId, { kind: "site_path", siteId: site.id, path: "index.html" });
    const result = await putSiteFile(env, undefined, actor, site.id, "index.html", bytes("<h1>hi</h1>"), null, guard);
    expect(result.created).toBe(true);
    expect(await grantRow(guard.grantId)).toMatchObject({ state: "consumed", result_id: site.id, result_url: result.url });
  });

  it("reports a lost site lease as busy and writes no row", async () => {
    const { token, tokenId, actor } = await minter("guard-site-lost");
    const site = await createSite(token, "guard-site-lost");
    const guard = await leasedGrant(tokenId, { kind: "site_path", siteId: site.id, path: "a.txt" });
    const before = await quotaUsed();
    await expect(
      putSiteFile(env, undefined, actor, site.id, "a.txt", bytes("x"), null, { ...guard, leaseId: "other" }),
    ).rejects.toMatchObject({ status: 409, code: "grant_busy" });
    const row = await env.DB.prepare("SELECT path FROM site_files WHERE site_id = ? AND path = 'a.txt'").bind(site.id).first();
    expect(row).toBeNull();
    expect(await env.BUCKET.get(`sites/${site.handle}/${site.id}/a.txt`)).toBeNull();
    expect(await quotaUsed()).toBe(before);
  });
});

const CONTENT = "https://energon.example.com";
const HUB = "https://hub.energon.example.com";

async function mintGrant(token: string, body: Record<string, unknown>) {
  return json("/v1/grants", {
    method: "POST",
    headers: auth(token, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function redeem(uploadUrl: string, secret: string, body: string | Uint8Array, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${secret}`, ...headers }, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
}

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("minting and reading upload grants", () => {
  it("mints a new-file grant whose secret never appears in the URL", async () => {
    const token = await mint("mint-new");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "report.md" } });
    expect(minted.status).toBe(201);
    expect(minted.body.upload_url).toBe(`${CONTENT}/_grants/${minted.body.id}`);
    expect(minted.body.secret).toMatch(/^grant_[A-Za-z0-9]{43}$/);
    expect(minted.body.upload_url).not.toContain(minted.body.secret);
    expect(minted.body).toMatchObject({ method: "PUT", header: "Authorization", scheme: "Bearer", url: null, target: { type: "new_file", filename: "report.md" } });
    expect(minted.body.target).toEqual({ type: "new_file", filename: "report.md" });
    expect(JSON.stringify(minted.body)).not.toMatch(/secret_hash|energon-grant:/);
  });

  it("refuses an owner-only file the minter does not own and allows an org file", async () => {
    const owner = await mint("mint-owner", "grace@esperlabs.app");
    const other = await mint("mint-other", "ada@esperlabs.app");
    const locked = await json("/v1/files", {
      method: "POST",
      headers: auth(owner, { "X-Filename": "locked.txt", "X-Energon-Write-Policy": "owner" }),
      body: "x",
    });
    const open = await json("/v1/files", {
      method: "POST",
      headers: auth(owner, { "X-Filename": "open.txt", "X-Energon-Write-Policy": "org" }),
      body: "x",
    });
    expect((await mintGrant(other, { target: { type: "file", id: locked.body.id } })).status).toBe(403);
    const allowed = await mintGrant(other, { target: { type: "file", id: open.body.id } });
    expect(allowed.status).toBe(201);
    expect(allowed.body.url).toBe(open.body.url);
  });

  it("rejects malformed targets, lifetimes, and digests", async () => {
    const token = await mint("mint-bad");
    expect((await mintGrant(token, {})).status).toBe(400);
    expect((await mintGrant(token, { target: { type: "folder" } })).status).toBe(400);
    expect((await mintGrant(token, { target: { type: "new_file", filename: "a.txt" }, expires_in: "2h" })).body.error).toBe("bad_ttl");
    expect((await mintGrant(token, { target: { type: "new_file", filename: "a.txt" }, sha256: "abc" })).status).toBe(400);
    expect((await mintGrant(token, { target: { type: "new_file", filename: "a.txt", ttl: "forever" } })).body.error).toBe("bad_ttl");
    expect((await mintGrant(token, { target: { type: "new_file", filename: "a.txt", password: "x".repeat(129) } })).body.error).toBe("bad_password");
    expect((await mintGrant(token, { target: { type: "new_file", filename: "a.txt", password: 7 } })).status).toBe(400);
  });

  it("caps max_bytes at the instance file limit", async () => {
    const token = await mint("mint-cap");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "big.bin" }, max_bytes: 10 * 1024 * 1024 * 1024 });
    expect(minted.body.max_bytes).toBeLessThan(10 * 1024 * 1024 * 1024);
  });

  it("never outlives the minting token", async () => {
    const token = await mint("mint-short", "ada@esperlabs.app", undefined, "1d");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "a.txt" }, expires_in: "1h" });
    const tokenRow = await env.DB.prepare("SELECT expires_at FROM tokens WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ expires_at: string }>();
    expect(Date.parse(minted.body.expires_at)).toBeLessThanOrEqual(Date.parse(tokenRow!.expires_at));
  });

  it("keeps grant secrets and API tokens apart, even with an overlapping token prefix", async () => {
    const token = await mint("mint-apart");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "apart.txt" } });
    expect((await json("/v1/whoami", { headers: auth(minted.body.secret) })).status).toBe(401);
    expect((await redeem(minted.body.upload_url, token, "x")).body.error).toBe("grant_invalid");
  });

  it("shows status to any token of the minting account and hides it from others", async () => {
    const token = await mint("status-a");
    const second = await mint("status-b");
    const stranger = await mint("status-c", "grace@esperlabs.app");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "s.txt" } });
    const seen = await json(`/v1/grants/${minted.body.id}`, { headers: auth(second) });
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ state: "unused", url: null });
    expect(seen.body.target).toEqual({ type: "new_file", filename: "s.txt" });
    expect(JSON.stringify(seen.body)).not.toContain("secret");
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(stranger) })).status).toBe(404);
  });
});

describe("redeeming upload grants", () => {
  it("publishes a new loose file owned by the minting account", async () => {
    const token = await mint("redeem-new");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "hello.txt" } });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "hello from elsewhere");
    expect(put.status).toBe(201);
    expect(put.body.url).toMatch(/^https:\/\/energon\.example\.com\/ada\/f\/[A-Za-z0-9]+\/hello\.txt$/);
    expect(put.text).not.toMatch(/hub|api_url|\/v1/);
    const got = await SELF.fetch(put.body.url);
    expect(await got.text()).toBe("hello from elsewhere");
    const row = await env.DB.prepare("SELECT created_by FROM loose_files WHERE id = ?").bind(put.body.id).first<{ created_by: string }>();
    expect(row?.created_by).toBe("ada@esperlabs.app");
    const status = await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) });
    expect(status.body).toMatchObject({ state: "consumed", url: put.body.url, result_id: put.body.id });
  });

  it("creates a new file already protected by the passwords set at mint", async () => {
    const token = await mint("redeem-protected");
    const minted = await mintGrant(token, {
      target: { type: "new_file", filename: "locked.txt", password: " grant-pw ", write_password: "grant-wpw" },
    });
    expect(minted.status).toBe(201);
    expect(minted.body.target).toEqual({ type: "new_file", filename: "locked.txt", password: "grant-pw", write_password: "grant-wpw" });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "locked bytes");
    expect(put.status).toBe(201);
    expect(put.text).not.toContain("grant-pw");
    expect((await SELF.fetch(put.body.url)).status).toBe(401);
    const unlocked = await SELF.fetch(put.body.url, { headers: { "X-Energon-Password": "grant-pw" } });
    expect(await unlocked.text()).toBe("locked bytes");
    const file = await env.DB.prepare("SELECT password_secret, write_password_secret FROM loose_files WHERE id = ?").bind(put.body.id).first();
    expect(file).toEqual({ password_secret: "grant-pw", write_password_secret: "grant-wpw" });
    const status = await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) });
    expect(status.body.target).toEqual({ type: "new_file", filename: "locked.txt" });
    expect(JSON.stringify(status.body)).not.toContain("grant-pw");
    const row = await env.DB.prepare("SELECT file_password, file_write_password FROM upload_grants WHERE id = ?").bind(minted.body.id).first();
    expect(row).toEqual({ file_password: null, file_write_password: null });
  });

  it("replaces an existing loose file at the same URL", async () => {
    const token = await mint("redeem-replace");
    const created = await json("/v1/files", { method: "POST", headers: auth(token, { "X-Filename": "r.txt" }), body: "old" });
    const minted = await mintGrant(token, { target: { type: "file", id: created.body.id } });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "new");
    expect(put.status).toBe(200);
    expect(put.body.url).toBe(created.body.url);
    expect(await (await SELF.fetch(created.body.url)).text()).toBe("new");
  });

  it("keeps the stored type of an extensionless file it replaces", async () => {
    const token = await mint("redeem-type");
    const created = await json("/v1/files", { method: "POST", headers: auth(token, { "X-Filename": "NOTES", "content-type": "text/plain" }), body: "a" });
    const minted = await mintGrant(token, { target: { type: "file", id: created.body.id } });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "b", { "content-type": "text/html" });
    expect(put.body.content_type).toBe(created.body.content_type);
  });

  it("creates a site path, and a second grant replaces it", async () => {
    const token = await mint("redeem-site");
    const site = await createSite(token, "redeem-site");
    const first = await mintGrant(token, { target: { type: "site_path", site_id: site.id, path: "index.html" } });
    expect((await redeem(first.body.upload_url, first.body.secret, "<p>one</p>")).status).toBe(201);
    const second = await mintGrant(token, { target: { type: "site_path", site_id: site.id, path: "index.html" } });
    const put = await redeem(second.body.upload_url, second.body.secret, "<p>two</p>");
    expect(put.status).toBe(200);
    expect(await (await SELF.fetch(put.body.url)).text()).toBe("<p>two</p>");
  });

  it("does not let the uploader choose a script-capable type for an extensionless path", async () => {
    const token = await mint("redeem-xml");
    const site = await createSite(token, "redeem-xml");
    const minted = await mintGrant(token, { target: { type: "site_path", site_id: site.id, path: "feed" } });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "plain words", { "content-type": "text/xml" });
    expect(put.body.content_type).not.toMatch(/xml/);
  });

  it("refuses a second redeem and reports the published URL", async () => {
    const token = await mint("redeem-twice");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "once.txt" } });
    const first = await redeem(minted.body.upload_url, minted.body.secret, "1");
    const again = await redeem(minted.body.upload_url, minted.body.secret, "2");
    expect(again.status).toBe(410);
    expect(again.body).toMatchObject({ error: "grant_used", url: first.body.url, result_id: first.body.id });
  });

  it("answers a wrong secret and an unknown id identically", async () => {
    const token = await mint("redeem-invalid");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "x.txt" } });
    const wrong = await redeem(minted.body.upload_url, `grant_${"A".repeat(43)}`, "x");
    const unknown = await redeem(`${CONTENT}/_grants/${"B".repeat(24)}`, minted.body.secret, "x");
    expect(wrong.status).toBe(404);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("refuses an expired grant", async () => {
    const token = await mint("redeem-expired");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "late.txt" } });
    await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), minted.body.id).run();
    const put = await redeem(minted.body.upload_url, minted.body.secret, "x");
    expect(put.status).toBe(410);
    expect(put.body.error).toBe("grant_expired");
  });

  it("keeps the grant unused when the body is over max_bytes or fails its checksum", async () => {
    const token = await mint("redeem-limits");
    const capped = await mintGrant(token, { target: { type: "new_file", filename: "c.txt" }, max_bytes: 3 });
    expect((await redeem(capped.body.upload_url, capped.body.secret, "four")).status).toBe(413);
    expect((await json(`/v1/grants/${capped.body.id}`, { headers: auth(token) })).body.state).toBe("unused");

    const checked = await mintGrant(token, { target: { type: "new_file", filename: "d.txt" }, sha256: await digest("right") });
    const before = (await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>())!.used;
    const bad = await redeem(checked.body.upload_url, checked.body.secret, "wrong");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("checksum_mismatch");
    expect((await env.DB.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>())!.used).toBe(before);
    const good = await redeem(checked.body.upload_url, checked.body.secret, "right");
    expect(good.status).toBe(201);
  });

  it("verifies the digest of a staged body larger than the in-memory limit", async () => {
    const token = await mint("redeem-staged");
    const big = new Uint8Array(26 * 1024 * 1024).fill(97);
    const buf = await crypto.subtle.digest("SHA-256", big);
    const right = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const wrong = await mintGrant(token, { target: { type: "new_file", filename: "big-wrong.bin" }, sha256: "0".repeat(64) });
    const rejected = await redeem(wrong.body.upload_url, wrong.body.secret, big, { "content-length": String(big.byteLength) });
    expect(rejected.body.error).toBe("checksum_mismatch");
    const ok = await mintGrant(token, { target: { type: "new_file", filename: "big-right.bin" }, sha256: right });
    const accepted = await redeem(ok.body.upload_url, ok.body.secret, big, { "content-length": String(big.byteLength) });
    expect(accepted.status).toBe(201);
  });

  it("reports a storage failure on a staged body as a server error, not a checksum mismatch", async () => {
    const token = await mint("redeem-staged-down");
    const big = new Uint8Array(26 * 1024 * 1024).fill(98);
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "big-down.bin" }, sha256: "1".repeat(64) });
    const put = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = (async (key: string, ...rest: unknown[]) => {
      if (key.startsWith("tmp/uploads/")) {
        await new Response(rest[0] as ReadableStream).arrayBuffer();
        throw new Error("storage unavailable");
      }
      return (put as (...a: unknown[]) => Promise<unknown>)(key, ...rest);
    }) as R2Bucket["put"];
    try {
      const res = await redeem(minted.body.upload_url, minted.body.secret, big, { "content-length": String(big.byteLength) });
      expect(res.status).toBe(500);
      expect(res.body.error).not.toBe("checksum_mismatch");
    } finally {
      env.BUCKET.put = put;
    }
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) })).body.state).toBe("unused");
  });

  it("ends the grant when its minting token is revoked", async () => {
    const token = await mint("redeem-revoked");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "r.txt" } });
    await json("/v1/whoami", { method: "DELETE", headers: auth(token) });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "x");
    expect(put.status).toBe(410);
    expect(put.body).toMatchObject({ error: "grant_failed", reason: "token_revoked" });
  });

  it("ends the grant when its target is deleted", async () => {
    const token = await mint("redeem-gone");
    const created = await json("/v1/files", { method: "POST", headers: auth(token, { "X-Filename": "gone.txt" }), body: "x" });
    const minted = await mintGrant(token, { target: { type: "file", id: created.body.id } });
    await json(`/v1/files/${created.body.id}`, { method: "DELETE", headers: auth(token) });
    const put = await redeem(minted.body.upload_url, minted.body.secret, "y");
    expect(put.status).toBe(410);
    expect(put.body.error).toBe("grant_failed");
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) })).body).toMatchObject({ state: "failed", last_error: "file_not_found" });
  });

  it("publishes once when two redeems race", async () => {
    const token = await mint("redeem-race");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "race-redeem.txt" } });
    const results = await Promise.all([
      redeem(minted.body.upload_url, minted.body.secret, "a"),
      redeem(minted.body.upload_url, minted.body.secret, "b"),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) expect(["grant_busy", "grant_used"]).toContain(r.body.error);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'race-redeem.txt'").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("answers a malformed grant id with a grant error, not a hub error", async () => {
    const res = await SELF.fetch(`${CONTENT}/_grants/%E0%A4%A`, { method: "PUT", headers: { authorization: "Bearer grant_x" }, body: "x" });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body.error).toBe("grant_invalid");
    expect(body.hub).toBeUndefined();
  });

  it("rejects metadata headers and non-PUT methods", async () => {
    const token = await mint("redeem-headers");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "h.txt" } });
    expect((await redeem(minted.body.upload_url, minted.body.secret, "x", { "x-filename": "evil.html" })).status).toBe(400);
    const options = await SELF.fetch(minted.body.upload_url, { method: "OPTIONS" });
    expect(options.status).toBe(405);
    expect(options.headers.get("allow")).toBe("PUT");
    expect(options.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("points a hub-origin redeem at the content origin instead of redirecting", async () => {
    const token = await mint("redeem-hub");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "hub.txt" } });
    const res = await SELF.fetch(`${HUB}/_grants/${minted.body.id}`, { method: "PUT", headers: { authorization: `Bearer ${minted.body.secret}` }, body: "x", redirect: "manual" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toContain(`${CONTENT}/_grants/${minted.body.id}`);
  });

  it("reads a stale uploading grant as expired once the grace passes, and never re-leases it", async () => {
    const token = await mint("redeem-stale");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "stale.txt" } });
    await env.DB.prepare("UPDATE upload_grants SET state = 'uploading', lease_id = 'dead' WHERE id = ?").bind(minted.body.id).run();
    expect((await redeem(minted.body.upload_url, minted.body.secret, "x")).body.error).toBe("grant_busy");
    await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 6 * 60 * 1000).toISOString(), minted.body.id).run();
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) })).body.state).toBe("expired");
  });
});

describe("grant settlement after a committed upload", () => {
  it("keeps a published grant consumed when a later step fails", async () => {
    const { redeemGrantRoute } = await import("../src/grants");
    const token = await mint("post-commit");
    const minted = await mintGrant(token, { target: { type: "new_file", filename: "post-commit.txt" } });
    const failingPurge = {
      cache: { purge: () => Promise.reject(new Error("purge unavailable")) },
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    const res = await redeemGrantRoute(
      env,
      failingPurge,
      new Request(minted.body.upload_url, { method: "PUT", headers: { authorization: `Bearer ${minted.body.secret}` }, body: "once" }),
      minted.body.id,
    );
    expect(res.status).toBe(500);
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) })).body.state).toBe("consumed");
    const again = await redeem(minted.body.upload_url, minted.body.secret, "twice");
    expect(again.body.error).toBe("grant_used");
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM loose_files WHERE filename = 'post-commit.txt'").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("hands a grant back after a retryable failure so the same secret works again", async () => {
    const token = await mint("retryable");
    const created = await json("/v1/files", { method: "POST", headers: auth(token, { "X-Filename": "busy.txt" }), body: "v1" });
    const minted = await mintGrant(token, { target: { type: "file", id: created.body.id } });
    await env.DB.prepare("UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?")
      .bind(`__energon_writing__:${crypto.randomUUID()}`, new Date().toISOString(), created.body.id)
      .run();
    const busy = await redeem(minted.body.upload_url, minted.body.secret, "v2");
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe("file_busy");
    expect((await json(`/v1/grants/${minted.body.id}`, { headers: auth(token) })).body.state).toBe("unused");
    await env.DB.prepare("UPDATE loose_files SET last_written_by = 'ada@esperlabs.app' WHERE id = ?").bind(created.body.id).run();
    expect((await redeem(minted.body.upload_url, minted.body.secret, "v2")).status).toBe(200);
  });
});

describe("grant sweep", () => {
  it("deletes grants a day past expiry and keeps newer ones", async () => {
    const { purgeGrants } = await import("../src/grants");
    const token = await mint("sweep");
    const old = await mintGrant(token, { target: { type: "new_file", filename: "old.txt" } });
    const recent = await mintGrant(token, { target: { type: "new_file", filename: "recent.txt" } });
    const live = await mintGrant(token, { target: { type: "new_file", filename: "live.txt" } });
    await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 25 * 3600 * 1000).toISOString(), old.body.id).run();
    await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 23 * 3600 * 1000).toISOString(), recent.body.id).run();
    await purgeGrants(env);
    const ids = (await env.DB.prepare("SELECT id FROM upload_grants WHERE id IN (?, ?, ?)").bind(old.body.id, recent.body.id, live.body.id).all<{ id: string }>()).results.map((r) => r.id);
    expect(ids.sort()).toEqual([recent.body.id, live.body.id].sort());
  });

  it("drains more expired rows than one batch", async () => {
    const { purgeGrants } = await import("../src/grants");
    const token = await mint("sweep-many");
    const tokenId = await tokenIdFor(token);
    const past = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    for (let i = 0; i < 120; i++) {
      await env.DB.prepare(
        `INSERT INTO upload_grants (id, secret_hash, token_id, user_email, target_kind, filename, max_bytes, state, created_at, expires_at)
         VALUES (?, 'x', ?, 'ada@esperlabs.app', 'new_file', 'f', 1, 'unused', ?, ?)`,
      ).bind(`sweepmany${String(i).padStart(15, "0")}`, tokenId, past, past).run();
    }
    await purgeGrants(env);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_grants WHERE id LIKE 'sweepmany%'").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
