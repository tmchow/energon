# Admin tokens

Operators listed on `ADMIN_EMAILS` list API token metadata across accounts. The hub page is `/admin`. Agents use `GET /v1/admin/tokens` with an admin token. Listing is metadata only: owner email and handle, label, hint, scope, created, last used, expires, status. Never the secret, never the hash.

## Sub-features

- `admin-tokens-list` GETs `/account/admin/tokens` (hub) or `/v1/admin/tokens` (admin token) and returns `tokens` with owner email and handle, label, hint, scope, created, last used, expires, and status (`live` | `stale` | `expired` | `revoked`). `?owner=` is a handle or email. `?limit=` and `?cursor=` page like audit. Never the secret, never the hash.
- `admin-tokens-refuse` is `403 forbidden_admin` for a non-admin on `GET /account/admin/tokens` and `GET /v1/admin/tokens`.

## How to get to it (user POV)

- Operator, agent: mint `scope: admin` at `/tokens`, then `GET /v1/admin/tokens?owner=handle`.
- Operator, hub: `GET /account/admin/tokens?owner=handle` while signed in.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/tokens`; `GET $ORIGIN/v1/help` `routes` names it.
- A person not on `ADMIN_EMAILS` gets `403 forbidden_admin` on both routes. An account token does too.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- Doctor has passed for `$ORIGIN`.
- Owner identity for this recipe is `vadmin-tok@example.com` (sent as `Cf-Access-Authenticated-User-Email`). Handle is `vadmin-tok`.
- Every fixture label starts with `vadmin-tok` so other recipes stay out of the target.

- **Owner fixture.** Mint an owner token: `curl -sS -o "$EVIDENCE/admin-tokens/owner-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" -H "Cf-Access-Authenticated-User-Email: vadmin-tok@example.com" --data '{"label":"vadmin-tok-agent"}'` (`201`). Record `token` as `$OWNER_TOKEN`. `GET "$ORIGIN/v1/whoami"` with it is `200`.
- **Non-admin route.** Mint a doctor *account* token with `.agents/skills/verify-energon/bin/mint-token vadmin-tok-account` (no `scope`). `GET "$ORIGIN/v1/admin/tokens?owner=vadmin-tok"` with that secret is `403 forbidden_admin`. Save as `account-token-403.json`.
- **Admin token.** Run `curl -sS -o "$EVIDENCE/admin-tokens/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vadmin-tok-ops","ttl":"1d","scope":"admin"}'` (`201`). Record `token` as `$ADMIN_TOKEN`.
- **List.** `GET "$ORIGIN/v1/admin/tokens?owner=vadmin-tok"` with `$ADMIN_TOKEN` is `200`. Body `tokens` includes `label` `vadmin-tok-agent`, `owner_email` `vadmin-tok@example.com`, `owner_handle` `vadmin-tok`, a `hint`, and `status`. Body does not contain `$OWNER_TOKEN` or `token_hash`. Save as `list.json`.
- **Proof.** Save every status and body under `$EVIDENCE/admin-tokens/`.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email. `.dev.vars` `DEV_ACCESS_EMAIL` wins over the launch default `dev@example.com`.
- `bin/mint-token` mints an account token. Admin scope is `POST /account/tokens` with `"scope":"admin"` and `ttl` `1d` or `7d`.
- Owner is a handle or email. An unknown owner returns an empty `tokens` array, not 404.
- Hub humans GET `/account/admin/tokens` (Access). Agents GET `/v1/admin/tokens` with an admin token.
