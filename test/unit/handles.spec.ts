import { describe, expect, it } from "vitest";
import { RESERVED_HANDLES } from "../../src/config";
import { assertHandle, handleFromEmail } from "../../src/handles";

describe("handleFromEmail", () => {
  it("uses the email local-part as a URL handle", () => {
    expect(handleFromEmail("ada@esperlabs.app")).toBe("ada");
    expect(handleFromEmail("Trevin.Chow@esperlabs.app")).toBe("trevin-chow");
  });

  it("never claims a reserved product path", () => {
    for (const reserved of RESERVED_HANDLES) {
      const handle = handleFromEmail(`${reserved}@esperlabs.app`);
      expect(RESERVED_HANDLES.has(handle)).toBe(false);
      expect(handle).not.toBe(reserved);
    }
  });
});

describe("assertHandle", () => {
  it("accepts a live handle and rejects reserved or malformed ones", () => {
    expect(assertHandle("ada")).toBe("ada");
    expect(assertHandle(" Ada ")).toBe("ada");
    expect(assertHandle("about")).toBeNull();
    expect(assertHandle("tokens")).toBeNull();
    expect(assertHandle("-nope")).toBeNull();
    expect(assertHandle("")).toBeNull();
  });
});
