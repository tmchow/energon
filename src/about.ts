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
