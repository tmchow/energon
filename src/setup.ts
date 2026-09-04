import { appHeader, documentShell, escapeHtml, instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { identityFromEnv, installLine, type InstanceIdentity } from "./instance";
import type { Actor, Env } from "./types";

function marketplaceRepo(id: InstanceIdentity): string {
  return id.repo;
}

function marketplaceUrl(id: InstanceIdentity): string {
  const repo = marketplaceRepo(id);
  return repo ? `https://github.com/${repo}` : id.origin;
}

function installBlock(id: InstanceIdentity): string {
  const repo = marketplaceRepo(id) || "your-org/energon";
  const url = marketplaceUrl(id);
  return `Add the ${id.skill} plugin marketplace and install ${id.plugin}.

Repo: ${repo}
${url}

This repo is a Claude Code marketplace and an Agent Plugins marketplace (https://agent-plugins.org/). That standard works with Cursor, OpenClaw, ChatGPT, Codex, GitHub Copilot, and others. Follow this host’s plugin install flow. Install at user (global) scope so the skill is available in every project. Do not install at project or workspace scope unless the human asked for that. After install, read ${id.origin}/auth.md and request a human-approved connection. Manual tokens from ${id.origin}/tokens are also supported. Store the credential as ${id.tokenEnv}. Do not invent a token.`;
}

export function setupResponse(actor: Actor, env: Env): Response {
  return new Response(setupPage(actor.email, identityFromEnv(env), instanceFooter(env)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

function copyRow(label: string, value: string): string {
  return `<div class="copy-row">
    <div>
      <div class="copy-row-label">${escapeHtml(label)}</div>
      <code>${escapeHtml(value)}</code>
    </div>
    <button type="button" class="btn-ghost btn-sm" data-copy="${escapeHtml(value)}">Copy</button>
  </div>`;
}

export function setupPage(email: string, id: InstanceIdentity, footer = ""): string {
  const repo = marketplaceRepo(id) || "your-org/energon";
  const url = marketplaceUrl(id);
  const install = installBlock(id);
  return documentShell({
    title: `Setup — ${PRODUCT}`,
    bodyClass: "page-setup",
    footer,
    extraHead: `<script>
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-copy], [data-copy-from]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const from = btn.getAttribute("data-copy-from");
      const node = from ? document.getElementById(from) : null;
      const text = (btn.getAttribute("data-copy") || (node && node.textContent) || "").trim();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = prev || "Copy"; }, 1200);
    });
  });
});
</script>`,
    body: `${appHeader({ active: "setup", email })}
    <main class="wrap">
      <h1 class="display">Add ${escapeHtml(PRODUCT)} to your agent.</h1>
      <p class="lede">Give your agent a way to publish work, read a link as reference, or revise a file at the same address when permitted. The same instance-specific skill works across compatible agent tools. You can also <a href="/">upload from your browser</a>.</p>
      <p class="lede">Install this instance's plugin in <strong>Claude Code</strong> or a compatible <a href="https://agent-plugins.org/">Agent Plugins</a> client, such as Cursor, OpenClaw, ChatGPT, Codex, or GitHub Copilot. Install at user (global) scope so it follows you across projects. Then ask your agent to connect: it will give you a link and code to approve here. You can also mint a token on <a href="/tokens">Tokens</a> and export it as <code>${escapeHtml(id.tokenEnv)}</code>.</p>
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Marketplace</h2><span class="hint">Use the form your agent tool asks for</span></div>
          <div class="card-body">
            <p class="muted-copy">Add this as a plugin marketplace, then install <code>${escapeHtml(id.plugin)}</code> (<code>${escapeHtml(installLine(id))}</code>) at user (global) scope. Project or workspace only if you asked for this repo.</p>
            ${copyRow("GitHub repo", repo)}
            ${copyRow("Repo URL", url)}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Or paste this into your agent</h2><span class="hint">Let your agent guide the install</span></div>
          <div class="card-body">
            <p class="muted-copy">Paste these instructions into your agent to connect it to this instance.</p>
            <div class="copy-block">
              <pre class="soft" id="agent-install">${escapeHtml(install)}</pre>
              <button type="button" class="btn-ghost btn-sm copy-block-btn" data-copy-from="agent-install">Copy</button>
            </div>
          </div>
        </section>
      </div>
      <p class="lede">Once connected, try “Publish this brief and give me its link,” “Read this link as reference without changing it,” or “Update this file at the same link.” A stable link shows current contents until expiry or deletion.</p>
    </main>`,
  });
}
