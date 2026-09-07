import { describe, expect, it } from "vitest";
import { STALE_TOKEN_DAYS, bulkRevokeEligible, tokenStatus } from "../../src/token-status";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const DAY = 86400000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (over: Partial<Parameters<typeof tokenStatus>[0]>) => ({
  created_at: iso(1),
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
  ...over,
});

describe("tokenStatus", () => {
  it("revoked wins over expired, expired wins over stale", () => {
    expect(tokenStatus(row({ revoked_at: iso(0), expires_at: iso(1), created_at: iso(400) }), NOW)).toBe("revoked");
    expect(tokenStatus(row({ expires_at: iso(1), created_at: iso(400) }), NOW)).toBe("expired");
    expect(tokenStatus(row({ expires_at: "garbage" }), NOW)).toBe("expired");
  });

  it("counts staleness from last use, or from mint when never used", () => {
    expect(tokenStatus(row({ created_at: iso(STALE_TOKEN_DAYS - 1) }), NOW)).toBe("live");
    expect(tokenStatus(row({ created_at: iso(STALE_TOKEN_DAYS) }), NOW)).toBe("stale");
    expect(tokenStatus(row({ created_at: iso(400), last_used_at: iso(2) }), NOW)).toBe("live");
    expect(tokenStatus(row({ created_at: iso(400), last_used_at: iso(STALE_TOKEN_DAYS + 1) }), NOW)).toBe("stale");
    expect(tokenStatus(row({ created_at: iso(1), expires_at: new Date(NOW + DAY).toISOString() }), NOW)).toBe("live");
  });

  it("bulk targets select by status", () => {
    expect(["live", "stale", "expired", "revoked"].filter((s) => bulkRevokeEligible("stale", s as never))).toEqual(["stale"]);
    expect(["live", "stale", "expired", "revoked"].filter((s) => bulkRevokeEligible("all", s as never))).toEqual(["live", "stale", "expired"]);
  });
});
