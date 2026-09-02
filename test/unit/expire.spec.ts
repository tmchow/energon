import { describe, expect, it } from "vitest";
import { isExpired, isPurgeClaimed, remainingCacheSeconds } from "../../src/expire";

describe("isPurgeClaimed", () => {
  it("is only the in-progress purge marker", () => {
    expect(isPurgeClaimed("__energon_purging__")).toBe(true);
    expect(isPurgeClaimed("__energon_purging__:claim-id")).toBe(true);
    expect(isPurgeClaimed("ada@esperlabs.app")).toBe(false);
    expect(isPurgeClaimed(null)).toBe(false);
  });
});

describe("isExpired", () => {
  it("treats null as keep-until-deleted", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });

  it("is true at and after expires_at", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    expect(isExpired("2026-06-01T00:00:00.000Z", now)).toBe(true);
    expect(isExpired("2026-05-31T23:59:59.000Z", now)).toBe(true);
    expect(isExpired("2026-06-01T00:00:01.000Z", now)).toBe(false);
  });
});

describe("remainingCacheSeconds", () => {
  it("caps edge cache to the leftover TTL", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(remainingCacheSeconds(null, now)).toBeNull();
    expect(remainingCacheSeconds("2026-01-01T00:00:10.000Z", now)).toBe(10);
    expect(remainingCacheSeconds("2025-12-31T00:00:00.000Z", now)).toBe(0);
  });
});
