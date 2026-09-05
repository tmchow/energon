import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { identityFromEnv, type InstanceIdentity } from "./instance";
import type { Actor, Env } from "./types";

function marketplaceUrl(id: InstanceIdentity): string {
  const repo = id.repo;
  return repo ? `https://github.com/${repo}` : id.origin;
}

function installBlock(id: InstanceIdentity): string {
  const repo = id.repo || "your-org/energon";
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

export function setupPage(email: string, id: InstanceIdentity, footer = ""): string {
  return uiPage(`Setup — ${PRODUCT}`, { page: "setup", data: { email, identity: id, install: installBlock(id) }, footer });
}
