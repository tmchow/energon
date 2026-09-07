# Share password

Share password lets a user lock a public site or file URL behind a phrase. Browsers get a form. Agents send `X-Energon-Password`. Token GETs on `/v1` skip the password. `/v1` GET never returns the phrase. The signed-in Hub Link access dialog shows stored phrases so they can be copied again.

## Sub-features

- `pw-set` sets a password on create or via PATCH / hub lock control.
- `pw-gate` serves a password form (HTML) or `password_required` (JSON) without the phrase.
- `pw-header` unlocks the public URL with `X-Energon-Password`.
- `pw-form` unlocks in the browser by submitting the gate form.
- `pw-v1-skip` reads bytes with a token and no password header.
- `pw-clear` removes the password so the public URL is open again.
- `pw-wrong` rejects a bad phrase and does not leak the hash.

## How to get to it (user POV)

- Hub stage: open `#stage-access` (Link access), then fill `#stage-password` (or generate with `Generate a readable password`) before `Publish`.
- Hub catalog: lock mark `View password` only when a view password is set. Unprotected rows have no password mark. No Password chip next to the slug. More actions still `Set password` / `Change or remove password`. Dialog `#pw-dlg` title is Link access. Fields `#pw-dlg-input` and `#pw-dlg-write-input` show the stored phrases with generate and copy.
- API: `"password"` on `POST /v1/sites` or `PATCH /v1/sites/{slug}`; `X-Energon-Set-Password` on `POST`/`PUT /v1/files`.
- Open the public URL; submit the form, or retry with header `X-Energon-Password`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed. `TOKEN` minted. `$HANDLE` known.
- Phrase to use: `correct-horse`. Do not reuse a production password.

- **Create protected site.** Run `curl -sS -o "$EVIDENCE/share-password/create.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-gated","password":"correct-horse"}'`. Status `201`. Body `password` is `correct-horse` (echo of what you set). `password_protected` is true. `/v1` GET of that JSON later must not contain the phrase.
- **Put bytes.** `PUT /v1/sites/verify-gated/files/index.html` with body `<h1>gated-ok</h1>`.
- **Public without password.** Run `curl -sS -o "$EVIDENCE/share-password/gate.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/"`. Status `401`. Body is the gate page: heading Energon, copy `This link is password-protected.`, a `Password` field, button `Open`, and the agent hint `X-Energon-Password`. Body does not contain `gated-ok` or `correct-horse`.
- **JSON gate.** Run `curl -sS -o "$EVIDENCE/share-password/gate.json" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/" -H "accept: application/json"`. Status `401`. `error` is `password_required`.
- **Wrong header.** Run the public GET with `-H "X-Energon-Password: wrong-phrase"`. Status `401`. Still no `gated-ok`.
- **Right header.** Run `curl -sS -o "$EVIDENCE/share-password/unlocked.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-gated/" -H "X-Energon-Password: correct-horse"`. Status `200`. Body contains `gated-ok`.
- **Token skips gate.** `GET $ORIGIN/v1/sites/verify-gated/files/index.html` with Bearer token and no password header. Status `200`. Body contains `gated-ok`.
- **Hub lock.** On a site without a password, choose More → `Set password`. Dialog `#pw-dlg` title `Link access`. `#pw-dlg-input` is visible. Generate or type a phrase, choose `Save`. Re-open the dialog: the same phrase is in `#pw-dlg-input` and can be copied. Catalog row lock hover is `View password`. The slug cell has no Password chip. Public GET without header is 401.
- **Clear.** `PATCH /v1/sites/verify-gated` with `{"password":""}`. Public GET without header is 200 and contains `gated-ok`.
- **Hub account GET.** `GET $ORIGIN/account/sites/verify-gated` (no bearer; localhost Access identity) returns `password` `correct-horse` while the password is set. `GET $ORIGIN/v1/sites/verify-gated` with the token does not.
- **Proof.** Save gate HTML, JSON 401, unlocked HTML, the create echo, and the hub account GET. Browser proof: screenshot of the gate page with `This link is password-protected.` visible, then a screenshot after a correct form submit showing `gated-ok`. Hub proof: Link access dialog showing the stored phrase with copy.

## Gotchas

- Write responses echo the password you just set. `/v1` GET list/detail never returns it — only `password_protected`. Hub `GET /account/sites/{slug}` and `GET /account/files/{id}` return the stored phrase to the signed-in human.
- Do not write the password into the published file.
- `/v1` GET skipping the password is intended. It does not prove the public link is open.
- Empty string clears. Omitting `"password"` on PATCH leaves the existing hash.
- Hub generate copies a five-word memorable phrase. The field is `type="text"` (not `password`) so the human can see it.
- Cookie unlock (`energon_gate`) is set after a successful form POST. A later GET in the same browser may skip the form; curl without cookies will not.
- Rows set before phrases were stored show an empty field plus a note to generate or remove. They cannot recover the old phrase.
