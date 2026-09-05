import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { connectionForHuman } from "./connections";
import { tokenPolicy, tokenPolicyPublic } from "./policy";
import { publicOrigin } from "./http";
import type { Actor, Env } from "./types";

export async function connectResponse(env: Env, actor: Actor, id: string): Promise<Response> {
  const connection = await connectionForHuman(env, id);
  return new Response(uiPage("Connect an agent — Energon", {
    page: "connect", data: { email: actor.email, connection: { id: connection.id, label: connection.label, expires_at: connection.expires_at }, token_policy: tokenPolicyPublic(tokenPolicy(env), publicOrigin(env)) }, footer: instanceFooter(env),
  }), {
    headers: { ...PRIVATE_HTML_HEADERS, "cache-control": "no-store, private", "referrer-policy": "no-referrer", "x-frame-options": "DENY" },
  });
}
