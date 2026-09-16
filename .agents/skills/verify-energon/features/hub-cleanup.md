# Hub cleanup

A signed-in person retires their own catalog work in bulk from the hub. Filters find never-expiring, largest, or oldest rows. Checkboxes or Select all matching these filters choose the target. Set expiry, Expire soon, or Delete then uses the same preview and count-to-confirm as `/admin`. The hub POST is `/account/cleanup` (Access, trusted Origin). It calls the same engine as `POST /v1/cleanup` without the admin flag, so involvement and `canMutate` keep other people's work out.

## Sub-features

- `hub-cleanup-select` is a checkbox on each catalog row (`#catalog-select-file-{id}`, `#catalog-select-site-{id}`) and one Select visible (`#catalog-select-visible`) under the merged list.
- `hub-cleanup-matching` is `#catalog-select-matching`, under the list next to Select visible. The target is the current catalog filters (`q`, `scope`, `kind`, `expires`, `expires_before`, `expires_within`, `updated_before`, `min_size`), not the loaded page of ids. Matching does not send `last_read_before`. Unchecking a row after matching turns the target into the remaining visible ids.
- `hub-cleanup-bar` is `#catalog-cleanup`, a bar fixed to the bottom of the viewport (region `Selection actions`) shown once something is selected; the catalog rows do not move when it appears. `#catalog-cleanup-action` offers Set expiry (pressed by default), Expire soon, and Delete (`aria-pressed="false"` until chosen). `#catalog-cleanup-ttl` is required for Set expiry. `#catalog-cleanup-run` carries the chosen verb (Set expiry / Expire soon / Delete; Delete is styled as danger), POSTs `/account/cleanup` without `confirm`, and opens `#catalog-cleanup-dlg` at once.
- `hub-cleanup-preview` returns `executed: false` with matched, eligible, skipped, bytes, sample, and a 32-hex `confirm`. The dialog shows those facts and up to five sample names (`#catalog-cleanup-sample`, then `and n more`). Zero eligible shows `Nothing you can change matches this selection.` with only Cancel.
- `hub-cleanup-confirm` is the same dialog: type `{n} objects` into `#catalog-cleanup-dlg-input`, then `#catalog-cleanup-dlg-ok`. Cancel leaves the selection and catalog unchanged.
- `hub-cleanup-drift` is `409 cleanup_drift` when the eligible set changed between preview and execute. The confirm dialog is modal, so the drift path is an outside change: while it is open, delete or expire one selected object from another client (`DELETE /v1/files/{id}` with Bearer `$TOKEN`), then confirm with the old count. The dialog says the selection changed and reloads the facts. Review the new count and confirm again.
- `hub-cleanup-human` is Access plus Origin. A missing Origin is `403 bad_origin`. `set_ttl` without `ttl` is `400 ttl_required` (the admin 7-day omit-ttl default does not apply). Localhost skips Access and uses `DEV_ACCESS_EMAIL`; a Bearer token is not a hub actor.

## How to get to it (user POV)

- Open `$ORIGIN/`. Narrow with `#kind` or open `More filters` for `#catalog-filters`. Check rows, or choose `Select all matching these filters`.
- Choose Set expiry (default) or Expire soon or Delete, then press that verb. Read matched / eligible / skipped / bytes and the sample in the dialog. Type the eligible count. Confirm.
- Per-item Change expiration (`#ttl-dlg`) and `/admin` stay separate.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. `$TOKEN` and `$HANDLE` known.
- This local Energon keeps content forever by default, so fixtures created without `ttl` match `expires=never`.
- Every fixture name starts with `vhubclean` so `q=vhubclean` keeps other recipes out.

- **Default — Fixtures (slim).** `POST $ORIGIN/v1/files` twice with Bearer `$TOKEN`, `content-type: text/plain`, `X-Filename: vhubclean-a.md` body `a`, and `vhubclean-b.md` body `bbbbbbbbbbbbbbbbbbbb`. Both `201`. Record `$ID_A` `$ID_B`.
- **Default — HTTP twin.** `POST $ORIGIN/account/cleanup` with `-H "origin: $ORIGIN"` and `{"target":{"files":["$ID_A"]},"action":"set_ttl","ttl":"7d"}` previews `executed: false`. Omit Origin: `403 bad_origin`. `{ "target": { "files": ["$ID_A"] }, "action": "set_ttl" }` without `ttl`: `400 ttl_required`. Resend the preview body plus `confirm` from the first response: `executed: true`. `GET $ORIGIN/v1/files?q=vhubclean-a` shows `expires_at` set; `vhubclean-b` still null.
- **Extra (hub-cleanup-select / Hub.svelte) — Six-file browser recipe.** Publish six files and one site (`vhubclean-a`…`f` plus `vhubclean-site`) with mixed TTLs. Open `$ORIGIN/?q=vhubclean`, open `More filters`, Never expires, check three rows, press Set expiry, type `3 objects`. Size filter + `#catalog-select-matching`, Delete cancel then confirm. For `409 cleanup_drift`, open Set expiry on two checked rows, `DELETE /v1/files/{id}` one of them from a terminal, then confirm with `2 objects`. Drive when Hub.svelte cleanup bar or checkboxes change.
- **Proof.** Default: `/account/cleanup` JSON for bad_origin, ttl_required, preview, execute, and the list GET. Screenshots only for Extra browser.

## Gotchas

- Delete is never preselected. Leave Set expiry pressed unless the recipe says to switch.
- Hub `set_ttl` always sends `ttl`. Do not copy the admin omit-ttl 7-day default.
- `#catalog-cleanup` is in the HTML even when hidden. Drive it after a selection so it is visible. It floats over the page bottom; scroll the list, not the bar, to reach rows it covers.
- Matching follows the current filters, including rows not yet loaded. Unchecking one row after matching keeps only the remaining *visible* ids.
- Changing search, scope, or filters clears the selection and drops the preview. Sort does not. A cleared row selection never posts `target: {}` (that would mean every involved object). Only Select all matching these filters may send `{}`.
- `last_read_at` is a floor that can lag about a day. Never label it unread. The Last read column still shows that floor. Hub filters and `POST /account/cleanup` do not take `last_read_before`; that cutoff stays on `/admin`.
- Per-item Change expiration and `/admin` are unchanged. Do not drive `#ttl-dlg` or `/admin` for this recipe.
- `expire` keeps a 30-minute grace. After confirm, `#messages` reads `Set a 30-minute grace on N objects.` not `Set expiry`. Finish the recipe before those objects 410, or skip Expire soon if the clock is tight.
- `/v1/cleanup` behavior does not change. If `openapi-drift` fails, a `/v1` surface landed by mistake.
