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
- Hub catalog: lock mark `View password` only when a view password is set. Unprotected rows have no password mark. No Password chip next to the slug. More actions still `Set password` / `Change or remove password`. Dialog `#pw-dlg` title is Link access. `#pw-dlg-share-door` / `#pw-dlg-write-door` are Off/On. Fields `#pw-dlg-input` and `#pw-dlg-write-input` show the stored phrases with generate and copy when that door is On. Off and Save removes that door.
- API: `"password"` on `POST /v1/sites` or `PATCH /v1/sites/{id}`; `X-Energon-Set-Password` on `POST`/`PUT /v1/files`.
- Open the public URL; submit the form, or retry with header `X-Energon-Password`.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known.
- Phrase to use: `correct-horse`. Do not reuse a production password.

- **Default — Create protected site.** `.agents/skills/verify-energon/bin/save --expect 201 share-password create POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-gated","password":"correct-horse"}'`. Body has `id`. Body `password` is `correct-horse`. `password_protected` is true. Later `/v1` GET of that JSON must not contain the phrase.
- **Default — Put bytes.** `PUT /v1/sites/$SITE_ID/files/index.html` with body `<h1>gated-ok</h1>`.
- **Default — Public without password.** `GET "$ORIGIN/$HANDLE/s/$SITE_ID/verify-gated/"` is `401`. Gate HTML: heading Energon, `This link is password-protected.`, `Password` field, `Open`, `X-Energon-Password`. No `gated-ok` or `correct-horse`.
- **Default — JSON gate / wrong / right / skip.** `Accept: application/json` → `401` `password_required`. Wrong `X-Energon-Password` → `401`. Right header → `200` `gated-ok`. Token GET `/v1/sites/$SITE_ID/files/index.html` with no password header → `200` `gated-ok`.
- **Default — Clear.** `PATCH /v1/sites/$SITE_ID` `{"password":""}` then public GET without header is `200` and contains `gated-ok`. `GET $ORIGIN/account/sites/$SITE_ID` returned `password` `correct-horse` before clear; `/v1` GET never did.
- **Extra (pw-form / Hub.svelte) — Hub lock and gate form.** More → `Set password`, `#pw-dlg`. Browser submit of the gate form. Drive when `#pw-dlg` or Gate.svelte changes.
- **Proof.** Default: gate HTML, JSON 401, unlocked HTML, create echo. Screenshots only for Extra form/dialog.

## Gotchas

- Write responses echo the password you just set. `/v1` GET list/detail never returns it — only `password_protected`. Hub `GET /account/sites/{id}` and `GET /account/files/{id}` return the stored phrase to the signed-in human.
- Do not write the password into the published file.
- `/v1` GET skipping the password is intended. It does not prove the public link is open.
- Empty string clears. Omitting `"password"` on PATCH leaves the existing hash.
- Hub generate copies a five-word memorable phrase. The field is `type="text"` (not `password`) so the human can see it.
- Cookie unlock (`energon_gate`) is set after a successful form POST. A later GET in the same browser may skip the form; curl without cookies will not.
- Rows set before phrases were stored show On with an empty field plus a note to generate or turn off. They cannot recover the old phrase.
