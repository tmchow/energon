# Publish a file

Publish a file lets a user mint one object with a short stable id, open it at `/{handle}/f/{id}/{filename}`, replace the bytes without changing the URL, and download it as an attachment.

## Sub-features

- `file-create` mints an id and returns `url` plus `api_url`.
- `file-public` serves the bytes at the public URL with the chosen filename.
- `file-replace` PUTs new bytes to the same id; `url` does not move.
- `file-download` returns `Content-Disposition: attachment` with `?download=1`.
- `file-hub` stages one dropped or chosen file and publishes with Publish.

## How to get to it (user POV)

- `POST /v1/files` with a raw body and `X-Filename`, or multipart field `file`, then `PUT /v1/files/{id}` to replace.
- Hub: choose `Choose files`, pick exactly one file, edit `Filename`, choose `Publish`.
- Open `/{handle}/f/{id}/{filename}` or `GET /v1/files/{id}` with a token.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for this Energon.
- `$HANDLE` is the bootstrap handle.

- **Default — Mint file.** Run `curl -sS -D "$EVIDENCE/publish-file/create.headers" -o "$EVIDENCE/publish-file/create.json" -w '%{http_code}' -X POST "$ORIGIN/v1/files" -H "Authorization: Bearer $TOKEN" -H "X-Filename: brief.md" -H "content-type: text/markdown" --data 'verify-file-v1'`. Status `201`. Body has `id`, `filename` `brief.md`, and `url` matching `$ORIGIN/$HANDLE/f/{id}/brief.md`.
- **Default — Public GET.** Run `curl -sS -o "$EVIDENCE/publish-file/public.md" -w '%{http_code}' "$ORIGIN/$HANDLE/f/$ID/brief.md"` using `id` from the create body. Status `200`. Body is `verify-file-v1`.
- **Default — Token GET.** Run `curl -sS -o "$EVIDENCE/publish-file/api.md" "$ORIGIN/v1/files/$ID" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body is `verify-file-v1`.
- **Default — Replace.** Run `curl -sS -o "$EVIDENCE/publish-file/put.json" -w '%{http_code}' -X PUT "$ORIGIN/v1/files/$ID" -H "Authorization: Bearer $TOKEN" -H "content-type: text/markdown" --data 'verify-file-v2'`. Status `200`. Body `url` and `id` are unchanged. Public GET now returns `verify-file-v2`.
- **Extra (file-download) — Download.** Run `curl -sS -D "$EVIDENCE/publish-file/download.headers" -o /dev/null "$ORIGIN/v1/files/$ID?download=1" -H "Authorization: Bearer $TOKEN"`. Status `200`. `Content-Disposition` is an attachment and includes `brief.md`. Drive when download disposition changes.
- **Extra (file-hub) — Hub entry.** Open `$ORIGIN/`. Choose `Choose files` and set one file on `#filepick`. `#stage-loose` is visible, `#stage-site` is absent, `#stage-filename` shows the name. Choose `Publish`. Drive when Hub.svelte / uploads change.
- **Proof.** Save create JSON, public body before and after replace. Browser screenshot only for Extra hub entry.

## Gotchas

- One file is never treated as a zip, even if the name ends in `.zip`. A zip on the hub with a single zip file stages a site, not a loose file.
- `POST /v1/files` without `X-Filename` or multipart `file` fails. The header name is `X-Filename`, not `Content-Disposition`.
- The public path includes the filename. After a rename (PATCH filename if exposed) the id stays; this recipe does not rename.
- `GET /v1/files/{id}` skips a share password. The public `/{handle}/f/…` URL does not. Proof of “anyone with the link” must hit the public URL, not `/v1`.
- Replace must keep `url` and `id`. A new id means mint-on-PUT, which is a bug.
