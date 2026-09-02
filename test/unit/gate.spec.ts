import { describe, expect, it } from "vitest";
import {
  GATE_MAX_FAILS,
  GATE_WINDOW_MS,
  clearGateAttempts,
  gateIsBlocked,
  gateScopes,
  parseFormPassword,
  recordGateFailures,
} from "../../src/gate";
import type { Env } from "../../src/types";

function memGateDb() {
  const rows = new Map<string, { fails: number; window_start: string }>();
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const scope = String(args[0]);
          return {
            first: async () => rows.get(scope) || null,
            run: async () => {
              if (sql.includes("DELETE")) {
                rows.delete(scope);
                return;
              }
              if (sql.includes("INSERT")) {
                rows.set(scope, { fails: 1, window_start: String(args[1]) });
                return;
              }
              if (sql.includes("UPDATE")) {
                const cur = rows.get(scope);
                if (cur) cur.fails += 1;
              }
            },
          };
        },
      };
    },
    rows,
  };
}

describe("gate attempt limits", () => {
  it("scopes guesses by object path and connecting IP", () => {
    const request = new Request("https://energon.example.com/ada/s/gated/", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });
    expect(gateScopes(request, "/ada/s/gated/")).toEqual(["obj:/ada/s/gated/", "ip:203.0.113.10"]);
  });

  it("blocks after GATE_MAX_FAILS in the window and clears on success", async () => {
    const db = memGateDb();
    const env = { DB: db } as unknown as Env;
    const scopes = ["obj:/x/", "ip:1.1.1.1"];
    const start = Date.parse("2026-09-02T00:00:00.000Z");
    for (let i = 0; i < GATE_MAX_FAILS; i++) {
      expect(await gateIsBlocked(env, scopes, start)).toBe(false);
      await recordGateFailures(env, scopes, start);
    }
    expect(await gateIsBlocked(env, scopes, start + 1000)).toBe(true);
    await clearGateAttempts(env, scopes);
    expect(await gateIsBlocked(env, scopes, start + 1000)).toBe(false);
  });

  it("opens a new window after GATE_WINDOW_MS", async () => {
    const db = memGateDb();
    const env = { DB: db } as unknown as Env;
    const scopes = ["obj:/y/"];
    const start = Date.parse("2026-09-02T00:00:00.000Z");
    for (let i = 0; i < GATE_MAX_FAILS; i++) await recordGateFailures(env, scopes, start);
    expect(await gateIsBlocked(env, scopes, start + GATE_WINDOW_MS - 1)).toBe(true);
    expect(await gateIsBlocked(env, scopes, start + GATE_WINDOW_MS)).toBe(false);
  });
});

describe("parseFormPassword", () => {
  it("reads a urlencoded password", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
    });
    await expect(parseFormPassword(request)).resolves.toBe("hunter2");
  });

  it("rejects multipart before parsing", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    await expect(parseFormPassword(request)).rejects.toMatchObject({
      status: 415,
      code: "bad_content_type",
    });
  });

  it("rejects a body over the gate cap", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${"x".repeat(3000)}`,
    });
    await expect(parseFormPassword(request)).rejects.toMatchObject({
      status: 413,
      code: "too_large",
    });
  });
});
