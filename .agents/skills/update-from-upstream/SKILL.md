---
name: update-from-upstream
description: Merge a published upstream Energon release into this fork, keep wrangler.toml, instance-skill.json, and the generated plugin, then land it according to whether this fork auto-deploys from main. Use when asked to update, upgrade, merge upstream, or catch up to a newer release. On the source template, stop.
---

# Update from upstream

This is the fork-side SOP for catching up to a published GitHub Release. It is the inverse of cut-release: a fork merges an upstream release; it does not cut one.

A GitHub Release is the operator contract (Operator notes: D1, wrangler keys, plugin regen, rollback floor). Merge that **tag**, not unreleased `main`. Do not use GitHub “Sync fork”.

When this file is absent (an older fork), follow INSTALL.md “Update an existing Energon” and the checkout’s upgrade guide.

## This checkout

```
gh repo view --json isFork,parent,nameWithOwner,url
git remote -v
git status --short
```

If `isFork` is false, **stop**. This is the source template. Cut a release there; do not merge this repo into itself.

Reuse a remote named `upstream` if present. Otherwise add one from `parent.url`. Do not pass a hard-coded `--repo owner/name`. Do not overwrite dirty work or replace this fork’s `wrangler.toml`, `instance-skill.json`, or generated `plugins/`.

## Discover how this fork updates the Worker

Do this before landing anything on `main`.

| Signal | Meaning |
| --- | --- |
| `gh variable get ENABLE_PRODUCTION_DEPLOY` prints `true` and `.github/workflows/ci.yml` still has the stock deploy job | Auto-deploy is **on**. A push or merge to `main` is the deploy: tests, remote D1 migrations, `wrangler deploy`. |
| The get **succeeds** and the value is empty or not `true` | Auto-deploy is **off**. Updating the fork does not change the live Worker. |
| The get **fails** (404, auth, or no output you can trust) | **Unclear.** GitHub uses 404 for both “unset” and “cannot read Actions variables.” Do not treat this as off. |
| `gh secret list` shows `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Actions *can* deploy if the variable is on. Do not print secret values. |
| `npx wrangler whoami` matches `wrangler.toml` `account_id` | This machine can do the INSTALL.md CLI deploy. |
| whoami missing, another account, or a cloud agent | Do not `wrangler login`. CLI deploy waits for the operator laptop. |
| Workflow or database name edited away from stock `ci.yml` | Read the fork’s workflow. Do not assume the stock job. |
| No readable signal | **Unclear.** Ask how this Energon’s Worker is updated. Do not invent a method. |

Also inventory-match the deployed Worker’s D1 and R2 bindings to this `wrangler.toml` before any remote command (INSTALL.md “Inspect the account and resources”). A matching name is not ownership.

## Hard stops

- Do not replace `wrangler.toml`, `instance-skill.json`, generated `plugins/`, or marketplace catalogs with upstream placeholders.
- Do not create, delete, empty, or rebind live D1 or R2. An ordinary update keeps this Energon’s existing account, database, and bucket.
- If auto-deploy is **on** or **unclear**, do not merge or push to `main` unless the operator opted in after you said that *might* migrate D1 and deploy the Worker (will, if the variable is on).
- If auto-deploy is **off**, do not run remote migrations or `wrangler deploy` unless they asked to deploy after the fork was updated. Turning the variable on after `main` already has the commit does not deploy that commit (`ci.yml` has no `workflow_dispatch`).
- Do not stamp `d1_migrations` or run ad hoc production SQL.
- Do not run interactive `wrangler login` in an unattended cloud agent.
- Do not require an R2 copy. Record a D1 Time Travel bookmark before any remote migrate.

## Phase 1 — Merge the release onto a branch

1. Resolve the parent from `gh repo view`. Fetch tags from `upstream`.
2. Read the target release (latest, or the tag the operator named):

```
parent=$(gh repo view --json parent --jq .parent.nameWithOwner)
gh release view --repo "$parent"
```

Stop if there is no published release. Read the **Operator** section. Do not invent notes that are not there.

3. Create a branch. Merge that **tag**.
4. On conflict, keep this fork’s `wrangler.toml` (account, bindings, origins, routes, Access, policy, token prefix), `instance-skill.json`, `plugins/`, and marketplace catalogs. Compare new keys only against `wrangler.example.toml`. Copy needed keys, not upstream placeholders.
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

Use the D1 `database_name` from this fork’s `wrangler.toml` if it differs. Do not apply remote migrations here.

6. Report this `version.txt` vs the tag, Operator notes, that `wrangler.toml` and `instance-skill.json` still match this Energon, plugin regen, and pending `migrations/` files. The Worker is not live yet.

## Phase 2 — Land the update

**Auto-deploy on, or unclear.** Say there is a newer release on the branch, and merging it to `main` will deploy if `ENABLE_PRODUCTION_DEPLOY` is on (and might, if you could not read the variable). Ask if they want that.

- Yes: record the Time Travel bookmark (below), then merge the PR / push to `main`. If auto-deploy is on, that merge *is* the deploy — do not also run local `wrangler deploy`; confirm the Actions job and INSTALL.md health/help probes. If it was unclear and Actions does not deploy, treat the rest as auto-off (ask about laptop Wrangler).
- No: leave the update on the branch or PR. The Worker stays on the current deploy.

**Auto-deploy off** (successful read, value not `true`). Merging to `main` updates the fork (and the plugin marketplace, which usually tracks `main`). It does not change the live Worker. Land the branch on `main` after checks pass. Then ask if they want to deploy **this** release with laptop Wrangler.

- Yes: record the Time Travel bookmark, then INSTALL.md CLI (`d1 migrations apply --remote`, then `wrangler deploy`) only if `whoami` matches this `account_id`. Automatic updates (INSTALL.md “After the first deploy”) apply to **later** pushes to `main`. Enabling the variable now does not redeploy this commit.
- No: the fork is updated; the Worker is unchanged. Print that so a later “ok, deploy” turn can resume.

If the path is custom, follow the fork’s humans / workflow text, still migrate-before-deploy.

A durable R2 copy or a D1 export beyond the Time Travel window is `backup-this-energon`. Do not require it here.

## Before any remote migrate

```
npx wrangler d1 info <database_name>
npx wrangler d1 time-travel info <database_name>
```

Write down the bookmark and time. Do not run `time-travel restore`. Stop on migration failure.

## Verify

The release tag is on the fork. `wrangler.toml` and `instance-skill.json` still match this Energon. `skill:render --check` is green. If auto-deploy was on or unclear, `main` moved only after they opted in. If they asked to deploy, health/help match this Energon and the bookmark from before migrate is recorded.
