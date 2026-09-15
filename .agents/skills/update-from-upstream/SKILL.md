---
name: update-from-upstream
description: Update this Energon from a published upstream release while preserving its configuration and customizations. Use when asked to upgrade or catch up a deployment repository. Does not cut upstream releases or migrate repository ownership.
---

# Update from upstream

Prepare a reviewable release update in this deployment repository. Independent private copies and legacy GitHub forks use the same update flow. A code update, landing on main, and deploying the Worker are distinct actions.

Done means the selected published release is incorporated on an update branch, this Energon's configuration and customizations survive, local checks pass, and the operator has the diff and any deployment consequences. When landing or deployment was requested, complete that authorized work and verify the resulting source and live versions. Otherwise leave the update ready for review.

## Resolve this checkout

Read this checkout's AGENTS.md and INSTALL.md. Run commands from the repository root:

```sh
node scripts/deployment-repo.mjs inspect
git status --short
```

The helper resolves origin explicitly and returns the repository, canonical identity, visibility, and upstream coordinates. Continue only when the helper returns `canonical: false`. If it returns `canonical: true`, this is the public release source: stop here without preparing an update. `isFork: false` is valid for an independent deployment repository; it does not identify the source template. If inspection fails, resolve the reported identity or access problem before changing branches or remotes. Do not switch to another repository because GitHub cannot read this one.

Read `docs/DEPLOYMENT-REPOSITORY.md`, section **Review an upstream release**, before fetching or merging. That file owns release selection, ancestry checks, conflict handling, GitHub targeting, and landing/deployment evidence. Follow its procedure. Use the verified origin repository for deployment variables, secrets, workflows, runs, and PRs; use the verified upstream only for release reads. Do not rely on GitHub fork-parent metadata or GitHub Sync fork.

If this older checkout lacks the helper or reference, follow INSTALL.md **Update an existing Energon** using explicit origin and upstream identities. Stop if the available instructions cannot establish those identities or shared Git ancestry; do not improvise a destructive reset.

## Preserve the installation

Do not replace `wrangler.toml`, `instance-skill.json`, generated `plugins/`, or marketplace catalogs with upstream placeholders. Preserve deliberate code customizations when resolving conflicts. Regenerate the plugin from the resolved sources.

Do not create, delete, empty, or rebind live D1 or R2. Do not stamp `d1_migrations` or run ad hoc production SQL. Do not run interactive `wrangler login` in an unattended cloud agent.

Before landing on main, establish whether the actual workflows can deploy. With the stock workflow and `ENABLE_PRODUCTION_DEPLOY=true`, a push or merge to `main` is the deploy. A failed variables read is unknown; do not treat this as off. If deployment is on or unknown, do not land unless the operator authorized the possible migration and deployment after that consequence was explained. Reuse existing authorization. When the actual workflows are confirmed not to deploy on landing, do not run remote migrations or deploy without deployment authority. Enabling the variable later does not redeploy this commit.

Before any authorized remote migrate, inventory-match the live bindings and record a D1 Time Travel bookmark with `npx wrangler d1 time-travel info <database_name>`. Stop on migration failure. A durable D1 export and R2 copy is `backup-this-energon`; it is not required for an ordinary update. When the operator asks to deploy this update from their machine instead of through Actions, use the `deploy-this-energon` skill.

Report the release tag and commit, update branch or PR, preserved identity and customizations, conflict decisions, local verification, pending migrations, and whether the Worker and marketplace changed. Report blocked paths as blocked, including private plugin access that was not exercised on the intended client.
