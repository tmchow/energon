---
name: energon
description: Share files and small sites on Energon (https://energon.example.com) so work can leave a session. Use when the user wants to publish a prototype, hand a markdown/image/PDF to another person or agent, put a doc on a stable internal URL, fetch something already on Energon, mint or use ENERGON_TOKEN, or mentions Energon / energon.example.com. Never invent a token. Never overwrite an existing slug without the human confirming.
---

# Energon

Energon is how work leaves a session at your company. Put a prototype, a markdown doc, or a single file on an internal URL. The hub is behind Cloudflare Access. Published `/sites` and `/files` links are not — anyone with the URL can open them unless you set an optional share password. Agents publish and fetch over HTTP with a token.

You are moving **something someone made** to **someone who is not in this filesystem**. Ask when a slug collides. When you are done, give the human `url` and, if another agent will read it, `api_url`.

Load [references/api.md](references/api.md) only if you need exact routes or error shapes.

This skill is bound to **https://energon.example.com**. Do not send traffic to another Energon host. A public instance and a private instance are different skills with different names — install `energon@energon` for this one.

## Hard rules

1. Look for env `ENERGON_TOKEN`. If it is missing, **stop and tell the human** to open https://energon.example.com/tokens, mint a token, and export it. Do **not** invent a token. Do **not** reuse a token you saw in chat history unless they just pasted it. A token that has expired (`401` with `error: token_expired`) is the same stop: it cannot be renewed; the human mints a new one.
2. Never default to `overwrite: true`.
3. Never pick a slug that already exists without the human confirming.
4. Last write wins **on that path only**. Putting a file does not delete other files. There is no merge, no comments, no presence.
5. Published `/sites` and `/files` URLs are **not** behind Access. Anyone with the link can open them unless you set a share password. Agents can GET the human URL (send `X-Energon-Password` if set) or use `api_url` (`GET /v1/...`) with their token — token reads skip the share password.
6. Default is **no password**. Set one only if they ask. Write responses echo the password you just set so you can tell them. GET never returns it — only a hash is stored. Do **not** write it into the published file. Change with `PATCH` `{ "password": "new" }`; clear with `PATCH` `{ "password": "" }`.
7. Always return the URL(s). Do not keep the token or the share password in a file you publish. Do not keep the token in your reply.
8. If you are confused, `GET https://energon.example.com/v1/help` or `GET https://energon.example.com/llms.txt` (no auth). Trust that document for this instance's retention presets and skill name. For exact request and response schemas, status codes, and error codes, `GET https://energon.example.com/v1/openapi.json` (OpenAPI 3.1, no auth).
9. `GET /v1/sites` and `GET /v1/files` list only what **you** created or last wrote. To find something Bob created that you edited: `?created_by=bob@example.com&scope=edited`. Do not expect a company-wide catalog. You can still GET a known `/{handle}/s/{slug}` or `/{handle}/f/{id}` URL.
10. Pass `ttl` on create unless the human wants this instance's default. `GET /v1/help` → `retention` is the source of truth. `PUT` does not extend expiry. `PATCH { "ttl": "7d" }` resets from now. Expired URLs are `410`.

Auth on every `/v1` call except `/v1/help`, `/v1/health`, and `/v1/openapi.json`:

```
Authorization: Bearer $ENERGON_TOKEN
```

Tokens look like `ee_live_…`.

## Decide: site or loose file?

| They want… | You do… |
| --- | --- |
| A browsable prototype, poll, or HTML/CSS/JS folder | **Site** (stable slug). Prefer `index.html` at the root. |
| Several files that belong together, or a doc plus assets | **Site**. Same slug, PUT each path. |
| One screenshot, PDF, markdown file, or a zip that should stay a zip | **Loose file**. `POST /v1/files` once, then `PUT /v1/files/{id}` to revise. Same URL. |
| “Give this to the other agent / my other machine / this other chat” | Loose file if it is one file. Site if it is a folder. |
| “Host this build output” | **Site**, often via zip import |

Do **not** create a site for a single screenshot. Do **not** POST a new loose file every time they say “update it” — PUT the same id. Do **not** PUT a new path on a site when they meant to replace `notes.md`.

This is not Google Docs. Do not wrap markdown in a fake editor. Leave `.md` as markdown. Browsers render it. Agents should fetch the source with `curl` or `?raw=1` (not a `/raw` path). `index.md` is a valid homepage when `index.html` is missing.

Ask for a slug if they did not give one. Suggest a short kebab-case name (`lunch-poll`, `ios-onboarding-v3`). Slugs are `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`. Reserved **handles** (not slugs): `v1`, `account`, `static`, `health`, `about`, `stats`.

## Scenario A — Host a prototype

They have HTML or a small static folder and want someone to click it.

1. Confirm a slug (“Use `onboarding-draft`?”).
2. `POST /v1/sites` with `{"slug":"onboarding-draft","overwrite":false}` and a `ttl` from `/v1/help` `retention.presets` unless they want the instance default.
3. On **201**, PUT files. `index.html` at site root makes `/sites/{slug}/` render the page.
4. On **409**, go to Scenario E. Do not PUT yet.
5. Hand them `https://energon.example.com/{handle}/s/{slug}/`.

```bash
curl -sS https://energon.example.com/v1/sites \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"onboarding-draft","overwrite":false,"ttl":"7d"}'

curl -sS https://energon.example.com/v1/sites/onboarding-draft/files/index.html \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: text/html" \
  --data-binary @index.html
```

A site does **not** need `index.html`. `index.md` is the homepage if `index.html` is missing. If you only PUT `notes.md`, `/{handle}/s/{slug}/` shows a file list and `/{handle}/s/{slug}/notes.md` serves the file (rendered in a browser, raw to `curl` / `?raw=1`).

## Scenario B — Hand a file to another session

They (or you) made an image, PDF, markdown file, or zip in this session. Someone else — a human, or an agent on another machine — needs the bytes.

Do **not** create a site.

```bash
curl -sS https://energon.example.com/v1/files \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "X-Filename: screenshot.png" \
  -H "X-Energon-TTL: 7d" \
  -H "content-type: image/png" \
  --data-binary @screenshot.png
```

Response is `{ url, api_url, id, filename, size, ttl, expires_at }`.

- Human: `url` (`/{handle}/f/{id}/{filename}`).
- Other agent: that same URL, or `api_url` (`GET /v1/files/{id}` with **their** token). If you set a share password, the human URL needs header `X-Energon-Password`.

A `.zip` posted here stays a zip.

To revise the same file later, **do not POST again**. Replace it:

```bash
curl -sS https://energon.example.com/v1/files/{id} \
  -X PUT \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "X-Filename: screenshot.png" \
  -H "content-type: image/png" \
  --data-binary @screenshot.png
```

`url` and `api_url` stay the same. Expiry does **not** move. The other agent already has them.

The receiving agent:

```bash
curl -sS https://energon.example.com/v1/files/{id} \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -o screenshot.png
```

## Scenario C — Share a living markdown doc

They want a brief, RFC-ish note, or meeting doc that people and agents will keep writing. Google Docs is the wrong tool for markdown. Energon is a file, not an editor.

If it is **one** markdown file, prefer a loose file (Scenario B) and PUT the same id. If it lives next to other files, use a site:

1. Confirm a slug (`ios-brief`).
2. Create or claim the site (Scenarios A/E).
3. `PUT /v1/sites/ios-brief/files/notes.md` with the markdown.
4. Give humans `https://energon.example.com/{handle}/s/ios-brief/notes.md` (browser page; `?raw=1` for source).
5. Give agents `https://energon.example.com/v1/sites/ios-brief/files/notes.md`.

Next edit is the same PUT. Last write wins. If two people save over each other, say so once — there is no merge. If they needed comments or suggestions, this is the wrong product; still publish if they want the link.

## Scenario D — Take turns on the same URL

The site (or path) already exists. They want a new version, or another agent should read then write.

1. `GET /v1/sites/{slug}` or `GET /v1/sites/{slug}/files/{path}` so you know what is there.
2. Do **not** delete the site. PUT only the paths that change.
3. A PUT to an unknown slug is **404**. Create first.

```bash
curl -sS https://energon.example.com/v1/sites/onboarding-draft/files/index.html \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: text/html" \
  --data-binary @index.html
```

This is the collaboration model: a shared slug, last write wins per path. Two agents, or a human and an agent, can take turns if they both know the path.

## Scenario E — Slug already exists (409)

`POST /v1/sites` without overwrite returns 409 with `url`, `last_written_by`, `updated_at`, `file_count`, and a `hint`. **Read that aloud to the human.**

Ask them:

- Pick a **new slug** (keeps both), or
- Retry with `"overwrite": true` to **claim** the existing bucket.

Overwrite claims the slug for further PUTs. It does **not** wipe files and does **not** change TTL unless you also send `ttl`. Only a later PUT to the same path replaces that path.

If they wanted a brand-new thing and the slug is taken, prefer a new slug (`onboarding-draft-2`). To **copy** an existing site or file onto a new URL, use Scenario I — do not GET+PUT every path through context.

## Scenario F — Folder is easier as a zip

1. Create or claim the slug (A/E). Import 404s if the slug does not exist.
2. Zip the folder. If every entry is under one wrapping directory (`my-site/index.html`), Energon strips that folder so `index.html` lands at the site root.
3. `POST /v1/sites/{slug}/import` with `Content-Type: application/zip`.
4. Zip body ≤ 25 MB; each extracted file ≤ 25 MB. `..` paths are rejected.

```bash
curl -sS https://energon.example.com/v1/sites/onboarding-draft/import \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: application/zip" \
  --data-binary @site.zip
```

To download a site back as a zip (same 25 MB / file-count caps; empty site is 400):

```bash
curl -sS https://energon.example.com/v1/sites/onboarding-draft/export \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -o onboarding-draft.zip
```

A single file is never a zip. `GET /v1/files/{id}?download=1` (or the public URL with `?download=1`) returns the file with `Content-Disposition: attachment`.

## Scenario G — No token, expired token, or 401

401 messages point at https://energon.example.com/tokens. Tell the human:

1. Open that page while signed in.
2. Mint a token with a label (`laptop`, `ci`) and a lifetime (default 3 months).
3. Copy it **now** — it is shown once.
4. `export ENERGON_TOKEN=ee_live_…` (or add it to their secret store).

Then retry with the **new** token. Do not scrape HTML for a token. Do not mint from the API; only humans mint, via the hub.

If the 401 body has `error: token_expired`, the token passed its lifetime. It cannot be extended and there is no renew call: do not retry with it, do not invent a replacement, hand the human the steps above. `GET /v1/whoami` returns your token's `expires_at` (`null` means never) if you want to warn the human before it happens.

## Scenario H — Too big, password, or TTL

413 on a file or zip: over the **25 MB** cap. Shrink, split, or put large media elsewhere.

413 `storage_cap`: the 20 GB platform safety valve. Suggest deleting an old site (`DELETE /v1/sites/{slug}` — no recycle bin) after they confirm.

Who can write is per site or file: `owner` (only the creator) or `instance` (any token on this host). New objects copy this instance's default (`/v1/help` `retention.write_policy`) unless you set `write_policy` on create. Anyone with a token can still **read** via `/v1`, including password-protected links. `PATCH write_policy` is creator-only. A share password only gates the public `/sites` and `/files` URL.

Content **does** expire when the instance requires a TTL (or when the human picked one). Cron deletes expired R2 + D1 rows. A GET of an expired URL is `410` and then that object is purged. Ask `/v1/help` `retention` before assuming `never` is allowed.

If they want a password on the public link:

```bash
# site
curl -sS https://energon.example.com/v1/sites \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"private-draft","overwrite":false,"password":"the-password","ttl":"7d"}'

# or later
curl -sS https://energon.example.com/v1/sites/private-draft \
  -X PATCH \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: application/json" \
  -d '{"password":"the-password"}'

# loose file
curl -sS https://energon.example.com/v1/files \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "X-Filename: notes.md" \
  -H "X-Energon-Set-Password: the-password" \
  -H "X-Energon-TTL: 7d" \
  --data-binary @notes.md
```

Tell them the password. Agents that fetch the human URL send `-H "X-Energon-Password: the-password"`. Empty `"password":""` or an empty set-password header clears it.

If they asked for real ACLs or named-user ownership, say Energon does not have those, then publish (with or without a password) if they still want the link.

## Scenario I — Make a copy

They want the same bytes under a **new** URL (fork an owner-locked site, copy a large file, edit one path after). Do **not** zip the site through context. Do **not** GET+PUT every path.

1. `POST /v1/sites` with `{"slug":"new-slug","duplicate_from":"existing-slug"}`.
2. Or `POST /v1/files` with `{"duplicate_from":"id"}` (optional `filename`).
3. You become `created_by`. `write_policy` is the instance default. Fresh TTL. Share password is not copied.
4. Anyone who can **read** via `/v1` can duplicate. A 403 on PUT of the original does not block this.

If you already have replacement bytes this turn, POST/PUT those as a new object. `duplicate_from` is only for “copy what is already on Energon.”

```bash
curl -sS https://energon.example.com/v1/sites \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"onboarding-draft-2","duplicate_from":"onboarding-draft"}'
```

## After you publish

Give:

- The human `url`
- The share password if you set one
- When it expires (`expires_at` / the `ttl` they picked)
- The agent `api_url` if another session will fetch it (or the human URL plus the password header)
- What you did (created vs claimed, files written)
- If a 409 happened, what they chose

Do not dump the whole API. Do not keep the token in your reply.

## When you get stuck

`GET https://energon.example.com/v1/help` then follow its `sop` array. Route details: [references/api.md](references/api.md). Exact schemas: `GET https://energon.example.com/v1/openapi.json`.
