import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { instancePolicy, policyPublic } from "./policy";
import type { Actor, Env } from "./types";

export function adminResponse(actor: Actor, env: Env): Response {
  return new Response(adminPage(actor.email, env), { headers: PRIVATE_HTML_HEADERS });
}

export function adminPage(email: string, env: Env): string {
  return uiPage(`Admin — ${PRODUCT}`, {
    page: "admin",
    data: {
      email,
      admin: true,
      policy: policyPublic(instancePolicy(env)),
    },
    footer: instanceFooter(env),
  });
}
