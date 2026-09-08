import { afterEach, describe, expect, it, vi } from "vitest";
import { noteRead, READ_THROTTLE_MS } from "../../src/reads";
import type { Env } from "../../src/types";

type Call = { sql: string; binds: unknown[] };

function fakeDb(fail = false): { env: Env; calls: Call[] } {
  const calls: Call[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              run: async () => {
                calls.push({ sql, binds });
                if (fail) throw new Error("D1 unavailable");
                return {};
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

function fakeCtx(): { ctx: ExecutionContext; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext, pending };
}

describe("noteRead", () => {
  afterEach(() => vi.useRealTimers());

  it("stamps a never-read row through waitUntil", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T12:00:00.000Z") });
    const { env, calls } = fakeDb();
    const { ctx, pending } = fakeCtx();

    noteRead(env, ctx, { table: "sites", id: "abc123", last_read_at: null });
    await Promise.all(pending);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/^UPDATE sites SET last_read_at = \? WHERE id = \? AND \(last_read_at IS NULL OR last_read_at < \?\)$/);
    expect(calls[0].binds).toEqual(["2026-09-08T12:00:00.000Z", "abc123", "2026-09-08T11:00:00.000Z"]);
  });

  it("skips the write while the stored stamp is inside the throttle window", () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T12:00:00.000Z") });
    const { env, calls } = fakeDb();
    const { ctx, pending } = fakeCtx();

    noteRead(env, ctx, { table: "loose_files", id: "f1", last_read_at: "2026-09-08T11:30:00.000Z" });

    expect(calls).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it("writes again once the stored stamp is older than the throttle window", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T12:00:00.000Z") });
    const { env, calls } = fakeDb();
    const { ctx, pending } = fakeCtx();

    noteRead(env, ctx, {
      table: "loose_files",
      id: "f1",
      last_read_at: new Date(Date.now() - READ_THROTTLE_MS - 1).toISOString(),
    });
    await Promise.all(pending);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/^UPDATE loose_files /);
  });

  it("treats an unparseable stamp as never read", async () => {
    const { env, calls } = fakeDb();
    const { ctx, pending } = fakeCtx();

    noteRead(env, ctx, { table: "sites", id: "s1", last_read_at: "not a date" });
    await Promise.all(pending);

    expect(calls).toHaveLength(1);
  });

  it("swallows a failed write so the read still succeeds", async () => {
    const { env } = fakeDb(true);
    const { ctx, pending } = fakeCtx();

    noteRead(env, ctx, { table: "sites", id: "s1", last_read_at: null });

    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
  });

  it("does not throw without an execution context", () => {
    const { env } = fakeDb(true);
    expect(() => noteRead(env, undefined, { table: "sites", id: "s1" })).not.toThrow();
  });
});
