---
name: update-from-upstream
description: Merge a published upstream Energon release into this fork, preserve this Energon's identity, then discover how this fork deploys and walk that path only after the operator opts in. Use when asked to update, upgrade, merge upstream, or catch up to a newer release. On the source template, stop.
---

# Update from upstream

This is the fork-side SOP for catching up to a published GitHub Release. It is the inverse of cut-release: a fork merges an upstream release; it does not cut one.

The skill lives in `.agents/skills/update-from-upstream/`; `.claude/skills/update-from-upstream` and `.cursor/skills/update-from-upstream` are symlinks to it.

A GitHub Release is the operator contract (Operator notes: D1, wrangler keys, plugin regen, rollback floor). Merging it is not a deploy. Do not merge unreleased `main`.

When this file is absent (an older fork), follow INSTALL.md “Update an existing Energon” and the checkout’s upgrade guide.

## This checkout

```
gh repo view --json isFork,parent,nameWithOwner,url
git remote -v
git status --short
```

If `isFork` is false, **stop**. This is the source template. Cut a release there; do not merge this repo into itself.

Reuse a remote named `upstream` if present. Otherwise add one from `parent.url`. Do not pass a hard-coded `--repo owner/name`. Do not overwrite dirty work or discard this Energon’s identity files.

## Hard stops

- Do not merge onto `main` as the default. Work on a branch. A push to `main` may be a deploy if this fork set `ENABLE_PRODUCTION_DEPLOY`.
- Do not replace `wrangler.toml`, `instance-skill.json`, generated `plugins/`, or marketplace catalogs with upstream placeholders.
- Do not create, delete, empty, or rebind live D1 or R2. An ordinary update keeps this Energon’s existing account, database, and bucket. Do not walk first-install resource creation.
- Do not apply remote migrations or `wrangler deploy` unless the operator explicitly opted in after you named this fork’s deploy path.
- Do not stamp `d1_migrations` or run ad hoc production SQL.
- Do not run interactive `wrangler login` in an unattended cloud agent.
- Do not require an R2 copy for an ordinary update. Record a D1 Time Travel bookmark before any remote migrate.

## Phase 1 — Merge the release

1. Resolve the parent from `gh repo view` (`parent.nameWithOwner`, `parent.url`). Fetch tags from `upstream`.
2. Read the target release (latest, or the tag the operator named):

```
parent=$(gh repo view --json parent --jq .parent.nameWithOwner)
gh release view --repo "$parent"
```

Stop if there is no published release. Read the **Operator** section. Do not invent notes that are not there.

3. Create a branch. Merge that **tag**, not `upstream/main`.
4. On conflict, keep this fork’s identity: `wrangler.toml` account / bindings / origins / routes / Access / policy / token prefix; `instance-skill.json`; `plugins/` and marketplace catalogs. Compare new keys only against `wrangler.example.toml`. Copy needed keys, not upstream placeholders.
5. After the merge:

```
npm install
npx wrangler d1 migrations apply <database_name> --local
npm run skill:render
npm run skill:render -- --check
npx wrangler types
npm run typecheck
npm run lint
npm test
```

Use the D1 `database_name` from this fork’s `wrangler.toml` if it is not the example name. Do not apply remote migrations in this phase.

6. Report: this `version.txt` vs the tag, Operator notes, identity files that stayed, plugin regen status, pending `migrations/` files, and that the update is on the branch (and a fork PR if this repo wants one). **It is not live.**

## Phase 2 — Discover deploy, then ask

Do not prescribe one deploy command. Discover how **this** fork already deploys, name that path, and stop.

| Signal | Meaning |
| --- | --- |
| `gh variable get ENABLE_PRODUCTION_DEPLOY` is `true` and `.github/workflows/ci.yml` still has the stock deploy job | Merge/push to `main` is the deploy: tests, remote migrations, `wrangler deploy`. |
| Variable unset or missing | CI is test-only. Merging the update does not go live. |
| `gh secret list` shows `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Actions *can* deploy if the variable is on. Do not print secret values. |
| `npx wrangler whoami` matches `wrangler.toml` `account_id` | This machine can do the INSTALL.md CLI path. |
| whoami missing, another account, or a cloud agent | Do not `wrangler login`. Finish auth on the operator laptop or use this fork’s existing CI. |
| Workflow or database name edited away from stock `ci.yml` | Read the fork’s workflow. Do not assume the stock job. |
| No readable signal | Say unclear. Ask how this Energon is deployed. Do not invent a method. |

Also inventory-match the deployed Worker’s D1 and R2 bindings to this `wrangler.toml` before any remote command (INSTALL.md “Inspect the account and resources”). A matching name is not ownership.

Then ask, with the Operator checklist for this tag: leave the update on the branch/PR; walk the detected deploy path; or stop.

A durable R2 copy or a D1 export beyond the Time Travel window is `backup-this-energon`. Do not require it here.

## Phase 3 — Only after opt-in

Walk **the path you detected**. Keep these stops on every path:

1. Confirm bindings still match this Energon. Do not create or rebind storage.
2. Record the D1 restore point using this fork’s database name:

```
npx wrangler d1 info <database_name>
npx wrangler d1 time-travel info <database_name>
```

Write down the bookmark and time. Do not run `time-travel restore`.

3. Migrate before the Worker. Stop on migration failure.
4. If the path is Actions-on-`main`: merging/pushing this update to `main` *is* the deploy. Do not also run local `wrangler deploy`.
5. If the path is laptop Wrangler: only after whoami matches, then this checkout’s INSTALL.md order (`d1 migrations apply --remote`, then `wrangler deploy`), using this fork’s database name.
6. If the path is custom: follow the fork’s humans / workflow text, still migrate-before-deploy.
7. After a live deploy, the INSTALL.md installation probes (health/help/origins). Do not invent a token.

If they did not opt in, the branch/PR is the deliverable. Print the detected next step so a later “ok, deploy” turn can resume this skill.

## Verify

The branch has the release tag, identity files still name this Energon, `skill:render --check` is green, and nothing remote ran unless they opted in. If they opted in, health/help match this Energon and the Time Travel bookmark from before migrate is still recorded.
