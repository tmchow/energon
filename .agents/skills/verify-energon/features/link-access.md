# Link access

Link access decides whether a site's or file's public URL opens at all. `public` (default) is today's behavior: anyone with the link can open it, gated only by an optional share password. `private` makes the public URL refuse every request, including guest writes, with `403 link_private`; only the creating account's tokens can read or write it through `/v1`, and other accounts get `404` and do not see it in lists. A private object has no share or write password and is owner-only for writes. Only the creator can change link access.

## Sub-features

- `la-create` creates a private file or site (`X-Energon-Link-Access`, multipart or JSON `link_access`).
- `la-refuse` refuses the public URL: JSON `403 link_private` for agents, an HTML page for browsers, and guest PUT/DELETE.
- `la-v1` reads private bytes with a token from the owning account, with `X-Energon-Link-Access: private` on `GET /v1/files/{id}`.
- `la-owner` hides a private object from another account: `404` on `/v1` reads and writes, absent from its lists.
- `la-conflict` rejects a password with private (`400`) and going private while a password stays set (`409`).
- `la-clear` goes private by clearing both passwords in the same PATCH, then back to public with a new share password.
- `la-hub` sets link access from the hub stage `#stage-link-access` and the Link access dialog `#pw-dlg-access`; private rows show the `Private` mark.

## How to get to it (user POV)

- API: `link_access` on `POST /v1/sites`, `PATCH /v1/sites/{id}`, `PATCH /v1/files/{id}`, `POST /v1/files/{id}/duplicate`, and a `new_file` target on `POST /v1/grants`. `X-Energon-Link-Access` (or multipart `link_access`) on `POST /v1/files`.
- Hub stage: open `#stage-access` (Link access) and pick `Only you and your agents` in `#stage-link-access` before `Publish`. The password fields disappear.
- Hub catalog: a private row shows the `Private` mark; clicking it opens `#pw-dlg`. More actions → `Link access` (a public row shows `Set password` or `Change or remove password`, which opens the same dialog). `#pw-dlg-access` switches between `Anyone with the link` and `Only you and your agents`.
- Open the public URL in a browser or with `curl`.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known. Local verification serves content on `$ORIGIN`.
- Fixture identities reuse the doctor identity's domain so they pass `ALLOWED_EMAIL_DOMAINS`: `DOMAIN="${EMAIL#*@}"` after sourcing `state.env`.

- **Default — Create private file.** `.agents/skills/verify-energon/bin/save --expect 201 link-access create POST "$ORIGIN/v1/files" -H "Authorization: Bearer $TOKEN" -H "X-Filename: verify-private.md" -H "X-Energon-Link-Access: private" --data-binary '# private-ok'`. Body `link_access` is `private`. Keep `id` as `$FILE_ID`.
- **Default — Public URL refused.** `GET "$ORIGIN/$HANDLE/f/$FILE_ID/verify-private.md"` is `403` JSON `link_private`, with no `private-ok` and no `/v1` in the body. With `-H "accept: text/html"` it is a `403` HTML page. `PUT` with `X-Energon-Write-Password: anything` is `403 link_private`.
- **Default — Token read.** `GET "$ORIGIN/v1/files/$FILE_ID"` with the token is `200` `# private-ok` and header `x-energon-link-access: private`. The create body's `write_policy` is `owner`.
- **Default — Other account.** `POST $ORIGIN/account/tokens` with `Cf-Access-Authenticated-User-Email: vla-other@$DOMAIN`, `Origin: $ORIGIN`, `{"label":"vla-other"}` (`201`); keep the token as `$OTHER`. `GET "$ORIGIN/v1/files/$FILE_ID"` with `$OTHER` is `404`, and `GET "$ORIGIN/v1/files?q=verify-private"` with it lists nothing.
- **Default — Conflicts.** `POST /v1/sites` `{"slug":"verify-la","password":"correct-horse"}`, then `PATCH /v1/sites/$SITE_ID` `{"link_access":"private"}` is `409 link_access_conflict`. `PATCH` `{"link_access":"private","password":"","write_password":""}` is `200` with `link_access` `private` and `password_protected` false. `PATCH` `{"password":"again"}` is `400 link_access_conflict`.
- **Default — Back to public.** `PATCH /v1/sites/$SITE_ID` `{"link_access":"public","password":"again"}` is `200`; the public site URL is then `401` without the header and `200` with `X-Energon-Password: again`.
- **Extra (la-hub / Hub.svelte) — Hub controls.** Stage a file, open `#stage-access`, choose `Only you and your agents` in `#stage-link-access`; `#stage-write` switches to `Only the creator` and is disabled. Publish; the message reads `Published privately` with no link, and the catalog row shows the `Private` mark, a name that is not a link, and no More → `Who can write`. Open it, switch `#pw-dlg-access` to `Anyone with the link`, Save; the mark disappears. On a passworded row with `Anyone in the org` writing, switching to `Only you and your agents` shows `Saving removes the share password and write password.` and `Saving also sets Who can write to Only the creator.` before Save.
- **Proof.** Default: create body, JSON and HTML 403, token read headers, 409/400 bodies, reopened gate. Screenshots only for Extra.

## Gotchas

- Every token of the owning account, including ones handed to other agents, reads a private object. Tokens of other accounts cannot.
- Private rows in the hub have no name link, because the public URL shows a 403 page in a browser. Download still works.
- `/v1/sites/{id}` and list responses report `link_access`; the content-host 403 never names the hub or `/v1`.
- Duplicates do not inherit link access. Pass `link_access` on the duplicate request to keep it private.
