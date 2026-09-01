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
      <p class="lede">You can already ship a prototype. You can already share a markdown file. Nothing does both in one place, as easy for a person as for an agent. That job is not solved without ${escapeHtml(PRODUCT)}. There is no editor. You write the file, replace it, and the address stays put.</p>
      <nav class="scene-nav" aria-label="Scenes">
        <a href="#prototype">Prototype</a>
        <a href="#handoff">Time or machine</a>
        <a href="#pong">Ping-pong</a>
        <a href="#living">Living file</a>
        <a href="#public">Public links</a>
      </nav>

      <section class="scene" id="prototype">
        <div class="scene-copy">
          <p class="scene-kicker">01</p>
          <h2>Ship a prototype</h2>
          <p>Those prototype hosts work. They also ask you to stand up a repo, a project, a deploy. That pause is why the prototype stays on your laptop.</p>
          <p>Drop the folder. Send the link. They open it. Less friction means you share sooner, and you share more. That is the velocity. The site lives at a path like <code>/ada/s/lunch-poll/</code>.</p>
        </div>
        ${diagram("proto", "Less ceremony. The folder becomes a link.")}
      </section>

      <section class="scene" id="handoff">
        <div class="scene-copy">
          <p class="scene-kicker">02</p>
          <h2>Across time, or machines</h2>
          <p>What matters is the knowledge, not the file. Context from this session has to show up in the next one — on another laptop, tomorrow on this one, or in someone else's hands. Two agents passing a markdown file is the usual case. Or an image.</p>
          <p>An attachment is last night's copy. A drive link often asks the next session to sign in. Drop it, send the link, they open it. One address, like <code>/ada/f/x7k2/brief.md</code>. Replace the contents and the link stays put.</p>
        </div>
        ${diagram("hand", "Context leaves this session. The next one opens the link.")}
      </section>

      <section class="scene" id="pong">
        <div class="scene-copy">
          <p class="scene-kicker">03</p>
          <h2>Pass it back and forth</h2>
          <p>You are taking turns on one draft — with a person, or with an agent. Each turn, the other side needs the current version. Not last night's attachment. Not a pull request for a mock.</p>
          <p>One link is the draft. Ada saves. Bob saves over it. Ada saves again. Whoever wrote last is what the link shows. Last write wins on purpose: you are trading the live object, not merging branches. Need history or comments? Git or Google Docs. Need to take a turn and keep going? Same link.</p>
        </div>
        ${diagram("pong", "Take a turn. Same link. Last write wins.")}
      </section>

      <section class="scene" id="living">
        <div class="scene-copy">
          <p class="scene-kicker">04</p>
          <h2>Keep a living file</h2>
          <p>The link does not change when the file does. Paste it in Slack once. Next week it still works. A new upload in the thread is a new file.</p>
          <p>Open a markdown file in a browser and you get a page. Want the raw file instead? Add <code>?raw=1</code>.</p>
        </div>
        ${diagram("live", "Monday through Friday, the link does not move.")}
      </section>

      <section class="scene scene-open" id="public">
        <div class="scene-copy">
          <p class="scene-kicker">05</p>
          <h2>Links are always public</h2>
          <p>You sign in to publish. The link itself does not ask anyone to sign in. That is on purpose: the person you send it to can just open it, and an agent can read it without a Google login.</p>
          <p>That is for convenience. If the link should not be wide open, put a share password on it. If a password is not enough — you need named people, folders, real permissions — put the file in Google Drive.</p>
        </div>
        ${diagram("open", "Sign in to publish. The link is public. Add a password if it needs a gate.")}
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
