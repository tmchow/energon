import { describe, expect, it, vi } from "vitest";
import { TOKEN_PREFIX } from "../../src/config";
import { actorFromAccess, maskToken, parseBearer, rejectWorkersDevForHumans, requireToken } from "../../src/auth";
import type { Env, TokenRow } from "../../src/types";

const env = { PUBLIC_ORIGIN: "https://energon.example.com" } as Env;

describe("maskToken", () => {
  it("shows prefix plus last 4, never the secret middle", () => {
    const token = `${TOKEN_PREFIX}abcdefghijKLMN`;
    expect(maskToken(token)).toBe(`${TOKEN_PREFIX}…KLMN`);
    expect(maskToken(token)).not.toContain("abcdefghij");
  });

  it("still masks a short or unprefixed value", () => {
    expect(maskToken("abcd")).toBe(`${TOKEN_PREFIX}…`);
    expect(maskToken("totally-plain-token")).toBe("…oken");
  });
});

describe("parseBearer", () => {
  it("reads a Bearer token and ignores a missing header", () => {
    expect(parseBearer(new Request("https://e.test", { headers: { authorization: "Bearer ee_live_x" } }))).toBe(
      "ee_live_x",
    );
    expect(parseBearer(new Request("https://e.test", { headers: { authorization: "bearer ee_live_x" } }))).toBe(
      "ee_live_x",
    );
    expect(parseBearer(new Request("https://e.test"))).toBeNull();
  });
});

describe("requireToken", () => {
  const request = new Request("https://energon.example.com/v1/whoami", {
    headers: { authorization: `Bearer ${TOKEN_PREFIX}test-secret` },
  });
  const row: TokenRow = {
    id: "token-id",
    user_email: "agent@esperlabs.app",
    label: "test",
    token_hash: "unused-by-mock",
    created_at: "2026-08-27T00:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
  };

  it("accepts a valid token when refreshing last_used_at fails", async () => {
    const updateRun = vi.fn().mockRejectedValue(new Error("D1 is read-only"));
    const prepare = vi.fn((sql: string) =>
      sql.includes("SELECT")
        ? { bind: () => ({ first: async () => row }) }
        : { bind: () => ({ run: updateRun }) },
    );
    const env = {
      DB: { prepare },
      PUBLIC_ORIGIN: "https://energon.example.com",
    } as unknown as Env;

    await expect(requireToken(request, env)).resolves.toEqual({
      email: row.user_email,
      via: "token",
      tokenId: row.id,
      tokenLabel: row.label,
    });
    expect(updateRun).toHaveBeenCalledOnce();
  });

  it("still rejects a revoked token", async () => {
    const prepare = vi.fn(() => ({
      bind: () => ({ first: async () => ({ ...row, revoked_at: "2026-08-27T01:00:00.000Z" }) }),
    }));
    const env = {
      DB: { prepare },
      PUBLIC_ORIGIN: "https://energon.example.com",
    } as unknown as Env;

    await expect(requireToken(request, env)).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(prepare).toHaveBeenCalledOnce();
  });
});

describe("actorFromAccess", () => {
  it("rejects unverified Access headers on production requests", async () => {
    const forgedJwt = `x.${btoa(JSON.stringify({ email: "attacker@esperlabs.app" }))}.x`;
    const request = new Request("https://energon.example.com/account", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "attacker@esperlabs.app",
        "Cf-Access-Jwt-Assertion": forgedJwt,
      },
    });

    await expect(actorFromAccess(request, env)).resolves.toBeNull();
  });

  it("uses identity verified by the Cloudflare Access runtime", async () => {
    const access = {
      aud: "configured-access-audience",
      getIdentity: async () => ({ email: "Ada@EsperLabs.app" }),
    };

    await expect(
      actorFromAccess(new Request("https://energon.example.com/account"), env, { access }),
    ).resolves.toEqual({ email: "ada@esperlabs.app", via: "access" });
  });
});

describe("rejectWorkersDevForHumans", () => {
  it("blocks the human hub on workers.dev and leaves the custom domain alone", () => {
    const blocked = rejectWorkersDevForHumans(new Request("https://energon.workers.dev/"));
    expect(blocked?.status).toBe(403);
    const ok = rejectWorkersDevForHumans(new Request("https://energon.example.com/"));
    expect(ok).toBeNull();
    const local = rejectWorkersDevForHumans(new Request("http://127.0.0.1:8787/"));
    expect(local).toBeNull();
  });
});
