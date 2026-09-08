import { PRODUCT, formatBytes } from "./config";
import { guestWriteLlmsBody, hubGuestWriteSection } from "./guest-write-protocol";
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

> ${PRODUCT} is agent-native publishing for documents, prototypes, and working files. Agents publish, read, reference, revise, and copy ordinary files over HTTP. People can upload directly and open the same work: Markdown renders as a document; prepared HTML renders as a working static site. Permitted updates keep the same URL until expiry or deletion. The hub is behind Cloudflare Access; published content links are not, unless a share password is set. Do not invent a token.

Reading as reference does not authorize editing. Copies are independent objects, not revision history. Build any required site output before publishing; this Energon serves files, not server-side application code.

The API and authenticated hub live on ${origin}. Published content is served from ${content}, which must be a separate hostname in production. There is no public signup. Use \`${id.tokenEnv}\` if set; otherwise follow ${origin}/auth.md to connect with a code a human approves, or, when no human can respond, stop and ask for a token provisioned at ${origin}/tokens. Tokens look like \`${id.tokenPrefix}…\`.

Do not put secrets, tokens, or share passwords in published files. Last write wins on a single path.

## Start here

- [Authentication instructions](${origin}/auth.md): use an existing token, connect with a code, save the token, and recover from rejected credentials. No auth.
- [OpenAPI 3.1 contract](${origin}/v1/openapi.json): every \`/v1\` path with request and response schemas, status codes, and error codes. No auth.
- [Machine-readable API help](${origin}/v1/help): this Energon's origins, policy, and SOP. Routes, limits, retention, token policy. No auth.
- [Health](${origin}/v1/health): \`{"ok":true}\`. No auth.
- [Hub](${origin}/): human UI. Cloudflare Access.
- [About](${origin}/about) and [Stats](${origin}/stats): signed-in humans only.
- [Admin](${origin}/admin): operators listed on \`ADMIN_EMAILS\`. Retire old work, check storage health, and list or revoke tokens across accounts; every action is recorded. Signed-in humans only.
- [Setup](${origin}/setup) and [Tokens](${origin}/tokens): signed-in humans only. Approve connections at /connect; create or revoke tokens at /tokens.

## How to publish

- Site (named folder): \`POST /v1/sites\` with \`{"slug":"…","ttl":"7d"}\`, then \`PUT /v1/sites/{id}/files/{path}\` using the returned id. Public URL: \`/{handle}/s/{id}/{slug}/\`. \`/v1/sites/{slug}\` does not resolve a site.
- File (one file, short id): \`POST /v1/files\`, then \`PUT /v1/files/{id}\` to replace it. Public URL: \`/{handle}/f/{id}/{filename}\`. Spaces in the filename become underscores in the path; the download name stays the original.
- Auth on every \`/v1\` call except help, health, openapi.json, and the connection request/poll endpoints: \`Authorization: Bearer $${id.tokenEnv}\`.
- Tokens expire after the lifetime the human picked at mint (default 90 days). A \`401\` with \`error: token_expired\` is terminal: stop using it, connect again with a code or ask the human to provision a replacement at /tokens, do not retry the expired token, do not invent one. Tokens cannot be extended. \`GET /v1/whoami\` shows \`expires_at\`, \`scope\` (\`account\` or \`admin\`), and \`admin\` (true only for an admin-scoped token whose owner is still on \`ADMIN_EMAILS\`).
- An admin token is opt-in at mint on /tokens by someone on \`ADMIN_EMAILS\`. Connect never grants it. Removing the email strips admin from every token at once. Admin tokens still act as the account for ordinary \`/v1\` calls. They last at most 7 days (default 1 day) and cannot be never. Their hint inserts \`admin\` after the token prefix, then an ellipsis and the last four. \`GET /v1/admin/health\` is the read-only snapshot (quota used versus the cap, expired objects awaiting purge, stale purge claims). \`POST /v1/admin/quota/recompute\` sets the ledger from stored sizes. \`POST /v1/admin/sweep\` runs one expiry batch. \`POST /v1/admin/gates/unlock\` clears a locked share gate by scope. \`GET /v1/admin/audit\` lists recorded admin actions (who, which token, what, filters, counts, when). Needs an admin token. Never returns published bytes or secrets.
- Done with a token nothing else will reuse? \`DELETE /v1/whoami\` revokes the calling token (self only; \`/v1\` cannot list or revoke other tokens). Later calls with it are \`401\`. Leave tokens the human stored for reuse (CI, scheduled jobs) alone.
- \`GET /v1/sites\` and \`GET /v1/files\` list only what you created or last wrote. \`?scope=created|edited|involved\`, \`?q=\`, \`?created_by=\`, \`?expires=never\` or \`?expires_before=<iso>\`, \`?updated_before=<iso>\`, \`?min_size=<bytes or 500mb>\`, \`?sort=updated|name|size|age\`, \`?limit=\`, \`?cursor=\` (always intersected with your involvement — you cannot dump someone else's catalog). Responses include \`total\` and \`next_cursor\`. Search runs over the full involved set; pages are keyset cursors. Malformed filters are ignored, not 400. Every item carries \`last_read_at\`: when the Worker last served its bytes (public URL or \`/v1\`), \`null\` if never. It is a floor, not a view count: writes are throttled to about one per hour, and public reads answered from the edge cache do not reach the Worker. The edge cache holds public responses for at most a day, so the stamp lags real reads by at most about a day plus the hourly throttle.
- Clean up in bulk: \`POST /v1/cleanup\` with \`{"target": …, "action": "delete"|"set_ttl"|"expire"}\`. \`target\` is \`{"sites": [...], "files": [...]}\` ids or the same filters as the list (\`{}\` means everything you are involved in; optional \`kind: sites|files\`). Without \`confirm\` it is a dry run: \`matched\`, \`eligible\`, \`skipped\` (with \`by_reason\`), \`bytes\`, a \`sample\`, and a \`confirm\` string. Show the human the preview, then resend the same body with that \`confirm\` to execute (\`applied\`, \`skipped\`, \`failed\`). \`set_ttl\` takes \`ttl\`; \`expire\` sets a 30m grace and never moves an expiry later. Objects you cannot write are skipped, never a batch \`403\`. At most 100 eligible objects per call (\`413 cleanup_too_many\`: narrow the target). If the selection changed since the preview, \`409 cleanup_drift\` returns a fresh preview. Delete has no recycle bin. \`GET /v1/export\` first if they need a copy of what they own; cleanup \`{}\` is involvement, which is wider than ownership.
- Operators: \`GET /v1/admin/health\` is the read-only snapshot. \`POST /v1/admin/quota/recompute\` sets the ledger from stored sizes. \`POST /v1/admin/sweep\` runs one expiry batch. \`POST /v1/admin/gates/unlock\` clears a locked share gate by scope. \`POST /v1/admin/cleanup\` is the same preview/confirm/cap, host-wide, with \`owner\` (handle) and \`last_read_before\`. \`set_ttl\` without \`ttl\` is 7d. \`expire\` on anyone else's content is \`400 expire_not_own\`. \`GET /v1/admin/tokens\` lists token metadata across accounts (\`?owner=\` handle or email). \`POST /v1/admin/tokens/revoke\` previews then revokes \`stale\` or \`all\` for an owner. The calling admin token is left live. Never the secret or the hash. Needs an admin token. Recorded at \`GET /v1/admin/audit\`. Never returns published bytes or secrets.
- Optional share password: \`password\` on create/PATCH, or \`X-Energon-Set-Password\` on file write. Empty string clears. Write responses echo the password you just set. \`/v1\` GET never returns the phrase — only \`password_protected\`. Agents send \`X-Energon-Password\` on the human URL. Token GETs on \`/v1\` skip it.
- Retention: this Energon's default is \`${policy.defaultTtl}\`. Allowed: ${presets}. \`PUT\` does not extend expiry. \`PATCH { "ttl": "7d" }\` resets from now. Expired public URLs are \`410\` and then deleted.
- Who can write: this Energon's default is \`${policy.writePolicy}\` (\`owner\` = the creating account, \`org\` = any token on this host). Set \`write_policy\` on create to override. \`PATCH write_policy\` is creator-only. Anyone with a token can still read via \`/v1\`.
- Make a copy: \`POST /v1/sites\` with \`duplicate_from\` (source site id) + a new slug, or \`POST /v1/files\` with \`duplicate_from\`. You own the copy. Do not zip a site through context just to fork it. If you already have replacement bytes, POST/PUT those instead.
- Site zip export: \`GET /v1/sites/{id}/export\` (token). Same ${formatBytes(policy.fileBytes)} / file-count caps as import. A single file is never a zip; \`?download=1\` on a file URL sets \`Content-Disposition: attachment\`.
- Account zip export: \`GET /v1/export\` (token). Sites you own, each under \`sites/{id}/\`, plus loose files under \`files/{id}/\`, and \`manifest.json\` (ids, names, public URLs, sizes, expiry, write policy). Owned content only (\`owner_id\`), not everything you were involved in. Share and write passwords are omitted. Same caps; over them the body names the totals and tells you to export per site. Empty ownership is \`400 empty_export\`.
- \`.md\` files: browsers (\`Accept: text/html\`) get a rendered page (GFM + mermaid). \`curl\` and \`?raw=1\` get the markdown source. \`index.md\` is the site homepage when \`index.html\` is missing.

${hubGuestWriteSection(content)}
## Optional

- Agent skill for this Energon: add marketplace \`${id.repo}\` (\`https://github.com/${id.repo}\`) and install \`${id.plugin}\` at user (global) scope (\`${id.plugin}@${id.marketplace}\`). Do not install at project or workspace scope unless the human asked for that. The skill files name this origin (${id.origin}). A fork replaces the shipped skill with \`npm run skill:init\`. Claude Code and [Agent Plugins](https://agent-plugins.org/) hosts use the same repo.
- WebMCP tools register only on the signed-in hub. Agents that are not in that tab should use HTTP + the token.
`;
}

export function contentLlmsTxt(): string {
  return guestWriteLlmsBody();
}

export function llmsResponse(env: Env, kind: "hub" | "content" = "hub"): Response {
  const origin = publicOrigin(env);
  const body = kind === "content" ? contentLlmsTxt() : llmsTxt(origin, env);
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
