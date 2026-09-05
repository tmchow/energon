import { uiPage } from "./ui-render";
import { marked } from "marked";
import xss, { type IWhiteList, type SafeAttrValueHandler } from "xss";
import { privateCacheControl } from "./cache";
import { escapeHtml } from "./chrome";
import { PRODUCT } from "./config";
import { applyIsolation, basename, contentDisposition, mermaidDocumentCsp, MERMAID_SCRIPT_PATH, wantsDownload } from "./http";

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

export function renderMarkdown(md: string): { html: string; mermaid: boolean } {
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
  return { html, mermaid: MERMAID_FENCE.test(md) || html.includes('class="mermaid"') };
}

export function markdownPage(opts: {
  title: string;
  filename: string;
  rawHref: string;
  size?: number;
  updatedAt?: string;
  html: string;
  mermaid: boolean;
}): string {
  return uiPage(`${opts.title} — ${PRODUCT}`, { page: "markdown", data: opts }, opts.mermaid ? mermaidHead() : "");
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
  const rawHref = `${new URL(request.url).pathname}?raw=1`;
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": privateCacheControl(),
    vary: "Accept",
  });
  applyIsolation(headers, "text/html");
  if (rendered.mermaid) headers.set("content-security-policy", mermaidDocumentCsp(new URL(request.url).origin));
  return new Response(
    markdownPage({
      title: filename,
      filename,
      rawHref,
      size: obj.size,
      updatedAt: obj.uploaded.toISOString(),
      html: rendered.html,
      mermaid: rendered.mermaid,
    }),
    { headers },
  );
}

function mermaidHead(): string {
  return `<script type="module">
import mermaid from "${MERMAID_SCRIPT_PATH}";
mermaid.initialize({
  startOnLoad: true,
  theme: "dark",
  securityLevel: "strict",
  themeVariables: {
    darkMode: true,
    background: "#070814",
    primaryColor: "#16102a",
    primaryTextColor: "#ece8f8",
    primaryBorderColor: "#8a6cff",
    lineColor: "#9a93b3",
    secondaryColor: "#0d1220",
    tertiaryColor: "#10162a",
  },
});
</script>`;
}

function escapeCode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
