# Admin tokens

Operators listed on `ADMIN_EMAILS` list and revoke API token metadata across accounts. The hub page is `/admin`. Agents use `GET /v1/admin/tokens` and `POST /v1/admin/tokens/revoke` with an admin token. Listing is metadata only: owner email and handle, label, hint, scope, created, last used, expires, status. Never the secret, never the hash. Revoke is preview-then-confirm for `stale` or `all` on one owner. The calling admin token is left live.

## Sub-features

- `admin-tokens-list` GETs `/account/admin/tokens` (hub) or `/v1/admin/tokens` (admin token) and returns `tokens` with owner email and handle, label, hint, scope, created, last used, expires, and status (`live` | `stale` | `expired` | `revoked`). `?owner=` is a handle or email. `?limit=` and `?cursor=` page like audit. Never the secret, never the hash.
- `admin-tokens-page` is the Tokens across accounts card on `/admin`: `#admin-tokens-owner`, `#admin-tokens-list`, `#admin-tokens-table`, `#admin-tokens-show`, `#admin-revoke-stale`, `#admin-revoke-all`, `#admin-tokens-dlg`.
- `admin-tokens-revoke` POSTs `/account/admin/tokens/revoke` (hub) or `/v1/admin/tokens/revoke` (admin token) with `{ "owner", "target": "stale"|"all" }` and returns `executed: false`, `matched`, `sample`, and a 32-hex `confirm`. Resend with `confirm` to execute. Drift is `409 token_revoke_drift`. Missing or unknown owner is `400 bad_owner`. The calling admin token is excluded.
- `admin-tokens-refuse` is `403 forbidden_admin` for a non-admin on `GET /account/admin/tokens`, `GET /v1/admin/tokens`, `POST /account/admin/tokens/revoke`, and `POST /v1/admin/tokens/revoke`.
- `admin-tokens-audit` records every preview and execute (`action` `tokens`) at `GET /v1/admin/audit` and `GET /account/admin/audit`. Never secrets.

## How to get to it (user POV)

- Operator, agent: mint `scope: admin` at `/tokens`, then `GET /v1/admin/tokens?owner=handle`. `POST /v1/admin/tokens/revoke` with `{ "owner", "target" }` to preview and the same body plus `confirm` to execute.
- Operator, hub: open `/admin`. Fill `#admin-tokens-owner`, choose List, read `#admin-tokens-table`, choose Revoke stale or Revoke all, type the count in `#admin-tokens-dlg`.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/tokens` and `/v1/admin/tokens/revoke`; `GET $ORIGIN/v1/help` `routes` names both.
- A person not on `ADMIN_EMAILS` gets `403 forbidden_admin` on both routes. An account token does too.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- Doctor has passed for `$ORIGIN`.
- Owner identity for this recipe is `vadmin-tok@example.com` (sent as `Cf-Access-Authenticated-User-Email`). Handle is `vadmin-tok`.
- Every fixture label starts with `vadmin-tok` so other recipes stay out of the target.

- **Owner fixture.** Mint an owner token: `curl -sS -o "$EVIDENCE/admin-tokens/owner-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" -H "Cf-Access-Authenticated-User-Email: vadmin-tok@example.com" --data '{"label":"vadmin-tok-agent"}'` (`201`). Record `token` as `$OWNER_TOKEN`. `GET "$ORIGIN/v1/whoami"` with it is `200`.
- **Non-admin route.** Mint a doctor *account* token with `.agents/skills/verify-energon/bin/mint-token vadmin-tok-account` (no `scope`). `GET "$ORIGIN/v1/admin/tokens?owner=vadmin-tok"` with that secret is `403 forbidden_admin`. Save as `account-token-403.json`. `POST "$ORIGIN/v1/admin/tokens/revoke"` with the same secret and `{"owner":"vadmin-tok","target":"all"}` is `403 forbidden_admin`. Save as `account-token-revoke-403.json`.
- **Admin token.** Run `curl -sS -o "$EVIDENCE/admin-tokens/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vadmin-tok-ops","ttl":"1d","scope":"admin"}'` (`201`). Record `token` as `$ADMIN_TOKEN`.
- **List.** `GET "$ORIGIN/v1/admin/tokens?owner=vadmin-tok"` with `$ADMIN_TOKEN` is `200`. Body `tokens` includes `label` `vadmin-tok-agent`, `owner_email` `vadmin-tok@example.com`, `owner_handle` `vadmin-tok`, a `hint`, and `status`. Body does not contain `$OWNER_TOKEN` or `token_hash`. Save as `list.json`.
- **Hub list.** Open `/admin`. `#admin-tokens-owner` is present. Fill it with `vadmin-tok`, choose List. `#admin-tokens-table` names `vadmin-tok-agent`. Save a screenshot of `/admin` with Energon and `#who` visible.
- **Preview.** `POST "$ORIGIN/v1/admin/tokens/revoke"` with `$ADMIN_TOKEN` and `{"owner":"vadmin-tok","target":"all"}` is `200`. Body `executed` false, `matched` at least `1`, `sample` includes `vadmin-tok-agent`, `confirm` is 32 hex. Record `confirm` as `$CONFIRM`. Owner `GET "$ORIGIN/v1/whoami"` with `$OWNER_TOKEN` is still `200`. Save as `preview.json`.
- **Execute.** Resend the preview POST with `"confirm":"$CONFIRM"`, saving to `execute.json`. Status `200`, `executed` true, `revoked` at least `1`. `GET "$ORIGIN/v1/whoami"` with `$OWNER_TOKEN` is `401`.
- **Audit.** `GET "$ORIGIN/v1/admin/audit" -H "Authorization: Bearer $ADMIN_TOKEN"` is `200` with a preview event and an executed event whose `action` is `tokens`. Neither body contains `$ADMIN_TOKEN` or `$OWNER_TOKEN`. Save as `audit.json`.
- **Proof.** Save every status and body under `$EVIDENCE/admin-tokens/`, plus screenshots of `/admin` (operator list) and `#admin-tokens-dlg` if driven in the browser.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email. `.dev.vars` `DEV_ACCESS_EMAIL` wins over the launch default `dev@example.com`.
- `bin/mint-token` mints an account token. Admin scope is `POST /account/tokens` with `"scope":"admin"` and `ttl` `1d` or `7d`.
- Owner is a handle or email. Listing an unknown owner returns an empty `tokens` array, not 404. Revoking an unknown owner is `400 bad_owner`.
- Hub humans GET `/account/admin/tokens` and POST `/account/admin/tokens/revoke` (Access). Agents use `/v1/admin/tokens` and `/v1/admin/tokens/revoke` with an admin token.
- An admin revoking their own tokens is allowed. The calling admin token is excluded from the eligible set so the request can finish.
- An account token cannot list or revoke another account's tokens. That is admin only.
