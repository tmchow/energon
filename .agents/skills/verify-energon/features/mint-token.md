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

- `bin/up` (or doctor + ready) has passed for `$ORIGIN`. `$TOKEN` is already in `state.env` (label `verify-run`). Do not mint a second `verify-run`.

- **Default — HTTP mint.** Run `.agents/skills/verify-energon/bin/mint-token verify-mint 1d`. Stdout is `ee_live_` plus 32+ characters. Capture it as `$MINT` (do not overwrite `$TOKEN`). Do not invent a substitute.
- **Default — Bad lifetime.** `.agents/skills/verify-energon/bin/save --expect 400 mint-token bad-ttl POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"verify-bad","ttl":"3h"}'`. Body `error` is `bad_ttl` and `message` lists `1d, 7d, 30d, 60d, 90d, 180d, 365d, never`.
- **Default — Whoami.** `.agents/skills/verify-energon/bin/save --expect 200 mint-token whoami GET "$ORIGIN/v1/whoami" -H "Authorization: Bearer $TOKEN"`. Body `email` matches doctor; `label` is `verify-run`.
- **Default — Self revoke.** `DONE=$(.agents/skills/verify-energon/bin/mint-token verify-done)`. `.agents/skills/verify-energon/bin/save --expect 200 mint-token self-revoke DELETE "$ORIGIN/v1/whoami" -H "Authorization: Bearer $DONE"`. Body is `{ "ok": true, "revoked": true, "label": "verify-done" }`. Then `GET /v1/whoami` with `$DONE` is `401` `unauthorized`; `GET /v1/whoami` with `$TOKEN` is still `200`.
- **Default — List hides secret.** `GET $ORIGIN/account/data`. The `tokens` array has `label` `verify-run`, a `hint` with last four of `$TOKEN`, `recoverable` false, and the raw `$TOKEN` string does not appear.
- **Default — No reveal / unauth.** `GET /account/tokens/{id}` is 404. `GET $ORIGIN/v1/sites` with no Bearer is `401` `unauthorized` and names `/tokens` and `ENERGON_TOKEN`.
- **Extra (token-expired) — Expired token.** Mint `EXPIRED=$(.agents/skills/verify-energon/bin/mint-token verify-expired 1d)`. Backdate **this run's** DB only: `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE label = 'verify-expired'"`. That SQL is setup, not proof. `GET /v1/whoami` with `$EXPIRED` is `401` `token_expired`. Drive when expiry copy or `token_expired` changes.
- **Extra (token-never-disabled) — Never disabled (second wrangler).** Never disable the running session. `ENERGON_VERIFY_RUN=$ENERGON_VERIFY_RUN-strict ENERGON_VERIFY_PORT=18788 ENERGON_VERIFY_VARS="ALLOW_UNLIMITED_TOKENS:false" .agents/skills/verify-energon/bin/up`. Against that origin: `tokens.allow_never` false; `ttl: never` is `400 bad_ttl`; omit `ttl` is `201` with `expires_at`. Cleanup the strict run and return. Drive when `ALLOW_UNLIMITED_TOKENS` or presets change.
- **Extra (token-revoke / Tokens.svelte) — Hub mint and revoke.** Open `$ORIGIN/tokens`. `#mint-ttl` is preselected to `3 months`. Mint from the form, then Revoke by typing the exact label. Drive when Tokens.svelte changes.
- **Extra (token-stale / token-bulk-revoke) — Stale and bulk.** Mint `verify-stale`, backdate `created_at` (and `last_used_at`) on `$PERSIST`. `POST /account/tokens/revoke` `{"target":"stale"}` then `{"target":"all"}` with drift (`409 token_revoke_drift`). Drive when stale/bulk revoke changes.
- **Proof.** Default: whoami, self-revoke, bad-ttl, account/data excerpt. Screenshots only for Extra hub.

## Gotchas

- `/v1` cannot mint tokens. A passing whoami with a hand-typed secret is not a mint proof.
- `DELETE /v1/whoami` is the only token mutation on `/v1`, and it acts on the bearer token alone. There is no `/v1/tokens`; a request to revoke another token belongs on `/tokens` or `POST /account/tokens/revoke`.
- Localhost does not require Access. Production hub minting needs a signed-in session; this skill does not drive production.
- Revoke confirmation matches the label, not the token id. Typing the id fails validation. Bulk confirmation matches the count as `N tokens` (`1 token` for one), not a label.
- Calling `/v1` with a token bumps its `last_used_at`, so a `whoami` check after the stale fixture makes it live again and the stale preview drifts. Prove the token works before backdating, or backdate `last_used_at` too.
- After revoke of the session token, mint a replacement with `ENERGON_VERIFY_SAVE_TOKEN=1` before continuing other recipes. Extra labels (`verify-done`, `verify-mint`) print a secret and do not overwrite `TOKEN=` in `state.env`.
- `bin/up` / `bin/ready` already mint `verify-run`. Default mint-token must not mint a second `verify-run`; use `verify-mint` / `verify-done` for extra labels.
- There is no seconds preset, so expiry proof needs the backdate step against `$PERSIST`. Never run that `d1 execute` against `.wrangler/state` or a remote database.
- `token_expired` is distinct from `unauthorized`. A revoked token that is also expired reports `unauthorized`; only a live-but-expired token reports `token_expired`.
- The primary run uses the committed `wrangler.toml`, which allows Never. Do not report the strict branch as verified from the primary run; it needs the second run with `ENERGON_VERIFY_VARS`.
- The strict run shares nothing with the primary one (own port, own persist). Tokens minted on one do not authenticate on the other.
