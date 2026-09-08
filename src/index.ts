import { uiPage } from "./ui-render";
import { connectResponse } from "./connect";
import { decideConnection, exchangeConnection, purgeConnections, startConnection } from "./connections";
import { aboutResponse } from "./about";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import logoSvg from "./logo.svg";
import { actorFromAccess, assertEmailAllowed, bulkRevokeResponse, helpBody, listTokens, mintToken, parseTokenScope, rejectWorkersDevForHumans, requireAdmin, requireHuman, requireToken, revokeToken, unauthorized } from "./auth";
import { setupResponse } from "./setup";
import { statsResponse } from "./stats";
import { parseListQuery } from "./catalog";
import { adminAuditResponse, listAdminAudit, requireAdminActor } from "./audit";
import { adminHealthResponse, hubAdminHealthResponse, adminRecomputeResponse, hubAdminRecomputeResponse, adminSweepResponse, hubAdminSweepResponse, adminUnlockResponse, hubAdminUnlockResponse } from "./admin-health";
import { adminTokensListResponse, hubAdminTokensListResponse, revokeAdminTokens } from "./admin-tokens";
import { adminResponse } from "./admin";
import { cleanupResponse } from "./cleanup";
import { llmsResponse } from "./llms";
import { authMarkdownResponse } from "./auth-doc";
import { openapiResponse } from "./openapi";
import { PRODUCT, RESERVED_HANDLES } from "./config";
import { ensureSchema } from "./db";
import { sweepExpired } from "./expire";
import { remapLegacySiteR2 } from "./site-r2-migrate";
import { exportOwnedZip } from "./export";
import { guestWrite } from "./guest-write";
import { CONTENT_ONLY_404_MESSAGE } from "./guest-write-protocol";
import { ensureUser } from "./handles";
import { identityFromEnv } from "./instance";
import { MEMORABLE_WORDS } from "./memorable";
import { deleteLooseFile, getLooseFile, hubLists, hubLooseLinkAccess, listLooseJson, patchLoose, postLooseFromRequest, putLooseFromRequest, serveLoose } from "./files";
import { passwordField, writePasswordField } from "./gate";
import { ApiError, accountOriginRequired, assertTrustedAccountOrigin, contentOrigin, dedicatedContentOrigin, isLocalHost, isMermaidAssetPath, isPublicContentPath, json, jsonMaybeSecret, publicOrigin, readBodyCapped, secretJson, serveMermaidAsset, wantsDownload } from "./http";
import { instancePolicy, policyPublic, tokenPolicy, tokenPolicyPublic, adminTokenPolicy, emailIsAdmin } from "./policy";
import {
  createSite,
  deleteSite,
  deleteSiteFile,
  duplicateSite,
  exportSiteZip,
  getSiteFile,
  hubSiteLinkAccess,
  importSiteZip,
  listSiteJson,
  listSitesJson,
  patchSite,
  putSiteFile,
  serveSite,
} from "./sites";
import { isSiteId, sitePublicUrl } from "./urls";
import type { Actor, Env } from "./types";

const CONNECTION_JSON_MAX_BYTES = 4096;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      const origin = publicOrigin(env);
      if (err instanceof ApiError) return err.toResponse(origin);
      if (err instanceof URIError) {
        return new ApiError(400, "bad_path", "That path is not valid URL encoding.").toResponse(origin);
      }
      console.error(err instanceof Error ? err.stack || err.message : err);
      return json(
        {
          error: "internal",
          message: `Something went wrong on ${PRODUCT}. Try again, or open ${origin}/v1/help.`,
          hub: `${origin}/account`,
        },
        500,
      );
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env.DB);
    await remapLegacySiteR2(env, ctx);
    await sweepExpired(env, ctx);
    await purgeConnections(env);
  },
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/health") {
    if (method === "GET" || method === "HEAD") return json({ ok: true });
    return methodNotAllowed();
  }

  if (isMermaidAssetPath(path) && (method === "GET" || method === "HEAD")) {
    return serveMermaidAsset(env, request);
  }

  const configuredContentOrigin = dedicatedContentOrigin(env);
  const contentHost = configuredContentOrigin !== null && url.origin === configuredContentOrigin;
  if (isPublicContentPath(path)) {
    if (!contentHost && !isLocalHost(url.hostname)) {
      if (!configuredContentOrigin) {
        return json(
          { error: "content_origin_not_configured", message: "Set CONTENT_ORIGIN to a separate custom hostname before serving content." },
          503,
        );
      }
      const status = method === "PUT" || method === "DELETE" ? 307 : 302;
      return Response.redirect(`${configuredContentOrigin}${path}${url.search}`, status);
    }
  } else if (contentHost) {
    if (path === "/llms.txt" && (method === "GET" || method === "HEAD")) return llmsResponse(env, "content");
    if (path === "/llms.txt") return methodNotAllowed();
    return json({ error: "not_found", message: CONTENT_ONLY_404_MESSAGE }, 404);
  }

  if (path === "/llms.txt") {
    if (method === "GET" || method === "HEAD") return llmsResponse(env);
    return methodNotAllowed();
  }

  if (path === "/auth.md") {
    if (method === "GET" || method === "HEAD") return authMarkdownResponse(env);
    return methodNotAllowed();
  }

  if (path === "/v1/help") {
    if (method === "GET") return json(helpBody(publicOrigin(env), env));
    return methodNotAllowed();
  }

  if (path === "/v1/openapi.json") {
    if (method === "GET" || method === "HEAD") return openapiResponse(env);
    return methodNotAllowed();
  }

  if (path === "/v1/health") {
    if (method === "GET" || method === "HEAD") return json({ ok: true });
    return methodNotAllowed();
  }

  if (path.startsWith("/static/ui/")) {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("x-content-type-options", "nosniff");
    if (response.ok) response.headers.set("cache-control", "public, max-age=31536000, immutable");
    return response;
  }

  if ((path === "/favicon.svg" || path === "/static/logo.svg") && (method === "GET" || method === "HEAD")) {
    return new Response(logoSvg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400",
      },
    });
  }

  await ensureSchema(env.DB);
  await remapLegacySiteR2(env, ctx);

  if (path === "/v1" || path === "/v1/") {
    return unauthorized(publicOrigin(env), undefined, env).toResponse(publicOrigin(env));
  }

  if (path.startsWith("/v1/")) return api(request, env, ctx, path, method);

  if (accountOriginRequired(method, path)) {
    assertTrustedAccountOrigin(request);
  }

  const blocked = rejectWorkersDevForHumans(request, env);
  if (blocked) return blocked;

  if ((path === "/" || path === "/account") && method === "GET") {
    return serveHub(request, env, ctx);
  }

  if (path === "/about" && method === "GET") {
    return aboutResponse(await requireHuman(request, env, ctx), env);
  }

  if (path === "/stats" && method === "GET") {
    return statsResponse(env, await requireHuman(request, env, ctx));
  }

  if (path === "/admin" && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    requireAdmin(actor, publicOrigin(env));
    return await adminResponse(actor, env);
  }

  if (path === "/setup" && method === "GET") {
    return setupResponse(await requireHuman(request, env, ctx), env);
  }

  if (path === "/connect" && method === "GET") {
    return connectResponse(env, await requireHuman(request, env, ctx), url.searchParams.get("request") || "");
  }

  const connectionDecision = path.match(/^\/account\/connections\/([A-Za-z0-9]{24})\/(approve|deny)$/);
  if (connectionDecision && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    return decideConnection(env, connectionDecision[1], actor, await readJson(request, CONNECTION_JSON_MAX_BYTES), connectionDecision[2] === "approve");
  }

  if (path === "/tokens" && method === "GET") {
    return serveTokens(request, env, ctx);
  }

  if (path === "/account/data" && method === "GET") {
    const actor = await actorFromAccess(request, env, ctx);
    if (actor) assertEmailAllowed(env, actor.email);
    const query = parseListQuery(url);
    const user = actor ? await ensureUser(env, actor.email, actor.idpSub) : null;
    const lists = actor
      ? await hubLists(env, actor.email, query, user?.id)
      : { sites: [], files: [], sites_total: 0, files_total: 0, sites_cursor: null, files_cursor: null };
    const tokens = user ? await listTokens(env, user.email, user.id) : [];
    return secretJson({ email: actor?.email ?? null, admin: actor ? emailIsAdmin(env, actor.email) : false, ...lists, tokens });
  }

  if (path === "/account/admin/audit" && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    requireAdmin(actor, publicOrigin(env));
    return json(await listAdminAudit(env, url));
  }

  if (path === "/account/admin/health" && method === "GET") {
    return hubAdminHealthResponse(request, env, ctx);
  }

  if (path === "/account/admin/quota/recompute" && method === "POST") {
    return hubAdminRecomputeResponse(request, env, ctx);
  }

  if (path === "/account/admin/sweep" && method === "POST") {
    return hubAdminSweepResponse(request, env, ctx);
  }

  if (path === "/account/admin/gates/unlock" && method === "POST") {
    return hubAdminUnlockResponse(request, env, ctx, await readJson(request));
  }

  if (path === "/account/admin/tokens" && method === "GET") {
    return hubAdminTokensListResponse(request, env, ctx);
  }

  if (path === "/account/admin/tokens/revoke" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    requireAdmin(actor, publicOrigin(env));
    return revokeAdminTokens(env, actor, await readJson(request));
  }

  if (path === "/account/admin/cleanup" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    requireAdmin(actor, publicOrigin(env));
    return cleanupResponse(env, ctx, actor, await readJson(request), { admin: true });
  }

  if (path === "/account/tokens" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    const minted = await mintToken(env, actor.email, String(body.label ?? ""), actor.userId, body.ttl, parseTokenScope(body.scope));
    return secretJson(
      { id: minted.id, label: minted.label, token: minted.token, expires_at: minted.expires_at, scope: minted.scope, recoverable: false },
      201,
    );
  }

  if (path === "/account/tokens/revoke" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    return bulkRevokeResponse(env, actor, await readJson(request));
  }

  const revokeMatch = path.match(/^\/account\/tokens\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    await revokeToken(env, actor.email, decodeURIComponent(revokeMatch[1]), actor.userId);
    return json({ ok: true, revoked: true });
  }

  if (path === "/account/sites" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    const result = await postSite(env, actor, body, ctx);
    return jsonMaybeSecret(result.body, result.status);
  }

  const accountPatch = path.match(/^\/account\/sites\/([^/]+)$/);
  if (accountPatch && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    return hubSiteLinkAccess(env, actor, decodeURIComponent(accountPatch[1]));
  }
  if (accountPatch && method === "DELETE") {
    const actor = await requireHuman(request, env, ctx);
    await deleteSite(env, ctx, actor, decodeURIComponent(accountPatch[1]));
    return json({ ok: true, deleted: decodeURIComponent(accountPatch[1]) });
  }
  if (accountPatch && method === "PATCH") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    return patchSite(env, actor, decodeURIComponent(accountPatch[1]), contentPatch(body), ctx);
  }

  const accountPut = path.match(/^\/account\/sites\/([^/]+)\/files\/(.+)$/);
  if (accountPut && method === "PUT") {
    const actor = await requireHuman(request, env, ctx);
    const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, publicOrigin(env));
    const result = await putSiteFile(
      env,
      ctx,
      actor,
      decodeURIComponent(accountPut[1]),
      accountPut[2],
      bytes,
      request.headers.get("content-type"),
    );
    return json({ url: result.url, api_url: result.api_url, path: result.path, size: result.size }, result.created ? 201 : 200);
  }

  const accountImport = path.match(/^\/account\/sites\/([^/]+)\/import$/);
  if (accountImport && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, publicOrigin(env));
    const result = await importSiteZip(env, ctx, actor, decodeURIComponent(accountImport[1]), bytes);
    return json(result);
  }

  const accountExport = path.match(/^\/account\/sites\/([^/]+)\/export$/);
  if (accountExport && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    return exportSiteZip(env, ctx, actor, decodeURIComponent(accountExport[1]));
  }

  if (path === "/account/export" && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    return exportOwnedZip(env, actor);
  }

  if (path === "/account/files" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    return postLooseFromRequest(env, ctx, actor, request);
  }

  const accountLooseDownload = path.match(/^\/account\/files\/([^/]+)\/download$/);
  if (accountLooseDownload && method === "GET") {
    await requireHuman(request, env, ctx);
    return getLooseFile(env, ctx, decodeURIComponent(accountLooseDownload[1]), { attachment: true });
  }

  const accountLoosePut = path.match(/^\/account\/files\/([^/]+)$/);
  if (accountLoosePut && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    return hubLooseLinkAccess(env, actor, decodeURIComponent(accountLoosePut[1]));
  }
  if (accountLoosePut && method === "PUT") {
    const actor = await requireHuman(request, env, ctx);
    return putLooseFromRequest(env, ctx, actor, decodeURIComponent(accountLoosePut[1]), request);
  }
  if (accountLoosePut && method === "PATCH") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    return patchLoose(env, actor, decodeURIComponent(accountLoosePut[1]), contentPatch(body), ctx);
  }
  if (accountLoosePut && method === "DELETE") {
    const actor = await requireHuman(request, env, ctx);
    await deleteLooseFile(env, ctx, actor, decodeURIComponent(accountLoosePut[1]));
    return json({ ok: true, deleted: decodeURIComponent(accountLoosePut[1]) });
  }

  const pubFile = path.match(/^\/([^/]+)\/f\/([^/]+)\/(.+)$/);
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
          contentHost,
        );
      }
    }
  }

  const pubSite = path.match(/^\/([^/]+)\/s\/([^/]+)\/([^/]+)\/?(.*)$/);
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
          contentHost,
        );
      }
    }
  }

  return json(
    {
      error: "not_found",
      message: `No route for ${method} ${path}. See ${publicOrigin(env)}/v1/help.`,
      hub: `${publicOrigin(env)}/account`,
    },
    404,
  );
}

function contentResponse(response: Response, env: Env, contentHost: boolean): Response {
  if (!contentHost) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", publicOrigin(env));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function api(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  method: string,
): Promise<Response> {
  if (path === "/v1/connections") {
    if (method === "POST") return startConnection(request, env, await readJson(request, CONNECTION_JSON_MAX_BYTES));
    return methodNotAllowed();
  }
  const connectionToken = path.match(/^\/v1\/connections\/([^/]+)\/token$/);
  if (connectionToken) {
    if (method === "POST") return exchangeConnection(env, connectionToken[1], await readJson(request, CONNECTION_JSON_MAX_BYTES));
    return methodNotAllowed();
  }

  if (path === "/v1/whoami" && method === "GET") {
    const actor = await requireToken(request, env);
    return secretJson({
      email: actor.email,
      label: actor.tokenLabel,
      expires_at: actor.tokenExpiresAt ?? null,
      scope: actor.tokenScope ?? "account",
      admin: Boolean(actor.admin),
    });
  }

  if (path === "/v1/whoami" && method === "DELETE") {
    const actor = await requireToken(request, env);
    await revokeToken(env, actor.email, actor.tokenId ?? "", actor.userId);
    return secretJson({ ok: true, revoked: true, label: actor.tokenLabel });
  }

  if (path === "/v1/sites" && method === "GET") {
    const actor = await requireToken(request, env);
    return listSitesJson(env, actor.email, parseListQuery(new URL(request.url)), actor.userId);
  }

  if (path === "/v1/sites" && method === "POST") {
    const actor = await requireToken(request, env);
    const body = await readJson(request);
    const result = await postSite(env, actor, body, ctx);
    return jsonMaybeSecret(result.body, result.status);
  }

  if (path === "/v1/files" && method === "GET") {
    const actor = await requireToken(request, env);
    return listLooseJson(env, actor.email, parseListQuery(new URL(request.url)), actor.userId);
  }

  if (path === "/v1/files" && method === "POST") {
    const actor = await requireToken(request, env);
    return postLooseFromRequest(env, ctx, actor, request);
  }

  if (path === "/v1/export" && method === "GET") {
    const actor = await requireToken(request, env);
    return exportOwnedZip(env, actor);
  }

  if (path === "/v1/cleanup" && method === "POST") {
    const actor = await requireToken(request, env);
    return cleanupResponse(env, ctx, actor, await readJson(request));
  }

  if (path === "/v1/admin/audit" && method === "GET") {
    return adminAuditResponse(request, env);
  }

  if (path === "/v1/admin/health" && method === "GET") {
    return adminHealthResponse(request, env);
  }

  if (path === "/v1/admin/quota/recompute" && method === "POST") {
    return adminRecomputeResponse(request, env);
  }

  if (path === "/v1/admin/sweep" && method === "POST") {
    return adminSweepResponse(request, env, ctx);
  }

  if (path === "/v1/admin/gates/unlock" && method === "POST") {
    return adminUnlockResponse(request, env, await readJson(request));
  }

  if (path === "/v1/admin/tokens" && method === "GET") {
    return adminTokensListResponse(request, env);
  }

  if (path === "/v1/admin/tokens/revoke" && method === "POST") {
    const actor = await requireAdminActor(request, env);
    return revokeAdminTokens(env, actor, await readJson(request));
  }

  if (path === "/v1/admin/cleanup" && method === "POST") {
    const actor = await requireAdminActor(request, env);
    return cleanupResponse(env, ctx, actor, await readJson(request), { admin: true });
  }

  const looseOne = path.match(/^\/v1\/files\/([^/]+)(?:\/[^/]+)?$/);
  if (looseOne && (method === "GET" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
    const actor = await requireToken(request, env);
    const id = decodeURIComponent(looseOne[1]);
    if (method === "GET") return getLooseFile(env, ctx, id, { attachment: wantsDownload(request) });
    if (method === "DELETE") {
      await deleteLooseFile(env, ctx, actor, id);
      return json({ ok: true, deleted: id });
    }
    if (method === "PATCH") {
      const body = await readJson(request);
      return patchLoose(env, actor, id, contentPatch(body), ctx);
    }
    return putLooseFromRequest(env, ctx, actor, id, request);
  }

  const importMatch = path.match(/^\/v1\/sites\/([^/]+)\/import$/);
  if (importMatch && method === "POST") {
    const actor = await requireToken(request, env);
    const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, publicOrigin(env));
    const result = await importSiteZip(env, ctx, actor, decodeURIComponent(importMatch[1]), bytes);
    return json(result);
  }

  const exportMatch = path.match(/^\/v1\/sites\/([^/]+)\/export$/);
  if (exportMatch && method === "GET") {
    const actor = await requireToken(request, env);
    return exportSiteZip(env, ctx, actor, decodeURIComponent(exportMatch[1]));
  }

  const putMatch = path.match(/^\/v1\/sites\/([^/]+)\/files\/(.+)$/);
  if (putMatch && (method === "GET" || method === "PUT" || method === "DELETE")) {
    const actor = await requireToken(request, env);
    const id = decodeURIComponent(putMatch[1]);
    const filePath = putMatch[2];
    if (method === "GET") return getSiteFile(env, ctx, actor, id, filePath);
    if (method === "DELETE") {
      await deleteSiteFile(env, ctx, actor, id, filePath);
      return json({ ok: true, deleted: true, path: filePath });
    }
    const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, publicOrigin(env));
    const result = await putSiteFile(env, ctx, actor, id, filePath, bytes, request.headers.get("content-type"));
    return json(
      { url: result.url, api_url: result.api_url, path: result.path, size: result.size, content_type: result.content_type },
      result.created ? 201 : 200,
    );
  }

  const siteMatch = path.match(/^\/v1\/sites\/([^/]+)$/);
  if (siteMatch && (method === "GET" || method === "DELETE" || method === "PATCH")) {
    const actor = await requireToken(request, env);
    const id = decodeURIComponent(siteMatch[1]);
    if (method === "DELETE") {
      await deleteSite(env, ctx, actor, id);
      return json({ ok: true, deleted: id });
    }
    if (method === "PATCH") {
      const body = await readJson(request);
      return patchSite(env, actor, id, contentPatch(body), ctx);
    }
    return listSiteJson(env, ctx, actor, id);
  }

  await requireToken(request, env);
  return json(
    {
      error: "not_found",
      message: `No API route for ${method} ${path}. See ${publicOrigin(env)}/v1/help.`,
      hub: `${publicOrigin(env)}/account`,
    },
    404,
  );
}

async function serveHub(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await actorFromAccess(request, env, ctx);
  if (actor) assertEmailAllowed(env, actor.email);
  const user = actor ? await ensureUser(env, actor.email, actor.idpSub) : null;
  const lists = actor
    ? await hubLists(env, actor.email, parseListQuery(new URL(request.url)), user?.id)
    : { sites: [], files: [], sites_total: 0, files_total: 0, sites_cursor: null, files_cursor: null };
  const bootstrap = {
    email: actor?.email ?? null,
    admin: Boolean(actor?.admin),
    handle: user?.handle ?? null,
    origin: publicOrigin(env),
    content_origin: contentOrigin(env),
    policy: policyPublic(instancePolicy(env)),
    identity: identityFromEnv(env),
    sites: lists.sites,
    files: lists.files,
    sites_total: lists.sites_total,
    files_total: lists.files_total,
    sites_cursor: lists.sites_cursor,
    files_cursor: lists.files_cursor,
  };
  return new Response(uiPage(PRODUCT, { page: "hub", data: { ...bootstrap, words: MEMORABLE_WORDS, query: parseListQuery(new URL(request.url)) }, footer: instanceFooter(env) }), { headers: PRIVATE_HTML_HEADERS });
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
  return new Response(uiPage(`Tokens — ${PRODUCT}`, { page: "tokens", data: { ...bootstrap, now: Date.now() }, footer: instanceFooter(env) }), { headers: PRIVATE_HTML_HEADERS });
}

async function postSite(
  env: Env,
  actor: Actor,
  body: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const from = typeof body.duplicate_from === "string" ? body.duplicate_from.trim() : "";
  if (from) {
    if (overwriteFlag(body.overwrite)) {
      throw new ApiError(
        400,
        "bad_duplicate",
        "duplicate_from creates a new site. Omit overwrite and pick a new slug.",
      );
    }
    return duplicateSite(
      env,
      actor,
      from,
      String(body.slug || ""),
      ctx,
      body.ttl,
      body.write_policy,
      passwordField(body),
      writePasswordField(body),
    );
  }
  return createSite(
    env,
    actor,
    String(body.slug || ""),
    passwordField(body),
    ctx,
    body.ttl,
    body.write_policy,
    writePasswordField(body),
  );
}

/** Only JSON `true` counts. Strings like `"false"` must not. */
function overwriteFlag(raw: unknown): boolean {
  return raw === true;
}

function contentPatch(body: Record<string, unknown>): {
  password?: string;
  write_password?: string;
  ttl?: unknown;
  setTtl?: boolean;
  write_policy?: unknown;
} {
  const patch: {
    password?: string;
    write_password?: string;
    ttl?: unknown;
    setTtl?: boolean;
    write_policy?: unknown;
  } = {
    password: passwordField(body),
    ttl: body.ttl,
    setTtl: Object.prototype.hasOwnProperty.call(body, "ttl"),
  };
  if (Object.prototype.hasOwnProperty.call(body, "write_password")) {
    patch.write_password = writePasswordField(body);
  }
  if (Object.prototype.hasOwnProperty.call(body, "write_policy")) {
    patch.write_policy = body.write_policy;
  }
  return patch;
}

async function readJson(request: Request, maxBytes?: number): Promise<Record<string, unknown>> {
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

function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
}

export type { Env };
