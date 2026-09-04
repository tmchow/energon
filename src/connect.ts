import { appHeader, documentShell, escapeHtml, instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { connectionForHuman } from "./connections";
import { tokenPolicy } from "./policy";
import type { Actor, Env } from "./types";

export async function connectResponse(env: Env, actor: Actor, id: string): Promise<Response> {
  const connection = await connectionForHuman(env, id);
  const policy = tokenPolicy(env);
  const options = policy.presets.map(p => `<option value="${escapeHtml(p.id)}"${p.id === policy.defaultTtl ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");
  const body = `${appHeader({ active: "tokens", email: actor.email })}
    <main class="wrap">
      <h1 class="display">Connect an agent</h1>
      <p class="lede">Approve only a request you started with your agent. The agent supplied this label: <strong>${escapeHtml(connection.label)}</strong>.</p>
      <section class="card"><div class="card-body">
        <p>You are signed in as <strong>${escapeHtml(actor.email)}</strong>. The agent will act as this account.</p>
        <p>This token can read work on this instance, including password-protected files, and publish, update, or delete work where your account has permission. This grants the same access as a manually created token.</p>
        <p>Enter the code your agent showed you. Do not approve a code sent by someone else. This request expires at ${escapeHtml(new Date(connection.expires_at).toUTCString())}.</p>
        <form id="connect-form" data-request="${escapeHtml(connection.id)}">
          <label class="field" for="connect-code">Agent code<input id="connect-code" name="user_code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" required autocomplete="off"></label>
          <label class="field" for="connect-ttl">Token lifetime<select id="connect-ttl" name="ttl">${options}</select></label>
          <button class="btn-primary" type="submit" value="approve">Approve connection</button>
          <button type="submit" value="deny">Deny connection</button>
        </form>
        <p id="connect-status" role="status" aria-live="polite"></p>
        <p>You can revoke the token at <a href="/tokens">Tokens</a>. The secret goes directly to the waiting agent.</p>
      </div></section>
    </main>
    <script>
    const form = document.getElementById("connect-form");
    const status = document.getElementById("connect-status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.value === "deny" ? "deny" : "approve";
      const buttons = form.querySelectorAll("button");
      for (const button of buttons) button.disabled = true;
      try {
        const response = await fetch("/account/connections/" + encodeURIComponent(form.dataset.request) + "/" + action, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_code: document.getElementById("connect-code").value, ttl: document.getElementById("connect-ttl").value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "The connection could not be completed.");
        status.textContent = action === "approve" ? "Connection approved. Return to your agent to finish connecting." : "Connection denied.";
        form.hidden = true;
      } catch (error) {
        status.textContent = error.message || "The connection could not be completed. Try again.";
      } finally {
        for (const button of buttons) button.disabled = false;
      }
    });
    </script>`;
  return new Response(documentShell({ title: "Connect an agent — Energon", body, footer: instanceFooter(env) }), {
    headers: { ...PRIVATE_HTML_HEADERS, "cache-control": "no-store, private", "referrer-policy": "no-referrer", "x-frame-options": "DENY" },
  });
}
