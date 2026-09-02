import { aboutResponse } from "./about";
import { appFooter, chromeCss, chromeHead, instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import hubTemplate from "./hub.html";
import hubScript from "./hub.client.js";
import tokensTemplate from "./tokens.html";
import logoSvg from "./logo.svg";
import { actorFromAccess, assertEmailAllowed, helpBody, listTokens, mintToken, rejectWorkersDevForHumans, requireHuman, requireToken, revealToken, revokeToken, unauthorized } from "./auth";
import { setupResponse } from "./setup";
import { statsResponse } from "./stats";
import { parseListQuery } from "./catalog";
import { llmsResponse } from "./llms";
import { ENV_TOKEN, PRODUCT, RESERVED_HANDLES } from "./config";
import { ensureSchema } from "./db";
import { sweepExpired } from "./expire";
import { ensureHandle } from "./handles";
import { identityFromEnv } from "./instance";
import { MEMORABLE_WORDS } from "./memorable";
import { deleteLooseFile, getLooseFile, hubLists, listLooseJson, patchLoose, postLooseFromRequest, putLooseFromRequest, serveLoose } from "./files";
import { passwordField } from "./gate";
import { ApiError, accountOriginRequired, assertTrustedAccountOrigin, contentOrigin, dedicatedContentOrigin, isLocalHost, isPublicContentPath, json, publicOrigin, readBodyCapped, secretJson, wantsDownload } from "./http";
import { instancePolicy, policyPublic } from "./policy";
import {
  createSite,
  deleteSite,
  deleteSiteFile,
  duplicateSite,
  exportSiteZip,
  getSiteFile,
  importSiteZip,
  listSiteJson,
  listSitesJson,
  patchSite,
  putSiteFile,
  serveSite,
} from "./sites";
import { sitePublicUrl } from "./urls";
import type { Actor, Env } from "./types";

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
    await sweepExpired(env, ctx);
  },
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/health" || path === "/v1/health") {
    if (method === "GET" || method === "HEAD") return json({ ok: true });
    return methodNotAllowed();
  }

  if (path === "/llms.txt") {
    if (method === "GET" || method === "HEAD") return llmsResponse(env);
    return methodNotAllowed();
  }

  if (path === "/v1/help") {
    if (method === "GET") return json(helpBody(publicOrigin(env), env));
    return methodNotAllowed();
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
      return Response.redirect(`${configuredContentOrigin}${path}${url.search}`, 302);
    }
  } else if (contentHost) {
    return json({ error: "not_found", message: "This hostname serves published content only." }, 404);
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

  if (path === "/v1" || path === "/v1/") {
    return unauthorized(publicOrigin(env)).toResponse(publicOrigin(env));
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

  if (path === "/setup" && method === "GET") {
    return setupResponse(await requireHuman(request, env, ctx), env);
  }

  if (path === "/tokens" && method === "GET") {
    return serveTokens(request, env, ctx);
  }

  if (path === "/account/data" && method === "GET") {
    const actor = await actorFromAccess(request, env, ctx);
    if (actor) assertEmailAllowed(env, actor.email);
    const query = parseListQuery(url);
    const lists = actor
      ? await hubLists(env, actor.email, query)
      : { sites: [], files: [], sites_total: 0, files_total: 0, sites_cursor: null, files_cursor: null };
    const tokens = actor ? await listTokens(env, actor.email) : [];
    return json({ email: actor?.email ?? null, ...lists, tokens });
  }

  if (path === "/account/tokens" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    const minted = await mintToken(env, actor.email, String(body.label ?? ""));
    return secretJson({ id: minted.id, label: minted.label, token: minted.token, recoverable: true }, 201);
  }

  const revealMatch = path.match(/^\/account\/tokens\/([^/]+)$/);
  if (revealMatch && method === "GET") {
    const actor = await requireHuman(request, env, ctx);
    const token = await revealToken(env, actor.email, decodeURIComponent(revealMatch[1]));
    return secretJson({ id: decodeURIComponent(revealMatch[1]), token, recoverable: true });
  }

  const revokeMatch = path.match(/^\/account\/tokens\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    await revokeToken(env, actor.email, decodeURIComponent(revokeMatch[1]));
    return json({ ok: true, revoked: true });
  }

  if (path === "/account/sites" && method === "POST") {
    const actor = await requireHuman(request, env, ctx);
    const body = await readJson(request);
    const result = await postSite(env, actor, body, ctx);
    return json(result.body, result.status);
  }

  const accountPatch = path.match(/^\/account\/sites\/([^/]+)$/);
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
  if (pubFile && (method === "GET" || method === "POST")) {
    const handle = decodeURIComponent(pubFile[1]).toLowerCase();
    if (!RESERVED_HANDLES.has(handle)) {
      return contentResponse(
        await serveLoose(env, ctx, handle, decodeURIComponent(pubFile[2]), pubFile[3], request),
        env,
        contentHost,
      );
    }
  }

  const pubSite = path.match(/^\/([^/]+)\/s\/([^/]+)\/?(.*)$/);
  if (pubSite && (method === "GET" || method === "POST")) {
    const handle = decodeURIComponent(pubSite[1]).toLowerCase();
    const slug = decodeURIComponent(pubSite[2]);
    if (!RESERVED_HANDLES.has(handle)) {
      if (method === "GET" && !pubSite[3] && !path.endsWith("/")) {
        return Response.redirect(sitePublicUrl(env, handle, slug), 302);
      }
      return contentResponse(
        await serveSite(env, ctx, handle, slug, pubSite[3] || "", request),
        env,
        contentHost,
      );
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
  if (path === "/v1/whoami" && method === "GET") {
    const actor = await requireToken(request, env);
    return json({ email: actor.email, label: actor.tokenLabel });
  }

  if (path === "/v1/sites" && method === "GET") {
    const actor = await requireToken(request, env);
    return listSitesJson(env, actor.email, parseListQuery(new URL(request.url)));
  }

  if (path === "/v1/sites" && method === "POST") {
    const actor = await requireToken(request, env);
    const body = await readJson(request);
    const result = await postSite(env, actor, body, ctx);
    return json(result.body, result.status);
  }

  if (path === "/v1/files" && method === "GET") {
    const actor = await requireToken(request, env);
    return listLooseJson(env, actor.email, parseListQuery(new URL(request.url)));
  }

  if (path === "/v1/files" && method === "POST") {
    const actor = await requireToken(request, env);
    return postLooseFromRequest(env, ctx, actor, request);
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
    const slug = decodeURIComponent(putMatch[1]);
    const filePath = putMatch[2];
    if (method === "GET") return getSiteFile(env, ctx, actor, slug, filePath);
    if (method === "DELETE") {
      await deleteSiteFile(env, ctx, actor, slug, filePath);
      return json({ ok: true, deleted: true, path: filePath });
    }
    const bytes = await readBodyCapped(request, instancePolicy(env).fileBytes, publicOrigin(env));
    const result = await putSiteFile(env, ctx, actor, slug, filePath, bytes, request.headers.get("content-type"));
    return json(
      { url: result.url, api_url: result.api_url, path: result.path, size: result.size, content_type: result.content_type },
      result.created ? 201 : 200,
    );
  }

  const siteMatch = path.match(/^\/v1\/sites\/([^/]+)$/);
  if (siteMatch && (method === "GET" || method === "DELETE" || method === "PATCH")) {
    const actor = await requireToken(request, env);
    const slug = decodeURIComponent(siteMatch[1]);
    if (method === "DELETE") {
      await deleteSite(env, ctx, actor, slug);
      return json({ ok: true, deleted: slug });
    }
    if (method === "PATCH") {
      const body = await readJson(request);
      return patchSite(env, actor, slug, contentPatch(body), ctx);
    }
    return listSiteJson(env, ctx, actor, slug);
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
  const lists = actor
    ? await hubLists(env, actor.email, parseListQuery(new URL(request.url)))
    : { sites: [], files: [], sites_total: 0, files_total: 0, sites_cursor: null, files_cursor: null };
  const handle = actor ? await ensureHandle(env, actor.email) : null;
  const bootstrap = JSON.stringify({
    email: actor?.email ?? null,
    handle,
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
  }).replace(/</g, "\\u003c");
  return htmlTemplate(hubTemplate, bootstrap, undefined, instanceFooter(env));
}

async function serveTokens(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const actor = await requireHuman(request, env, ctx);
  const tokens = await listTokens(env, actor.email);
  const bootstrap = JSON.stringify({
    email: actor.email,
    tokens,
    token_env: identityFromEnv(env).tokenEnv,
  }).replace(/</g, "\\u003c");
  return htmlTemplate(tokensTemplate, bootstrap, identityFromEnv(env).tokenEnv, instanceFooter(env));
}

function htmlTemplate(
  template: string,
  bootstrap: string,
  tokenEnv = ENV_TOKEN,
  footer = "",
): Response {
  const html = template
    .replace("__BOOTSTRAP__", bootstrap)
    .replace("__LOGO__", inlineLogo())
    .replace("__CSS__", chromeCss)
    .replace("__HEAD__", chromeHead())
    .replace("__WORDS__", JSON.stringify(MEMORABLE_WORDS))
    .replaceAll("__TOKEN_ENV__", tokenEnv)
    .replace("__FOOTER__", appFooter(footer))
    .replace("__SCRIPT__", () => hubScript);
  return new Response(html, {
    headers: PRIVATE_HTML_HEADERS,
  });
}

async function postSite(
  env: Env,
  actor: Actor,
  body: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const from = typeof body.duplicate_from === "string" ? body.duplicate_from.trim() : "";
  if (from) {
    if (body.overwrite) {
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
    );
  }
  return createSite(
    env,
    actor,
    String(body.slug || ""),
    Boolean(body.overwrite),
    passwordField(body),
    ctx,
    body.ttl,
    body.write_policy,
  );
}

function contentPatch(body: Record<string, unknown>): {
  password?: string;
  ttl?: unknown;
  setTtl?: boolean;
  write_policy?: unknown;
} {
  const patch: {
    password?: string;
    ttl?: unknown;
    setTtl?: boolean;
    write_policy?: unknown;
  } = {
    password: passwordField(body),
    ttl: body.ttl,
    setTtl: Object.prototype.hasOwnProperty.call(body, "ttl"),
  };
  if (Object.prototype.hasOwnProperty.call(body, "write_policy")) {
    patch.write_policy = body.write_policy;
  }
  return patch;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
    throw new ApiError(415, "bad_content_type", "Send a JSON object body.");
  }
  const text = await request.text();
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

function inlineLogo(): string {
  return logoSvg.replace(/^<\?xml[\s\S]*?\?>\s*/i, "").trim();
}

export type { Env };
