import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpBody } from "../../src/auth";
import { llmsTxt } from "../../src/llms";
import { authMarkdown } from "../../src/auth-doc";
import { renderMarkdown } from "../../src/markdown";
import type { Env } from "../../src/types";
import { GOLDEN_ROOT, assertGolden, assertJsonGolden, canonicalize } from "./golden";

const FIXTURE_ORIGIN = "https://hub.energon.example.com";
const FIXTURE_ENV = {
  PUBLIC_ORIGIN: FIXTURE_ORIGIN,
  CONTENT_ORIGIN: "https://energon.example.com",
  TOKEN_ENV: "ENERGON_TOKEN",
  SKILL_NAME: "energon",
  MARKETPLACE_NAME: "energon",
  MARKETPLACE_REPO: "tmchow/energon",
  ALLOW_UNLIMITED_RETENTION: "true",
  DEFAULT_TTL: "never",
  MAX_TTL: "never",
  WRITE_POLICY: "instance",
  ALLOW_UNLIMITED_TOKENS: "true",
  ALLOWED_EMAIL_DOMAINS: "esperlabs.app,esperlabs.ai",
} as Env;

describe("canonicalize", () => {
  it("normalizes CRLF and trailing whitespace to LF with one trailing newline", () => {
    expect(canonicalize("a \r\nb\r\n")).toBe("a\nb\n");
    expect(canonicalize("a\n\n")).toBe("a\n");
  });
});

describe("agent docs", () => {
  it("freezes GET /auth.md for the worker fixture instance", () => {
    assertGolden("auth/default.md", authMarkdown(FIXTURE_ENV));
  });

  it("freezes GET /v1/help for the worker fixture instance", () => {
    assertJsonGolden("help/default.json", helpBody(FIXTURE_ORIGIN, FIXTURE_ENV));
  });

  it("freezes GET /llms.txt for the worker fixture instance", () => {
    assertGolden("llms/default.txt", llmsTxt(FIXTURE_ORIGIN, FIXTURE_ENV));
  });
});

describe("markdown HTML", () => {
  const dir = join(GOLDEN_ROOT, "markdown");
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  it.each(sources)("renders %s", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    const { html, mermaid } = renderMarkdown(src);
    expect(mermaid).toBe(/^(```|~~~)[ \t]*mermaid\b/im.test(src));
    assertGolden(`markdown/${file.replace(/\.md$/, ".html")}`, html);
  });
});
