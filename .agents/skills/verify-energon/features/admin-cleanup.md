# Admin cleanup

Operators listed on `ADMIN_EMAILS` retire old sites and loose files across every account, including work nobody set a TTL on. The hub page is `/admin`. Agents use `POST /v1/admin/cleanup` with an admin token. The same preview, confirm hash, skip reporting, and 100-object cap as `/v1/cleanup` apply, without involvement scope. The safe default is `set_ttl` (7 days when `ttl` is omitted) so the owner sees Expires. Delete is explicit. `expire` on anyone else's content is refused.

## Sub-features

- `admin-nav` shows `Admin` in `aria-label="Pages"` only when the signed-in email is on `ADMIN_EMAILS`; other people never see the link or the page.
- `admin-page` is `GET /admin` for those operators: `#admin-filters`, `#admin-owner`, `#admin-last-read`, `#admin-action`, `#admin-preview`, `#admin-sample` after a preview, `#admin-confirm`, `#admin-dlg`, `#admin-audit`.
- `admin-preview` POSTs `/account/admin/cleanup` (hub) or `/v1/admin/cleanup` (admin token) without `confirm` and returns `executed: false`, `sample` with owner, name, size, last written, last read, and expiry, and a 32-hex `confirm`.
- `admin-execute` resends that body with `confirm` and returns `executed: true`; the owner's own catalog then shows the new expiry.
- `admin-refuse` is `403 forbidden_admin` for a non-admin on `GET /admin`, `POST /account/admin/cleanup`, `GET /account/admin/audit`, `POST /v1/admin/cleanup`, and `GET /v1/admin/audit`.
- `admin-expire-not-own` is `400 expire_not_own` when `action` is `expire` and any eligible object belongs to someone else.
- `admin-audit` lists recorded previews and executes at `GET /v1/admin/audit` and `GET /account/admin/audit` (who, token hint, action, filters, counts, when). Never bytes or secrets.

## How to get to it (user POV)

- Operator, hub: open `/admin` (nav `Admin` after Stats). Fill filters, choose `Preview`, read the table, type the eligible count in `#admin-dlg`, confirm.
- Operator, agent: mint `scope: admin` at `/tokens`, then `POST /v1/admin/cleanup` with `{ "target", "action" }` to preview and the same body plus `confirm` to execute. `GET /v1/admin/audit` lists the record.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/cleanup` and `/v1/admin/audit`; `GET $ORIGIN/v1/help` `routes` names both.
- A person not on `ADMIN_EMAILS` has no Admin nav control. Their `/admin` request is `403`.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL"` so the doctor identity is an operator. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- Doctor has passed for `$ORIGIN`.
- Owner identity for this recipe is `vadmin-owner@example.com` (sent as `Cf-Access-Authenticated-User-Email`). Handle is `vadmin-owner`.
- Every fixture name starts with `vadmin` so `q` keeps other recipes out of the target.

- **Operator hub.** Open `$ORIGIN/`. `#who` is the doctor email. Nav `aria-label="Pages"` includes `Admin` after Stats. Open `$ORIGIN/admin`. `#who` still matches. `#admin-owner`, `#admin-last-read`, `#admin-action` (`aria-label="Cleanup action"`), `#admin-preview`, and `#admin-audit` are present. Save a screenshot of `/admin` with Energon and `#who` visible.
- **Non-admin never sees it.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/no-admin-page.json" -w '%{http_code}' "$ORIGIN/admin" -H "Cf-Access-Authenticated-User-Email: vadmin-owner@example.com"`. Status `403`, body `error` `forbidden_admin`. `GET "$ORIGIN/"` with that same header has no `href="/admin"` in the nav. Save the hub HTML excerpt.
- **Owner fixture, no expiry.** Mint an owner token: `curl -sS -o "$EVIDENCE/admin-cleanup/owner-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" -H "Cf-Access-Authenticated-User-Email: vadmin-owner@example.com" --data '{"label":"vadmin-owner"}'` (`201`). Record `token` as `$OWNER_TOKEN`. Run `curl -sS -o "$EVIDENCE/admin-cleanup/owner-file.json" -w '%{http_code}' -X POST "$ORIGIN/v1/files" -H "Authorization: Bearer $OWNER_TOKEN" -H "X-Filename: vadmin-old.md" -H "content-type: text/plain" -H "X-Energon-Write-Policy: owner" --data 'keep-me'` (`201`). Body `expires_at` is `null`. Record `id` as `$FILE_ID` and `handle` as `$OWNER_HANDLE`.
- **Non-admin route.** Mint a doctor *account* token with `.agents/skills/verify-energon/bin/mint-token vadmin-account` (no `scope`). `POST "$ORIGIN/v1/admin/cleanup"` with that secret and `{"target":{"owner":"$OWNER_HANDLE","q":"vadmin-old"},"action":"set_ttl"}` is `403 forbidden_admin`. Save as `account-token-403.json`.
- **Admin token.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vadmin-ops","ttl":"1d","scope":"admin"}'` (`201`). Body `scope` is `admin`. Record `token` as `$ADMIN_TOKEN`. `GET "$ORIGIN/v1/whoami"` with it has `admin` true.
- **Expire refused.** `POST "$ORIGIN/v1/admin/cleanup"` with `$ADMIN_TOKEN` and `{"target":{"files":["$FILE_ID"]},"action":"expire"}` is `400`, `error` `expire_not_own`. Save as `expire-not-own.json`.
- **Preview.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/preview.json" -w '%{http_code}' -X POST "$ORIGIN/v1/admin/cleanup" -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data "{\"target\":{\"owner\":\"$OWNER_HANDLE\",\"q\":\"vadmin-old\",\"expires\":\"never\"},\"action\":\"set_ttl\"}"`. Status `200`. Body `executed` false, `action` `set_ttl`, `ttl` `7d`, `eligible` `1`, `sample[0]` has `name` `vadmin-old.md`, `owner` `$OWNER_HANDLE`, `last_read_at` null. Body does not contain `keep-me`. Record `confirm` as `$CONFIRM`. Owner list still has `expires_at` null: `GET "$ORIGIN/v1/files?q=vadmin-old" -H "Authorization: Bearer $OWNER_TOKEN"`.
- **Hub preview.** Open `/admin`, fill `#admin-owner` with `$OWNER_HANDLE`, `#admin-q` with `vadmin-old`, set expiry filter to Never expires, choose Preview. `#admin-sample` names `vadmin-old.md` and the owner handle. Save a screenshot.
- **Execute.** Resend the preview POST with `"confirm":"$CONFIRM"`, saving to `execute.json`. Status `200`, `executed` true, `applied.total` `1`, `expires_at` about 7 days ahead. Second view: `GET "$ORIGIN/v1/files?q=vadmin-old"` with `$OWNER_TOKEN` shows that `expires_at`. On the owner's hub `/?q=vadmin-old` (Access header `vadmin-owner@example.com`) the catalog Expires cell is a date, not blank.
- **Audit.** `GET "$ORIGIN/v1/admin/audit" -H "Authorization: Bearer $ADMIN_TOKEN"` is `200` with a preview event and an executed event. Reload `/admin`: `#admin-audit` lists them. Neither body contains `$ADMIN_TOKEN` or `keep-me`.
- **Proof.** Save every status and body under `$EVIDENCE/admin-cleanup/`, plus screenshots of `/admin` (operator), the preview table, the owner's catalog Expires, and the non-admin hub without Admin in the nav.

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email. `.dev.vars` `DEV_ACCESS_EMAIL` wins over the launch default `dev@example.com`; a mismatch makes `/admin` `403` for the doctor.
- `bin/mint-token` mints an account token. Admin scope is `POST /account/tokens` with `"scope":"admin"` and `ttl` `1d` or `7d`. Connect never grants it.
- `set_ttl` without `ttl` is 7 days. Sending `ttl` with `expire` or `delete` is `400 bad_action`.
- `expire` on anyone else's content is `400 expire_not_own` even in preview. Use `set_ttl` (default) or explicit `delete`.
- `target.scope` is `400 bad_target`. Filter with `owner` (handle) instead. `{}` selects every site and file on this Energon, capped at 100 eligible.
- Admin responses never include published bytes, share passwords, or write passwords. A body that contains the file contents is a product bug.
- The owner second view is their own `/v1/files` or hub catalog, not the admin sample. Catalog Expires is blank when the work does not expire; after execute it shows a date.
- Hub humans POST `/account/admin/cleanup` (Access). Agents POST `/v1/admin/cleanup` with an admin token. Do not drive `/v1/admin/cleanup` with a session cookie and no Bearer token.
