import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import { loadAdminHealth } from "./admin-health";
import { ensureHandle } from "./handles";
import { instancePolicy, policyPublic } from "./policy";
import type { AdminHealthSnapshot } from "./page-data";
import type { Actor, Env } from "./types";

export async function adminResponse(actor: Actor, env: Env): Promise<Response> {
  const handle = await ensureHandle(env, actor.email, actor.idpSub);
  const health = await loadAdminHealth(env);
  return new Response(adminPage(actor.email, handle, env, health), { headers: PRIVATE_HTML_HEADERS });
}

export function adminPage(email: string, handle: string, env: Env, health: AdminHealthSnapshot): string {
  return uiPage(`Admin — ${PRODUCT}`, {
    page: "admin",
    data: {
      email,
      handle,
      admin: true,
      policy: policyPublic(instancePolicy(env)),
      health,
    },
    footer: instanceFooter(env),
  });
}
