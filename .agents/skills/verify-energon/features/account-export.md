# Account export

Account export lets a person or agent download every site and loose file they own as one zip, with a `manifest.json` of ids, names, public URLs, sizes, expiry, and write policy, before a bulk cleanup. The archive is `owner_id` only. Work they only edited is omitted. Share and write passwords are omitted.

## Sub-features

- `owned-zip` returns `200` `application/zip` named `{handle}-owned.zip` with `manifest.json`, each owned site under `sites/{id}/`, and each owned loose file under `files/{id}/{filename}`.
- `owned-scope` omits sites and files owned by another identity, including objects the caller last edited.
- `owned-manifest` lists `scope: "owned"`, `owner.email` / `owner.handle`, and per object `id`, name, `url`, `size`, `expires_at`, `write_policy`, and `archive_path`.
- `owned-empty` is `400 empty_export` when the caller owns nothing live.
- `owned-cap` refuses an archive over the file-count cap with `400 too_many_files` and the totals (`limit_files`, `actual_files`, `sites`, `files`); the message names `GET /v1/sites/{id}/export`.
- `owned-hub` is the Hub card `#account-export` linking to `GET /account/export`.

## How to get to it (user POV)

- Agent: `GET /v1/export` with a token.
- Human: Hub card `#account-export`, choose `Download everything you own` (`GET /account/export`).
- `GET $ORIGIN/v1/help` `routes["GET /v1/export"]` and `/llms.txt` name owned content (`owner_id`) and the zip caps.
- `GET $ORIGIN/v1/openapi.json` documents `/v1/export` (`operationId` `exportOwned`) including `empty_export` and the over-cap extras.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for the signed-in email (`$EMAIL` / `$HANDLE`).
- Fixture names start with `vexport` so other recipes stay out of this zip.
- Localhost accepts `Cf-Access-Authenticated-User-Email` for a second identity. Do not invent a token; mint through `POST $ORIGIN/account/tokens` with `Origin: $ORIGIN`.

- **Fixtures (caller).** `POST $ORIGIN/v1/sites` with `{"slug":"vexport-alpha"}` then `PUT` `index.html` (`alpha`) and `css/app.css` (`body{}`). `POST` `{"slug":"vexport-beta"}` then `PUT` `notes.md` (`# beta`). `POST $ORIGIN/v1/files` three times with `X-Filename: vexport-one.md`, `vexport-two.md`, `vexport-three.md` and bodies `one` / `two` / `three`. All creates `201`. Record site ids as `$ALPHA` and `$BETA` and file ids as `$F1` `$F2` `$F3`.
- **Second identity.** `POST $ORIGIN/account/tokens` with `Cf-Access-Authenticated-User-Email: vexport-other@example.com`, `Origin: $ORIGIN`, body `{"label":"vexport-other"}` (`201`). Save that token as `$OTHER`. With `$OTHER`, create site `vexport-other-site` with `index.html` `other-only`, and file `vexport-other.md` (`other-file`). Record `$OTHER_SITE` and `$OTHER_FILE`. Optionally `PUT` a path on `$ALPHA` with `$OTHER` if write policy is `org` so the other identity is involved in the caller's site; that path still belongs in the caller's zip.
- **HTTP export.** `curl -sS -D "$EVIDENCE/account-export/headers.txt" -o "$EVIDENCE/account-export/owned.zip" "$ORIGIN/v1/export" -H "Authorization: Bearer $TOKEN"`. Status `200`. `Content-Type` is zip. `Content-Disposition` contains `$HANDLE-owned.zip` and `attachment`.
- **Unzip.** `mkdir -p "$EVIDENCE/account-export/unzip" && python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$EVIDENCE/account-export/owned.zip" "$EVIDENCE/account-export/unzip"`. The tree contains `manifest.json`, `sites/$ALPHA/index.html`, `sites/$ALPHA/css/app.css`, `sites/$BETA/notes.md`, `files/$F1/vexport-one.md`, `files/$F2/vexport-two.md`, `files/$F3/vexport-three.md`. `index.html` contains `alpha`. `vexport-one.md` is `one`. No path contains `$OTHER_SITE` or `$OTHER_FILE`. `vexport-other.md` is absent.
- **Manifest.** `python3 -c 'import json,sys; print(json.load(open(sys.argv[1])))' "$EVIDENCE/account-export/unzip/manifest.json"` saved as `manifest.json`. `scope` is `owned`. `owner.email` equals `$EMAIL`. `owner.handle` equals `$HANDLE`. Site ids are `$ALPHA` and `$BETA`. File filenames are the three `vexport-*.md` names. Each site has `url`, `size`, `file_count`, `expires_at`, `write_policy`, `archive_path` (`sites/{id}/`). Each file has `url`, `size`, `expires_at`, `write_policy`, `archive_path`. The JSON does not contain a share or write password. Copy the file to `$EVIDENCE/account-export/manifest.json`.
- **Hub.** Open `$ORIGIN/`. `#who` shows `$EMAIL`. `#account-export` is visible with heading `Download what you own` and control `Download everything you own` (`href="/account/export"`). `curl -sS -D "$EVIDENCE/account-export/hub-headers.txt" -o "$EVIDENCE/account-export/hub.zip" "$ORIGIN/account/export"`. Status `200`, same disposition name. Unzipped names match the `/v1` zip. Screenshot the hub with `#who` and `#account-export` visible.
- **Empty.** Mint a token for `vexport-empty@example.com` the same way as the second identity. `GET $ORIGIN/v1/export` with that token is `400`, `error` `empty_export`. Save status and body as `empty.json`.
- **Cap.** Mint a token for `vexport-cap@example.com`. `POST $ORIGIN/v1/sites` `{"slug":"vexport-cap"}`. Build a zip of 200 files (`f0.txt` … `f199.txt`, each one byte) and `POST $ORIGIN/v1/sites/$CAP_SITE/import` with `content-type: application/zip` (`200`). `POST $ORIGIN/v1/files` with `X-Filename: vexport-cap-extra.md` (`201`). `GET $ORIGIN/v1/export` with that token is `400`, `error` `too_many_files`, `limit_files` `200`, `actual_files` `201`, `sites` `1`, `files` `1`. `message` contains `GET /v1/sites/{id}/export`. Save as `cap.json`.
- **Unauthenticated.** `GET $ORIGIN/v1/export` with no `Authorization` is `401`. Save as `unauth.json`.
- **Help.** `GET $ORIGIN/v1/help` `routes["GET /v1/export"]` contains `owner_id`. Save an excerpt as `help-export.json`.
- **Proof.** Keep the zip, unzip listing (`find` or `python3` names), `manifest.json`, both header files, `empty.json`, `cap.json`, `unauth.json`, and the hub screenshot under `$EVIDENCE/account-export/`. The second view is the unzipped tree plus the public URLs in the manifest matching `$ORIGIN/$HANDLE/s|f/…`.

## Gotchas

- Catalog scope is involvement. This zip is ownership. A site the caller only edited does not appear. Cleanup `POST /v1/cleanup` with `{}` is involvement, which is wider than this archive.
- Share and write passwords are not in `manifest.json`. Re-publishing later needs the human to set those again.
- Over the cap the Worker does not emit a truncated zip. `400 too_many_files` or `413 too_large` names the totals. Export each site with `GET /v1/sites/{id}/export` instead.
- Empty ownership is `400 empty_export`, including a freshly minted identity that has never published.
- Expired and purge-claimed rows are omitted. Live owned objects only.
- The file-count cap is 200 content files (site paths plus loose files). `manifest.json` does not count against it. Do not use the default identity for the cap fixture or the happy-path zip will also be over the cap.
- Do not attach to port 8787. Launch on `18787` (or another `ENERGON_VERIFY_PORT` this run owns).
