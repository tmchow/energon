import { describe, expect, it } from "vitest";
import { MEMORABLE_WORDS, memorablePassword, pickMemorableWords } from "../../src/memorable";
import { passwordEcho } from "../../src/gate";

describe("memorable passwords", () => {
  it("has unique common words", () => {
    expect(MEMORABLE_WORDS.length).toBeGreaterThanOrEqual(256);
    expect(new Set(MEMORABLE_WORDS).size).toBe(MEMORABLE_WORDS.length);
  });

  it("joins three words from the list", () => {
    const pw = memorablePassword(3, (buf) => {
      buf[0] = 0;
      buf[1] = 1;
      buf[2] = 2;
      return buf;
    });
    expect(pw).toBe(`${MEMORABLE_WORDS[0]}-${MEMORABLE_WORDS[1]}-${MEMORABLE_WORDS[2]}`);
    expect(pickMemorableWords(3, (buf) => {
      buf[0] = 0;
      buf[1] = 1;
      buf[2] = 2;
      return buf;
    })).toEqual([MEMORABLE_WORDS[0], MEMORABLE_WORDS[1], MEMORABLE_WORDS[2]]);
  });
});

describe("password echo", () => {
  it("returns the phrase only when a write just set it", () => {
    expect(passwordEcho(undefined, "hash")).toBeUndefined();
    expect(passwordEcho("  secret  ", "hash")).toBe("secret");
    expect(passwordEcho("", null)).toBeNull();
    expect(passwordEcho("gone", null)).toBeNull();
  });
});
