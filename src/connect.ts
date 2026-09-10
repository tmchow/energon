import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { humanConnectPage } from "./connections";
import { tokenPolicy, tokenPolicyPublic } from "./policy";
import { publicOrigin } from "./http";
import type { Actor, Env } from "./types";

export async function connectResponse(env: Env, actor: Actor, id: string): Promise<Response> {
  const page = await humanConnectPage(env, id);
  const origin = publicOrigin(env);
  return new Response(uiPage("Connect your agent — Energon", {
    page: "connect",
    data: {
      email: actor.email,
      host: new URL(origin).host,
      connection: page.connection,
      ended_kind: page.ended_kind,
      token_policy: tokenPolicyPublic(tokenPolicy(env), origin),
    },
    footer: instanceFooter(env),
  }), {
    status: page.status,
    headers: { ...PRIVATE_HTML_HEADERS, "cache-control": "no-store, private", "referrer-policy": "no-referrer", "x-frame-options": "DENY" },
  });
}
