import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function tableColumns(source: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\)/g)) {
    const columns = [...match[2].matchAll(/^\s*(\w+)\s+/gm)]
      .map((column) => column[1])
      .filter((name) => !["PRIMARY", "CHECK"].includes(name));
    tables.set(match[1], columns);
  }
  return tables;
}

describe("schema representations", () => {
  it("keeps src/schema.sql and the runtime table statements on the same columns", () => {
    const documented = tableColumns(readFileSync("src/schema.sql", "utf8"));
    const runtime = tableColumns(readFileSync("src/db.ts", "utf8"));

    expect([...runtime.keys()].sort()).toEqual([...documented.keys()].sort());
    for (const [table, columns] of runtime) {
      expect(new Set(documented.get(table))).toEqual(new Set(columns));
    }
  });

  it("ships the tokens expiry column as a single additive migration", () => {
    const migration = readFileSync("migrations/0013_token_expires_at.sql", "utf8");
    const statements = migration
      .split("\n")
      .filter((line: string) => line.trim() && !line.trim().startsWith("--"));

    expect(statements).toEqual(["ALTER TABLE tokens ADD COLUMN expires_at TEXT;"]);
  });

  it("ships write-password columns as a single additive migration", () => {
    const migration = readFileSync("migrations/0015_write_password.sql", "utf8");
    const statements = migration
      .split("\n")
      .filter((line: string) => line.trim() && !line.trim().startsWith("--"));

    expect(statements).toEqual([
      "ALTER TABLE sites ADD COLUMN write_password_hash TEXT;",
      "ALTER TABLE sites ADD COLUMN written_via TEXT;",
      "ALTER TABLE loose_files ADD COLUMN write_password_hash TEXT;",
      "ALTER TABLE loose_files ADD COLUMN written_via TEXT;",
    ]);
  });

  it("ships recoverable password secrets as a single additive migration", () => {
    const migration = readFileSync("migrations/0016_password_secret.sql", "utf8");
    const statements = migration
      .split("\n")
      .filter((line: string) => line.trim() && !line.trim().startsWith("--"));

    expect(statements).toEqual([
      "ALTER TABLE sites ADD COLUMN password_secret TEXT;",
      "ALTER TABLE sites ADD COLUMN write_password_secret TEXT;",
      "ALTER TABLE loose_files ADD COLUMN password_secret TEXT;",
      "ALTER TABLE loose_files ADD COLUMN write_password_secret TEXT;",
    ]);
  });

  it("ships token scope as a single additive migration", () => {
    const migration = readFileSync("migrations/0020_token_scope.sql", "utf8");
    const statements = migration
      .split("\n")
      .filter((line: string) => line.trim() && !line.trim().startsWith("--"));

    expect(statements).toEqual(["ALTER TABLE tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'account';"]);
  });

  it("ships last_read_at as a single additive migration", () => {
    const migration = readFileSync("migrations/0019_last_read_at.sql", "utf8");
    const statements = migration
      .split("\n")
      .filter((line: string) => line.trim() && !line.trim().startsWith("--"));

    expect(statements).toEqual([
      "ALTER TABLE sites ADD COLUMN last_read_at TEXT;",
      "ALTER TABLE loose_files ADD COLUMN last_read_at TEXT;",
    ]);
  });
});
