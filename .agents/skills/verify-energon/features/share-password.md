# Share password

Share password lets a user lock a public site or file URL behind a phrase. Browsers get a form. Agents send `X-Energon-Password`. Token GETs on `/v1` skip the password. Energon stores a hash and never returns the phrase on GET.

## Sub-features

- `pw-set` sets a password on create or via PATCH / hub lock control.
- `pw-gate` serves a password form (HTML) or `password_required` (JSON) without the phrase.
- `pw-header` unlocks the public URL with `X-Energon-Password`.
- `pw-form` unlocks in the browser by submitting the gate form.
- `pw-v1-skip` reads bytes with a token and no password header.
- `pw-clear` removes the password so the public URL is open again.
- `pw-wrong` rejects a bad phrase and does not leak the hash.

## How to get to it (user POV)

- Hub stage: fill `Optional password` (or generate with `Generate a readable password`) before `Publish`.
- Hub catalog: lock mark `Set view password` / `View password`, or More actions `Set password` / `Change or remove password`.
- API: `"password"` on `POST /v1/sites` or `PATCH /v1/sites/{slug}`; `X-Energon-Set-Password` on `POST`/`PUT /v1/files`.
- Open the public URL; submit the form, or retry with header `X-Energon-Password`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed. `TOKEN` minted. `$HANDLE` known.
- Phrase to use: `correct-horse`. Do not reuse a production password.

- **Create protected site.** Run `curl -sS -o "$EVIDENCE/share-password/create.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-gated","password":"correct-horse"}'`. Status `201`. Body `password` is `correct-horse` (echo of what you set). `password_protected` is true. GET of that JSON later must not be used as proof the phrase is stored — only this write response echoes it.
- **Put bytes.** `PUT /v1/sites/verify-gated/files/index.html` with body `<h1>gated-ok</h1>`.
- **Public without password.** Run `curl -sS -o "$EVIDENCE/share-password/gate.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/"`. Status `401`. Body is the gate page: heading Energon, copy `This link is password-protected.`, a `Password` field, button `Open`, and the agent hint `X-Energon-Password`. Body does not contain `gated-ok` or `correct-horse`.
- **JSON gate.** Run `curl -sS -o "$EVIDENCE/share-password/gate.json" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/" -H "accept: application/json"`. Status `401`. `error` is `password_required`.
- **Wrong header.** Run the public GET with `-H "X-Energon-Password: wrong-phrase"`. Status `401`. Still no `gated-ok`.
- **Right header.** Run `curl -sS -o "$EVIDENCE/share-password/unlocked.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/" -H "X-Energon-Password: correct-horse"`. Status `200`. Body contains `gated-ok`.
- **Token skips gate.** `GET $ORIGIN/v1/sites/verify-gated/files/index.html` with Bearer token and no password header. Status `200`. Body contains `gated-ok`.
- **Hub lock.** On a site without a password, choose the lock (`Set view password`) or More → `Set password`. Dialog `#pw-dlg` title about password. Generate or type a phrase, choose `Save`. Catalog row lock hover is `View password`. Public GET without header is 401.
- **Clear.** `PATCH /v1/sites/verify-gated` with `{"password":""}`. Public GET without header is 200 and contains `gated-ok`.
- **Proof.** Save gate HTML, JSON 401, unlocked HTML, and the create echo. Browser proof: screenshot of the gate page with `This link is password-protected.` visible, then a screenshot after a correct form submit showing `gated-ok`.

## Gotchas

- Write responses echo the password you just set. GET list/detail never returns it — only `password_protected`. Assert the echo on write, and the absence on GET.
- Do not write the password into the published file.
- `/v1` GET skipping the password is intended. It does not prove the public link is open.
- Empty string clears. Omitting `"password"` on PATCH leaves the existing hash.
- Hub generate copies a five-word memorable phrase. The field is `type="text"` (not `password`) so the human can see it.
- Cookie unlock (`energon_gate`) is set after a successful form POST. A later GET in the same browser may skip the form; curl without cookies will not.
