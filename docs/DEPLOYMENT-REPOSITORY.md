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

Create a temporary local update branch from the deployment's current branch after confirming it is the intended base. Record its pre-merge commit and the fetched release commit. Merge the fetched ref on that branch with a regular merge so upstream ancestry stays in history. Never squash, rebase away upstream commits, or force-push: the next update's ancestry check depends on this merge. If already contained, report the release as incorporated; do not create an empty update.

Resolve conflicts by preserving this installation's account, D1/R2 bindings, origins/routes, Access settings, policy, plugin identity, token prefix, and deliberate customizations. Review both versions of changed code. Compare new configuration keys with `wrangler.example.toml`; do not blanket-select either side of a conflicted configuration file. After the merge, run `npm run skill:render` from the resolved templates, `instance-skill.json`, and `version.txt`, then commit the generated plugin and catalogs. Plugin versions follow the Energon release in `version.txt` even when skill content is unchanged. If intent is unclear, that conflict is an unresolved human decision: leave it on the branch, land through a pull request, and ask about that specific customization.

Run the checkout's local checks in [INSTALL.md](../INSTALL.md#6-commit-and-deploy), plus affected user paths through verify-energon. Record the diff, release commit, retained identity, pending migrations, and results; they go in the report or the PR body.

### Choose how to land

An update request includes landing the update by the path this repository's policy allows. Inspect that policy from three sources: the repository's written instructions (`AGENTS.md`, `CONTRIBUTING.md`, or equivalent), classic branch protection, and rulesets on the landing branch. The helper reads the last two through the GitHub API for the verified origin and combines them with what you learned from the instructions, the operator, the merge, and the deployment check below:

```sh
node scripts/deployment-repo.mjs landing-path --deploy off
```

Pass what applies: `--instructions-require-pr` when the repository's instructions require one, `--review` when the operator asked for review, `--decision "<customization>"` for each conflict you could not settle, `--deploy on|off|unknown` from the deployment check (with `--deploy-detail "<error>"` for a failed read), and `--authorized` when the operator already authorized the deployment consequence. `branch-policy [BRANCH]` prints the policy read alone. Land by the returned `path`; every `reasons` entry goes in the report or PR body.

| `path` | Land by |
| --- | --- |
| `push-main` | Push the merged commit to `main` directly. The temporary local branch needs no PR. Policy is known and allows it, the instructions do not require review, nothing is unresolved, and deployment is off or already authorized. |
| `pull-request` | Open a pull request from the update branch and follow the repository's review flow. Returned when protection or a ruleset requires a PR, status checks, signed commits, or restricted pushes; when the instructions require a PR; when the operator asked for review; or when a conflict needs a human decision. Name any open decision in the PR. Merge with a merge commit, never squash. |
| `blocked` | Do not land. `policy unknown` means the read failed: report the failure it names (permission, network, wrong repository) and resolve it. Do not assume "unprotected" and do not assume "PR required". `linear history is required` means a regular merge cannot land on this branch at all; ask the operator, because squashing would erase upstream ancestry. `deployment behavior unknown` and `has not authorized` are the deployment consequence below. |

`gh api` returns `Branch not protected` for a branch with no classic protection; the helper reports that as known and unprotected, not as a failure. Any other error is unknown. Upstream contribution PRs against the canonical repository are unaffected by this table; they always use the process in [CONTRIBUTING.md](../CONTRIBUTING.md).

### Deployment consequence

Before landing, inspect the deployment repository's actual workflows, Actions variables, and secret names. Use explicit `--repo "$DEPLOYMENT_REPO"` for `gh variable`, `gh secret`, `gh workflow`, `gh run`, and PR operations. Read repository variables with `gh variable list --json name,value --repo "$DEPLOYMENT_REPO"`. An explicit repository-level `ENABLE_PRODUCTION_DEPLOY=false` disables the stock deploy job. A missing entry does not rule out an inherited organization variable; establish that value before treating deployment as off. A failed read leaves deployment behavior unknown. Custom workflows may deploy independently of this variable.

For the stock workflow, `ENABLE_PRODUCTION_DEPLOY=true` makes a push or merge to `main` run tests, migrate D1, and deploy. If deployment is enabled or unknown, explain the possible live change and obtain deployment authority before landing. Reuse explicit authorization already supplied: an operator who asked for the update after that consequence was explained has authorized it, and should not be asked again at each step. When deployment is off, landing still updates the private plugin marketplace; CLI migration/deploy requires deployment authority separately. Record a D1 Time Travel bookmark immediately before remote migrations. Stop on migration failure and follow [migration recovery](DEPLOY.md#migrations-after-a-deploy).

### Verify what landed

After the push or merge, confirm the remote landing branch is at the exact merged commit (`git ls-remote origin refs/heads/main`) and check that commit's Actions run with `gh run list --repo "$DEPLOYMENT_REPO" --commit <sha>`. Enabling deployment after a commit was pushed does not replay the push. When the run deployed, verify the live installation through [INSTALL.md](../INSTALL.md#7-verify-the-installation). Report updated source and verified live deployment as separate facts, and report source, plugin, and Worker versions separately if they differ. A pushed `main` whose deployment did not run or was not checked is an updated source, not an updated Energon.

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
