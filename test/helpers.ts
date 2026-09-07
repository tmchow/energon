import { SELF } from "cloudflare:test";
import { expect } from "vitest";

export const origin = "http://127.0.0.1";

export function req(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http://") || path.startsWith("https://") ? path : origin + path;
  return SELF.fetch(url, init);
}

export async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await req(path, init);
  return { status: res.status, body: await res.json() };
}

export async function mint(
  label: string,
  email = "ada@esperlabs.app",
  extra?: HeadersInit,
  ttl?: string,
): Promise<string> {
  const { status, body } = await json("/account/tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Cf-Access-Authenticated-User-Email": email,
      origin,
      ...extra,
    },
    body: JSON.stringify(ttl === undefined ? { label } : { label, ttl }),
  });
  expect(status).toBe(201);
  expect(String(body.token)).toMatch(/^ee_live_/);
  return body.token as string;
}

export function auth(token: string, extra?: HeadersInit): HeadersInit {
  return { authorization: `Bearer ${token}`, ...extra };
}

export async function createSite(
  token: string,
  slug: string,
  extra?: Record<string, unknown>,
): Promise<{ status: number; body: any; id: string; slug: string; url: string; handle: string }> {
  const created = await json("/v1/sites", {
    method: "POST",
    headers: auth(token, { "content-type": "application/json" }),
    body: JSON.stringify({ slug, ...extra }),
  });
  return {
    ...created,
    id: String(created.body.id ?? ""),
    slug: String(created.body.slug ?? slug),
    url: String(created.body.url ?? ""),
    handle: String(created.body.handle ?? ""),
  };
}

export function sitePub(handle: string, id: string, slug: string, path = ""): string {
  return path ? `/${handle}/s/${id}/${slug}/${path}` : `/${handle}/s/${id}/${slug}/`;
}

export async function siteIdFor(token: string, slug: string): Promise<string> {
  const listed = await json(`/v1/sites?q=${encodeURIComponent(slug)}&limit=100`, { headers: auth(token) });
  const match = (listed.body.sites || []).find((s: { slug: string; id?: string }) => s.slug === slug);
  if (!match?.id) throw new Error(`no site listed for slug ${slug}`);
  return String(match.id);
}

export function access(email: string, extra?: HeadersInit): HeadersInit {
  return { "Cf-Access-Authenticated-User-Email": email, origin, ...extra };
}

/** Every `$("id")` / getElementById("id") in page JS (inlined from `*.client.js` or a `<script>`) must exist in the HTML. */
export function assertDomBindings(html: string): void {
  const defined = new Set(
    [...html.matchAll(/\sid=["']([A-Za-z][\w:-]*)["']/g)].map((m) => m[1]),
  );
  const referenced = new Set(
    [...html.matchAll(/(?:\$|getElementById)\(\s*["']([A-Za-z][\w:-]*)["']\s*\)/g)].map((m) => m[1]),
  );
  const missing = [...referenced].filter((id) => !defined.has(id));
  expect(missing, `page JS references missing elements: ${missing.join(", ")}`).toEqual([]);
}
