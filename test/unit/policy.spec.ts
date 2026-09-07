import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, MAX_PLATFORM_BYTES } from "../../src/config";
import {
  emailAllowed,
  formatDuration,
  formatTtlLabel,
  instancePolicy,
  parseByteSize,
  parseDuration,
  assertCanMutate,
  assertCanSetWritePolicy,
  canMutate,
  parseWritePolicyEnv,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
  resolveTokenExpiresAt,
  tokenExpired,
  tokenPolicy,
  tokenPolicyPublic,
  TTL_CATALOG,
  TOKEN_TTL_CATALOG,
} from "../../src/policy";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    ALLOW_UNLIMITED_RETENTION: undefined,
    DEFAULT_TTL: undefined,
    MAX_TTL: undefined,
    TTL_PRESETS: undefined,
    ALLOW_UNLIMITED_TOKENS: undefined,
    ALLOWED_EMAIL_DOMAINS: undefined,
    MAX_FILE_BYTES: undefined,
    MAX_PLATFORM_BYTES: undefined,
    WRITE_POLICY: undefined,
    ...overrides,
  };
}

describe("parseByteSize", () => {
  it("reads mb/gb labels and raw bytes", () => {
    expect(parseByteSize("25mb")).toBe(25 * 1024 * 1024);
    expect(parseByteSize("5 MB")).toBe(5 * 1024 * 1024);
    expect(parseByteSize("20gb")).toBe(20 * 1024 * 1024 * 1024);
    expect(parseByteSize("26214400")).toBe(26214400);
  });

  it("rejects junk and empty", () => {
    expect(parseByteSize("")).toBeNull();
    expect(parseByteSize(undefined)).toBeNull();
    expect(parseByteSize("0mb")).toBeNull();
    expect(parseByteSize("-1mb")).toBeNull();
    expect(parseByteSize("huge")).toBeNull();
  });
});

describe("parseDuration", () => {
  it("reads the builtin presets", () => {
    expect(parseDuration("30m")).toBe(30 * 60);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("1d")).toBe(86400);
    expect(parseDuration("7d")).toBe(7 * 86400);
    expect(parseDuration("14d")).toBe(14 * 86400);
    expect(parseDuration("30d")).toBe(30 * 86400);
    expect(parseDuration("90d")).toBe(90 * 86400);
    expect(parseDuration("365d")).toBe(365 * 86400);
  });

  it("rejects junk", () => {
    expect(parseDuration("never")).toBeNull();
    expect(parseDuration("0d")).toBeNull();
    expect(parseDuration("-1h")).toBeNull();
    expect(parseDuration("7")).toBeNull();
  });
});

describe("instancePolicy", () => {
  it("DEFAULT_TTL is 7d on a public host and never on a company host", () => {
    expect(instancePolicy(env()).defaultTtl).toBe("7d");
    expect(
      instancePolicy(
        env({ ALLOW_UNLIMITED_RETENTION: "true", DEFAULT_TTL: "never", MAX_TTL: "never" }),
      ).defaultTtl,
    ).toBe("never");
    expect(instancePolicy(env({ DEFAULT_TTL: "1d", MAX_TTL: "30d" })).defaultTtl).toBe("1d");
  });

  it("defaults to a public-strict host: required TTL, 30 day cap, no domain lock", () => {
    const policy = instancePolicy(env());
    expect(policy.allowUnlimited).toBe(false);
    expect(policy.defaultTtl).toBe("7d");
    expect(policy.maxSeconds).toBe(30 * 86400);
    expect(policy.presets.map((p) => p.id)).toEqual(["30m", "1h", "1d", "7d", "14d", "30d"]);
    expect(policy.presets.find((p) => p.id === "30d")?.label).toBe("1 month");
    expect(policy.presets.some((p) => p.id === "never")).toBe(false);
    expect(policy.presets.some((p) => p.id === "90d")).toBe(false);
    expect(policy.allowedEmailDomains).toEqual([]);
    expect(policy.fileBytes).toBe(MAX_FILE_BYTES);
    expect(policy.platformBytes).toBe(MAX_PLATFORM_BYTES);
    expect(policy.writePolicy).toBe("owner");
  });

  it("WRITE_POLICY unset is owner; org opts in", () => {
    expect(instancePolicy(env()).writePolicy).toBe("owner");
    expect(instancePolicy(env({ WRITE_POLICY: "org" })).writePolicy).toBe("org");
    expect(instancePolicy(env({ WRITE_POLICY: "owner" })).writePolicy).toBe("owner");
    expect(instancePolicy(env({ WRITE_POLICY: "weird" })).writePolicy).toBe("owner");
    expect(instancePolicy(env({ WRITE_POLICY: "instance" })).writePolicy).toBe("owner");
  });

  it("honors MAX_FILE_BYTES and MAX_PLATFORM_BYTES from env", () => {
    const policy = instancePolicy(env({ MAX_FILE_BYTES: "5mb", MAX_PLATFORM_BYTES: "2gb" }));
    expect(policy.fileBytes).toBe(5 * 1024 * 1024);
    expect(policy.platformBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it("lets a company host keep content forever and lock email domains", () => {
    const policy = instancePolicy(
      env({
        ALLOW_UNLIMITED_RETENTION: "true",
        DEFAULT_TTL: "never",
        MAX_TTL: "never",
        ALLOWED_EMAIL_DOMAINS: "esperlabs.app, esperlabs.ai",
      }),
    );
    expect(policy.allowUnlimited).toBe(true);
    expect(policy.defaultTtl).toBe("never");
    expect(policy.maxSeconds).toBeNull();
    expect(policy.presets.map((p) => p.id)).toEqual([...TTL_CATALOG, "never"]);
    expect(policy.presets.find((p) => p.id === "90d")).toEqual({
      id: "90d",
      seconds: 90 * 86400,
      label: "3 months",
    });
    expect(policy.presets.at(-1)).toEqual({ id: "never", seconds: null, label: "Never" });
    expect(policy.allowedEmailDomains).toEqual(["esperlabs.app", "esperlabs.ai"]);
  });

  it("drops presets longer than MAX_TTL", () => {
    const policy = instancePolicy(env({ MAX_TTL: "7d" }));
    expect(policy.presets.map((p) => p.id)).toEqual(["30m", "1h", "1d", "7d"]);
  });
});

describe("resolveExpiresAt", () => {
  it("uses this Energon's default when ttl is omitted", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const resolved = resolveExpiresAt(instancePolicy(env()), undefined, now);
    expect(resolved.ttl).toBe("7d");
    expect(resolved.expiresAt).toBe("2026-01-08T00:00:00.000Z");
  });

  it("rejects never on a public-strict Energon", () => {
    expect(() => resolveExpiresAt(instancePolicy(env()), "never")).toThrow(/does not keep content forever/);
  });

  it("allows never on a company Energon", () => {
    const policy = instancePolicy(env({ ALLOW_UNLIMITED_RETENTION: "true", DEFAULT_TTL: "never" }));
    expect(resolveExpiresAt(policy, undefined)).toEqual({ expiresAt: null, ttl: "never" });
    expect(resolveExpiresAt(policy, "never")).toEqual({ expiresAt: null, ttl: "never" });
  });

  it("rejects a ttl longer than this Energon's cap", () => {
    expect(() => resolveExpiresAt(instancePolicy(env({ MAX_TTL: "1d" })), "7d")).toThrow(/caps retention/);
  });
});

describe("emailAllowed", () => {
  it("allows any email when no domains are configured", () => {
    const policy = instancePolicy(env());
    expect(emailAllowed(policy, "stranger@gmail.com")).toBe(true);
  });

  it("locks a company Energon to listed domains", () => {
    const policy = instancePolicy(env({ ALLOWED_EMAIL_DOMAINS: "esperlabs.app,esperlabs.ai" }));
    expect(emailAllowed(policy, "ada@esperlabs.app")).toBe(true);
    expect(emailAllowed(policy, "Ada@EsperLabs.AI")).toBe(true);
    expect(emailAllowed(policy, "ada@gmail.com")).toBe(false);
  });
});

describe("write policy helpers", () => {
  it("parses the env as owner unless it is org", () => {
    expect(parseWritePolicyEnv(undefined)).toBe("owner");
    expect(parseWritePolicyEnv("")).toBe("owner");
    expect(parseWritePolicyEnv("org")).toBe("org");
    expect(parseWritePolicyEnv("ORG")).toBe("org");
    expect(parseWritePolicyEnv("instance")).toBe("owner");
  });

  it("treats stored NULL as org so any token can write", () => {
    expect(resolveWritePolicy(null)).toBe("org");
    expect(resolveWritePolicy(undefined)).toBe("org");
    expect(resolveWritePolicy("org")).toBe("org");
    expect(resolveWritePolicy("instance")).toBe("org");
    expect(resolveWritePolicy("owner")).toBe("owner");
  });

  it("requested write_policy distinguishes omit, valid, and junk", () => {
    expect(requestedWritePolicy(undefined)).toBeNull();
    expect(requestedWritePolicy("")).toBeNull();
    expect(requestedWritePolicy("owner")).toBe("owner");
    expect(requestedWritePolicy("org")).toBe("org");
    expect(requestedWritePolicy("instance")).toBe("invalid");
    expect(requestedWritePolicy("team")).toBe("invalid");
    expect(requestedWritePolicy(1)).toBe("invalid");
  });

  it("create copies this Energon's default unless the request sets it", () => {
    expect(resolveCreateWritePolicy(env(), undefined)).toBe("owner");
    expect(resolveCreateWritePolicy(env({ WRITE_POLICY: "org" }), undefined)).toBe("org");
    expect(resolveCreateWritePolicy(env({ WRITE_POLICY: "org" }), "owner")).toBe("owner");
    expect(() => resolveCreateWritePolicy(env(), "team")).toThrow(/write_policy must be owner or org/);
    expect(() => resolveCreateWritePolicy(env(), "instance")).toThrow(/write_policy must be owner or org/);
  });

  it("org mode lets any token mutate; owner mode is creator-only", () => {
    const ada = { email: "ada@esperlabs.app", via: "token" as const };
    const bob = { email: "bob@esperlabs.app", via: "token" as const };
    const ownerRow = { created_by: "ada@esperlabs.app", write_policy: "owner" };
    const orgRow = { created_by: "ada@esperlabs.app", write_policy: "org" };
    expect(canMutate(ada, ownerRow)).toBe(true);
    expect(canMutate(bob, ownerRow)).toBe(false);
    expect(canMutate(bob, orgRow)).toBe(true);
    expect(canMutate(bob, { created_by: "ada@esperlabs.app", write_policy: null })).toBe(true);
    expect(() => assertCanMutate(bob, ownerRow)).toThrow(/Only the creator can write this/);
    expect(() => assertCanSetWritePolicy(bob, "ada@esperlabs.app")).toThrow(/Only the creator can change who can write/);
    expect(() => assertCanSetWritePolicy(ada, "ada@esperlabs.app")).not.toThrow();
  });

  it("owner_id beats a reused email when both identities are present", () => {
    const ada = { email: "ada@esperlabs.app", userId: "u-ada", via: "token" as const };
    const next = { email: "ada@esperlabs.app", userId: "u-next", via: "token" as const };
    const row = { created_by: "ada@esperlabs.app", write_policy: "owner", owner_id: "u-ada" };
    expect(canMutate(ada, row)).toBe(true);
    expect(canMutate(next, row)).toBe(false);
    expect(canMutate(next, { created_by: "ada@esperlabs.app", write_policy: "owner" })).toBe(false);
    expect(() => assertCanSetWritePolicy(next, "ada@esperlabs.app", "u-ada")).toThrow(/Only the creator can change who can write/);
    expect(() => assertCanSetWritePolicy(next, "ada@esperlabs.app")).toThrow(/Only the creator can change who can write/);
    expect(() => assertCanSetWritePolicy(ada, "ada@esperlabs.app", "u-ada")).not.toThrow();
  });
});

describe("formatDuration", () => {
  it("uses singular units", () => {
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(86400)).toBe("1 day");
  });
});

describe("formatTtlLabel", () => {
  it("uses calendar language for month and year windows", () => {
    expect(formatTtlLabel("30d")).toBe("1 month");
    expect(formatTtlLabel("60d")).toBe("2 months");
    expect(formatTtlLabel("90d")).toBe("3 months");
    expect(formatTtlLabel("180d")).toBe("6 months");
    expect(formatTtlLabel("365d")).toBe("1 year");
    expect(formatTtlLabel("never")).toBe("Never");
    expect(formatTtlLabel("7d")).toBe("7 days");
  });
});

describe("tokenPolicy", () => {
  const ids = (policy: ReturnType<typeof tokenPolicy>) => policy.presets.map((p) => p.id);

  it("offers the fixed catalog plus never when the var is unset", () => {
    const policy = tokenPolicy(env());
    expect(ids(policy)).toEqual([...TOKEN_TTL_CATALOG, "never"]);
    expect(policy.allowUnlimited).toBe(true);
    expect(policy.defaultTtl).toBe("90d");
    expect(policy.presets.find((p) => p.id === "90d")?.label).toBe("3 months");
  });

  it.each(["true", "1", "YES"])("keeps never when ALLOW_UNLIMITED_TOKENS=%s", (value) => {
    const policy = tokenPolicy(env({ ALLOW_UNLIMITED_TOKENS: value }));
    expect(ids(policy)).toContain("never");
    expect(policy.allowUnlimited).toBe(true);
  });

  it.each(["false", "0", "no", "maybe", "off", "disabled", ""])("forbids never when ALLOW_UNLIMITED_TOKENS=%j", (value) => {
    const policy = tokenPolicy(env({ ALLOW_UNLIMITED_TOKENS: value }));
    expect(ids(policy)).toEqual([...TOKEN_TTL_CATALOG]);
    expect(policy.allowUnlimited).toBe(false);
    expect(policy.defaultTtl).toBe("90d");
  });

  it.each([
    { MAX_TTL: "1d" },
    { ALLOW_UNLIMITED_RETENTION: "false" },
    { DEFAULT_TTL: "7d" },
    { TTL_PRESETS: "1h,7d" },
  ])("ignores content retention var %o", (overrides) => {
    const policy = tokenPolicy(env(overrides));
    expect(ids(policy)).toEqual([...TOKEN_TTL_CATALOG, "never"]);
    expect(policy.defaultTtl).toBe("90d");
  });

  it("projects presets, default, allow_never, and the tokens page URL", () => {
    const pub = tokenPolicyPublic(tokenPolicy(env({ ALLOW_UNLIMITED_TOKENS: "false" })), "https://energon.example.com");
    expect(pub).toMatchObject({ default: "90d", allow_never: false, tokens_url: "https://energon.example.com/tokens" });
    expect((pub.presets as { id: string }[]).map((p) => p.id)).toEqual([...TOKEN_TTL_CATALOG]);
  });
});

describe("resolveTokenExpiresAt", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const policy = tokenPolicy(env());

  it("uses the 90 day default when ttl is omitted or empty", () => {
    const expected = new Date(now.getTime() + 90 * 86400 * 1000).toISOString();
    expect(resolveTokenExpiresAt(policy, undefined, now)).toBe(expected);
    expect(resolveTokenExpiresAt(policy, "", now)).toBe(expected);
    expect(resolveTokenExpiresAt(policy, "  ", now)).toBe(expected);
  });

  it("matches preset ids case-insensitively", () => {
    expect(resolveTokenExpiresAt(policy, "7D", now)).toBe(resolveTokenExpiresAt(policy, "7d", now));
    expect(resolveTokenExpiresAt(policy, "1d", now)).toBe("2026-09-03T12:00:00.000Z");
  });

  it.each(["3h", 86400, "none", "unlimited", "never-ish"])("rejects %j with bad_ttl", (input) => {
    expect(() => resolveTokenExpiresAt(policy, input, now)).toThrow(
      expect.objectContaining({ status: 400, code: "bad_ttl" }),
    );
  });

  it("returns null for never only when this Energon allows it", () => {
    expect(resolveTokenExpiresAt(policy, "never", now)).toBeNull();
    const strict = tokenPolicy(env({ ALLOW_UNLIMITED_TOKENS: "false" }));
    let error: unknown;
    try {
      resolveTokenExpiresAt(strict, "never", now);
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ status: 400, code: "bad_ttl" });
    expect(String((error as Error).message)).not.toContain("never");
  });

  it("writes a parseable ISO value for every preset that is live at mint time", () => {
    for (const preset of policy.presets) {
      const value = resolveTokenExpiresAt(policy, preset.id, now);
      if (preset.id === "never") {
        expect(value).toBeNull();
        continue;
      }
      expect(Number.isFinite(Date.parse(String(value)))).toBe(true);
      expect(tokenExpired(value, now.getTime())).toBe(false);
    }
  });
});

describe("tokenExpired", () => {
  const now = Date.parse("2026-09-02T12:00:00.000Z");

  it("treats null as never expiring", () => {
    expect(tokenExpired(null, now)).toBe(false);
    expect(tokenExpired(undefined, now)).toBe(false);
  });

  it("fails closed on empty or unparseable values", () => {
    expect(tokenExpired("", now)).toBe(true);
    expect(tokenExpired("not-a-date", now)).toBe(true);
  });

  it("compares parsed instants, honoring offsets and the at-or-before boundary", () => {
    expect(tokenExpired("2026-09-02T13:59:00+02:00", now)).toBe(true);
    expect(tokenExpired("2026-09-02T15:00:00+02:00", now)).toBe(false);
    expect(tokenExpired("2026-09-02T12:00:00.000Z", now)).toBe(true);
    expect(tokenExpired("2026-09-02T12:00:00.001Z", now)).toBe(false);
  });
});
