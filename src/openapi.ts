import spec from "../openapi/v1.json";
import { dedicatedContentOrigin, json, publicOrigin } from "./http";
import type { Env } from "./types";

const CONTENT_ORIGIN_PATH_PREFIX = "/_deployment-grants/";
const GATEWAY_MARKER = "x-energon-gateway";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type PathItem = Record<string, unknown>;
type Document = { paths: Record<string, PathItem>; tags: { name: string }[] };

function document(): Document {
  const doc: Document = structuredClone(spec);
  for (const item of Object.values(doc.paths)) {
    for (const method of METHODS) delete (item[method] as Record<string, unknown> | undefined)?.[GATEWAY_MARKER];
  }
  return doc;
}

function serve(doc: Document, env: Env): Response {
  return json({ ...doc, servers: [{ url: publicOrigin(env) }] }, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
}

export function openapiResponse(env: Env): Response {
  const doc = document();
  const contentOrigin = dedicatedContentOrigin(env);
  if (contentOrigin) {
    for (const [path, item] of Object.entries(doc.paths)) {
      if (path.startsWith(CONTENT_ORIGIN_PATH_PREFIX)) item.servers = [{ url: contentOrigin }];
    }
  }
  return serve(doc, env);
}

// Opt-in: an operation reaches gateways only when openapi/v1.json marks it true.
export function gatewayOpenapiResponse(env: Env): Response {
  const doc = document();
  const paths: Record<string, PathItem> = {};
  const used = new Set<string>();
  for (const [path, source] of Object.entries(spec.paths as Record<string, PathItem>)) {
    const item = doc.paths[path];
    for (const method of METHODS) {
      const op = source[method] as Record<string, unknown> | undefined;
      if (!op) continue;
      if (op[GATEWAY_MARKER] === true) for (const tag of (op.tags as string[] | undefined) ?? []) used.add(tag);
      else delete item[method];
    }
    if (METHODS.some((method) => item[method])) paths[path] = item;
  }
  return serve({ ...doc, paths, tags: doc.tags.filter((tag) => used.has(tag.name)) }, env);
}
