import { loadAdminHealth, recomputeQuota, sweepNow, unlockGate } from "./admin-health";
import { listAdminTokens, revokeAdminTokens } from "./admin-tokens";
import { listAdminAudit } from "./audit";
import { requireToken, revokeToken } from "./auth";
import { parseListQuery } from "./catalog";
import { cleanupResponse } from "./cleanup";
import { CONNECTION_JSON_MAX_BYTES, exchangeConnection, startConnection } from "./connections";
import { exportOwnedZip } from "./export";
import {
  deleteLooseFile,
  getLooseFile,
  listLooseJson,
  patchLoose,
  postLooseFromRequest,
  putLooseFromRequest,
} from "./files";
import { contentPatch } from "./gate";
import {
  json,
  jsonMaybeSecret,
  publicOrigin,
  readBodyCapped,
  readJson,
  secretJson,
  wantsDownload,
} from "./http";
import { instancePolicy } from "./policy";
import {
  collectPathLiterals,
  collectPathPatterns,
  dispatchFirst,
  type AnyRouteTable,
  type RouteTable,
} from "./route-table";
import {
  deleteSite,
  deleteSiteFile,
  exportSiteZip,
  getSiteFile,
  importSiteZip,
  listSiteJson,
  listSitesJson,
  patchSite,
  postSite,
  putSiteFile,
} from "./sites";
import type { Env } from "./types";

export const V1_PRE_SCHEMA_LITERALS = ["/v1/help", "/v1/openapi.json", "/v1/health"] as const;

export const V1_CONNECTION_TOKEN = /^\/v1\/connections\/([^/]+)\/token$/;
export const V1_LOOSE_ONE = /^\/v1\/files\/([^/]+)(?:\/[^/]+)?$/;
export const V1_SITE_IMPORT = /^\/v1\/sites\/([^/]+)\/import$/;
export const V1_SITE_EXPORT = /^\/v1\/sites\/([^/]+)\/export$/;
export const V1_SITE_FILE = /^\/v1\/sites\/([^/]+)\/files\/(.+)$/;
export const V1_SITE_ONE = /^\/v1\/sites\/([^/]+)$/;

export const V1_HANDSHAKE = {
  auth: "none",
  routes: [
    {
      path: "/v1/connections",
      methods: {
        POST: async (c) => startConnection(c.request, c.env, await readJson(c.request, CONNECTION_JSON_MAX_BYTES)),
      },
    },
    {
      path: V1_CONNECTION_TOKEN,
      methods: {
        POST: async (c) => exchangeConnection(c.env, c.params[0], await readJson(c.request, CONNECTION_JSON_MAX_BYTES)),
      },
    },
  ],
} as const satisfies RouteTable<"none">;

export const V1_ADMIN = {
  auth: "admin",
  routes: [
    {
      path: "/v1/admin/audit",
      methods: {
        GET: async (c) => json(await listAdminAudit(c.env, c.url)),
      },
    },
    {
      path: "/v1/admin/health",
      methods: {
        GET: async (c) => json(await loadAdminHealth(c.env)),
      },
    },
    {
      path: "/v1/admin/quota/recompute",
      methods: {
        POST: async (c) => json(await recomputeQuota(c.env, c.actor)),
      },
    },
    {
      path: "/v1/admin/sweep",
      methods: {
        POST: async (c) => json(await sweepNow(c.env, c.ctx, c.actor)),
      },
    },
    {
      path: "/v1/admin/gates/unlock",
      methods: {
        POST: async (c) => json(await unlockGate(c.env, c.actor, await readJson(c.request))),
      },
    },
    {
      path: "/v1/admin/tokens",
      methods: {
        GET: async (c) => secretJson(await listAdminTokens(c.env, c.url)),
      },
    },
    {
      path: "/v1/admin/tokens/revoke",
      methods: {
        POST: async (c) => revokeAdminTokens(c.env, c.actor, await readJson(c.request)),
      },
    },
    {
      path: "/v1/admin/cleanup",
      methods: {
        POST: async (c) => cleanupResponse(c.env, c.ctx, c.actor, await readJson(c.request), { admin: true }),
      },
    },
  ],
} as const satisfies RouteTable<"admin">;

export const V1_TOKEN = {
  auth: "token",
  routes: [
    {
      path: "/v1/whoami",
      methods: {
        GET: (c) =>
          secretJson({
            email: c.actor.email,
            label: c.actor.tokenLabel,
            expires_at: c.actor.tokenExpiresAt ?? null,
            scope: c.actor.tokenScope ?? "account",
            admin: Boolean(c.actor.admin),
          }),
        DELETE: async (c) => {
          await revokeToken(c.env, c.actor.email, c.actor.tokenId ?? "", c.actor.userId);
          return secretJson({ ok: true, revoked: true, label: c.actor.tokenLabel });
        },
      },
    },
    {
      path: "/v1/sites",
      methods: {
        GET: (c) => listSitesJson(c.env, c.actor.email, parseListQuery(c.url), c.actor.userId),
        POST: async (c) => {
          const result = await postSite(c.env, c.actor, await readJson(c.request), c.ctx);
          return jsonMaybeSecret(result.body, result.status);
        },
      },
    },
    {
      path: "/v1/files",
      methods: {
        GET: (c) => listLooseJson(c.env, c.actor.email, parseListQuery(c.url), c.actor.userId),
        POST: (c) => postLooseFromRequest(c.env, c.ctx, c.actor, c.request),
      },
    },
    {
      path: "/v1/export",
      methods: {
        GET: (c) => exportOwnedZip(c.env, c.ctx, c.actor),
      },
    },
    {
      path: "/v1/cleanup",
      methods: {
        POST: async (c) => cleanupResponse(c.env, c.ctx, c.actor, await readJson(c.request)),
      },
    },
    {
      path: V1_LOOSE_ONE,
      methods: {
        GET: (c) =>
          getLooseFile(c.env, c.ctx, decodeURIComponent(c.params[0]), { attachment: wantsDownload(c.request) }),
        PUT: (c) => putLooseFromRequest(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0]), c.request),
        PATCH: async (c) => {
          const body = await readJson(c.request);
          return patchLoose(c.env, c.actor, decodeURIComponent(c.params[0]), contentPatch(body), c.ctx);
        },
        DELETE: async (c) => {
          const id = decodeURIComponent(c.params[0]);
          await deleteLooseFile(c.env, c.ctx, c.actor, id);
          return json({ ok: true, deleted: id });
        },
      },
    },
    {
      path: V1_SITE_IMPORT,
      methods: {
        POST: async (c) => {
          const bytes = await readBodyCapped(c.request, instancePolicy(c.env).fileBytes, publicOrigin(c.env));
          const result = await importSiteZip(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0]), bytes);
          return json(result);
        },
      },
    },
    {
      path: V1_SITE_EXPORT,
      methods: {
        GET: (c) => exportSiteZip(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0])),
      },
    },
    {
      path: V1_SITE_FILE,
      methods: {
        GET: (c) => getSiteFile(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0]), c.params[1]),
        PUT: async (c) => {
          const id = decodeURIComponent(c.params[0]);
          const filePath = c.params[1];
          const bytes = await readBodyCapped(c.request, instancePolicy(c.env).fileBytes, publicOrigin(c.env));
          const result = await putSiteFile(
            c.env,
            c.ctx,
            c.actor,
            id,
            filePath,
            bytes,
            c.request.headers.get("content-type"),
          );
          return json(
            { url: result.url, api_url: result.api_url, path: result.path, size: result.size, content_type: result.content_type },
            result.created ? 201 : 200,
          );
        },
        DELETE: async (c) => {
          const filePath = c.params[1];
          await deleteSiteFile(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0]), filePath);
          return json({ ok: true, deleted: true, path: filePath });
        },
      },
    },
    {
      path: V1_SITE_ONE,
      methods: {
        GET: (c) => listSiteJson(c.env, c.ctx, c.actor, decodeURIComponent(c.params[0])),
        PATCH: async (c) => {
          const body = await readJson(c.request);
          return patchSite(c.env, c.actor, decodeURIComponent(c.params[0]), contentPatch(body), c.ctx);
        },
        DELETE: async (c) => {
          const id = decodeURIComponent(c.params[0]);
          await deleteSite(c.env, c.ctx, c.actor, id);
          return json({ ok: true, deleted: id });
        },
      },
    },
  ],
} as const satisfies RouteTable<"token">;

export const V1_CLASSES: readonly AnyRouteTable[] = [V1_HANDSHAKE, V1_ADMIN, V1_TOKEN];

export function v1PathLiterals(): string[] {
  return [...V1_PRE_SCHEMA_LITERALS, ...collectPathLiterals(V1_CLASSES)];
}

export function v1PathPatterns(): RegExp[] {
  return collectPathPatterns(V1_CLASSES);
}

export async function dispatchV1(
  request: Request,
  env: Env,
  exec: ExecutionContext,
  path: string,
  method: string,
): Promise<Response> {
  const hit = await dispatchFirst(request, env, exec, path, method, V1_CLASSES);
  if (hit) return hit;
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
