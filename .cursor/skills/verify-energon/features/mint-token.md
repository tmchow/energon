# Mint a token

Mint a token lets a signed-in human create an `ee_live_` secret for agents, see it once, confirm it with `/v1/whoami`, and revoke it so further `/v1` calls get 401. The secret cannot be recovered later.

## Sub-features

- `token-mint` creates a labeled token and shows `export ENERGON_TOKEN=ee_live_…`.
- `token-whoami` accepts the secret and returns the owner email and label.
- `token-list` shows the last four characters, not the full secret, in `/account/data`.
- `token-revoke` disables the secret after typing the label to confirm.

## How to get to it (user POV)

- Open `/tokens`, fill `Label`, choose `Mint token`.
- Choose `Revoke`, type the exact label, confirm.
- Agent: send `Authorization: Bearer ee_live_…` to `/v1/whoami`.
- `POST /account/tokens` with `{ "label": "…" }` — the same endpoint the form uses.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- No token labeled `verify-run` exists, or use a unique label `verify-run-$RUN`.

- **Hub mint.** Open `$ORIGIN/tokens`. `#who` shows the doctor email. Fill the `Label` textbox with `verify-run` and choose `Mint token`. `#new-token` contains `export ENERGON_TOKEN=ee_live_` plus a secret. Status of the POST is 201. Body `recoverable` is false.
- **HTTP mint (same path).** Run `.cursor/skills/verify-energon/bin/mint-token verify-run`. The helper POSTs `/account/tokens` with `Origin` set to `$ORIGIN`. Stdout is `ee_live_` plus 32+ characters. Do not invent a substitute.
- **Whoami.** Run `curl -sS -o "$EVIDENCE/mint-token/whoami.json" -w '%{http_code}' "$ORIGIN/v1/whoami" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body `email` matches doctor; `label` is `verify-run`.
- **List hides secret.** Run `curl -sS "$ORIGIN/account/data"`. The `tokens` array has a row with `label` `verify-run`, `hint` matching `ee_live_…` plus last four of `$TOKEN`, `recoverable` false, and the raw `$TOKEN` string does not appear in the JSON.
- **No reveal.** `GET /account/tokens/{id}` is 404. The Tokens page has no Reveal control.
- **Unauthenticated /v1.** Run `curl -sS -o "$EVIDENCE/mint-token/noauth.json" -w '%{http_code}' "$ORIGIN/v1/sites"`. Status `401`. Body `error` is `unauthorized` and `message` mentions `/tokens` and `ENERGON_TOKEN`.
- **Revoke.** Choose `Revoke`. Dialog title `Revoke token`. Type `verify-run` into the field (custom validity is `Type the exact name.` on mismatch). Confirm. `GET /v1/whoami` with the old secret is 401.
- **Proof.** Save whoami JSON, account/data excerpt (redact nothing in evidence — this is a disposable local token), and a screenshot of `#new-token` on `/tokens`.

## Gotchas

- `/v1` cannot mint tokens. A passing whoami with a hand-typed secret is not a mint proof.
- Localhost does not require Access. Production hub minting needs a signed-in session; this skill does not drive production.
- Revoke confirmation matches the label, not the token id. Typing the id fails validation.
- After revoke, mint a new token before continuing other recipes. Do not keep using the revoked secret.
