import spec from "../openapi/v1.json";
import { dedicatedContentOrigin, json, publicOrigin } from "./http";
import type { Env } from "./types";

const CONTENT_ORIGIN_PATH_PREFIX = "/_deployment-grants/";
const GATEWAY_MARKER = "x-energon-gateway";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = Record<string, unknown>;
type PathItem = Record<string, unknown> & Partial<Record<(typeof METHODS)[number], Operation>>;
type Document = { paths: Record<string, PathItem>; tags: { name: string }[] };

function document(): Document {
  const doc: Document = structuredClone(spec);
  for (const item of Object.values(doc.paths)) {
    for (const method of METHODS) delete item[method]?.[GATEWAY_MARKER];
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

let gatewayDocument: Document | null = null;

// Opt-in: an operation reaches gateways only when openapi/v1.json marks it true.
function buildGatewayDocument(): Document {
  const doc = document();
  const source = spec.paths as Record<string, PathItem>;
  const paths: Record<string, PathItem> = {};
  const used = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = source[path][method];
      if (!op) continue;
      if (op[GATEWAY_MARKER] === true) for (const tag of (op.tags as string[] | undefined) ?? []) used.add(tag);
      else delete item[method];
    }
    if (METHODS.some((method) => item[method])) paths[path] = item;
  }
  return { ...doc, paths, tags: doc.tags.filter((tag) => used.has(tag.name)) };
}

export function gatewayOpenapiResponse(env: Env): Response {
  gatewayDocument ??= buildGatewayDocument();
  return serve(gatewayDocument, env);
}
