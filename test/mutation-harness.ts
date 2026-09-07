import type { Env, LooseFileRow, SiteFileRow, SiteRow } from "../src/types";
import { fileKey, nowIso, siteKey } from "../src/config";
import { totalStoredBytes } from "../src/http";
import { auth, json } from "./helpers";

type Phase = "setup" | "act" | "assert" | "teardown";

type StoredObjectSnapshot = {
  key: string;
  size: number;
  body: number[];
  http_metadata: {
    content_type: string | null;
    content_language: string | null;
    content_disposition: string | null;
    content_encoding: string | null;
    cache_control: string | null;
    cache_expiry: string | null;
  };
  custom_metadata: Record<string, string>;
};

export type SiteMutationSnapshot = {
  site: SiteRow | null;
  files: SiteFileRow[];
  objects: StoredObjectSnapshot[];
  backup_objects: StoredObjectSnapshot[];
  quota_used: number;
  catalog_bytes: number;
};

export type LooseFileMutationSnapshot = {
  file: LooseFileRow | null;
  objects: StoredObjectSnapshot[];
  quota_used: number;
  catalog_bytes: number;
};

export type MutationLog = {
  write(phase: Phase, event: string, data?: Record<string, unknown>): void;
  snapshot(phase: Phase, label: string, value: unknown): void;
};

export async function withMutationLog(
  suite: string,
  scenario: (log: MutationLog) => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  let currentPhase: Phase = "setup";
  const write = (phase: Phase, event: string, data?: Record<string, unknown>) => {
    currentPhase = phase;
    console.error(JSON.stringify({ ts: nowIso(), suite, phase, event, data }));
  };
  const log: MutationLog = {
    write,
    snapshot(phase, label, value) {
      write(phase, "storage_snapshot", { label, value });
    },
  };

  try {
    await scenario(log);
    write("teardown", "test_end", { result: "pass", duration_ms: Date.now() - startedAt });
  } catch (error) {
    write(currentPhase, "test_failure", {
      message: error instanceof Error ? error.message : String(error),
    });
    write("teardown", "test_end", { result: "fail", duration_ms: Date.now() - startedAt });
    throw error;
  }
}

export async function snapshotSiteMutation(
  env: Env,
  handle: string,
  slug: string,
): Promise<SiteMutationSnapshot> {
  const [site, files, objects, backupObjects, accounting] = await Promise.all([
    env.DB.prepare(
      `SELECT handle, owner_id, slug, created_at, updated_at, created_by, last_written_by,
              password_hash, expires_at, write_policy
       FROM sites WHERE handle = ? AND slug = ?`,
    )
      .bind(handle, slug)
      .first<SiteRow>(),
    env.DB.prepare(
      `SELECT handle, slug, path, size, content_type, updated_at, last_written_by
       FROM site_files WHERE handle = ? AND slug = ? ORDER BY path`,
    )
      .bind(handle, slug)
      .all<SiteFileRow>(),
    snapshotR2Prefix(env.BUCKET, siteKey(handle, slug, "")),
    snapshotR2Prefix(env.BUCKET, "sites/.integrity-backup/"),
    snapshotAccounting(env.DB),
  ]);

  return {
    site: site ?? null,
    files: files.results,
    objects,
    backup_objects: backupObjects,
    ...accounting,
  };
}

export async function snapshotLooseFileMutation(
  env: Env,
  id: string,
): Promise<LooseFileMutationSnapshot> {
  const [file, objects, accounting] = await Promise.all([
    env.DB.prepare(
      `SELECT id, handle, owner_id, filename, size, content_type, created_at, created_by,
              updated_at, last_written_by, password_hash, expires_at, write_policy
       FROM loose_files WHERE id = ?`,
    )
      .bind(id)
      .first<LooseFileRow>(),
    snapshotR2Prefix(env.BUCKET, fileKey(id, "")),
    snapshotAccounting(env.DB),
  ]);

  return { file: file ?? null, objects, ...accounting };
}

export async function snapshotR2Prefix(bucket: R2Bucket, prefix: string): Promise<StoredObjectSnapshot[]> {
  const keys = await snapshotR2Keys(bucket, prefix);
  const snapshots: StoredObjectSnapshot[] = [];
  for (let offset = 0; offset < keys.length; offset += 25) {
    const batch = await Promise.all(
      keys.slice(offset, offset + 25).map(async (key): Promise<StoredObjectSnapshot | null> => {
        const object = await bucket.get(key);
        if (!object) return null;
        const body = Array.from(await object.bytes());
        return {
          key,
          size: object.size,
          body,
          http_metadata: {
            content_type: object.httpMetadata?.contentType ?? null,
            content_language: object.httpMetadata?.contentLanguage ?? null,
            content_disposition: object.httpMetadata?.contentDisposition ?? null,
            content_encoding: object.httpMetadata?.contentEncoding ?? null,
            cache_control: object.httpMetadata?.cacheControl ?? null,
            cache_expiry: object.httpMetadata?.cacheExpiry?.toISOString() ?? null,
          },
          custom_metadata: Object.fromEntries(Object.entries(object.customMetadata ?? {}).sort(([a], [b]) => a.localeCompare(b))),
        };
      }),
    );
    snapshots.push(...batch.filter((snapshot): snapshot is StoredObjectSnapshot => snapshot !== null));
  }
  return snapshots;
}

export async function snapshotR2Keys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  keys.sort();
  return keys;
}

export function mutationSnapshotSummary(snapshot: SiteMutationSnapshot | LooseFileMutationSnapshot): Record<string, unknown> {
  return {
    catalog_rows: "files" in snapshot ? snapshot.files.length + Number(Boolean(snapshot.site)) : Number(Boolean(snapshot.file)),
    object_keys: snapshot.objects.map((object) => object.key),
    backup_keys: "backup_objects" in snapshot ? snapshot.backup_objects.map((object) => object.key) : [],
    quota_used: snapshot.quota_used,
    catalog_bytes: snapshot.catalog_bytes,
  };
}

export async function createSiteFixture(
  token: string,
  slug: string,
  files: Record<string, string> = {},
): Promise<void> {
  const created = await json("/v1/sites", {
    method: "POST",
    headers: auth(token, { "content-type": "application/json" }),
    body: JSON.stringify({ slug }),
  });
  if (created.status !== 201) throw new Error(`site fixture creation failed: ${created.status}`);

  for (const [path, body] of Object.entries(files)) {
    const written = await json(`/v1/sites/${slug}/files/${path}`, {
      method: "PUT",
      headers: auth(token),
      body,
    });
    if (written.status !== 200 && written.status !== 201) {
      throw new Error(`site fixture write failed for ${path}: ${written.status}`);
    }
  }
}

export async function withD1Trigger<T>(
  db: D1Database,
  name: string,
  statement: string,
  action: () => Promise<T>,
): Promise<T> {
  await db.prepare(statement).run();
  try {
    return await action();
  } finally {
    await db.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }
}

export async function seedExpiredLooseFiles(
  env: Env,
  count: number,
  prefix = "e",
): Promise<Array<{ id: string; filename: string; key: string; size: number }>> {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const expiresAt = "2026-01-02T00:00:00.000Z";
  const fixtures = Array.from({ length: count }, (_, index) => {
    const id = `${prefix}${index.toString(36).padStart(5, "0")}`;
    const filename = `expired-${index.toString().padStart(3, "0")}.txt`;
    const body = new TextEncoder().encode(`expired-${index}`);
    return { id, filename, key: fileKey(id, filename), size: body.byteLength, body };
  });

  for (let offset = 0; offset < fixtures.length; offset += 100) {
    await env.DB.batch(
      fixtures.slice(offset, offset + 100).map((fixture) =>
        env.DB.prepare(
          `INSERT INTO loose_files
             (id, filename, size, content_type, created_at, created_by, updated_at,
              last_written_by, handle, owner_id, expires_at, write_policy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          fixture.id,
          fixture.filename,
          fixture.size,
          "text/plain; charset=utf-8",
          createdAt,
          "ada@esperlabs.app",
          createdAt,
          "ada@esperlabs.app",
          "ada",
          null,
          expiresAt,
          "org",
        ),
      ),
    );
  }
  for (let offset = 0; offset < fixtures.length; offset += 25) {
    await Promise.all(
      fixtures.slice(offset, offset + 25).map((fixture) =>
        env.BUCKET.put(fixture.key, fixture.body, {
          httpMetadata: { contentType: "text/plain; charset=utf-8" },
        }),
      ),
    );
  }
  await env.DB.prepare(`UPDATE platform_quota SET used = used + ? WHERE id = 1`)
    .bind(fixtures.reduce((total, fixture) => total + fixture.size, 0))
    .run();

  return fixtures.map(({ id, filename, key, size }) => ({ id, filename, key, size }));
}

async function snapshotAccounting(db: D1Database): Promise<{ quota_used: number; catalog_bytes: number }> {
  const [quota, catalog] = await Promise.all([
    db.prepare(`SELECT used FROM platform_quota WHERE id = 1`).first<{ used: number }>(),
    totalStoredBytes(db),
  ]);
  return { quota_used: Number(quota?.used ?? 0), catalog_bytes: Number(catalog) };
}
