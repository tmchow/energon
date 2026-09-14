import { catalogCursorSql, criteriaSql, nextCatalogCursor, takePage, type CatalogCursorRow, type ListPage, type ListQuery } from "./catalog";
import { resolveWritePolicy } from "./policy";
import { publicOrigin } from "./http";
import { filePublicUrl, sitePublicUrl } from "./urls";
import type { Env } from "./types";

type UnionRow = CatalogCursorRow & {
  handle: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string;
  last_written_by: string | null;
  password_hash: string | null;
  write_password_hash: string | null;
  written_via: string | null;
  expires_at: string | null;
  last_read_at: string | null;
  write_policy: string | null;
  file_count: number | null;
  content_type: string | null;
};

type Shared = {
  id: string;
  url: string;
  created_at: string;
  created_by: string;
  last_written_by: string | null;
  size: number;
  password_protected: boolean;
  write_password_protected: boolean;
  written_via: string | null;
  expires_at: string | null;
  last_read_at: string | null;
  write_policy: string;
};

export type HubCatalogItem =
  | (Shared & { kind: "site"; slug: string; handle: string; updated_at: string; file_count: number })
  | (Shared & { kind: "file"; filename: string; updated_at: string | null; content_type: string; api_url: string });

const UNION_COLUMNS =
  "kind, id, handle, name, sort_updated, created_at, updated_at, created_by, last_written_by, password_hash, write_password_hash, written_via, expires_at, last_read_at, write_policy, file_count, size, content_type";

/**
 * Sites and loose files as one keyset-paged list. Each branch keeps its own criteria
 * (min_size is a HAVING on sites, a WHERE on files); the cursor applies to the union.
 */
export async function listHubCatalog(env: Env, email: string, query: ListQuery, ownerId?: string): Promise<ListPage<HubCatalogItem>> {
  const branches: { sql: string; binds: unknown[] }[] = [];
  if (query.kind !== "files") {
    const c = criteriaSql("sites", query, email, ownerId);
    branches.push({
      sql: `SELECT 'site' AS kind, s.id, s.handle, s.slug AS name, s.updated_at AS sort_updated, s.created_at, s.updated_at, s.created_by, s.last_written_by,
              s.password_hash, s.write_password_hash, s.written_via, s.expires_at, s.last_read_at, s.write_policy,
              COUNT(f.path) AS file_count, COALESCE(SUM(f.size), 0) AS size, NULL AS content_type
            FROM sites s LEFT JOIN site_files f ON s.id = f.site_id
            WHERE ${c.where} GROUP BY s.id${c.having ? ` HAVING ${c.having}` : ""}`,
      binds: [...c.whereBinds, ...c.havingBinds],
    });
  }
  if (query.kind !== "sites") {
    const c = criteriaSql("files", query, email, ownerId);
    branches.push({
      sql: `SELECT 'file' AS kind, id, handle, filename AS name, COALESCE(updated_at, created_at) AS sort_updated, created_at, updated_at, created_by, last_written_by,
              password_hash, write_password_hash, written_via, expires_at, last_read_at, write_policy,
              NULL AS file_count, size, content_type
            FROM loose_files WHERE ${c.where}`,
      binds: c.whereBinds,
    });
  }
  const union = branches.map((b) => b.sql).join(" UNION ALL ");
  const unionBinds = branches.flatMap((b) => b.binds);
  const cursor = catalogCursorSql(query);
  const [countRow, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${union}) u`).bind(...unionBinds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${UNION_COLUMNS} FROM (${union}) u${cursor.sql ? ` WHERE ${cursor.sql}` : ""} ORDER BY ${cursor.order} LIMIT ?`)
      .bind(...unionBinds, ...cursor.binds, query.limit + 1)
      .all<UnionRow>(),
  ]);
  const page = takePage(rows.results || [], query.limit);
  const origin = publicOrigin(env);
  const items = page.items.map((row): HubCatalogItem => {
    const shared: Omit<Shared, "url"> = {
      id: row.id,
      created_at: row.created_at,
      created_by: row.created_by,
      last_written_by: row.last_written_by,
      size: Number(row.size ?? 0),
      password_protected: Boolean(row.password_hash),
      write_password_protected: Boolean(row.write_password_hash),
      written_via: row.written_via ?? null,
      expires_at: row.expires_at ?? null,
      last_read_at: row.last_read_at ?? null,
      write_policy: resolveWritePolicy(row.write_policy),
    };
    if (row.kind === "site") {
      const handle = row.handle ?? "";
      return { ...shared, kind: "site", slug: row.name, handle, updated_at: row.updated_at ?? row.created_at, file_count: Number(row.file_count ?? 0), url: sitePublicUrl(env, handle, row.id, row.name) };
    }
    return {
      ...shared,
      kind: "file",
      filename: row.name,
      updated_at: row.updated_at,
      content_type: row.content_type ?? "application/octet-stream",
      url: row.handle ? filePublicUrl(env, row.handle, row.id, row.name) : `${origin}/v1/files/${row.id}`,
      api_url: `${origin}/v1/files/${row.id}`,
    };
  });
  const last = page.items[page.items.length - 1];
  return { items, total: Number(countRow?.n ?? 0), next_cursor: page.hasMore && last ? nextCatalogCursor(query.sort, last) : null };
}
