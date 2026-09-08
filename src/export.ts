import { MAX_IMPORT_FILES, PRODUCT, fileKey, formatBytes, nowIso, siteKey } from "./config";
import { isExpired, isPurgeClaimed } from "./expire";
import { getUser, getUserById } from "./handles";
import { ApiError, contentDisposition } from "./http";
import { instancePolicy, resolveWritePolicy, type WritePolicy } from "./policy";
import { noteRead } from "./reads";
import type { Actor, Env } from "./types";
import { filePublicUrl, sitePublicUrl } from "./urls";
import { packZip, type UnpackedFile } from "./zip";

export type OwnedExportCounts = {
  sites: number;
  files: number;
  content_files: number;
  content_bytes: number;
};

export type OwnedSiteManifest = {
  id: string;
  slug: string;
  url: string;
  size: number;
  file_count: number;
  expires_at: string | null;
  write_policy: WritePolicy;
  archive_path: string;
};

export type OwnedFileManifest = {
  id: string;
  filename: string;
  url: string;
  size: number;
  expires_at: string | null;
  write_policy: WritePolicy;
  archive_path: string;
};

export type OwnedExportManifest = {
  exported_at: string;
  scope: "owned";
  owner: { email: string; handle: string };
  sites: OwnedSiteManifest[];
  files: OwnedFileManifest[];
};

type SiteRow = {
  id: string;
  handle: string;
  slug: string;
  expires_at: string | null;
  write_policy: string | null;
  last_written_by: string | null;
  last_read_at: string | null;
  path: string | null;
  size: number | null;
};

type LooseRow = {
  id: string;
  handle: string;
  filename: string;
  size: number;
  expires_at: string | null;
  write_policy: string | null;
  last_written_by: string | null;
  last_read_at: string | null;
};

type SitePlan = {
  id: string;
  handle: string;
  slug: string;
  expires_at: string | null;
  last_read_at: string | null;
  write_policy: WritePolicy;
  files: { path: string; size: number }[];
};

function ownedExportExtra(counts: OwnedExportCounts, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sites: counts.sites,
    files: counts.files,
    actual_files: counts.content_files,
    actual_bytes: counts.content_bytes,
    ...extra,
  };
}

export function assertOwnedExportFits(counts: OwnedExportCounts, maxFiles: number, maxBytes: number): void {
  if (counts.content_files > maxFiles) {
    throw new ApiError(
      400,
      "too_many_files",
      `You own ${counts.content_files} files. ${PRODUCT} exports at most ${maxFiles} files per zip. Export each site with GET /v1/sites/{id}/export instead.`,
      ownedExportExtra(counts, { limit_files: maxFiles }),
    );
  }
  if (counts.content_bytes > maxBytes) {
    throw new ApiError(
      413,
      "too_large",
      `You own ${(counts.content_bytes / (1024 * 1024)).toFixed(1)} MB of files. ${PRODUCT} zips at most ${formatBytes(maxBytes)} so a download stays small. Export each site with GET /v1/sites/{id}/export instead.`,
      ownedExportExtra(counts, { limit_bytes: maxBytes }),
    );
  }
}

function siteArchivePath(id: string, path: string): string {
  return `sites/${id}/${path}`;
}

function fileArchivePath(id: string, filename: string): string {
  return `files/${id}/${filename}`;
}

function groupSites(rows: SiteRow[]): SitePlan[] {
  const byId = new Map<string, SitePlan>();
  const order: string[] = [];
  for (const row of rows) {
    if (isExpired(row.expires_at) || isPurgeClaimed(row.last_written_by)) continue;
    let site = byId.get(row.id);
    if (!site) {
      site = {
        id: row.id,
        handle: row.handle,
        slug: row.slug,
        expires_at: row.expires_at,
        last_read_at: row.last_read_at,
        write_policy: resolveWritePolicy(row.write_policy),
        files: [],
      };
      byId.set(row.id, site);
      order.push(row.id);
    }
    if (row.path) site.files.push({ path: row.path, size: Number(row.size || 0) });
  }
  return order.map((id) => byId.get(id)!);
}

export async function exportOwnedZip(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
): Promise<Response> {
  const user = actor.userId ? await getUserById(env, actor.userId) : await getUser(env, actor.email);
  if (!user) {
    throw new ApiError(
      400,
      "empty_export",
      "You do not own any sites or files to zip. This archive is only what you own, not work you only edited.",
    );
  }

  const siteRows = await env.DB.prepare(
    `SELECT s.id, s.handle, s.slug, s.expires_at, s.write_policy, s.last_written_by, s.last_read_at, f.path, f.size
     FROM sites s
     LEFT JOIN site_files f ON s.id = f.site_id
     WHERE s.owner_id = ?
     ORDER BY s.slug, s.id, f.path`,
  )
    .bind(user.id)
    .all<SiteRow>();
  const sites = groupSites(siteRows.results || []);

  const looseRows = await env.DB.prepare(
    `SELECT id, handle, filename, size, expires_at, write_policy, last_written_by, last_read_at
     FROM loose_files
     WHERE owner_id = ?
     ORDER BY filename, id`,
  )
    .bind(user.id)
    .all<LooseRow>();
  const files = (looseRows.results || []).filter((row) => !isExpired(row.expires_at) && !isPurgeClaimed(row.last_written_by));

  const counts: OwnedExportCounts = {
    sites: sites.length,
    files: files.length,
    content_files: sites.reduce((n, site) => n + site.files.length, 0) + files.length,
    content_bytes:
      sites.reduce((n, site) => n + site.files.reduce((sum, file) => sum + file.size, 0), 0) +
      files.reduce((n, file) => n + Number(file.size || 0), 0),
  };
  if (counts.sites === 0 && counts.files === 0) {
    throw new ApiError(
      400,
      "empty_export",
      "You do not own any sites or files to zip. This archive is only what you own, not work you only edited.",
    );
  }

  const policy = instancePolicy(env);
  assertOwnedExportFits(counts, MAX_IMPORT_FILES, policy.fileBytes);

  const manifest: OwnedExportManifest = {
    exported_at: nowIso(),
    scope: "owned",
    owner: { email: user.email, handle: user.handle },
    sites: sites.map((site) => ({
      id: site.id,
      slug: site.slug,
      url: sitePublicUrl(env, site.handle, site.id, site.slug),
      size: site.files.reduce((n, file) => n + file.size, 0),
      file_count: site.files.length,
      expires_at: site.expires_at,
      write_policy: site.write_policy,
      archive_path: `sites/${site.id}/`,
    })),
    files: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      url: filePublicUrl(env, file.handle, file.id, file.filename),
      size: Number(file.size || 0),
      expires_at: file.expires_at,
      write_policy: resolveWritePolicy(file.write_policy),
      archive_path: fileArchivePath(file.id, file.filename),
    })),
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

  const entries: UnpackedFile[] = [{ path: "manifest.json", bytes: manifestBytes }];
  for (const site of sites) {
    for (const file of site.files) {
      const obj = await env.BUCKET.get(siteKey(site.handle, site.id, file.path));
      if (!obj) {
        throw new ApiError(
          500,
          "export_failed",
          `Site file '${file.path}' on '${site.slug}' is missing from storage. Re-upload that path, then retry.`,
        );
      }
      entries.push({ path: siteArchivePath(site.id, file.path), bytes: new Uint8Array(await obj.arrayBuffer()) });
    }
  }
  for (const file of files) {
    const obj = await env.BUCKET.get(fileKey(file.id, file.filename));
    if (!obj) {
      throw new ApiError(
        500,
        "export_failed",
        `File '${file.filename}' is missing from storage. Re-upload it, then retry.`,
      );
    }
    entries.push({ path: fileArchivePath(file.id, file.filename), bytes: new Uint8Array(await obj.arrayBuffer()) });
  }

  const zip = packZip(entries, policy.fileBytes + manifestBytes.byteLength, MAX_IMPORT_FILES + 1);
  for (const site of sites) {
    noteRead(env, ctx, { table: "sites", id: site.id, last_read_at: site.last_read_at });
  }
  for (const file of files) {
    noteRead(env, ctx, { table: "loose_files", id: file.id, last_read_at: file.last_read_at });
  }
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", contentDisposition("attachment", `${user.handle}-owned.zip`));
  headers.set("cache-control", "no-store");
  headers.set("content-length", String(zip.byteLength));
  return new Response(zip, { headers });
}
