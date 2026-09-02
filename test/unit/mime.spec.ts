import { describe, expect, it } from "vitest";
import { contentTypeFor } from "../../src/mime";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("contentTypeFor", () => {
  it("prefers a text extension over magic", () => {
    expect(contentTypeFor("notes.json", bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0))).toBe("application/json; charset=utf-8");
  });

  it("sniffs common magic even without an extension", () => {
    expect(contentTypeFor("file", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(contentTypeFor("file", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(contentTypeFor("file", bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(contentTypeFor("file", bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(contentTypeFor("file", bytes(0x25, 0x50, 0x44, 0x46))).toBe("application/pdf");
    expect(contentTypeFor("file", bytes(0x50, 0x4b, 0x03, 0x04))).toBe("application/zip");
    expect(contentTypeFor("file", bytes(0x50, 0x4b, 0x05, 0x06))).toBe("application/zip");
    expect(contentTypeFor("file", bytes(0x50, 0x4b, 0x07, 0x08))).toBe("application/zip");
    expect(contentTypeFor("file", bytes(0x1f, 0x8b, 0x08))).toBe("application/gzip");
  });

  it("does not treat a short PNG or GIF prefix as those types", () => {
    expect(contentTypeFor("file", bytes(0x89, 0x50, 0x4e, 0x47))).toBe("application/octet-stream");
    expect(contentTypeFor("file", bytes(0x47, 0x49, 0x46, 0x38))).toBe("application/octet-stream");
  });

  it("lets a known non-zip extension win over zip magic", () => {
    expect(contentTypeFor("photo.png", bytes(0x50, 0x4b, 0x03, 0x04))).toBe("image/png");
  });

  it("falls back to hint, then octet-stream", () => {
    expect(contentTypeFor("file.bin", bytes(1, 2, 3), "application/x-custom")).toBe("application/x-custom");
    expect(contentTypeFor("file.bin", bytes(1, 2, 3), "application/octet-stream")).toBe("application/octet-stream");
    expect(contentTypeFor("file.bin", bytes(1, 2, 3))).toBe("application/octet-stream");
  });
});
