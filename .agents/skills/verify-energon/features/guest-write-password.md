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
- Hub catalog: lockup hover `Write password`, padlock hover `View password`, More actions still `Set password` / `Change or remove password`. Dialog `#pw-dlg` title is Link access.
- API: `"write_password"` on `POST /v1/sites` or `PATCH /v1/sites/{slug}` / `PATCH /v1/files/{id}`; `X-Energon-Set-Write-Password` or multipart `write_password` on file create.
- Outside agent: `GET $ORIGIN/llms.txt` (single-origin local includes the guest section) then `PUT` the public URL with `X-Energon-Write-Password`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed. `TOKEN` minted. `$HANDLE` known.
- Phrase to use: `guest-write-ok`. Do not reuse a production password.
- Single-origin local: assert the guest-write section of hub `/llms.txt` rather than two Hosts.

- **Create writable site.** `POST $ORIGIN/v1/sites` with `{"slug":"verify-guest","write_password":"guest-write-ok"}`. Status `201`. Body `write_password` is `guest-write-ok`. `write_password_protected` is true. GET of that JSON later must not be used as proof the phrase is stored.
- **Put homepage with token.** `PUT /v1/sites/verify-guest/files/index.html` with body `<h1>guest-home</h1>`.
- **Guest PUT new path.** `PUT $ORIGIN/$HANDLE/s/verify-guest/note.txt` with `-H "X-Energon-Write-Password: guest-write-ok"` and body `from-guest`, no `Authorization`. Status `201`. Body has no `hub`. Public GET of that path is `200` with `from-guest`.
- **Guest DELETE path.** `DELETE $ORIGIN/$HANDLE/s/verify-guest/note.txt` with the write header. Status `200`. Body `{ "deleted": true, "path": "note.txt" }`.
- **Last-path DELETE.** Guest-DELETE `index.html`. `GET $ORIGIN/$HANDLE/s/verify-guest/` is still `200`.
- **Directory DELETE.** `DELETE $ORIGIN/$HANDLE/s/verify-guest/` with the write header. Status `405`. `Allow` is `GET`.
- **Create writable file.** `POST /v1/files` with `X-Filename: guest.bin`, `X-Energon-Set-Write-Password: guest-write-ok`, body `abc`, `content-type: application/octet-stream`. Status `201`.
- **Empty loose PUT then GET.** `PUT` the public file URL with the write header and empty body. Status `200`. Later GET is `200` with length `0` and the same `Content-Type`.
- **Loose DELETE.** `DELETE` that public file URL with the write header. Status `405`.
- **Header-bound.** Same phrase on `X-Energon-Password` cannot PUT or DELETE. Cookie from a share-password form POST cannot PUT or DELETE. Distinct secrets: form POST of the write phrase is `303`; cookie GET is `200`; that cookie PUT/DELETE is `401`. Share header carrying the write phrase is `401` on GET.
- **Owner policy.** Create a site with `"write_policy":"owner","write_password":"guest-write-ok"`. Guest PUT of a path still succeeds.
- **Unset is 405.** `PATCH` `{ "write_password": "" }` then guest PUT is `405` and the body does not name `X-Energon-Write-Password`.
- **Creator-only.** A second-account token `PATCH` of `write_password` is `403`.
- **Hub marks.** Write-only row lockup hover is `Write password` (no sibling padlock). View-only row padlock hover is `View password`. Unprotected row has no password mark. More menu still offers `Set password`. `#scan-examples` is gone. Last writer stays the account; via copy is `Updated via shared write` after a guest PUT.
- **Discovery.** `GET $ORIGIN/llms.txt` contains the guest-write section and `X-Energon-Write-Password`.
- **Proof.** Save create echo, guest PUT `201`, path DELETE `200` JSON, last-path site GET `200`, empty-file GET length `0`, 405 bodies, catalog `/account/data` row (`write_password_protected`, `written_via`, `last_written_by`). Browser proof: Hub stage with `#stage-access` closed, then open showing both fields; catalog lockup on the write-password row with `#who` visible.

## Gotchas

- Local verify uses one origin. Do not fail the recipe because content-origin `/v1/help` is not a 404.
- Guest PUT is raw bytes on the public URL. Do not send `Authorization`. Do not send `overwrite: true`.
- Empty string on PATCH clears. Omitting `write_password` leaves the existing hash.
- Identical phrases still bind to the header that carried them.
- The HTML gate accepts the write password for reading. The gate and `energon_gate` cookie never authorize PUT or DELETE.
- Catalog Last writer stays the last account. `Updated via shared write` is the via copy, not a person named guest.
