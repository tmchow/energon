import { describe, expect, it, vi } from "vitest";
import { listAdminAudit, recordAdminAudit, sanitizeAuditTarget } from "../../src/audit";
import type { Actor, Env } from "../../src/types";

describe("sanitizeAuditTarget", () => {
  it("drops secret keys and non-json values", () => {
    expect(
      sanitizeAuditTarget({
        owner: "ada@esperlabs.app",
        password: "hunter2",
        write_password: "guest",
        token: "ee_live_nope",
        nested: { password_hash: "abc", q: "notes" },
        ids: ["a", "b", { sneak: true }],
      }),
    ).toEqual({
      owner: "ada@esperlabs.app",
      nested: { q: "notes" },
      ids: ["a", "b"],
    });
  });
});

describe("recordAdminAudit", () => {
  it("inserts a sanitized row and lists it newest first", async () => {
    const binds: unknown[][] = [];
    const rows: Array<Record<string, unknown>> = [];
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO admin_audit")) {
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              binds.push(args);
              rows.unshift({
                id: args[0],
                at: args[1],
                actor_email: args[2],
                token_id: args[3],
                action: args[4],
                target_json: args[5],
                matched: args[6],
                eligible: args[7],
                applied: args[8],
                skipped: args[9],
                failed: args[10],
                confirm: args[11],
              });
            },
          }),
        };
      }
      if (sql.includes("COUNT(*)")) {
        return { first: async () => ({ n: rows.length }) };
      }
      return {
        bind: () => ({
          all: async () => ({ results: rows }),
        }),
      };
    });
    const env = { DB: { prepare } } as unknown as Env;
    const actor: Actor = { email: "admin@esperlabs.app", via: "token", tokenId: "tok-1", admin: true };
    await recordAdminAudit(env, actor, {
      action: "cleanup",
      target: { owner: "ada@esperlabs.app", password: "nope" },
      matched: 2,
      eligible: 2,
      applied: 2,
      confirm: "abc",
    });
    expect(binds).toHaveLength(1);
    expect(binds[0][4]).toBe("cleanup");
    expect(JSON.parse(String(binds[0][5]))).toEqual({ owner: "ada@esperlabs.app" });
    expect(binds[0][3]).toBe("tok-1");

    const listed = await listAdminAudit(env, new URL("https://hub.example/v1/admin/audit"));
    expect(listed.total).toBe(1);
    expect(listed.events[0]).toMatchObject({
      action: "cleanup",
      actor_email: "admin@esperlabs.app",
      token_id: "tok-1",
      target: { owner: "ada@esperlabs.app" },
      applied: 2,
      confirm: "abc",
    });
    expect(listed.events[0]).not.toHaveProperty("password");
    expect(JSON.stringify(listed)).not.toContain("nope");
  });
});
