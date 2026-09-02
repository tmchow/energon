# Mint a token

Mint a token lets a signed-in human create an `ee_live_` secret for agents with a lifetime chosen at mint (default 3 months), see it once, confirm it with `/v1/whoami`, and revoke it so further `/v1` calls get 401. When the lifetime passes, `/v1` answers `401 token_expired` and the row stays listed as expired. The secret cannot be recovered later and a token cannot be renewed.

## Sub-features

- `token-mint` creates a labeled token and shows `export ENERGON_TOKEN=ee_live_…`.
- `token-lifetime` offers presets in `#mint-ttl` (`1 day` … `1 year`, default `3 months`, `Never` only when the instance allows it).
- `token-whoami` accepts the secret and returns the owner email, label, and `expires_at` (`null` = never).
- `token-list` shows the last four characters, not the full secret, plus `expires_at` and `expired` in `/account/data`; the Tokens page shows an `Expires` column.
- `token-expired` rejects a token past its lifetime with `401 token_expired`; the row is greyed on `/tokens` with only `Revoke`.
- `token-revoke` disables the secret after typing the label to confirm.

## How to get to it (user POV)

- Open `/tokens`, fill `Label`, pick a lifetime in `#mint-ttl`, choose `Mint token`.
- Choose `Revoke`, type the exact label, confirm.
- Agent: send `Authorization: Bearer ee_live_…` to `/v1/whoami`.
- `POST /account/tokens` with `{ "label": "…", "ttl": "7d" }` — the same endpoint the form uses; omit `ttl` for the default.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- No token labeled `verify-run` exists, or use a unique label `verify-run-$RUN`.

- **Hub mint.** Open `$ORIGIN/tokens`. `#who` shows the doctor email. `#mint-ttl` (`aria-label="Token lifetime"`) is preselected to `3 months` and ends with `Never`. Fill the `Label` textbox with `verify-run` and choose `Mint token`. `#new-token` contains `export ENERGON_TOKEN=ee_live_` plus a secret. Status of the POST is 201. Body `recoverable` is false and `expires_at` is about 90 days out. The new row's `Expires` cell shows a date and `(N days)`.
- **HTTP mint with a lifetime (same path).** Run `.cursor/skills/verify-energon/bin/mint-token verify-run 1d`. The helper POSTs `/account/tokens` with `Origin` set to `$ORIGIN` and `ttl` `1d`. Stdout is `ee_live_` plus 32+ characters; `state.env` gains `TOKEN_EXPIRES_AT` about one day out. Do not invent a substitute.
- **Bad lifetime.** Run `curl -sS -o "$EVIDENCE/mint-token/bad-ttl.json" -w '%{http_code}' -X POST "$ORIGIN/account/tokens" -H "content-type: application/json" -H "origin: $ORIGIN" --data '{"label":"verify-bad","ttl":"3h"}'`. Status `400`. Body `error` is `bad_ttl` and `message` lists `1d, 7d, 30d, 60d, 90d, 180d, 365d, never`.
- **Whoami.** Run `curl -sS -o "$EVIDENCE/mint-token/whoami.json" -w '%{http_code}' "$ORIGIN/v1/whoami" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body `email` matches doctor; `label` is `verify-run`; `expires_at` equals `TOKEN_EXPIRES_AT`.
- **List hides secret.** Run `curl -sS "$ORIGIN/account/data"`. The `tokens` array has a row with `label` `verify-run`, `hint` matching `ee_live_…` plus last four of `$TOKEN`, `recoverable` false, `expires_at` set, `expired` false, and the raw `$TOKEN` string does not appear in the JSON.
- **Expired token (fixture, then proof).** Mint a second token: `EXPIRED=$(.cursor/skills/verify-energon/bin/mint-token verify-expired 1d)`. Backdate it on **this run's** database only: `npx wrangler d1 execute energon --local --persist-to "$PERSIST" --command "UPDATE tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE label = 'verify-expired'"`. That command is setup, not proof. Then run `curl -sS -o "$EVIDENCE/mint-token/expired.json" -w '%{http_code}' "$ORIGIN/v1/whoami" -H "Authorization: Bearer $EXPIRED"`. Status `401`. Body `error` is `token_expired`; `message` contains `/tokens`, `cannot be extended`, and `Do not retry`; body has `expired_at` and `tokens_url`. Reload `$ORIGIN/tokens`: the `verify-expired` row is greyed (`tr.row-expired`), its `Expires` cell reads `Expired`, and its only action is `Revoke`.
- **No reveal.** `GET /account/tokens/{id}` is 404. The Tokens page has no Reveal control.
- **Unauthenticated /v1.** Run `curl -sS -o "$EVIDENCE/mint-token/noauth.json" -w '%{http_code}' "$ORIGIN/v1/sites"`. Status `401`. Body `error` is `unauthorized` and `message` mentions `/tokens` and `ENERGON_TOKEN`.
- **Revoke.** Choose `Revoke`. Dialog title `Revoke token`. Type `verify-run` into the field (custom validity is `Type the exact name.` on mismatch). Confirm. `GET /v1/whoami` with the old secret is 401.
- **Proof.** Save whoami JSON, bad-ttl JSON, expired JSON, account/data excerpt (redact nothing in evidence — this is a disposable local token), and screenshots of `#new-token` and the greyed `verify-expired` row on `/tokens`.

## Gotchas

- `/v1` cannot mint tokens. A passing whoami with a hand-typed secret is not a mint proof.
- Localhost does not require Access. Production hub minting needs a signed-in session; this skill does not drive production.
- Revoke confirmation matches the label, not the token id. Typing the id fails validation.
- After revoke, mint a new token before continuing other recipes. Do not keep using the revoked secret.
- There is no seconds preset, so expiry proof needs the backdate step against `$PERSIST`. Never run that `d1 execute` against `.wrangler/state` or a remote database.
- `token_expired` is distinct from `unauthorized`. A revoked token that is also expired reports `unauthorized`; only a live-but-expired token reports `token_expired`.
- `ALLOW_UNLIMITED_TOKENS=false` removes `Never` from `#mint-ttl` and makes `ttl: never` a `400 bad_ttl`; the default `wrangler.toml` allows it, so `Never` is present on a normal run.
