---
name: cut-release
description: Cut an Energon GitHub Release via the standing release-please PR on this checkout. Use when asked to cut a release, tag, publish a GitHub Release, or merge the release-please Release PR. Does not tag or bump versions itself. Only the canonical source repository can cut upstream releases.
---

# Cut a release

release-please already maintains one standing Release PR (`version.txt`, `CHANGELOG.md`) on the repository that owns the workflow. Merging that PR is the cut. The next `release-please` run on `main` tags `vX.Y.Z` and publishes the GitHub Release.

This skill does not tag, bump, or write changelog entries. It is the SOP for a human or agent asked to cut a release. It lives in `.agents/skills/cut-release/`; `.claude/skills/cut-release` and `.cursor/skills/cut-release` are symlinks to it.

## This checkout

Run from the repository root:

```sh
node scripts/deployment-repo.mjs inspect
git remote -v
```

Proceed only when inspection returns `canonical: true` and the release workflow's `github.repository` guard names that same verified origin repository. A non-fork deployment copy is not the source template. On any deployment repository, stop; use `update-from-upstream` for an upgrade instead.

Use the returned `repository` as `RELEASE_REPO` and pass `--repo "$RELEASE_REPO"` to every GitHub read or write in this skill. The workflow guard remains required on copied repositories. If inspection or the guard cannot establish the canonical identity, stop without publishing.

## Hard stops

- Do not `git tag` or `gh release create` except the labeled Bootstrap path. Do not invent a semver on a later cut.
- Do not open a substitute PR. If there is no `autorelease: pending` PR, there is nothing to cut (or bootstrap has not run).
- Do not invent Operator notes that are not in the Release PR diff.
- Do not merge the Release PR unless the human explicitly said to merge.
- Do not `wrangler deploy`. A release is not an upgrade of anyone’s Energon.

## Find the PR

```
gh pr list --repo "$RELEASE_REPO" --label "autorelease: pending"
```

If none, stop. Check Actions “Release Please” before assuming nothing is releasable:

- `GitHub Actions is not permitted to create or approve pull requests` — a human must enable that in Settings → Actions → General. The workflow cannot grant it.
- `You do not have permission to create labels` — `.github/workflows/release-please.yml` is missing `issues: write`.

Otherwise nothing releasable has landed since the last tag, or bootstrap has not run.

## Read the diff

Expect only `version.txt`, `CHANGELOG.md`, and `.release-please-manifest.json`. If the changelog is hidden-type noise (`docs`, `ci`, `chore`, `test`, `style`, `refactor`) with no `feat`, `fix`, `perf`, `revert`, or breaking change, do not cut.

`version.txt` is the plugin version source. This PR updates it before operators generate the release's plugin. Do not regenerate plugins on this canonical checkout (it has none). Deployment repositories regenerate after they merge this release so manifests match the new `version.txt`. Plugin versions follow Energon releases even when skill copy is unchanged.

## Write Operator

Edit the Release PR body. Keep the generated lists. Add:

```
## Operator
- D1: <new migrations or none>
- wrangler.example.toml: <new keys or none>
- Plugin: regenerate after merge (version follows version.txt)
- Rollback floor: <token expiry or none>
```

## Ask the human to merge

Stop. After they merge, the next `release-please` run on `main` publishes the GitHub Release.

## Verify

```
gh release view --repo "$RELEASE_REPO"
```

The newest release is the new tag, includes the Operator section, and is not a draft. `version.txt` on `main` matches the tag without the `v`.

## Bootstrap (first cut only)

After the release-please workflow is on `main` and there is no `v*` tag, the first Release PR will try to swallow every historical `feat`/`fix`. Do not ship that as 1.0.0 notes.

Instead:

1. Set `"release-as": "1.0.0"` once on the root package in `release-please-config.json`, or set the manifest and `version.txt` to `1.0.0` and tag `v1.0.0` on that commit with a hand-written body “Initial public release” and Operator: none.
2. Remove `release-as` after that cut.
3. Later cuts use the normal path above.
