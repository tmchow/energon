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

- `bin/up` passed. `$TOKEN` is the signed-in email (`$EMAIL` / `$HANDLE`).
- Fixture names start with `vexport` so other recipes stay out of this zip.
- Localhost accepts `Cf-Access-Authenticated-User-Email` for a second identity. Do not invent a token; mint through `POST $ORIGIN/account/tokens` with `Origin: $ORIGIN`.

- **Default — Fixtures (slim).** `POST $ORIGIN/v1/sites` `{"slug":"vexport-alpha"}` then PUT `index.html` (`alpha`). `POST $ORIGIN/v1/files` `X-Filename: vexport-one.md` body `one`. Record `$ALPHA` and `$F1`.
- **Default — Second identity.** `POST $ORIGIN/account/tokens` with `Cf-Access-Authenticated-User-Email: vexport-other@example.com`, `Origin: $ORIGIN`, `{"label":"vexport-other"}` (`201`). With that token, create file `vexport-other.md`. Record `$OTHER_FILE`.
- **Default — HTTP export.** `curl -sS -D "$EVIDENCE/account-export/headers.txt" -o "$EVIDENCE/account-export/owned.zip" "$ORIGIN/v1/export" -H "Authorization: Bearer $TOKEN"`. Status `200`. Zip named `$HANDLE-owned.zip`. Unzip: `manifest.json`, `sites/$ALPHA/index.html` (`alpha`), `files/$F1/vexport-one.md` (`one`). No `$OTHER_FILE`. Manifest `scope` `owned`, `owner.email` `$EMAIL`, no share/write password.
- **Default — Empty / unauth.** Mint a token for `vexport-empty@example.com`. `GET /v1/export` with it is `400 empty_export`. `GET /v1/export` with no Authorization is `401`.
- **Extra (owned-hub) — Hub card.** `#account-export` on `$ORIGIN/`. `GET /account/export` same zip. Drive when Hub.svelte export card changes.
- **Extra (owned-cap) — 200-file cap.** Never on the default identity. Mint `vexport-cap@example.com`, import a 200-file zip plus one extra loose file, `GET /v1/export` is `400 too_many_files` `limit_files` `200` `actual_files` `201`. Drive when the export cap changes.
- **Proof.** Default: zip, unzip listing, `manifest.json`, `empty.json`, `unauth.json`. Screenshot only for Extra hub.

## Gotchas

- Catalog scope is involvement. This zip is ownership. A site the caller only edited does not appear. Cleanup `POST /v1/cleanup` with `{}` is involvement, which is wider than this archive.
- Share and write passwords are not in `manifest.json`. Re-publishing later needs the human to set those again.
- Over the cap the Worker does not emit a truncated zip. `400 too_many_files` or `413 too_large` names the totals. Export each site with `GET /v1/sites/{id}/export` instead.
- Empty ownership is `400 empty_export`, including a freshly minted identity that has never published.
- Expired and purge-claimed rows are omitted. Live owned objects only.
- The file-count cap is 200 content files (site paths plus loose files). `manifest.json` does not count against it. Do not use the default identity for the cap fixture or the happy-path zip will also be over the cap.
- Do not attach to port 8787. Launch on `18787` (or another `ENERGON_VERIFY_PORT` this run owns).
