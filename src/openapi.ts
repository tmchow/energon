import spec from "../openapi/v1.json";
import { json, publicOrigin } from "./http";
import type { Env } from "./types";

export function openapiResponse(env: Env): Response {
  const document = structuredClone(spec);
  return json({ ...document, servers: [{ url: publicOrigin(env) }] }, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
}
