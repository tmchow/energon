import {
  DEFAULT_PUBLIC_ORIGIN,
  MAX_IMPORT_FILES,
  PRODUCT,
  TOKEN_SECRET_LEN,
  formatBytes,
} from "./config";
import { ApiError, decodeJwtPayload, isLocalHost, isWorkersDev, nanoid, publicOrigin, sha256Hex } from "./http";
import { identityFromEnv, installLine } from "./instance";
import { emailAllowed, forbiddenDomain, instancePolicy, policyPublic } from "./policy";
import { ensureUser, getUser, getUserById } from "./handles";
import type { Actor, Env, TokenRow } from "./types";

export function unauthorized(origin: string, detail?: string, env?: Env): ApiError {
  const id = identityFromEnv(env || {});
  return new ApiError(
    401,
    "unauthorized",
    detail ||
      `${PRODUCT} needs an API token. Open ${origin}/tokens while logged in, mint a token, and send it as Authorization: Bearer ${id.tokenPrefix}…. Export it as ${id.tokenEnv}. Do not invent a token.`,
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
    `SELECT id, user_email, user_id, label, token_hash, created_at, last_used_at, revoked_at
     FROM tokens WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();
  if (!row || row.revoked_at) {
    throw unauthorized(
      origin,
      `That API token is missing or revoked. Open ${origin}/account, mint a new one, and export it as ${id.tokenEnv}.`,
      env,
    );
  }
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
  return {
    email: user?.email || row.user_email,
    userId: user?.id,
    idpSub: user?.idp_sub || undefined,
    via: "token",
    tokenId: row.id,
    tokenLabel: row.label,
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
    return { email, idpSub, via: "access" };
  }

  if (!ctx?.access?.aud) return null;
  try {
    const identity = await ctx.access.getIdentity();
    const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
    if (!email.includes("@")) return null;
    const idpSub = identitySubFromAccess(identity);
    if (!idpSub) return null;
    return { email, idpSub, via: "access" };
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
  return { ...actor, userId: user.id, email: user.email };
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

export async function mintToken(
  env: Env,
  email: string,
  label: string,
  userId?: string,
): Promise<{ id: string; token: string; label: string }> {
  const trimmed = label.trim().slice(0, 64);
  if (!trimmed) {
    throw new ApiError(400, "bad_label", "Give the token a label, like laptop or ci.");
  }
  const user = (userId ? await getUserById(env, userId) : null) || (await ensureUser(env, email));
  const id = nanoid(12);
  const token = `${identityFromEnv(env).tokenPrefix}${nanoid(TOKEN_SECRET_LEN)}`;
  const tokenHash = await hashToken(token);
  const created = new Date().toISOString();
  const hint = maskToken(token, env);
  await env.DB.prepare(
    `INSERT INTO tokens (id, user_email, user_id, label, token_hash, token_secret, token_hint, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)`,
  )
    .bind(id, user.email, user.id, trimmed, tokenHash, hint, created)
    .run();
  return { id, token, label: trimmed };
}

export function maskToken(token: string, env?: Env): string {
  const tokenPrefix = identityFromEnv(env || {}).tokenPrefix;
  if (token.length < 8) return `${tokenPrefix}…`;
  const prefix = token.startsWith(tokenPrefix) ? tokenPrefix : "";
  return `${prefix}…${token.slice(-4)}`;
}

export async function listTokens(env: Env, email: string, userId?: string): Promise<
  {
    id: string;
    label: string;
    hint: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked: boolean;
    recoverable: boolean;
  }[]
> {
  const rows = userId
    ? await env.DB.prepare(
        `SELECT id, label, created_at, last_used_at, revoked_at, token_hint FROM tokens
         WHERE user_id = ? OR (user_id IS NULL AND user_email = ?) ORDER BY created_at DESC`,
      ).bind(userId, email).all<{
        id: string;
        label: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
        token_hint: string | null;
      }>()
    : await env.DB.prepare(
        `SELECT id, label, created_at, last_used_at, revoked_at, token_hint FROM tokens
         WHERE user_email = ? ORDER BY created_at DESC`,
      ).bind(email).all<{
        id: string;
        label: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
        token_hint: string | null;
      }>();
  return (rows.results || []).map((r) => ({
    id: r.id,
    label: r.label,
    hint: r.token_hint,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
    revoked: Boolean(r.revoked_at),
    recoverable: false,
  }));
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
    identity: {
      origin: id.origin,
      skill: id.skill,
      env: id.tokenEnv,
      install: installLine(id),
      repo: id.repo,
    },
    sop: [
      `Look for env ${id.tokenEnv}. If missing, tell the human to open ${origin}/tokens, mint a key, and export it. The secret is shown once. Do not invent a token.`,
      `This instance's skill is ${id.skill} (install ${installLine(id)}). The origin is ${origin}. Do not guess another host.`,
      `Decide: a site (named folder of files) vs a file (one file, short id). Public URLs are /{handle}/s/{slug}/ and /{handle}/f/{id}/{filename}. Both stay put when you PUT again.`,
      `New site: POST /v1/sites with the human's slug and optional ttl (${policy.presets.map((p) => p.id).join(", ")}). Omit ttl to use ${policy.defaultTtl}. On 409, show the existing URL and ask: new slug, or retry with overwrite: true.`,
      `Write files with PUT /v1/sites/{slug}/files/{path}. One call per file. Last write wins on that path only. PUT does not extend expiry.`,
      `Read bytes with GET /v1/sites/{slug}/files/{path} or GET /v1/files/{id} (token; no share password needed). Humans and agents can also GET the /{handle}/s or /{handle}/f URL. Expired content is 410.`,
      `Who can write is per site or file: owner (the creating account, keyed by IdP identity) or instance (any token on this host). New objects copy this instance default (${policy.writePolicy}) unless you set write_policy on create (JSON field, multipart field, or X-Energon-Write-Policy). PATCH write_policy is creator-only. Anyone with a token can still read via /v1.`,
      `Optional share password: pass "password" on POST /v1/sites or PATCH /v1/sites/{slug}; X-Energon-Set-Password on POST/PUT /v1/files. Empty string clears. Default is no password — anyone with the link can open it.`,
      `Energon stores only a hash. Write responses echo the password you just set so you can copy it. GET never returns it. To change it, PATCH a new value; to remove it, PATCH "".`,
      `If a password is set, browsers get a form. Agents send header X-Energon-Password on the human URL. Do not put the password in the published file.`,
      `Optional: zip a folder and POST /v1/sites/{slug}/import. GET /v1/sites/{slug}/export downloads the site as a zip (same ${formatBytes(policy.fileBytes)} and file-count caps). Empty sites are 400.`,
      `A single file is never a zip. GET /v1/files/{id}?download=1 (or the public URL with ?download=1) returns the file with Content-Disposition: attachment.`,
      `One file: POST /v1/files, then PUT /v1/files/{id} to replace it. Same url and api_url. Optional multipart field ttl or header X-Energon-TTL.`,
      `Make a copy: POST /v1/sites {"slug":"new-slug","duplicate_from":"existing-slug"} or POST /v1/files {"duplicate_from":"id"} (optional filename). You become created_by. write_policy is the instance default. Fresh TTL. Password is not copied. Anyone who can read via /v1 can duplicate. If you already have replacement bytes this turn, POST/PUT those instead.`,
      `Give humans the /{handle}/s or /{handle}/f URL (and the password, if any). Agents can use that URL plus X-Energon-Password, or api_url with their token.`,
      `Never default to overwrite. Never use a guessed slug that already exists without the human confirming.`,
    ],
    routes: {
      "GET /llms.txt": "agent-readable overview, no auth",
      "GET /v1/help": "this document, no auth",
      "GET /v1/health": "liveness, no auth",
      "GET /v1/whoami": "token label and owner email",
      "POST /v1/sites": '{ "slug", "overwrite": false, "password"?: string, "ttl"?: string, "write_policy"?: "owner"|"instance", "duplicate_from"?: slug }',
      "PATCH /v1/sites/{slug}": '{ "password"?: string, "ttl"?: string, "write_policy"?: "owner"|"instance" } — empty password clears. ttl resets expiry from now. write_policy is creator-only.',
      "GET /v1/sites/{slug}/files/{path}": "raw file bytes (token)",
      "PUT /v1/sites/{slug}/files/{path}": "raw file body",
      "POST /v1/sites/{slug}/import": "application/zip unpacks into the site",
      "GET /v1/sites/{slug}/export": "zip of the site (token; skips share password)",
      "GET /v1/sites/{slug}": "JSON file listing",
      "DELETE /v1/sites/{slug}": "delete site and objects",
      "DELETE /v1/sites/{slug}/files/{path}": "delete one path",
      "POST /v1/files": "multipart field file, or raw body plus X-Filename; or JSON { duplicate_from, filename? }. Optional X-Energon-Set-Password, X-Energon-TTL, X-Energon-Write-Policy, X-Energon-Duplicate-From",
      "GET /v1/files": "loose files you created or last wrote. ?scope=created|edited|involved&q=&created_by=&sort=updated|name&limit=25&cursor=",
      "GET /v1/files/{id}": "raw loose file bytes (token). ?download=1 sets Content-Disposition: attachment",
      "PUT /v1/files/{id}": "replace loose file bytes; same id and URL; optional X-Energon-Set-Password",
      "PATCH /v1/files/{id}": '{ "password"?: string, "ttl"?: string, "write_policy"?: "owner"|"instance" } — empty password clears. ttl resets expiry from now. write_policy is creator-only.',
      "DELETE /v1/files/{id}": "delete the loose file and its object (no recycle bin)",
      "GET /v1/sites": "sites you created or last wrote. ?scope=created|edited|involved&q=&created_by=&sort=updated|name&limit=25&cursor=",
    },
  };
}
