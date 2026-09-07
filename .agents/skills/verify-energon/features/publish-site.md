# Publish a site

Publish a site lets a user create a named folder of files at a stable `/{handle}/s/{id}/{slug}/` URL, add or replace paths, and copy the site under a new slug. The id is the capability key; slugs are labels and may repeat.

## Sub-features

- `site-create` creates an empty site and returns `id`, `url` (with id in the path), plus later `api_url` on PUT.
- `site-put-file` writes a path under `/v1/sites/{id}/files/{path}` and serves it at the public site URL.
- `site-homepage` serves `index.html`, or `index.md` when `index.html` is missing.
- `site-mermaid` renders mermaid fences on HTML markdown views from `/static/mermaid/mermaid.esm.min.mjs` (no jsDelivr).
- `site-duplicate-slug` always creates a new site (new id) even when the slug matches an existing site.
- `site-duplicate` copies from a source **id** into a new site owned by the caller.
- `site-hub` stages a folder or zip on the hub and publishes with Publish.

## How to get to it (user POV)

- `POST /v1/sites` with JSON `{ "slug": "<slug>" }`, read `id` from the body, then `PUT /v1/sites/{id}/files/{path}`.
- Hub: choose `Choose folder` or drop a folder/zip, edit the `Site slug` field, choose `Publish`.
- Hub: choose `More actions` on a site row, then `Duplicate`.
- Open `/{handle}/s/{id}/{slug}/` in a browser or `curl`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for this Energon.
- `$HANDLE` is the bootstrap handle (usually `dev`).
- No site is slugged `verify-site` or `verify-site-copy`.

- **Create site.** Run `curl -sS -o "$EVIDENCE/publish-site/create.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-site"}'`. Status `201`. Body has a 6-character alphanumeric `id`. Body `url` is `$ORIGIN/$HANDLE/s/<id>/verify-site/` and `created` is true.
- **Write homepage.** Set `SITE_ID` from `create.json`. Run `curl -sS -o "$EVIDENCE/publish-site/put.json" -w '%{http_code}' -X PUT "$ORIGIN/v1/sites/$SITE_ID/files/index.html" -H "Authorization: Bearer $TOKEN" -H "content-type: text/html" --data '<h1>verify-site-ok</h1>'`. Status `201`. Body `url` ends with `/s/$SITE_ID/verify-site/index.html`.
- **Public GET.** Run `curl -sS -o "$EVIDENCE/publish-site/public.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/$SITE_ID/verify-site/"`. Status `200`. Body contains `verify-site-ok`. Content-Type is HTML.
- **Slug-only 404.** `GET "$ORIGIN/v1/sites/verify-site"` with the token is `404`. `GET "$ORIGIN/$HANDLE/s/verify-site/"` is `404`.
- **Mermaid HTML.** PUT `diagram.md` with a `mermaid` fence (`graph LR` / `A-->B`). `GET "$ORIGIN/$HANDLE/s/$SITE_ID/verify-site/diagram.md"` with `Accept: text/html` contains `class="mermaid"` and `/static/mermaid/mermaid.esm.min.mjs`, and does not contain `jsdelivr`. `GET "$ORIGIN/static/mermaid/mermaid.esm.min.mjs"` is `200` JavaScript.
- **API GET.** Run `curl -sS -o "$EVIDENCE/publish-site/api.html" -w '%{http_code}' "$ORIGIN/v1/sites/$SITE_ID/files/index.html" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body matches the PUT.
- **Duplicate slug creates.** Run the create POST again with the same slug. Status `201`, `created` true, and `id` differs from `SITE_ID`.
- **Duplicate.** Run `curl -sS -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data "{\"slug\":\"verify-site-copy\",\"duplicate_from\":\"$SITE_ID\"}"`. Status `201`. Read the copy `id`. `GET $ORIGIN/$HANDLE/s/<copy-id>/verify-site-copy/` contains the current homepage. The original id still serves.
- **Hub entry.** Open `$ORIGIN/`. Choose `Choose folder` and set files on `#folderpick` (or `Choose files` with more than one file). `#stage` is visible, `#stage-slug` is filled, `Publish` is enabled. Set slug `verify-hub-site` and choose `Publish`. `#messages` contains a link whose href includes `/s/<id>/verify-hub-site/` and the Sites table has a `verify-hub-site` link.
- **Proof.** Save create/put/public artifacts under `$EVIDENCE/publish-site/`. Browser proof: screenshot of the hub Sites table showing `verify-site` with `#who` equal to the doctor email.

## Gotchas

- A 201 on POST/PUT is not enough. GET the public `/{handle}/s/{id}/{slug}/` URL.
- `index.md` is the homepage only when `index.html` is absent.
- Trailing slash: `GET /{handle}/s/{id}/{slug}` without a slash 302s to the slashed URL. Assert the slashed form.
- Same slug does not mean same site. Always use the returned `id` for PUT/PATCH/DELETE.
- `duplicate_from` is the source **id**, not the slug. Combined with `overwrite` is 400.
- Hub Publish always creates a new site. To update an existing site, use catalog actions on that site's id or PUT via `/v1`.
- Local published URLs use `$ORIGIN`, not `https://energon.example.com`. If `url` in JSON points at the placeholder host, doctor missed an origin mismatch.
