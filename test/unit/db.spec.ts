import { describe, expect, it } from "vitest";
import { ensureSchema } from "../../src/db";

const LEGACY_0005_COLUMNS = {
  sites: ["handle", "slug", "created_at", "updated_at", "created_by", "last_written_by", "password_hash"],
  site_files: ["handle", "slug", "path", "size", "content_type", "updated_at", "last_written_by"],
  loose_files: ["id", "filename", "size", "content_type", "created_at", "created_by", "handle"],
  tokens: ["id", "user_email", "label", "token_hash", "token_secret", "created_at", "last_used_at", "revoked_at"],
};

class SchemaDb {
  readonly tables = new Map(Object.entries(LEGACY_0005_COLUMNS).map(([name, columns]) => [name, new Set(columns)]));
  readonly indexes = new Set<string>();

  prepare(sql: string) {
    return {
      first: async () => ({ name: "tokens" }),
      all: async () => {
        const table = sql.match(/^PRAGMA table_info\((\w+)\)/)?.[1];
        return { results: [...(this.tables.get(table || "") || [])].map((name) => ({ name })) };
      },
      run: async () => {
        this.run(sql);
        return {};
      },
    };
  }

  private run(sql: string): void {
    const createTable = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)/);
    if (createTable) {
      if (!this.tables.has(createTable[1])) {
        const columns = [...createTable[2].matchAll(/^\s*(\w+)\s+/gm)].map((match) => match[1]);
        this.tables.set(createTable[1], new Set(columns));
      }
      return;
    }

    const addColumn = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
    if (addColumn) {
      this.tables.get(addColumn[1])?.add(addColumn[2]);
      return;
    }

    const createIndex = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^)]+)\)/);
    if (createIndex) {
      const columns = createIndex[3].split(",").map((column) => column.trim().split(/\s+/)[0]);
      const tableColumns = this.tables.get(createIndex[2]) || new Set<string>();
      const missing = columns.find((column) => !tableColumns.has(column));
      if (missing) throw new Error(`no such column: ${missing}`);
      this.indexes.add(createIndex[1]);
    }
  }
}

describe("schema upgrades", () => {
  it("adds columns to the documented migration 0005 schema before creating indexes", async () => {
    const db = new SchemaDb();

    await expect(ensureSchema(db as unknown as D1Database)).resolves.toBeUndefined();

    expect([...db.tables.get("sites") || []]).toEqual(
      expect.arrayContaining(["password_hash", "handle", "owner_id", "expires_at", "write_policy"]),
    );
    expect([...db.tables.get("loose_files") || []]).toEqual(
      expect.arrayContaining(["updated_at", "last_written_by", "password_hash", "handle", "owner_id", "expires_at", "write_policy"]),
    );
    expect([...db.tables.get("tokens") || []]).toEqual(expect.arrayContaining(["token_secret"]));
    expect([...db.indexes]).toEqual(
      expect.arrayContaining([
        "idx_site_files_site",
        "idx_sites_owner",
        "idx_loose_files_owner",
        "idx_sites_updated_slug",
        "idx_loose_updated_id",
        "idx_sites_expires_at",
        "idx_loose_expires_at",
      ]),
    );
  });
});
