# Hub catalog

Hub catalog lets a signed-in human see sites and files they created or last wrote, search slugs and filenames, filter created vs edited, open the public URL, and delete an object after typing its name.

## Sub-features

- `catalog-list` shows Sites and Files cards with counts, last writer, updated time, and expires when a date is set.
- `catalog-empty` shows `No sites yet` / `No files yet` when the signed-in user has none.
- `catalog-search` filters by slug or filename through `#q`.
- `catalog-scope` switches Your work / Created by you / Last edited by you.
- `catalog-open` follows the slug or filename link to the public URL.
- `catalog-delete` removes the object after typing the exact name.

## How to get to it (user POV)

- Open `$ORIGIN/` (Hub).
- Type in `Search slugs and filenames`.
- Choose `Your work`, `Created by you`, or `Last edited by you` in the scope control.
- Choose the slug/filename link, `Copy URL`, `Delete`, or `More actions`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed. At least one site `verify-site` and one file exist from the publish recipes, or create them first.
- Search query `verify-site` matches that site and not an unrelated seeded name.

- **Empty (optional, fresh persist).** On a brand-new launch before any publish, `#sites` contains `No sites yet` and `#files` contains `No files yet`. `#who` shows the doctor email.
- **List after publish.** Open `$ORIGIN/`. Sites table has a row whose name link text is `verify-site` and whose Last writer cell matches the email. There is no Created by column. Unlimited rows do not show Never in the slug cell. If the site expires, the Expires cell has a date. The Sites card heading includes a non-empty count.
- **Search.** Fill `#q` with `verify-site`. Wait for the 200ms debounce and a new `/account/data?q=verify-site` request. The Sites table contains `verify-site` and does not contain a slug that does not match. Clear `#q` to restore the full list.
- **Scope.** Choose `Created by you`. The `verify-site` you minted stays visible. Choose `Last edited by you` only if a second actor exists; on a single-user local run this may be empty — record that, do not treat it as a missing site.
- **Open public URL.** Choose the `verify-site` link. The next document is `$ORIGIN/$HANDLE/s/verify-site/` and contains the published homepage.
- **Copy URL.** Choose `Copy URL` on that row. Clipboard (or the button `aria-label` flipping to `Copied`) holds `$ORIGIN/$HANDLE/s/verify-site/`.
- **HTTP list.** `GET $ORIGIN/v1/sites?q=verify-site` with Bearer token returns the same slug. `GET $ORIGIN/account/data?q=verify-site` returns it without a token header on localhost.
- **Delete.** Choose `Delete`. Dialog title `Delete site`. Type `verify-site` (mismatch shows `Type the exact name.`). Confirm. Catalog no longer has that link. Public GET of the old URL is 404 (or 410 if expired — not this recipe).
- **Proof.** Screenshot of the hub with `verify-site` listed and `#who` visible; saved `/account/data` JSON; after delete, a 404 body for the public URL.

## Gotchas

- Lists are not a company catalog. They only include what this identity created or last wrote. A 200 empty list is not a failed publish if you used a different email.
- Search debounce is 200ms. Assert the filtered table (or the `q=` network response), not a keystroke.
- Scope `involved` is the Your work button inside `#scope`; the selected button has `aria-pressed="true"`.
- Delete requires the exact slug or filename. Cancel leaves the object in place — confirm with a GET.
- `Load more` appears only when a cursor is present. Do not treat a short list as a pagination bug.
- Opening the public link leaves the hub. Re-open `$ORIGIN/` before another catalog assertion.
- Password marks: view-password-only is a padlock (`View password`). Any write password is the lockup (`Write password`). Neither hash: no password mark. More still offers `Set password`. No Password chip next to the slug.
