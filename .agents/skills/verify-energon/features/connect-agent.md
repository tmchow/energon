# Connect an agent

An agent requests a connection, then a signed-in human enters its code and approves a token lifetime. The waiting agent receives a token once; manual token minting and revocation remain available.

## Sub-features

- `request`: POST `/v1/connections` with a label returns a verification URL, eight-digit code, private poll token, ten-minute lifetime, and five-second polling interval. It grants no file access.
- `approve`: `/connect?request={id}` is a chrome-less page that names the hub host, the requested label, the signed-in account, permissions, code input, lifetime, and approval/denial controls.
- `delivery`: POST `/v1/connections/{id}/token` with the private poll token returns 202 pending before approval and the token once after approval.
- `revocation`: the issued token appears on `/tokens` and obeys ordinary expiry/revocation rules.

## How to get to it (user POV)

- Agent: read `/auth.md`, POST `/v1/connections`, show the human the returned verification URL and code, then poll with the private poll token.
- Human: open the agent's verification URL, sign in, enter its code, select lifetime, and approve or deny.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed for this isolated run. HTTP approve here is a local fixture (same POST Connect.svelte sends), never a production approval.
- Use only the run's `$ORIGIN`. Keep poll tokens and delivered credentials out of screenshots, logs, and evidence bodies.

- **Default — Request.** `.agents/skills/verify-energon/bin/save --expect 201 connect-agent request POST "$ORIGIN/v1/connections" -H "content-type: application/json" --data '{"label":"verification agent"}'`. Body has `id`, `poll_token`, `user_code`, `verification_uri`, `expires_in:600`, `interval:5`. Keep secrets in a private temp file; copy a redacted body to evidence.
- **Default — Pending (once, no sleep).** Immediately POST `$ORIGIN/v1/connections/{id}/token` with `{"poll_token":"…"}`. Expect 202 `status:pending`. Do **not** sleep 5 seconds. Do **not** poll pending a second time (that is `429 connection_slow_down`).
- **Default — Approve (HTTP twin).** POST `$ORIGIN/account/connections/$REQ_ID/approve` with `-H "origin: $ORIGIN"` and `{"user_code":"$USER_CODE","ttl":"1d"}`. Expect 200 `{ "status": "approved" }` (no raw token).
- **Default — Delivery.** Poll token immediately after approve. Expect 200 with `token` (`ee_live_…`), label, token id, non-null `expires_at`. `GET /v1/whoami` with that token is 200. Second exchange is 410 `connection_expired`. Save only status, account, label, and expiry.
- **Default — Deny.** New request, then `POST $ORIGIN/account/connections/$REQ_ID/deny` with `-H "origin: $ORIGIN"` and `{}`. Poll is 403 `connection_denied` and no token.
- **Default — Revoke.** `DELETE /v1/whoami` with the delivered token (or hub revoke by label). `GET /v1/whoami` is 401.
- **Extra (approve / Connect.svelte) — Browser chrome.** Open `verification_uri`. No app header/footer. h1 `Connect your agent to` plus this run's hub host. Fill `#connect-code`, `#connect-ttl`, Approve. `#connect-status` says `Connection approved`. Drive when Connect.svelte copy or controls change.
- **Extra (request expiry) — Ten-minute wait.** Wait 10 minutes after create only when `src/connections.ts` expiry changed. GET `/connect?request=$id` and poll are 410. Do not wait otherwise.
- **Proof.** Default: redacted request/pending/approve/delivery/deny status files. Screenshot only for Extra browser. Never save a raw credential response as evidence.

## Gotchas

- `/connect` must remain behind Access in production. The `/v1/connections` endpoints bypass Access and enforce the request/approval boundary themselves.
- The human code and poll token have different roles. The human enters the code on Energon; the agent keeps the poll token private.
- Delivery is one-time. If its response is lost, revoke the issued token by label before approving a new request. Do not retry a consumed request.
- Default does not wait `interval` seconds. Poll pending once, approve via `POST /account/connections/{id}/approve` with `-H "origin: $ORIGIN"`, then poll delivery. A second pending poll within five seconds is `429 connection_slow_down`.
- A denied request requires a new human decision, not automatic re-registration. This API is not OAuth device authorization.
