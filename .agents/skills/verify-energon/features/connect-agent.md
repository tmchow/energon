# Connect an agent

An agent requests a connection, then a signed-in human enters its code and approves a token lifetime. The waiting agent receives a token once; manual token minting and revocation remain available.

## Sub-features

- `request`: POST `/v1/connections` with a label returns a verification URL, eight-digit code, private poll token, ten-minute lifetime, and five-second polling interval. It grants no file access.
- `approve`: `/connect?request={id}` is a chrome-less page that names the hub host, the requested label, the signed-in account, permissions, code input, lifetime, and approval/denial controls.
- `ended`: GET `/connect?request=` after expiry, consume, approval, or denial is HTML (not JSON). Expired and consumed pages show `This request has expired; ask your agent to start a new one.` and hide `#connect-code`. Agent poll of `/v1/connections/{id}/token` stays JSON `410 connection_expired` / `403 connection_denied`.
- `delivery`: POST `/v1/connections/{id}/token` with the private poll token returns 202 pending before approval and the token once after approval.
- `revocation`: the issued token appears on `/tokens` and obeys ordinary expiry/revocation rules.

## How to get to it (user POV)

- Agent: read `/auth.md`, POST `/v1/connections`, show the human the returned verification URL and code, then poll with the private poll token.
- Human: open the agent's verification URL, sign in, enter its code, select lifetime, and approve or deny. Opening an expired, consumed, approved, or denied URL shows HTML explaining that the request ended; it does not return JSON.

## Driving it with energon-verify

Preconditions:

- Launch and doctor passed for this isolated run. Browser approval here is a local test fixture, never a production approval.
- Use only the run's `$ORIGIN`. Keep poll tokens and delivered credentials out of screenshots, logs, and evidence bodies.

- **Request.** POST `$ORIGIN/v1/connections` with JSON `{"label":"verification agent"}` and no bearer. Expect 201 with `id`, `poll_token`, `user_code`, `verification_uri`, `expires_in:600`, `interval:5`. Keep the secrets only in a private temporary file. Save a redacted response.
- **Pending.** POST `$ORIGIN/v1/connections/{id}/token` with JSON containing the returned `poll_token`. Expect 202 `status:pending`. Wait at least five seconds between polls.
- **Approval.** Open the returned verification URL. The page has no app header or footer. The h1 reads `Connect your agent to` followed by this run's hub host (`127.0.0.1:18787`); confirm it matches `$ORIGIN`. Confirm the agent label, the signed-in account, the access disclosure, and the lifetime control. Fill `#connect-code` with the returned code, choose `1d` in `#connect-ttl`, and click `Approve connection`. Expect `#connect-status` to contain `Connection approved` (full copy: `Connection approved. Return to your agent to finish connecting; it receives the token on its next poll.`) and the form to be hidden. Save a screenshot.
- **Delivery.** Poll again. Expect 200 with the token, label, token id, and non-null `expires_at`. GET `/v1/whoami` using the token must return the approving account and label. Save only status, account, label, and expiry. A second exchange must be 410 `connection_expired`.
- **Revocation.** Open `/tokens`, find `verification agent`, revoke it, and verify GET `/v1/whoami` rejects it with 401.
- **Denial.** Start a separate request, open its URL, and click `Deny connection` without entering a code. Polling must return 403 `connection_denied` and no token. Approve still requires the eight-digit code. GET the same verification URL after deny: 403 HTML containing `This connection was denied` and no `#connect-code`. Save as `denied.html`.
- **Ended page.** After delivery, GET the consumed verification URL as the signed-in human (`curl -sS -D - -o "$EVIDENCE/connect-agent/consumed.html" "$ORIGIN/connect?request=$ID"`). Expect `410`, `content-type: text/html`, body containing `This request has expired; ask your agent to start a new one.`, and no `#connect-code`. A second agent poll remains JSON `410 connection_expired`. Save headers as `consumed.headers`.
- **Proof.** Save redacted status/body records and approval/revocation screenshots. Never save a raw credential response as evidence.

## Gotchas

- `/connect` must remain behind Access in production. The `/v1/connections` endpoints bypass Access and enforce the request/approval boundary themselves.
- The human code and poll token have different roles. The human enters the code on Energon; the agent keeps the poll token private.
- Delivery is one-time. If its response is lost, revoke the issued token by label before approving a new request. Do not retry a consumed request.
- A denied request requires a new human decision, not automatic re-registration. This API is not OAuth device authorization.
- The request lasts ten minutes (`expires_in: 600`). Drive approval before that window closes. After expiry or consume, the human URL is still HTML (`This request has expired`); only the agent poll is JSON `410 connection_expired`. Start a new request.
