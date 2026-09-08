# Hub cleanup

A signed-in person retires their own catalog work in bulk from the hub. Filters find never-expiring, largest, oldest, or long-unread rows. Checkboxes or Select all matching these filters choose the target. Set expiry, Expire soon, or Delete then uses the same preview and count-to-confirm as `/admin`. The hub POST is `/account/cleanup` (Access, trusted Origin). It calls the same engine as `POST /v1/cleanup` without the admin flag, so involvement and `canMutate` keep other people's work out.

## Sub-features

- `hub-cleanup-select` is a checkbox on each catalog row (`#catalog-select-file-{id}`, `#catalog-select-site-{id}`) and Select visible (`#catalog-select-files` / `#catalog-select-sites`).
- `hub-cleanup-matching` is `#catalog-select-matching`. The target is the current catalog filters (`q`, `scope`, `expires`, dates, `min_size`), not the loaded page of ids. Unchecking a row after matching turns the target into the remaining visible ids.
- `hub-cleanup-bar` is `#catalog-cleanup`, shown once something is selected. `#catalog-cleanup-action` offers Set expiry (pressed by default), Expire soon, and Delete (`aria-pressed="false"` until chosen). `#catalog-cleanup-ttl` is required for Set expiry. `#catalog-cleanup-preview` POSTs `/account/cleanup` without `confirm`.
- `hub-cleanup-preview` returns `executed: false` with matched, eligible, skipped, bytes, sample (`#catalog-cleanup-sample`), and a 32-hex `confirm`. Last read cells read `No recorded read` (never "unread").
- `hub-cleanup-confirm` is `#catalog-cleanup-confirm` then `#catalog-cleanup-dlg`. Type `{n} objects` to execute. Cancel leaves the catalog unchanged.
- `hub-cleanup-drift` is `409 cleanup_drift` when the selection (or action) changed between preview and execute. The dialog says the selection changed. Review the new count and confirm again.
- `hub-cleanup-human` is Access plus Origin. A missing Origin is `403 bad_origin`. `set_ttl` without `ttl` is `400 ttl_required` (the admin 7-day omit-ttl default does not apply). Localhost skips Access and uses `DEV_ACCESS_EMAIL`; a Bearer token is not a hub actor.

## How to get to it (user POV)

- Open `$ORIGIN/`. Narrow with `#catalog-filters`. Check rows, or choose `Select all matching these filters`.
- Choose Set expiry (default) or Expire soon or Delete. Preview. Read matched / eligible / skipped / bytes and the sample. Type the eligible count. Confirm.
- Per-item Change expiration (`#ttl-dlg`) and `/admin` stay separate.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for this Energon (`bin/mint-token vhubclean`).
- `$HANDLE` is the bootstrap handle.
- This local Energon keeps content forever by default, so fixtures created without `ttl` match `expires=never`.
- Every fixture name starts with `vhubclean` so `q=vhubclean` keeps other recipes out.

- **Fixtures.** Publish six files and one site with mixed TTLs and sizes. `POST $ORIGIN/v1/files` with Bearer `$TOKEN` and `content-type: text/plain`:
  - `vhubclean-a.md` body `a` (never expires, small)
  - `vhubclean-b.md` body `bbbbbbbbbbbbbbbbbbbb` (never expires, larger)
  - `vhubclean-c.md` body `c` (never expires, small)
  - `vhubclean-d.md` body `dddddddddddddddddddddddddddddd` (never expires, largest of the never set)
  - `vhubclean-e.md` with `X-Energon-TTL: 1h` body `e` (expiring)
  - `vhubclean-f.md` with `X-Energon-TTL: 1d` body `ffffffffffffffff` (expiring, medium)
  Record ids `$ID_A` … `$ID_F`. `POST $ORIGIN/v1/sites` `{"slug":"vhubclean-site"}` then PUT `index.md` so the site has size. Record `$SITE_ID`. All `201`. Save create JSON under `$EVIDENCE/hub-cleanup/`.
- **Filter never-expiring, select three, set expiry.** Open `$ORIGIN/?q=vhubclean`. Choose `Never expires` in `#catalog-expires`. Wait for `/account/data?q=vhubclean&expires=never`. Check three never-expiring files (`#catalog-select-file-$ID_A`, `$ID_B`, `$ID_C`). `#catalog-cleanup` is visible. `#catalog-cleanup-action` has Set expiry pressed and Delete not pressed. Choose `7d` in `#catalog-cleanup-ttl` if it is not already selected. Preview `#catalog-cleanup-preview`. `#catalog-cleanup-sample` names those three. Eligible is `3`. Screenshot with Energon and `#who` visible. Choose `#catalog-cleanup-confirm`. In `#catalog-cleanup-dlg` type `3 objects` and confirm. Catalog Expires cells for those three become dates. `GET $ORIGIN/v1/files?q=vhubclean` with Bearer `$TOKEN` shows `expires_at` set on a, b, and c, still null on d.
- **Filter by size, select all matching, delete cancel then confirm.** Clear Never expires. Choose `Size` in `#sort`. Fill `#catalog-min-size` with a value that matches only the largest remaining never-expiring file (`vhubclean-d.md`; try `15b` or whatever the list JSON `size` requires). Wait for `/account/data`. Choose `#catalog-select-matching`. Preview. Switch `#catalog-cleanup-action` to Delete. Preview again. `#catalog-cleanup-sample` names `vhubclean-d.md`. Open `#catalog-cleanup-dlg`, choose Cancel. `GET $ORIGIN/v1/files?q=vhubclean-d` still `200`. Open confirm again, type the eligible count, confirm. That file is gone from the catalog. `GET $ORIGIN/v1/files?q=vhubclean-d` is `total` `0`. `GET $ORIGIN/v1/files/$ID_D` is `404`.
- **Confirm-hash drift.** Check two remaining files. Preview Set expiry. Uncheck one row so the selection no longer matches the preview. Confirm with the old dialog (or Preview's confirm against the new target). Status `409`, dialog copy `The selection changed since this preview`. The catalog is unchanged. Preview again and confirm the new count to finish, or Cancel.
- **HTTP twin.** `POST $ORIGIN/account/cleanup` with Access and `origin: $ORIGIN` previews the same shape as `/v1/cleanup`. Omit Origin: `403 bad_origin`. `{ "target": { "files": ["$ID_A"] }, "action": "set_ttl" }` without `ttl`: `400 ttl_required`.
- **Proof.** Screenshots of never-expires selection + preview, Expires after set expiry, delete cancel vs gone catalog, and the drift dialog. Saved `/account/cleanup` and `/v1/files` JSON for each step.

## Gotchas

- Delete is never preselected. Leave Set expiry pressed unless the recipe says to switch.
- Hub `set_ttl` always sends `ttl`. Do not copy the admin omit-ttl 7-day default.
- `#catalog-cleanup` is in the HTML even when hidden. Drive it after a selection so it is visible.
- Matching follows the current filters, including rows not yet loaded. Unchecking one row after matching keeps only the remaining *visible* ids.
- Changing search, scope, or filters clears the selection and drops the preview. Sort does not. A cleared row selection never posts `target: {}` (that would mean every involved object). Only Select all matching these filters may send `{}`.
- `last_read_at` is a floor that can lag about a day. Never label it unread.
- Per-item Change expiration and `/admin` are unchanged. Do not drive `#ttl-dlg` or `/admin` for this recipe.
- `expire` keeps a 30-minute grace. Finish the recipe before those objects 410, or skip Expire soon if the clock is tight.
- `/v1/cleanup` behavior does not change. If `openapi-drift` fails, a `/v1` surface landed by mistake.
