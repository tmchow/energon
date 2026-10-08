import { uiPage } from "./ui-render";
import { connectResponse } from "./connect";
import { CONNECTION_JSON_MAX_BYTES, decideConnection, purgeConnections } from "./connections";
import { aboutResponse } from "./about";
import { PRIVATE_HTML_HEADERS } from "./chrome";
import { pageChrome } from "./upstream";
import logoSvg from "./logo.svg";
import { actorFromAccess, assertEmailAllowed, bulkRevokeResponse, helpBody, listTokens, mintToken, parseTokenScope, rejectWorkersDevForHumans, requireAdmin, requireHuman, revokeToken, unauthorized } from "./auth";
import { setupResponse } from "./setup";
import { statsResponse } from "./stats";
import { parseHubListQuery } from "./catalog";
import { listAdminAudit } from "./audit";
import { listHubCatalog, type HubCatalogItem } from "./hub-catalog";

import { hubAdminHealthResponse, hubAdminRecomputeResponse, hubAdminSweepResponse, hubAdminUnlockResponse } from "./admin-health";
import { hubAdminTokensListResponse, revokeAdminTokens } from "./admin-tokens";
import { adminResponse } from "./admin";
import { cleanupResponse } from "./cleanup";
import { AGENT_SKILLS_PREFIX, agentSkillsResponse } from "./agent-skills";
import { llmsResponse } from "./llms";
import { authMarkdownResponse } from "./auth-doc";
import { openapiResponse } from "./openapi";
import { PRODUCT, RESERVED_HANDLES } from "./config";
import { ensureSchema } from "./db";
import { sweepExpired } from "./expire";
import { remapLegacySiteR2 } from "./site-r2-migrate";
import { exportOwnedZip } from "./export";
import { GRANT_UPLOAD_PATH, purgeGrants, redeemGrantRoute } from "./grants";
import { guestWrite } from "./guest-write";
import { CONTENT_ONLY_404_MESSAGE } from "./guest-write-protocol";
import { ensureUser } from "./handles";
import { identityFromEnv } from "./instance";
import { MEMORABLE_WORDS } from "./memorable";
import { deleteLooseFile, getLooseFile, hubLooseLinkAccess, patchLoose, postLooseFromRequest, putLooseFromRequest, serveLoose } from "./files";
import { contentPatch } from "./gate";
import { ApiError, accountOriginRequired, assertTrustedAccountOrigin, contentOrigin, dedicatedContentOrigin, isLocalHost, isMermaidAssetPath, isPublicContentPath, json, jsonMaybeSecret, methodNotAllowed, publicOrigin, readJson, secretJson, serveMermaidAsset } from "./http";
import { instancePolicy, policyPublic, tokenPolicy, tokenPolicyPublic, adminTokenPolicy, emailIsAdmin } from "./policy";
import {
  deleteSite,
  exportSiteZip,
  hubSiteLinkAccess,
  patchSite,
  postSite,
  putSiteFile,
  rejectSiteExpectedVersion,
  serveSite,
} from "./sites";
import { sweepStaleTmp, withUpload } from "./upload";
import { isSiteId, sitePublicUrl } from "./urls";
import { deploymentApi, importSiteArchive } from "./site-deployment-api";
import { dispatchV1 } from "./v1-routes";
import { DEPLOYMENT_GRANT_PATH, redeemDeploymentGrantRoute } from "./deployment-grants";
import { dispatchPlain, type Handler, type PlainRoute, type RouteCtx } from "./route-table";
import type { Actor, Env } from "./types";
const EMPTY_CATALOG: { items: HubCatalogItem[]; total: number; next_cursor: string | null } = { items: [], total: 0, next_cursor: null };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const respond = (response: Response) => {
      if (!/^\/[^/]+\/s\//.test(new URL(request.url).pathname)) return response;
      const headers = new Headers(response.headers);
      headers.set("cache-control", "private, no-store");
      headers.delete("cache-tag");
      if (request.method === "HEAD") void response.body?.cancel().catch(() => undefined);
      return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, statusText: response.statusText, headers });
    };
    try {
      return respond(await route(request, env, ctx));
    } catch (err) {
      const origin = publicOrigin(env);
      if (err instanceof ApiError) return respond(err.toResponse(origin));
      if (err instanceof URIError) {
        return respond(new ApiError(400, "bad_path", "That path is not valid URL encoding.").toResponse(origin));
      }
      console.error(err instanceof Error ? err.stack || err.message : err);
      return respond(json(
        {
          error: "internal",
          message: `Something went wrong on ${PRODUCT}. Try again, or open ${origin}/v1/help.`,
          hub: `${origin}/account`,
        },
        500,
      ));
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env.DB);
    await remapLegacySiteR2(env, ctx);
    await sweepExpired(env, ctx, true);
    await purgeConnections(env);
    await purgeGrants(env);
    await sweepStaleTmp(env.BUCKET);
  },
};

const CONTENT_ORIGIN_NOT_CONFIGURED = { error: "content_origin_not_configured", message: "Set CONTENT_ORIGIN to a separate custom hostname before serving content." };
const ACCOUNT_CONNECTION_DECISION = /^\/account\/connections\/([A-Za-z0-9]{24})\/(approve|deny)$/;
const ACCOUNT_TOKEN_REVOKE = /^\/account\/tokens\/([^/]+)\/revoke$/;
const ACCOUNT_SITE = /^\/account\/sites\/([^/]+)$/;
const ACCOUNT_SITE_FILE = /^\/account\/sites\/([^/]+)\/files\/(.+)$/;
const ACCOUNT_DEPLOYMENT = /^\/account\/sites\/([^/]+)\/deployments(?:\/([^/]+)(?:\/(prepare|commit|archive|files)(?:\/(.+))?)?)?$/;
const ACCOUNT_SITE_IMPORT = /^\/account\/sites\/([^/]+)\/import$/;
const ACCOUNT_SITE_EXPORT = /^\/account\/sites\/([^/]+)\/export$/;
const ACCOUNT_FILE_DOWNLOAD = /^\/account\/files\/([^/]+)\/download$/;
const ACCOUNT_FILE = /^\/account\/files\/([^/]+)$/;
const PUBLIC_FILE = /^\/([^/]+)\/f\/([^/]+)\/(.+)$/;
const PUBLIC_SITE = /^\/([^/]+)\/s\/([^/]+)\/([^/]+)\/?(.*)$/;

type RouteContext = RouteCtx<"none">;

function getOrHead(handler: Handler<"none">): PlainRoute["methods"] {
  return { GET: handler, HEAD: handler };
}

function anyMethod(handler: Handler<"none">): PlainRoute["methods"] {
  return { GET: handler, HEAD: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler };
}

function human(handler: (c: RouteContext, actor: Actor) => Response | Promise<Response>): Handler<"none"> {
  return async (c) => handler(c, await requireHuman(c.request, c.env, c.ctx));
}

function admin(handler: (c: RouteContext, actor: Actor) => Response | Promise<Response>): Handler<"none"> {
  return human((c, actor) => {
    requireAdmin(actor, publicOrigin(c.env));
    return handler(c, actor);
  });
}

const HEALTH = getOrHead(() => json({ ok: true }));

const HEALTH_ROUTES: readonly PlainRoute[] = [{ path: "/health", methods: HEALTH, strict: true }];

const DISCOVERY_ROUTES: readonly PlainRoute[] = [
  { path: "/llms.txt", methods: getOrHead((c) => llmsResponse(c.env)), strict: true },
  { path: "/auth.md", methods: getOrHead((c) => authMarkdownResponse(c.env)), strict: true },
  { path: "/v1/help", methods: { GET: (c) => json(helpBody(publicOrigin(c.env), c.env)) }, strict: true },
  { path: "/v1/openapi.json", methods: getOrHead((c) => openapiResponse(c.env)), strict: true },
  { path: "/v1/health", methods: HEALTH, strict: true },
  { path: /^\/static\/ui\//, methods: getOrHead((c) => serveUiAsset(c.env, c.request)), strict: true },
  { path: "/favicon.svg", methods: getOrHead(serveLogo) },
  { path: "/static/logo.svg", methods: getOrHead(serveLogo) },
];

const HUB_ROUTES: readonly PlainRoute[] = [
  { path: "/", methods: { GET: (c) => serveHub(c.request, c.env, c.ctx) } },
  { path: "/account", methods: { GET: (c) => serveHub(c.request, c.env, c.ctx) } },
  { path: "/about", methods: { GET: human((c, actor) => aboutResponse(actor, c.env)) } },
  { path: "/stats", methods: { GET: human((c, actor) => statsResponse(c.env, actor)) } },
  { path: "/admin", methods: { GET: admin((c, actor) => adminResponse(actor, c.env)) } },
  { path: "/setup", methods: { GET: human((c, actor) => setupResponse(actor, c.env)) } },
  {
    path: "/connect",
    methods: { GET: human((c, actor) => connectResponse(c.env, actor, c.url.searchParams.get("request") || "", c.url.searchParams.get("user_code"))) },
  },
  {
    path: ACCOUNT_CONNECTION_DECISION,
    methods: {
      POST: human(async (c, actor) => decideConnection(c.env, c.params[0], actor, await readJson(c.request, CONNECTION_JSON_MAX_BYTES), c.params[1] === "approve")),
    },
  },
  { path: "/keys", methods: { GET: (c) => serveTokens(c.request, c.env, c.ctx) } },
  { path: "/tokens", methods: { GET: (c) => Response.redirect(`${c.url.origin}/keys${c.url.search}`, 301) } },
  { path: "/account/data", methods: { GET: serveAccountData } },
  { path: "/account/admin/audit", methods: { GET: admin(async (c) => json(await listAdminAudit(c.env, c.url))) } },
  { path: "/account/admin/health", methods: { GET: (c) => hubAdminHealthResponse(c.request, c.env, c.ctx) } },
  { path: "/account/admin/quota/recompute", methods: { POST: (c) => hubAdminRecomputeResponse(c.request, c.env, c.ctx) } },
  { path: "/account/admin/sweep", methods: { POST: (c) => hubAdminSweepResponse(c.request, c.env, c.ctx) } },
  { path: "/account/admin/gates/unlock", methods: { POST: async (c) => hubAdminUnlockResponse(c.request, c.env, c.ctx, await readJson(c.request)) } },
  { path: "/account/admin/tokens", methods: { GET: (c) => hubAdminTokensListResponse(c.request, c.env, c.ctx) } },
  { path: "/account/admin/tokens/revoke", methods: { POST: admin(async (c, actor) => revokeAdminTokens(c.env, actor, await readJson(c.request))) } },
  {
    path: "/account/admin/cleanup",
    methods: { POST: admin(async (c, actor) => cleanupResponse(c.env, c.ctx, actor, await readJson(c.request), { admin: true })) },
  },
  { path: "/account/cleanup", methods: { POST: human(async (c, actor) => cleanupResponse(c.env, c.ctx, actor, await readJson(c.request))) } },
  { path: "/account/tokens", methods: { POST: human(mintAccountToken) } },
  { path: "/account/tokens/revoke", methods: { POST: human(async (c, actor) => bulkRevokeResponse(c.env, actor, await readJson(c.request))) } },
  {
    path: ACCOUNT_TOKEN_REVOKE,
    methods: {
      POST: human(async (c, actor) => {
        await revokeToken(c.env, actor.email, decodeURIComponent(c.params[0]), actor.userId);
        return json({ ok: true, revoked: true });
      }),
    },
  },
  {
    path: "/account/sites",
    methods: {
      POST: human(async (c, actor) => {
        const result = await postSite(c.env, actor, await readJson(c.request), c.ctx);
        return jsonMaybeSecret(result.body, result.status);
      }),
    },
  },
  {
    path: ACCOUNT_SITE,
    methods: {
      GET: human((c, actor) => hubSiteLinkAccess(c.env, actor, decodeURIComponent(c.params[0]))),
      DELETE: human(async (c, actor) => {
        await deleteSite(c.env, c.ctx, actor, decodeURIComponent(c.params[0]));
        return json({ ok: true, deleted: decodeURIComponent(c.params[0]) });
      }),
      PATCH: human(async (c, actor) => {
        const body = await readJson(c.request);
        return patchSite(c.env, actor, decodeURIComponent(c.params[0]), contentPatch(body), c.ctx);
      }),
    },
  },
  { path: ACCOUNT_SITE_FILE, methods: { PUT: human(putAccountSiteFile) } },
  { path: ACCOUNT_DEPLOYMENT, methods: anyMethod(accountDeployment), strict: true },
  {
    path: ACCOUNT_SITE_IMPORT,
    methods: { POST: human((c, actor) => importSiteArchive(c.request, c.env, actor, decodeURIComponent(c.params[0]), c.ctx)) },
  },
  {
    path: ACCOUNT_SITE_EXPORT,
    methods: { GET: human((c, actor) => exportSiteZip(c.env, c.ctx, actor, decodeURIComponent(c.params[0]))) },
  },
  { path: "/account/export", methods: { GET: human((c, actor) => exportOwnedZip(c.env, c.ctx, actor)) } },
  { path: "/account/files", methods: { POST: human((c, actor) => postLooseFromRequest(c.env, c.ctx, actor, c.request)) } },
  {
    path: ACCOUNT_FILE_DOWNLOAD,
    methods: { GET: human((c) => getLooseFile(c.env, c.ctx, decodeURIComponent(c.params[0]), { attachment: true })) },
  },
  {
    path: ACCOUNT_FILE,
    methods: {
      GET: human((c, actor) => hubLooseLinkAccess(c.env, actor, decodeURIComponent(c.params[0]))),
      PUT: human((c, actor) => putLooseFromRequest(c.env, c.ctx, actor, decodeURIComponent(c.params[0]), c.request)),
      PATCH: human(async (c, actor) => {
        const body = await readJson(c.request);
        return patchLoose(c.env, actor, decodeURIComponent(c.params[0]), contentPatch(body), c.ctx);
      }),
      DELETE: human(async (c, actor) => {
        await deleteLooseFile(c.env, c.ctx, actor, decodeURIComponent(c.params[0]));
        return json({ ok: true, deleted: decodeURIComponent(c.params[0]) });
      }),
    },
  },
];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const configuredContentOrigin = dedicatedContentOrigin(env);
  const early = await routeBeforeSchema(request, env, ctx, url, configuredContentOrigin);
  if (early) return early;

  await ensureSchema(env.DB);
  await remapLegacySiteR2(env, ctx);

  if (path === "/v1" || path === "/v1/") {
    return unauthorized(publicOrigin(env), undefined, env).toResponse(publicOrigin(env));
  }

  if (path.startsWith("/v1/")) return dispatchV1(request, env, ctx, path, method);

  if (accountOriginRequired(method, path)) {
    assertTrustedAccountOrigin(request);
  }

  const blocked = rejectWorkersDevForHumans(request, env);
  if (blocked) return blocked;

  const response = (await dispatchPlain(request, env, ctx, url, HUB_ROUTES)) ?? (await routePublicContent(request, env, ctx, url, isContentHost(configuredContentOrigin, url)));
  if (response) return response;

  return json(
    {
      error: "not_found",
      message: `No route for ${method} ${path}. See ${publicOrigin(env)}/v1/help.`,
      hub: `${publicOrigin(env)}/account`,
    },
    404,
  );
}

async function routeBeforeSchema(request: Request, env: Env, ctx: ExecutionContext, url: URL, configuredContentOrigin: string | null): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  const health = await dispatchPlain(request, env, ctx, url, HEALTH_ROUTES);
  if (health) return health;

  if (isMermaidAssetPath(path) && (method === "GET" || method === "HEAD")) {
    return serveMermaidAsset(env, request);
  }

  if (DEPLOYMENT_GRANT_PATH.test(path)) {
    await ensureSchema(env.DB);
    return redeemDeploymentGrantRoute(env, request);
  }
  const grantUpload = GRANT_UPLOAD_PATH.exec(path);
  if (grantUpload) {
    if (!isContentHost(configuredContentOrigin, url) && !isLocalHost(url.hostname)) {
      // No redirect: Access answers hub paths first, and clients drop Authorization on a cross-host redirect.
      return configuredContentOrigin
        ? json({ error: "not_found", message: `Upload grants are redeemed on the content origin: ${configuredContentOrigin}${path}` }, 404)
        : json(CONTENT_ORIGIN_NOT_CONFIGURED, 503);
    }
    await ensureSchema(env.DB);
    // Grant ids are alphanumeric, so the raw segment needs no decoding (and a malformed escape cannot throw).
    return redeemGrantRoute(env, ctx, request, grantUpload[1]);
  }
  return enforceContentHost(request, env, url, configuredContentOrigin) ?? dispatchPlain(request, env, ctx, url, DISCOVERY_ROUTES);
}

function enforceContentHost(request: Request, env: Env, url: URL, configuredContentOrigin: string | null): Response | null {
  const path = url.pathname;
  const method = request.method;
  const onContentHost = isContentHost(configuredContentOrigin, url);
  if (isPublicContentPath(path)) {
    if (onContentHost || isLocalHost(url.hostname)) return null;
    if (!configuredContentOrigin) return json(CONTENT_ORIGIN_NOT_CONFIGURED, 503);
    const status = method === "PUT" || method === "DELETE" ? 307 : 302;
    return Response.redirect(`${configuredContentOrigin}${path}${url.search}`, status);
  }
  if (path.startsWith(AGENT_SKILLS_PREFIX) && (onContentHost || isLocalHost(url.hostname))) {
    return agentSkillsResponse(request, env, path);
  }
  if (!onContentHost) return null;
  if (path === "/llms.txt" && (method === "GET" || method === "HEAD")) return llmsResponse(env, "content");
  if (path === "/llms.txt") return methodNotAllowed();
  return json({ error: "not_found", message: CONTENT_ONLY_404_MESSAGE }, 404);
}

async function routePublicContent(request: Request, env: Env, ctx: ExecutionContext, url: URL, onContentHost: boolean): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  const pubFile = PUBLIC_FILE.exec(path);
  if (pubFile) {
    const handle = decodeURIComponent(pubFile[1]).toLowerCase();
    if (!RESERVED_HANDLES.has(handle)) {
      if (method === "PUT" || method === "DELETE") {
        return guestWrite(env, ctx, request, {
          kind: "loose",
          handle,
          id: decodeURIComponent(pubFile[2]),
          filenameSeg: pubFile[3],
        });
      }
      if (method === "GET" || method === "POST") {
        return contentResponse(
          await serveLoose(env, ctx, handle, decodeURIComponent(pubFile[2]), pubFile[3], request),
          env,
          onContentHost,
        );
      }
    }
  }

  const pubSite = PUBLIC_SITE.exec(path);
  if (pubSite) {
    const handle = decodeURIComponent(pubSite[1]).toLowerCase();
    const id = decodeURIComponent(pubSite[2]);
    const slug = decodeURIComponent(pubSite[3]);
    if (!RESERVED_HANDLES.has(handle) && isSiteId(id)) {
      if (method === "PUT" || method === "DELETE") {
        return guestWrite(env, ctx, request, { kind: "site", handle, id, slug, rawPath: pubSite[4] || "" });
      }
      if (method === "GET" || method === "POST") {
        if (method === "GET" && !pubSite[4] && !path.endsWith("/")) {
          return Response.redirect(sitePublicUrl(env, handle, id, slug), 302);
        }
        return contentResponse(
          await serveSite(env, ctx, handle, id, slug, pubSite[4] || "", request),
          env,
          onContentHost,
        );
      }
    }
  }

  return null;
}

function isContentHost(configuredContentOrigin: string | null, url: URL): boolean {
  return configuredContentOrigin !== null && url.origin === configuredContentOrigin;
}

async function serveUiAsset(env: Env, request: Request): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  response.headers.set("x-content-type-options", "nosniff");
  if (response.ok) response.headers.set("cache-control", "public, max-age=31536000, immutable");
  return response;
}

function serveLogo(): Response {
  return new Response(logoSvg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

async function serveAccountData(c: RouteContext): Promise<Response> {
  const actor = await actorFromAccess(c.request, c.env, c.ctx);
  if (actor) assertEmailAllowed(c.env, actor.email);
  const query = parseHubListQuery(c.url);
  const user = actor ? await ensureUser(c.env, actor.email, actor.idpSub) : null;
  const page = actor ? await listHubCatalog(c.env, actor.email, query, user?.id) : EMPTY_CATALOG;
  const tokens = user ? await listTokens(c.env, user.email, user.id) : [];
  return secretJson({ email: actor?.email ?? null, admin: actor ? emailIsAdmin(c.env, actor.email) : false, items: page.items, total: page.total, cursor: page.next_cursor, tokens });
}

async function mintAccountToken(c: RouteContext, actor: Actor): Promise<Response> {
  const body = await readJson(c.request);
  const minted = await mintToken(c.env, actor.email, String(body.label ?? ""), actor.userId, body.ttl, parseTokenScope(body.scope));
  return secretJson(
    { id: minted.id, label: minted.label, token: minted.token, expires_at: minted.expires_at, scope: minted.scope, recoverable: false },
    201,
  );
}

async function putAccountSiteFile(c: RouteContext, actor: Actor): Promise<Response> {
  const { request, env, ctx, params } = c;
  rejectSiteExpectedVersion(request);
  const result = await withUpload(request, env, instancePolicy(env).fileBytes, publicOrigin(env), (upload) => putSiteFile(
    env,
    ctx,
    actor,
    decodeURIComponent(params[0]),
    params[1],
    upload,
    request.headers.get("content-type"),
  ));
  return json({ url: result.url, api_url: result.api_url, path: result.path, size: result.size }, result.created ? 201 : 200);
}

async function accountDeployment(c: RouteContext): Promise<Response> {
  const method = c.request.method;
  const [siteId, deploymentId, action, filePath] = c.params;
  const allowed = !deploymentId ? method === "POST" : !action ? ["GET", "DELETE"].includes(method)
    : ["prepare", "commit"].includes(action) ? method === "POST"
    : method === "PUT" && (action === "archive" || Boolean(filePath));
  if (!allowed || (filePath && action !== "files")) return methodNotAllowed();
  const actor = await requireHuman(c.request, c.env, c.ctx);
  return deploymentApi(c.request, c.env, actor, decodeURIComponent(siteId), deploymentId && decodeURIComponent(deploymentId), action, filePath === undefined ? undefined : decodeURIComponent(filePath));
}

function contentResponse(response: Response, env: Env, contentHost: boolean): Response {
  if (!contentHost) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", publicOrigin(env));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function serveHub(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await actorFromAccess(request, env, ctx);
  if (actor) assertEmailAllowed(env, actor.email);
  const user = actor ? await ensureUser(env, actor.email, actor.idpSub) : null;
  const query = parseHubListQuery(new URL(request.url));
  const page = actor ? await listHubCatalog(env, actor.email, query, user?.id) : EMPTY_CATALOG;
  const bootstrap = {
    email: actor?.email ?? null,
    admin: Boolean(actor?.admin),
    handle: user?.handle ?? null,
    origin: publicOrigin(env),
    content_origin: contentOrigin(env),
    policy: policyPublic(instancePolicy(env)),
    identity: identityFromEnv(env),
    items: page.items,
    total: page.total,
    cursor: page.next_cursor,
  };
  const chrome = await pageChrome(env, Boolean(actor?.admin));
  return new Response(uiPage(PRODUCT, { page: "hub", data: { ...bootstrap, words: MEMORABLE_WORDS, query }, footer: chrome.footer, upstream: chrome.upstream }), { headers: PRIVATE_HTML_HEADERS });
}

async function serveTokens(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  const tokens = await listTokens(env, actor.email, actor.userId);
  const bootstrap = {
    email: actor.email,
    tokens,
    token_env: identityFromEnv(env).tokenEnv,
    token_policy: tokenPolicyPublic(tokenPolicy(env), publicOrigin(env)),
    admin: Boolean(actor.admin),
    admin_token_policy: tokenPolicyPublic(adminTokenPolicy(), publicOrigin(env)),
  };
  const chrome = await pageChrome(env, Boolean(actor.admin));
  return new Response(uiPage(`Agent keys — ${PRODUCT}`, { page: "tokens", data: { ...bootstrap, now: Date.now() }, footer: chrome.footer, upstream: chrome.upstream }), { headers: PRIVATE_HTML_HEADERS });
}

export type { Env };
