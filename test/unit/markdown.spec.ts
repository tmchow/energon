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
    const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const mermaidRuntime = modules.find((src) => src.includes("mermaid.initialize"));
    expect(modules).toHaveLength(1);
    expect(mermaidRuntime).toBeTruthy();
    expect(mermaidRuntime).toMatch(/import mermaid from "\/static\/mermaid\/mermaid\.esm\.min\.mjs"/);
    expect(mermaidRuntime).not.toMatch(/import \{ mountMarkdownExpand \} from/);
    expect(mermaidRuntime).not.toContain("postRenderCallback");
    expect(mermaidRuntime.indexOf("mermaid.initialize")).toBeLessThan(mermaidRuntime.indexOf("await mermaid.run"));
    expect(mermaidRuntime.indexOf("await mermaid.run")).toBeLessThan(mermaidRuntime.indexOf(`await import("${"/static/md-expand.mjs"}")`));
    expect(mermaidRuntime).toMatch(/try \{\s*const \{ mountMarkdownExpand \} = await import\("\/static\/md-expand\.mjs"\)/);
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
    expect(html).toMatch(/import \{ mountMarkdownExpand \} from "\/static\/md-expand\.mjs"/);
    expect(html).not.toContain("postRenderCallback");
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
    expect(css).toMatch(/\.en-md-expand \{[\s\S]*?background: var\(--bg-canvas\)/);
    expect(css).toMatch(/\.en-md-expand::backdrop \{[\s\S]*?background: light-dark\(var\(--paper-0\), var\(--ink-0\)\)/);
    expect(css).not.toMatch(/\.en-md-expand::backdrop \{[^}]*--bg-overlay/);
    expect(css).not.toMatch(/\.en-md-diagram-lightbox/);
    const built = readFileSync(resolve("src/generated/ui.css"), "utf8");
    expect(built).toContain("en-md-diagram-preview");
    expect(built).toContain("en-md-table-preview");
    expect(built).toContain("en-md-expand");
    expect(built).not.toContain("en-md-diagram-lightbox");
  });
});
