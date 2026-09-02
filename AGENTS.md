# Energon — agent SOP

Energon is a company-hosted file and small-site Worker. Humans open the instance origin. Agents publish and fetch through `/v1`.

This repository is the **source you fork**. `plugins/energon` is a placeholder package bound to `https://energon.example.com`. Marketplace catalogs are not in this tree until someone runs `npm run skill:init` for a real host.

Humans and agents: [INSTALL.md](./INSTALL.md). Copy-paste prompts: [README.md](./README.md). A running host also has `/setup`.

If you are **connecting to an existing host**, follow INSTALL.md “Connect an agent”. Use `GET {origin}/v1/help` for `repo`, `install`, and `env`. Then follow the rendered skill under `plugins/`. Do not invent a token.

If you are **publishing to a host you already have a token for**:

1. Look for the token env named by `GET {origin}/v1/help` (placeholder: `ENERGON_TOKEN`). If missing, tell the human to open `{origin}/tokens`, mint a key, and export it. Do not invent a token.
2. Decide: a site (named folder of files) vs a loose file (one file, stable id). Both stay at the same URL when you PUT.
3. New site: `POST /v1/sites` with the human’s slug. On `409`, show the existing URL and ask: new slug, or retry with `overwrite: true`.
4. Write with `PUT /v1/sites/{slug}/files/{path}`. Last write wins on that path only.
5. Read with `GET /v1/sites/{slug}/files/{path}` or `GET /v1/files/{id}` (token; no share password needed). You can also GET the human `/{handle}/s/{slug}/` or `/{handle}/f/{id}/{filename}` URL. If it is password-protected, send `X-Energon-Password`.
6. Optional share password: `"password"` on `POST /v1/sites` or `PATCH /v1/sites/{slug}`; `X-Energon-Set-Password` on `POST`/`PUT /v1/files`. Default is no password. Empty string clears. Write responses echo the password you just set. GET never returns it — only a hash is stored. Tell the human the password; do not write it into the file.
7. One file: `POST /v1/files`, then `PUT /v1/files/{id}` to replace it. Same `url` and `api_url`.
8. Give humans `url` (and the password, if any). Agents can use that URL plus the header, or `api_url` with their token.
9. Who can write is per object (`write_policy`: `owner` or `instance`). New objects copy the instance default unless the request sets it. `PATCH write_policy` is creator-only. A 403 on PUT means only the creator can write that object — do not retry as overwrite.
10. Make a copy with `duplicate_from` on `POST /v1/sites` or `POST /v1/files`. You become the owner. If you already have replacement bytes this turn, POST/PUT those instead.

Never default to overwrite. Never use a guessed slug that already exists without the human confirming.

`GET /v1/sites` and `GET /v1/files` list only what you created or last wrote (`?scope=created|edited|involved`, `?q=`, `?created_by=`). They are not a company catalog.

Machine-readable help lives at `GET /v1/help` and `GET /llms.txt` (no auth).

## Pull requests to tmchow/energon

The canonical repo `tmchow/energon` accepts [issues](https://github.com/tmchow/energon/issues/new/choose) and does not merge unsolicited pull requests. Humans: [CONTRIBUTING.md](./CONTRIBUTING.md).

- Do not open a PR against `tmchow/energon` unless the human owns that repo and asked for the PR in this conversation. Do not push a branch there, and do not @ the maintainer asking them to merge.
- File or draft a GitHub issue instead, or keep changes on a fork.
- If you are working in some other clone (a company fork, a private copy), follow that repo’s humans. This file does not forbid PRs there.

## Working on this repository

Do not run the full suite after every edit. GitHub CI runs `typecheck`, `test:unit`, and `test:worker` on pushes to `main` and on any PR that is opened. Production deploy is opt-in (`ENABLE_PRODUCTION_DEPLOY` plus Cloudflare secrets) — see [INSTALL.md](./INSTALL.md). Do not `wrangler login` or `wrangler deploy` from a cloud agent VM. Do not stamp `d1_migrations` or run `d1 execute` against production. New schema belongs in `migrations/` first.

| You changed | Run this (seconds) |
|---|---|
| `src/catalog.ts`, `src/handles.ts`, `src/urls.ts`, `src/http.ts`, `src/auth.ts` (helpers), `src/zip.ts`, `src/config.ts`, `src/memorable.ts`, `src/slugs.ts`, `src/policy.ts`, `src/instance.ts`, `src/expire.ts`, `templates/skill`, `templates/plugin`, `templates/marketplace`, `scripts/render-skill.mjs` | `npm run test:unit` — or one file: `npm run test:unit -- test/unit/catalog.spec.ts` |
| `src/hub.html`, `src/hub.client.js`, `src/tokens.html`, `src/chrome.ts`, `src/about.ts`, `src/setup.ts`, `src/stats.ts` | `npx vitest run test/pages.spec.ts` |
| `src/index.ts` routes, host rules, hub `/account` API | `npx vitest run test/routes.spec.ts` |
| `src/sites.ts`, `src/files.ts`, `src/auth.ts` (DB), `src/markdown.ts`, `src/gate.ts`, publish/delete/list API | `npx vitest run test/api.spec.ts` |
| Loose-file write/rename failure paths | `npx vitest run test/files.spec.ts` |
| `src/db.ts`, `migrations/`, shared types, or you are about to commit | `npm run typecheck && npm test` |

`test:unit` is Node, no Miniflare. `test:worker` boots the Worker once and hits it over `SELF.fetch`. Prefer the matching file while iterating; run `npm test` before you commit.

Page tests check that the HTML still has the right contracts (nav, copy, element IDs the JS calls). They are not pixel tests. If you add `$("some-id")` or `getElementById("some-id")`, put that id on the page or `pages.spec.ts` fails.

## Verify like a user

`.cursor/skills/verify-energon/` is how an agent drives a **local** hub and `/v1` the way a user does (isolated `wrangler dev`, not the human’s port 8787). Use it to prove a publish, token, password, catalog, or public-URL change. Follow that skill’s Launch / Doctor / Drive / Cleanup. Do not invent a token.

Those tests above do not keep the feature map honest. The map lives in `.cursor/skills/verify-energon/features/` and rots when a user-facing handle moves.

**Same PR:** if you change a path, header, hub control, or proof string that the map or `verify-energon` Drive section names (element ids, ARIA labels, `/v1` routes, `X-Energon-Password`, token prefix/env, public `/{handle}/s|f/…` URLs), update those files in this change. Do not leave stale selectors for a later audit.

**`/maintain-verification-skill`:** run it when user-facing behavior moved and you are not sure the map still covers it (new hub flow, new `/v1` route, gate/token/catalog change), or when a verify drive failed because the skill was wrong. That pass only edits `.cursor/skills/verify-energon/`. If the app is wrong, report a product bug — do not “fix” it by changing the map.

Skip maintain for internal refactors, tests-only, migrations with no user path change, or copy that `pages.spec.ts` already covers and the map never names. Do not run it after every edit.
