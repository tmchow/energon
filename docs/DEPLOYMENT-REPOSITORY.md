# Deployment repository operations

[INSTALL.md](../INSTALL.md) owns first installation. A deployment repository is an independent copy with common upstream Git ancestry. New repositories are private by default. Public GitHub forks remain useful for contributing changes upstream.

## Review an upstream release

Work from the configured deployment checkout. Read `AGENTS.md` and inspect local changes before changing branches. Preserve unrelated work; use a separate worktree when necessary. Run `node scripts/deployment-repo.mjs inspect` from the repository root. Its `repository` is the verified origin; `upstream` is the canonical release source. A non-fork is not necessarily upstream. Stop the update if `canonical` is true. For a missing upstream remote, add the returned `upstreamUrl` as `upstream`; do not overwrite a different remote.

Use explicit repository coordinates from that output for GitHub operations. `gh` can otherwise select the parent of a legacy fork instead of the deployment repository. In these examples, set `DEPLOYMENT_REPO` and `UPSTREAM_REPO` to the returned values, and `RELEASE_TAG` to the published release selected below.

```sh
gh release view --repo "$UPSTREAM_REPO" --json tagName,isDraft,isPrerelease,body,url
```

If `upstreamConfigured` is false, add the returned `upstreamUrl` as the `upstream` remote after inspecting existing remotes.

Choose the latest stable published release by default, or the published tag the operator requested. Read its Operator notes for migrations, configuration keys, plugin regeneration, and rollback floor. If no release exists, or the requested tag is unpublished, stop and report that. Do not substitute unreleased `main`. Existing public forks can use this release flow without migrating first.

Fetch the selected tag into a dedicated remote-tracking ref so a local tag with the same name cannot redirect the merge:

```sh
git fetch upstream "refs/tags/$RELEASE_TAG:refs/remotes/upstream/releases/$RELEASE_TAG"
git rev-parse --is-shallow-repository
git merge-base HEAD "refs/remotes/upstream/releases/$RELEASE_TAG"
```

If the repository is shallow, fetch its missing history from the verified upstream before retrying ancestry. If there is still no common ancestor, stop: a file-only/template copy requires a separately reviewed migration. Do not use `--allow-unrelated-histories`, reset to upstream, or mirror-push. If the release ref already exists with different contents, inspect the moved tag rather than forcing the fetch.

Create a new update branch from the deployment's current branch after confirming it is the intended base. Record its pre-merge commit and the fetched release commit. Merge the fetched ref on that branch. If already contained, report the release as incorporated; do not create an empty update.

Resolve conflicts by preserving this installation's account, D1/R2 bindings, origins/routes, Access settings, policy, plugin identity, token prefix, and deliberate customizations. Review both versions of changed code. Compare new configuration keys with `wrangler.example.toml`; do not blanket-select either side of a conflicted configuration file. Regenerate plugins from the resolved templates and `instance-skill.json`. If intent is unclear, leave the conflict on the update branch and ask about that specific customization.

Run the checkout's local checks in [INSTALL.md](../INSTALL.md#6-commit-and-deploy), plus affected user paths through verify-energon. Present the diff, release commit, retained identity, pending migrations, and results for review. Commit or push the update branch only within the operator's request and repository rules. A code update request prepares a reviewable update; it does not automatically accept upstream code onto `main`.

Before landing, inspect the deployment repository's actual workflows, Actions variables, and secret names. Use explicit `--repo "$DEPLOYMENT_REPO"` for `gh variable`, `gh secret`, `gh workflow`, `gh run`, and PR operations. Read repository variables with `gh variable list --json name,value --repo "$DEPLOYMENT_REPO"`. An explicit repository-level `ENABLE_PRODUCTION_DEPLOY=false` disables the stock deploy job. A missing entry does not rule out an inherited organization variable; establish that value before treating deployment as off. A failed read leaves deployment behavior unknown. Custom workflows may deploy independently of this variable.

For the stock workflow, `ENABLE_PRODUCTION_DEPLOY=true` makes a push or merge to `main` run tests, migrate D1, and deploy. If deployment is enabled or unknown, explain the possible live change and obtain deployment authority before landing. Reuse explicit authorization already supplied. When deployment is off, landing still updates the private plugin marketplace; CLI migration/deploy requires deployment authority separately. Record a D1 Time Travel bookmark immediately before remote migrations. Stop on migration failure and follow [migration recovery](DEPLOY.md#migrations-after-a-deploy).

When authorized to land, use the repository's normal reviewed merge flow and check the exact resulting commit's Actions run. Enabling deployment after a commit was pushed does not replay the push. Verify the live installation through [INSTALL.md](../INSTALL.md#7-verify-the-installation) after deployment, and report source, plugin, and Worker versions separately if they differ.

## Migrate an existing public fork

Migrate only when the operator asks to move their deployment repository. Updating software alone does not authorize this move. Do not try to change a public fork's visibility: GitHub does not allow it. The destination is a new independent private repository, with a new repository name or owner.

1. Record the source repository and deployed commit; inspect dirty, staged, untracked, and ignored files. Inventory branches/tags, open PRs/issues, collaborators, rules, webhooks, Actions variables and secret **names**, and the plugin's current coordinates. Agree which Git refs and repository settings need to move. A Git copy does not transfer issues, PRs, release objects, permissions, Actions history, secrets, or settings. Keep the original checkout and repository available.
2. Record the existing Worker, account, D1/R2 bindings, hostnames, Access applications, plugin name, token environment and prefix. Repository migration does not move storage or require redeployment. If data backup is requested, use `backup-this-energon`; a Git clone does not back up D1 or R2.
3. Clone the existing configured repository with full history into a fresh directory. Confirm the intended branch includes every customization to retain. Create a new private repository with `gh repo create OWNER/NEW_REPO --private`, without a README or other initial commit. Verify its returned `nameWithOwner`, `isPrivate: true`, and `isFork: false` with `gh repo view OWNER/NEW_REPO --json nameWithOwner,isPrivate,isFork` before pushing anything. A name conflict or failed access check stops creation; never fall back to a public repository.
4. In the **new clone**, retain the old origin as `previous-origin`, add the new repository as `origin`, and add the canonical URL from INSTALL.md as `upstream` if absent. Run `node scripts/deployment-repo.mjs inspect` when available. Verify both fetch and push destinations and that `git ls-remote origin` is empty. Set and verify `ENABLE_PRODUCTION_DEPLOY=false` on the destination before its first push (step 5). Push only the reviewed deployment branch as `main` using a normal push, then verify its SHA matches. Push additional reviewed refs explicitly if required. Never mirror over an existing repository. Check `git merge-base` against upstream to prove shared ancestry.
5. Set `ENABLE_PRODUCTION_DEPLOY=false` in the new repository and read it back successfully, overriding any inherited organization variable. Keep new-repository auto-deployment off during migration. Restore the agreed collaborators, rules, variables, and hooks deliberately. Re-provision Actions secrets through their secret stores; GitHub cannot reveal old secret values. Keep the old deployment workflow from racing the new one when switching automation. Disabling or retiring the old deployment path must be part of the operator's authorized cutover.
6. Update only repository coordinates in `instance-skill.json` (`repo`, `marketplaceRepo`, and `marketplaceUrl`) and Wrangler's `MARKETPLACE_REPO`, then run `npm run skill:render` and its `--check`. Keep the plugin/skill/marketplace names, token environment, token prefix, origins, resource IDs, and policy unchanged. Review the generated catalogs; do not hand-edit them. Remove the old marketplace registration before registering the same marketplace name at its new URL, using the client's supported mechanism. Verify private installation on a teammate's intended client and check missing-access behavior.
7. Run installation checks. Deploy the new repository coordinates only when authorized, so `/setup`, `/v1/help`, and `/llms.txt` advertise the new location. Verify human sign-in, agent identity and a disposable publish/update. Enable push-to-main deployment only at the agreed cutover and verify an actual subsequent run. Keep the old repository until the operator decides how to retain or archive it; do not delete it as cleanup.

Moving to a private copy does not retract previously public material, Git history, or copies held by others. Public discovery continues to expose this Energon's repository coordinates and runtime policy. Published content keeps its existing access rules. If credentials were committed historically, rotate them through a separate incident response; repository privacy does not revoke them.

## References

- [GitHub: duplicating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository)
- [GitHub CLI: create a repository](https://cli.github.com/manual/gh_repo_create)
- [GitHub: fork relationships and visibility](https://docs.github.com/en/pull-requests/reference/forks)
