import { describe, expect, it } from "vitest";
import { nextNumberedSlug } from "../../src/slugs";

describe("nextNumberedSlug", () => {
  it("appends -2, then increments the trailing number", () => {
    expect(nextNumberedSlug("viewport-docs")).toBe("viewport-docs-2");
    expect(nextNumberedSlug("viewport-docs-2")).toBe("viewport-docs-3");
    expect(nextNumberedSlug("viewport-docs-10")).toBe("viewport-docs-11");
  });

  it("keeps the result a valid short slug", () => {
    const long = "a".repeat(63);
    const next = nextNumberedSlug(long);
    expect(next.endsWith("-2")).toBe(true);
    expect(next.length).toBeLessThanOrEqual(63);
    expect(nextNumberedSlug("")).toBe("site-2");
  });
});
