import {
  DEFAULT_PUBLIC_ORIGIN,
  MAX_IMPORT_FILES,
  PRODUCT,
  TOKEN_SECRET_LEN,
  formatBytes,
} from "./config";
import { helpGuestWriteSop } from "./guest-write-protocol";
import { assertNever } from "./catalog";
import { ApiError, decodeJwtPayload, isLocalHost, isWorkersDev, json, nanoid, publicOrigin, sha256Hex } from "./http";
import { identityFromEnv, installLine } from "./instance";
import {
  emailAllowed,
  forbiddenDomain,
  instancePolicy,
  policyPublic,
  resolveTokenExpiresAt,
  tokenExpired,
  tokenPolicy,
  tokenPolicyPublic,
  adminTokenPolicy,
  emailIsAdmin,
} from "./policy";
import {
  BULK_REVOKE_TARGETS,
  bulkRevokeEligible,
  tokenStatus,
  type BulkRevokePreview,
  type BulkRevokeResult,
  type BulkRevokeTarget,
  type TokenSummary,
} from "./token-status";
import { ensureUser, getUser, getUserById } from "./handles";
import type { Actor, Env, TokenRow, TokenScope } from "./types";

export function unauthorized(origin: string, detail?: string, env?: Env): ApiError {
  const id = identityFromEnv(env || {});
  return new ApiError(
    401,
    "unauthorized",
    detail ||
      `${PRODUCT} needs an API token. Use ${id.tokenEnv} if set. Otherwise, if a human can respond, connect with a code per ${origin}/auth.md; if not, stop and ask a human to mint one at ${origin}/tokens. Send it as Authorization: Bearer ${id.tokenPrefix}…. Do not invent a token.`,
    { auth_url: `${origin}/auth.md`, tokens_url: `${origin}/tokens` },
  );
}

/** Terminal for agents: the token is dead, cannot be extended, and a human must authorize another. */
export function tokenExpiredError(origin: string, expiredAt: string, env?: Env): ApiError {
  const id = identityFromEnv(env || {});
  const when = Number.isFinite(Date.parse(expiredAt)) ? ` on ${expiredAt}` : "";
  return new ApiError(
    401,
    "token_expired",
    `That API token expired${when}. Tokens cannot be extended. Ask the human to approve a new connection (see ${origin}/auth.md) or mint a replacement at ${origin}/tokens and export it as ${id.tokenEnv}. Do not retry with this token. Do not invent a token.`,
    { expired_at: expiredAt, auth_url: `${origin}/auth.md`, tokens_url: `${origin}/tokens` },
  );
}

export function humanUnauthorized(origin: string): ApiError {
  return new ApiError(
    401,
    "unauthorized",
    `${PRODUCT} is internal. Sign in through Cloudflare Access, then open ${origin}/account.`,
  );
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function parseBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : null;
}

export function assertEmailAllowed(env: Env, email: string): void {
  const policy = instancePolicy(env);
  if (!emailAllowed(policy, email)) throw forbiddenDomain(policy);
}

export async function requireToken(request: Request, env: Env): Promise<Actor> {
  const origin = publicOrigin(env);
  const id = identityFromEnv(env);
  const token = parseBearer(request);
  if (!token) throw unauthorized(origin, undefined, env);
  if (!token.startsWith(id.tokenPrefix)) {
    throw unauthorized(
      origin,
      `That Authorization header is not an ${PRODUCT} token. Tokens start with ${id.tokenPrefix} and are minted at ${origin}/account. Export yours as ${id.tokenEnv}.`,
      env,
    );
  }
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT id, user_email, user_id, label, token_hash, created_at, last_used_at, revoked_at, expires_at, scope
     FROM tokens WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();
  if (!row || row.revoked_at) {
    throw unauthorized(
      origin,
      `That API token is missing or revoked. Stop using it. If a human can respond, connect again with a code per ${origin}/auth.md; if not, ask a human to mint a replacement at ${origin}/tokens and store it as ${id.tokenEnv}.`,
      env,
    );
  }
  if (tokenExpired(row.expires_at)) throw tokenExpiredError(origin, row.expires_at ?? "", env);
  assertEmailAllowed(env, row.user_email);
  const user = row.user_id ? await getUserById(env, row.user_id) : await getUser(env, row.user_email);
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (!Number.isFinite(last) || Date.now() - last > 10 * 60 * 1000) {
    try {
      await env.DB.prepare(`UPDATE tokens SET last_used_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), row.id)
        .run();
    } catch {
      // Usage metadata is best-effort and must not make a valid token unusable.
    }
  }
  const tokenScope = readTokenScope(row.scope);
  return {
    email: user?.email || row.user_email,
    userId: user?.id,
    idpSub: user?.idp_sub || undefined,
    via: "token",
    tokenId: row.id,
    tokenLabel: row.label,
    tokenExpiresAt: row.expires_at ?? null,
    tokenScope,
    admin: tokenScope === "admin" && emailIsAdmin(env, row.user_email),
  };
}

export function identitySubFromRequest(request: Request, email: string): string {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwt) {
    const payload = decodeJwtPayload(jwt);
    const sub = typeof payload?.sub === "string" ? payload.sub.trim() : "";
    if (sub) return sub;
  }
  const headerSub = (request.headers.get("Cf-Access-Authenticated-User-Sub") || "").trim();
  if (headerSub) return headerSub;
  return `local:${email}`;
}

function identitySubFromAccess(identity: unknown): string | null {
  if (identity && typeof identity === "object") {
    const rec = identity as { user_uuid?: unknown; sub?: unknown };
    const uuid = typeof rec.user_uuid === "string" ? rec.user_uuid.trim() : "";
    if (uuid) return uuid;
    const sub = typeof rec.sub === "string" ? rec.sub.trim() : "";
    if (sub) return sub;
  }
  return null;
}

export async function actorFromAccess(
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, "access">,
): Promise<Actor | null> {
  const url = new URL(request.url);
  if (isLocalHost(url.hostname)) {
    const headerEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
    const email = (
      (headerEmail?.includes("@") ? headerEmail : null) ||
      env.DEV_ACCESS_EMAIL ||
      "dev@example.com"
    )
      .trim()
      .toLowerCase();
    const idpSub = identitySubFromRequest(request, email);
    return { email, idpSub, via: "access", admin: emailIsAdmin(env, email) };
  }

  if (!ctx?.access?.aud) return null;
  try {
    const identity = await ctx.access.getIdentity();
    const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
    if (!email.includes("@")) return null;
    const idpSub = identitySubFromAccess(identity);
    if (!idpSub) return null;
    return { email, idpSub, via: "access", admin: emailIsAdmin(env, email) };
  } catch {
    return null;
  }
}

export async function requireHuman(
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, "access">,
): Promise<Actor> {
  const origin = publicOrigin(env);
  const actor = await actorFromAccess(request, env, ctx);
  if (!actor) throw humanUnauthorized(origin);
  assertEmailAllowed(env, actor.email);
  const user = await ensureUser(env, actor.email, actor.idpSub);
  return { ...actor, userId: user.id, email: user.email, admin: emailIsAdmin(env, user.email) };
}

export function rejectWorkersDevForHumans(request: Request, env?: Env): Response | null {
  const url = new URL(request.url);
  if (!isWorkersDev(url.hostname)) return null;
  const origin = env ? publicOrigin(env) : DEFAULT_PUBLIC_ORIGIN;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${PRODUCT}</title><p>${PRODUCT} is only served at <a href="${origin}">${origin}</a>.</p>`,
    {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

export function readTokenScope(raw: string | null | undefined): TokenScope {
  return raw === "admin" ? "admin" : "account";
}

export function parseTokenScope(raw: unknown): TokenScope {
  if (raw === undefined || raw === null || raw === "") return "account";
  if (raw === "account" || raw === "admin") return raw;
  throw new ApiError(400, "bad_scope", "scope must be account or admin.");
}

export function requireAdmin(actor: Actor, origin: string): void {
  if (actor.admin) return;
  throw new ApiError(
    403,
    "forbidden_admin",
    actor.via === "token"
      ? `That request needs an admin token minted at ${origin}/tokens by someone on ADMIN_EMAILS. Account tokens and the connect flow cannot do this.`
      : "That page is only for operators listed on ADMIN_EMAILS.",
  );
}

export async function mintToken(
  env: Env,
  email: string,
  label: string,
  userId?: string,
  ttl?: unknown,
  scope: TokenScope = "account",
): Promise<{ id: string; token: string; label: string; expires_at: string | null; scope: TokenScope }> {
  const trimmed = label.trim().slice(0, 64);
  if (!trimmed) {
    throw new ApiError(400, "bad_label", "Give the token a label, like laptop or ci.");
  }
  if (scope === "admin" && !emailIsAdmin(env, email)) {
    throw new ApiError(
      403,
      "forbidden_admin",
      "Only an address on ADMIN_EMAILS can mint an admin token.",
    );
  }
  const now = new Date();
  const policy = scope === "admin" ? adminTokenPolicy() : tokenPolicy(env);
  const expiresAt = resolveTokenExpiresAt(policy, ttl, now);
  const user = (userId ? await getUserById(env, userId) : null) || (await ensureUser(env, email));
  const id = nanoid(12);
  const token = `${identityFromEnv(env).tokenPrefix}${nanoid(TOKEN_SECRET_LEN)}`;
  const tokenHash = await hashToken(token);
  const created = now.toISOString();
  const hint = maskToken(token, env, scope);
  await env.DB.prepare(
    `INSERT INTO tokens (id, user_email, user_id, label, token_hash, token_secret, token_hint, created_at, last_used_at, revoked_at, expires_at, scope)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`,
  )
    .bind(id, user.email, user.id, trimmed, tokenHash, hint, created, expiresAt, scope)
    .run();
  return { id, token, label: trimmed, expires_at: expiresAt, scope };
}

export function maskToken(token: string, env?: Env, scope: TokenScope = "account"): string {
  const tokenPrefix = identityFromEnv(env || {}).tokenPrefix;
  if (token.length < 8) return `${tokenPrefix}…`;
  const prefix = token.startsWith(tokenPrefix) ? tokenPrefix : "";
  const mark = scope === "admin" ? "admin" : "";
  return `${prefix}${mark}…${token.slice(-4)}`;
}

type TokenListRow = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  token_hint: string | null;
  expires_at: string | null;
  scope: string | null;
};

export type TokenListing = TokenSummary & { expired: boolean; revoked: boolean; recoverable: boolean };

export async function listTokens(env: Env, email: string, userId?: string, now = Date.now()): Promise<TokenListing[]> {
  const columns = `id, label, created_at, last_used_at, revoked_at, token_hint, expires_at, scope`;
  const rows = userId
    ? await env.DB.prepare(
        `SELECT ${columns} FROM tokens
         WHERE user_id = ? OR (user_id IS NULL AND user_email = ?) ORDER BY created_at DESC`,
      ).bind(userId, email).all<TokenListRow>()
    : await env.DB.prepare(`SELECT ${columns} FROM tokens WHERE user_email = ? ORDER BY created_at DESC`)
        .bind(email)
        .all<TokenListRow>();
  return (rows.results || []).map((r) => {
    const status = tokenStatus(r, now);
    return {
      id: r.id,
      label: r.label,
      hint: r.token_hint,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at ?? null,
      scope: readTokenScope(r.scope),
      status,
      expired: status === "expired",
      revoked: status === "revoked",
      recoverable: false,
    };
  });
}

const BULK_REVOKE_SAMPLE = 10;
/** Bump when the canonical confirm string changes shape so stale confirms drift instead of executing. */
const BULK_REVOKE_CONFIRM_VERSION = "1";
const BULK_REVOKE_CONFIRM_RE = /^[0-9a-f]{32}$/;
/** D1 caps a statement at 100 bound parameters; one slot goes to revoked_at. */
const BULK_REVOKE_BATCH = 90;

type BulkRevokeOutcome =
  | { kind: "preview"; preview: BulkRevokePreview }
  | { kind: "drift"; preview: BulkRevokePreview }
  | { kind: "executed"; result: BulkRevokeResult };

function isBulkRevokeTarget(value: unknown): value is BulkRevokeTarget {
  return typeof value === "string" && (BULK_REVOKE_TARGETS as readonly string[]).includes(value);
}

async function bulkRevokeConfirm(target: BulkRevokeTarget, eligible: TokenListing[]): Promise<string> {
  const ids = eligible.map((token) => token.id).sort();
  return (await sha256Hex([BULK_REVOKE_CONFIRM_VERSION, "tokens", target, ...ids].join("\n"))).slice(0, 32);
}

export async function bulkRevokeTokens(
  env: Env,
  email: string,
  userId: string | undefined,
  body: Record<string, unknown>,
): Promise<BulkRevokeOutcome> {
  const target = body.target;
  if (!isBulkRevokeTarget(target)) {
    throw new ApiError(400, "bad_target", `target must be one of: ${BULK_REVOKE_TARGETS.join(", ")}.`);
  }
  const confirm = body.confirm === undefined || body.confirm === null ? null : String(body.confirm).trim().toLowerCase();
  if (confirm !== null && !BULK_REVOKE_CONFIRM_RE.test(confirm)) {
    throw new ApiError(400, "bad_confirm", "confirm must be the confirm string from a preview of this same request. Omit it to preview.");
  }
  const eligible = (await listTokens(env, email, userId)).filter((token) => bulkRevokeEligible(target, token.status));
  const expected = await bulkRevokeConfirm(target, eligible);
  const preview: BulkRevokePreview = {
    target,
    executed: false,
    matched: eligible.length,
    sample: eligible.slice(0, BULK_REVOKE_SAMPLE).map(({ id, label, hint, status, last_used_at }) => ({ id, label, hint, status, last_used_at })),
    confirm: expected,
  };
  if (confirm === null) return { kind: "preview", preview };
  if (confirm !== expected) return { kind: "drift", preview };
  if (eligible.length) {
    const revokedAt = new Date().toISOString();
    const statements = [];
    for (let i = 0; i < eligible.length; i += BULK_REVOKE_BATCH) {
      const ids = eligible.slice(i, i + BULK_REVOKE_BATCH).map((token) => token.id);
      const marks = ids.map(() => "?").join(", ");
      statements.push(
        env.DB.prepare(`UPDATE tokens SET revoked_at = ? WHERE revoked_at IS NULL AND id IN (${marks})`).bind(revokedAt, ...ids),
      );
    }
    await env.DB.batch(statements);
  }
  return { kind: "executed", result: { ok: true, target, executed: true, revoked: eligible.length } };
}

export async function bulkRevokeResponse(env: Env, actor: Actor, body: Record<string, unknown>): Promise<Response> {
  const outcome = await bulkRevokeTokens(env, actor.email, actor.userId, body);
  switch (outcome.kind) {
    case "preview":
      return json(outcome.preview);
    case "executed":
      return json(outcome.result);
    case "drift":
      return new ApiError(
        409,
        "token_revoke_drift",
        "Your tokens changed since that preview. Review this fresh preview and resend with its confirm.",
        outcome.preview,
      ).toResponse(publicOrigin(env));
    default:
      return assertNever(outcome);
  }
}

export async function revokeToken(env: Env, email: string, id: string, userId?: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT id, user_email, user_id, revoked_at FROM tokens WHERE id = ?`)
    .bind(id)
    .first<{ id: string; user_email: string; user_id: string | null; revoked_at: string | null }>();
  const owns = row && (userId ? row.user_id === userId || (!row.user_id && row.user_email === email) : row.user_email === email);
  if (!row || !owns) {
    throw new ApiError(404, "token_not_found", "That token is not on your account.");
  }
  if (row.revoked_at) return;
  await env.DB.prepare(`UPDATE tokens SET revoked_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
}

export function helpBody(origin: string, env?: Env): unknown {
  const id = identityFromEnv(env || {});
  const policy = instancePolicy(env || {});
  return {
    product: PRODUCT,
    hub: origin,
    content_origin: env?.CONTENT_ORIGIN?.trim() || null,
    account: `${origin}/account`,
    openapi: `${origin}/v1/openapi.json`,
    auth_url: `${origin}/auth.md`,
    connection_url: `${origin}/v1/connections`,
    env: id.tokenEnv,
    skill: id.skill,
    marketplace: id.marketplace,
    install: installLine(id),
    auth: `Authorization: Bearer ${id.tokenPrefix}<secret>`,
    token_prefix: id.tokenPrefix,
    limits: {
      file_bytes: policy.fileBytes,
      zip_bytes: policy.fileBytes,
      platform_bytes: policy.platformBytes,
      max_import_files: MAX_IMPORT_FILES,
    },
    retention: policyPublic(policy),
    tokens: tokenPolicyPublic(tokenPolicy(env || {}), origin),
    admin_tokens: tokenPolicyPublic(adminTokenPolicy(), origin),
    identity: {
      origin: id.origin,
      skill: id.skill,
      env: id.tokenEnv,
      install: installLine(id),
      repo: id.repo,
    },
    sop: [
      `Look for env ${id.tokenEnv}. If missing and a human can respond, follow ${origin}/auth.md to connect with a code and save the delivered token as ${id.tokenEnv} where this environment keeps secrets. If no human can respond, stop and ask for a token provisioned at ${origin}/tokens. The secret is delivered once. Do not invent a token.`,
      `Tokens expire after the lifetime the human picked at mint (default 90 days; see tokens.presets). A 401 with error token_expired is terminal: stop using it, connect again with a code or ask the human to provision a replacement at ${origin}/tokens, and do not retry the expired token. Tokens cannot be extended. GET /v1/whoami shows your token's expires_at.`,
      `An admin token is opt-in at mint on /tokens by someone on ADMIN_EMAILS. Connect never grants it. whoami.admin is true only while that token's scope is admin and the owner is still on the list. Removing the email strips admin from every token at once. Admin tokens still act as the account for ordinary /v1 calls. They last at most 7 days (default 1 day) and cannot be never. Their hint inserts admin after the token prefix, then an ellipsis and the last four. GET /v1/admin/audit lists recorded admin actions (who, which token, what, filters, counts, when). Needs an admin token.`,
      `When your task is done and nothing else will use this token, DELETE /v1/whoami revokes it (self only: it cannot list or revoke other tokens). Later calls with it are 401. Do not do this to a token the human stored for reuse, such as CI.`,
      `This Energon's skill is ${id.skill} (install ${installLine(id)}). The origin is ${origin}. Do not guess another Energon.`,
      `The HTTP schema (paths, request and response bodies, status codes, error codes) is ${origin}/v1/openapi.json. This document describes this Energon: origins, token env, retention presets, token lifetimes, limits.`,
      `Decide: a site (named folder of files) vs a file (one file, short id). Public URLs are /{handle}/s/{id}/{slug}/ and /{handle}/f/{id}/{filename}. Both stay put when you PUT again.`,
      `New site: POST /v1/sites with the human's slug and optional ttl (${policy.presets.map((p) => p.id).join(", ")}). Omit ttl to use ${policy.defaultTtl}. Response includes id. Same slug always creates a new site (new id).`,
      `Write files with PUT /v1/sites/{id}/files/{path}. One call per file. Last write wins on that path only. PUT does not extend expiry. Slug does not resolve a site.`,
      `Read bytes with GET /v1/sites/{id}/files/{path} or GET /v1/files/{id} (token; no share password needed). Humans and agents can also GET the /{handle}/s/{id}/{slug} or /{handle}/f URL. Expired content is 410.`,
      `Each site and file carries last_read_at in list and detail bodies: when the Worker last served its bytes over either path, null if never. It is a floor, not a view count: writes are throttled to about one per hour, and public reads answered from the edge cache do not reach the Worker. The edge cache holds public responses for at most a day, so the stamp lags real reads by at most about a day plus the hourly throttle. Treat it as "read at least this recently", never as "unread since".`,
      `Who can write is per site or file: owner (the creating account, keyed by IdP identity) or org (any token on this host). New objects copy this Energon's default (${policy.writePolicy}) unless you set write_policy on create (JSON field, multipart field, or X-Energon-Write-Policy). PATCH write_policy is creator-only. Anyone with a token can still read via /v1.`,
      `Optional share password: pass "password" on POST /v1/sites or PATCH /v1/sites/{id}; X-Energon-Set-Password on POST/PUT /v1/files. Empty string clears. Default is no password — anyone with the link can open it.`,
      `Write responses echo the password you just set so you can copy it. /v1 GET never returns the phrase — only password_protected. To change it, PATCH a new value; to remove it, PATCH "". The signed-in Hub Link access dialog shows stored phrases so a human can copy them again.`,
      `If a password is set, browsers get a form. Agents send header X-Energon-Password on the human URL. Do not put the password in the published file.`,
      `Optional: zip a folder and POST /v1/sites/{id}/import. GET /v1/sites/{id}/export downloads the site as a zip (same ${formatBytes(policy.fileBytes)} and file-count caps). Empty sites are 400.`,
      `A single file is never a zip. GET /v1/files/{id}?download=1 (or the public URL with ?download=1) returns the file with Content-Disposition: attachment.`,
      `One file: POST /v1/files, then PUT /v1/files/{id} to replace it. Same url and api_url. Optional multipart field ttl or header X-Energon-TTL.`,
      `Make a copy: POST /v1/sites {"slug":"new-slug","duplicate_from":"existing-id"} or POST /v1/files {"duplicate_from":"id"} (optional filename). You become created_by. write_policy is this Energon's default. Fresh TTL. Password is not copied. Anyone who can read via /v1 can duplicate. If you already have replacement bytes this turn, POST/PUT those instead.`,
      `Give humans the /{handle}/s or /{handle}/f URL (and the password, if any). Agents can use that URL plus X-Energon-Password, or api_url with their token.`,
      `Clean up in bulk with POST /v1/cleanup: target ids or the list filters (expires=never, updated_before, min_size, q, created_by), action delete, set_ttl (with ttl), or expire (30m grace). Without confirm it is a dry run. Show the human the preview (matched, eligible, skipped, bytes, sample), then resend the same body with its confirm to execute. GET /v1/sites and GET /v1/files take the same filters plus sort=size|age to find candidates first.`,
      `Operators on ADMIN_EMAILS mint an admin token, then POST /v1/admin/cleanup with the same preview/confirm shape, without involvement scope. Add owner (handle) and last_read_before. set_ttl without ttl is 7d so the owner sees Expires and can push it back. expire is 400 expire_not_own on anyone else's content. delete is explicit. GET /v1/admin/audit lists those actions. Never returns bytes or secrets.`,
      ...helpGuestWriteSop(),
    ],
    routes: {
      "GET /llms.txt": "agent-readable overview, no auth",
      "GET /auth.md": "authentication instructions, no auth",
      "POST /v1/connections": "request a human-approved agent connection, no auth",
      "POST /v1/connections/{id}/token": "poll for one-time token delivery with poll_token, no bearer auth",
      "GET /v1/help": "this document, no auth",
      "GET /v1/health": "liveness, no auth",
      "GET /v1/openapi.json": "OpenAPI 3.1 HTTP contract, no auth",
      "GET /v1/whoami": "token label, owner email, expires_at (null = never), scope (account|admin), and admin (true only for an admin-scoped token whose owner is still on ADMIN_EMAILS)",
      "DELETE /v1/whoami": "revoke the calling token (self only); later calls with it are 401",
      "POST /v1/sites": '{ "slug", "password"?: string, "write_password"?: string, "ttl"?: string, "write_policy"?: "owner"|"org", "duplicate_from"?: id }',
      "PATCH /v1/sites/{id}": '{ "password"?: string, "write_password"?: string, "ttl"?: string, "write_policy"?: "owner"|"org" } — empty password or write_password clears. ttl resets expiry from now. write_policy and write_password are creator-only.',
      "GET /v1/sites/{id}/files/{path}": "raw file bytes (token)",
      "PUT /v1/sites/{id}/files/{path}": "raw file body",
      "POST /v1/sites/{id}/import": "application/zip unpacks into the site",
      "GET /v1/sites/{id}/export": "zip of the site (token; skips share password)",
      "GET /v1/sites/{id}": "JSON file listing",
      "DELETE /v1/sites/{id}": "delete site and objects",
      "DELETE /v1/sites/{id}/files/{path}": "delete one path",
      "POST /v1/files": "multipart field file, or raw body plus X-Filename; or JSON { duplicate_from, filename? }. Optional X-Energon-Set-Password, X-Energon-Set-Write-Password, X-Energon-TTL, X-Energon-Write-Policy, X-Energon-Duplicate-From",
      "GET /v1/files": "loose files you created or last wrote. ?scope=created|edited|involved&q=&created_by=&expires=never|expires_before=<iso>&updated_before=<iso>&min_size=<bytes|500mb>&sort=updated|name|size|age&limit=25&cursor=. Items carry last_read_at (floor; null = never)",
      "GET /v1/files/{id}": "raw loose file bytes (token). ?download=1 sets Content-Disposition: attachment",
      "PUT /v1/files/{id}": "replace loose file bytes; same id and URL; optional X-Energon-Set-Password",
      "PATCH /v1/files/{id}": '{ "password"?: string, "write_password"?: string, "ttl"?: string, "write_policy"?: "owner"|"org" } — empty password or write_password clears. ttl resets expiry from now. write_policy and write_password are creator-only.',
      "DELETE /v1/files/{id}": "delete the loose file and its object (no recycle bin)",
      "GET /v1/sites": "sites you created or last wrote. ?scope=created|edited|involved&q=&created_by=&expires=never|expires_before=<iso>&updated_before=<iso>&min_size=<bytes|500mb>&sort=updated|name|size|age&limit=25&cursor=. Items carry last_read_at (floor; null = never)",
      "POST /v1/cleanup":
        '{ "target": { "sites"?: [id], "files"?: [id] } or list filters { "scope"?, "q"?, "created_by"?, "expires"?: "never", "expires_before"?, "updated_before"?, "last_read_before"?, "owner"?, "min_size"?, "kind"?: "sites"|"files" }, "action": "delete"|"set_ttl"|"expire", "ttl"?: string (set_ttl only), "confirm"?: string } — without confirm: dry run { matched, eligible, skipped: { total, by_reason, sample }, bytes, sample, confirm }. Resend with that confirm to execute { applied, skipped, failed }. Only what you created or last wrote and can write; the rest is skipped. At most 100 eligible per call (413 cleanup_too_many). 409 cleanup_drift carries a fresh preview. {} targets everything you are involved in. No recycle bin.',
      "GET /v1/admin/audit":
        "admin token. Recorded admin actions: who, token hint, action, executed, filters, counts, when. ?limit=25&cursor=. Never includes bytes, share passwords, or write passwords.",
      "POST /v1/admin/cleanup":
        "admin token. Same preview/confirm/cap as POST /v1/cleanup, host-wide (no involvement, no scope). target.owner is a handle; last_read_before matches never-read or last_read_at older than the timestamp. set_ttl without ttl is 7d. expire on anyone else's content is 400 expire_not_own. delete is explicit. Sample includes owner, last_read_at. Recorded in GET /v1/admin/audit. Never returns published bytes or secrets.",
    },
  };
}
