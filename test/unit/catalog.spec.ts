import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  fileCursorSql,
  involvementSql,
  likeNeedle,
  nextFileCursor,
  parseListQuery,
  takePage,
} from "../../src/catalog";

function q(search: string): ReturnType<typeof parseListQuery> {
  return parseListQuery(new URL(`https://energon.example.com/v1/files${search}`));
}

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

  it("builds the next file cursor from the last row", () => {
    const row = { id: "Ab12Cd", filename: "notes.md", updated_at: null, created_at: "t0" };
    expect(decodeCursor(nextFileCursor("name", row))).toEqual(["name", "notes.md", "Ab12Cd"]);
    expect(decodeCursor(nextFileCursor("updated", row))).toEqual(["updated", "t0", "Ab12Cd"]);
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
