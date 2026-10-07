import {
  ApiError,
  normalizeRelPath,
  sha256Hex,
  STORED_BYTES_SQL,
} from "./http";
import { instancePolicy } from "./policy";
import {
  acquireVersionLease,
  cleanupAllocation,
  releaseVersionLease,
  reserveAllocation,
  startVersionLeaseHeartbeat,
  VERSION_GRACE_MS,
  VERSION_LEASE_MS,
  writeAllocation,
  type StorageAllocation,
  type VersionLease,
} from "./site-storage";
import type { Env, SiteRow } from "./types";

const INVENTORY_PAGE = 100;
const INVENTORY_BYTES = 512 * 1024;
const MIB = 1024 * 1024;
// Estimated D1/R2 calls per unit of work. Workers Free allows 1,000 internal-service calls per
// invocation, shared with the rest of the request or sweep, so budgets stay well below that.
const CALLS = { claim: 10, inventoryPage: 3, inventoryObject: 2, reserve: 4, copy: 14, lease: 2, switch: 3 };
export type ConversionBudget = { calls: number; bytes: number; deadline: number };
export const conversionBudget = (calls: number, bytes: number, ms: number): ConversionBudget =>
  ({ calls, bytes, deadline: Date.now() + ms });
const sweepBudget = () => conversionBudget(400, 8 * MIB, 10_000);
const requestBudget = () => conversionBudget(150, 4 * MIB, 5_000);
const exhausted = (budget: ConversionBudget) =>
  budget.calls <= 0 || budget.bytes <= 0 || Date.now() >= budget.deadline;
type LegacySite = Pick<SiteRow, "id" | "handle">;
type InventoryFile = {
  path: string;
  key: string;
  size: number;
  etag: string;
  contentType: string;
  allocationId?: string;
};
type Inventory = {
  versionId: string;
  generation: number;
  files: InventoryFile[];
  next: number;
};
export interface SiteConversion {
  site_id: string;
  phase: string;
  cursor: string | null;
  inventory_json: string;
  owner: string | null;
  owner_expires_at: string | null;
  last_error: string | null;
}
const busy = () =>
  new ApiError(
    409,
    "site_busy",
    "Legacy site conversion is busy or its ownership changed.",
  );

export async function ensureSiteSnapshotBaseline(env: Env, site: SiteRow): Promise<void> {
  if (site.active_version_id || site.lifecycle_state === "creating") return;
  if (site.conversion_state !== "converting") {
    const [catalog, stored] = await Promise.all([
      env.DB.prepare("SELECT 1 FROM site_files WHERE site_id = ? LIMIT 1").bind(site.id).first(),
      env.BUCKET.list({ prefix: `sites/${site.handle}/${site.id}/`, limit: 1 }),
    ]);
    if (!catalog && !stored.objects.length) return;
  }
  if (env.SITE_VERSIONING_ENABLED !== "true")
    throw new ApiError(409, "site_busy", "Legacy site conversion is not enabled; an operator must enable conversion before this site can be updated.");
  const row = await advanceLegacySiteConversion(env, site.id, requestBudget());
  throw new ApiError(409, "site_busy", row.phase === "complete"
    ? "Legacy site conversion finished; retry this update with freshly read metadata."
    : "Legacy site conversion is progressing; retry this update after conversion completes.");
}

export async function ensureLegacyReadVersion(
  db: D1Database,
  site: LegacySite,
): Promise<string> {
  const id = `legacy:${site.id}`;
  await db
    .prepare(
      `INSERT INTO site_versions (id, site_id, state, created_at)
    SELECT ?, id, 'active', ? FROM sites WHERE id = ? AND active_version_id IS NULL AND lifecycle_state = 'live'
    ON CONFLICT(id) DO NOTHING`,
    )
    .bind(id, new Date().toISOString(), site.id)
    .run();
  const existing = await db
    .prepare(
      "SELECT id FROM site_versions WHERE id = ? AND state IN ('active', 'superseded')",
    )
    .bind(id)
    .first();
  if (!existing) throw busy();
  return id;
}

export async function getSiteConversion(
  db: D1Database,
  siteId: string,
): Promise<SiteConversion | null> {
  return db
    .prepare("SELECT * FROM site_conversions WHERE site_id = ?")
    .bind(siteId)
    .first<SiteConversion>();
}

async function save(
  db: D1Database,
  siteId: string,
  owner: string,
  phase: string,
  inventory: Inventory,
  cursor: string | null = null,
) {
  const json = JSON.stringify(inventory);
  if (new TextEncoder().encode(json).byteLength > INVENTORY_BYTES)
    throw new ApiError(
      409,
      "site_busy",
      "Legacy inventory exceeds the bounded conversion metadata budget; repair or a paged inventory migration is required.",
    );
  const changed = await db
    .prepare(
      `UPDATE site_conversions SET phase = ?, inventory_json = ?, cursor = ?, updated_at = ?
    WHERE site_id = ? AND owner = ? AND owner_expires_at > ?`,
    )
    .bind(
      phase,
      json,
      cursor,
      new Date().toISOString(),
      siteId,
      owner,
      new Date().toISOString(),
    )
    .run();
  if (!changed.meta.changes) throw busy();
}

/**
 * Advances inventory pages, reservations, copies, and the atomic pointer switch under one ownership
 * claim until the budget is spent. Without a budget it advances exactly one unit. Every unit
 * checkpoints, so an interrupted invocation resumes from the last saved unit.
 */
export async function advanceLegacySiteConversion(
  env: Env,
  siteId: string,
  budget?: ConversionBudget,
): Promise<SiteConversion> {
  const site = await env.DB.prepare(
    "SELECT * FROM sites WHERE id = ? AND lifecycle_state = 'live'",
  )
    .bind(siteId)
    .first<SiteRow>();
  if (!site) throw busy();
  const previous = await getSiteConversion(env.DB, siteId);
  if (previous?.phase === "complete") return previous;
  if (site.active_version_id) throw busy();
  await ensureLegacyReadVersion(env.DB, site);
  const owner = crypto.randomUUID(),
    now = new Date();
  const inventory: Inventory = {
    versionId: crypto.randomUUID(),
    generation: site.content_generation ?? 0,
    files: [],
    next: 0,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO site_conversions (site_id, phase, inventory_json, updated_at)
      SELECT id, 'inventory', ?, ? FROM sites WHERE id = ? AND active_version_id IS NULL AND lifecycle_state = 'live'
      ON CONFLICT(site_id) DO NOTHING`,
    ).bind(JSON.stringify(inventory), now.toISOString(), siteId),
    env.DB.prepare(
      `UPDATE sites SET conversion_state = 'converting' WHERE id = ? AND active_version_id IS NULL AND lifecycle_state = 'live'
      AND EXISTS (SELECT 1 FROM site_conversions WHERE site_id = sites.id AND phase != 'complete')`,
    ).bind(siteId),
    env.DB.prepare(
      `UPDATE site_conversions SET owner = ?, owner_expires_at = ?, last_error = NULL WHERE site_id = ? AND phase != 'complete'
      AND (owner IS NULL OR owner_expires_at <= ?) AND EXISTS (SELECT 1 FROM sites WHERE id = site_id AND active_version_id IS NULL AND lifecycle_state = 'live')`,
    ).bind(
      owner,
      new Date(now.getTime() + VERSION_LEASE_MS).toISOString(),
      siteId,
      now.toISOString(),
    ),
  ]);
  const row = await getSiteConversion(env.DB, siteId);
  if (row?.owner !== owner) throw busy();
  const state: Inventory = JSON.parse(row.inventory_json);
  const controller = new AbortController();
  let ownershipLost = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void env.DB.prepare(
      "UPDATE site_conversions SET owner_expires_at = ? WHERE site_id = ? AND owner = ? AND owner_expires_at > ?",
    )
      .bind(
        new Date(Date.now() + VERSION_LEASE_MS).toISOString(),
        siteId,
        owner,
        new Date().toISOString(),
      )
      .run()
      .then((result) => {
        if (!result.meta.changes) {
          ownershipLost = true;
          controller.abort(busy());
        }
      })
      .catch(() => {
        ownershipLost = true;
        controller.abort(busy());
      })
      .finally(() => {
        renewing = false;
      });
  }, 30_000);
  let phase = row.phase,
    cursor = row.cursor;
  let leased: { lease: VersionLease; heartbeat: ReturnType<typeof startVersionLeaseHeartbeat> } | null = null;
  let units = 0;
  const checkpoint = async (next: string, nextCursor: string | null = null) => {
    await save(env.DB, siteId, owner, next, state, nextCursor);
    phase = next;
    cursor = nextCursor;
  };
  const charge = (calls: number, bytes = 0) => {
    if (!budget) return;
    budget.calls -= calls;
    budget.bytes -= bytes;
  };
  charge(CALLS.claim);
  try {
    await env.DB.prepare(
      `INSERT INTO site_versions (id, site_id, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
      .bind(state.versionId, siteId, now.toISOString())
      .run();
    do {
      units++;
      if (phase === "inventory") {
        const prefix = `sites/${site.handle}/${site.id}/`;
        const page = await env.BUCKET.list({
          prefix,
          limit: INVENTORY_PAGE,
          cursor: cursor ?? undefined,
          include: ["httpMetadata"],
        });
        charge(CALLS.inventoryPage + CALLS.inventoryObject * page.objects.length);
        for (const object of page.objects) {
          const path = object.key.slice(prefix.length);
          if (normalizeRelPath(path) !== path || path.includes("\0"))
            throw new ApiError(
              409,
              "site_busy",
              "Legacy storage contains a noncanonical path requiring repair.",
            );
          const catalog = await env.DB.prepare(
            "SELECT size FROM site_files WHERE site_id = ? AND path = ?",
          )
            .bind(siteId, path)
            .first<{ size: number }>();
          if (catalog && catalog.size !== object.size)
            throw new ApiError(
              409,
              "site_busy",
              "Legacy catalog length disagrees with stored bytes; repair is required.",
            );
          if (!state.files.some((file) => file.path === path))
            state.files.push({
              path,
              key: object.key,
              size: object.size,
              etag: object.etag,
              contentType:
                object.httpMetadata?.contentType ?? "application/octet-stream",
            });
          if (!catalog) {
            await env.DB.batch([
              env.DB.prepare(
                `INSERT INTO site_files (site_id, path, size, content_type, updated_at, last_written_by)
                SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_conversions WHERE site_id = ? AND owner = ?)
                ON CONFLICT(site_id, path) DO NOTHING`,
              ).bind(
                siteId,
                path,
                object.size,
                object.httpMetadata?.contentType ?? "application/octet-stream",
                now.toISOString(),
                site.last_written_by,
                siteId,
                owner,
              ),
              env.DB.prepare(
                `UPDATE platform_quota SET used = ${STORED_BYTES_SQL} WHERE id = 1`,
              ),
            ]);
          }
        }
        if (page.truncated) await checkpoint("inventory", page.cursor);
        else {
          const catalogCount = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM site_files WHERE site_id = ?",
          )
            .bind(siteId)
            .first<{ n: number }>();
          if (catalogCount?.n !== state.files.length)
            throw new ApiError(
              409,
              "site_busy",
              "Legacy catalog references missing storage; repair is required.",
            );
          await checkpoint("reserve");
        }
      } else if (phase === "reserve") {
        const file = state.files[state.next];
        charge(CALLS.reserve);
        if (file) {
          if (!file.allocationId) {
            const prefix = `site-versions/${siteId}/${state.versionId}/${await sha256Hex(file.path)}/`;
            const existing = await env.DB.prepare(
              "SELECT * FROM storage_allocations WHERE version_id = ? AND substr(object_key, 1, ?) = ? AND state != 'released' ORDER BY created_at DESC LIMIT 1",
            )
              .bind(state.versionId, prefix.length, prefix)
              .first<StorageAllocation>();
            const allocation =
              existing ??
              (await reserveAllocation(env.DB, {
                ownerId: site.owner_id ?? site.created_by,
                siteId,
                versionId: state.versionId,
                kind: "candidate",
                bytes: file.size,
                cap: instancePolicy(env).platformBytes,
                key: `${prefix}${crypto.randomUUID()}`,
              }));
            file.allocationId = allocation.id;
          }
          state.next++;
          await checkpoint("reserve");
        } else {
          state.next = 0;
          await checkpoint("copy");
        }
      } else if (phase === "copy") {
        const file = state.files[state.next];
        if (file && budget && units > 1 && file.size > budget.bytes) break;
        charge(CALLS.copy);
        if (file) {
          const receipt = await env.DB.prepare(
            "SELECT path FROM site_version_files WHERE version_id = ? AND path = ?",
          )
            .bind(state.versionId, file.path)
            .first();
          if (!receipt) {
            const allocation = await env.DB.prepare(
              "SELECT * FROM storage_allocations WHERE id = ?",
            )
              .bind(file.allocationId)
              .first<StorageAllocation>();
            if (!allocation || allocation.state === "released") {
              file.allocationId = undefined;
              state.next = 0;
              await checkpoint("reserve");
              continue;
            }
            if (
              allocation.state !== "reserved" &&
              allocation.state !== "stored"
            ) {
              await cleanupAllocation(env.DB, env.BUCKET, allocation.id);
              throw busy();
            }
            if (allocation.state === "reserved") {
              const renewed = await env.DB.prepare(
                `UPDATE storage_allocations SET writer_expires_at = ? WHERE id = ? AND state = 'reserved'
                AND EXISTS (SELECT 1 FROM site_conversions WHERE site_id = ? AND owner = ? AND owner_expires_at > ?)`,
              )
                .bind(
                  new Date(Date.now() + VERSION_LEASE_MS).toISOString(),
                  allocation.id,
                  siteId,
                  owner,
                  new Date().toISOString(),
                )
                .run();
              if (!renewed.meta.changes) throw busy();
            }
            if (!leased) {
              const lease = await acquireVersionLease(
                env.DB,
                `legacy:${siteId}`,
                "migration",
              );
              leased = {
                lease,
                heartbeat: startVersionLeaseHeartbeat(env.DB, lease, (error) =>
                  controller.abort(error),
                ),
              };
              charge(CALLS.lease);
            }
            let result: { size: number; sha256: string };
            if (allocation.state === "stored") {
              const stored = await env.BUCKET.get(allocation.object_key!);
              if (!stored || stored.size !== file.size) throw busy();
              const digest = new crypto.DigestStream("SHA-256");
              await stored.body.pipeTo(digest, { signal: controller.signal });
              result = {
                size: stored.size,
                sha256: Array.from(new Uint8Array(await digest.digest), (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join(""),
              };
            } else {
              const object = await env.BUCKET.get(file.key, {
                onlyIf: { etagMatches: file.etag },
              });
              if (!object || !("body" in object) || object.size !== file.size)
                throw new ApiError(
                  409,
                  "site_busy",
                  "Legacy storage changed during conversion.",
                );
              result = await writeAllocation(
                env.DB,
                env.BUCKET,
                allocation,
                object.body.pipeThrough(
                  new TransformStream<Uint8Array, Uint8Array>(),
                  { signal: controller.signal },
                ),
                undefined,
                file.contentType,
              );
            }
            charge(0, file.size);
            leased.heartbeat.assertActive();
            if (ownershipLost) throw busy();
            const recorded = await env.DB.prepare(
              `INSERT INTO site_version_files (version_id, path, allocation_id, object_key, size, sha256, content_type)
              SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_conversions WHERE site_id = ? AND owner = ? AND owner_expires_at > ?)
              ON CONFLICT(version_id, path) DO NOTHING`,
            )
              .bind(
                state.versionId,
                file.path,
                allocation.id,
                allocation.object_key,
                result.size,
                result.sha256,
                file.contentType,
                siteId,
                owner,
                new Date().toISOString(),
              )
              .run();
            if (!recorded.meta.changes) throw busy();
          }
          state.next++;
          await checkpoint("copy");
        } else await checkpoint("switch");
      } else if (phase === "switch") {
        charge(CALLS.switch);
        const files = (
          await env.DB.prepare(
            "SELECT path, size, sha256 FROM site_version_files WHERE version_id = ? ORDER BY path",
          )
            .bind(state.versionId)
            .all()
        ).results;
        if (files.length !== state.files.length) throw busy();
        const manifest = await sha256Hex(JSON.stringify(files));
        const ts = new Date().toISOString();
        const witness =
          "EXISTS (SELECT 1 FROM site_conversions WHERE site_id = ? AND owner = ? AND phase = 'committing')";
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE site_conversions SET phase = 'committing' WHERE site_id = ? AND owner = ? AND owner_expires_at > ? AND phase = 'switch'
            AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND active_version_id IS NULL AND lifecycle_state = 'live' AND conversion_state = 'converting' AND content_generation = ?)
            AND (SELECT COUNT(*) FROM site_version_files WHERE version_id = ?) = ?`,
          ).bind(
            siteId,
            owner,
            ts,
            siteId,
            state.generation,
            state.versionId,
            state.files.length,
          ),
          env.DB.prepare(
            `UPDATE site_versions SET state = 'active', manifest_hash = ?, file_count = ?, total_bytes = ?, sealed_at = ? WHERE id = ? AND state = 'candidate' AND ${witness}`,
          ).bind(
            manifest,
            files.length,
            state.files.reduce((sum, file) => sum + file.size, 0),
            ts,
            state.versionId,
            siteId,
            owner,
          ),
          env.DB.prepare(
            `UPDATE sites SET active_version_id = ?, conversion_state = 'versioned', content_generation = content_generation + 1 WHERE id = ? AND ${witness}`,
          ).bind(state.versionId, siteId, siteId, owner),
          env.DB.prepare(
            `UPDATE site_versions SET state = 'superseded', superseded_at = ? WHERE id = ? AND ${witness}`,
          ).bind(ts, `legacy:${siteId}`, siteId, owner),
          env.DB.prepare(
            "UPDATE site_conversions SET phase = 'complete', updated_at = ? WHERE site_id = ? AND owner = ? AND phase = 'committing'",
          ).bind(ts, siteId, owner),
        ]);
        if ((await getSiteConversion(env.DB, siteId))?.phase !== "complete")
          throw busy();
        phase = "complete";
      } else throw busy();
    } while (budget && phase !== "complete" && !exhausted(budget));
  } catch (error) {
    await env.DB.prepare(
      "UPDATE site_conversions SET last_error = ?, updated_at = ? WHERE site_id = ? AND owner = ?",
    )
      .bind(
        String(error).slice(0, 1000),
        new Date().toISOString(),
        siteId,
        owner,
      )
      .run();
    throw error;
  } finally {
    clearInterval(timer);
    leased?.heartbeat.stop();
    if (leased) await releaseVersionLease(env.DB, leased.lease);
    await env.DB.prepare(
      "UPDATE site_conversions SET owner = NULL, owner_expires_at = NULL WHERE site_id = ? AND owner = ?",
    )
      .bind(siteId, owner)
      .run();
  }
  return (await getSiteConversion(env.DB, siteId))!;
}

export async function cleanupLegacySite(
  env: Env,
  site: LegacySite,
  now = new Date(),
): Promise<boolean> {
  const versionId = `legacy:${site.id}`,
    ts = now.toISOString();
  await env.DB.prepare(
    `INSERT INTO site_versions (id, site_id, state, created_at, superseded_at)
    SELECT ?, id, 'superseded', ?, ? FROM sites WHERE id = ? AND (active_version_id IS NOT NULL OR lifecycle_state = 'deleted') ON CONFLICT(id) DO NOTHING`,
  )
    .bind(versionId, ts, ts, site.id)
    .run();
  await env.DB.prepare(
    `UPDATE site_versions SET state = 'superseded', superseded_at = ? WHERE id = ? AND state = 'active'
    AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND (active_version_id IS NOT NULL OR lifecycle_state = 'deleted'))`,
  )
    .bind(ts, versionId, site.id)
    .run();
  await env.DB.prepare(
    `UPDATE site_versions SET state = 'retiring' WHERE id = ? AND state = 'superseded' AND superseded_at <= ?
    AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND (active_version_id IS NOT NULL OR lifecycle_state = 'deleted'))
    AND NOT EXISTS (SELECT 1 FROM site_operation_leases WHERE version_id = ? AND expires_at > ?)`,
  )
    .bind(
      versionId,
      new Date(now.getTime() - VERSION_GRACE_MS).toISOString(),
      site.id,
      versionId,
      ts,
    )
    .run();
  const retired = await env.DB.prepare(
    "SELECT id FROM site_versions WHERE id = ? AND state = 'retiring'",
  )
    .bind(versionId)
    .first();
  if (!retired) return false;
  const prefix = `sites/${site.handle}/${site.id}/`;
  const page = await env.BUCKET.list({ prefix, limit: INVENTORY_PAGE });
  for (const object of page.objects) {
    await env.BUCKET.delete(object.key);
    if (await env.BUCKET.head(object.key)) throw busy();
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM site_files WHERE site_id = ? AND path = ?",
      ).bind(site.id, object.key.slice(prefix.length)),
      env.DB.prepare(
        `UPDATE platform_quota SET used = ${STORED_BYTES_SQL} WHERE id = 1`,
      ),
    ]);
  }
  if (
    page.truncated ||
    (await env.BUCKET.list({ prefix, limit: 1 })).objects.length
  )
    return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM site_files WHERE site_id = ?").bind(site.id),
    env.DB.prepare(
      `UPDATE platform_quota SET used = ${STORED_BYTES_SQL} WHERE id = 1`,
    ),
    env.DB.prepare(
      "UPDATE site_versions SET state = 'retired' WHERE id = ? AND state = 'retiring'",
    ).bind(versionId),
  ]);
  return true;
}

export async function sweepLegacySiteStorage(
  env: Env,
  now = new Date(),
): Promise<void> {
  const budget = sweepBudget();
  const pending = env.SITE_VERSIONING_ENABLED === "true" ? (await env.DB.prepare(`SELECT s.id FROM sites s
    LEFT JOIN site_conversions c ON c.site_id = s.id WHERE s.active_version_id IS NULL
    AND s.lifecycle_state = 'live' AND (s.expires_at IS NULL OR s.expires_at > ?)
    ORDER BY COALESCE(c.updated_at, s.created_at), s.id LIMIT 5`).bind(now.toISOString()).all<{ id: string }>()).results : [];
  for (const site of pending) {
    if (exhausted(budget)) break;
    await advanceLegacySiteConversion(env, site.id, budget).catch(error =>
      console.error("Site conversion pending", site.id, error));
  }
  const sites = (
    await env.DB.prepare(
      `SELECT id, handle FROM sites WHERE (active_version_id IS NOT NULL OR lifecycle_state = 'deleted')
    AND NOT EXISTS (SELECT 1 FROM site_versions WHERE id = 'legacy:' || sites.id AND state = 'retired') LIMIT 25`,
    ).all<LegacySite>()
  ).results;
  for (const site of sites)
    await cleanupLegacySite(env, site, now).catch((error) =>
      console.error("Legacy cleanup pending", site.id, error),
    );
  const unused = (
    await env.DB.prepare(
      `SELECT a.id FROM storage_allocations a JOIN site_conversions c
    ON a.version_id = json_extract(c.inventory_json, '$.versionId') WHERE c.phase = 'complete' AND a.state != 'released'
    AND NOT EXISTS (SELECT 1 FROM site_version_files f WHERE f.allocation_id = a.id) LIMIT 25`,
    ).all<{ id: string }>()
  ).results;
  for (const allocation of unused)
    await cleanupAllocation(env.DB, env.BUCKET, allocation.id, now).catch(
      (error) =>
        console.error(
          "Migration allocation cleanup pending",
          allocation.id,
          error,
        ),
    );
}
