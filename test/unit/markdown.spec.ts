import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownPage, renderMarkdown } from "../../src/markdown";

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
  it("omits app chrome and expand scripts when mermaid and tables are absent", () => {
    const html = markdownPage({ title: "notes.md", html: "<h1>Hi</h1>", mermaid: false });
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain('class="en-md"');
    expect(html).toContain('class="en-md-page"');
    expect(html).not.toContain("en-md-wrap");
    expect(html).not.toMatch(/<a[^>]*class="en-brand"/);
    expect(html).not.toContain('class="en-top');
    expect(html).not.toContain('class="en-card');
    expect(html).not.toContain(">Raw<");
    expect(html).not.toContain('<script type="module"');
    expect(html).not.toContain("/static/md-expand.mjs");
    expect(html).not.toContain("/static/mermaid/");
  });

  it("loads mermaid with a system light and dark theme", () => {
    const html = markdownPage({ title: "diagram.md", html: '<pre class="mermaid">graph LR</pre>', mermaid: true });
    expect(html).toContain('matchMedia("(prefers-color-scheme: light)")');
    expect(html).toContain('theme: light ? "neutral" : "dark"');
    expect(html).toContain('securityLevel: "strict"');
    expect(html).toContain("useMaxWidth: false");
    expect(html).toContain("startOnLoad: false");
    expect(html).toContain("en-md-page");
    expect(html).toContain("/static/mermaid/mermaid.esm.min.mjs");
    expect(html).toContain("/static/md-expand.mjs");
    expect(html).toContain("mountMarkdownExpand");
    expect(html).toContain("xyChart: fit");
    expect(html).not.toContain("xychart: fit");
    expect(html).toContain("scaleLabelColor");
    expect(html).not.toContain("primaryColor:");
  });

  it("loads expand without mermaid on table-only pages", () => {
    const html = markdownPage({
      title: "grid.md",
      html: "<table><tr><th>A</th></tr></table>",
      mermaid: false,
      tables: true,
    });
    expect(html).toContain("/static/md-expand.mjs");
    expect(html).toContain("mountMarkdownExpand");
    expect(html).not.toContain("/static/mermaid/");
    expect(html).not.toContain("mermaid.initialize");
  });

  it("flags GFM tables without treating heading-only markdown as tabular", () => {
    expect(renderMarkdown("# Hi").tables).toBe(false);
    expect(renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n").tables).toBe(true);
  });

  it("shrinks mermaid previews without mermaid useMaxWidth", () => {
    const css = readFileSync(resolve("src/ui/styles.css"), "utf8");
    expect(css).toMatch(/\.en-md-page \{/);
    expect(css).toMatch(/body\.page-markdown \.en-md > :not\(\.mermaid\):not\(\.en-md-figure\) \{[\s\S]*?max-width: var\(--measure-md\)/);
    expect(css).toMatch(/--md-figure: calc\(var\(--measure-md\) \+ 6rem\)/);
    expect(css).toMatch(/body\.page-markdown \.en-md-diagram-preview \{[\s\S]*?min-height: 12\.5rem/);
    expect(css).toMatch(/body\.page-markdown \.en-md-table-preview \{[\s\S]*?overflow-x: auto/);
    expect(css).toMatch(/\.en-md-expand \{/);
    expect(css).not.toMatch(/\.en-md-diagram-lightbox/);
    const built = readFileSync(resolve("src/generated/ui.css"), "utf8");
    expect(built).toContain("en-md-diagram-preview");
    expect(built).toContain("en-md-table-preview");
    expect(built).toContain("en-md-expand");
    expect(built).not.toContain("en-md-diagram-lightbox");
  });
});
