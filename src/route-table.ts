import { requireAdminActor } from "./audit";
import { requireToken } from "./auth";
import { methodNotAllowed } from "./http";
import type { Actor, Env } from "./types";

export type AuthKind = "none" | "token" | "admin";

export type ActorFor<K extends AuthKind> = K extends "none" ? never : Actor;

export type MethodMiss = "not_allowed" | "continue";

export function methodMissFor(kind: AuthKind): MethodMiss {
  switch (kind) {
    case "none":
      return "not_allowed";
    case "token":
    case "admin":
      return "continue";
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}

type V1HandshakePath = "/v1/connections" | `/v1/connections/${string}`;
type V1AdminPath = `/v1/admin/${string}`;
type V1TokenPath = Exclude<`/v1/${string}`, V1AdminPath | V1HandshakePath>;

export type PathFor<K extends AuthKind> = K extends "none"
  ? V1HandshakePath | RegExp
  : K extends "admin"
    ? V1AdminPath | RegExp
    : K extends "token"
      ? V1TokenPath | RegExp
      : never;

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteCtx<K extends AuthKind> = {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  params: readonly string[];
} & (K extends "none" ? { readonly actor?: never } : { actor: ActorFor<K> });

export type Handler<K extends AuthKind> = (ctx: RouteCtx<K>) => Response | Promise<Response>;

export type Route<K extends AuthKind> = {
  path: PathFor<K>;
  methods: Partial<Record<HttpMethod, Handler<K>>>;
};

export type RouteTable<K extends AuthKind> = {
  auth: K;
  routes: readonly Route<K>[];
};

export type AnyRouteTable = { [K in AuthKind]: RouteTable<K> }[AuthKind];

export function matchPath(pathSpec: string | RegExp, path: string): readonly string[] | null {
  if (typeof pathSpec === "string") return path === pathSpec ? [] : null;
  const match = pathSpec.exec(path);
  if (!match) return null;
  return match.slice(1);
}

export async function dispatch(
  request: Request,
  env: Env,
  exec: ExecutionContext,
  path: string,
  method: string,
  table: AnyRouteTable,
): Promise<Response | null> {
  const url = new URL(request.url);
  for (const route of table.routes) {
    const params = matchPath(route.path, path);
    if (!params) continue;
    const handler = route.methods[method as HttpMethod];
    if (!handler) {
      if (methodMissFor(table.auth) === "not_allowed") return methodNotAllowed();
      continue;
    }
    switch (table.auth) {
      case "none":
        return (handler as Handler<"none">)({ request, env, ctx: exec, url, params });
      case "token": {
        const actor = await requireToken(request, env);
        return (handler as Handler<"token">)({ request, env, ctx: exec, url, params, actor });
      }
      case "admin": {
        const actor = await requireAdminActor(request, env);
        return (handler as Handler<"admin">)({ request, env, ctx: exec, url, params, actor });
      }
      default: {
        const _n: never = table;
        return _n;
      }
    }
  }
  return null;
}

export async function dispatchFirst(
  request: Request,
  env: Env,
  exec: ExecutionContext,
  path: string,
  method: string,
  tables: readonly AnyRouteTable[],
): Promise<Response | null> {
  for (const table of tables) {
    const hit = await dispatch(request, env, exec, path, method, table);
    if (hit) return hit;
  }
  return null;
}

export function collectPathLiterals(tables: readonly AnyRouteTable[]): string[] {
  const found: string[] = [];
  for (const table of tables) {
    for (const route of table.routes) {
      if (typeof route.path === "string") found.push(route.path);
    }
  }
  return found;
}

export function collectPathPatterns(tables: readonly AnyRouteTable[]): RegExp[] {
  const found: RegExp[] = [];
  for (const table of tables) {
    for (const route of table.routes) {
      if (route.path instanceof RegExp) found.push(route.path);
    }
  }
  return found;
}
