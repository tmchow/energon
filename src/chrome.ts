import chromeCss from "./chrome.css";
import { PRODUCT } from "./config";
import type { Env } from "./types";

export { chromeCss };

export type HubPage = "hub" | "about" | "stats" | "setup" | "tokens";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=optional";

/** Signed-in HTML. `no-store` keeps Safari from using bfcache and makes every nav tap a full reload. */
export const PRIVATE_HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-cache",
};

export function chromeHead(): string {
  return `<link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="${FONT_HREF}" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="${FONT_HREF}"></noscript>
  <script>
  document.addEventListener("touchstart", function(){}, {passive:true});
  function navLink(e) {
    return e.target && e.target.closest && e.target.closest(".app-nav a[href], a.brand");
  }
  function clearPressed() {
    document.querySelectorAll(".app-nav a.pressed, a.brand.pressed").forEach(function(el){ el.classList.remove("pressed"); });
  }
  document.addEventListener("pointerdown", (e) => {
    const a = navLink(e);
    if (!a) return;
    a.classList.add("pressed");
    if (!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches)) return;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname === location.pathname) return;
      const href = u.pathname + u.search;
      if (document.querySelector('link[rel="prefetch"][href="' + href + '"]')) return;
      const l = document.createElement("link");
      l.rel = "prefetch";
      l.href = href;
      document.head.appendChild(l);
    } catch (err) {}
  }, { capture: true, passive: true });
  document.addEventListener("pointerup", clearPressed, { capture: true, passive: true });
  document.addEventListener("pointercancel", clearPressed, { capture: true, passive: true });
  </script>`;
}

/** Trimmed instance footer. Empty means do not render a chrome line. */
export function instanceFooter(env?: Pick<Env, "FOOTER_TEXT"> | null): string {
  return (env?.FOOTER_TEXT || "").trim();
}

/** Signed-in chrome only. Public gate / markdown / site pages omit this. */
export function appFooter(text?: string | null): string {
  const line = (text || "").trim();
  if (!line) return "";
  return `<footer class="app-footer"><div class="app-footer-inner">${escapeHtml(line)}</div></footer>`;
}

export function documentShell(opts: {
  title: string;
  body: string;
  bodyClass?: string;
  extraHead?: string;
  footer?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  ${chromeHead()}
  <style>${chromeCss}</style>
  ${opts.extraHead || ""}
</head>
<body class="${escapeHtml(opts.bodyClass || "")}">${opts.body}${appFooter(opts.footer)}</body>
</html>`;
}

export function appHeader(opts: { active?: HubPage; email?: string | null; end?: string }): string {
  const links: { href: string; id: HubPage; label: string }[] = [
    { href: "/", id: "hub", label: "Hub" },
    { href: "/tokens", id: "tokens", label: "Tokens" },
    { href: "/setup", id: "setup", label: "Setup" },
    { href: "/about", id: "about", label: "About" },
    { href: "/stats", id: "stats", label: "Stats" },
  ];
  const nav = links
    .map(
      (l) =>
        `<a href="${l.href}"${l.id === opts.active ? ' class="on" aria-current="page"' : ""}>${escapeHtml(l.label)}</a>`,
    )
    .join("");
  const end =
    opts.end ??
    (opts.email ? `<div class="who">${escapeHtml(opts.email)}</div>` : "");
  return `<header class="top"><div class="top-inner">
    <a class="brand" href="/"><div class="mark">${brandMark()}</div><div><div class="name">${escapeHtml(PRODUCT)}</div></div></a>
    <div class="top-end">
      <nav class="app-nav" aria-label="Pages">${nav}</nav>
      ${end}
    </div>
  </div></header>`;
}

export function brandMark(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><filter id="bm-glow" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="bm-top" x1="32" y1="10" x2="32" y2="34" gradientUnits="userSpaceOnUse"><stop stop-color="#c9b0ff" stop-opacity="0.32"/><stop offset="1" stop-color="#6a4cff" stop-opacity="0.05"/></linearGradient><linearGradient id="bm-left" x1="12" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#5c48d8" stop-opacity="0.2"/><stop offset="1" stop-color="#1a1440" stop-opacity="0.04"/></linearGradient><linearGradient id="bm-right" x1="52" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#b08cff" stop-opacity="0.24"/><stop offset="1" stop-color="#2a1d66" stop-opacity="0.05"/></linearGradient></defs><polygon fill="url(#bm-top)" points="32,11 51,22 32,33 13,22"/><polygon fill="url(#bm-left)" points="13,22 32,33 32,51 13,40"/><polygon fill="url(#bm-right)" points="51,22 32,33 32,51 51,40"/><g fill="none" stroke="#8a6cff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><path d="M32 11v18"/><path d="M32 29 51 40"/><path d="M32 29 13 40"/></g><g fill="none" stroke="#f3ecff" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" filter="url(#bm-glow)"><path d="M32 11 51 22 32 33 13 22Z"/><path d="M13 22v18l19 11 19-11V22"/><path d="M32 33v18"/></g></svg>`;
}

export function productName(): string {
  return PRODUCT;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
