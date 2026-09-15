import { uiPage } from "./ui-render";
import { PRIVATE_HTML_HEADERS } from "./chrome";
import { humanConnectPage, parseUserCode } from "./connections";
import { tokenPolicy, tokenPolicyPublic } from "./policy";
import { publicOrigin } from "./http";
import type { Actor, Env } from "./types";
import { pageChrome } from "./upstream";

export async function connectResponse(env: Env, actor: Actor, id: string, offeredRaw?: string | null): Promise<Response> {
  const origin = publicOrigin(env);
  const [page, chrome] = await Promise.all([humanConnectPage(env, id), pageChrome(env, Boolean(actor.admin))]);
  return new Response(uiPage("Connect your agent — Energon", {
    page: "connect",
    data: {
      email: actor.email,
      host: new URL(origin).host,
      connection: page.connection,
      ended_kind: page.ended_kind,
      offered_code: page.ended_kind ? null : parseUserCode(offeredRaw),
      token_policy: tokenPolicyPublic(tokenPolicy(env), origin),
    },
    footer: chrome.footer,
    upstream: chrome.upstream,
  }), {
    status: page.status,
    headers: { ...PRIVATE_HTML_HEADERS, "cache-control": "no-store, private", "referrer-policy": "no-referrer", "x-frame-options": "DENY" },
  });
}
