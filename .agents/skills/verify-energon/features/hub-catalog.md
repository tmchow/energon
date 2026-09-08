# Hub catalog

Hub catalog lets a signed-in human see sites and files they created or last wrote, search slugs and filenames, filter created vs edited, never-expiring / oldest / largest, open the public URL, change expiration, and delete an object after typing its name.

## Sub-features

- `catalog-list` shows Sites and Files cards with counts, last writer, updated time, last read (floor; empty cell `No recorded read`, never "unread"), and expires when a date is set.
- `catalog-empty` shows `No sites yet` / `No files yet` when the signed-in user has none, and `No matching sites` / `No matching files` when search or filters match nothing.
- `catalog-search` filters by slug or filename through `#q`.
- `catalog-scope` switches Your work / Created by you / Last edited by you.
- `catalog-sort` orders by Updated, Name, Size, or Oldest (`#sort`).
- `catalog-filters` narrows through `#catalog-filters`: `#catalog-expires` Any / Never expires, `#catalog-expires-before`, `#catalog-updated-before`, `#catalog-min-size`. The same query string drives `GET /account/data` and hub SSR (`?expires=never&sort=size`). Last read is a column only; `last_read_before` stays on `/admin`.
- `catalog-open` follows the slug or filename link to the public URL.
- `catalog-delete` removes the object after typing the exact name.
- `catalog-expire` lets a mutator change expiration from More → Change expiration; the new timer starts now; catalog Expires and listing `expires_at` update.
- `catalog-select` is row checkboxes (`#catalog-select-file-{id}`, `#catalog-select-site-{id}`) plus `#catalog-select-matching`. Bulk actions are [Hub cleanup](./hub-cleanup.md).

## How to get to it (user POV)

- Open `$ORIGIN/` (Hub).
- Type in `Search slugs and filenames`.
- Choose `Your work`, `Created by you`, or `Last edited by you` in the scope control.
- Choose Updated / Name / Size / Oldest in `#sort`.
- Narrow with `#catalog-expires` (`Never expires`), last written before, or minimum size.
- Choose the slug/filename link, `Copy URL`, `Delete`, or `More actions` (`Change expiration` for mutators).

## Driving it with energon-verify

Preconditions:

- `bin/up` passed. At least one site `verify-site` and one file exist from the publish recipes, or create them first.
- Search query `verify-site` matches that site and not an unrelated seeded name.

- **Default — HTTP list.** `GET $ORIGIN/v1/sites?q=verify-site` with Bearer `$TOKEN` returns that slug and `id`. `GET $ORIGIN/account/data?q=verify-site` returns it without a token header on localhost. Public GET `$ORIGIN/$HANDLE/s/<id>/verify-site/` contains the published homepage. Do not delete `verify-site` (other recipes reuse it).
- **Extra (catalog-empty / catalog-search / catalog-delete / Hub.svelte) — Hub UI.** Empty persist copy, `#q` debounce (200ms), `#scope`, `#catalog-expires`, `#sort`, Copy URL, `#ttl-dlg`, Delete dialog (mint a dedicated `verify-catalog-del` site first). Drive when Hub.svelte catalog controls change.
- **Proof.** Default: saved `/account/data` JSON and public GET of the listed URL. Screenshot only for Extra hub.

## Gotchas

- Lists are not a company catalog. They only include what this identity created or last wrote. A 200 empty list is not a failed publish if you used a different email.
- Search debounce is 200ms. Assert the filtered table (or the `q=` network response), not a keystroke.
- Scope `involved` is the Your work button inside `#scope`; the selected button has `aria-pressed="true"`.
- Delete requires the exact slug or filename. Cancel leaves the object in place — confirm with a GET.
- `Load more` appears only when a cursor is present. Do not treat a short list as a pagination bug.
- A malformed `#catalog-expires-before`, `#catalog-updated-before`, or `#catalog-min-size` value shows an inline error under the field and the hub does not send the query. The server still ignores malformed filters when they arrive through the URL. `#catalog-status` is a visually hidden live region that announces the counts after each load.
- Catalog load failures appear as a dismissable flash with a `Try again` button. Every hub flash has a `Dismiss` control and the list keeps at most six.
- Opening the public link leaves the hub. Re-open `$ORIGIN/` before another catalog assertion.
- Password marks: view-password-only is a padlock (`View password`). Any write password is the lockup (`Write password`). Neither hash: no password mark. More still offers `Set password`. No Password chip next to the slug.
- Change expiration measures the new TTL from now, not from the original publish. `never` appears only when this Energon's policy allows unlimited. The control is hidden when `write_policy` is owner and you are not the creator.
