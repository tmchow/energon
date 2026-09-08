# Admin cleanup

Operators listed on `ADMIN_EMAILS` retire old sites and loose files across every account, including work nobody set a TTL on. The hub page is `/admin`. Agents use `POST /v1/admin/cleanup` with an admin token. The same preview, confirm hash, skip reporting, and 100-object cap as `/v1/cleanup` apply, without involvement scope. The safe default is `set_ttl` (7 days when `ttl` is omitted) so the owner sees Expires. Delete is explicit. `expire` on anyone else's content is refused.

## Sub-features

- `admin-nav` shows `Admin` in `aria-label="Pages"` only when the signed-in email is on `ADMIN_EMAILS`; other people never see the link or the page.
- `admin-page` is `GET /admin` for those operators: `#admin-filters`, `#admin-owner`, `#admin-last-read`, `#admin-action`, `#admin-preview`, `#admin-sample` after a preview, `#admin-confirm`, `#admin-dlg`, `#admin-audit`.
- `admin-preview` POSTs `/account/admin/cleanup` (hub) or `/v1/admin/cleanup` (admin token) without `confirm` and returns `executed: false`, `sample` with owner, name, size, last written, last read, and expiry, and a 32-hex `confirm`.
- `admin-execute` resends that body with `confirm` and returns `executed: true`; the owner's own catalog then shows the new expiry.
- `admin-refuse` is `403 forbidden_admin` for a non-admin on `GET /admin`, `POST /account/admin/cleanup`, `GET /account/admin/audit`, `POST /v1/admin/cleanup`, and `GET /v1/admin/audit`.
- `admin-expire-not-own` is `400 expire_not_own` when `action` is `expire` and any eligible object belongs to someone else. On `/admin` the `Expire soon` button appears in `#admin-action` only while `#admin-owner` equals the operator's own handle (case-insensitive); otherwise the group offers `Set expiry` and `Delete` and a pending `expire` choice falls back to `Set expiry`.
- `admin-last-read` is a floor: edge-cached public reads do not reach the Worker, so the preview `Last read` cell shows `No recorded read` (never `Never`) and the `#admin-last-read` note says reads lag up to about a day.
- `admin-audit` lists recorded previews and executes at `GET /v1/admin/audit` and `GET /account/admin/audit` (who, token hint, action, filters, counts, when). Never bytes or secrets.

## How to get to it (user POV)

- Operator, hub: open `/admin` (nav `Admin` after Stats). Fill filters, choose `Preview`, read the table, type the eligible count in `#admin-dlg`, confirm.
- Operator, agent: mint `scope: admin` at `/tokens`, then `POST /v1/admin/cleanup` with `{ "target", "action" }` to preview and the same body plus `confirm` to execute. `GET /v1/admin/audit` lists the record.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/cleanup` and `/v1/admin/audit`; `GET $ORIGIN/v1/help` `routes` names both.
- A person not on `ADMIN_EMAILS` has no Admin nav control. Their `/admin` request is `403`.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- `bin/up` passed.
- Owner identity for this recipe is `vadmin-owner@example.com` (sent as `Cf-Access-Authenticated-User-Email`). Handle is `vadmin-owner`.
- Every fixture name starts with `vadmin` so `q` keeps other recipes out of the target.

- **Default — Non-admin never sees it.** `GET $ORIGIN/admin` with `-H "Cf-Access-Authenticated-User-Email: vadmin-owner@example.com"` is `403 forbidden_admin`.
- **Default — Owner fixture.** `POST /account/tokens` with that Access header, `origin: $ORIGIN`, `{"label":"vadmin-owner"}`. With `$OWNER_TOKEN`, `POST /v1/files` `X-Filename: vadmin-old.md` `X-Energon-Write-Policy: owner` body `keep-me`. `expires_at` null. Record `$FILE_ID` `$OWNER_HANDLE`.
- **Default — Account token 403 / admin token.** `bin/mint-token vadmin-account` on `POST /v1/admin/cleanup` is `403`. Admin mint `{"label":"vadmin-ops","ttl":"1d","scope":"admin"}`. `GET /v1/whoami` has `admin` true.
- **Default — Expire refused / preview / execute / audit.** `action: expire` on `$FILE_ID` is `400 expire_not_own`. Preview `set_ttl` with `owner` + `q=vadmin-old` + `expires=never`: `executed` false, `ttl` `7d`, `eligible` `1`, no `keep-me`. Owner list still `expires_at` null. Execute with `confirm`: `applied.total` `1`. Owner `GET /v1/files?q=vadmin-old` shows `expires_at`. `GET /v1/admin/audit` has preview and executed events; neither contains `$ADMIN_TOKEN` or `keep-me`.
- **Extra (admin-page / Admin.svelte) — Hub preview.** Open `/admin`, fill `#admin-owner`, Preview, Expire soon only when owner is the operator handle. Drive when Admin.svelte cleanup UI changes.
- **Proof.** Default: 403, expire-not-own, preview, execute, owner list, audit JSON. Screenshots only for Extra hub.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email. `.dev.vars` `DEV_ACCESS_EMAIL` wins over the launch default `dev@example.com`; a mismatch makes `/admin` `403` for the doctor.
- `bin/mint-token` mints an account token. Admin scope is `POST /account/tokens` with `"scope":"admin"` and `ttl` `1d` or `7d`. Connect never grants it.
- `set_ttl` without `ttl` is 7 days. Sending `ttl` with `expire` or `delete` is `400 bad_action`.
- `expire` on anyone else's content is `400 expire_not_own` even in preview. Use `set_ttl` (default) or explicit `delete`.
- `target.scope` is `400 bad_target`. Filter with `owner` (handle) instead. `{}` selects every site and file on this Energon, capped at 100 eligible.
- Admin responses never include published bytes, share passwords, or write passwords. A body that contains the file contents is a product bug.
- The owner second view is their own `/v1/files` or hub catalog, not the admin sample. Catalog Expires is blank when the work does not expire; after execute it shows a date.
- Hub humans POST `/account/admin/cleanup` (Access). Agents POST `/v1/admin/cleanup` with an admin token. Do not drive `/v1/admin/cleanup` with a session cookie and no Bearer token.
