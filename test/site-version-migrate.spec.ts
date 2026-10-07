import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../src/db";
import { purgeExpiredSite } from "../src/expire";
import { STORED_BYTES_SQL } from "../src/http";
import { acquireVersionLease, releaseVersionLease } from "../src/site-storage";
import {
  advanceLegacySiteConversion,
  cleanupLegacySite,
  ensureLegacyReadVersion,
  ensureSiteSnapshotBaseline,
  getSiteConversion,
} from "../src/site-version-migrate";
import { putSiteFile, deleteSiteFile } from "../src/sites";
import { uploadFromBytes } from "../src/upload";
import { canonicalDeploymentIntent } from "../src/site-deployments";
import type { Env, SiteRow } from "../src/types";

async function fixture() {
  await ensureSchema(env.DB);
  const id = crypto.randomUUID().slice(0, 8),
    now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sites (id, handle, slug, owner_id, created_at, updated_at, created_by, last_written_by)
    VALUES (?, 'migrate', ?, 'owner', ?, ?, 'owner@example.test', 'owner@example.test')`,
  )
    .bind(id, id, now, now)
    .run();
  await env.BUCKET.put(`sites/migrate/${id}/index.html`, "main", {
    httpMetadata: { contentType: "text/html" },
  });
  await env.BUCKET.put(`sites/migrate/${id}/orphan.txt`, "lost", {
    httpMetadata: { contentType: "text/plain" },
  });
  await env.DB.prepare(
    "INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by) VALUES (?, 'index.html', 4, 'text/html', ?, 'owner@example.test')",
  )
    .bind(id, now)
    .run();
  await env.DB.prepare(
    `UPDATE platform_quota SET used = ${STORED_BYTES_SQL} WHERE id = 1`,
  ).run();
  return (await env.DB.prepare("SELECT * FROM sites WHERE id = ?")
    .bind(id)
    .first<SiteRow>())!;
}
async function finish(siteId: string, selectedEnv: Env = env, steps = 20) {
  for (let i = 0; i < steps; i++) {
    const row = await advanceLegacySiteConversion(selectedEnv, siteId);
    if (row.phase === "complete") return;
  }
  throw new Error("conversion did not finish");
}

describe("durable legacy site conversion", () => {
  it("requires explicit conversion enablement while permitting a genuinely empty first write", async () => {
    const site = await fixture();
    await expect(ensureSiteSnapshotBaseline({ ...env, SITE_VERSIONING_ENABLED: "false" }, site)).rejects.toThrow("not enabled");
    expect(await getSiteConversion(env.DB, site.id)).toBeNull();
    await env.BUCKET.delete([`sites/migrate/${site.id}/index.html`, `sites/migrate/${site.id}/orphan.txt`]);
    await env.DB.prepare("DELETE FROM site_files WHERE site_id = ?").bind(site.id).run();
    await putSiteFile(env, undefined, { email: "owner@example.test", userId: "owner", via: "access" }, site.id, "new.txt", uploadFromBytes(new TextEncoder().encode("new")), "text/plain");
    expect(await getSiteConversion(env.DB, site.id)).toBeNull();
    expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(site.id).first())?.active_version_id).toBeTruthy();
  });
  it("defers the first legacy PUT until durable conversion preserves uncataloged paths", async () => {
    const site = await fixture();
    const actor = { email: "owner@example.test", userId: "owner", via: "access" as const };
    const update = () => putSiteFile({ ...env, SITE_VERSIONING_ENABLED: "true" }, undefined, actor, site.id, "index.html", uploadFromBytes(new TextEncoder().encode("edit")), "text/html");
    await expect(update()).rejects.toMatchObject({ code: "site_busy" });
    expect((await getSiteConversion(env.DB, site.id))?.phase).toBe("reserve");
    expect((await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?").bind(site.id).first())?.active_version_id).toBeNull();
    await finish(site.id);
    await update();
    const orphan = await env.DB.prepare("SELECT f.object_key FROM sites s JOIN site_version_files f ON f.version_id = s.active_version_id WHERE s.id = ? AND f.path = 'orphan.txt'").bind(site.id).first<{ object_key: string }>();
    expect(await (await env.BUCKET.get(orphan!.object_key))!.text()).toBe("lost");
  });
  it("converts before deleting a legacy orphan that was absent from the catalog", async () => {
    const site = await fixture();
    const remove = () => deleteSiteFile({ ...env, SITE_VERSIONING_ENABLED: "true" }, undefined, { email: "owner@example.test", userId: "owner", via: "access" as const }, site.id, "orphan.txt");
    await expect(remove()).rejects.toMatchObject({ code: "site_busy" });
    await finish(site.id);
    await remove();
    const paths = (await env.DB.prepare("SELECT f.path FROM sites s JOIN site_version_files f ON f.version_id = s.active_version_id WHERE s.id = ?").bind(site.id).all()).results;
    expect(paths).toEqual([{ path: "index.html" }]);
  });
  it("allows repairs and deletions above 200 converted paths but rejects growth and oversized public intents", async () => {
    const site = await fixture();
    const now = new Date().toISOString();
    for (let i = 0; i < 200; i++) {
      const path = `file-${i}.txt`;
      await env.BUCKET.put(`sites/migrate/${site.id}/${path}`, "");
      await env.DB.prepare("INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by) VALUES (?, ?, 0, 'text/plain', ?, 'owner@example.test')").bind(site.id, path, now).run();
    }
    await finish(site.id, env, 500);
    const actor = { email: "owner@example.test", userId: "owner", via: "access" as const };
    await putSiteFile(env, undefined, actor, site.id, "index.html", uploadFromBytes(new TextEncoder().encode("edit")), "text/html");
    await deleteSiteFile(env, undefined, actor, site.id, "file-0.txt");
    const paths = (await env.DB.prepare("SELECT f.path FROM sites s JOIN site_version_files f ON f.version_id = s.active_version_id WHERE s.id = ?").bind(site.id).all()).results;
    expect(paths).toHaveLength(201);
    await expect(putSiteFile(env, undefined, actor, site.id, "new.txt", uploadFromBytes(new Uint8Array()), "text/plain")).rejects.toMatchObject({ code: "too_many_files" });
    expect(() => canonicalDeploymentIntent({ mode: "replace", files: Array.from({ length: 201 }, (_, i) => ({ path: `${i}.txt`, size: 0, sha256: "0".repeat(64), contentType: "text/plain" })) })).toThrow("Invalid manifest size");
  }, 120_000);

  it("inventories visible orphans, reserves all copies, then publishes a complete immutable version", async () => {
    const site = await fixture();
    await advanceLegacySiteConversion(env, site.id);
    expect((await getSiteConversion(env.DB, site.id))?.phase).toBe("reserve");
    expect(
      await env.DB.prepare(
        "SELECT active_version_id, conversion_state FROM sites WHERE id = ?",
      )
        .bind(site.id)
        .first(),
    ).toMatchObject({
      active_version_id: null,
      conversion_state: "converting",
    });
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_files WHERE site_id = ?",
        )
          .bind(site.id)
          .first()
      )?.n,
    ).toBe(2);
    await advanceLegacySiteConversion(env, site.id);
    await advanceLegacySiteConversion(env, site.id);
    expect(
      (await env.BUCKET.list({ prefix: `site-versions/${site.id}/` })).objects,
    ).toHaveLength(0);
    await finish(site.id);
    const converted = (await env.DB.prepare("SELECT * FROM sites WHERE id = ?")
      .bind(site.id)
      .first<SiteRow>())!;
    expect(converted.active_version_id).toBeTruthy();
    const files = (
      await env.DB.prepare(
        "SELECT path, object_key FROM site_version_files WHERE version_id = ? ORDER BY path",
      )
        .bind(converted.active_version_id)
        .all<{ path: string; object_key: string }>()
    ).results;
    expect(files.map((file) => file.path)).toEqual([
      "index.html",
      "orphan.txt",
    ]);
    expect(await (await env.BUCKET.get(files[1].object_key))!.text()).toBe(
      "lost",
    );
    expect(
      await env.BUCKET.head(`sites/migrate/${site.id}/index.html`),
    ).not.toBeNull();
    await finish(site.id);
    expect(
      (
        await env.DB.prepare(
          "SELECT content_generation FROM sites WHERE id = ?",
        )
          .bind(site.id)
          .first()
      )?.content_generation,
    ).toBe(1);
  });
  it("persists a quota blocker before copying and resumes after headroom is restored", async () => {
    const site = await fixture();
    await advanceLegacySiteConversion(env, site.id);
    const used = Number(
      (await env.DB.prepare(
        "SELECT used FROM platform_quota WHERE id = 1",
      ).first())!.used,
    );
    const capped = { ...env, MAX_PLATFORM_BYTES: String(used + 4) };
    await advanceLegacySiteConversion(capped, site.id);
    await expect(
      advanceLegacySiteConversion(capped, site.id),
    ).rejects.toThrow();
    expect((await getSiteConversion(env.DB, site.id))?.last_error).toBeTruthy();
    expect(
      (await env.BUCKET.list({ prefix: `site-versions/${site.id}/` })).objects,
    ).toHaveLength(0);
    expect(
      (
        await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?")
          .bind(site.id)
          .first()
      )?.active_version_id,
    ).toBeNull();
    await finish(site.id);
  });
  it("resumes after a receipt was recorded but its progress checkpoint failed", async () => {
    const site = await fixture();
    for (let i = 0; i < 4; i++) await advanceLegacySiteConversion(env, site.id);
    await env.DB.prepare(
      `CREATE TRIGGER migration_test_checkpoint BEFORE UPDATE ON site_conversions
      WHEN OLD.site_id = '${site.id}' AND NEW.phase = 'copy' AND json_extract(NEW.inventory_json, '$.next') = 1
      BEGIN SELECT RAISE(FAIL, 'checkpoint stopped'); END`,
    ).run();
    try {
      await expect(advanceLegacySiteConversion(env, site.id)).rejects.toThrow(
        "checkpoint stopped",
      );
    } finally {
      await env.DB.exec("DROP TRIGGER migration_test_checkpoint");
    }
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_version_files WHERE version_id = (SELECT json_extract(inventory_json, '$.versionId') FROM site_conversions WHERE site_id = ?)",
        )
          .bind(site.id)
          .first()
      )?.n,
    ).toBe(1);
    await finish(site.id);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM storage_allocations WHERE site_id = ?",
        )
          .bind(site.id)
          .first()
      )?.n,
    ).toBe(2);
  });
  it("renews an unused reservation when a paused conversion resumes", async () => {
    const site = await fixture();
    for (let i = 0; i < 4; i++) await advanceLegacySiteConversion(env, site.id);
    await env.DB.prepare(
      "UPDATE storage_allocations SET writer_expires_at = ? WHERE site_id = ? AND state = 'reserved'",
    )
      .bind(new Date(0).toISOString(), site.id)
      .run();
    await finish(site.id);
    expect((await getSiteConversion(env.DB, site.id))?.phase).toBe("complete");
  });
  it("rolls back the entire pointer switch if a native SQL trigger fails", async () => {
    const site = await fixture();
    for (let i = 0; i < 10; i++) {
      const row = await advanceLegacySiteConversion(env, site.id);
      if (row.phase === "switch") break;
    }
    await env.DB.prepare(
      `CREATE TRIGGER migration_test_switch BEFORE UPDATE ON sites
      WHEN OLD.id = '${site.id}' AND NEW.active_version_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'switch stopped'); END`,
    ).run();
    try {
      await expect(advanceLegacySiteConversion(env, site.id)).rejects.toThrow(
        "switch stopped",
      );
    } finally {
      await env.DB.exec("DROP TRIGGER migration_test_switch");
    }
    expect(
      (
        await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?")
          .bind(site.id)
          .first()
      )?.active_version_id,
    ).toBeNull();
    expect((await getSiteConversion(env.DB, site.id))?.phase).toBe("switch");
    await finish(site.id);
  });
  it("rejects changed source bytes after inventory without publishing a partial version", async () => {
    const site = await fixture();
    for (let i = 0; i < 4; i++) await advanceLegacySiteConversion(env, site.id);
    await env.BUCKET.put(`sites/migrate/${site.id}/index.html`, "edit");
    await expect(advanceLegacySiteConversion(env, site.id)).rejects.toThrow(
      /changed during conversion/,
    );
    expect(
      (
        await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?")
          .bind(site.id)
          .first()
      )?.active_version_id,
    ).toBeNull();
  });
  it("keeps missing and changed legacy content blocked and readable", async () => {
    const site = await fixture();
    await env.BUCKET.delete(`sites/migrate/${site.id}/index.html`);
    await expect(advanceLegacySiteConversion(env, site.id)).rejects.toThrow(
      /missing storage/,
    );
    expect((await getSiteConversion(env.DB, site.id))?.last_error).toContain(
      "missing storage",
    );
    expect(
      (
        await env.DB.prepare("SELECT active_version_id FROM sites WHERE id = ?")
          .bind(site.id)
          .first()
      )?.active_version_id,
    ).toBeNull();
    expect(
      await env.BUCKET.head(`sites/migrate/${site.id}/orphan.txt`),
    ).not.toBeNull();
  });
  it("protects legacy readers through grace and releases catalog charges only after verified deletion", async () => {
    const site = await fixture();
    const legacyId = await ensureLegacyReadVersion(env.DB, site);
    await finish(site.id);
    const future = new Date(Date.now() + 360_000);
    const lease = await acquireVersionLease(
      env.DB,
      legacyId,
      "old-reader",
      future,
    );
    expect(await cleanupLegacySite(env, site, future)).toBe(false);
    await releaseVersionLease(env.DB, lease);
    const original = env.BUCKET.delete.bind(env.BUCKET);
    env.BUCKET.delete = async () => {
      throw new Error("delete failed");
    };
    try {
      await expect(cleanupLegacySite(env, site, future)).rejects.toThrow(
        "delete failed",
      );
    } finally {
      env.BUCKET.delete = original;
    }
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_files WHERE site_id = ?",
        )
          .bind(site.id)
          .first()
      )?.n,
    ).toBe(2);
    expect(await cleanupLegacySite(env, site, future)).toBe(true);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_files WHERE site_id = ?",
        )
          .bind(site.id)
          .first()
      )?.n,
    ).toBe(0);
    expect(
      (await env.BUCKET.list({ prefix: `sites/migrate/${site.id}/` })).objects,
    ).toHaveLength(0);
  });
  it("tombstones expired legacy sites while retaining bytes for pinned readers", async () => {
    const site = await fixture();
    const legacyId = await ensureLegacyReadVersion(env.DB, site);
    const lease = await acquireVersionLease(env.DB, legacyId, "reader");
    await env.DB.prepare("UPDATE sites SET expires_at = ? WHERE id = ?")
      .bind(new Date(0).toISOString(), site.id)
      .run();
    expect(await purgeExpiredSite(env, undefined, site.handle, site.id)).toBe(
      true,
    );
    expect(await purgeExpiredSite(env, undefined, site.handle, site.id)).toBe(
      false,
    );
    expect(
      await env.BUCKET.head(`sites/migrate/${site.id}/index.html`),
    ).not.toBeNull();
    expect(
      (
        await env.DB.prepare("SELECT lifecycle_state FROM sites WHERE id = ?")
          .bind(site.id)
          .first()
      )?.lifecycle_state,
    ).toBe("deleted");
    await releaseVersionLease(env.DB, lease);
  });
});
