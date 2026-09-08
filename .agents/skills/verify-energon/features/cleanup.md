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
- A person at the hub uses [Hub cleanup](./hub-cleanup.md) (`POST /account/cleanup`). This file is the agent `/v1` path.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known.
- This local Energon keeps content forever by default (`GET /v1/help` `retention.default_ttl` is `never`), so fixtures created without `ttl` match `expires=never`.
- Every fixture name in this recipe starts with `vcleanup` so the `q` filter keeps other recipes' objects out of the target.

- **Default — Fixtures.** `POST $ORIGIN/v1/files` `X-Filename: vcleanup-a.md` body `small` and `vcleanup-b.md` with a longer body. Both `201`. Record `$ID_A` `$ID_B`. `POST /v1/sites` `{"slug":"vcleanup-site"}` then PUT `index.md`. All three list with `expires_at` `null`.
- **Default — Filter and sort.** `GET $ORIGIN/v1/files?q=vcleanup&expires=never&sort=size` is `200`, `total` `2`, `files[0].filename` is `vcleanup-b.md`. `sort=age` lists `vcleanup-a.md` first. Sites `q=vcleanup&min_size=1` is `total` `1`. Malformed `min_size=bogus` still `200`.
- **Default — Preview, drift, execute expire.** `POST /v1/cleanup` `{"target":{"q":"vcleanup","expires":"never"},"action":"expire"}` is `200`, `executed` false, `eligible` `3`, 32-hex `confirm`. Lists still `expires_at` null. Confirm `000…0` is `409 cleanup_drift`. Resend with `$CONFIRM`: `executed` true, `applied.total` `3`. `GET …/files?q=vcleanup&expires=never` is `total` `0`.
- **Default — Explicit delete.** Preview `{"target":{"files":["$ID_A","nosuchid"],"sites":["$SITE_ID"]},"action":"delete"}` then execute. `$ID_A` and `$SITE_ID` 404; `vcleanup-b.md` remains.
- **Default — Cap and validation.** 101 fake ids → `413 cleanup_too_many`. Mixed `files`+`q` → `400 bad_target`. `action: nuke` → `bad_action`. `set_ttl` without `ttl` → `ttl_required`. `confirm: nope` → `bad_confirm`.
- **Extra (cleanup-expire) — Already expiring.** Repeat expire preview after execute: `expires=never` matches `0`; without that filter, `skipped.by_reason.already_expiring` `1` (b remains). Drive when skip reasons change.
- **Proof.** Default: fixture creates, lists before/after, preview, `409`, execute, delete 404s, `413`, `400`s.

## Gotchas

- `confirm` is bound to the action, `ttl`, and the eligible set. Resend the identical `target` and `action`; a different filter, a shorter list, or an `expire` that already ran yields a different value and a `409`. A stale confirm is `409 cleanup_drift`, not `400`; only a non-hex shape is `400 bad_confirm`.
- A preview changes nothing. Prove that with a second list GET before executing; the write response alone is not proof of the dry run.
- `expire` uses a fixed grace: sending `ttl` with `expire` or `delete` is `400 bad_action`. Use `set_ttl` for a chosen `ttl`.
- After execute-expire the fixtures turn `410` about 30 minutes later and are then purged. Finish the recipe, including the explicit delete, well inside that window, or re-create fixtures.
- On an Energon that requires a TTL (`retention.allow_unlimited` false) `expires=never` matches nothing. Filter with `expires_before` or `updated_before` instead; do not report the empty match as a bug.
- Cleanup never returns `403` for someone else's owner-locked object; it appears under `skipped.by_reason.not_writable`. Lists stay scoped to what the token's account created or last wrote, so `{}` as the target means "everything I am involved in on this Energon", not the whole host. `GET /v1/export` is the owned-content zip before that call; it is narrower than `{}`.
- `matched` counts unresolved explicit ids too, so `matched` can exceed `eligible + writable skips`. A site that is already gone during execute-delete still counts as `applied`.
- Site `min_size` sums the site's files, so an empty site never matches `min_size=1`. Keep the site PUT in the fixtures step.
- The `413` for an oversized explicit list happens before any lookup: `eligible`, `skipped`, and `bytes` are absent from that body. A filter that matches too many objects returns them.
