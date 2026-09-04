import spec from "../openapi/v1.json";
import { json, publicOrigin } from "./http";
import type { Env } from "./types";

export function openapiResponse(env: Env): Response {
  return json({ ...spec, servers: [{ url: publicOrigin(env) }] }, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
}
