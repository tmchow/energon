import { uiPage } from "./ui-render";
import { PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import type { UpstreamSnapshot } from "./page-data";
import type { Actor, Env } from "./types";
import { pageChrome } from "./upstream";

export async function aboutResponse(actor: Actor, env?: Env): Promise<Response> {
  const chrome = env ? await pageChrome(env, Boolean(actor.admin)) : { footer: "" };
  return new Response(aboutPage(actor.email, chrome.footer, Boolean(actor.admin), chrome.upstream), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

export function aboutPage(email: string, footer = "", admin = false, upstream?: UpstreamSnapshot): string {
  return uiPage(`About — ${PRODUCT}`, { page: "about", data: { email, admin }, footer, upstream });
}
