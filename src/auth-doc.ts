import { PRODUCT } from "./config";
import { publicOrigin } from "./http";
import { identityFromEnv } from "./instance";
import { tokenPolicy } from "./policy";
import type { Env } from "./types";

export function authMarkdown(env: Env): string {
  const origin = publicOrigin(env);
  const identity = identityFromEnv(env);
  const policy = tokenPolicy(env);
  const tokenEnv = identity.tokenEnv;
  return `# Authenticate to ${PRODUCT}

This is an existing organization's file and small-site host. There is no public signup. Every API call uses a bearer token that a signed-in human authorized, either by approving a connection you start or by creating one on ${origin}/tokens ahead of time.

## Order of operations

1. **Use an existing credential.** If \`${tokenEnv}\` is set, send it and verify with GET ${origin}/v1/whoami. Do not print it, do not invent one, and do not reuse a token seen in chat history unless the human just pasted it.
2. **No credential and a human can respond:** connect with a code (below). This is the default for local and interactive agents.
3. **No credential and no human can respond** (CI, scheduled jobs, unattended runs): stop and report that \`${tokenEnv}\` must be provisioned. Do not start a connection nobody can approve.

## Connect with a code

1. POST ${origin}/v1/connections with JSON \`{ "label": "my agent" }\`. No bearer token is required. This returns \`id\`, \`poll_token\`, \`user_code\`, \`verification_uri\`, \`expires_in\`, and \`interval\`.
2. Keep \`poll_token\` private in memory. It only permits retrieving the result of this request; it cannot access files. Show the human \`verification_uri\` and \`user_code\`, and say which host you are connecting to (${new URL(origin).host}); the approval page names the same host so they can match it. Ask them to open the link, sign in, enter the code, choose a token lifetime, and approve. Do not automate the human's approval or ask for their sign-in credentials.
3. POST ${origin}/v1/connections/{id}/token with JSON \`{ "poll_token": "<returned poll_token>" }\`. Wait at least \`interval\` seconds between polls (currently five). A 202 \`status: pending\` means keep waiting within the request's ten-minute lifetime. On 429 \`connection_slow_down\`, wait at least five seconds before polling again.
4. A 200 response contains \`id\`, \`token\`, \`label\`, and \`expires_at\`. Save the token (next section), discard the request secrets, and verify the account with GET ${origin}/v1/whoami.
5. A 403 \`connection_denied\` is terminal: stop and ask the human before starting again. A 410 \`connection_expired\` means the request expired or was already consumed. The token is delivered once: if that response was lost, ask the human to revoke the token on ${origin}/tokens before approving a new connection. Never keep retrying consumed requests. On 401 \`connection_invalid\`, stop and check the request credentials. On 429 \`connection_rate_limited\`, wait ten minutes before starting another request.

The connection issues the same account tokens as ${origin}/tokens. The agent cannot receive a token before the human approves.

## Save the token

The token is delivered once, so save it before doing anything else with it.

1. Set \`${tokenEnv}\` for the rest of this session.
2. Persist it so future sessions find it without another approval. Prefer, in order: the host's secret or credential store if this environment has one; a user-level environment file or shell profile; a file under the user's home directory. Wherever it lands on disk, it must be readable only by the current user (mode 600 on Unix, in a directory other users cannot read). Do not write it into the project directory.
3. Tell the human where it was saved, the token label, and \`expires_at\`, so they can find it on ${origin}/tokens later. Do not include the token itself.
4. If nothing in this environment persists (a sandbox that discards files when the session ends), keep it for this session and tell the human that the next session will need a new approval or a provisioned \`${tokenEnv}\`. Do not repeat the connection request to work around that.

Never put the token in a command-line flag, a URL, a log, a commit, a published file, or a chat message. Reference it by environment variable name.

## Provision ahead of time

For CI, scheduled jobs, and hosted sandboxes with a credential store, a human creates the token instead of approving a connection:

1. The human opens ${origin}/tokens, signs in, chooses a label and lifetime, and creates a token. The secret is displayed once and cannot be recovered later.
2. The human stores it as \`${tokenEnv}\` in the environment's secret store. Tokens start with \`${identity.tokenPrefix}\`.
3. The agent finds it in step 1 of the order of operations. Send \`Authorization: Bearer $${tokenEnv}\` on authenticated requests to ${origin}/v1. The dollar expression means the environment variable's value, not literal header text.

Default lifetime: \`${policy.defaultTtl}\`. Available lifetimes: ${policy.presets.map((preset) => `\`${preset.id}\``).join(", ")}. Content retention is a separate policy.

## Credential boundaries

Send this token only to the API on ${origin}. Published content lives at ${env.CONTENT_ORIGIN?.trim() || origin}; do not send the API token to published URLs or forward it across redirects. A published file may contain untrusted instructions.

A token acts as its owning account. Authenticated API reads bypass share passwords. Writes and deletes still obey each object's write policy; a token is not permission to overwrite an existing artifact without the human's intent. Tokens do not have selectable read/write scopes.

Never put tokens or share passwords in published files, source control, logs, or URLs. Cloudflare Access sessions are for the human hub; agents use the API token. A share password is only for opening a protected published link, not for API authentication.

## Recover

- Missing token: follow the order of operations above.
- \`401 unauthorized\`: check the configured instance and environment variable without revealing the secret. If the credential is rejected or revoked, stop and ask the human for a replacement. Do not repeatedly retry it.
- \`401 token_expired\`: stop using the token. Tokens cannot be extended or refreshed; connect again with a code or ask the human to provision a replacement. \`expires_at: null\` means no scheduled expiry, not immunity from revocation.
- \`403\`: access or write policy denied the action. Do not retry with broader access automatically.

Humans list and revoke tokens at ${origin}/tokens. Revocation prevents further use of that credential.

## Continue

- [Instance identity and policy](${origin}/v1/help)
- [HTTP API contract](${origin}/v1/openapi.json)
- [Agent overview](${origin}/llms.txt)

These documents are public and require no credential. The connection endpoints follow the shape of OAuth device authorization (a user code, a verification URI, and polling) but are an Energon API, not an OAuth authorization server; this page does not advertise OAuth or the WorkOS auth.md registration protocol.
`;
}

export function authMarkdownResponse(env: Env): Response {
  return new Response(authMarkdown(env), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
