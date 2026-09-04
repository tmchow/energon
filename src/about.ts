import { appHeader, documentShell, escapeHtml, instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import type { Actor, Env } from "./types";

export function aboutResponse(actor: Actor, env?: Env): Response {
  return new Response(aboutPage(actor.email, instanceFooter(env)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

export function aboutPage(email: string, footer = ""): string {
  return documentShell({
    title: `About — ${PRODUCT}`,
    bodyClass: "page-about",
    footer,
    body: `${appHeader({ active: "about", email })}
    <main class="wrap about-wrap">
      <h1 class="display">Why use ${escapeHtml(PRODUCT)}?</h1>
      <p class="lede">Agent-native publishing for documents, prototypes, and working files. Built for agents to publish, read, reference, and revise ordinary files. Ready for people to open, explore, and upload directly. Permitted updates keep the same URL across sessions and agent tools.</p>
      <p class="lede">Once this instance is running: no repo to create, no deployment pipeline to configure, no new link for every update. Publish prepared files from your browser or your agent. Your operator runs the host in their own Cloudflare account.</p>
      <nav class="scene-nav" aria-label="Scenes">
        <a href="#prototype">Prototype</a>
        <a href="#handoff">Read and reference</a>
        <a href="#pong">Revise</a>
        <a href="#living">Keep or copy</a>
        <a href="#public">Public links</a>
      </nav>

      <section class="scene" id="prototype">
        <div class="scene-copy">
          <p class="scene-kicker">01</p>
          <h2>Open a working prototype</h2>
          <p>Upload a prepared HTML folder or ZIP, or ask your agent to publish it. With an <code>index.html</code>, the link opens the actual site and its assets, ready to explore in a browser.</p>
          <p>Open it yourself or send the link to someone else. If your prototype needs a build step, build it before uploading; ${escapeHtml(PRODUCT)} serves the output and does not run server-side code.</p>
        </div>
        ${diagram("proto", "Less ceremony. The folder becomes a link.")}
      </section>

      <section class="scene" id="handoff">
        <div class="scene-copy">
          <p class="scene-kicker">02</p>
          <h2>Read now. Reference later.</h2>
          <p>A Markdown brief opens as a readable page. Give its link to your agent tomorrow, or to another agent on a different machine, to read as reference for the next task. Reading does not require permission to edit.</p>
          <p>The same work is readable by people and retrievable as files by agents. For Markdown source, use <code>?raw=1</code>. An agent can also use the authenticated file URL with its own token from this instance.</p>
        </div>
        ${diagram("hand", "One session publishes. Another reads or references the work.")}
      </section>

      <section class="scene" id="pong">
        <div class="scene-copy">
          <p class="scene-kicker">03</p>
          <h2>Revise the work. Keep the link.</h2>
          <p>Read a plan, ask your agent for a change, then reopen the same link. The creator chooses whether only their account or other authorized users and agents on this instance may update or delete the work.</p>
          <p>There is no editor here: people edit in their own tools or through agents, which replace the underlying file. Last write wins. The link shows current contents, without comments, merges, or revision history. Keep work that needs reviewed history in your repository.</p>
        </div>
        ${diagram("pong", "Take a turn. Same link. Last write wins.")}
      </section>

      <section class="scene" id="living">
        <div class="scene-copy">
          <p class="scene-kicker">04</p>
          <h2>Continue here, or make a copy</h2>
          <p>Updates keep the same address until the work expires or is deleted. Replacing contents does not extend expiration. A stable link is a reference to current work, not a frozen revision.</p>
          <p>To explore another direction, a signed-in user or an agent with an instance token can duplicate a file or site. The copy has its own link, owner, and settings; it does not inherit the original's password. Choose its write policy and expiration for the new purpose.</p>
        </div>
        ${diagram("live", "Updates keep the address until expiry or deletion.")}
      </section>

      <section class="scene scene-open" id="public">
        <div class="scene-copy">
          <p class="scene-kicker">05</p>
          <h2>Links are open by default</h2>
          <p>You sign in to upload, or give your agent a token. Recipients need no company login to open published links. Add a share password when the public link needs a gate.</p>
          <p>A share password does not restrict reads through the API: any valid token on this instance can still read the underlying work. If you need access limited to named recipients, use a system with per-reader permissions.</p>
        </div>
        ${diagram("open", "Sign in to publish. Links are open by default, with optional passwords.")}
      </section>
    </main>`,
  });
}

function diagram(kind: "proto" | "hand" | "pong" | "live" | "open", caption: string): string {
  return `<figure class="diagram diagram-${kind}" aria-hidden="true">${art(kind)}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function art(kind: "proto" | "hand" | "pong" | "live" | "open"): string {
  const g = glow(kind);
  if (kind === "proto") {
    return svg(g, `
      ${files(18, 18)}
      ${arrow(74, 50, 102, 50)}
      ${cubeMark(108, 16)}
      ${arrow(180, 50, 208, 50)}
      ${windowFrame(216, 16)}
      ${label(48, 94, "Folder")}
      ${label(140, 94, "URL")}
      ${label(256, 94, "Browser")}`);
  }
  if (kind === "hand") {
    return svg(g, `
      ${session(12, 16, "A")}
      ${arrow(80, 48, 102, 48)}
      ${urlPill(108, 32, "/f/{id}/file", "hand")}
      ${arrow(230, 48, 252, 48)}
      ${session(258, 16, "B")}
      ${label(41, 94, "Writes")}
      ${label(166, 94, "URL")}
      ${label(287, 94, "Reads")}`);
  }
  if (kind === "pong") {
    return svg(g, `
      ${person(42, 14, "Ada")}
      ${fileCard(118, 10, "notes.md")}
      ${person(278, 14, "Bob")}
      ${arrow(68, 42, 110, 42)}
      ${arrowLeft(210, 42, 252, 42)}
      ${label(42, 94, "Writes")}
      ${label(160, 94, "One path")}
      ${label(278, 94, "Writes")}`);
  }
  if (kind === "live") {
    return svg(g, `
      ${urlBar(28, 8, "/you/s/notes/")}
      <path d="M70 48 H250" stroke="#c9b0ff" stroke-width="1.4" opacity="0.5"/>
      ${tick(70, 48, "Mon", 0.3)}
      ${tick(160, 48, "Wed", 0.6)}
      ${tick(250, 48, "Fri", 1)}`);
  }
  return svg(g, `
    ${gate(18, 10, "Hub", "Sign in", "person")}
    ${gate(118, 10, "Publish", "A token", "key")}
    ${gate(218, 10, "The link", "Public", "open")}`);
}

function svg(defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 108" fill="none">
    ${defs}
    ${body}
  </svg>`;
}

function glow(id: string): string {
  return `<defs>
    <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="1.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
}

function label(x: number, y: number, text: string): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" fill="#b8b0ce" font-size="11" font-family="IBM Plex Sans, ui-sans-serif, sans-serif">${escapeHtml(text)}</text>`;
}

function files(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})">
    <rect x="10" y="0" width="34" height="42" rx="3" fill="#b08cff" fill-opacity="0.08" stroke="#c9b0ff" stroke-width="1.3"/>
    <rect x="5" y="6" width="34" height="42" rx="3" fill="#b08cff" fill-opacity="0.12" stroke="#c9b0ff" stroke-width="1.3"/>
    <rect x="0" y="12" width="34" height="42" rx="3" fill="#0d1220" stroke="#f3ecff" stroke-width="1.6" filter="url(#proto)"/>
    <path d="M7 24h20M7 32h15M7 40h18" stroke="#c9b0ff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
  </g>`;
}

function cubeMark(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})">
    <polygon fill="#b08cff" fill-opacity="0.16" points="32,4 52,16 32,28 12,16"/>
    <polygon fill="#6a4cff" fill-opacity="0.1" points="12,16 32,28 32,48 12,36"/>
    <polygon fill="#b08cff" fill-opacity="0.14" points="52,16 32,28 32,48 52,36"/>
    <g stroke="#f3ecff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" filter="url(#proto)">
      <path d="M32 4 52 16 32 28 12 16Z"/>
      <path d="M12 16v20l20 12 20-12V16"/>
      <path d="M32 28v20"/>
    </g>
  </g>`;
}

function windowFrame(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="86" height="58" rx="4" fill="#0d1220" stroke="#f3ecff" stroke-width="1.6" filter="url(#proto)"/>
    <path d="M0 13h86" stroke="#c9b0ff" stroke-width="1.2" opacity="0.7"/>
    <circle cx="10" cy="7" r="2" fill="#c9b0ff" opacity="0.7"/>
    <circle cx="18" cy="7" r="2" fill="#c9b0ff" opacity="0.45"/>
    <path d="M14 26h58M14 34h44M14 42h50" stroke="#b08cff" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>
  </g>`;
}

function session(x: number, y: number, mark: string): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="60" height="64" rx="4" fill="#0d1220" stroke="#f3ecff" stroke-width="1.6" filter="url(#hand)"/>
    <text x="30" y="24" text-anchor="middle" fill="#d2c0ff" font-size="13" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeHtml(mark)}</text>
    <path d="M12 36h36M12 46h26" stroke="#c9b0ff" stroke-width="1.3" stroke-linecap="round" opacity="0.65"/>
  </g>`;
}

function urlPill(x: number, y: number, text: string, fid: string): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="116" height="32" rx="16" fill="#b08cff" fill-opacity="0.12" stroke="#f3ecff" stroke-width="1.6" filter="url(#${fid})"/>
    <text x="58" y="21" text-anchor="middle" fill="#f3ecff" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeHtml(text)}</text>
  </g>`;
}

function urlBar(x: number, y: number, text: string): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="264" height="26" rx="13" fill="#b08cff" fill-opacity="0.12" stroke="#f3ecff" stroke-width="1.6" filter="url(#live)"/>
    <text x="132" y="17" text-anchor="middle" fill="#f3ecff" font-size="11" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeHtml(text)}</text>
  </g>`;
}

function person(x: number, y: number, name: string): string {
  return `<g transform="translate(${x} ${y})">
    <circle cx="0" cy="9" r="8" stroke="#f3ecff" stroke-width="1.6" fill="#b08cff" fill-opacity="0.12" filter="url(#pong)"/>
    <path d="M-13 36c2-11 7-15 13-15s11 4 13 15" stroke="#f3ecff" stroke-width="1.6" stroke-linecap="round" fill="#b08cff" fill-opacity="0.08"/>
    <text x="0" y="52" text-anchor="middle" fill="#d2c0ff" font-size="11" font-family="IBM Plex Sans, ui-sans-serif, sans-serif">${escapeHtml(name)}</text>
  </g>`;
}

function fileCard(x: number, y: number, name: string): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="84" height="58" rx="4" fill="#0d1220" stroke="#f3ecff" stroke-width="1.6" filter="url(#pong)"/>
    <path d="M16 18h52M16 28h40M16 38h46" stroke="#c9b0ff" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>
    <text x="42" y="52" text-anchor="middle" fill="#e4c27a" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${escapeHtml(name)}</text>
  </g>`;
}

function tick(x: number, y: number, day: string, fill: number): string {
  return `<g transform="translate(${x} ${y})">
    <circle r="4" fill="#f3ecff" filter="url(#live)"/>
    <rect x="-18" y="14" width="36" height="20" rx="3" fill="#b08cff" fill-opacity="${(0.1 + fill * 0.22).toFixed(2)}" stroke="#c9b0ff" stroke-width="1.2"/>
    <text x="0" y="50" text-anchor="middle" fill="#b8b0ce" font-size="11" font-family="IBM Plex Sans, ui-sans-serif, sans-serif">${escapeHtml(day)}</text>
  </g>`;
}

function gate(x: number, y: number, title: string, sub: string, icon: "person" | "key" | "open"): string {
  return `<g transform="translate(${x} ${y})">
    <rect width="84" height="70" rx="4" fill="#0d1220" stroke="${icon === "open" ? "#f3ecff" : "#c9b0ff"}" stroke-width="1.6" filter="url(#open)"/>
    <text x="42" y="16" text-anchor="middle" fill="#d2c0ff" font-size="11" font-family="IBM Plex Sans, ui-sans-serif, sans-serif">${escapeHtml(title)}</text>
    ${gateIcon(icon)}
    <text x="42" y="62" text-anchor="middle" fill="#b8b0ce" font-size="10" font-family="IBM Plex Sans, ui-sans-serif, sans-serif">${escapeHtml(sub)}</text>
  </g>`;
}

function gateIcon(icon: "person" | "key" | "open"): string {
  if (icon === "person") {
    return `<circle cx="42" cy="32" r="6" stroke="#f3ecff" stroke-width="1.5" fill="#b08cff" fill-opacity="0.12"/>
      <path d="M32 50c2-8 6-11 10-11s8 3 10 11" stroke="#f3ecff" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  if (icon === "key") {
    return `<circle cx="36" cy="36" r="6" stroke="#f3ecff" stroke-width="1.5" fill="#b08cff" fill-opacity="0.12"/>
      <path d="M41 39 L54 39 L54 43 M48 39 V44" stroke="#f3ecff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<circle cx="36" cy="36" r="5.5" stroke="#f3ecff" stroke-width="1.5"/>
    <circle cx="48" cy="36" r="5.5" stroke="#f3ecff" stroke-width="1.5"/>
    <path d="M41 36h2" stroke="#f3ecff" stroke-width="1.5" stroke-linecap="round"/>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="M${x1} ${y1}H${x2 - 6}" stroke="#c9b0ff" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M${x2 - 8} ${y2 - 4}L${x2} ${y2}L${x2 - 8} ${y2 + 4}" stroke="#f3ecff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function arrowLeft(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="M${x1 + 6} ${y1}H${x2}" stroke="#c9b0ff" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M${x1 + 8} ${y2 - 4}L${x1} ${y2}L${x1 + 8} ${y2 + 4}" stroke="#f3ecff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}
