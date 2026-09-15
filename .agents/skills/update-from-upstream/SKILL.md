---
name: update-from-upstream
description: Update this Energon from a published upstream release while preserving its configuration and customizations. Use when asked to upgrade or catch up a deployment repository. Does not cut upstream releases or migrate repository ownership.
---

# Update from upstream

Update this deployment repository to a published upstream release. Independent private copies and legacy GitHub forks use the same flow. A code update, landing on main, and deploying the Worker are distinct actions.

Done means the selected published release is merged, this Energon's configuration and customizations survive, local checks pass, and the update has landed by the path this repository's policy allows: a direct push to `main` for a routine update, or a pull request when policy, the operator, or an unresolved decision requires one. When landing deploys, verify the resulting source and live versions and report them separately. This policy is for an operator's deployment copy only; contributions to upstream still go through the upstream PR process in CONTRIBUTING.md.

## Resolve this checkout

Read this checkout's AGENTS.md, INSTALL.md, and any CONTRIBUTING.md or repository instructions that state how changes land. Run commands from the repository root:

```sh
node scripts/deployment-repo.mjs inspect
git status --short
```

The helper resolves origin explicitly and returns the repository, canonical identity, visibility, and upstream coordinates. Continue only when the helper returns `canonical: false`. If it returns `canonical: true`, this is the public release source: stop here without preparing an update. `isFork: false` is valid for an independent deployment repository; it does not identify the source template. If inspection fails, resolve the reported identity or access problem before changing branches or remotes. Do not switch to another repository because GitHub cannot read this one.

Read `docs/DEPLOYMENT-REPOSITORY.md`, section **Review an upstream release**, before fetching or merging. That file owns release selection, ancestry checks, conflict handling, GitHub targeting, the landing decision, and landing/deployment evidence. Follow its procedure. Use the verified origin repository for deployment variables, secrets, workflows, runs, branch policy, and PRs; use the verified upstream only for release reads. Do not rely on GitHub fork-parent metadata or GitHub Sync fork.

If this older checkout lacks the helper or reference, follow INSTALL.md **Update an existing Energon** using explicit origin and upstream identities. Stop if the available instructions cannot establish those identities or shared Git ancestry; do not improvise a destructive reset.

## Merge and preserve the installation

Merge the fetched release ref with a regular merge on a temporary local branch. Never squash, rebase away upstream history, or force-push; the next update depends on the shared ancestry the merge records.

Do not replace `wrangler.toml`, `instance-skill.json`, generated `plugins/`, or marketplace catalogs with upstream placeholders. Preserve deliberate code customizations when resolving conflicts. After the merge, run `npm run skill:render` so the generated plugin and marketplace catalogs pick up the new `version.txt`, then commit those generated files. Plugin versions follow Energon releases even when skill content is unchanged. Keep instance names, repository coordinates, and other configuration intact. Run the local checks in INSTALL.md **Commit and deploy** and affected user paths through verify-energon before deciding how to land.

Do not create, delete, empty, or rebind live D1 or R2. Do not stamp `d1_migrations` or run ad hoc production SQL. Do not run interactive `wrangler login` in an unattended cloud agent.

## Choose how to land

Inspect this repository's actual landing policy: its written instructions, branch protection, and rulesets on the landing branch. First establish deployment behavior (next paragraph), then run the helper with what you know:

```sh
node scripts/deployment-repo.mjs landing-path --deploy off
```

Add `--instructions-require-pr`, `--review`, `--decision "<customization>"`, `--deploy on|off|unknown`, `--deploy-detail`, and `--authorized` as `docs/DEPLOYMENT-REPOSITORY.md` **Choose how to land** describes; `branch-policy main` prints the policy read alone. Land by the returned `path`. `push-main` means a routine update pushes the merged commit to `main` directly; The temporary local branch is not a PR. `pull-request` means policy, the instructions, the operator's review request, or an unresolved conflict requires one; leave any conflict on the PR branch and ask about that specific customization. `blocked` with `policy unknown` means the policy read failed: report the specific failure it names (missing permission, network, wrong repository) and resolve it before landing. Do not treat a failed read as "unprotected" and do not treat it as "PR required"; either assumption is a guess. `blocked` with `linear history is required` means a regular merge cannot land on this branch; ask the operator rather than squashing away upstream ancestry.

Before pushing `main` or merging a PR, establish whether the actual workflows deploy on landing. With the stock workflow and `ENABLE_PRODUCTION_DEPLOY=true`, a push or merge to `main` is the deploy: it runs tests, migrates D1, and deploys. A failed variables read is unknown; do not treat this as off. If deployment is on or unknown, do not land unless the operator authorized the possible migration and deployment after that consequence was explained. Reuse existing authorization: an operator who asked for the update knowing it deploys has authorized it, and does not need to be asked again for each step. When the actual workflows are confirmed not to deploy on landing, do not run remote migrations or deploy without deployment authority. Enabling the variable later does not redeploy this commit.

Before any authorized remote migrate, inventory-match the live bindings and record a D1 Time Travel bookmark with `npx wrangler d1 time-travel info <database_name>`. Stop on migration failure. A durable D1 export and R2 copy is `backup-this-energon`; it is not required for an ordinary update. When the operator asks to deploy this update from their machine instead of through Actions, use the `deploy-this-energon` skill.

## Verify what landed

After a push or merge, confirm the remote landing branch is at the exact merged commit and that its Actions run for that commit finished. When the run deployed, verify the live installation per INSTALL.md **Verify the installation**. Report updated source and verified live deployment as separate facts; a pushed `main` that has not deployed, or whose deployment was not checked, is an updated source, not an updated Energon.

Report the release tag and commit, the landing path and why it was chosen, the pushed or merged commit, preserved identity and customizations, conflict decisions, local verification, pending migrations, the Actions run result, and whether the Worker and marketplace changed. Landing the repository or deploying the Worker does not update already-installed client plugins; clients refresh from the marketplace as INSTALL.md **Refresh an installed plugin** describes. Report blocked paths as blocked, including private plugin access that was not exercised on the intended client.
