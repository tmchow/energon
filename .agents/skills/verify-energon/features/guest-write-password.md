# Guest write password

Guest write password lets the creator give someone outside the host a second shared secret so they can PUT a public file URL, or PUT and DELETE paths under a public site URL, without Access, a token, or `/connect`. The share-password header and the gate cookie cannot write. Hub outsider-sharing fields sit behind closed Link access.

## Sub-features

- `wpw-set` sets a write password on create or PATCH; only the creator can set or clear it; duplicate does not copy it.
- `wpw-file-put` replaces a loose file (including empty) at the same public URL and Content-Type.
- `wpw-site-put` adds or replaces a site path (`201` new, `200` replace).
- `wpw-site-delete` deletes one site path (`200` JSON `{ deleted: true, path }`) and keeps the site URL at `200` after the last path is gone.
- `wpw-denied` rejects loose DELETE, site directory DELETE, share-password header writes, and cookie writes.
- `wpw-marks` shows the lockup on any write-password row, a padlock on view-password-only rows, and no password mark when neither hash is set.

## How to get to it (user POV)

- Hub stage: open `#stage-access` (Link access). Share input is `#stage-password`. Write input is `#stage-write-password`. URL, expiration, Who can write, and Publish stay visible outside the disclosure.
- Hub catalog: lockup hover `Write password`, padlock hover `View password`, More actions still `Set password` / `Change or remove password`. Dialog `#pw-dlg` title is Link access. `#pw-dlg-write-door` Off/On; `#pw-dlg-write-input` shows the stored phrase when On.
- API: `"write_password"` on `POST /v1/sites` or `PATCH /v1/sites/{id}` / `PATCH /v1/files/{id}`; `X-Energon-Set-Write-Password` or multipart `write_password` on file create.
- Outside agent: `GET $ORIGIN/llms.txt` (single-origin local includes the guest section) then `PUT` the public URL with `X-Energon-Write-Password`.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known.
- Phrase to use: `guest-write-ok`. Do not reuse a production password.
- Single-origin local: assert the guest-write section of hub `/llms.txt` rather than two Hosts.

- **Default — Create writable site.** `POST $ORIGIN/v1/sites` with `{"slug":"verify-guest","write_password":"guest-write-ok"}`. Status `201`. Body `write_password` is `guest-write-ok`. `write_password_protected` is true. Later `/v1` GET must not contain the phrase. Hub `GET /account/sites/$SITE_ID` returns it.
- **Default — Put homepage with token.** `PUT /v1/sites/$SITE_ID/files/index.html` with body `<h1>guest-home</h1>`.
- **Default — Guest PUT / DELETE / last-path.** `PUT $ORIGIN/$HANDLE/s/$SITE_ID/verify-guest/note.txt` with `-H "X-Energon-Write-Password: guest-write-ok"` and body `from-guest`, no `Authorization` → `201`, public GET `from-guest`. DELETE that path → `200` `{ "deleted": true, "path": "note.txt" }`. Guest-DELETE `index.html`; site URL GET is still `200`. Directory DELETE of the site URL → `405`, `Allow: GET`.
- **Default — Writable file.** `POST /v1/files` with `X-Filename: guest.bin`, `X-Energon-Set-Write-Password: guest-write-ok`, body `abc`. Empty PUT then GET length `0`. Loose DELETE of that URL → `405`.
- **Default — Unset is 405.** `PATCH` `{ "write_password": "" }` then guest PUT is `405` and the body does not name `X-Energon-Write-Password`.
- **Default — Discovery.** `GET $ORIGIN/llms.txt` contains the guest-write section and `X-Energon-Write-Password`.
- **Extra (wpw-denied) — Header-bound.** Same phrase on `X-Energon-Password` cannot PUT or DELETE. Cookie from a share-password form POST cannot PUT or DELETE. Drive when gate cookie vs write header binding changes.
- **Extra (wpw-set) — Owner policy / creator-only.** Create with `"write_policy":"owner","write_password":"guest-write-ok"`; guest PUT still succeeds. A second-account token `PATCH` of `write_password` is `403`. Drive when write policy or creator-only changes.
- **Extra (wpw-marks / Hub.svelte) — Hub marks.** Write-only lockup hover `Write password`. `#pw-dlg-write-door` On shows `guest-write-ok`. Drive when Hub.svelte password marks change.
- **Proof.** Default: create echo, guest PUT `201`, path DELETE `200`, last-path site GET `200`, empty-file GET length `0`, 405 bodies. Screenshots only for Extra hub.

## Gotchas

- Local verify uses one origin. Do not fail the recipe because content-origin `/v1/help` is not a 404.
- Guest PUT is raw bytes on the public URL. Do not send `Authorization`. Do not send `overwrite: true`.
- Empty string on PATCH clears. Omitting `write_password` leaves the existing hash.
- Hub `GET /account/sites/{id}` returns the stored write phrase to the creator. `/v1` GET does not.
- Identical phrases still bind to the header that carried them.
- The HTML gate accepts the write password for reading. The gate and `energon_gate` cookie never authorize PUT or DELETE.
- Catalog Last writer stays the last account. `Updated via shared write` is the via copy, not a person named guest.
