import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { ensureSchema } from "../src/db";
import { loadAdminHealth } from "../src/admin-health";
import { sweepLegacySiteStorage } from "../src/site-version-migrate";
import { auth, createSite, mint, req } from "./helpers";

it("counts current version files without counting superseded snapshots", async () => {
  const token = await mint("admin-version-count");
  const site = await createSite(token, "admin-version-count");
  const before = await loadAdminHealth(env);
  await req(`/v1/sites/${site.id}/files/a.txt`, { method: "PUT", headers: auth(token), body: "first" });
  await req(`/v1/sites/${site.id}/files/b.txt`, { method: "PUT", headers: auth(token), body: "second" });
  expect((await loadAdminHealth(env)).files).toBe(before.files + 2);
  await req(`/v1/sites/${site.id}/files/a.txt`, { method: "DELETE", headers: auth(token) });
  expect((await loadAdminHealth(env)).files).toBe(before.files + 1);
});

it("keeps legacy conversion gated and reports repairable progress to operators", async () => {
  await ensureSchema(env.DB);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO sites (id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by)
    VALUES (?, 'operator', 'legacy-conversion', 'owner', ?, ?, 'owner@example.com', 'owner@example.com')`)
    .bind(id, now, now).run();
  await env.DB.prepare(`INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
    VALUES (?, 'missing.txt', 3, 'text/plain', ?, 'owner@example.com')`).bind(id, now).run();
  await sweepLegacySiteStorage({ ...env, SITE_VERSIONING_ENABLED: "false" });
  expect(await env.DB.prepare("SELECT site_id FROM site_conversions WHERE site_id = ?").bind(id).first()).toBeNull();
  expect((await loadAdminHealth(env)).site_conversions).toMatchObject({ enabled: false, pending: 1 });
  const enabled = { ...env, SITE_VERSIONING_ENABLED: "true" };
  await sweepLegacySiteStorage(enabled);
  const status = (await loadAdminHealth(enabled)).site_conversions!;
  expect(status).toMatchObject({ enabled: true, pending: 1 });
  expect(status.items).toEqual([expect.objectContaining({ site_id: id, slug: "legacy-conversion", last_error: expect.any(String) })]);
  expect(status.items[0].last_error).toMatch(/missing/i);
  expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(id).first())?.active_version_id).toBeNull();
});
