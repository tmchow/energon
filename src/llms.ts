import { PRODUCT, formatBytes } from "./config";
import { publicOrigin } from "./http";
import { identityFromEnv } from "./instance";
import { instancePolicy } from "./policy";
import type { Env } from "./types";

export function llmsTxt(origin: string, env?: Env): string {
  const id = identityFromEnv(env || {});
  const policy = instancePolicy(env || {});
  const content = env?.CONTENT_ORIGIN?.trim() || origin;
  const presets = policy.presets.map((p) => `${p.id} (${p.label})`).join(", ");
  return `# ${PRODUCT}

> ${PRODUCT} is a file and static-site host for a company. Humans open a URL. Agents publish and fetch the same bytes over HTTP. The hub is behind Cloudflare Access. Published \`/sites\` and \`/files\` URLs are not, unless a share password is set. Do not invent a token.

The API and authenticated hub live on ${origin}. Published content is served from ${content}, which must be a separate hostname in production. There are no accounts in the API — humans mint a bearer token at ${origin}/tokens while signed in, then export it as \`${id.tokenEnv}\`. Tokens look like \`${id.tokenPrefix}…\`.

Do not put secrets, tokens, or share passwords in published files. Last write wins on a single path. Never default to overwrite.

## Start here

- [Machine-readable API help](${origin}/v1/help): SOP, routes, limits, retention. No auth.
- [Health](${origin}/v1/health): \`{"ok":true}\`. No auth.
- [Hub](${origin}/): human UI. Cloudflare Access.
- [About](${origin}/about) and [Stats](${origin}/stats): signed-in humans only.
- [Setup](${origin}/setup) and [Tokens](${origin}/tokens): signed-in humans only. Mint at /tokens.

## How to publish

- Site (named folder): \`POST /v1/sites\` with \`{"slug":"…","overwrite":false,"ttl":"7d"}\`, then \`PUT /v1/sites/{slug}/files/{path}\`. Public URL: \`/{handle}/s/{slug}/\`.
- File (one file, short id): \`POST /v1/files\`, then \`PUT /v1/files/{id}\` to replace it. Public URL: \`/{handle}/f/{id}/{filename}\`. Spaces in the filename become underscores in the path; the download name stays the original.
- Auth on every \`/v1\` call except help and health: \`Authorization: Bearer $${id.tokenEnv}\`.
- On 409, show the existing URL and ask the human: new slug, or retry with \`overwrite: true\`.
- \`GET /v1/sites\` and \`GET /v1/files\` list only what you created or last wrote. \`?scope=created|edited|involved\`, \`?q=\`, \`?created_by=\`, \`?limit=\`, \`?cursor=\` (always intersected with your involvement — you cannot dump someone else's catalog). Responses include \`total\` and \`next_cursor\`. Search runs over the full involved set; pages are keyset cursors.
- Optional share password: \`password\` on create/PATCH, or \`X-Energon-Set-Password\` on file write. Empty string clears. Write responses echo the password you just set. GET never returns it — only a hash is stored. Agents send \`X-Energon-Password\` on the human URL. Token GETs on \`/v1\` skip it.
- Retention: this instance default is \`${policy.defaultTtl}\`. Allowed: ${presets}. \`PUT\` does not extend expiry. \`PATCH { "ttl": "7d" }\` resets from now. Expired public URLs are \`410\` and then deleted.
- Who can write: this instance default is \`${policy.writePolicy}\` (\`owner\` = the creating account, \`instance\` = any token on this host). Set \`write_policy\` on create to override. \`PATCH write_policy\` is creator-only. Anyone with a token can still read via \`/v1\`.
- Make a copy: \`POST /v1/sites\` with \`duplicate_from\` + a new slug, or \`POST /v1/files\` with \`duplicate_from\`. You own the copy. Do not zip a site through context just to fork it. If you already have replacement bytes, POST/PUT those instead.
- Site zip export: \`GET /v1/sites/{slug}/export\` (token). Same ${formatBytes(policy.fileBytes)} / file-count caps as import. A single file is never a zip; \`?download=1\` on a file URL sets \`Content-Disposition: attachment\`.
- \`.md\` files: browsers (\`Accept: text/html\`) get a rendered page (GFM + mermaid). \`curl\` and \`?raw=1\` get the markdown source. \`index.md\` is the site homepage when \`index.html\` is missing.

## Optional

- Agent skill for this instance: add marketplace \`${id.repo}\` (\`https://github.com/${id.repo}\`) and install \`${id.plugin}\` at user (global) scope (\`${id.plugin}@${id.marketplace}\`). Do not install at project or workspace scope unless the human asked for that. The skill files name this origin (${id.origin}). A fork replaces the shipped skill with \`npm run skill:init\`. Claude Code and [Agent Plugins](https://agent-plugins.org/) hosts use the same repo.
- WebMCP tools register only on the signed-in hub. Agents that are not in that tab should use HTTP + the token.
`;
}

export function llmsResponse(env: Env): Response {
  const origin = publicOrigin(env);
  return new Response(llmsTxt(origin, env), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
