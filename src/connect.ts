import { brandMark, documentShell, escapeHtml, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { connectionForHuman } from "./connections";
import { tokenPolicy } from "./policy";
import type { Actor, Env } from "./types";

const CONNECT_CSS = `
.page-connect { align-items: center; justify-content: center; padding: 2rem 1rem; }
.connect { width: 100%; max-width: 26rem; }
.connect-brand { display: flex; align-items: center; justify-content: center; gap: .5rem; color: var(--muted); font-size: .8rem; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 1.5rem; }
.connect-brand svg { width: 22px; height: 22px; }
.connect-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 2rem 1.75rem; box-shadow: 0 0 40px rgba(176, 140, 255, 0.08); }
.connect-card h1 { font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; text-align: center; }
.connect-agent { text-align: center; color: var(--muted); margin: .5rem 0 1.75rem; font-size: .9rem; }
.connect-agent strong { color: var(--fg); font-weight: 600; }
.connect-code { display: block; margin-bottom: 1.1rem; }
.connect-code span { display: block; font-size: .78rem; color: var(--muted); margin-bottom: .45rem; }
.connect-code input { width: 100%; height: 3.4rem; font: 1.6rem/1 var(--mono); letter-spacing: .35em; text-align: center; text-indent: .35em; background: #0a0d18; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 0; }
.connect-code input::placeholder { color: var(--border); letter-spacing: .35em; }
.connect-ttl { display: flex; align-items: center; justify-content: space-between; gap: 1rem; font-size: .82rem; color: var(--muted); margin-bottom: 1.5rem; }
.connect-ttl select { font: inherit; color: var(--fg); background: #0a0d18; border: 1px solid var(--line); border-radius: 4px; height: 2.2rem; padding: 0 .5rem; }
.connect-actions { display: flex; flex-direction: column; gap: .6rem; }
.connect-actions button { width: 100%; height: 2.75rem; font-size: .92rem; }
.connect-actions .btn-deny { background: transparent; border-color: transparent; color: var(--muted); height: 2.25rem; }
.connect-actions .btn-deny:hover { color: var(--danger); background: transparent; }
.connect-status { min-height: 1.3rem; margin: 1rem 0 0; text-align: center; font-size: .86rem; color: var(--muted); }
.connect-status.is-error { color: var(--danger); }
.connect-status.is-ok { color: var(--ok-fg); }
.connect-done { display: none; text-align: center; }
.connect-done .mark { width: 2.75rem; height: 2.75rem; margin: 0 auto 1rem; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--ok-border); background: var(--ok-bg); color: var(--ok-fg); font-size: 1.3rem; }
.connect-done h2 { font-size: 1.15rem; margin-bottom: .4rem; }
.connect-done p { color: var(--muted); margin: 0; font-size: .9rem; }
.connect-meta { margin: 1.25rem 0 0; font-size: .76rem; line-height: 1.55; color: var(--muted); text-align: center; }
.connect-meta a { color: var(--muted); }
.connect-account { text-align: center; font-size: .8rem; color: var(--muted); margin: 1.25rem 0 0; }
.connect-account code { color: var(--fg); font-size: .8rem; }
`;

export async function connectResponse(env: Env, actor: Actor, id: string): Promise<Response> {
  const connection = await connectionForHuman(env, id);
  const policy = tokenPolicy(env);
  const options = policy.presets.map(p => `<option value="${escapeHtml(p.id)}"${p.id === policy.defaultTtl ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");
  const expiresIn = Math.max(1, Math.round((new Date(connection.expires_at).getTime() - Date.now()) / 60000));
  const body = `
    <main class="connect">
      <div class="connect-brand">${brandMark()}<span>${escapeHtml(PRODUCT)}</span></div>
      <section class="connect-card">
        <div id="connect-form-wrap">
          <h1>Connect your agent</h1>
          <p class="connect-agent">Enter the code shown by <strong>${escapeHtml(connection.label)}</strong></p>
          <form id="connect-form" data-request="${escapeHtml(connection.id)}" autocomplete="off">
            <label class="connect-code" for="connect-code"><span>Code</span><input id="connect-code" name="user_code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" placeholder="00000000" required autofocus autocomplete="one-time-code" spellcheck="false"></label>
            <label class="connect-ttl" for="connect-ttl">Access expires after<select id="connect-ttl" name="ttl">${options}</select></label>
            <div class="connect-actions">
              <button class="btn-primary" type="submit" value="approve">Approve connection</button>
              <button class="btn-deny" type="submit" value="deny">Deny</button>
            </div>
          </form>
          <p id="connect-status" class="connect-status" role="status" aria-live="polite"></p>
          <p class="connect-meta">The agent will act as your account: it can read work on this instance, including password-protected links, and publish or update where you have permission. Only approve a code you asked for. This request expires in ${expiresIn} min.</p>
        </div>
        <div id="connect-done" class="connect-done">
          <div class="mark" aria-hidden="true">&#10003;</div>
          <h2 id="connect-done-title"></h2>
          <p id="connect-done-copy"></p>
        </div>
      </section>
      <p class="connect-account">Signed in as <code>${escapeHtml(actor.email)}</code> &middot; <a href="/tokens">Manage tokens</a></p>
    </main>
    <script>
    const form = document.getElementById("connect-form");
    const status = document.getElementById("connect-status");
    const code = document.getElementById("connect-code");
    code.addEventListener("input", () => { code.value = code.value.replace(/\\D/g, "").slice(0, 8); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.value === "deny" ? "deny" : "approve";
      const buttons = form.querySelectorAll("button");
      for (const button of buttons) button.disabled = true;
      status.className = "connect-status";
      status.textContent = action === "approve" ? "Approving…" : "Denying…";
      try {
        const response = await fetch("/account/connections/" + encodeURIComponent(form.dataset.request) + "/" + action, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_code: code.value, ttl: document.getElementById("connect-ttl").value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "The connection could not be completed.");
        status.textContent = "";
        document.getElementById("connect-done-title").textContent = action === "approve" ? "Connection approved" : "Connection denied";
        document.getElementById("connect-done-copy").textContent = action === "approve"
          ? "Return to your agent. It has received its token and will finish connecting."
          : "The agent has been told to stop. You can close this page.";
        document.getElementById("connect-form-wrap").hidden = true;
        document.getElementById("connect-done").style.display = "block";
        if (action === "deny") document.querySelector("#connect-done .mark").textContent = "\\u2715";
      } catch (error) {
        status.className = "connect-status is-error";
        status.textContent = error.message || "The connection could not be completed. Try again.";
        for (const button of buttons) button.disabled = false;
        code.focus();
      }
    });
    </script>`;
  return new Response(documentShell({ title: `Connect your agent — ${PRODUCT}`, bodyClass: "page-connect", extraHead: `<style>${CONNECT_CSS}</style>`, body }), {
    headers: { ...PRIVATE_HTML_HEADERS, "cache-control": "no-store, private", "referrer-policy": "no-referrer", "x-frame-options": "DENY" },
  });
}
