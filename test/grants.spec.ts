import { env } from "cloudflare:test";
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
