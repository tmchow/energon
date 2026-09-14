import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownPage } from "../../src/markdown";

describe("markdown mermaid vendor", () => {
  it("copies the pinned mermaid ESM into public/static/mermaid", () => {
    const check = spawnSync(process.execPath, ["scripts/vendor-mermaid.mjs", "--check"], { encoding: "utf8" });
    expect(check.status, check.stderr || check.stdout).toBe(0);
    const entry = resolve("public/static/mermaid/mermaid.esm.min.mjs");
    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(entry, "utf8")).toContain("chunks/mermaid.esm.min/");
  });
});

describe("markdown page shell", () => {
  it("omits app chrome when mermaid is absent", () => {
    const html = markdownPage({ title: "notes.md", html: "<h1>Hi</h1>", mermaid: false });
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain('class="en-md"');
    expect(html).not.toMatch(/<a[^>]*class="en-brand"/);
    expect(html).not.toContain('class="en-top');
    expect(html).not.toContain('class="en-card');
    expect(html).not.toContain(">Raw<");
    expect(html).not.toContain('<script type="module"');
  });

  it("loads mermaid with a system light and dark theme", () => {
    const html = markdownPage({ title: "diagram.md", html: '<pre class="mermaid">graph LR</pre>', mermaid: true });
    expect(html).toContain('matchMedia("(prefers-color-scheme: light)")');
    expect(html).toContain('theme: light ? "neutral" : "dark"');
    expect(html).toContain('securityLevel: "strict"');
  });
});
