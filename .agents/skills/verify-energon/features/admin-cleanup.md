# Admin cleanup

Operators listed in `ADMIN_EMAILS` retire old sites and loose files across every account from `/admin` and `POST /v1/admin/cleanup`, whether or not anyone set an expiry. The call is a dry run until the operator resends it with the `confirm` from its own preview. The safe default on someone else's content is `set_ttl` with `7d` so the owner's catalog shows Expires. Non-operators never see `/admin` and get `403 not_admin` from the route.

## Sub-features

- `admin-page` serves `/admin` only to an operator; anyone else gets the same `404` as an unknown path, with no Admin nav link.
- `admin-filters` send `q`, `owner`, `kind`, `expires=never`, `expires_before`, `updated_before`, `read_before`, and `min_size` into the preview. `scope` is refused.
- `admin-preview` shows owner, name, size, last written, last read, and expiry side by side (`#admin-preview-note`). `last_read_at` is a floor. The copy never says unread.
- `admin-confirm` executes only with the preview `confirm` (hub: type the eligible count in `#admin-confirm-dlg`).
- `admin-ttl-default` uses `set_ttl` `7d` on someone else's content; `expire` is `400 bad_action` when any eligible object is not the caller's.
- `admin-owner-catalog` is the owner's own hub or `GET /v1/sites` / `GET /v1/files` showing the new `expires_at` after execute.
- `admin-audit` records the execute on `/admin` (`#admin-audit`) and `GET /v1/admin/audit`.
- `admin-refusal` is `403 not_admin` for a non-operator token or hub POST, and `404` for `GET /admin`.

## How to get to it (user POV)

- Person: sign in as an address in `ADMIN_EMAILS`, open `/admin` (Admin in the page nav). Filters `#admin-q` `#admin-owner` `#admin-kind` `#admin-expires` `#admin-updated-before` `#admin-read-before` `#admin-expires-before` `#admin-min-size`. Action `#admin-action` (default Set expiry) and `#admin-ttl` (default `7d`). `#admin-preview`, then `#admin-confirm` and `#admin-confirm-dlg`. Audit is `#admin-audit`.
- Agent: mint an admin-scoped token at `/tokens` (`#mint-scope`). `POST /v1/admin/cleanup` without `confirm`, then the same body plus `confirm`. `GET /v1/admin/audit` lists executes. `GET /v1/whoami` `admin` is true.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/admin/cleanup` and `/v1/admin/audit`. `GET $ORIGIN/v1/help` `routes["POST /v1/admin/cleanup"]` names owner, read_before, and the 7d default.

## Driving it with energon-verify

Preconditions:

- Launch with `ENERGON_VERIFY_VARS="ADMIN_EMAILS:dev@example.com"` so the default identity (`$EMAIL`, usually `dev@example.com`) is an operator. Doctor has passed for `$ORIGIN`.
- The owner account is a second Access email on this host. Localhost accepts `Cf-Access-Authenticated-User-Email`. Use `owner@example.com` unless `$OWNER_EMAIL` is already set. Mint that account's token with the header; do not invent a token.
- `$TOKEN` from `bin/mint-token` is the default identity's account token. Mint a separate admin-scoped token for the operator `/v1` calls (see Fixtures).
- `$HANDLE` is the owner handle (email local-part, `owner` for `owner@example.com`).
- This local Energon keeps content forever by default, so the owner's fixture with no `ttl` has `expires_at` `null`.
- Every fixture name in this recipe starts with `vadmin` so `q` keeps other recipes out of the target.

- **Fixtures.** Set `OWNER_EMAIL=owner@example.com`. Run `curl -sS -o "$EVIDENCE/admin-cleanup/owner-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" -H "Cf-Access-Authenticated-User-Email: $OWNER_EMAIL" --data '{"label":"vadmin-owner"}'`. Status `201`. Record `token` as `$OWNER_TOKEN`. Run `curl -sS -o "$EVIDENCE/admin-cleanup/owner-site.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $OWNER_TOKEN" -H "content-type: application/json" --data '{"slug":"vadmin-keep"}'` (`201`). Record `id` as `$SITE_ID`. Then `curl -sS -o /dev/null -w '%{http_code}' -X PUT "$ORIGIN/v1/sites/$SITE_ID/files/index.md" -H "Authorization: Bearer $OWNER_TOKEN" -H "content-type: text/markdown" --data 'keep'` (`201`). `GET "$ORIGIN/v1/sites/$SITE_ID"` with `$OWNER_TOKEN` has `expires_at` `null`. Run `curl -sS -o "$EVIDENCE/admin-cleanup/admin-token.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"vadmin-ops","scope":"admin"}'`. Status `201`, `token` matches `ee_live_adm_`. Record it as `$ADMIN_TOKEN`. `GET "$ORIGIN/v1/whoami"` with `$ADMIN_TOKEN` has `admin` true. `GET "$ORIGIN/v1/whoami"` with `$OWNER_TOKEN` has `admin` false.
- **Refusal.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/denied-route.json" -w '%{http_code}' -X POST "$ORIGIN/v1/admin/cleanup" -H "Authorization: Bearer $OWNER_TOKEN" -H "content-type: application/json" --data '{"target":{"q":"vadmin"},"action":"set_ttl","ttl":"7d"}'`. Status `403`, `error` `not_admin`. Run `curl -sS -o "$EVIDENCE/admin-cleanup/denied-page.json" -D "$EVIDENCE/admin-cleanup/denied-page.headers" -w '%{http_code}' "$ORIGIN/admin" -H "Cf-Access-Authenticated-User-Email: $OWNER_EMAIL"`. Status `404`. Body is JSON `not_found`, not the Admin page. The owner's hub `GET "$ORIGIN/"` with that header has no `href="/admin"`.
- **Page.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/page.html" -w '%{http_code}' "$ORIGIN/admin"`. Status `200` as the default identity. HTML contains `Retire old work.`, `id="admin-q"`, `id="admin-owner"`, `id="admin-preview"`, `id="admin-sample"`, `id="admin-audit"`, `Last written`, `Last read`, and `href="/admin"`. It does not contain `unread`.
- **Preview.** Run `curl -sS -o "$EVIDENCE/admin-cleanup/preview.json" -w '%{http_code}' -X POST "$ORIGIN/v1/admin/cleanup" -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" --data "{\"target\":{\"owner\":\"$OWNER_EMAIL\",\"q\":\"vadmin-keep\",\"kind\":\"sites\"},\"action\":\"set_ttl\",\"ttl\":\"7d\"}"`. Status `200`. Body has `executed` `false`, `action` `set_ttl`, `ttl` `7d`, `eligible` `1`, `sample[0].owner` `$OWNER_EMAIL`, `sample[0].name` `vadmin-keep`, `sample[0].updated_at` set, `sample[0].last_read_at` `null`, `sample[0].expires_at` `null`, and a 32-character lowercase hex `confirm`. Record it as `$CONFIRM`. Re-GET the owner's site: `expires_at` is still `null`. Hub `#admin-preview` with `#admin-owner` `$OWNER_EMAIL` and `#admin-q` `vadmin-keep` shows the same columns.
- **Expire refused.** Run the same POST with `"action":"expire"` and no `ttl` or `confirm`, saving to `expire.json`. Status `400`, `error` `bad_action`. Site `expires_at` still `null`.
- **Scope refused.** POST `{"target":{"scope":"involved","owner":"$OWNER_EMAIL"},"action":"set_ttl","ttl":"7d"}` saving to `scope.json`. Status `400`, `error` `bad_target`.
- **Execute.** Resend the preview body with `"confirm":"$CONFIRM"`, saving to `execute.json`. Status `200`, `executed` `true`, `applied.total` `1`, `ttl` `7d`.
- **Owner catalog.** `GET "$ORIGIN/v1/sites/$SITE_ID"` with `$OWNER_TOKEN`: `expires_at` is about seven days ahead, `last_written_by` is still the owner. Hub `GET "$ORIGIN/"` with the owner Access header lists `vadmin-keep` with Expires set. `GET "$ORIGIN/v1/admin/audit"` with `$ADMIN_TOKEN` has an event whose `confirm` is `$CONFIRM`, `actor_email` is `$EMAIL`, `action` `cleanup`, and `target` has no password keys. `#admin-audit` on `/admin` shows that row.
- **Proof.** Save every status and body under `$EVIDENCE/admin-cleanup/`. Browser proof of `/admin` includes `#who` showing the operator email. The owner's catalog GET is the read-only second view of the new expiry.

## Gotchas

- Launch must set `ADMIN_EMAILS` to the default verify email. Without it, `/admin` is `404` and admin mint is `403`, which looks like a product bug.
- `bin/mint-token` mints an account token for the default identity. Admin `/v1` needs `scope: "admin"` at `POST /account/tokens`. Connect never grants that scope.
- The owner is a second Access header, not a second launch. Do not attach to port 8787. Do not invent a token for either account.
- `read_before` means no recorded read since that instant (`last_read_at` is null or earlier). A stamp from one second ago is not older than a cutoff in the past. Never call a null stamp unread.
- `expire` on someone else's content is `400` even as a preview. Use `set_ttl` `7d`.
- `{}` as the admin target selects every site and loose file on this Energon. Always narrow with `q` / `owner` / ids in this recipe so other content is not expired.
- Confirm is bound to action, ttl, and the eligible set. A second execute of the same confirm is `409 cleanup_drift`.
- A non-operator `GET /admin` is `404 JSON`, not hub HTML. Do not treat that as a missing route in `src/index.ts`.
