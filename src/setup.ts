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
  return `Add the plugin marketplace at ${url} (${repo}) and install ${id.plugin} at user (global) scope, using your normal plugin install flow. Do not install at project or workspace scope unless I ask.

Then read ${id.origin}/auth.md. If ${id.tokenEnv} is already set, use it. Otherwise connect with a code: show me the link and code, wait for my approval, then save the delivered token as ${id.tokenEnv} where this environment keeps secrets, readable only by me. Do not invent a token.`;
}

export function setupPage(email: string, id: InstanceIdentity, footer = "", admin = false): string {
  return uiPage(`Setup — ${PRODUCT}`, { page: "setup", data: { email, identity: id, install: installBlock(id), admin }, footer });
}

export function setupResponse(actor: Actor, env: Env): Response {
  return new Response(setupPage(actor.email, identityFromEnv(env), instanceFooter(env), Boolean(actor.admin)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}
