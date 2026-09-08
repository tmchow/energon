# Admin health

Operators listed on `ADMIN_EMAILS` see storage health on `/admin` and can repair quota drift, leftover expired objects, and locked share gates. Agents use `GET /v1/admin/health` and the matching `POST /v1/admin/...` routes with an admin token. Health and repairs never return published bytes or secrets.

## Sub-features

- `admin-health-page` is the `#admin-health` card on `GET /admin` for operators. It shows quota used, cap, catalog, expired awaiting purge, stale purge claims, locked share gates, sites, files, and people.
- `admin-health-get` is `GET /v1/admin/health` (admin token) and `GET /account/admin/health` (hub). Same JSON. Never published bytes or secrets.
- `admin-health-refuse` is `403 forbidden_admin` for a non-admin on `GET /admin` health numbers, `GET /account/admin/health`, `GET /v1/admin/health`, and the three repair POSTs.
- `admin-health-recompute` is `POST /v1/admin/quota/recompute` (admin token) and `POST /account/admin/quota/recompute` (hub). Sets `platform_quota.used` from `SUM(size)`. Returns `used_before` and `used_after`. Hub `#admin-health-recompute` opens `#admin-health-recompute-dlg` first.
- `admin-health-sweep` is `POST /v1/admin/sweep` (admin token) and `POST /account/admin/sweep` (hub). Runs one expiry batch and returns `swept` plus `expired_remaining`. Hub `#admin-health-sweep` opens `#admin-health-sweep-dlg` first; the button reads `N left, run again` when expired objects remain.
- `admin-health-unlock` is `POST /v1/admin/gates/unlock` (admin token) and `POST /account/admin/gates/unlock` (hub) with `{ "scope" }`. Clears that `gate_attempts` row. Hub field is `#admin-health-scope`; submit is `#admin-health-unlock`. Empty scope with an admin token is `400 bad_target`. No token, including a malformed JSON body, is `401 unauthorized`.

## How to get to it (user POV)

- Operator, hub: open `/admin`. `#admin-health` is above Find work. Recompute and sweep confirm in dialogs. Unlock takes a scope such as `obj:/{handle}/f/{id}/` (trailing slash, no filename) or `ip:…`.
- Operator, agent: mint `scope: admin` at `/tokens`, then `GET /v1/admin/health`, `POST /v1/admin/quota/recompute`, `POST /v1/admin/sweep`, `POST /v1/admin/gates/unlock`.
- `GET $ORIGIN/v1/openapi.json` documents the health GET and three POSTs; `GET $ORIGIN/v1/help` `routes` names them.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- Doctor has passed for `$ORIGIN`.
- Persist is `$PERSIST` from `state.env` (under `/tmp/energon-verify`). Do not use `.wrangler/state`. Do not GET an expired public URL before sweep; that GET auto-purges.

- **Operator hub.** Open `$ORIGIN/admin`. `#admin-health`, `#admin-health-used`, `#admin-health-cap`, `#admin-health-expired`, `#admin-health-stale`, `#admin-health-locked`, `#admin-health-recompute`, `#admin-health-sweep`, `#admin-health-unlock`, and `#admin-health-scope` are present. Save a screenshot of `/admin` with Energon and `#who` visible.
- **Admin token.** Run `curl -sS -o "$EVIDENCE/admin-health/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vhealth-ops","ttl":"1d","scope":"admin"}'` (`201`). Record `token` as `$ADMIN_TOKEN`.
- **Health GET.** `GET "$ORIGIN/v1/admin/health"` with `$ADMIN_TOKEN` is `200`. Body has `quota.used_bytes`, `quota.limit_bytes`, `quota.catalog_bytes`, `expired_awaiting_purge`, `stale_purge_claims`, `locked_gates`. Body does not contain `$ADMIN_TOKEN`. Save as `health.json`.
- **Hub twin.** `GET "$ORIGIN/account/admin/health"` as the doctor is `200` with the same keys.
- **Non-admin.** Mint a doctor account token with `.agents/skills/verify-energon/bin/mint-token vhealth-account` (no `scope`). `GET "$ORIGIN/v1/admin/health"` with that secret is `403 forbidden_admin`. Save as `account-token-403.json`. The same token POSTing `/v1/admin/quota/recompute`, `/v1/admin/sweep`, and `/v1/admin/gates/unlock` is also `403`.
- **Publish then delete.** Mint with `bin/mint-token vhealth-publish`. `POST "$ORIGIN/v1/files"` with `X-Filename: vhealth-quota.md` and body `quota-bytes` is `201`. Record `id`. `DELETE "$ORIGIN/v1/files/$ID"` is `200`. Public GET is `404`. Save write and delete bodies.
- **Recompute after a wrong ledger.** From the repo root run `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE platform_quota SET used = 9001000000 WHERE id = 1"`. `GET "$ORIGIN/v1/admin/health"` `quota.used_bytes` is `9001000000` and differs from `quota.catalog_bytes`. Open `/admin`, click `#admin-health-recompute`, confirm `#admin-health-recompute-dlg`. Then `POST "$ORIGIN/v1/admin/quota/recompute"` with `$ADMIN_TOKEN` is `200`, `used_before` `9001000000`, `used_after` equals health `quota.catalog_bytes`. Second view: health `quota.used_bytes` matches `used_after`. Body has no file bytes. Save as `recompute.json`.
- **Sweep now.** `POST "$ORIGIN/v1/files"` with `X-Filename: vhealth-sweep.md`, `X-Energon-TTL: 1d`, body `sweep-me` (`201`). Record `id` as `$SWEEP_ID`. Run `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE loose_files SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '$SWEEP_ID'"`. Do not GET the public URL. Health `expired_awaiting_purge` is at least `1`. Open `/admin`, click `#admin-health-sweep`, confirm `#admin-health-sweep-dlg` (or `POST "$ORIGIN/v1/admin/sweep"`). Body has `swept` and `expired_remaining`. If remaining is greater than `0`, the hub button reads `N left, run again`; POST again. `GET "$ORIGIN/v1/files/$SWEEP_ID"` with the publish token is `404`. Save as `sweep.json`.
- **Unauthenticated unlock.** `POST "$ORIGIN/v1/admin/gates/unlock"` with no Authorization and body `{` is `401` (`error` `unauthorized`). The same POST with `{}` and no Authorization is also `401`, not `400`. Save as `unlock-noauth-malformed.json` and `unlock-noauth.json`.
- **Unlock a locked gate.** Publish `vhealth-gate.md` with a share password `gate-secret`. Hit the public URL with a wrong `X-Energon-Password` until the gate locks (`429` or the locked HTML). Health `locked_scopes` lists both `obj:/HANDLE/f/id/` and `ip:…`. Unlock each scope (`#admin-health-scope` then `#admin-health-unlock`, or `POST "$ORIGIN/v1/admin/gates/unlock"` with `{ "scope": "..." }`). Each body `unlocked` true. After both rows are gone, a later wrong password is `401 password_required` rather than `429`. Empty `{ "scope": "" }` with `$ADMIN_TOKEN` is `400 bad_target`. Save as `unlock.json` and `unlock-ip.json`.
- **Proof.** Save every status and body under `$EVIDENCE/admin-health/`, plus screenshots of `#admin-health` before and after recompute, after sweep, and after unlock.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email.
- Quota used is `platform_quota.used`, not the catalog SUM. Catalog and used can differ when the ledger has drifted. Recompute sets used from stored sizes; it does not delete content.
- Setting `expires_at` in the throwaway verify D1 is how to make sweep visible without waiting. GET of that public URL purges immediately and invalidates the sweep proof.
- Locked share-gate scopes are `obj:…` / `ip:…` (and `wobj:` / `wip:` for write). They are not secrets. A lockout writes both an object scope and an IP scope; unlocking only one leaves the other blocking.
- Health and repairs never return published file bytes, share passwords, or write passwords.
- Sweep runs one batch of at most 100. Remaining greater than 0 means run again; do not loop in one request.
- Hub humans POST `/account/admin/...`. Agents POST `/v1/admin/...` with an admin token.
