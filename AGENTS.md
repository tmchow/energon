# Energon

Cloudflare Worker: company file and small-site host. Hub + `/v1` on `PUBLIC_ORIGIN`. Published bytes on `CONTENT_ORIGIN` (a separate hostname in production). D1 catalog, R2 objects.

This file is how to **change this tree**. It is not a product README and not the publish SOP.

| Job | Go here |
| --- | --- |
| Edit the Worker, hub, tests, or skill templates | rest of this file |
| Publish or fetch against a live host | the installed plugin skill; `GET {origin}/v1/help` and `{origin}/llms.txt`. Never invent a token. |
| Stand up or connect a host | [INSTALL.md](./INSTALL.md) |
| Deploy vars, Access, fork hygiene | [docs/DEPLOY.md](./docs/DEPLOY.md) |
| Domain terms (purge claim, write claim, instance identity) | [CONCEPTS.md](./CONCEPTS.md) |

## Hard stops

- Do not invent a token. Humans mint at `{origin}/tokens`.
- Never default to `overwrite: true`. Never claim a guessed slug that already exists without the human confirming.
- Do not `wrangler login`, `wrangler deploy`, `npm run db:remote`, stamp `d1_migrations`, or `d1 execute` against production. New schema belongs in `migrations/` first.
- Do not `pkill -f wrangler` / `workerd`. Do not delete `.wrangler/state` (the human's local DB).
- Do not hand-edit `plugins/energon/` (or `plugins/{name}/` on a fork). Source is `templates/` + `instance-skill.json`. Render with `npm run skill:render`.
- Do not put the skill under `.agents/skills` or `.claude/skills` — those autoload it inside this Worker repo.
- `tmchow/energon` does not merge unsolicited or fork PRs (a workflow closes fork PRs). Same-repo PRs from the owner are fine. On a company fork, follow that repo's humans. [CONTRIBUTING.md](./CONTRIBUTING.md).

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | Router |
| `src/sites.ts`, `src/files.ts`, `src/gate.ts`, `src/auth.ts` | Publish API, share passwords, Access identity, tokens |
| `src/hub.html`, `src/hub.client.js`, `src/tokens.html`, `src/chrome.ts`, `src/setup.ts`, `src/about.ts`, `src/stats.ts` | Signed-in UI |
| `src/auth.ts` `helpBody`, `src/llms.ts` | Runtime agent docs (`/v1/help`, `/llms.txt`). Update both when `/v1` behavior changes; then `templates/skill/` if the SOP changed. Freeze the bodies in `test/golden/`. |
| `openapi/v1.json`, `src/openapi.ts` | The `/v1` HTTP schema, served at `/v1/openapi.json` with `servers` set to `PUBLIC_ORIGIN`. When a `/v1` route, body, status, or `ApiError` code changes, edit the document by hand and keep `test/unit/openapi-drift.spec.ts` green; it diffs the document against `helpBody().routes`, `src/index.ts`, and every `ApiError` code. |
| `src/db.ts`, `src/schema.sql`, `migrations/` | Schema (see below) |
| `src/catalog.ts`, `src/handles.ts`, `src/urls.ts`, `src/http.ts`, `src/policy.ts`, `src/instance.ts`, `src/expire.ts`, `src/cache.ts`, `src/zip.ts`, `src/markdown.ts`, `src/mime.ts`, `src/memorable.ts`, `src/slugs.ts`, `src/config.ts` | Helpers — prefer `test:unit` |
| `templates/`, `scripts/render-skill.mjs`, `instance-skill.json` | Skill / plugin source |
| `plugins/energon/` | Rendered placeholder bound to `https://energon.example.com`. Not a marketplace until `npm run skill:init`. |
| `.cursor/skills/verify-energon/` | Isolated local hub + `/v1` user-path verification |

## Schema

Three representations. One change updates all that apply:

1. A **new file** under `migrations/` (do not rewrite old ones; `migrations/0001_init.sql` is frozen history, not a live copy of `src/schema.sql`).
2. `src/db.ts` `TABLE_STATEMENTS` / `INDEX_STATEMENTS` / `ensureColumns` — request/cron bootstrap and legacy upgrades. Indexes after columns. A 0005-shaped DB must still start.
3. `src/schema.sql` — documented current `CREATE` shape. Not applied at runtime; keep aligned with `ensureSchema`.

`CREATE` / `ADD COLUMN` in migrations are not idempotent. Do not stamp production `d1_migrations` to skip a file you already applied by hand.

## Commands

```bash
npm install
npx wrangler d1 migrations apply energon --local
cp .dev.vars.example .dev.vars    # DEV_ACCESS_EMAIL; default identity dev@example.com
npm run dev                       # http://127.0.0.1:8787 — do not steal this port for verify runs
npx wrangler types                # gitignored worker-configuration.d.ts; CI runs this before typecheck
```

Localhost skips Access. Handle is the email local-part (`dev` for the default).

## Tests

Do not run the full suite after every edit. CI (`.github/workflows/ci.yml`) runs `wrangler types`, `typecheck`, `lint`, `test:unit`, and `test:worker` on `main` and every PR. Production deploy is opt-in (`ENABLE_PRODUCTION_DEPLOY`). Pre-commit runs `oxlint` (correctness errors fail the hook; complexity warnings print and do not).

`test:unit` is Node, no Miniflare. `test:worker` boots the Worker once and hits it over `SELF.fetch`. Worker bindings in `vitest.config.ts` (hub/content origins, `esperlabs.app` fixture emails) are intentional — do not "fix" them to `.dev.vars`.

| Change | Run |
| --- | --- |
| Pure helper under `src/` | `npm run test:unit -- test/unit/<name>.spec.ts` |
| `helpBody`, `llms.txt`, markdown HTML | `npm run test:unit -- test/unit/golden.spec.ts` (`UPDATE_GOLDENS=1` to regenerate; review `git diff test/golden/`) |
| `openapi/v1.json`, a `/v1` route, or an `ApiError` code | `npm run test:unit -- test/unit/openapi-drift.spec.ts` |
| `templates/`, `scripts/render-skill.mjs`, `instance-skill.json` | `npm run test:unit -- test/unit/skill-render.spec.ts` |
| Hub/tokens/setup/about/stats HTML, `src/hub.client.js`, `src/chrome.ts` | `npx vitest run test/pages.spec.ts` |
| `src/index.ts` routes, host rules, hub `/account` API | `npx vitest run test/routes.spec.ts` |
| Publish/delete/list, `src/sites.ts`, `src/files.ts`, `src/auth.ts` (DB), `src/markdown.ts`, `src/gate.ts` | `npx vitest run test/api.spec.ts` |
| Loose-file write/rename failures | `npx vitest run test/files.spec.ts` |
| Site mutation rollback | `npx vitest run test/site-integrity.spec.ts` |
| Expiry purge races | `npx vitest run test/api.purge-claim.spec.ts` |
| `src/db.ts`, `migrations/`, shared types, or before commit | `npx wrangler types && npm run typecheck && npm run lint && npm test` |

Page tests are HTML contracts (nav, copy, element IDs the JS calls), not pixels. If you add `$("some-id")` or `getElementById("some-id")`, that id must exist on the page or `assertDomBindings` in `pages.spec.ts` fails. Do not snapshot hub pages into `test/golden/`.

## Verify like a user

`.cursor/skills/verify-energon/` is how an agent drives a **local** hub and `/v1` the way a user does (isolated `wrangler dev` via `bin/launch`, default port `18787`, persist under `/tmp/energon-verify/`). Follow that skill's Launch / Doctor / Drive / Cleanup. Do not invent a token. Do not attach to whatever is already on 8787 unless `bin/doctor` says that pid is this run.

The feature map is `.cursor/skills/verify-energon/features/`. It rots when a user-facing handle moves.

**Same PR:** if you change a path, header, hub control, or proof string that the map or the skill Drive section names (element ids, ARIA labels, `/v1` routes, `X-Energon-Password`, token prefix/env, public `/{handle}/s|f/…` URLs), update those files in this change.

**When the map may be wrong:** user-facing behavior moved and coverage is unclear (new hub flow, new `/v1` route, gate/token/catalog change), or a verify drive failed because the skill was stale. That pass only edits `.cursor/skills/verify-energon/`. If the app is wrong, report a product bug — do not "fix" it by changing the map.

Skip that pass for internal refactors, tests-only, migrations with no user path change, or copy that `pages.spec.ts` already covers and the map never names.

## Skill templates

Edit `templates/skill/` and `templates/plugin/`, then `npm run skill:render`. `npm run skill:render -- --check` must stay green (`test:unit` runs it). Do not ship `{{placeholders}}` in committed `SKILL.md`.

On a real host, `npm run skill:init` writes `plugins/{name}/` and marketplace catalogs — see INSTALL.md. This upstream tree is not a marketplace.
