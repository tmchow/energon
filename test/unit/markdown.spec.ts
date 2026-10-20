import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MERMAID_SCRIPT_URL, PELE_SCRIPT_URL } from "../../src/http";
import { markdownPage, renderMarkdown } from "../../src/markdown";

describe("markdown diagram vendor", () => {
  it("copies the pinned Pele and mermaid ESM into public/static", () => {
    const check = spawnSync(process.execPath, ["scripts/vendor-diagrams.mjs", "--check"], { encoding: "utf8" });
    expect(check.status, check.stderr || check.stdout).toBe(0);
    const pele = resolve("public/static/pele/lazy.js");
    expect(existsSync(pele)).toBe(true);
    const lazyChunks = [...readFileSync(pele, "utf8").matchAll(/"\.\/(chunks\/[^"]+\.js)"/g)].map((m) => m[1]);
    expect(lazyChunks.length).toBeGreaterThan(0);
    for (const chunk of lazyChunks) expect(existsSync(resolve("public/static/pele", chunk)), chunk).toBe(true);
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
    expect(html).not.toContain("/static/pele/");
  });

  it("renders diagrams with Pele and loads mermaid only as the fallback", async () => {
    const pele = { render: (source: string) => (source.includes("bad") ? Promise.reject(new Error("syntax")) : Promise.resolve({ svg: `<svg>${source}</svg>` })) };
    const run = await runDiagramRuntime(["graph LR", "graph TD\n  A[\"$$x^2$$\"]", "graph bad", "sequenceDiagram"], { pele });
    expect(run.pres.map((pre) => pre.innerHTML)).toEqual(["<svg>graph LR</svg>", "", "", "<svg>sequenceDiagram</svg>"]);
    expect(run.peleCalls.map((call) => call.source)).toEqual(["graph LR", "graph bad", "sequenceDiagram"]);
    expect(run.mermaidRuns).toEqual([[run.pres[1], run.pres[2]]]);
    expect(run.mermaidConfig).toMatchObject({ startOnLoad: false, theme: "base", securityLevel: "strict" });
    expect(run.events.at(-1)).toBe("expand");
    for (const call of run.peleCalls) {
      expect(call.options).toMatchObject({ responsive: false });
      expect(call.options).not.toHaveProperty("config");
    }
    expect(new Set(run.peleCalls.map((call) => call.options.idPrefix)).size).toBe(3);
  });

  it("skips mermaid when Pele draws every diagram", async () => {
    const run = await runDiagramRuntime(["graph LR"], { pele: { render: () => Promise.resolve({ svg: "<svg></svg>" }) } });
    expect(run.imports).not.toContain(MERMAID_SCRIPT_URL);
    expect(run.events).toEqual(["pele", "expand"]);
  });

  it("hands long sources to Pele so its own limit decides the fallback", async () => {
    const long = "graph LR\n" + "  A --> B\n".repeat(6000);
    const pele = { render: (source: string) => (source.length > 50000 ? Promise.reject(new Error("limit")) : Promise.resolve({ svg: "<svg></svg>" })) };
    const run = await runDiagramRuntime([long], { pele });
    expect(run.peleCalls).toHaveLength(1);
    expect(run.mermaidRuns).toEqual([[run.pres[0]]]);
  });

  it("falls back to mermaid for every diagram when Pele cannot load", async () => {
    const run = await runDiagramRuntime(["graph LR", "graph TD"], { pele: null });
    expect(run.mermaidRuns).toEqual([run.pres]);
    expect(run.events.at(-1)).toBe("expand");
  });

  it("still mounts expand when the mermaid fallback cannot load", async () => {
    const run = await runDiagramRuntime(["graph TD\n  A[\"$$x$$\"]"], { pele: { render: () => Promise.resolve({ svg: "" }) }, mermaid: null });
    expect(run.events).toEqual(["expand"]);
  });

  it("starts loading Pele before waiting on fonts", async () => {
    const run = await runDiagramRuntime(["graph LR"], { pele: { render: () => Promise.resolve({ svg: "<svg></svg>" }) }, holdFonts: true });
    expect(run.imports[0]).toBe(PELE_SCRIPT_URL);
    expect(run.events).toEqual(["pele", "expand"]);
  });

  it("keeps the mermaid fallback palette on the design tokens Pele uses", () => {
    const vars = new Map<string, string>();
    for (const file of ["src/ui/design/tokens/colors.css", "src/ui/styles.css"]) {
      const css = readFileSync(resolve(file), "utf8");
      for (const [, name, value] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        if (file.endsWith("styles.css") || !vars.has(name)) vars.set(name, value.trim());
      }
    }
    const cssColor = (value: string, mode: 0 | 1): string => {
      const pair = /^light-dark\((.+?),\s*(.+)\)$/.exec(value);
      if (pair) return cssColor(pair[1 + mode], mode);
      const ref = /^var\((--[\w-]+)\)$/.exec(value);
      if (ref) return cssColor(vars.get(ref[1]) ?? `missing ${ref[1]}`, mode);
      return value.toLowerCase();
    };
    const html = markdownPage({ title: "d.md", html: "", mermaid: true });
    const [, lightJson, darkJson] = /const theme = light \? (\{.*?\}) : (\{.*?\});/.exec(html) ?? [];
    const themes = [JSON.parse(lightJson), JSON.parse(darkJson)];
    const expected: Record<string, string> = {
      primaryColor: "var(--pele-surface)",
      edgeLabelBackground: "var(--pele-surface)",
      secondaryColor: "var(--pele-surface-alt)",
      lineColor: "var(--pele-line)",
      nodeBorder: "var(--pele-border)",
      textColor: "var(--pele-fg)",
      secondaryBorderColor: "light-dark(var(--paper-6), var(--ink-7))",
      background: "light-dark(var(--paper-0), var(--ink-2))",
      noteBkgColor: "light-dark(var(--amber-100), #2a2418)",
      noteTextColor: "light-dark(var(--paper-9), var(--amber-400))",
      noteBorderColor: "light-dark(var(--amber-200), var(--amber-600))",
    };
    for (const [key, css] of Object.entries(expected)) {
      for (const mode of [0, 1] as const) expect(themes[mode][key], `${key} ${mode ? "dark" : "light"}`).toBe(cssColor(css, mode));
    }
  });

  it("loads mermaid with a system light and dark theme", () => {
    const html = markdownPage({ title: "diagram.md", html: '<pre class="mermaid">graph LR</pre>', mermaid: true });
    expect(html).toContain("en-md-page");
    expect(html).toContain('matchMedia("(prefers-color-scheme: light)")');
    expect(html).toContain('theme: "base"');
    expect(html).toContain('securityLevel: "strict"');
    expect(html).toContain("useMaxWidth: false");
    expect(html).toContain("startOnLoad: false");
    expect(html).toContain("xyChart: fit");
    expect(html).not.toContain("xychart: fit");
    expect(html).toContain('"scaleLabelColor":"#ece8f8"');
    expect(html).toContain('"primaryColor":"#2a2548"');
    expect(html).toContain('"primaryColor":"#ffffff"');
    expect(html).toContain('"primaryTextColor":"#ece8f8"');
    expect(html).toContain('"lineColor":"#c8c0de"');
    expect(html).toContain('"clusterBkg":"#151a2c"');
    expect(html).toContain('"edgeLabelBackground":"#2a2548"');
    expect(html).toContain('"darkMode":true');
    expect(html).toContain('"useGradient":false');
    expect(html).toContain("g.edgeLabel rect{display:none");
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
    expect(html).not.toContain("/static/pele/");
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
    expect(css).toMatch(/body\.page-markdown \.en-md-diagram-open \{[\s\S]*?background: light-dark\(var\(--paper-2\), var\(--ink-2\)\)/);
    expect(css).toMatch(/body\.page-markdown \.en-md-diagram-preview \{[\s\S]*?min-height: 12\.5rem/);
    expect(css).toMatch(/body\.page-markdown \.en-md-table-preview \{[\s\S]*?overflow-x: auto/);
    expect(css).toMatch(/\.en-md-expand \{/);
    expect(css).toMatch(/\.en-md-expand \{[\s\S]*?background: var\(--bg-canvas\)/);
    expect(css).toMatch(/\.en-md-expand::backdrop \{[\s\S]*?background: light-dark\(var\(--paper-0\), var\(--ink-0\)\)/);
    expect(css).not.toMatch(/\.en-md-expand::backdrop \{[^}]*--bg-overlay/);
    expect(css).not.toMatch(/\.en-md-diagram-lightbox/);
    const peleTheme = css.match(/body\.page-markdown \{([^}]*--pele-[^}]*)\}/)?.[1] ?? "";
    for (const name of ["bg", "fg", "muted", "line", "surface", "surface-alt", "border", "accent", "font", "radius"]) {
      expect(peleTheme, `--pele-${name}`).toMatch(new RegExp(`--pele-${name}:`));
    }
    const built = readFileSync(resolve("src/generated/ui.css"), "utf8");
    expect(built).toContain("en-md-diagram-preview");
    expect(built).toContain("en-md-table-preview");
    expect(built).toContain("en-md-expand");
    expect(built).not.toContain("en-md-diagram-lightbox");
  });
});

type FakePre = { textContent: string; innerHTML: string };
type PeleFake = { render: (source: string) => Promise<{ svg: string }> } | null;

/** Runs the page's inline diagram module with fake Pele, mermaid, and expand modules. */
async function runDiagramRuntime(
  sources: string[],
  opts: { pele: PeleFake; mermaid?: null; holdFonts?: boolean },
) {
  const html = markdownPage({ title: "diagram.md", html: "", mermaid: true });
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(modules).toHaveLength(1);
  const pres: FakePre[] = sources.map((textContent) => ({ textContent, innerHTML: "" }));
  const events: string[] = [];
  const imports: string[] = [];
  const peleCalls: { source: string; options: Record<string, unknown> }[] = [];
  const mermaidRuns: FakePre[][] = [];
  let mermaidConfig: Record<string, unknown> = {};
  let releaseFonts = () => {};
  const fontsReady = opts.holdFonts ? new Promise<void>((resolve) => (releaseFonts = resolve)) : Promise.resolve();
  const load = async (path: string) => {
    imports.push(path);
    if (path === PELE_SCRIPT_URL) {
      if (!opts.pele) throw new Error("pele unavailable");
      const fake = opts.pele;
      return {
        renderAsync: (source: string, options: Record<string, unknown>) => {
          events.push("pele");
          peleCalls.push({ source, options });
          return fake.render(source);
        },
      };
    }
    if (path === MERMAID_SCRIPT_URL) {
      if (opts.mermaid === null) throw new Error("mermaid unavailable");
      return {
        default: {
          initialize: (config: Record<string, unknown>) => (mermaidConfig = config),
          run: async ({ nodes }: { nodes: FakePre[] }) => {
            events.push("mermaid");
            mermaidRuns.push(nodes);
          },
        },
      };
    }
    if (path === "/static/md-expand.mjs") return { mountMarkdownExpand: () => events.push("expand") };
    throw new Error(`unexpected import ${path}`);
  };
  const document = { querySelectorAll: () => pres, fonts: { ready: fontsReady } };
  const matchMedia = () => ({ matches: true });
  const body = modules[0].replace(/\bimport\(/g, "load(");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const done = new AsyncFunction("document", "matchMedia", "load", body)(document, matchMedia, load);
  if (opts.holdFonts) {
    await Promise.resolve();
    expect(imports).toEqual([PELE_SCRIPT_URL]);
    releaseFonts();
  }
  await done;
  return { pres, events, imports, peleCalls, mermaidRuns, mermaidConfig };
}
