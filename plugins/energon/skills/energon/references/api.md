# Energon API (load on demand)

Base: `https://energon.example.com/v1`  
Auth: `Authorization: Bearer ee_live_…` (`ENERGON_TOKEN`)  
Unauthenticated: `GET /v1/help`, `GET /v1/health`, `GET /v1/openapi.json`

This page is the short form. The full contract (every path, request and response schema, status code, and `error` code) is `GET https://energon.example.com/v1/openapi.json` (OpenAPI 3.1). `GET /v1/help` is this instance's identity: origins, token env, retention presets, token policy, limits.

Errors are JSON: `{ error, message, hub }` plus extra fields. `message` is written for agents to read aloud to humans.

The hub (`/`, `/account`) is behind Cloudflare Access. Published `/sites` and `/files` URLs are not. Anyone with the link can GET them unless a share password is set. Browsers get a form; agents send `X-Energon-Password`. Token `GET /v1/...` skips the share password. Publish responses include `url` (human) and `api_url` (agent). Writes that set a password echo it once plus `password_protected`. GET never returns the password — only a hash is stored.

This skill talks only to **https://energon.example.com**. Install a separately rendered skill for any other Energon host.

| Status | Typical `error` | What you do |
| --- | --- | --- |
| 401 | `unauthorized` | Stop. Send them to https://energon.example.com/tokens |
| 401 | `token_expired` | Terminal. The token passed its lifetime and cannot be extended. Do not retry with it; the human mints a new one at https://energon.example.com/tokens (`expired_at` and `tokens_url` are in the body) |
| 401 | `password_required` | Retry the human URL with `X-Energon-Password`, or use `api_url` with a token |
| 404 | `site_not_found` / `file_not_found` | Create the site first; never implicit-create. For files, check the path or id. |
| 409 | `site_exists` | Show `url` + last writer. Ask: new slug or `overwrite: true` |
| 410 | `expired` | Content passed `expires_at`. It is gone or about to be purged. Do not retry the same URL. |
| 413 | `too_large` / `storage_cap` | 25 MB file/zip, or 20 GB platform cap |

## Sites

```
POST   /v1/sites                         { "slug", "overwrite": false, "password"?: string, "ttl"?: string, "duplicate_from"?: slug }
PATCH  /v1/sites/{slug}                  { "password"?: string, "ttl"?: string }  empty password clears; ttl resets expiry from now
GET    /v1/sites/{slug}/files/{path}     raw bytes (token)
PUT    /v1/sites/{slug}/files/{path}     raw body (path may contain slashes). Does not extend expiry.
POST   /v1/sites/{slug}/import           application/zip
GET    /v1/sites/{slug}/export           zip of the site (token; skips share password)
GET    /v1/sites                         recent sites (`total`, `next_cursor`, `?limit=&cursor=`)
GET    /v1/sites/{slug}                  file listing (`url` + `api_url` per file)
DELETE /v1/sites/{slug}                  site + all objects (no recycle bin)
DELETE /v1/sites/{slug}/files/{path}     one path
```

Create `201` `{ slug, url, created: true, password_protected, password, ttl, expires_at }`. `password` is the phrase you just set, or `null`. `duplicate_from` copies an existing site onto the new slug (you own the copy; fresh TTL; password is not copied). Overwrite-claim of an existing slug is `200` `{ created: false }` and does not change TTL unless `ttl` is sent. PUT is `201` for a new path, `200` if replacing. PUT/GET file responses include `url` and `api_url`. GET listings have `password_protected` and `expires_at`.

Human URL: `https://energon.example.com/{handle}/s/{slug}/{path}`  
Agent URL: `https://energon.example.com/v1/sites/{slug}/files/{path}`  
Directory URL: `https://energon.example.com/{handle}/s/{slug}/` serves `index.html` if present, else a file list.

## Loose files

```
POST /v1/files           multipart field "file"  OR  raw body + header X-Filename
                         OR JSON { "duplicate_from", "filename"? }
                         optional X-Energon-Set-Password (or multipart field password)
                         optional X-Energon-TTL (or multipart field ttl)
                         optional X-Energon-Duplicate-From
PUT  /v1/files/{id}      replace bytes; optional X-Filename; same id and URL
                         optional X-Energon-Set-Password. Does not extend expiry.
PATCH /v1/files/{id}     { "password"?: string, "ttl"?: string }  empty password clears
GET  /v1/files           recent loose files (`total`, `next_cursor`, `?limit=&cursor=`)
GET  /v1/files/{id}      raw bytes (token). ?download=1 → attachment
DELETE /v1/files/{id}    delete the file (no recycle bin)
```

`201` `{ url, api_url, id, handle, filename, size, password_protected, password, ttl, expires_at }` on create. `password` is the phrase you just set, or `null`. `duplicate_from` copies an existing file to a new id. `200` `{ ..., replaced: true }` on PUT. Human URL: `/{handle}/f/{id}/{filename}`. Agent URL: `/v1/files/{id}`. PUT 404s if the id does not exist — there is no implicit create. GET listings have `password_protected` and `expires_at`.

## Retention

`GET /v1/help` → `retention` lists this instance's presets (human labels included), default, and whether `never` is allowed. Grammar for durations is `\\d+[smhd]`. `never` is a flag, not a duration.

Expired public and `/v1` reads are `410`. A cron sweep deletes the R2 objects and D1 rows so storage does not wait for a click.

## Token lifetime

Humans pick a lifetime when minting on https://energon.example.com/tokens. `GET /v1/help` → `tokens` lists the presets (`1d`…`365d`, plus `never` only when this instance allows it), the default (`90d`), `allow_never`, and `tokens_url`. This is separate from content `retention`. After expiry every `/v1` call is `401 token_expired`; there is no renew. `GET /v1/whoami` shows `expires_at` (`null` = never).

## Other

```
GET /v1/whoami        { email, label, expires_at }
GET /v1/help          this instance: SOP, limits, routes, retention, tokens, identity
GET /v1/health        { ok: true }
GET /v1/openapi.json  OpenAPI 3.1 contract for every route above
```

Limits: 25 MB per file and per zip upload; 20 GB platform cap; optional content TTL per instance.
