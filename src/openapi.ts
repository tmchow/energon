import spec from "../openapi/v1.json";
import { dedicatedContentOrigin, json, publicOrigin } from "./http";
import type { Env } from "./types";

const CONTENT_ORIGIN_PATH_PREFIX = "/_deployment-grants/";

export function openapiResponse(env: Env): Response {
  const document: { paths: Record<string, Record<string, unknown>> } = structuredClone(spec);
  const contentOrigin = dedicatedContentOrigin(env);
  if (contentOrigin) {
    for (const [path, item] of Object.entries(document.paths)) {
      if (path.startsWith(CONTENT_ORIGIN_PATH_PREFIX)) item.servers = [{ url: contentOrigin }];
    }
  }
  return json({ ...document, servers: [{ url: publicOrigin(env) }] }, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
}
