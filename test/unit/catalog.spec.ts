import { describe, expect, it } from "vitest";
import {
  composeClauses,
  criteriaFrom,
  criteriaSql,
  decodeCursor,
  encodeCursor,
  expiryUrgency,
  expiresWithinBefore,
  fileCursorSql,
  involvementSql,
  likeNeedle,
  nextFileCursor,
  nextSiteCursor,
  parseHubListQuery,
  parseListQuery,
  parseSort,
  catalogSearchParams,
  catalogCursorSql,
  nextCatalogCursor,
  NEVER_READ_AT,
  siteCursorSql,
  takePage,
} from "../../src/catalog";

function q(search: string): ReturnType<typeof parseListQuery> {
  return parseListQuery(new URL(`https://energon.example.com/v1/files${search}`));
}

const ME = "ada@esperlabs.app";

describe("parseListQuery", () => {
  it("defaults limit to 25 when the param is missing or empty", () => {
    expect(q("").limit).toBe(25);
    expect(q("?limit=").limit).toBe(25);
    expect(q("?scope=involved").limit).toBe(25);
  });

  it("clamps limit to 1..50", () => {
    expect(q("?limit=0").limit).toBe(1);
    expect(q("?limit=-4").limit).toBe(1);
    expect(q("?limit=999").limit).toBe(50);
    expect(q("?limit=12.8").limit).toBe(13);
  });

  it("normalizes scope, sort, and q", () => {
    expect(q("?scope=created").scope).toBe("created");
    expect(q("?scope=edited").scope).toBe("edited");
    expect(q("?scope=nope").scope).toBe("involved");
    expect(q("?sort=name").sort).toBe("name");
    expect(q("?sort=updated").sort).toBe("updated");
    expect(q("?q=%20Hello%20").q).toBe("hello");
    expect(q("?created_by=Ada@Esperlabs.app").createdBy).toBe("ada@esperlabs.app");
  });

  it("parses the size, age, and last_read sorts and falls back to updated", () => {
    expect(q("?sort=size").sort).toBe("size");
    expect(q("?sort=age").sort).toBe("age");
    expect(q("?sort=last_read").sort).toBe("last_read");
    expect(q("?sort=biggest").sort).toBe("updated");
    expect(q("").sort).toBe("updated");
    expect(parseSort(null)).toBe("updated");
    expect(parseSort("SIZE")).toBe("updated");
    expect(parseSort("LAST_READ")).toBe("updated");
  });

  it("parses changed_since_read=1 and ignores other values", () => {
    expect(q("?changed_since_read=1").changedSinceRead).toBe(true);
    expect(q("?changed_since_read=yes").changedSinceRead).toBeUndefined();
    expect(q("?changed_since_read=0").changedSinceRead).toBeUndefined();
    expect(q("").changedSinceRead).toBeUndefined();
  });

  it("parses expires=never and expires_before as an ISO instant", () => {
    expect(q("?expires=never").expires).toEqual({ kind: "never" });
    expect(q("?expires=NEVER").expires).toEqual({ kind: "never" });
    expect(q("?expires_before=2026-01-01").expires).toEqual({ kind: "before", at: "2026-01-01T00:00:00.000Z" });
    expect(q("?expires_before=2026-01-01T12%3A30%3A00%2B02%3A00").expires).toEqual({
      kind: "before",
      at: "2026-01-01T10:30:00.000Z",
    });
    expect(q("").expires).toBeUndefined();
  });

  it("parses expires_within=24h|7d and ignores malformed windows", () => {
    expect(q("?expires_within=24h").expires).toEqual({ kind: "within", window: "24h" });
    expect(q("?expires_within=7d").expires).toEqual({ kind: "within", window: "7d" });
    expect(q("?expires_within=24H").expires).toEqual({ kind: "within", window: "24h" });
    expect(q("?expires_within=7D").expires).toEqual({ kind: "within", window: "7d" });
    expect(q("?expires_within=1d").expires).toBeUndefined();
    expect(q("?expires_within=soon").expires).toBeUndefined();
    expect(q("?expires_within=30m").expires).toBeUndefined();
  });

  it("prefers expires_before over expires_within", () => {
    expect(q("?expires_within=24h&expires_before=2026-01-01").expires).toEqual({
      kind: "before",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("omits both expiry filters when expires=never is paired with expires_within", () => {
    expect(q("?expires=never&expires_within=24h").expires).toBeUndefined();
  });

  it("parses updated_before and min_size (byte sizes via parseByteSize)", () => {
    expect(q("?updated_before=2026-03-01T00:00:00Z").updatedBefore).toBe("2026-03-01T00:00:00.000Z");
    expect(q("?min_size=500mb").minSize).toBe(500 * 1024 * 1024);
    expect(q("?min_size=1000000").minSize).toBe(1_000_000);
    expect(q("?min_size=2.5kb").minSize).toBe(2560);
    expect(q("").updatedBefore).toBeUndefined();
    expect(q("").minSize).toBeUndefined();
  });

  it("drops malformed filters instead of failing the hub page", () => {
    const bad = q("?expires=soon&updated_before=yesterday&min_size=lots&sort=name");
    expect(bad.expires).toBeUndefined();
    expect(bad.updatedBefore).toBeUndefined();
    expect(bad.minSize).toBeUndefined();
    expect(bad.sort).toBe("name");
    expect(q("?expires_before=not-a-date").expires).toBeUndefined();
    expect(q("?expires_within=soon").expires).toBeUndefined();
    expect(q("?min_size=0").minSize).toBeUndefined();
    expect(q("?min_size=-5").minSize).toBeUndefined();
  });

  it("round-trips catalog list filters through catalogSearchParams", () => {
    const params = catalogSearchParams({
      q: "notes",
      scope: "created",
      sort: "last_read",
      expires: { kind: "never" },
      updatedBefore: "2026-03-01T00:00:00.000Z",
      lastReadBefore: "2026-01-01T00:00:00.000Z",
      changedSinceRead: true,
      minSize: "1mb",
    });
    expect(params.get("q")).toBe("notes");
    expect(params.get("scope")).toBe("created");
    expect(params.get("sort")).toBe("last_read");
    expect(params.get("expires")).toBe("never");
    expect(params.get("expires_before")).toBeNull();
    expect(params.get("updated_before")).toBe("2026-03-01T00:00:00.000Z");
    expect(params.get("last_read_before")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("changed_since_read")).toBe("1");
    expect(params.get("min_size")).toBe("1mb");
    const parsed = parseListQuery(new URL(`https://energon.example.com/?${params}`));
    expect(parsed.q).toBe("notes");
    expect(parsed.scope).toBe("created");
    expect(parsed.sort).toBe("last_read");
    expect(parsed.expires).toEqual({ kind: "never" });
    expect(parsed.updatedBefore).toBe("2026-03-01T00:00:00.000Z");
    expect(parsed.lastReadBefore).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.changedSinceRead).toBe(true);
    expect(parsed.minSize).toBe(1024 * 1024);
  });

  it("hub list query drops last_read_before and keeps changed_since_read", () => {
    const url = new URL(
      "https://energon.example.com/?expires=never&last_read_before=2026-01-01T00:00:00.000Z&changed_since_read=1",
    );
    expect(parseListQuery(url).lastReadBefore).toBe("2026-01-01T00:00:00.000Z");
    expect(parseListQuery(url).changedSinceRead).toBe(true);
    const hub = parseHubListQuery(url);
    expect(hub.expires).toEqual({ kind: "never" });
    expect(hub.lastReadBefore).toBeUndefined();
    expect(hub.changedSinceRead).toBe(true);
  });

  it("sends expires_before only when expiry is a cutoff, not never", () => {
    const before = catalogSearchParams({
      q: "",
      scope: "involved",
      sort: "age",
      expires: { kind: "before", at: "2026-06-01T00:00:00.000Z" },
    });
    expect(before.get("expires")).toBeNull();
    expect(before.get("expires_before")).toBe("2026-06-01T00:00:00.000Z");
    expect(before.get("sort")).toBe("age");
    const within = catalogSearchParams({
      q: "",
      scope: "involved",
      sort: "updated",
      expires: { kind: "within", window: "24h" },
    });
    expect(within.get("expires")).toBeNull();
    expect(within.get("expires_before")).toBeNull();
    expect(within.get("expires_within")).toBe("24h");
  });

  it("omits both expiry filters when expires and expires_before are both present", () => {
    expect(q("?expires=never&expires_before=2026-01-01").expires).toBeUndefined();
  });

  it("keeps the first value when a filter is repeated", () => {
    expect(q("?min_size=1kb&min_size=lots").minSize).toBe(1024);
  });
});

describe("criteriaFrom", () => {
  it("reports every malformed key so the cleanup body can 400", () => {
    const parsed = criteriaFrom({
      scope: "everyone",
      expires: "soon",
      expires_before: "yesterday",
      updated_before: 42,
      min_size: "lots",
    });
    expect(parsed.malformed.sort()).toEqual(["expires", "expires_before", "min_size", "scope", "updated_before"]);
    expect(parsed.criteria).toEqual({ scope: "involved", q: "" });
  });

  it("accepts a numeric min_size from JSON", () => {
    expect(criteriaFrom({ min_size: 4096 })).toEqual({ criteria: { scope: "involved", q: "", minSize: 4096 }, malformed: [] });
  });

  it("flags both expiry keys when they conflict", () => {
    const parsed = criteriaFrom({ expires: "never", expires_before: "2026-01-01" });
    expect(parsed.criteria.expires).toBeUndefined();
    expect(parsed.malformed).toEqual(["expires", "expires_before"]);
  });

  it("flags expires=never paired with expires_within", () => {
    const parsed = criteriaFrom({ expires: "never", expires_within: "24h" });
    expect(parsed.criteria.expires).toBeUndefined();
    expect(parsed.malformed).toEqual(["expires", "expires_within"]);
  });

  it("reports malformed expires_within so cleanup can 400", () => {
    expect(criteriaFrom({ expires_within: "soon" })).toEqual({
      criteria: { scope: "involved", q: "" },
      malformed: ["expires_within"],
    });
  });
});

describe("criteriaSql", () => {
  it("keeps the involvement predicate first and unchanged", () => {
    const sql = criteriaSql("files", q(""), ME);
    expect(sql.where).toBe("(created_by = ? OR COALESCE(last_written_by, created_by) = ?)");
    expect(sql.whereBinds).toEqual([ME, ME]);
    expect(sql.having).toBe("");
    expect(sql.havingBinds).toEqual([]);
  });

  it("omits involvement for admin selection and adds owner plus last_read_before", () => {
    const sql = criteriaSql(
      "files",
      { scope: "involved", q: "", owner: "ada", lastReadBefore: "2026-01-01T00:00:00.000Z" },
      ME,
      undefined,
      { involve: false },
    );
    expect(sql.where).toBe("handle = ? AND (last_read_at IS NULL OR last_read_at < ?)");
    expect(sql.whereBinds).toEqual(["ada", "2026-01-01T00:00:00.000Z"]);
  });

  it("puts file filters in WHERE", () => {
    const sql = criteriaSql("files", q("?q=notes&expires=never&updated_before=2026-01-01&min_size=1kb"), ME, "u-ada");
    expect(sql.where).toBe(
      "(owner_id = ? OR COALESCE(last_written_by, created_by) = ?) AND filename LIKE ? AND expires_at IS NULL AND COALESCE(updated_at, created_at) < ? AND size >= ?",
    );
    expect(sql.whereBinds).toEqual(["u-ada", ME, "%notes%", "2026-01-01T00:00:00.000Z", 1024]);
    expect(sql.having).toBe("");
  });

  it("puts the site size floor in HAVING and the rest in WHERE", () => {
    const sql = criteriaSql("sites", q("?expires_before=2026-06-01&min_size=500mb"), ME);
    expect(sql.where).toBe("(s.created_by = ? OR COALESCE(s.last_written_by, s.created_by) = ?) AND s.expires_at < ?");
    expect(sql.whereBinds).toEqual([ME, ME, "2026-06-01T00:00:00.000Z"]);
    expect(sql.having).toBe("COALESCE(SUM(f.size), 0) >= ?");
    expect(sql.havingBinds).toEqual([500 * 1024 * 1024]);
  });

  it("expands expires_within to expires_before at request time", () => {
    const now = Date.parse("2026-09-16T00:00:00.000Z");
    const day = criteriaSql("files", q("?expires_within=24h"), ME, undefined, { now });
    expect(day.where).toBe("(created_by = ? OR COALESCE(last_written_by, created_by) = ?) AND expires_at < ?");
    expect(day.whereBinds).toEqual([ME, ME, "2026-09-17T00:00:00.000Z"]);
    expect(expiresWithinBefore("24h", now)).toBe("2026-09-17T00:00:00.000Z");
    const week = criteriaSql("files", q("?expires_within=7d"), ME, undefined, { now });
    expect(week.whereBinds).toEqual([ME, ME, "2026-09-23T00:00:00.000Z"]);
  });

  it("filters changed_since_read with COALESCE never-read and does not bind a timestamp", () => {
    const files = criteriaSql("files", q("?changed_since_read=1"), ME);
    expect(files.where).toBe(
      `(created_by = ? OR COALESCE(last_written_by, created_by) = ?) AND COALESCE(updated_at, created_at) > COALESCE(last_read_at, '${NEVER_READ_AT}')`,
    );
    expect(files.whereBinds).toEqual([ME, ME]);
    const sites = criteriaSql("sites", q("?changed_since_read=1"), ME);
    expect(sites.where).toBe(
      `(s.created_by = ? OR COALESCE(s.last_written_by, s.created_by) = ?) AND s.updated_at > COALESCE(s.last_read_at, '${NEVER_READ_AT}')`,
    );
  });
});

describe("list helpers", () => {
  it("round-trips cursors that contain reserved characters", () => {
    const raw = encodeCursor(["updated", "2026-08-27T00:00:00.000Z", "ada|2", "my slug"]);
    expect(decodeCursor(raw)).toEqual(["updated", "2026-08-27T00:00:00.000Z", "ada|2", "my slug"]);
  });

  it("treats junk cursors as a first page", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("%")).toBeNull();
    const sql = fileCursorSql({ ...q("?sort=name"), cursor: "not-a-cursor" });
    expect(sql.sql).toBe("");
    expect(sql.order).toBe("filename ASC, id ASC");
  });

  it("reads the documented sites_cursor and files_cursor aliases when cursor is absent", () => {
    const fileCursor = nextFileCursor("name", { id: "Ab12Cd", filename: "notes.md", updated_at: null, created_at: "t0", size: 3 });
    const viaAlias = fileCursorSql(q(`?sort=name&files_cursor=${encodeURIComponent(fileCursor)}`));
    expect(viaAlias.sql).toBe(fileCursorSql({ ...q("?sort=name"), cursor: fileCursor }).sql);
    expect(viaAlias.binds).toEqual(["notes.md", "notes.md", "Ab12Cd"]);
    const siteCursor = nextSiteCursor("name", { id: "Ab12Cd", slug: "notes", handle: "ada", updated_at: "t0", size: 3 });
    expect(siteCursorSql(q(`?sort=name&sites_cursor=${encodeURIComponent(siteCursor)}`)).sql).not.toBe("");
    expect(fileCursorSql(q(`?sort=name&cursor=junk&files_cursor=${encodeURIComponent(fileCursor)}`)).sql).toBe("");
  });

  it("ignores a cursor minted under another sort", () => {
    const cursor = nextFileCursor("name", { id: "Ab12Cd", filename: "notes.md", updated_at: null, created_at: "t0", size: 3 });
    expect(fileCursorSql({ ...q("?sort=size"), cursor }).sql).toBe("");
  });

  it("builds the next file cursor from the last row", () => {
    const row = { id: "Ab12Cd", filename: "notes.md", updated_at: null, created_at: "t0", size: 3 };
    expect(decodeCursor(nextFileCursor("name", row))).toEqual(["name", "notes.md", "Ab12Cd"]);
    expect(decodeCursor(nextFileCursor("updated", row))).toEqual(["updated", "t0", "Ab12Cd"]);
    expect(decodeCursor(nextFileCursor("size", row))).toEqual(["size", "3", "Ab12Cd"]);
    expect(decodeCursor(nextFileCursor("age", row))).toEqual(["age", "t0", "Ab12Cd"]);
    expect(decodeCursor(nextFileCursor("last_read", row))).toEqual(["last_read", NEVER_READ_AT, "Ab12Cd"]);
  });

  it("orders size largest first and pages with a numeric keyset", () => {
    const first = fileCursorSql(q("?sort=size"));
    expect(first.order).toBe("size DESC, id DESC");
    expect(first.clause).toBe("where");
    const cursor = nextFileCursor("size", { id: "Ab12Cd", filename: "a", updated_at: null, created_at: "t0", size: 2048 });
    const next = fileCursorSql({ ...q("?sort=size"), cursor });
    expect(next.sql).toBe("(size < ? OR (size = ? AND id < ?))");
    expect(next.binds).toEqual([2048, 2048, "Ab12Cd"]);
  });

  it("orders age oldest first", () => {
    const first = fileCursorSql(q("?sort=age"));
    expect(first.order).toBe("COALESCE(updated_at, created_at) ASC, id ASC");
    const cursor = nextFileCursor("age", { id: "Ab12Cd", filename: "a", updated_at: "t1", created_at: "t0", size: 1 });
    const next = fileCursorSql({ ...q("?sort=age"), cursor });
    expect(next.sql).toBe("(COALESCE(updated_at, created_at) > ? OR (COALESCE(updated_at, created_at) = ? AND id > ?))");
    expect(next.binds).toEqual(["t1", "t1", "Ab12Cd"]);
  });

  it("orders last_read never-read first and pages with the epoch sentinel", () => {
    const first = fileCursorSql(q("?sort=last_read"));
    expect(first.order).toBe(`COALESCE(last_read_at, '${NEVER_READ_AT}') ASC, id ASC`);
    const unread = { id: "Ab12Cd", filename: "a", updated_at: "t1", created_at: "t0", size: 1, last_read_at: null };
    expect(decodeCursor(nextFileCursor("last_read", unread))).toEqual(["last_read", NEVER_READ_AT, "Ab12Cd"]);
    const nextUnread = fileCursorSql({ ...q("?sort=last_read"), cursor: nextFileCursor("last_read", unread) });
    expect(nextUnread.sql).toBe(
      `(COALESCE(last_read_at, '${NEVER_READ_AT}') > ? OR (COALESCE(last_read_at, '${NEVER_READ_AT}') = ? AND id > ?))`,
    );
    expect(nextUnread.binds).toEqual([NEVER_READ_AT, NEVER_READ_AT, "Ab12Cd"]);
    const stamped = nextFileCursor("last_read", { ...unread, last_read_at: "2026-02-01T00:00:00.000Z" });
    expect(decodeCursor(stamped)).toEqual(["last_read", "2026-02-01T00:00:00.000Z", "Ab12Cd"]);
    expect(siteCursorSql(q("?sort=last_read")).order).toBe(`COALESCE(s.last_read_at, '${NEVER_READ_AT}') ASC, s.id ASC`);
    const hub = catalogCursorSql(q("?sort=last_read"));
    expect(hub.order).toBe(`COALESCE(u.last_read_at, '${NEVER_READ_AT}') ASC, u.kind ASC, u.id ASC`);
    const hubCursor = nextCatalogCursor("last_read", {
      kind: "file",
      id: "Ab12Cd",
      name: "a",
      sort_updated: "t1",
      size: 1,
      last_read_at: null,
    });
    expect(decodeCursor(hubCursor)).toEqual(["last_read", NEVER_READ_AT, "file", "Ab12Cd"]);
  });

  it("keeps the site size keyset in HAVING and ties on id so duplicate slugs do not collapse", () => {
    const first = siteCursorSql(q("?sort=size"));
    expect(first.order).toBe("COALESCE(SUM(f.size), 0) DESC, s.id DESC");
    expect(first.clause).toBe("having");
    const cursor = nextSiteCursor("size", { id: "Ab12Cd", slug: "notes", handle: "ada", updated_at: "t0", size: 10 });
    const next = siteCursorSql({ ...q("?sort=size"), cursor });
    expect(next.clause).toBe("having");
    expect(next.sql).toBe("(COALESCE(SUM(f.size), 0) < ? OR (COALESCE(SUM(f.size), 0) = ? AND s.id < ?))");
    expect(next.binds).toEqual([10, 10, "Ab12Cd"]);
    const twin = nextSiteCursor("size", { id: "Ef34Gh", slug: "notes", handle: "ada", updated_at: "t0", size: 10 });
    expect(twin).not.toBe(cursor);
    expect(siteCursorSql(q("?sort=age")).order).toBe("s.updated_at ASC, s.id ASC");
    expect(siteCursorSql(q("")).order).toBe("s.updated_at DESC, s.id DESC");
  });

  it("rejects a size cursor whose lead is not a number", () => {
    const cursor = encodeCursor(["size", "big", "Ab12Cd"]);
    expect(fileCursorSql({ ...q("?sort=size"), cursor }).sql).toBe("");
  });

  it("composes WHERE before HAVING and binds in statement order", () => {
    const criteria = criteriaSql("sites", q("?min_size=1kb"), ME);
    const cursor = siteCursorSql({
      ...q("?sort=size"),
      cursor: nextSiteCursor("size", { id: "Ab12Cd", slug: "b", handle: "ada", updated_at: "t0", size: 5 }),
    });
    const composed = composeClauses(criteria, cursor);
    expect(composed.where).toBe(criteria.where);
    expect(composed.having).toBe(`COALESCE(SUM(f.size), 0) >= ? AND ${cursor.sql}`);
    expect(composed.binds).toEqual([ME, ME, 1024, 5, 5, "Ab12Cd"]);
    const plain = composeClauses(criteriaSql("files", q(""), ME), fileCursorSql(q("")));
    expect(plain.having).toBe("");
    expect(plain.binds).toEqual([ME, ME]);
  });

  it("strips LIKE wildcards so search cannot widen the involved set", () => {
    expect(likeNeedle("gamma")).toBe("%gamma%");
    expect(likeNeedle("%gamma_")).toBe("%gamma%");
    expect(likeNeedle("%%%")).toBeNull();
  });

  it("scopes involvement to the caller", () => {
    const me = "ada@esperlabs.app";
    expect(involvementSql("created_by", "last_written_by", me, q(""))).toEqual({
      sql: "(created_by = ? OR COALESCE(last_written_by, created_by) = ?)",
      binds: [me, me],
    });
    expect(involvementSql("created_by", "last_written_by", me, q("?scope=created"))).toEqual({
      sql: "created_by = ?",
      binds: [me],
    });
    expect(involvementSql("created_by", "last_written_by", me, q("?scope=edited"))).toEqual({
      sql: "COALESCE(last_written_by, created_by) = ? AND created_by != ?",
      binds: [me, me],
    });
    expect(involvementSql("created_by", "last_written_by", me, q(""), { col: "owner_id", id: "u-ada" })).toEqual({
      sql: "(owner_id = ? OR COALESCE(last_written_by, created_by) = ?)",
      binds: ["u-ada", me],
    });
    expect(involvementSql("created_by", "last_written_by", me, q("?scope=created"), { col: "owner_id", id: "u-ada" })).toEqual({
      sql: "owner_id = ?",
      binds: ["u-ada"],
    });
    expect(involvementSql("created_by", "last_written_by", me, q("?scope=edited"), { col: "owner_id", id: "u-ada" })).toEqual({
      sql: "COALESCE(last_written_by, created_by) = ? AND owner_id != ?",
      binds: [me, "u-ada"],
    });
  });

  it("takePage leaves a cursor when one extra row was fetched", () => {
    expect(takePage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(takePage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});

describe("expiryUrgency", () => {
  const now = Date.parse("2026-09-16T00:00:00.000Z");

  it("uses danger within 24h, warn within 7d, and ttl otherwise", () => {
    expect(expiryUrgency(new Date(now + 12 * 3600_000).toISOString(), now)).toBe("danger");
    expect(expiryUrgency(new Date(now + 24 * 3600_000).toISOString(), now)).toBe("danger");
    expect(expiryUrgency(new Date(now + 24 * 3600_000 + 1).toISOString(), now)).toBe("warn");
    expect(expiryUrgency(new Date(now + 3 * 86400_000).toISOString(), now)).toBe("warn");
    expect(expiryUrgency(new Date(now + 7 * 86400_000).toISOString(), now)).toBe("warn");
    expect(expiryUrgency(new Date(now + 7 * 86400_000 + 1).toISOString(), now)).toBe("ttl");
    expect(expiryUrgency(new Date(now + 14 * 86400_000).toISOString(), now)).toBe("ttl");
    expect(expiryUrgency(new Date(now - 1000).toISOString(), now)).toBe("danger");
    expect(expiryUrgency(null, now)).toBeNull();
    expect(expiryUrgency("not-a-date", now)).toBeNull();
  });
});
