import { describe, expect, it } from "vitest";
import { formatBytes, formatCount } from "../../src/config";
import {
  contentDisposition,
  isWorkersDev,
  normalizeRelPath,
  tooLarge,
  wantsDownload,
} from "../../src/http";

describe("path and download helpers", () => {
  it("rejects traversal and junk path segments", () => {
    expect(normalizeRelPath("css/app.css")).toBe("css/app.css");
    expect(normalizeRelPath("./css/./app.css")).toBe("css/app.css");
    expect(normalizeRelPath("../secret")).toBeNull();
    expect(normalizeRelPath("/etc/passwd")).toBeNull();
    expect(normalizeRelPath("ok/__MACOSX/x")).toBeNull();
    expect(normalizeRelPath("")).toBeNull();
  });

  it("treats download=1, true, or empty as an attachment", () => {
    expect(wantsDownload(new Request("https://e.test/f?download=1"))).toBe(true);
    expect(wantsDownload(new Request("https://e.test/f?download=true"))).toBe(true);
    expect(wantsDownload(new Request("https://e.test/f?download="))).toBe(true);
    expect(wantsDownload(new Request("https://e.test/f"))).toBe(false);
    expect(wantsDownload(new Request("https://e.test/f?download=0"))).toBe(false);
  });

  it("builds a single-line Content-Disposition", () => {
    expect(contentDisposition("attachment", 'notes"\n.md')).toBe('attachment; filename="notes.md"');
    expect(contentDisposition("inline", "index.html")).toBe('inline; filename="index.html"');
  });

  it("spots workers.dev hosts", () => {
    expect(isWorkersDev("energon.workers.dev")).toBe(true);
    expect(isWorkersDev("energon.example.com")).toBe(false);
  });

  it("tooLarge names the instance cap", () => {
    const err = tooLarge(6 * 1024 * 1024, "", 5 * 1024 * 1024);
    expect(err.status).toBe(413);
    expect(err.code).toBe("too_large");
    expect(err.message).toContain("5 MB");
    expect(err.message).not.toContain("25 MB");
    expect(err.extra.limit_bytes).toBe(5 * 1024 * 1024);
  });
});

describe("display helpers", () => {
  it("formats bytes and counts the way Stats shows them", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatCount(180)).toBe("180");
  });
});
