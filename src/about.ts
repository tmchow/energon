import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import type { Actor, Env } from "./types";

export function aboutPage(email: string, footer = "", admin = false): string {
  return uiPage(`About — ${PRODUCT}`, { page: "about", data: { email, admin }, footer });
}

export function aboutResponse(actor: Actor, env?: Env): Response {
  return new Response(aboutPage(actor.email, instanceFooter(env), Boolean(actor.admin)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}
