import { siteKey } from "./config";
import { acquireVersionLease, leaseVersionStream, releaseVersionLease, startVersionLeaseHeartbeat } from "./site-storage";
import type { Env, SiteFileRow, SiteRow } from "./types";
import { ensureLegacyReadVersion } from "./site-version-migrate";

type FileMetadata = { object_key: string; size: number; sha256: string; content_type: string };

export interface SiteRead {
  versionId: string | null;
  metadata(path: string): Promise<FileMetadata | null>;
  get(path: string): Promise<R2ObjectBody | null>;
  files(): Promise<SiteFileRow[]>;
}

export async function withSiteRead(env: Env, site: SiteRow, operation: string,
  read: (snapshot: SiteRead) => Promise<Response>): Promise<Response> {
  const versionId = site.active_version_id ?? null;
  const lease = await acquireVersionLease(env.DB, versionId ?? await ensureLegacyReadVersion(env.DB, site), operation);
  const heartbeat = startVersionLeaseHeartbeat(env.DB, lease);
  const assertActive = () => heartbeat.assertActive();
  const metadata = new Map<string, FileMetadata | null>();
  let catalogLoaded = false;
  const fileMetadata = async (path: string): Promise<FileMetadata | null> => {
    if (!versionId) return null;
    if (metadata.has(path)) return metadata.get(path)!;
    if (catalogLoaded) return null;
    const row = await env.DB.prepare("SELECT object_key, size, sha256, content_type FROM site_version_files WHERE version_id = ? AND path = ?")
      .bind(versionId, path).first<FileMetadata>();
    metadata.set(path, row);
    return row;
  };
  let transferred = false;
  try {
    const response = await read({
      versionId,
      async metadata(path) {
        assertActive();
        return fileMetadata(path);
      },
      async get(path) {
        assertActive();
        const row = versionId ? await fileMetadata(path) : { object_key: siteKey(site.handle, site.id, path) };
        if (!row) return null;
        const object = await env.BUCKET.get(row.object_key);
        try { assertActive(); } catch (error) { await object?.body.cancel(); throw error; }
        return object;
      },
      async files() {
        assertActive();
        const rows = versionId
          ? await env.DB.prepare(`SELECT ? AS site_id, path, size, content_type, ? AS updated_at, ? AS last_written_by, object_key, sha256
              FROM site_version_files WHERE version_id = ? ORDER BY path`)
            .bind(site.id, site.updated_at, site.last_written_by, versionId).all<SiteFileRow & FileMetadata>()
          : await env.DB.prepare("SELECT * FROM site_files WHERE site_id = ? ORDER BY path").bind(site.id).all<SiteFileRow>();
        assertActive();
        if (!versionId) return rows.results;
        catalogLoaded = true;
        return rows.results.map(row => {
          const { object_key, sha256, ...file } = row as SiteFileRow & FileMetadata;
          metadata.set(file.path, { object_key, sha256, size: file.size, content_type: file.content_type });
          return file;
        });
      },
    });
    assertActive();
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    if (versionId) headers.set("x-energon-site-version", versionId);
    const body = response.body ? leaseVersionStream(env.DB, lease, response.body) : response.body;
    transferred = Boolean(body);
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } finally {
    heartbeat.stop();
    if (!transferred) await releaseVersionLease(env.DB, lease);
  }
}
