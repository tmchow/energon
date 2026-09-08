import { DEFAULT_PUBLIC_ORIGIN, MAX_FILE_BYTES, MAX_PLATFORM_BYTES, PRODUCT, RESERVED_HANDLES, formatBytes } from "./config";
import type { Env } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(origin: string): Response {
    return Response.json(
      {
        error: this.code,
        message: this.message,
        hub: `${origin}/account`,
        ...this.extra,
      },
      { status: this.status, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}

export function publicOrigin(env: Env): string {
  return (env.PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, "");
}

const contentOriginCache = new WeakMap<object, string>();

export function contentOrigin(env: Env): string {
  const cached = contentOriginCache.get(env);
  if (cached) return cached;
  const configured = (env.CONTENT_ORIGIN || "").trim();
  if (!configured) {
    throw new ApiError(
      503,
      "content_origin_not_configured",
      "Set CONTENT_ORIGIN to a separate custom hostname before publishing content.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ApiError(503, "content_origin_not_configured", "CONTENT_ORIGIN must be a valid HTTP(S) origin.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ApiError(503, "content_origin_not_configured", "CONTENT_ORIGIN must be an HTTP(S) origin without a path.");
  }
  let hub: URL;
  try {
    hub = new URL(publicOrigin(env));
  } catch {
    throw new ApiError(503, "content_origin_not_configured", "PUBLIC_ORIGIN must be a valid origin.");
  }
  if (parsed.origin === hub.origin && !isLocalHost(parsed.hostname)) {
    throw new ApiError(503, "content_origin_not_configured", "CONTENT_ORIGIN must differ from PUBLIC_ORIGIN.");
  }
  contentOriginCache.set(env, parsed.origin);
  return parsed.origin;
}

export function hasDedicatedContentOrigin(env: Env): boolean {
  return dedicatedContentOrigin(env) !== null;
}

export function dedicatedContentOrigin(env: Env): string | null {
  try {
    const content = contentOrigin(env);
    return content === new URL(publicOrigin(env)).origin ? null : content;
  } catch {
    return null;
  }
}

export function isPublicContentPath(path: string): boolean {
  const match = path.match(/^\/([^/]+)\/(?:f|s)(?:\/|$)/);
  if (!match) return false;
  try {
    return !RESERVED_HANDLES.has(decodeURIComponent(match[1]).toLowerCase());
  } catch {
    return false;
  }
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export function secretJson(data: unknown, status = 200): Response {
  return json(data, status, { "cache-control": "no-store, private", pragma: "no-cache" });
}

export function jsonMaybeSecret(data: { password?: unknown; write_password?: unknown }, status = 200): Response {
  const share = typeof data.password === "string" && data.password;
  const write = typeof data.write_password === "string" && data.write_password;
  if (share || write) return secretJson(data, status);
  return json(data, status);
}

/** Unique origin for publisher HTML/SVG so a page cannot read other objects' cookies. */
export const ACTIVE_DOCUMENT_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation";

export function isolationCsp(contentType: string): string | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml" || type === "image/svg+xml") {
    return ACTIVE_DOCUMENT_CSP;
  }
  return null;
}

export function applyIsolation(headers: Headers, contentType: string): void {
  const csp = isolationCsp(contentType);
  if (csp) headers.set("content-security-policy", csp);
}

/** ESM entry + lazy chunks. Served from assets, not the Worker isolate. */
export const MERMAID_SCRIPT_PATH = "/static/mermaid/mermaid.esm.min.mjs";

export function isMermaidAssetPath(path: string): boolean {
  return path === MERMAID_SCRIPT_PATH || path.startsWith("/static/mermaid/");
}

/** Unique-origin sandbox makes `'self'` unreliable; name the serving origin. */
export function mermaidDocumentCsp(origin: string): string {
  return `${ACTIVE_DOCUMENT_CSP}; script-src ${origin} 'unsafe-inline'`;
}

export async function serveMermaidAsset(env: Env, request: Request): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) {
    return json({ error: "not_found", message: "Mermaid runtime is not on this host." }, 404);
  }
  const headers = new Headers(asset.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("x-content-type-options", "nosniff");
  const type = headers.get("content-type") || "";
  if (!/javascript|ecmascript/i.test(type)) {
    headers.set("content-type", "text/javascript; charset=utf-8");
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=86400");
  return new Response(asset.body, { status: asset.status, headers });
}

export function assertTrustedAccountOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = new URL(request.url).origin;
  if (!origin || origin !== host) {
    throw new ApiError(403, "bad_origin", "This account action must come from the hub origin.");
  }
}

export function accountOriginRequired(method: string, path: string): boolean {
  if (!path.startsWith("/account")) return false;
  return method !== "GET" && method !== "HEAD";
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nanoid(size: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  // Rejection sampling avoids modulo bias from `byte % 62` (256 is not divisible by 62).
  const limit = 256 - (256 % alphabet.length);
  let id = "";
  while (id.length < size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size - id.length));
    for (const b of bytes) {
      if (b >= limit) continue;
      id += alphabet[b % alphabet.length]!;
      if (id.length === size) break;
    }
  }
  return id;
}

export function basename(name: string): string {
  const cleaned = name.replace(/\\/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || "file";
}

export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const safe = filename.replace(/["\\\r\n]/g, "").slice(0, 180) || "download";
  return `${kind}; filename="${safe}"`;
}

export function wantsDownload(request: Request): boolean {
  const v = new URL(request.url).searchParams.get("download");
  return v === "1" || v === "true" || v === "";
}

export function normalizeRelPath(input: string): string | null {
  const replaced = input.replace(/\\/g, "/");
  if (replaced.startsWith("/") || /^[a-zA-Z]:/.test(replaced)) return null;
  const parts = replaced.split("/").filter((s) => s && s !== ".");
  if (parts.length === 0) return null;
  // Reject URL schemes (`javascript:…`, `data:…`) and empty / traversal segments.
  if (parts.some((s) => s === ".." || s === "__MACOSX" || s.includes(":"))) return null;
  return parts.join("/");
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function isWorkersDev(hostname: string): boolean {
  return hostname.endsWith(".workers.dev");
}

export async function readBodyCapped(
  request: Request,
  maxBytes: number,
  origin: string,
): Promise<Uint8Array> {
  const headerLen = request.headers.get("content-length");
  if (headerLen) {
    const n = Number(headerLen);
    if (Number.isFinite(n) && n > maxBytes) {
      throw tooLarge(n, origin, maxBytes);
    }
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) throw tooLarge(buf.byteLength, origin, maxBytes);
  return buf;
}

export function tooLarge(actual: number, _origin: string, limitBytes = MAX_FILE_BYTES): ApiError {
  const cap = formatBytes(limitBytes);
  const mb = (actual / (1024 * 1024)).toFixed(1);
  return new ApiError(
    413,
    "too_large",
    `That upload is over the ${cap} cap (${mb} MB). ${PRODUCT} rejects files and zip uploads larger than ${cap} to avoid bill shock. Shrink it or split it, then retry.`,
    { limit_bytes: limitBytes, actual_bytes: actual },
  );
}

export function storageCap(used: number, incoming: number, limitBytes = MAX_PLATFORM_BYTES): ApiError {
  const cap = formatBytes(limitBytes);
  const usedGb = (used / (1024 * 1024 * 1024)).toFixed(2);
  const nextGb = ((used + incoming) / (1024 * 1024 * 1024)).toFixed(2);
  return new ApiError(
    413,
    "storage_cap",
    `This upload would take ${PRODUCT} past the ${cap} platform safety cap (${usedGb} GB used, would become ${nextGb} GB). Delete old sites or files, then retry. This cap can be raised later.`,
    { limit_bytes: limitBytes, used_bytes: used },
  );
}

export async function totalStoredBytes(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(size), 0) FROM site_files) +
        (SELECT COALESCE(SUM(size), 0) FROM loose_files) AS total`,
    )
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function usedStorage(db: D1Database): Promise<number> {
  const ledger = await db.prepare(`SELECT used FROM platform_quota WHERE id = 1`).first<{ used: number }>();
  if (ledger) return Number(ledger.used);
  return totalStoredBytes(db);
}

export async function recomputeStorage(db: D1Database): Promise<{ before: number; after: number }> {
  const before = await usedStorage(db);
  await db
    .prepare(
      `UPDATE platform_quota SET used = (
        (SELECT COALESCE(SUM(size), 0) FROM site_files) +
        (SELECT COALESCE(SUM(size), 0) FROM loose_files)
      ) WHERE id = 1`,
    )
    .run();
  const after = await usedStorage(db);
  return { before, after };
}

export async function releaseStorage(db: D1Database, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await db
    .prepare(`UPDATE platform_quota SET used = MAX(0, used - ?) WHERE id = 1`)
    .bind(bytes)
    .run()
    .catch(() => undefined);
}

export async function assertStorageRoom(
  db: D1Database,
  additionalBytes: number,
  replacingBytes = 0,
  platformBytes = MAX_PLATFORM_BYTES,
): Promise<number> {
  const delta = additionalBytes - replacingBytes;
  if (delta <= 0) return 0;
  try {
    const reserved = await db
      .prepare(`UPDATE platform_quota SET used = used + ? WHERE id = 1 AND used + ? <= ?`)
      .bind(delta, delta, platformBytes)
      .run();
    if (Number(reserved.meta?.changes ?? 0) > 0) return delta;
    const ledger = await db.prepare(`SELECT used FROM platform_quota WHERE id = 1`).first<{ used: number }>();
    if (ledger) throw storageCap(Number(ledger.used), delta, platformBytes);
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }
  const used = await totalStoredBytes(db);
  const next = used - replacingBytes + additionalBytes;
  if (next > platformBytes) throw storageCap(used, delta, platformBytes);
  return 0;
}

/** Same-bucket copy. Streams through the Worker once; does not go through the agent. */
export async function copyR2Object(bucket: R2Bucket, fromKey: string, toKey: string): Promise<number> {
  const obj = await bucket.get(fromKey);
  if (!obj) {
    throw new ApiError(500, "copy_failed", "A source file is missing from storage. Re-upload it, then retry.");
  }
  await bucket.put(toKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: obj.customMetadata,
  });
  return obj.size ?? 0;
}

export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    return JSON.parse(atob(payload + pad)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function htmlPage(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
}

export async function readJson(request: Request, maxBytes?: number): Promise<Record<string, unknown>> {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
    throw new ApiError(415, "bad_content_type", "Send a JSON object body.");
  }
  let received = 0;
  const body = maxBytes && request.body
    ? request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new ApiError(413, "too_large", `Connection requests must be at most ${maxBytes} bytes.`, { limit_bytes: maxBytes });
        controller.enqueue(chunk);
      },
    }))
    : request.body;
  const text = maxBytes ? await new Response(body).text() : await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new Error("not object");
  } catch {
    throw new ApiError(400, "bad_json", "Send a JSON object body.");
  }
}
