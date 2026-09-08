# Admin health

Operators listed on `ADMIN_EMAILS` see a read-only health snapshot on `/admin`. Agents use `GET /v1/admin/health` with an admin token. The snapshot names quota used versus the cap, catalog stored sizes, expired objects awaiting purge, stale purge claims, locked share gates, and catalog counts. It never returns published bytes or secrets.

## Sub-features

- `admin-health-page` is the `#admin-health` card on `GET /admin` for operators. It shows quota used, cap, catalog, expired awaiting purge, stale purge claims, locked share gates, sites, files, and people.
- `admin-health-get` is `GET /v1/admin/health` (admin token) and `GET /account/admin/health` (hub). Same JSON. Never published bytes or secrets.
- `admin-health-refuse` is `403 forbidden_admin` for a non-admin on `GET /admin` health numbers, `GET /account/admin/health`, and `GET /v1/admin/health`.

## How to get to it (user POV)

- Operator, hub: open `/admin`. `#admin-health` is above Find work.
- Operator, agent: mint `scope: admin` at `/tokens`, then `GET /v1/admin/health`.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/health`; `GET $ORIGIN/v1/help` `routes` names it.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- Doctor has passed for `$ORIGIN`.

- **Operator hub.** Open `$ORIGIN/admin`. `#admin-health`, `#admin-health-used`, `#admin-health-cap`, `#admin-health-expired`, `#admin-health-stale`, and `#admin-health-locked` are present. Save a screenshot of `/admin` with Energon and `#who` visible.
- **Admin token.** Run `curl -sS -o "$EVIDENCE/admin-health/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vhealth-ops","ttl":"1d","scope":"admin"}'` (`201`). Record `token` as `$ADMIN_TOKEN`.
- **Health GET.** `GET "$ORIGIN/v1/admin/health"` with `$ADMIN_TOKEN` is `200`. Body has `quota.used_bytes`, `quota.limit_bytes`, `quota.catalog_bytes`, `expired_awaiting_purge`, `stale_purge_claims`, `locked_gates`. Body does not contain `$ADMIN_TOKEN`. Save as `health.json`.
- **Hub twin.** `GET "$ORIGIN/account/admin/health"` as the doctor is `200` with the same keys.
- **Non-admin.** Mint a doctor account token with `.agents/skills/verify-energon/bin/mint-token vhealth-account` (no `scope`). `GET "$ORIGIN/v1/admin/health"` with that secret is `403 forbidden_admin`. Save as `account-token-403.json`.
- **Proof.** Save every status and body under `$EVIDENCE/admin-health/`, plus a screenshot of `#admin-health`.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email.
- Quota used is `platform_quota.used`, not the catalog SUM. Catalog and used can differ when the ledger has drifted.
- Locked share-gate scopes are `obj:…` / `ip:…` (and `wobj:` / `wip:` for write). They are not secrets.
- Health never returns published file bytes, share passwords, or write passwords.
