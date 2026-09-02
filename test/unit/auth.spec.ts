import { describe, expect, it, vi } from "vitest";
import { TOKEN_PREFIX } from "../../src/config";
import { actorFromAccess, helpBody, maskToken, mintToken, parseBearer, rejectWorkersDevForHumans, requireToken } from "../../src/auth";
import { readCookie } from "../../src/gate";
import { tokenPolicy } from "../../src/policy";
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

  it("uses the configured prefix", () => {
    const customEnv = { TOKEN_PREFIX: "custom_" } as Env;
    expect(maskToken("custom_abcdefghijKLMN", customEnv)).toBe("custom_…KLMN");
    expect(maskToken("abcd", customEnv)).toBe("custom_…");
  });
});

describe("mintToken", () => {
  it("mints a custom-prefix token that requireToken accepts", async () => {
    const customEnv = {
      TOKEN_PREFIX: "custom_",
      PUBLIC_ORIGIN: "https://energon.example.com",
    } as Env;
    let storedHash = "";
    let lookedUpHash = "";
    const user = { id: "user-id", email: "agent@esperlabs.app", handle: "agent", idp_sub: null };
    const row: TokenRow = {
      id: "token-id",
      user_email: "agent@esperlabs.app",
      user_id: user.id,
      label: "custom",
      token_hash: "",
      created_at: "2026-08-27T00:00:00.000Z",
      last_used_at: null,
      revoked_at: null,
    };
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO tokens")) {
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              storedHash = String(args[4]);
              row.token_hash = storedHash;
            },
          }),
        };
      }
      if (sql.includes("FROM users")) {
        return { bind: () => ({ first: async () => user }) };
      }
      if (sql.includes("SELECT")) {
        return {
          bind: (hash: string) => ({
            first: async () => {
              lookedUpHash = hash;
              return hash === storedHash ? row : null;
            },
          }),
        };
      }
      return { bind: () => ({ run: async () => undefined }) };
    });
    const env = { ...customEnv, DB: { prepare } } as unknown as Env;

    const minted = await mintToken(env, row.user_email, row.label);
    expect(minted.token).toMatch(/^custom_/);
    await expect(
      requireToken(new Request("https://energon.example.com/v1/whoami", {
        headers: { authorization: `Bearer ${minted.token}` },
      }), env),
    ).resolves.toMatchObject({ email: row.user_email, tokenId: row.id, tokenLabel: row.label });
    expect(storedHash).not.toBe("");
    expect(lookedUpHash).toBe(storedHash);
  });
});

describe("mintToken lifetime", () => {
  function mintEnv(extra: Partial<Env> = {}) {
    const binds: unknown[][] = [];
    const user = { id: "user-id", email: "agent@esperlabs.app", handle: "agent", idp_sub: null };
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO tokens")) {
        return { bind: (...args: unknown[]) => ({ run: async () => binds.push(args) }) };
      }
      if (sql.includes("FROM users")) return { bind: () => ({ first: async () => user }) };
      return { bind: () => ({ run: async () => undefined, first: async () => null }) };
    });
    return { env: { PUBLIC_ORIGIN: "https://energon.example.com", ...extra, DB: { prepare } } as unknown as Env, binds };
  }

  it("binds the resolved expiry as the last INSERT value", async () => {
    const { env, binds } = mintEnv();
    const minted = await mintToken(env, "agent@esperlabs.app", "laptop", "user-id", "1d");
    expect(binds).toHaveLength(1);
    expect(binds[0][4]).toMatch(/^[a-f0-9]{64}$/);
    expect(binds[0][7]).toBe(minted.expires_at);
    expect(Date.parse(String(minted.expires_at)) - Date.now()).toBeGreaterThan(86000 * 1000);
  });

  it("refuses never when the instance forbids it, before touching the database", async () => {
    const { env, binds } = mintEnv({ ALLOW_UNLIMITED_TOKENS: "false" });
    let error: unknown;
    try {
      await mintToken(env, "agent@esperlabs.app", "laptop", "user-id", "never");
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ status: 400, code: "bad_ttl" });
    expect(String((error as Error).message)).not.toContain("never");
    expect(binds).toHaveLength(0);
    expect(tokenPolicy(env).presets.map((p) => p.id)).not.toContain("never");
  });

  it("still authenticates a never-expiring row when the instance forbids new ones", async () => {
    const row: TokenRow = {
      id: "legacy-id",
      user_email: "agent@esperlabs.app",
      label: "legacy",
      token_hash: "unused-by-mock",
      created_at: "2024-01-01T00:00:00.000Z",
      last_used_at: null,
      revoked_at: null,
      expires_at: null,
    };
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("FROM users")) return { bind: () => ({ first: async () => null }) };
      if (sql.includes("SELECT")) return { bind: () => ({ first: async () => row }) };
      return { bind: () => ({ run: async () => undefined }) };
    });
    const env = {
      DB: { prepare },
      PUBLIC_ORIGIN: "https://energon.example.com",
      ALLOW_UNLIMITED_TOKENS: "false",
    } as unknown as Env;
    const request = new Request("https://energon.example.com/v1/whoami", {
      headers: { authorization: `Bearer ${TOKEN_PREFIX}legacy-secret` },
    });
    await expect(requireToken(request, env)).resolves.toMatchObject({ tokenId: "legacy-id" });
  });
});

describe("helpBody", () => {
  it("publishes the configured token prefix", () => {
    const body = helpBody("https://custom.example.com", { TOKEN_PREFIX: "custom_" } as Env) as {
      auth: string;
      token_prefix: string;
    };
    expect(body.token_prefix).toBe("custom_");
    expect(body.auth).toBe("Authorization: Bearer custom_<secret>");
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

describe("readCookie", () => {
  it("ignores malformed percent encoding instead of crashing the request", () => {
    const request = new Request("https://energon.example.com", {
      headers: { cookie: "unrelated=ok; energon_gate=%; later=value" },
    });

    expect(readCookie(request, "energon_gate")).toBeNull();
    expect(readCookie(request, "later")).toBe("value");
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
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("FROM users")) return { bind: () => ({ first: async () => null }) };
      if (sql.includes("SELECT")) return { bind: () => ({ first: async () => row }) };
      return { bind: () => ({ run: updateRun }) };
    });
    const env = {
      DB: { prepare },
      PUBLIC_ORIGIN: "https://energon.example.com",
    } as unknown as Env;

    await expect(requireToken(request, env)).resolves.toEqual({
      email: row.user_email,
      userId: undefined,
      idpSub: undefined,
      via: "token",
      tokenId: row.id,
      tokenLabel: row.label,
      tokenExpiresAt: null,
    });
    expect(updateRun).toHaveBeenCalledOnce();
  });

  it("rejects an expired token with token_expired and never bumps last_used_at", async () => {
    const updateRun = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("SELECT")) {
        return { bind: () => ({ first: async () => ({ ...row, expires_at: "2000-01-01T00:00:00.000Z" }) }) };
      }
      return { bind: () => ({ run: updateRun }) };
    });
    const env = { DB: { prepare }, PUBLIC_ORIGIN: "https://energon.example.com" } as unknown as Env;

    await expect(requireToken(request, env)).rejects.toMatchObject({
      status: 401,
      code: "token_expired",
      extra: { expired_at: "2000-01-01T00:00:00.000Z", tokens_url: "https://energon.example.com/tokens" },
    });
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("treats an unparseable expiry as expired", async () => {
    const prepare = vi.fn(() => ({
      bind: () => ({ first: async () => ({ ...row, expires_at: "not-a-date" }), run: async () => undefined }),
    }));
    const env = { DB: { prepare }, PUBLIC_ORIGIN: "https://energon.example.com" } as unknown as Env;

    await expect(requireToken(request, env)).rejects.toMatchObject({ status: 401, code: "token_expired" });
  });

  it("reports revoked before expired", async () => {
    const prepare = vi.fn(() => ({
      bind: () => ({
        first: async () => ({ ...row, revoked_at: "2026-08-27T01:00:00.000Z", expires_at: "2000-01-01T00:00:00.000Z" }),
      }),
    }));
    const env = { DB: { prepare }, PUBLIC_ORIGIN: "https://energon.example.com" } as unknown as Env;

    await expect(requireToken(request, env)).rejects.toMatchObject({ status: 401, code: "unauthorized" });
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
      getIdentity: async () => ({ email: "Ada@EsperLabs.app", user_uuid: "uuid-ada" }),
    };

    await expect(
      actorFromAccess(new Request("https://energon.example.com/account"), env, { access }),
    ).resolves.toEqual({ email: "ada@esperlabs.app", idpSub: "uuid-ada", via: "access" });
  });

  it("rejects production Access identity that has no subject", async () => {
    const access = {
      aud: "configured-access-audience",
      getIdentity: async () => ({ email: "Ada@EsperLabs.app" }),
    };
    await expect(
      actorFromAccess(new Request("https://energon.example.com/account"), env, { access }),
    ).resolves.toBeNull();
  });

  it("ignores client Access subject headers once getIdentity has verified the session", async () => {
    const access = {
      aud: "configured-access-audience",
      getIdentity: async () => ({ email: "Ada@EsperLabs.app", user_uuid: "uuid-ada" }),
    };
    const request = new Request("https://energon.example.com/account", {
      headers: {
        "Cf-Access-Authenticated-User-Sub": "stolen-sub",
        "Cf-Access-Jwt-Assertion": `x.${btoa(JSON.stringify({ sub: "jwt-stolen" }))}.x`,
      },
    });
    await expect(actorFromAccess(request, env, { access })).resolves.toEqual({
      email: "ada@esperlabs.app",
      idpSub: "uuid-ada",
      via: "access",
    });
  });

  it("uses the Access subject when the JWT or header carries one", async () => {
    const request = new Request("http://127.0.0.1/account", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app",
        "Cf-Access-Authenticated-User-Sub": "idp-ada",
      },
    });
    await expect(actorFromAccess(request, env)).resolves.toEqual({
      email: "ada@esperlabs.app",
      idpSub: "idp-ada",
      via: "access",
    });

    const jwt = `x.${btoa(JSON.stringify({ sub: "jwt-ada" }))}.x`;
    const fromJwt = new Request("http://127.0.0.1/account", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app",
        "Cf-Access-Jwt-Assertion": jwt,
        "Cf-Access-Authenticated-User-Sub": "header-ada",
      },
    });
    await expect(actorFromAccess(fromJwt, env)).resolves.toEqual({
      email: "ada@esperlabs.app",
      idpSub: "jwt-ada",
      via: "access",
    });
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
