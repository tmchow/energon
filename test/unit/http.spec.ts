import { describe, expect, it } from "vitest";
import { formatBytes, formatCount } from "../../src/config";
import {
  accountOriginRequired,
  assertTrustedAccountOrigin,
  contentOrigin,
  contentDisposition,
  hasDedicatedContentOrigin,
  isolationCsp,
  isPublicContentPath,
  isWorkersDev,
  normalizeRelPath,
  tooLarge,
  wantsDownload,
} from "../../src/http";
import type { Env } from "../../src/types";

const originEnv = (overrides: Partial<Pick<Env, "PUBLIC_ORIGIN" | "CONTENT_ORIGIN">> = {}) =>
  ({ PUBLIC_ORIGIN: "https://hub.example.com", CONTENT_ORIGIN: "https://content.example.com", ...overrides }) as Env;

describe("path and download helpers", () => {
  it("requires a separate content origin", () => {
    expect(contentOrigin(originEnv())).toBe("https://content.example.com");
    expect(hasDedicatedContentOrigin(originEnv())).toBe(true);
    expect(hasDedicatedContentOrigin(originEnv({ CONTENT_ORIGIN: "https://hub.example.com" }))).toBe(false);
    expect(() => contentOrigin(originEnv({ CONTENT_ORIGIN: "https://hub.example.com" }))).toThrow(
      "CONTENT_ORIGIN must differ from PUBLIC_ORIGIN",
    );
    expect(contentOrigin(originEnv({ PUBLIC_ORIGIN: "http://127.0.0.1:8787", CONTENT_ORIGIN: "http://127.0.0.1:8787" }))).toBe(
      "http://127.0.0.1:8787",
    );
    expect(isPublicContentPath("/ada/s/demo/")).toBe(true);
    expect(isPublicContentPath("/account/s/demo/")).toBe(false);
    expect(isPublicContentPath("/%61ccount/f/abc123/file.html")).toBe(false);
  });

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

  it("sandboxes HTML and SVG without allow-same-origin", () => {
    expect(isolationCsp("text/html; charset=utf-8")).toContain("sandbox");
    expect(isolationCsp("text/html")).not.toContain("allow-same-origin");
    expect(isolationCsp("image/svg+xml")).toContain("sandbox");
    expect(isolationCsp("text/plain")).toBeNull();
    expect(isolationCsp("application/javascript")).toBeNull();
  });

  it("requires Origin on account mutations and token reveal", () => {
    expect(accountOriginRequired("POST", "/account/tokens")).toBe(true);
    expect(accountOriginRequired("PATCH", "/account/sites/demo")).toBe(true);
    expect(accountOriginRequired("GET", "/account/tokens/abc")).toBe(true);
    expect(accountOriginRequired("GET", "/account/data")).toBe(false);
    expect(accountOriginRequired("GET", "/account/files/abc/download")).toBe(false);
    const bad = new Request("http://127.0.0.1/account/tokens", { method: "POST" });
    expect(() => assertTrustedAccountOrigin(bad)).toThrow(/hub origin/);
    const cross = new Request("http://127.0.0.1/account/tokens", {
      method: "POST",
      headers: { origin: "https://energon.example.com" },
    });
    expect(() => assertTrustedAccountOrigin(cross)).toThrow(/hub origin/);
    const ok = new Request("http://127.0.0.1/account/tokens", {
      method: "POST",
      headers: { origin: "http://127.0.0.1" },
    });
    expect(() => assertTrustedAccountOrigin(ok)).not.toThrow();
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
