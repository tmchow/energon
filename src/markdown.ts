import { uiPage } from "./ui-render";
import { marked } from "marked";
import xss, { type IWhiteList, type SafeAttrValueHandler } from "xss";
import { privateCacheControl } from "./cache";
import { escapeHtml } from "./chrome";
import { PRODUCT } from "./config";
import { applyIsolation, basename, contentDisposition, mermaidDocumentCsp, MD_EXPAND_SCRIPT_PATH, MERMAID_SCRIPT_PATH, wantsDownload } from "./http";

const MERMAID_FENCE = /^(```|~~~)[ \t]*mermaid\b/im;

// xss is CommonJS; these helpers are properties of its callable default export.
const xssRuntime = xss as typeof xss & {
  getDefaultWhiteList(): IWhiteList;
  safeAttrValue: SafeAttrValueHandler;
};

marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      if ((lang || "").trim().toLowerCase() === "mermaid") {
        return `<pre class="mermaid">${escapeCode(text)}</pre>`;
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<pre><code${cls}>${escapeCode(text)}</code></pre>`;
    },
  },
});

export function isMarkdownName(name: string): boolean {
  return basename(name).toLowerCase().endsWith(".md");
}

export function wantsRawMarkdown(request: Request): boolean {
  const raw = new URL(request.url).searchParams.get("raw");
  if (raw === "1" || raw === "true" || raw === "") return true;
  const accept = request.headers.get("accept") || "";
  return !/\btext\/html\b/i.test(accept);
}

const whiteList = xssRuntime.getDefaultWhiteList();
whiteList.pre = ["class"];
whiteList.code = ["class"];
whiteList.img = ["src", "alt", "title"];
whiteList.input = ["type", "checked", "disabled"];
whiteList.table = [];
whiteList.thead = [];
whiteList.tbody = [];
whiteList.tr = [];
whiteList.th = ["align"];
whiteList.td = ["align"];
whiteList.details = [];
whiteList.summary = [];

export function renderMarkdown(md: string): { html: string; mermaid: boolean; tables: boolean } {
  const dirty = marked.parse(md, { async: false }) as string;
  const html = xss(dirty, {
    whiteList,
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
    css: false,
    safeAttrValue(tag, name, value, cssFilter) {
      if (tag === "img" && name === "src") {
        const src = value.trim();
        if (src.startsWith("https://")) return src;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) && !src.startsWith("//")) return src;
        return "";
      }
      if (tag === "input" && name === "type" && value !== "checkbox") return "";
      return xssRuntime.safeAttrValue(tag, name, value, cssFilter);
    },
  });
  return {
    html,
    mermaid: MERMAID_FENCE.test(md) || html.includes('class="mermaid"'),
    tables: /<table\b/i.test(html),
  };
}

export function markdownPage(opts: { title: string; html: string; mermaid: boolean; tables?: boolean }): string {
  const extraHead = opts.mermaid ? mermaidRuntimeHead() : opts.tables ? expandHead() : "";
  return uiPage(`${opts.title} — ${PRODUCT}`, { page: "markdown", data: { html: opts.html } }, extraHead);
}

export async function respondMarkdown(
  request: Request,
  obj: R2ObjectBody,
  filenameRaw: string,
): Promise<Response> {
  const filename = basename(filenameRaw);
  const download = wantsDownload(request);
  if (download || wantsRawMarkdown(request)) {
    const headers = new Headers();
    headers.set("content-type", "text/markdown; charset=utf-8");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-disposition", contentDisposition(download ? "attachment" : "inline", filename));
    headers.set("cache-control", privateCacheControl());
    headers.set("vary", "Accept");
    if (obj.httpEtag) headers.set("etag", obj.httpEtag);
    return new Response(obj.body, { headers });
  }
  const rendered = renderMarkdown(await obj.text());
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": privateCacheControl(),
    vary: "Accept",
  });
  applyIsolation(headers, "text/html");
  if (rendered.mermaid || rendered.tables) headers.set("content-security-policy", mermaidDocumentCsp(new URL(request.url).origin));
  return new Response(
    markdownPage({ title: filename, html: rendered.html, mermaid: rendered.mermaid, tables: rendered.tables }),
    { headers },
  );
}

const MERMAID_FONT = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';

type MermaidPalette = {
  darkMode: boolean;
  background: string;
  node: string;
  cluster: string;
  text: string;
  border: string;
  borderSoft: string;
  line: string;
  edgeLabel: string;
  noteBkg: string;
  noteText: string;
  noteBorder: string;
};

function mermaidTheme(p: MermaidPalette) {
  return {
    darkMode: p.darkMode,
    background: p.background,
    primaryColor: p.node,
    primaryTextColor: p.text,
    primaryBorderColor: p.border,
    secondaryColor: p.cluster,
    secondaryTextColor: p.text,
    secondaryBorderColor: p.borderSoft,
    tertiaryColor: p.cluster,
    tertiaryTextColor: p.text,
    tertiaryBorderColor: p.borderSoft,
    lineColor: p.line,
    textColor: p.text,
    mainBkg: p.node,
    nodeBkg: p.node,
    nodeBorder: p.border,
    clusterBkg: p.cluster,
    clusterBorder: p.border,
    titleColor: p.text,
    edgeLabelBackground: p.edgeLabel,
    nodeTextColor: p.text,
    actorBkg: p.node,
    actorBorder: p.border,
    actorTextColor: p.text,
    actorLineColor: p.line,
    signalColor: p.line,
    signalTextColor: p.text,
    labelBoxBkgColor: p.node,
    labelBoxBorderColor: p.border,
    labelTextColor: p.text,
    labelBackground: p.edgeLabel,
    arrowheadColor: p.line,
    noteBkgColor: p.noteBkg,
    noteTextColor: p.noteText,
    noteBorderColor: p.noteBorder,
    scaleLabelColor: p.text,
    fontFamily: MERMAID_FONT,
    useGradient: false,
    dropShadow: "none",
  };
}

function mermaidThemeCss(theme: { edgeLabelBackground: string; textColor: string; nodeBorder: string }): string {
  const bg = theme.edgeLabelBackground;
  const fg = theme.textColor;
  const bd = theme.nodeBorder;
  return `.labelBkg{background:transparent;border:0;padding:0}span.edgeLabel p{background-color:${bg};color:${fg};border:1px solid ${bd};border-radius:4px;padding:1px 6px}span.edgeLabel:empty{display:none}g.edgeLabel rect{display:none}`;
}

// Mermaid bakes fills at initialize and cannot read CSS variables. Hex matches
// the design ramp except node/note fills that need extra elevation on dark.
const MERMAID_THEME_LIGHT = mermaidTheme({
  darkMode: false,
  background: "#f6f4fb",
  node: "#ffffff",
  cluster: "#d6d0e8",
  text: "#14111f",
  border: "#6b6486",
  borderSoft: "#8c85a6",
  line: "#3a3452",
  edgeLabel: "#ffffff",
  noteBkg: "#fff4d6",
  noteText: "#14111f",
  noteBorder: "#ecd08a",
});
const MERMAID_THEME_DARK = mermaidTheme({
  darkMode: true,
  background: "#0d1220",
  node: "#2a2548",
  cluster: "#151a2c",
  text: "#ece8f8",
  border: "#9a93b3",
  borderSoft: "#9a93b3",
  line: "#c8c0de",
  edgeLabel: "#2a2548",
  noteBkg: "#2a2418",
  noteText: "#f3d2a8",
  noteBorder: "#7a6432",
});
const MERMAID_THEME_LIGHT_JSON = JSON.stringify(MERMAID_THEME_LIGHT);
const MERMAID_THEME_DARK_JSON = JSON.stringify(MERMAID_THEME_DARK);
const MERMAID_THEME_LIGHT_CSS_JSON = JSON.stringify(mermaidThemeCss(MERMAID_THEME_LIGHT));
const MERMAID_THEME_DARK_CSS_JSON = JSON.stringify(mermaidThemeCss(MERMAID_THEME_DARK));

// Run mermaid before loading expand. A failed expand import must not leave
// fences as source. Mount after run so every SVG is wrapped, not only the first.
const MERMAID_RUNTIME_HEAD = `<script type="module">
import mermaid from "${MERMAID_SCRIPT_PATH}";
const light = matchMedia("(prefers-color-scheme: light)").matches;
const fit = { useMaxWidth: false };
const theme = light ? ${MERMAID_THEME_LIGHT_JSON} : ${MERMAID_THEME_DARK_JSON};
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  securityLevel: "strict",
  flowchart: fit,
  sequence: fit,
  gantt: fit,
  class: fit,
  er: fit,
  state: fit,
  gitGraph: fit,
  journey: fit,
  timeline: fit,
  mindmap: fit,
  c4: fit,
  pie: fit,
  quadrantChart: fit,
  sankey: fit,
  requirement: fit,
  block: fit,
  architecture: fit,
  kanban: fit,
  packet: fit,
  radar: fit,
  treemap: fit,
  xyChart: fit,
  themeVariables: theme,
  themeCSS: light ? ${MERMAID_THEME_LIGHT_CSS_JSON} : ${MERMAID_THEME_DARK_CSS_JSON},
});
try {
  await mermaid.run({ querySelector: ".en-md pre.mermaid" });
} catch {
  /* keep whatever SVG mermaid drew */
}
try {
  const { mountMarkdownExpand } = await import("${MD_EXPAND_SCRIPT_PATH}");
  mountMarkdownExpand();
} catch {
  /* diagrams stay as inline SVG without the overlay */
}
</script>`;

function mermaidRuntimeHead(): string {
  return MERMAID_RUNTIME_HEAD;
}

function expandHead(): string {
  return `<script type="module">
import { mountMarkdownExpand } from "${MD_EXPAND_SCRIPT_PATH}";
mountMarkdownExpand();
</script>`;
}

function escapeCode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
