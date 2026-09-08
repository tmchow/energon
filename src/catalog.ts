import { parseByteSize } from "./policy";

export type ListScope = "involved" | "created" | "edited";
export type CatalogSort = "updated" | "name" | "size" | "age";
export type CatalogKind = "sites" | "files";

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 50;

export type ExpiresFilter = { kind: "never" } | { kind: "before"; at: string };

export type SelectionCriteria = {
  scope: ListScope;
  q: string;
  createdBy?: string;
  expires?: ExpiresFilter;
  updatedBefore?: string;
  minSize?: number;
  owner?: string;
  lastReadBefore?: string;
};

export type ListPresentation = {
  sort: CatalogSort;
  limit: number;
  cursor: string | null;
  sitesCursor: string | null;
  filesCursor: string | null;
};

export type ListQuery = SelectionCriteria & ListPresentation;

export type ListPage<T> = {
  items: T[];
  total: number;
  next_cursor: string | null;
};

export const CRITERIA_KEYS = ["scope", "q", "created_by", "expires", "expires_before", "updated_before", "min_size", "owner", "last_read_before"] as const;
export type CriteriaKey = (typeof CRITERIA_KEYS)[number];

export type ParsedCriteria = { criteria: SelectionCriteria; malformed: CriteriaKey[] };

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant ${String(value)}`);
}

/** undefined: absent or blank. null: present but not text. */
function textValue(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? undefined : value;
}

function isoTimestamp(raw: string): string | null {
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function scopeFrom(raw: string | undefined, malformed: CriteriaKey[]): ListScope {
  const scope = raw?.toLowerCase();
  if (scope === undefined) return "involved";
  if (scope === "created" || scope === "edited" || scope === "involved") return scope;
  malformed.push("scope");
  return "involved";
}

function timestampFrom(raw: string | undefined, key: CriteriaKey, malformed: CriteriaKey[]): string | undefined {
  if (raw === undefined) return undefined;
  const iso = isoTimestamp(raw);
  if (iso === null) malformed.push(key);
  return iso ?? undefined;
}

function expiresFrom(neverRaw: string | undefined, beforeRaw: string | undefined, malformed: CriteriaKey[]): ExpiresFilter | undefined {
  const never = neverRaw === undefined ? undefined : neverRaw.toLowerCase() === "never";
  if (never === false) malformed.push("expires");
  const before = timestampFrom(beforeRaw, "expires_before", malformed);
  if (never && before) {
    malformed.push("expires", "expires_before");
    return undefined;
  }
  if (never) return { kind: "never" };
  return before ? { kind: "before", at: before } : undefined;
}

function sizeFrom(raw: string | undefined, malformed: CriteriaKey[]): number | undefined {
  if (raw === undefined) return undefined;
  const size = parseByteSize(raw);
  if (size === null) malformed.push("min_size");
  return size ?? undefined;
}

/**
 * One parser for the URL list query and the JSON cleanup target. It never throws;
 * the caller decides whether `malformed` keys are dropped (hub URL) or a 400 (cleanup).
 */
export function criteriaFrom(input: Record<string, unknown>): ParsedCriteria {
  const malformed: CriteriaKey[] = [];
  const read = (key: CriteriaKey): string | undefined => {
    const value = textValue(input[key]);
    if (value === null) {
      malformed.push(key);
      return undefined;
    }
    return value;
  };
  const criteria: SelectionCriteria = { scope: scopeFrom(read("scope"), malformed), q: read("q")?.toLowerCase() ?? "" };
  const createdBy = read("created_by")?.toLowerCase();
  if (createdBy) criteria.createdBy = createdBy;
  const owner = read("owner")?.toLowerCase();
  if (owner) criteria.owner = owner;
  const expires = expiresFrom(read("expires"), read("expires_before"), malformed);
  if (expires) criteria.expires = expires;
  const updatedBefore = timestampFrom(read("updated_before"), "updated_before", malformed);
  if (updatedBefore) criteria.updatedBefore = updatedBefore;
  const lastReadBefore = timestampFrom(read("last_read_before"), "last_read_before", malformed);
  if (lastReadBefore) criteria.lastReadBefore = lastReadBefore;
  const minSize = sizeFrom(typeof input.min_size === "number" ? String(input.min_size) : read("min_size"), malformed);
  if (minSize !== undefined) criteria.minSize = minSize;
  return { criteria, malformed };
}

export function parseSort(raw: string | null | undefined): CatalogSort {
  switch (raw) {
    case "name":
    case "size":
    case "age":
      return raw;
    default:
      return "updated";
  }
}

function searchRecord(url: URL): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of CRITERIA_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) record[key] = value;
  }
  return record;
}

export function parseListQuery(url: URL): ListQuery {
  const { criteria } = criteriaFrom(searchRecord(url));
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit == null || rawLimit === "" ? NaN : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.round(parsedLimit)))
    : DEFAULT_LIST_LIMIT;
  return {
    ...criteria,
    sort: parseSort(url.searchParams.get("sort")),
    limit,
    cursor: url.searchParams.get("cursor"),
    sitesCursor: url.searchParams.get("sites_cursor"),
    filesCursor: url.searchParams.get("files_cursor"),
  };
}

/** Canonical catalog filter query string. Keep keys aligned with `parseListQuery`. */
export function catalogSearchParams(input: {
  q: string;
  scope: ListScope;
  sort: CatalogSort;
  expires?: ExpiresFilter;
  updatedBefore?: string;
  lastReadBefore?: string;
  minSize?: string;
  sitesCursor?: string | null;
  filesCursor?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams({ q: input.q.trim(), scope: input.scope, sort: input.sort });
  if (input.expires?.kind === "never") params.set("expires", "never");
  else if (input.expires?.kind === "before") params.set("expires_before", input.expires.at);
  if (input.updatedBefore) params.set("updated_before", input.updatedBefore);
  if (input.lastReadBefore) params.set("last_read_before", input.lastReadBefore);
  if (input.minSize) params.set("min_size", input.minSize);
  if (input.sitesCursor) params.set("sites_cursor", input.sitesCursor);
  if (input.filesCursor) params.set("files_cursor", input.filesCursor);
  return params;
}

export function involvementSql(
  createdCol: string,
  writtenCol: string,
  me: string,
  query: Pick<SelectionCriteria, "scope" | "createdBy">,
  owner?: { col: string; id: string },
): { sql: string; binds: string[] } {
  const written = `COALESCE(${writtenCol}, ${createdCol})`;
  const parts: string[] = [];
  const binds: string[] = [];
  if (owner) {
    if (query.scope === "created") {
      parts.push(`${owner.col} = ?`);
      binds.push(owner.id);
    } else if (query.scope === "edited") {
      parts.push(`${written} = ? AND ${owner.col} != ?`);
      binds.push(me, owner.id);
    } else {
      parts.push(`(${owner.col} = ? OR ${written} = ?)`);
      binds.push(owner.id, me);
    }
  } else if (query.scope === "created") {
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

export const SITE_SIZE_SQL = "COALESCE(SUM(f.size), 0)";
const FILE_UPDATED_SQL = "COALESCE(updated_at, created_at)";

type Columns = {
  created: string;
  written: string;
  owner: string;
  handle: string;
  name: string;
  updated: string;
  expires: string;
  lastRead: string;
  size: string;
  sizeClause: "where" | "having";
};

/** Site size is an aggregate over site_files, so its predicates go in HAVING. */
const COLUMNS: Record<CatalogKind, Columns> = {
  sites: {
    created: "s.created_by",
    written: "s.last_written_by",
    owner: "s.owner_id",
    handle: "s.handle",
    name: "s.slug",
    updated: "s.updated_at",
    expires: "s.expires_at",
    lastRead: "s.last_read_at",
    size: SITE_SIZE_SQL,
    sizeClause: "having",
  },
  files: {
    created: "created_by",
    written: "last_written_by",
    owner: "owner_id",
    handle: "handle",
    name: "filename",
    updated: FILE_UPDATED_SQL,
    expires: "expires_at",
    lastRead: "last_read_at",
    size: "size",
    sizeClause: "where",
  },
};

export type CriteriaSql = { where: string; whereBinds: unknown[]; having: string; havingBinds: unknown[] };

function expiresPredicate(col: string, filter: ExpiresFilter): { sql: string; binds: unknown[] } {
  switch (filter.kind) {
    case "never":
      return { sql: `${col} IS NULL`, binds: [] };
    case "before":
      return { sql: `${col} < ?`, binds: [filter.at] };
    default:
      return assertNever(filter);
  }
}

export function criteriaSql(
  kind: CatalogKind,
  criteria: SelectionCriteria,
  me: string,
  ownerId?: string,
  opts?: { involve?: boolean },
): CriteriaSql {
  const cols = COLUMNS[kind];
  const where: string[] = [];
  const whereBinds: unknown[] = [];
  if (opts?.involve !== false) {
    const involvement = involvementSql(cols.created, cols.written, me, criteria, ownerId ? { col: cols.owner, id: ownerId } : undefined);
    where.push(involvement.sql);
    whereBinds.push(...involvement.binds);
  }
  const having: string[] = [];
  const havingBinds: unknown[] = [];
  const needle = likeNeedle(criteria.q);
  if (needle) {
    where.push(`${cols.name} LIKE ?`);
    whereBinds.push(needle);
  }
  if (criteria.createdBy && opts?.involve === false) {
    where.push(`${cols.created} = ?`);
    whereBinds.push(criteria.createdBy);
  }
  if (criteria.owner) {
    where.push(`${cols.handle} = ?`);
    whereBinds.push(criteria.owner);
  }
  if (criteria.expires) {
    const expires = expiresPredicate(cols.expires, criteria.expires);
    where.push(expires.sql);
    whereBinds.push(...expires.binds);
  }
  if (criteria.updatedBefore !== undefined) {
    where.push(`${cols.updated} < ?`);
    whereBinds.push(criteria.updatedBefore);
  }
  if (criteria.lastReadBefore !== undefined) {
    where.push(`(${cols.lastRead} IS NULL OR ${cols.lastRead} < ?)`);
    whereBinds.push(criteria.lastReadBefore);
  }
  if (criteria.minSize !== undefined) {
    const clause = cols.sizeClause === "having" ? having : where;
    const binds = cols.sizeClause === "having" ? havingBinds : whereBinds;
    clause.push(`${cols.size} >= ?`);
    binds.push(criteria.minSize);
  }
  return { where: where.join(" AND ") || "1 = 1", whereBinds, having: having.join(" AND "), havingBinds };
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

type SortSpec<Row> = {
  exprs: string[];
  dir: "ASC" | "DESC";
  clause: "where" | "having";
  lead: "text" | "number";
  values: (row: Row) => string[];
};

export type SiteCursorRow = { id: string; slug: string; handle: string; updated_at: string; size: number };
export type FileCursorRow = { id: string; filename: string; updated_at: string | null; created_at: string; size: number };

function siteSort(sort: CatalogSort): SortSpec<SiteCursorRow> {
  switch (sort) {
    case "updated":
      return { exprs: ["s.updated_at", "s.id"], dir: "DESC", clause: "where", lead: "text", values: (r) => [r.updated_at, r.id] };
    case "name":
      return { exprs: ["s.slug", "s.id"], dir: "ASC", clause: "where", lead: "text", values: (r) => [r.slug, r.id] };
    case "size":
      return { exprs: [SITE_SIZE_SQL, "s.id"], dir: "DESC", clause: "having", lead: "number", values: (r) => [String(r.size), r.id] };
    case "age":
      return { exprs: ["s.updated_at", "s.id"], dir: "ASC", clause: "where", lead: "text", values: (r) => [r.updated_at, r.id] };
    default:
      return assertNever(sort);
  }
}

function fileSort(sort: CatalogSort): SortSpec<FileCursorRow> {
  switch (sort) {
    case "updated":
      return { exprs: [FILE_UPDATED_SQL, "id"], dir: "DESC", clause: "where", lead: "text", values: (r) => [r.updated_at || r.created_at, r.id] };
    case "name":
      return { exprs: ["filename", "id"], dir: "ASC", clause: "where", lead: "text", values: (r) => [r.filename, r.id] };
    case "size":
      return { exprs: ["size", "id"], dir: "DESC", clause: "where", lead: "number", values: (r) => [String(r.size), r.id] };
    case "age":
      return { exprs: [FILE_UPDATED_SQL, "id"], dir: "ASC", clause: "where", lead: "text", values: (r) => [r.updated_at || r.created_at, r.id] };
    default:
      return assertNever(sort);
  }
}

/** `(a < ? OR (a = ? AND (b < ? OR (b = ? AND c < ?))))` over the sort keys in order. */
function keysetSql(exprs: string[], op: "<" | ">", values: unknown[]): { sql: string; binds: unknown[] } {
  const [expr, ...rest] = exprs;
  const [value, ...restValues] = values;
  if (rest.length === 0) return { sql: `${expr} ${op} ?`, binds: [value] };
  const tail = keysetSql(rest, op, restValues);
  return { sql: `(${expr} ${op} ? OR (${expr} = ? AND ${tail.sql}))`, binds: [value, value, ...tail.binds] };
}

export type CursorSql = { sql: string; binds: unknown[]; order: string; clause: "where" | "having" };

function cursorSql<Row>(spec: SortSpec<Row>, sort: CatalogSort, raw: string | null): CursorSql {
  const order = spec.exprs.map((expr) => `${expr} ${spec.dir}`).join(", ");
  const firstPage: CursorSql = { sql: "", binds: [], order, clause: spec.clause };
  const parts = decodeCursor(raw);
  if (!parts || parts[0] !== sort || parts.length < spec.exprs.length + 1) return firstPage;
  const values: unknown[] = parts.slice(1, spec.exprs.length + 1);
  if (spec.lead === "number") {
    const lead = Number(values[0]);
    if (!Number.isFinite(lead)) return firstPage;
    values[0] = lead;
  }
  const keyset = keysetSql(spec.exprs, spec.dir === "ASC" ? ">" : "<", values);
  return { sql: keyset.sql, binds: keyset.binds, order, clause: spec.clause };
}

export function siteCursorSql(query: ListQuery): CursorSql {
  return cursorSql(siteSort(query.sort), query.sort, query.cursor ?? query.sitesCursor);
}

export function fileCursorSql(query: ListQuery): CursorSql {
  return cursorSql(fileSort(query.sort), query.sort, query.cursor ?? query.filesCursor);
}

export function nextSiteCursor(sort: CatalogSort, last: SiteCursorRow): string {
  return encodeCursor([sort, ...siteSort(sort).values(last)]);
}

export function nextFileCursor(sort: CatalogSort, last: FileCursorRow): string {
  return encodeCursor([sort, ...fileSort(sort).values(last)]);
}

/** WHERE binds precede HAVING binds because that is the order the statement reads them. */
export function composeClauses(criteria: CriteriaSql, cursor: CursorSql): { where: string; having: string; binds: unknown[] } {
  const where = [criteria.where];
  const having = [criteria.having];
  const whereBinds = [...criteria.whereBinds];
  const havingBinds = [...criteria.havingBinds];
  if (cursor.sql && cursor.clause === "where") {
    where.push(cursor.sql);
    whereBinds.push(...cursor.binds);
  } else if (cursor.sql) {
    having.push(cursor.sql);
    havingBinds.push(...cursor.binds);
  }
  return {
    where: where.filter(Boolean).join(" AND "),
    having: having.filter(Boolean).join(" AND "),
    binds: [...whereBinds, ...havingBinds],
  };
}

export function takePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  if (rows.length > limit) return { items: rows.slice(0, limit), hasMore: true };
  return { items: rows, hasMore: false };
}
