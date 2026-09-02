---
module: scripts/render-skill.mjs
date: 2026-09-01
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "skill:init accepted traversal, separator, and absolute-path identifiers"
  - "A rename could recursively delete an existing destination before copying the old plugin tree"
  - "Rendered files could be written through an escaping path or symlink"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - path-traversal
  - skill-init
  - filesystem-safety
---

# Protect skill initialization filesystem boundaries

## Problem

The skill renderer uses plugin, skill, and marketplace names to construct paths below `plugins/` and `.agents/skills/`. Before this fix, command-line values and values persisted in `instance-skill.json` were accepted without a path safety check, so a rename could escape the plugin tree and replace or delete an unrelated destination.

## Symptoms

In a disposable copy of the repository, the historical pre-fix input `--plugin ../outside` caused `skill:init` to write the generated plugin under a sibling directory named `outside` and overwrite its contents. An existing destination was recursively removed during the same rename path.

## What Didn't Work

Relying on `path.join()` was insufficient: joining an untrusted segment does not establish that the resulting path is an intended child of the expected root. Checking only the textual path would also miss an existing symlink whose target resolves outside that root.

## Solution

Validate every identifier from both sources at the trust boundary with a strict single-segment slug pattern:

```js
const SAFE_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

`loadInstance()` validates persisted `skill`, `plugin`, and `marketplace` values, while `parseArgs()` validates the resulting values and an explicitly supplied `--name` before `main()` performs filesystem work (`scripts/render-skill.mjs:51-109`, `scripts/render-skill.mjs:152-268`).

Before rendering, `validateMutationTargets()` resolves all plugin-tree destinations, checks their nearest existing ancestor with `realpathSync()`, and rejects paths that leave the expected root (`scripts/render-skill.mjs:384-420`). It also rejects an existing destination when a plugin rename would otherwise replace it. The rename now copies only into a missing destination; it no longer recursively deletes that destination (`scripts/render-skill.mjs:422-436`).

## Why This Works

Identifier validation rejects empty values, `.` and `..`, separators, absolute paths, and other values that are not safe single-segment slugs before they can reach path construction. The containment check handles both lexical traversal and symlinked ancestors or files, and the preflight runs before the first mutation. Refusing a destination collision removes the destructive overwrite branch while preserving initialization into a new plugin directory.

## Prevention

When a CLI or persisted configuration value participates in filesystem paths:

- Validate it at the trust boundary, including values loaded from disk; do not rely on a caller or prior writer to have validated it.
- Resolve and verify the destination beneath its intended root before any write, rename, copy, or recursive removal. Check the nearest existing ancestor so symlinks are covered even when the final destination does not yet exist.
- Treat an existing destination as a collision unless its ownership and expected contents are proven; never recursively delete an untrusted destination to make a rename succeed.
- Keep disposable-repository tests for traversal, both path separators, absolute paths, invalid persisted configuration, symlinked destinations, and destination collisions. Keep one valid initialization test to guard the intended fork workflow (`test/unit/skill-render.spec.ts:61-181`).
