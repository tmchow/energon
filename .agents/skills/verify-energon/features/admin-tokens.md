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
- `bin/up` passed.
- Owner identity for this recipe is `vadmin-tok@example.com` (sent as `Cf-Access-Authenticated-User-Email`). Handle is `vadmin-tok`.
- Every fixture label starts with `vadmin-tok` so other recipes stay out of the target.

- **Default — Owner fixture.** `POST /account/tokens` with Access header `vadmin-tok@example.com`, `origin: $ORIGIN`, `{"label":"vadmin-tok-agent"}` (`201`). Record `$OWNER_TOKEN`. `GET /v1/whoami` is `200`.
- **Default — Non-admin 403.** `bin/mint-token vadmin-tok-account` on `GET /v1/admin/tokens?owner=vadmin-tok` and `POST /v1/admin/tokens/revoke` is `403 forbidden_admin`.
- **Default — Admin list / preview / execute / audit.** Mint `{"label":"vadmin-tok-ops","ttl":"1d","scope":"admin"}`. `GET /v1/admin/tokens?owner=vadmin-tok` includes `vadmin-tok-agent`, owner email/handle, hint, status; no `$OWNER_TOKEN` or `token_hash`. Preview `{"owner":"vadmin-tok","target":"all"}` `executed` false, 32-hex `confirm`; owner whoami still `200`. Execute with `confirm`: owner whoami `401`. Audit events `action` `tokens`; no secrets.
- **Extra (admin-tokens-page) — Hub list.** Open `/admin`, `#admin-tokens-owner`, List, `#admin-tokens-dlg`. Drive when Admin.svelte tokens card changes.
- **Proof.** Default: list, 403s, preview, execute, audit JSON. Screenshot only for Extra hub.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email. `.dev.vars` `DEV_ACCESS_EMAIL` wins over the launch default `dev@example.com`.
- `bin/mint-token` mints an account token. Admin scope is `POST /account/tokens` with `"scope":"admin"` and `ttl` `1d` or `7d`.
- Owner is a handle or email. Listing an unknown owner returns an empty `tokens` array, not 404. Revoking an unknown owner is `400 bad_owner`.
- Hub humans GET `/account/admin/tokens` and POST `/account/admin/tokens/revoke` (Access). Agents use `/v1/admin/tokens` and `/v1/admin/tokens/revoke` with an admin token.
- An admin revoking their own tokens is allowed. The calling admin token is excluded from the eligible set so the request can finish.
- An account token cannot list or revoke another account's tokens. That is admin only.
