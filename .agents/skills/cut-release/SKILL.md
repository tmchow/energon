---
name: cut-release
description: Cut an upstream Energon GitHub Release via the standing release-please PR. Use when asked to cut a release, tag, publish a GitHub Release, or merge the release-please Release PR. Does not tag or bump versions itself.
---

# Cut a release

release-please already maintains one standing Release PR on `tmchow/energon` (`version.txt`, `CHANGELOG.md`). Merging that PR is the cut. The next `release-please` run on `main` tags `vX.Y.Z` and publishes the GitHub Release.

This skill does not tag, bump, or write changelog entries. It is the SOP for a human or agent asked to cut a release.

The skill lives in `.agents/skills/cut-release/`; `.claude/skills/cut-release` and `.cursor/skills/cut-release` are symlinks to it.

## Hard stops

- Canonical repo only: `tmchow/energon`. On a company fork, stop.
- Do not `git tag` or `gh release create` except the labeled Bootstrap path. Do not invent a semver on a later cut.
- Do not open a substitute PR. If there is no `autorelease: pending` PR, there is nothing to cut (or bootstrap has not run).
- Do not invent Operator notes that are not in the Release PR diff.
- Do not merge the Release PR unless the human explicitly said to merge.
- Do not `wrangler deploy`. A release is not an upgrade of anyone’s Energon.

## Find the PR

```
gh pr list --repo tmchow/energon --label "autorelease: pending"
```

If none, stop. Either nothing releasable has landed since the last tag, or bootstrap has not run.

## Read the diff

Expect only `version.txt`, `CHANGELOG.md`, and `.release-please-manifest.json`. If the changelog is hidden-type noise (`docs`, `ci`, `chore`, `test`, `style`, `refactor`) with no `feat`, `fix`, `perf`, `revert`, or breaking change, do not cut.

## Write Operator

Edit the Release PR body. Keep the generated lists. Add:

```
## Operator
- D1: <new migrations or none>
- wrangler.example.toml: <new keys or none>
- Plugin: regenerate / unchanged
- Rollback floor: <token expiry or none>
```

## Ask the human to merge

Stop. After they merge, the next `release-please` run on `main` publishes the GitHub Release.

## Verify

```
gh release view --repo tmchow/energon
```

The newest release is the new tag, includes the Operator section, and is not a draft. `version.txt` on `main` matches the tag without the `v`.

## Bootstrap (first cut only)

After the release-please workflow is on `main` and there is no `v*` tag, the first Release PR will try to swallow every historical `feat`/`fix`. Do not ship that as 1.0.0 notes.

Instead:

1. Set `"release-as": "1.0.0"` once on the root package in `release-please-config.json`, or set the manifest and `version.txt` to `1.0.0` and tag `v1.0.0` on that commit with a hand-written body “Initial public release” and Operator: none.
2. Remove `release-as` after that cut.
3. Later cuts use the normal path above.
