import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { loadAdminHealth } from "./admin-health";
import { ensureHandle } from "./handles";
import { instancePolicy, policyPublic } from "./policy";
import type { AdminHealthSnapshot, UpstreamSnapshot } from "./page-data";
import type { Actor, Env } from "./types";
import { pageChrome } from "./upstream";

export async function adminResponse(actor: Actor, env: Env): Promise<Response> {
  const handle = await ensureHandle(env, actor.email, actor.idpSub);
  const health = await loadAdminHealth(env);
  const chrome = await pageChrome(env, true);
  return new Response(adminPage(actor.email, handle, env, health, chrome), { headers: PRIVATE_HTML_HEADERS });
}

export function adminPage(
  email: string,
  handle: string,
  env: Env,
  health: AdminHealthSnapshot,
  chrome: { footer: string; upstream?: UpstreamSnapshot } = { footer: instanceFooter(env) },
): string {
  return uiPage(`Admin — ${PRODUCT}`, {
    page: "admin",
    data: {
      email,
      handle,
      admin: true,
      policy: policyPublic(instancePolicy(env)),
      health,
    },
    footer: chrome.footer,
    upstream: chrome.upstream,
  });
}
