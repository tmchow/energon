import { brandMark, documentShell, productName } from "./chrome";
import { PASSWORD_HEADER, SET_PASSWORD_HEADER } from "./config";
import { ApiError, htmlPage, isLocalHost, sha256Hex } from "./http";

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
    if (k === name) return decodeURIComponent(rest.join("="));
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

export async function parseFormPassword(request: Request): Promise<string | null> {
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/x-www-form-urlencoded") && !ctype.includes("multipart/form-data")) {
    return null;
  }
  const form = await request.formData();
  const v = form.get("password");
  return typeof v === "string" ? v : null;
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
  const err = wrong ? `<p class="err">That password is wrong.</p>` : "";
  return documentShell({
    title: `Password — ${title}`,
    bodyClass: "page-gate",
    body: `<div class="card gate">
      <a class="brand" href="/">${brandMark()}</a>
      <h1>${escapeHtml(productName())}</h1>
      <p class="lede">This link is password-protected.</p>
      ${err}
      <form method="post" action="${escapeHtml(action)}">
        <label class="field">Password
          <input type="password" name="password" autocomplete="current-password" autofocus required>
        </label>
        <button type="submit" class="btn-primary">Open</button>
      </form>
      <p class="lede" style="margin-top:1rem">Agents: send header <code>${PASSWORD_HEADER}</code>.</p>
    </div>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function protectContent(
  request: Request,
  passwordHash: string | null | undefined,
  cookiePath: string,
  title: string,
): Promise<Response | null> {
  if (!passwordHash) return null;
  const url = new URL(request.url);
  const offered = offeredPassword(request);
  const expected = await unlockToken(passwordHash);

  if (request.method === "POST") {
    const formPw = await parseFormPassword(request);
    const candidate = formPw ?? offered;
    if (candidate !== null && hashesEqual(await hashSharePassword(candidate), passwordHash)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname + url.search,
          "set-cookie": gateCookieHeader(expected, cookiePath, url.hostname),
        },
      });
    }
    if (wantsJsonGate(request) || offered !== null) {
      return gateJson();
    }
    return gateHtml(passwordPromptHtml(title, url.pathname, true), 401);
  }

  if (offered !== null && hashesEqual(await hashSharePassword(offered), passwordHash)) return null;
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
