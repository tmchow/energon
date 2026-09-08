# Mint a token

Mint a token lets a signed-in human create an `ee_live_` secret for agents with a lifetime chosen at mint (default 3 months), see it once, confirm it with `/v1/whoami`, and revoke it so further `/v1` calls get 401. When the lifetime passes, `/v1` answers `401 token_expired` and the row stays listed as expired. The secret cannot be recovered later and a token cannot be renewed.

## Sub-features

- `token-admin` lets an address on `ADMIN_EMAILS` mint `scope: admin` from `#mint-scope` (1 or 7 days, no never). The secret still starts with `ee_live_`; the hint is `ee_live_admin…` plus last four. Connect never grants admin. `GET /v1/whoami` has `scope` and `admin`. A person not on the list gets `403 forbidden_admin`.
- `token-lifetime` offers presets in `#mint-ttl` (`1 day` … `1 year`, default `3 months`, `Never` only when this Energon allows it).
- `token-whoami` accepts the secret and returns the owner email, label, and `expires_at` (`null` = never).
- `token-self-revoke` lets an agent revoke its own token with `DELETE /v1/whoami`; the same secret is `401 unauthorized` afterwards, other tokens are untouched, and `/v1` has no route to list or revoke another token.
- `token-list` shows the last four characters, not the full secret, plus `expires_at` and `expired` in `/account/data`; the Tokens page shows an `Expires` column.
- `token-expired` rejects a token past its lifetime with `401 token_expired`; the row is greyed on `/tokens` with only `Revoke`.
- `token-never-disabled` removes `Never` from the menu and rejects `ttl: never` when this Energon sets `ALLOW_UNLIMITED_TOKENS=false`; tokens minted earlier keep working.
- `token-revoke` disables the secret after typing the label to confirm.
- `token-stale` marks a token unused for 30 days (never used counts from mint) with a `Stale` badge and `status: "stale"` in `/account/data`; `#tokens-show` filters `Live` (default, hides expired and revoked), `Stale`, and `All`.
- `token-bulk-revoke` revokes every stale token or every token on the account from `#revoke-stale` / `#revoke-all`: `POST /account/tokens/revoke` previews first (`matched`, `sample`, `confirm`), the dialog wants `N tokens` typed, and the same body plus `confirm` executes; a changed selection is `409 token_revoke_drift`.

## How to get to it (user POV)

- Open `/tokens`. The `Tokens` card lists tokens first; the `Mint a token by hand` card below it holds the form. Fill `Label`, pick a lifetime in `#mint-ttl`, choose `Mint token`. Admins also see `#mint-scope` (`aria-label="Token authority"`) with Account (default) and Admin.
- Choose `Revoke`, type the exact label, confirm.
- Switch `#tokens-show` to `Stale` or `All`; choose `Revoke stale` or `Revoke all`, read the listed labels, type `N tokens`, confirm.
- `POST /account/tokens/revoke` with `{ "target": "stale" | "all" }` to preview, then again with `"confirm"` from that preview — the same endpoint the buttons use.
- Agent: send `Authorization: Bearer ee_live_…` to `/v1/whoami`.
- Agent, when its task is done: `DELETE /v1/whoami` with the same header.
- `POST /account/tokens` with `{ "label": "…", "ttl": "7d" }` — the same endpoint the form uses; omit `ttl` for the default. Admins may send `"scope": "admin"`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- No token labeled `verify-run` exists, or use a unique label `verify-run-$RUN`.

- **Hub mint.** Open `$ORIGIN/tokens`. `#who` shows the doctor email. The lede says agents provision their own token from Setup and links `/setup`; the `Tokens` card precedes the `Mint a token by hand` card. `#mint-ttl` (`aria-label="Token lifetime"`) is preselected to `3 months` and ends with `Never`. Fill the `Label` textbox with `verify-run` and choose `Mint token`. `#new-token` contains `export ENERGON_TOKEN=ee_live_` plus a secret. Status of the POST is 201. Body `recoverable` is false and `expires_at` is about 90 days out. The new row's `Expires` cell shows a date and `(N days)`.
- **HTTP mint with a lifetime (same path).** Run `.agents/skills/verify-energon/bin/mint-token verify-run 1d`. The helper POSTs `/account/tokens` with `Origin` set to `$ORIGIN` and `ttl` `1d`. Stdout is `ee_live_` plus 32+ characters; `state.env` gains `TOKEN_EXPIRES_AT` about one day out. Do not invent a substitute.
- **Bad lifetime.** Run `curl -sS -o "$EVIDENCE/mint-token/bad-ttl.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"verify-bad","ttl":"3h"}'`. Status `400`. Body `error` is `bad_ttl` and `message` lists `1d, 7d, 30d, 60d, 90d, 180d, 365d, never`.
- **Whoami.** Run `curl -sS -o "$EVIDENCE/mint-token/whoami.json" -w '%{http_code}' "$ORIGIN/v1/whoami" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body `email` matches doctor; `label` is `verify-run`; `expires_at` equals `TOKEN_EXPIRES_AT`.
- **Self revoke.** Mint a disposable token: `DONE=$(.agents/skills/verify-energon/bin/mint-token verify-done)`. Run `curl -sS -o "$EVIDENCE/mint-token/self-revoke.json" -w '%{http_code}' -X DELETE "$ORIGIN/v1/whoami" -H "Authorization: Bearer $DONE"`. Status `200`; body is `{ "ok": true, "revoked": true, "label": "verify-done" }`. Then `GET /v1/whoami` with `$DONE` is `401` with `error` `unauthorized`, `GET /v1/whoami` with `$TOKEN` is still `200`, and `GET /account/data` lists `verify-done` with `status` `revoked` (visible on `/tokens` only under `All`, as `Revoked`). `GET /v1/help` `routes` has `DELETE /v1/whoami`, and `GET /v1/openapi.json` has `paths["/v1/whoami"].delete.operationId` `revokeSelf`.
- **List hides secret.** Run `curl -sS "$ORIGIN/account/data"`. The `tokens` array has a row with `label` `verify-run`, `hint` matching `ee_live_…` plus last four of `$TOKEN`, `recoverable` false, `expires_at` set, `expired` false, and the raw `$TOKEN` string does not appear in the JSON.
- **Expired token (fixture, then proof).** Mint a second token: `EXPIRED=$(.agents/skills/verify-energon/bin/mint-token verify-expired 1d)`. Backdate it on **this run's** database only: `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE label = 'verify-expired'"`. That command is setup, not proof. Then run `curl -sS -o "$EVIDENCE/mint-token/expired.json" -w '%{http_code}' "$ORIGIN/v1/whoami" -H "Authorization: Bearer $EXPIRED"`. Status `401`. Body `error` is `token_expired`; `message` contains `/tokens`, `cannot be extended`, and `Do not retry`; body has `expired_at` and `tokens_url`. Reload `$ORIGIN/tokens`: the `verify-expired` row is greyed (`tr.row-expired`), its `Expires` cell reads `Expired`, and its only action is `Revoke`.
- **No reveal.** `GET /account/tokens/{id}` is 404. The Tokens page has no Reveal control.
- **Unauthenticated /v1.** Run `curl -sS -o "$EVIDENCE/mint-token/noauth.json" -w '%{http_code}' "$ORIGIN/v1/sites"`. Status `401`. Body `error` is `unauthorized` and `message` mentions `/tokens` and `ENERGON_TOKEN`.
- **Never disabled (second run).** Launch a strict Energon beside this one: `ENERGON_VERIFY_RUN=$ENERGON_VERIFY_RUN-strict ENERGON_VERIFY_PORT=18788 ENERGON_VERIFY_VARS="ALLOW_UNLIMITED_TOKENS:false" .agents/skills/verify-energon/bin/launch`, then `ENERGON_VERIFY_RUN=$ENERGON_VERIFY_RUN-strict .agents/skills/verify-energon/bin/doctor`. Against `http://127.0.0.1:18788`: `GET /v1/help` has `tokens.allow_never` false and `tokens.presets` ending in `365d` with no `never`; `POST /account/tokens` with `{"label":"verify-strict","ttl":"never"}` and `Origin: http://127.0.0.1:18788` is `400 bad_ttl` and the message does not contain `never`; the same POST with `ttl` omitted is `201` with `expires_at` about 90 days out; on `/tokens`, `#mint-ttl` has no `Never` option and `#mint-ttl-note` says this Energon does not allow never-expiring tokens. Save `help.json`, `never-400.json`, and `default-201.json` under `$EVIDENCE/mint-token/strict/`. Run `ENERGON_VERIFY_RUN=$ENERGON_VERIFY_RUN-strict .agents/skills/verify-energon/bin/cleanup` when done and return to the primary run.
- **Revoke.** Choose `Revoke`. Dialog title `Revoke token`. Type `verify-run` into the field (custom validity is `Type the exact name.` on mismatch). Confirm. `GET /v1/whoami` with the old secret is 401.
- **Stale at a glance (fixture, then proof).** Mint `STALE=$(.agents/skills/verify-energon/bin/mint-token verify-stale)` and backdate it on **this run's** database only: `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE tokens SET created_at = '2000-01-01T00:00:00.000Z' WHERE label = 'verify-stale'"`. Reload `$ORIGIN/tokens`: the `verify-stale` row shows a `Stale` badge in `Last used`, `#tokens-show` reads `Stale (1)`, and choosing `Stale` lists only that row. `GET /account/data` has that row with `status` `stale`. Choosing `All` also lists `verify-expired` (`Expired`) and any revoked rows (`Revoked`, no `Revoke` button); `Live` hides both.
- **Bulk revoke stale.** Run `curl -sS -o "$EVIDENCE/mint-token/bulk-stale-preview.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens/revoke" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"target":"stale"}'`. Status `200`; body `executed` false, `matched` 1, `sample[0].label` `verify-stale`, `confirm` 32 hex characters. In the hub choose `Revoke stale`: `#bulk-dlg` title `Revoke stale tokens`, message names `verify-stale`, typing `1 token` enables `Revoke`. Confirm. `#messages` shows `Revoked 1 token.`; `GET /v1/whoami` with `$STALE` is `401`; the row now appears only under `All` as `Revoked`.
- **Bulk revoke all with drift.** Preview `{"target":"all"}` to `$EVIDENCE/mint-token/bulk-all-preview.json` (`200`, `matched` counts every non-revoked token). Mint one more token, then resend `{"target":"all","confirm":"<that confirm>"}`: status `409`, `error` `token_revoke_drift`, body carries a fresh `matched` and `confirm`. Resend with the fresh confirm: `200`, `executed` true, `revoked` equals that `matched`. Every prior token is `401` on `/v1/whoami`; `#tokens-show` reads `Live (0)`, and `Revoke all` is disabled.
- **Proof.** Save whoami JSON, self-revoke JSON, bad-ttl JSON, expired JSON, the bulk preview and drift JSON, account/data excerpt (redact nothing in evidence — this is a disposable local token), and screenshots of `#new-token`, the greyed `verify-expired` row, the `Stale` badge, and `#bulk-dlg` on `/tokens`.

## Gotchas

- `/v1` cannot mint tokens. A passing whoami with a hand-typed secret is not a mint proof.
- `DELETE /v1/whoami` is the only token mutation on `/v1`, and it acts on the bearer token alone. There is no `/v1/tokens`; a request to revoke another token belongs on `/tokens` or `POST /account/tokens/revoke`.
- Localhost does not require Access. Production hub minting needs a signed-in session; this skill does not drive production.
- Revoke confirmation matches the label, not the token id. Typing the id fails validation. Bulk confirmation matches the count as `N tokens` (`1 token` for one), not a label.
- Calling `/v1` with a token bumps its `last_used_at`, so a `whoami` check after the stale fixture makes it live again and the stale preview drifts. Prove the token works before backdating, or backdate `last_used_at` too.
- After revoke, mint a new token before continuing other recipes. Do not keep using the revoked secret.
- There is no seconds preset, so expiry proof needs the backdate step against `$PERSIST`. Never run that `d1 execute` against `.wrangler/state` or a remote database.
- `token_expired` is distinct from `unauthorized`. A revoked token that is also expired reports `unauthorized`; only a live-but-expired token reports `token_expired`.
- The primary run uses the committed `wrangler.toml`, which allows Never. Do not report the strict branch as verified from the primary run; it needs the second run with `ENERGON_VERIFY_VARS`.
- The strict run shares nothing with the primary one (own port, own persist). Tokens minted on one do not authenticate on the other.
