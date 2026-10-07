# Upload grant

An upload grant lets a token holder hand a machine without a token a short-lived, single-use permission to upload one file: a new loose file, a replacement for an existing one, or one path in a site. The machine sends raw bytes to the grant's upload URL with `Authorization: Bearer <secret>`. Success publishes at once and uses the grant up; the token holder reads the result from the grant.

## Sub-features

- `grant-mint` returns `upload_url` (`{content_origin}/_grants/{id}`) and a `grant_` secret once; the secret never appears in a URL.
- `grant-new-file` publishes a new loose file owned by the minting account.
- `grant-replace` replaces an existing loose file at the same URL and keeps its stored content type.
- `grant-site-path` adds (`201`) or replaces (`200`) one site path.
- `grant-single-use` refuses a second upload with `410 grant_used`, the published `url`, and its `result_id`.
- `grant-protected` creates a new file with the share password set at mint, so it is gated from the moment it lands.
- `grant-checksum` rejects bytes that do not match `sha256` with `400 checksum_mismatch` and leaves the grant usable.
- `grant-revoked` ends the grant with `410 grant_failed` (`reason: token_revoked`) once the minting token is revoked.
- `grant-status` shows `unused`, `uploading` (an upload in flight), `consumed` with `url` and `result_id`, `failed` with `last_error`, or `expired` to any token of the minting account.

## How to get to it (user POV)

- API, token holder: `POST $ORIGIN/v1/grants` with a `target`; `GET $ORIGIN/v1/grants/{id}`.
- Tokenless machine: `PUT` the returned `upload_url` with `Authorization: Bearer <secret>` and the raw body. It reads `GET $ORIGIN/llms.txt` (single-origin local includes the Upload grant section).

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known.
- Single-origin local: `upload_url` is `$ORIGIN/_grants/{id}`.
- The tokenless `PUT` sends no `$TOKEN`; only the grant secret.

- **Default — Mint a new-file grant.** `POST $ORIGIN/v1/grants` with `{"target":{"type":"new_file","filename":"grant.txt"}}`. Status `201`. Save `id` as `$GRANT_ID`, `secret` as `$GRANT_SECRET`, `upload_url` as `$UPLOAD_URL`. `$UPLOAD_URL` is `$ORIGIN/_grants/$GRANT_ID` and does not contain the secret.
- **Default — Upload without a token.** `curl -sS -X PUT "$UPLOAD_URL" -H "Authorization: Bearer $GRANT_SECRET" --data-binary 'from-the-other-machine'` → `201` with `url` under `$ORIGIN/$HANDLE/f/`. Public GET of that `url` returns `from-the-other-machine`.
- **Default — Single use.** The same PUT again → `410` `grant_used` with the same `url` and `result_id` equal to the upload's `id`.
- **Default — Status.** `GET $ORIGIN/v1/grants/$GRANT_ID` with `$TOKEN` → `200` `state` `consumed`, `url` equal to the published URL, `result_id` equal to the upload's `id`, no `secret` field.
- **Default — Site path.** `POST $ORIGIN/v1/sites` `{"slug":"verify-grant"}`, then mint `{"target":{"type":"site_path","site_id":"$SITE_ID","path":"index.html"}}` and PUT `<h1>granted</h1>` → `201`. Public site URL shows `granted`.
- **Default — Checksum then retry.** Mint with `"sha256"` set to the SHA-256 of `right` (`shasum -a 256`), PUT `wrong` → `400 checksum_mismatch`; status still `unused`; PUT `right` → `201`.
- **Default — Revoked token ends grants.** `bin/mint-token grant-revoke`, mint a grant with that token, `DELETE $ORIGIN/v1/whoami` with it, then PUT → `410` `grant_failed`, `reason` `token_revoked`. Status with `$TOKEN` from the same account shows `failed`.
- **Default — Protected new file.** Mint `{"target":{"type":"new_file","filename":"locked.txt","password":"grant-pw"}}` → `201`, `target.password` is `grant-pw`. PUT `locked` → `201`. Public GET of `url` without a password → `401` (gate page); with `X-Energon-Password: grant-pw` → `locked`. Status `target` has no `password`.
- **Default — Discovery.** `GET $ORIGIN/llms.txt` contains `/_grants/` and `Authorization: Bearer <secret>`.
- **Extra (grant-replace) — Replace keeps type.** `POST /v1/files` with `X-Filename: NOTES` and `content-type: text/plain`, mint `{"target":{"type":"file","id":"$FILE_ID"}}`, PUT with `content-type: text/html` → `200`, `content_type` still `text/plain`. Drive when replacement or content-type handling changes.
- **Extra (grant-mint) — Errors.** `"expires_in":"2h"` → `400 bad_ttl`. A wrong secret and an unknown id both → `404 grant_invalid` with identical bodies. Drive when mint validation or secret checks change.
- **Proof.** Default: mint body (secret redacted in notes), upload `201`, public GET bytes, second PUT `410` with `result_id`, status `consumed` with `result_id`, protected file `401` then bytes with the password, checksum `400` then `201`, revoked `410`.

## Gotchas

- The grant secret is not an API token. Sending it to `/v1/whoami` is `401`; sending `$TOKEN` to the upload URL is `404 grant_invalid`.
- `Content-Length` matters above 25 MB; `curl --data-binary @file` sets it.
- Metadata headers (`X-Filename`, set-password, TTL, write policy) on the upload are `400`; the grant fixed the target at mint. A protected new file gets its `password` in the mint `target`, never on the PUT.
- A grant cannot outlive the token that minted it; `expires_at` may be earlier than `expires_in` asked for.
- Local verify uses one origin, so a hub-origin `PUT` to `/_grants/` is served directly. In production it is a `404` naming the content-origin URL.
