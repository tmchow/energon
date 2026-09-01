export type ListScope = "involved" | "created" | "edited";

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 50;

export type ListQuery = {
  scope: ListScope;
  q: string;
  createdBy?: string;
  sort: "updated" | "name";
  limit: number;
  cursor: string | null;
  sitesCursor: string | null;
  filesCursor: string | null;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  next_cursor: string | null;
};

export function parseListQuery(url: URL): ListQuery {
  const scopeRaw = (url.searchParams.get("scope") || "involved").toLowerCase();
  const scope: ListScope = scopeRaw === "created" || scopeRaw === "edited" ? scopeRaw : "involved";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const createdBy = (url.searchParams.get("created_by") || "").trim().toLowerCase() || undefined;
  const sort = url.searchParams.get("sort") === "name" ? "name" : "updated";
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit == null || rawLimit === "" ? NaN : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.round(parsedLimit)))
    : DEFAULT_LIST_LIMIT;
  return {
    scope,
    q,
    createdBy,
    sort,
    limit,
    cursor: url.searchParams.get("cursor"),
    sitesCursor: url.searchParams.get("sites_cursor"),
    filesCursor: url.searchParams.get("files_cursor"),
  };
}

export function involvementSql(
  createdCol: string,
  writtenCol: string,
  me: string,
  query: ListQuery,
): { sql: string; binds: string[] } {
  const written = `COALESCE(${writtenCol}, ${createdCol})`;
  const parts: string[] = [];
  const binds: string[] = [];
  if (query.scope === "created") {
    parts.push(`${createdCol} = ?`);
    binds.push(me);
  } else if (query.scope === "edited") {
    parts.push(`${written} = ? AND ${createdCol} != ?`);
    binds.push(me, me);
  } else {
    parts.push(`(${createdCol} = ? OR ${written} = ?)`);
    binds.push(me, me);
  }
  if (query.createdBy) {
    parts.push(`${createdCol} = ?`);
    binds.push(query.createdBy);
  }
  return { sql: parts.join(" AND "), binds };
}

export function likeNeedle(q: string): string | null {
  const cleaned = q.replace(/[%_\\]/g, "").slice(0, 64);
  if (!cleaned) return null;
  return `%${cleaned}%`;
}

export function encodeCursor(parts: string[]): string {
  return parts.map((p) => encodeURIComponent(p)).join("|");
}

export function decodeCursor(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parts = raw.split("|").map((p) => decodeURIComponent(p));
    return parts.length ? parts : null;
  } catch {
    return null;
  }
}

export function siteCursorSql(
  query: ListQuery,
): { sql: string; binds: string[]; order: string } {
  const cursor = decodeCursor(query.cursor ?? query.sitesCursor);
  if (query.sort === "name") {
    if (cursor && cursor[0] === "name" && cursor.length >= 3) {
      const slug = cursor[1]!;
      const handle = cursor[2]!;
      return {
        sql: ` AND (s.slug > ? OR (s.slug = ? AND s.handle > ?))`,
        binds: [slug, slug, handle],
        order: "s.slug ASC, s.handle ASC",
      };
    }
    return { sql: "", binds: [], order: "s.slug ASC, s.handle ASC" };
  }
  if (cursor && cursor[0] === "updated" && cursor.length >= 4) {
    const ts = cursor[1]!;
    const handle = cursor[2]!;
    const slug = cursor[3]!;
    return {
      sql: ` AND (s.updated_at < ? OR (s.updated_at = ? AND (s.handle < ? OR (s.handle = ? AND s.slug < ?))))`,
      binds: [ts, ts, handle, handle, slug],
      order: "s.updated_at DESC, s.handle DESC, s.slug DESC",
    };
  }
  return { sql: "", binds: [], order: "s.updated_at DESC, s.handle DESC, s.slug DESC" };
}

export function fileCursorSql(
  query: ListQuery,
): { sql: string; binds: string[]; order: string } {
  const cursor = decodeCursor(query.cursor ?? query.filesCursor);
  const updated = `COALESCE(updated_at, created_at)`;
  if (query.sort === "name") {
    if (cursor && cursor[0] === "name" && cursor.length >= 3) {
      const name = cursor[1]!;
      const id = cursor[2]!;
      return {
        sql: ` AND (filename > ? OR (filename = ? AND id > ?))`,
        binds: [name, name, id],
        order: "filename ASC, id ASC",
      };
    }
    return { sql: "", binds: [], order: "filename ASC, id ASC" };
  }
  if (cursor && cursor[0] === "updated" && cursor.length >= 3) {
    const ts = cursor[1]!;
    const id = cursor[2]!;
    return {
      sql: ` AND (${updated} < ? OR (${updated} = ? AND id < ?))`,
      binds: [ts, ts, id],
      order: `${updated} DESC, id DESC`,
    };
  }
  return { sql: "", binds: [], order: `${updated} DESC, id DESC` };
}

export function nextSiteCursor(
  sort: ListQuery["sort"],
  last: { slug: string; handle: string; updated_at: string },
): string {
  return sort === "name"
    ? encodeCursor(["name", last.slug, last.handle])
    : encodeCursor(["updated", last.updated_at, last.handle, last.slug]);
}

export function nextFileCursor(
  sort: ListQuery["sort"],
  last: { id: string; filename: string; updated_at: string | null; created_at: string },
): string {
  return sort === "name"
    ? encodeCursor(["name", last.filename, last.id])
    : encodeCursor(["updated", last.updated_at || last.created_at, last.id]);
}

export function takePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  if (rows.length > limit) return { items: rows.slice(0, limit), hasMore: true };
  return { items: rows, hasMore: false };
}
