import { uiPage } from "./ui-render";
import { PASSWORD_HEADER, SET_PASSWORD_HEADER } from "./config";
import { ApiError, htmlPage, isLocalHost, sha256Hex } from "./http";
import type { Env } from "./types";

export { PASSWORD_HEADER, SET_PASSWORD_HEADER };
export const GATE_COOKIE = "energon_gate";

export async function hashSharePassword(password: string): Promise<string> {
  return sha256Hex(`energon-pw:${password}`);
}

export async function unlockToken(passwordHash: string): Promise<string> {
  return sha256Hex(`energon-gate:${passwordHash}`);
}

/** JSON `password` field: missing = leave unchanged; null/empty = clear. */
export function passwordField(body: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, "password")) return undefined;
  if (body.password == null) return "";
  return String(body.password);
}

/** undefined = leave unchanged; null = clear; string = set (empty string clears). */
export async function passwordHashFromInput(raw: string | undefined): Promise<string | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw.length > 128) {
    throw new ApiError(400, "bad_password", "Share password is too long (max 128 characters).");
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return hashSharePassword(trimmed);
}

/** Echo the phrase the caller just set. GET never returns this — we only store a hash. */
export function passwordEcho(raw: string | undefined, hash: string | null | undefined): string | null | undefined {
  if (raw === undefined || hash === undefined) return undefined;
  if (!hash) return null;
  return raw.trim();
}

export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export function readSetPasswordHeader(request: Request): string | undefined {
  const v = request.headers.get(SET_PASSWORD_HEADER);
  return v === null ? undefined : v;
}

export function offeredPassword(request: Request): string | null {
  const header = request.headers.get(PASSWORD_HEADER);
  if (header !== null && header !== "") return header;
  return null;
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function cookieUnlocks(request: Request, passwordHash: string): Promise<boolean> {
  const cookie = readCookie(request, GATE_COOKIE);
  if (!cookie) return false;
  return hashesEqual(cookie, await unlockToken(passwordHash));
}

export function wantsJsonGate(request: Request): boolean {
  if (request.headers.get(PASSWORD_HEADER) !== null) return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

const GATE_BODY_MAX = 2048;

export async function parseFormPassword(request: Request): Promise<string | null> {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    throw new ApiError(415, "bad_content_type", "Password form must be application/x-www-form-urlencoded.");
  }
  if (!ctype.includes("application/x-www-form-urlencoded")) {
    return null;
  }
  const headerLen = request.headers.get("content-length");
  if (headerLen) {
    const n = Number(headerLen);
    if (Number.isFinite(n) && n > GATE_BODY_MAX) {
      throw new ApiError(413, "too_large", "Password request is too large.");
    }
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > GATE_BODY_MAX) {
    throw new ApiError(413, "too_large", "Password request is too large.");
  }
  const params = new URLSearchParams(new TextDecoder().decode(buf));
  const v = params.get("password");
  if (v !== null && v.length > 128) {
    throw new ApiError(400, "bad_password", "Share password is too long (max 128 characters).");
  }
  return v;
}

export function gateCookieHeader(token: string, cookiePath: string, hostname: string): string {
  const parts = [
    `${GATE_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (!isLocalHost(hostname)) parts.push("Secure");
  return parts.join("; ");
}

export function passwordPromptHtml(title: string, action: string, wrong: boolean): string {
  return uiPage(`Password — ${title}`, { page: "gate", data: { action, wrong, passwordHeader: PASSWORD_HEADER } });
}

export const GATE_WINDOW_MS = 15 * 60 * 1000;
export const GATE_MAX_FAILS = 20;

export function gateScopes(request: Request, cookiePath: string): string[] {
  const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("CF-Connecting-IP") || "unknown").trim() || "unknown";
  return [`obj:${cookiePath}`, `ip:${ip}`];
}

async function loadGateAttempt(env: Env, scope: string): Promise<{ fails: number; window_start: string } | null> {
  return env.DB.prepare(`SELECT fails, window_start FROM gate_attempts WHERE scope = ?`)
    .bind(scope)
    .first<{ fails: number; window_start: string }>();
}

export async function gateIsBlocked(env: Env, scopes: string[], now = Date.now()): Promise<boolean> {
  for (const scope of scopes) {
    const row = await loadGateAttempt(env, scope);
    if (!row) continue;
    const start = Date.parse(row.window_start);
    if (!Number.isFinite(start) || now - start >= GATE_WINDOW_MS) continue;
    if (row.fails >= GATE_MAX_FAILS) return true;
  }
  return false;
}

export async function recordGateFailures(env: Env, scopes: string[], now = Date.now()): Promise<void> {
  const iso = new Date(now).toISOString();
  for (const scope of scopes) {
    const row = await loadGateAttempt(env, scope);
    const start = row ? Date.parse(row.window_start) : NaN;
    const fresh = !row || !Number.isFinite(start) || now - start >= GATE_WINDOW_MS;
    if (fresh) {
      await env.DB.prepare(`INSERT OR REPLACE INTO gate_attempts (scope, fails, window_start) VALUES (?, 1, ?)`).bind(scope, iso).run();
    } else {
      await env.DB.prepare(`UPDATE gate_attempts SET fails = fails + 1 WHERE scope = ?`).bind(scope).run();
    }
  }
}

export async function clearGateAttempts(env: Env, scopes: string[]): Promise<void> {
  for (const scope of scopes) {
    await env.DB.prepare(`DELETE FROM gate_attempts WHERE scope = ?`).bind(scope).run();
  }
}

function gateLimited(request: Request, title: string): Response {
  if (wantsJsonGate(request) || offeredPassword(request) !== null) {
    return Response.json(
      {
        error: "rate_limited",
        message: "Too many password attempts. Try again later.",
      },
      { status: 429, headers: { "cache-control": "no-store" } },
    );
  }
  return gateHtml(
    uiPage(`Password — ${title}`, { page: "gate", data: { action: "", wrong: false, limited: true, passwordHeader: PASSWORD_HEADER } }),
    429,
  );
}

export async function protectContent(
  request: Request,
  passwordHash: string | null | undefined,
  cookiePath: string,
  title: string,
  env: Env,
): Promise<Response | null> {
  if (!passwordHash) return null;
  const url = new URL(request.url);
  const offered = offeredPassword(request);
  const expected = await unlockToken(passwordHash);
  const scopes = gateScopes(request, cookiePath);

  if (request.method === "POST") {
    const formPw = await parseFormPassword(request);
    const candidate = formPw ?? offered;
    if (candidate !== null) {
      if (await gateIsBlocked(env, scopes)) return gateLimited(request, title);
      if (hashesEqual(await hashSharePassword(candidate), passwordHash)) {
        await clearGateAttempts(env, scopes);
        return new Response(null, {
          status: 303,
          headers: {
            location: url.pathname + url.search,
            "set-cookie": gateCookieHeader(expected, cookiePath, url.hostname),
          },
        });
      }
      await recordGateFailures(env, scopes);
      if (wantsJsonGate(request) || offered !== null) {
        return gateJson();
      }
      return gateHtml(passwordPromptHtml(title, url.pathname, true), 401);
    }
    if (wantsJsonGate(request) || offered !== null) {
      return gateJson();
    }
    return gateHtml(passwordPromptHtml(title, url.pathname, true), 401);
  }

  if (offered !== null) {
    if (await gateIsBlocked(env, scopes)) return gateLimited(request, title);
    if (hashesEqual(await hashSharePassword(offered), passwordHash)) {
      await clearGateAttempts(env, scopes);
      return null;
    }
    await recordGateFailures(env, scopes);
    if (wantsJsonGate(request)) return gateJson();
    return gateHtml(passwordPromptHtml(title, url.pathname, true), 401);
  }

  if (await cookieUnlocks(request, passwordHash)) return null;

  if (wantsJsonGate(request)) {
    return gateJson();
  }
  return gateHtml(passwordPromptHtml(title, url.pathname, false), 401);
}

function gateJson(): Response {
  return Response.json(
    {
      error: "password_required",
      message: `This link is password-protected. Retry with header ${PASSWORD_HEADER}.`,
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function gateHtml(body: string, status: number): Response {
  return htmlPage(body, status, { "cache-control": "no-store" });
}
