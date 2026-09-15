---
name: deploy-this-energon
description: Deploy the code already on this checkout to this Energon's configured Cloudflare account with Wrangler (remote migrations, deploy, live verification). Use when the operator asks to deploy, ship, or push live an accepted deployment repository without automatic deployment. Does not fetch releases, merge upstream, or cut releases.
---

# Deploy this Energon

Take the source on this checkout live in the operator's account. This is INSTALL.md **Commit and deploy** and **Verify the installation** run against an existing Energon. INSTALL.md owns the commands and acceptance; this skill sequences them and adds the checks that only matter when the Worker already exists.

Done means the intended commit is deployed to the inventory-matched Worker, pending migrations were applied before it, live acceptance passed, and the operator has a record of what changed. To bring in a new upstream release first, use the `update-from-upstream` skill. For a durable data copy before deploying, use the `backup-this-energon` skill.

## Authorization

Development work does not authorize production changes. Proceed only when the operator asked for this deploy. Reuse authorization they already gave in this session; do not infer it from a merged PR, a passing check, or an update that was "ready to deploy". Never default to deploying.

Do not run interactive `wrangler login` in an unattended cloud agent. A human completes login on their machine.

## Resolve this checkout

Read this checkout's AGENTS.md and INSTALL.md. From the repository root:

```sh
node scripts/deployment-repo.mjs inspect
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git fetch --no-tags origin main
git merge-base --is-ancestor HEAD origin/main
```

Continue only when the helper returns `canonical: false`. If it returns `canonical: true`, this is the public release source with nothing to deploy: stop. `isFork: false` is valid for an independent deployment repository. If inspection fails, resolve the identity or access problem; do not deploy from a checkout whose repository you cannot establish.

**Stop** if `wrangler.toml` is still the unconfigured template: missing `account_id`, example origins, or a placeholder `database_id` (`00000000-0000-4000-8000-000000000001` or `PASTE_FROM_WRANGLER_D1_CREATE`). That is a first install, not a deploy; follow INSTALL.md from **Choose the installation**.

Record the branch and commit you are about to deploy and whether that commit is on `main`. On `main` means reachable from `origin/main` after that fetch, which is a zero exit from `git merge-base --is-ancestor`. A commit on local `main` that is not pushed, or on any branch that has not landed, is not on `main`, and Actions has never seen it. A dirty tree deploys uncommitted edits; report that and get the operator's confirmation before continuing with it.

## Match the account and resources

Follow INSTALL.md **Inspect the account and resources**: `npx wrangler whoami` must show the account in `wrangler.toml`, and the deployed Worker's D1 and R2 bindings must match this file. Use the inventory commands in docs/DEPLOY.md **Inventory Workers and hostnames**. A matching name is not ownership. Do not adopt, create, delete, empty, or rebind live D1 or R2. If the account or bindings differ, stop and report; do not switch accounts to make the deploy work.

## Automatic deployment

Read the actual workflows and Actions variables in the verified origin repository, as update-from-upstream does. With the stock workflow and `ENABLE_PRODUCTION_DEPLOY=true`, a push or merge to `main` is the deploy. A repository-level `ENABLE_PRODUCTION_DEPLOY=false` is off. A missing repository-level variable does not rule out an inherited organization variable; check it with `gh variable list --org <org>` or the organization settings, and treat deployment as unknown until that value is resolved. A failed variables read is unknown; do not treat this as off.

- Deployment on, commit is on `origin/main`: Actions already deploys this commit. Prefer letting that run finish and verifying it. Deploy from the operator's machine only if they want to bypass or repair a failed run, and say so in the report.
- Deployment on, commit is not on `origin/main`: deploying from the operator's machine leaves the live Worker ahead of `origin/main`, and the next merge to `main` replaces it without notice. State that consequence and continue only if the operator accepts it.
- Deployment off or unknown: this skill is the deploy path. Enabling the variable later does not redeploy this commit.

## Check, bookmark, migrate, deploy

Run the check block from INSTALL.md **Commit and deploy** (`skill:render` with `--check`, `wrangler types`, `typecheck`, `lint`, `test`). Stop on any failure. Do not change test identities to match this installation.

Record a D1 Time Travel bookmark before touching the remote database, using the configured database name:

```sh
npx wrangler d1 time-travel info <database_name>
```

List pending migrations, then apply them and deploy in that order, as docs/DEPLOY.md **Migrations after a deploy** requires:

```sh
npx wrangler d1 migrations list <database_name> --remote
npx wrangler d1 migrations apply <database_name> --remote
npx wrangler deploy
```

Stop on a migration failure and preserve the error, the bookmark, and the migration history. Never stamp `d1_migrations`, rewrite an applied migration, or run ad hoc production SQL. Do not deploy the Worker over a failed migration. If a rollback is being considered, read the token expiry rollback floor in that same section first.

## Verify live

Follow INSTALL.md **Verify the installation**: the anonymous probes on both origins, human sign-in, the compiled hub script, and a real disposable publish that loads and updates on the content origin. Confirm the served version matches the deployed commit. A health response alone is not completion. Reuse an existing valid agent token; request human approval only if a new connection is needed. Clean up only fixtures created for this check.

## Report

Deployed commit and branch, account and Worker name, D1 and R2 bindings, the Time Travel bookmark, migrations applied, whether automatic deployment is on and how this deploy relates to `main`, acceptance evidence with secrets removed, and any path not exercised. Report blocked paths as blocked.
