# Deploy your own Energon

One codebase. Each host is its own Cloudflare account, D1, R2, Access app, and **rendered skill**. Do not mix two companies’ uploads in one bucket.

Start with [INSTALL.md](../INSTALL.md). This page is the deeper reference for vars, expiry, Access, and fork hygiene.

## Company instance (this repo’s job)

This tree is meant to be forked and run inside a company. There is no hosted public service here.

| | This host (company) | If you omit the vars |
| --- | --- | --- |
| Cloudflare account | Your org | — |
| Access | Workspace / Okta, locked to your domain | any Access email |
| `ALLOWED_EMAIL_DOMAINS` | `your.co,your.com` | empty |
| `ALLOW_UNLIMITED_RETENTION` | `true` (committed) | `false` |
| `DEFAULT_TTL` / `MAX_TTL` | `never` / `never` | `7d` / `30d` |
| `WRITE_POLICY` | `instance` (committed) | `owner` |
| Skill | rendered for this host | placeholder `energon@energon` |

Code defaults are **strict** when vars are omitted: required TTL, 30-day cap, creator-only writes. The committed `wrangler.toml` opts into company mode. Replace the placeholder D1 id, `PUBLIC_ORIGIN`, and `CONTENT_ORIGIN` before you deploy. `CONTENT_ORIGIN` must be a separate custom hostname; without it, production content publication fails closed.

Auth on the Worker is Cloudflare Access (`Cf-Access-Authenticated-User-Email`). There is no signup in the app.

## Cron cost (every 5 minutes)

The trigger itself is not a separate product. Each run is a Worker invocation.

- `*/5 * * * *` → 12/hour × 24 × 30 = **8,640 invocations / month**
- Workers Paid ($5/mo, which you already need for 25 MB uploads): 10 million requests and 30 million CPU-ms included. 8,640 requests is noise.
- An empty sweep is one D1 `SELECT … LIMIT 100` and returns. You pay R2 deletes only when something actually expired.
- Cron does **not** retry on failure. Reads still enforce expiry, so a missed sweep does not serve dead content.

Hourly (`0 * * * *`) is also fine. Keep 5 minutes so R2 bytes leave soon after expiry.

## How expiry actually works

Two paths, on purpose:

1. **Cron** (`src/expire.ts` `sweepExpired`) — select `expires_at <= now`, delete R2 + D1, purge cache. Batch of 100.
2. **Read/write check** — GET/PUT/PATCH: if `expires_at` is in the past → **410 Gone**, then `waitUntil` purge that one object. Edge `s-maxage` is capped to leftover TTL.

`PUT` does not extend TTL. `PATCH { "ttl": "7d" }` resets from now, still capped by `MAX_TTL`. `"never"` is 400 unless `ALLOW_UNLIMITED_RETENTION=true`.

R2 lifecycle rules cannot do per-object `expires_at`. The Worker owns the clock.

## Skill: committed files are installable; forks replace them

The installable skill is the **committed files** under `plugins/`. That is what `/plugin install` reads.

This upstream ships a placeholder skill named **`energon`** (`energon@energon`) bound to `https://energon.example.com` and `ENERGON_TOKEN`. That is not a live host. After you fork:

```bash
npm run skill:init -- --name yourco --origin https://energon.your.co
```

That sets skill **and** marketplace to `yourco-energon`, token env `YOURCO_ENERGON_TOKEN`, and the GitHub repo from `git remote get-url origin`. `--repo owner/energon` only if origin is still `tmchow/energon`.

It **replaces** the shipped plugin folder, rewrites `marketplace.json`, and writes `instance-skill.json`. Commit that. Point wrangler `SKILL_NAME`, `MARKETPLACE_NAME`, `MARKETPLACE_REPO`, `TOKEN_ENV`, and `PUBLIC_ORIGIN` at the same values. Set `CONTENT_ORIGIN` to a second custom hostname for published files and sites.

Skill name and marketplace name match so a second Energon catalog does not collide. Claude Code has one marketplace `name` slot.

`npm run skill:render -- --check` fails if `SKILL.md` drifted from `instance-skill.json` + the template.

Do not ship `{{placeholders}}` in `SKILL.md`. Do not tell a private host to install the placeholder `tmchow/energon` skill.

## Cloudflare resources (once per instance)

Workers Paid is required (unzip + 25 MB uploads).

```bash
npx wrangler r2 bucket create energon
npx wrangler d1 create energon
```

Put the printed D1 `database_id` in `wrangler.toml`. Keep `database_name` and `bucket_name` as `energon` so the existing GitHub Actions deploy job does not need edits.

Then:

- Custom domains → both `[[routes]]` entries in `wrangler.toml` (hub and content)
- GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- GitHub Actions variable `ENABLE_PRODUCTION_DEPLOY=true` to deploy on push to `main`. Unset = tests only.
- Do not `wrangler login` from a cloud agent VM. Land on `main`.

## Instance vars (`wrangler.toml` `[vars]`)

Strings only (Wrangler).

| Var | Company | Default if unset |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `https://energon.your.co` | `https://energon.example.com` |
| `CONTENT_ORIGIN` | `https://content.energon.your.co` | `https://content.energon.example.com` |
| `ALLOW_UNLIMITED_RETENTION` | `true` | `false` |
| `DEFAULT_TTL` | `never` | `7d` (`never` if unlimited is on and this is unset) |
| `MAX_TTL` | `never` | `30d` (`never` if unlimited) |
| `TTL_PRESETS` | omit (full catalog) | code catalog ∩ `MAX_TTL` |
| `ALLOWED_EMAIL_DOMAINS` | `your.co,your.com` | empty (any Access email) |
| `TOKEN_ENV` | match the rendered skill | `ENERGON_TOKEN` |
| `TOKEN_PREFIX` | `ee_live_` | `ee_live_` |
| `SKILL_NAME` | `yourco-energon` | `energon` |
| `MARKETPLACE_NAME` | same as `SKILL_NAME` | `energon` |
| `MARKETPLACE_REPO` | `your-org/energon` | `tmchow/energon` |
| `FOOTER_TEXT` | omit, or one company line | empty (no footer) |
| `MAX_FILE_BYTES` | omit (25 MB) | 25 MB |
| `MAX_PLATFORM_BYTES` | omit (20 GB) | 20 GB |
| `WRITE_POLICY` | `instance` | `owner` |
| `DEV_ACCESS_EMAIL` | `.dev.vars` only | `dev@example.com` |

The catalog in code is:

`30m, 1h, 1d, 7d, 14d, 30d, 60d, 90d, 180d, 365d`

The hub shows those that fit under `MAX_TTL`, with human labels (**3 months**, not 90 days), plus **Never** only if unlimited is on. `TTL_PRESETS` is an optional hide-list, not how you invent new windows.

`GET /v1/help` echoes origin, token env, skill, install line, retention, and the instance file / platform caps.

`MAX_FILE_BYTES` is one file, one zip upload, and one site zip export. Accepts `25mb`, `5mb`, or a raw byte count. `MAX_PLATFORM_BYTES` is the whole-bucket safety valve (default 20 GB).

`FOOTER_TEXT` is one line on signed-in pages. It is escaped as text — not HTML. Leave it empty for no footer. Do not edit `src/hub.html` just to brand a fork.

`WRITE_POLICY` is the default for **new** sites and loose files: `owner` (only `created_by` may PUT/PATCH/DELETE) or `instance` (any token on this host). Unset is `owner`. Each object stores its own `write_policy`. Existing rows with a NULL policy are treated as `instance`. The creator can `PATCH { "write_policy": "owner" | "instance" }`. Anyone with a token can still read via `/v1`.

## Customize a fork

Keep the diff small so `git merge upstream` stays easy.

Supported hooks are wrangler vars (`FOOTER_TEXT`, TTL, email domains, `WRITE_POLICY`) and `instance-skill.json` + `npm run skill:render`. After you merge `upstream/main`, take any **new keys** from `wrangler.example.toml`. Editing `src/hub.html` works but will conflict.

## Cloudflare Access

The Worker reads `Cf-Access-Authenticated-User-Email`. It does not implement signup.

- IdP: Google Workspace / Okta / GitHub Enterprise, restricted to your org.
- Also set `ALLOWED_EMAIL_DOMAINS` so a mis-aimed Access policy cannot mint tokens for random Gmail.

**Paths**

- **Allow** (signed-in): `/`, `/account*`, `/about`, `/stats`, `/setup`, `/tokens`
- **Bypass** (default): `/v1*`, `/health`, `/llms.txt`, `/favicon.svg`, `/static*` on the hub, and `/{handle}/s/*`, `/{handle}/f/*` on the content hostname

Published `/{handle}/s/*` and `/{handle}/f/*` are served from `CONTENT_ORIGIN` and stay on the open internet by default so a share link just opens. Do not put Access on the content hostname; the Worker rejects hub routes there and the separate origin prevents active uploads from reading authenticated hub responses. Leave `/v1*` on Bypass on the hub. There is no `PUBLISH_VISIBILITY` var.

Disable or ignore `*.workers.dev` for humans; the Worker 403s the hub there.

## Local

```bash
npm install
npx wrangler d1 migrations apply energon --local
# .dev.vars: PUBLIC_ORIGIN=http://127.0.0.1:8787
#            CONTENT_ORIGIN=http://127.0.0.1:8787
#            DEV_ACCESS_EMAIL=you@your.co
npm run dev
```

## What you should not do

Do not reuse another instance’s D1 `database_id` or R2 bucket. Do not put Access on `/v1`. Do not install two marketplaces that share the same `name`. Do not leave `{{ORIGIN}}` in a skill you ship to agents.
