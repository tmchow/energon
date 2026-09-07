# Cleanup

Cleanup lets a user find their own stale work with list filters (`expires=never`, `expires_before`, `updated_before`, `min_size`, `sort=size|age`) and then delete or re-expire many sites and files in one `POST /v1/cleanup`. The call is a dry run until the caller resends it with the `confirm` from its own preview. Objects the caller cannot write are skipped with a reason, never a batch `403`.

## Sub-features

- `list-filters` narrows `GET /v1/sites` and `GET /v1/files` by `expires`, `expires_before`, `updated_before`, and `min_size`; a malformed value is ignored, not a `400`.
- `list-sorts` orders by `sort=size` (largest first) and `sort=age` (least recently written first); `total` matches the filtered set.
- `cleanup-preview` returns `executed: false` with `matched`, `eligible`, `bytes`, `skipped.by_reason`, `sample`, and a 32-hex `confirm`; nothing changes.
- `cleanup-execute` with that `confirm` returns `executed: true` with `applied`, `skipped`, and `failed` per object.
- `cleanup-drift` rejects a stale or foreign `confirm` with `409 cleanup_drift` and a fresh preview in the body.
- `cleanup-expire` gives each object a 30m grace and skips objects already expiring sooner as `already_expiring`.
- `cleanup-explicit` targets ids (`files` and `sites`); unknown ids are skipped as `not_found`.
- `cleanup-cap` refuses more than 100 eligible objects or ids with `413 cleanup_too_many`.
- `cleanup-validation` returns `400` `bad_target`, `bad_query`, `bad_action`, `ttl_required`, or `bad_confirm` for malformed bodies.

## How to get to it (user POV)

- Agent: `GET /v1/files?q=…&expires=never&sort=size` or `GET /v1/sites?updated_before=<iso>&sort=age` with a token to find candidates.
- Agent: `POST /v1/cleanup` with `{ "target", "action" }` for the preview, then the same body plus `confirm` to execute. `target` is list filters (optional `kind`) or `{ "sites", "files" }` ids.
- `GET $ORIGIN/v1/openapi.json` documents the request and response shapes under `/v1/cleanup`; `GET $ORIGIN/v1/help` `routes["POST /v1/cleanup"]` and `/llms.txt` name the dry-run default.
- There is no hub control for bulk cleanup. The hub catalog is the human's read-only second view of what changed.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for this Energon.
- `$HANDLE` is the bootstrap handle.
- This local Energon keeps content forever by default (`GET /v1/help` `retention.default_ttl` is `never`), so fixtures created without `ttl` match `expires=never`.
- Every fixture name in this recipe starts with `vcleanup` so the `q` filter keeps other recipes' objects out of the target.

- **Fixtures.** Run `curl -sS -o "$EVIDENCE/cleanup/file-a.json" -w '%{http_code}' -X POST "$ORIGIN/v1/files" -H "Authorization: Bearer $TOKEN" -H "X-Filename: vcleanup-a.md" -H "content-type: text/markdown" --data 'small'` and the same with `X-Filename: vcleanup-b.md` and `--data 'a-much-longer-body-so-b-is-bigger-than-a'` into `file-b.json`. Both `201`. Record `id` from each as `$ID_A` and `$ID_B`. Run `curl -sS -o "$EVIDENCE/cleanup/site.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"vcleanup-site"}'` (`201`). Record `id` as `$SITE_ID`. Then `curl -sS -o /dev/null -w '%{http_code}' -X PUT "$ORIGIN/v1/sites/$SITE_ID/files/index.md" -H "Authorization: Bearer $TOKEN" -H "content-type: text/markdown" --data 'site body'` (`201`). All three list with `expires_at` `null`.
- **Filter and sort.** Run `curl -sS -o "$EVIDENCE/cleanup/list-never-size.json" -w '%{http_code}' "$ORIGIN/v1/files?q=vcleanup&expires=never&sort=size" -H "Authorization: Bearer $TOKEN"`. Status `200`, `total` `2`, `files[0].filename` is `vcleanup-b.md` (larger first). Run `"$ORIGIN/v1/files?q=vcleanup&sort=age"`: `files[0].filename` is `vcleanup-a.md` (written first). Run `"$ORIGIN/v1/sites?q=vcleanup&min_size=1"`: `total` `1`, slug `vcleanup-site`. Run `"$ORIGIN/v1/files?q=vcleanup&updated_before=2000-01-01T00:00:00Z"`: `total` `0`. Run `"$ORIGIN/v1/files?q=vcleanup&min_size=bogus&expires_before=not-a-date"`: still `200` with `total` `2` (malformed filters ignored). Save each body.
- **Preview expire.** Run `curl -sS -o "$EVIDENCE/cleanup/preview-expire.json" -w '%{http_code}' -X POST "$ORIGIN/v1/cleanup" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"target":{"q":"vcleanup","expires":"never"},"action":"expire"}'`. Status `200`. Body has `executed` `false`, `action` `expire`, `ttl` `30m`, `matched` `3`, `eligible` `3`, `skipped.total` `0`, `sample` naming `vcleanup-site`, `vcleanup-a.md`, `vcleanup-b.md`, and a 32-character lowercase hex `confirm`. Record it as `$CONFIRM`. Re-run the filter list: every `expires_at` is still `null` (nothing changed).
- **Drift.** Run the same POST with `"confirm":"00000000000000000000000000000000"` appended to the body, saving to `drift.json`. Status `409`, `error` `cleanup_drift`, and the body carries a fresh preview whose `confirm` equals `$CONFIRM`. Lists are still unchanged.
- **Execute expire.** Run the same POST with `"confirm":"$CONFIRM"`, saving to `execute-expire.json`. Status `200`, `executed` `true`, `applied.total` `3`, `failed.total` `0`, and every `applied.objects[].expires_at` is about 30 minutes ahead of now. Second view: `GET "$ORIGIN/v1/files?q=vcleanup&expires=never"` is now `total` `0`; `GET "$ORIGIN/v1/files?q=vcleanup"` shows both files with that `expires_at`; `GET "$ORIGIN/v1/sites?q=vcleanup"` shows the site with it too.
- **Already expiring.** Repeat the preview POST without `confirm`, saving to `preview-again.json`. Status `200`, `matched` `0` (`expires=never` no longer matches), `eligible` `0`. Then POST `{"target":{"q":"vcleanup"},"action":"expire"}`: `matched` `3`, `eligible` `0`, `skipped.by_reason.already_expiring` `3`; its `confirm` differs from `$CONFIRM`.
- **Explicit delete.** Run `curl -sS -o "$EVIDENCE/cleanup/preview-delete.json" -w '%{http_code}' -X POST "$ORIGIN/v1/cleanup" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data "{\"target\":{\"files\":[\"$ID_A\",\"nosuchid\"],\"sites\":[\"$SITE_ID\"]},\"action\":\"delete\"}"`. Status `200`, `matched` `3`, `eligible` `2`, `skipped.by_reason.not_found` `1` with `skipped.sample[0].ref` `nosuchid`, no `ttl` field. Resend with its `confirm`, saving to `execute-delete.json`: `200`, `executed` `true`, `applied.total` `2`. Second view: `GET "$ORIGIN/v1/files/$ID_A"` is `404`; `GET "$ORIGIN/$HANDLE/f/$ID_A/vcleanup-a.md"` is `404`; `GET "$ORIGIN/v1/sites/$SITE_ID"` is `404`; `GET "$ORIGIN/v1/files?q=vcleanup"` has `total` `1` (`vcleanup-b.md`).
- **Cap.** Build 101 ids with `IDS=$(python3 -c 'import json; print(json.dumps(["x%06d" % i for i in range(101)]))')` and run `curl -sS -o "$EVIDENCE/cleanup/cap.json" -w '%{http_code}' -X POST "$ORIGIN/v1/cleanup" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data "{\"target\":{\"files\":$IDS},\"action\":\"delete\"}"`. Status `413`, `error` `cleanup_too_many`, `limit` `100`, `matched` `101`.
- **Validation.** Each POST below is a `400`; save status and body. `{"target":{"files":["x"],"q":"a"},"action":"delete"}` → `bad_target`. `{"target":{"min_size":"bogus"},"action":"delete"}` → `bad_query` with `fields` `["min_size"]`. `{"target":{"q":"vcleanup"},"action":"nuke"}` → `bad_action`. `{"target":{"q":"vcleanup"},"action":"set_ttl"}` → `ttl_required`. `{"target":{"q":"vcleanup"},"action":"delete","confirm":"nope"}` → `bad_confirm`. `{"action":"delete"}` → `bad_target`.
- **Proof.** Save every status and body under `$EVIDENCE/cleanup/`: fixture creates, the filtered lists before and after each execute, both previews, the `409`, both executes, the `413`, and the `400`s. The read-only second view is the list JSON showing `expires_at` set after expire and the `404`s after delete.

## Gotchas

- `confirm` is bound to the action, `ttl`, and the eligible set. Resend the identical `target` and `action`; a different filter, a shorter list, or an `expire` that already ran yields a different value and a `409`. A stale confirm is `409 cleanup_drift`, not `400`; only a non-hex shape is `400 bad_confirm`.
- A preview changes nothing. Prove that with a second list GET before executing; the write response alone is not proof of the dry run.
- `expire` uses a fixed grace: sending `ttl` with `expire` or `delete` is `400 bad_action`. Use `set_ttl` for a chosen `ttl`.
- After execute-expire the fixtures turn `410` about 30 minutes later and are then purged. Finish the recipe, including the explicit delete, well inside that window, or re-create fixtures.
- On an Energon that requires a TTL (`retention.allow_unlimited` false) `expires=never` matches nothing. Filter with `expires_before` or `updated_before` instead; do not report the empty match as a bug.
- Cleanup never returns `403` for someone else's owner-locked object; it appears under `skipped.by_reason.not_writable`. Lists stay scoped to what the token's account created or last wrote, so `{}` as the target means "everything I am involved in on this Energon", not the whole host.
- `matched` counts unresolved explicit ids too, so `matched` can exceed `eligible + writable skips`. A site that is already gone during execute-delete still counts as `applied`.
- Site `min_size` sums the site's files, so an empty site never matches `min_size=1`. Keep the site PUT in the fixtures step.
- The `413` for an oversized explicit list happens before any lookup: `eligible`, `skipped`, and `bytes` are absent from that body. A filter that matches too many objects returns them.
