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
  readonly executed: string[] = [];

  constructor(private readonly fresh = false) {
    if (fresh) this.tables.clear();
  }

  prepare(sql: string) {
    return {
      first: async (): Promise<{ name: string } | null> => (this.fresh ? null : { name: "tokens" }),
      all: async () => {
        const table = sql.match(/^PRAGMA table_info\((\w+)\)/)?.[1];
        return { results: [...(this.tables.get(table || "") || [])].map((name) => ({ name })) };
      },
      run: async () => {
        this.executed.push(sql);
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
      expect.arrayContaining(["id", "password_hash", "handle", "owner_id", "expires_at", "write_policy", "last_read_at"]),
    );
    expect([...db.tables.get("site_files") || []]).toEqual(expect.arrayContaining(["site_id"]));
    expect([...db.tables.get("loose_files") || []]).toEqual(
      expect.arrayContaining(["updated_at", "last_written_by", "password_hash", "handle", "owner_id", "expires_at", "write_policy", "last_read_at"]),
    );
    expect([...db.tables.get("tokens") || []]).toEqual(expect.arrayContaining(["token_secret", "token_hint", "user_id", "expires_at", "scope"]));
    expect([...db.tables.get("users") || []]).toEqual(expect.arrayContaining(["idp_sub"]));
    expect([...db.tables.get("gate_attempts") || []]).toEqual(expect.arrayContaining(["scope", "fails", "window_start"]));
    expect([...db.tables.get("agent_connections") || []]).toEqual(expect.arrayContaining(["id", "poll_hash", "code_hash", "status", "expires_at", "user_id"]));
    expect([...db.tables.get("platform_quota") || []]).toEqual(expect.arrayContaining(["id", "used"]));
    expect([...db.tables.get("admin_audit") || []]).toEqual(
      expect.arrayContaining(["id", "created_at", "actor_email", "token_id", "action", "executed", "target_json"]),
    );
    expect([...db.indexes]).toEqual(
      expect.arrayContaining([
        "idx_site_files_site",
        "idx_site_files_id_path",
        "idx_sites_owner",
        "idx_loose_files_owner",
        "idx_sites_updated_slug",
        "idx_loose_updated_id",
        "idx_sites_expires_at",
        "idx_loose_expires_at",
        "idx_tokens_user_id",
        "idx_users_idp_sub",
        "idx_admin_audit_created",
      ]),
    );
  });

  it("does not re-add a tokens column the database already has", async () => {
    const db = new SchemaDb();
    db.tables.get("tokens")?.add("expires_at");

    await ensureSchema(db as unknown as D1Database);

    expect(db.executed.filter((sql) => /ALTER TABLE tokens ADD COLUMN expires_at/.test(sql))).toHaveLength(0);
  });

  it("gives a fresh database the tokens expiry column from the table statement alone", async () => {
    const db = new SchemaDb(true);

    await ensureSchema(db as unknown as D1Database);

    expect([...db.tables.get("tokens") || []]).toContain("expires_at");
    expect(db.executed.filter((sql) => /ALTER TABLE/.test(sql))).toHaveLength(0);
  });

  it("gives a fresh database last_read_at from the table statements alone", async () => {
    const db = new SchemaDb(true);

    await ensureSchema(db as unknown as D1Database);

    expect([...db.tables.get("sites") || []]).toContain("last_read_at");
    expect([...db.tables.get("loose_files") || []]).toContain("last_read_at");
    expect(db.executed.filter((sql) => /ALTER TABLE/.test(sql))).toHaveLength(0);
  });

  it("gives a fresh database the tokens scope column from the table statement alone", async () => {
    const db = new SchemaDb(true);

    await ensureSchema(db as unknown as D1Database);

    expect([...db.tables.get("tokens") || []]).toContain("scope");
    expect(db.executed.filter((sql) => /ALTER TABLE tokens ADD COLUMN scope/.test(sql))).toHaveLength(0);
  });
});
