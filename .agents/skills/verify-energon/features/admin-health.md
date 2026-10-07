# Admin health

Operators listed on `ADMIN_EMAILS` see storage health on `/admin` and can repair quota drift, leftover expired objects, and locked share gates. Agents use `GET /v1/admin/health` and the matching `POST /v1/admin/...` routes with an admin token. Health and repairs never return published bytes or secrets.

## Sub-features

- `admin-health-page` is the `#admin-health` card on `GET /admin` for operators. It shows quota used, cap, catalog, expired awaiting purge, stale purge claims, locked share gates, sites, files, and people. `#admin-health-file-recoveries` appears only while a loose-file storage reservation is unresolved.
- `admin-health-get` is `GET /v1/admin/health` (admin token) and `GET /account/admin/health` (hub). Same JSON. Never published bytes or secrets.
- `admin-health-refuse` is `403 forbidden_admin` for a non-admin on `GET /admin` health numbers, `GET /account/admin/health`, `GET /v1/admin/health`, and the three repair POSTs.
- `admin-health-recompute` is `POST /v1/admin/quota/recompute` (admin token) and `POST /account/admin/quota/recompute` (hub). Recomputes `platform_quota.used` from catalog bytes and durable allocations, including pending reservations and retained versions. Returns `used_before` and `used_after`. Hub `#admin-health-recompute` opens `#admin-health-recompute-dlg` first.
- `admin-health-sweep` is `POST /v1/admin/sweep` (admin token) and `POST /account/admin/sweep` (hub). Runs one expiry batch and returns `swept` plus `expired_remaining`. Hub `#admin-health-sweep` opens `#admin-health-sweep-dlg` first; the button reads `N left, run again` when expired objects remain.
- `admin-health-unlock` is `POST /v1/admin/gates/unlock` (admin token) and `POST /account/admin/gates/unlock` (hub) with `{ "scope" }`. Clears that `gate_attempts` row. Hub field is `#admin-health-scope`; submit is `#admin-health-unlock`. Empty scope with an admin token is `400 bad_target`. No token, including a malformed JSON body, is `401 unauthorized`.

## How to get to it (user POV)

- Operator, hub: open `/admin`. `#admin-health` is above Find work. Recompute and sweep confirm in dialogs. Unlock takes a scope such as `obj:/{handle}/f/{id}/` (trailing slash, no filename) or `ip:…`.
- Operator, agent: mint `scope: admin` at `/tokens`, then `GET /v1/admin/health`, `POST /v1/admin/quota/recompute`, `POST /v1/admin/sweep`, `POST /v1/admin/gates/unlock`.
- `GET $ORIGIN/v1/openapi.json` documents the health GET and three POSTs; `GET $ORIGIN/v1/help` `routes` names them.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- `bin/up` passed. Persist is `$PERSIST` from `state.env`. Do not GET an expired public URL before Extra sweep; that GET auto-purges.

- **Default — Admin token.** `POST $ORIGIN/account/tokens` `-H "origin: $ORIGIN"` `{"label":"vhealth-ops","ttl":"1d","scope":"admin"}` (`201`). Record `$ADMIN_TOKEN`.
- **Default — Health GET.** `GET $ORIGIN/v1/admin/health` with `$ADMIN_TOKEN` is `200`. Keys: `quota.used_bytes`, `quota.limit_bytes`, `quota.catalog_bytes`, `expired_awaiting_purge`, `stale_purge_claims`, `locked_gates`. No `$ADMIN_TOKEN` in the body. `GET $ORIGIN/account/admin/health` as the doctor is `200` with the same keys.
- **Default — Non-admin / unauth.** `bin/mint-token vhealth-account` (no scope). That secret on `GET /v1/admin/health` and the three repair POSTs is `403 forbidden_admin`. `POST /v1/admin/gates/unlock` with no Authorization (malformed `{` or `{}`) is `401 unauthorized`. Empty `{ "scope": "" }` with `$ADMIN_TOKEN` is `400 bad_target`.
- **Default — Recompute.** `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE platform_quota SET used = 9001000000 WHERE id = 1"` (setup). Health `quota.used_bytes` is `9001000000`. `POST /v1/admin/quota/recompute` with `$ADMIN_TOKEN` is `200`, `used_after` equals `quota.catalog_bytes`.
- **Extra (admin-health-page) — Operator hub.** Open `$ORIGIN/admin`. `#admin-health` and repair controls present. Drive when Admin.svelte health card changes.
- **Extra (admin-health-sweep) — Sweep now.** Publish a file, backdate `expires_at` on `$PERSIST`, do **not** GET the public URL, `POST /v1/admin/sweep`. Drive when sweep changes.
- **Extra (admin-health-unlock) — Unlock.** Do **not** send 20 wrong-password GETs. After publishing `$ID`, seed **this run's** DB with an ISO `window_start` (SQLite `datetime('now')` will not match the health query): `INSERT OR REPLACE INTO gate_attempts (scope, fails, window_start) VALUES ('obj:/$HANDLE/f/$ID/', 20, '<ISO now>')`. Health lists that scope. `POST /v1/admin/gates/unlock` `{ "scope": "obj:/$HANDLE/f/$ID/" }` `unlocked` true. Drive when lockout or unlock changes.
- **Extra (file recovery) — Blocked file.** Publish a file `$ID` and seed **this run's** DB with an uncertain reservation: `INSERT INTO storage_allocations (id, owner_id, kind, reserved_bytes, attempt_id, created_at, recovery_json, state, cleanup_error, writer_expires_at) VALUES ('vrecover-1', 'verify', 'legacy_reservation', 1, 'vrecover-1', '<ISO now>', '{"fileId":"$ID","targetKey":"files/$ID/x","ownerId":"verify","operation":"replace"}', 'uncertain', 'seeded', '<ISO now>')`. `PUT`, `PATCH`, and `DELETE /v1/files/$ID` are `409 file_recovery_required`; a grant for `$ID` ends `410 grant_failed` with `reason: file_recovery_required`. Health `file_recoveries.recovery_required` is 1 and the item names `$ID`; `/admin` shows `#admin-health-file-recoveries`. Drive when reservation fencing or the health section changes.
- **Extra (site conversion) — Progress and blocker.** With `SITE_VERSIONING_ENABLED=true`, seed a legacy site with a catalog path whose R2 object is missing in this run only. Run Sweep now. Health and the operator page must identify the site and its repairable conversion error without publishing a partial version. Check desktop and mobile layouts and the sweep confirmation.
- **Proof.** Default: health JSON, 403, 401, 400, recompute JSON. Screenshots only for Extra hub.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email.
- Quota used is `platform_quota.used`, not the catalog SUM. Catalog and used can differ when the ledger has drifted. Recompute sets used from stored sizes; it does not delete content.
- Setting `expires_at` in the throwaway verify D1 is how to make sweep visible without waiting. GET of that public URL purges immediately and invalidates the sweep proof.
- Locked share-gate scopes are `obj:/{handle}/f/{id}/` and `ip:…` (and `wobj:` / `wip:` for write). They are not secrets. A lockout writes both an object scope and an IP scope; unlocking only one leaves the other blocking. Extra unlock seeds `gate_attempts` (`fails=20`) on `$PERSIST`; do not send twenty wrong-password GETs.
- Health and repairs never return published file bytes, share passwords, or write passwords.
- Sweep runs one batch: at most 100 expired sites and 100 expired files per call. `swept` is `{sites, files}`. Remaining greater than 0 means run again; do not loop in one request.
- Sweep also advances bounded version/allocation cleanup and, when `SITE_VERSIONING_ENABLED=true`, legacy conversion. Health reports pending conversion phases/errors and cleanup charges. Expired upload grants retain their separate scheduled cleanup.
- Hub humans POST `/account/admin/...`. Agents POST `/v1/admin/...` with an admin token.
