import { uiPage } from "./ui-render";
import { PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { identityFromEnv, skillsAddCommand, type InstanceIdentity } from "./instance";
import type { UpstreamSnapshot } from "./page-data";
import type { Actor, Env } from "./types";
import { pageChrome } from "./upstream";

function marketplaceUrl(id: InstanceIdentity): string {
  const repo = id.repo;
  return repo ? `https://github.com/${repo}` : id.origin;
}

function installBlock(id: InstanceIdentity): string {
  const repo = id.repo || "your-org/energon";
  const url = marketplaceUrl(id);
  return `Install ${id.plugin} at user (global) scope from ${url} (${repo}). Run \`${skillsAddCommand(id)}\`, or add that GitHub marketplace and install ${id.plugin} with your normal plugin flow. Do not install at project or workspace scope unless I ask.

If this repository is private, verify GitHub read access from this environment first. Keep GitHub credentials separate from the Energon token. If private marketplace installation is unavailable, use an authenticated local copy of the generated publish skill or follow ${id.origin}/v1/help and ${id.origin}/llms.txt directly. Never make the repository public to install it.

Then read ${id.origin}/auth.md. If ${id.tokenEnv} is already set, use it. Otherwise connect with a code: show me the link and code, wait for my approval, then save the delivered token as ${id.tokenEnv} where this environment keeps secrets, readable only by me. Do not invent a token.`;
}

export async function setupResponse(actor: Actor, env: Env): Promise<Response> {
  const chrome = await pageChrome(env, Boolean(actor.admin));
  return new Response(setupPage(actor.email, identityFromEnv(env), chrome.footer, Boolean(actor.admin), chrome.upstream), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

export function setupPage(
  email: string,
  id: InstanceIdentity,
  footer = "",
  admin = false,
  upstream?: UpstreamSnapshot,
): string {
  return uiPage(`Setup — ${PRODUCT}`, {
    page: "setup",
    data: { email, admin, identity: id, install: installBlock(id), skillsAdd: skillsAddCommand(id) },
    footer,
    upstream,
  });
}
