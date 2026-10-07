import { describe, expect, it } from "vitest";
import { listAdminAudit, recordAdminAudit, type AdminAuditInput } from "../../src/audit";
import type { Actor, Env } from "../../src/types";

function memoryDb() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/INSERT INTO admin_audit/.test(sql)) {
                rows.push({
                  id: args[0],
                  created_at: args[1],
                  actor_email: args[2],
                  token_id: args[3],
                  token_hint: args[4],
                  action: args[5],
                  executed: args[6],
                  action_kind: args[7],
                  ttl: args[8],
                  target_json: args[9],
                  matched: args[10],
                  eligible: args[11],
                  applied: args[12],
                  skipped: args[13],
                  failed: args[14],
                  bytes: args[15],
                  confirm: args[16],
                });
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (/SELECT token_hint/.test(sql)) return { token_hint: "ee_live_admin…wxyz" };
              return rows[0] ?? null;
            },
            async all() {
              const limit = Number(args[args.length - 1] ?? 26);
              return { results: rows.slice().reverse().slice(0, limit) };
            },
          };
        },
      };
    },
  };
}

describe("admin audit", () => {
  it.each([
    {
      name: "missing optional values",
      input: { action: "cleanup", executed: false, target: null },
      expected: { action_kind: null, ttl: null, matched: null, eligible: null, applied: null, skipped: null, failed: null, bytes: null, confirm: null },
    },
    {
      name: "zero counts and empty strings",
      input: { action: "cleanup", executed: true, actionKind: "", ttl: "", target: {}, matched: 0, eligible: 0, applied: 0, skipped: 0, failed: 0, bytes: 0, confirm: "" },
      expected: { action_kind: "", ttl: "", matched: 0, eligible: 0, applied: 0, skipped: 0, failed: 0, bytes: 0, confirm: "" },
    },
  ])("preserves $name in stored and returned events", async ({ input, expected }) => {
    const db = memoryDb();
    const env = { DB: db } as unknown as Env;
    const actor: Actor = { email: "admin@esperlabs.app", via: "access", admin: true };
    const event = await recordAdminAudit(env, actor, input as AdminAuditInput);
    expect(event).toMatchObject({ ...expected, token_id: null, token_hint: null, target: {} });
    expect(db.rows[0]).toMatchObject({ ...expected, token_id: null, token_hint: null, target_json: "{}", executed: input.executed ? 1 : 0 });
    const listed = await listAdminAudit(env, new URL("https://hub.example/v1/admin/audit"));
    expect(listed.events[0]).toEqual(event);
  });

  it("stores who, token, filters, and counts without secrets", async () => {
    const db = memoryDb();
    const env = { DB: db } as unknown as Env;
    const actor: Actor = {
      email: "admin@esperlabs.app",
      via: "token",
      tokenId: "tok-1",
      tokenScope: "admin",
      admin: true,
    };
    const event = await recordAdminAudit(env, actor, {
      action: "cleanup",
      executed: false,
      actionKind: "set_ttl",
      ttl: "7d",
      target: { owner: "ada", expires: "never" },
      matched: 2,
      eligible: 2,
      bytes: 40,
      confirm: "a".repeat(32),
    });
    expect(event.actor_email).toBe("admin@esperlabs.app");
    expect(event.token_hint).toBe("ee_live_admin…wxyz");
    expect(event.target).toEqual({ owner: "ada", expires: "never" });
    expect(JSON.stringify(event)).not.toContain("password");
    const listed = await listAdminAudit(env, new URL("https://hub.example/v1/admin/audit"));
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0].action).toBe("cleanup");
    expect(listed.events[0].executed).toBe(false);
  });

  it("records token revoke previews under action tokens", async () => {
    const db = memoryDb();
    const env = { DB: db } as unknown as Env;
    const actor: Actor = {
      email: "admin@esperlabs.app",
      via: "token",
      tokenId: "tok-1",
      tokenScope: "admin",
      admin: true,
    };
    const event = await recordAdminAudit(env, actor, {
      action: "tokens",
      executed: false,
      actionKind: "all",
      target: { owner: "ada" },
      matched: 2,
      eligible: 2,
      confirm: "b".repeat(32),
    });
    expect(event.action).toBe("tokens");
    expect(event.action_kind).toBe("all");
    expect(event.target).toEqual({ owner: "ada" });
    expect(event.executed).toBe(false);
  });
});
