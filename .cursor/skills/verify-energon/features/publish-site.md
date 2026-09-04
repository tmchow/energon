# Publish a site

Publish a site lets a user create a named folder of files at a stable `/{handle}/s/{slug}/` URL, add or replace paths, see a 409 instead of a silent overwrite, and copy the site under a new slug.

## Sub-features

- `site-create` creates an empty site for a new slug and returns `url` plus `api_url`.
- `site-put-file` writes a path and serves it at the public site URL.
- `site-homepage` serves `index.html`, or `index.md` when `index.html` is missing.
- `site-mermaid` renders mermaid fences on HTML markdown views from `/static/mermaid/mermaid.esm.min.mjs` (no jsDelivr).
- `site-conflict` returns 409 when the slug exists and `overwrite` is omitted.
- `site-overwrite` claims an existing slug without deleting other paths.
- `site-duplicate` copies into a new slug owned by the caller.
- `site-hub` stages a folder or zip on the hub and publishes with Publish.

## How to get to it (user POV)

- `POST /v1/sites` with JSON `{ "slug": "<slug>" }`, then `PUT /v1/sites/{slug}/files/{path}`.
- Hub: choose `Choose folder` or drop a folder/zip, edit the `Site slug` field, choose `Publish`.
- Hub: choose `More actions` on a site row, then `Duplicate`.
- Open `/{handle}/s/{slug}/` in a browser or `curl`.

## Driving it with energon-verify

Preconditions:

- Doctor has passed for `$ORIGIN`.
- `TOKEN` is a minted `ee_live_` secret for this instance.
- `$HANDLE` is the bootstrap handle (usually `dev`).
- No site is slugged `verify-site` or `verify-site-copy`.

- **Create site.** Run `curl -sS -o "$EVIDENCE/publish-site/create.json" -w '%{http_code}' -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-site"}'`. Status `201`. Body `url` is `$ORIGIN/$HANDLE/s/verify-site/` and `created` is true.
- **Write homepage.** Run `curl -sS -o "$EVIDENCE/publish-site/put.json" -w '%{http_code}' -X PUT "$ORIGIN/v1/sites/verify-site/files/index.html" -H "Authorization: Bearer $TOKEN" -H "content-type: text/html" --data '<h1>verify-site-ok</h1>'`. Status `201`. Body `url` ends with `/s/verify-site/index.html`.
- **Public GET.** Run `curl -sS -o "$EVIDENCE/publish-site/public.html" -w '%{http_code}' "$ORIGIN/$HANDLE/s/verify-site/"`. Status `200`. Body contains `verify-site-ok`. Content-Type is HTML.
- **Mermaid HTML.** PUT `diagram.md` with a `mermaid` fence (`graph LR` / `A-->B`). `GET "$ORIGIN/$HANDLE/s/verify-site/diagram.md"` with `Accept: text/html` contains `class="mermaid"` and `/static/mermaid/mermaid.esm.min.mjs`, and does not contain `jsdelivr`. `GET "$ORIGIN/static/mermaid/mermaid.esm.min.mjs"` is `200` JavaScript.
- **API GET.** Run `curl -sS -o "$EVIDENCE/publish-site/api.html" -w '%{http_code}' "$ORIGIN/v1/sites/verify-site/files/index.html" -H "Authorization: Bearer $TOKEN"`. Status `200`. Body matches the PUT.
- **Conflict.** Run the create POST again without `overwrite`. Status `409`, `error` is `site_exists`, `url` still points at the existing site, `hint` mentions overwrite.
- **Overwrite keeps other paths.** PUT `notes.md` with body `keep-me`, then `POST /v1/sites` with `{"slug":"verify-site","overwrite":true}` (status `200`, `created` false), then PUT a new `index.html`. `GET /v1/sites/verify-site` lists both `index.html` and `notes.md`.
- **Duplicate.** Run `curl -sS -X POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-site-copy","duplicate_from":"verify-site"}'`. Status `201`. `GET $ORIGIN/$HANDLE/s/verify-site-copy/` contains the current homepage. The original slug still serves.
- **Hub entry.** Open `$ORIGIN/`. Choose `Choose folder` and set files on `#folderpick` (or `Choose files` with more than one file). `#stage` is visible, `#stage-slug` is filled, `Publish` is enabled. Set slug `verify-hub-site` and choose `Publish`. `#messages` contains a link to `/$HANDLE/s/verify-hub-site/` and the Sites table has a `verify-hub-site` link.
- **Proof.** Save create/put/public artifacts under `$EVIDENCE/publish-site/`. Browser proof: screenshot of the hub Sites table showing `verify-site` with `#who` equal to the doctor email.

## Gotchas

- A 201 on POST/PUT is not enough. GET the public `/{handle}/s/{slug}/` URL.
- `index.md` is the homepage only when `index.html` is absent.
- Trailing slash: `GET /{handle}/s/{slug}` without a slash 302s to the slashed URL. Assert the slashed form.
- Never send `"overwrite": true` on the first create. The 409 is the proof that last-write-wins does not apply to the slug itself.
- Overwrite does not wipe files. A proof that only checks `index.html` after overwrite misses a regression that deleted siblings.
- `duplicate_from` plus `overwrite` is 400. Pick a new slug.
- Hub Publish on an existing slug first suggests a numbered slug; Publish again on the original slug becomes `Write into it`. That second click is overwrite, not a new site.
- Local published URLs use `$ORIGIN`, not `https://energon.example.com`. If `url` in JSON points at the placeholder host, doctor missed an origin mismatch.
