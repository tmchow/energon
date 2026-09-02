---
title: Site storage mutations need compensation across R2 and D1
date: 2026-09-01
category: database-issues
module: site-storage
problem_type: database_issue
component: database
symptoms:
  - A failed site-file request can replace or delete R2 bytes while retaining the old D1 row.
  - A failed import can leave a prefix of uploaded paths committed.
  - A failed duplicate can leave destination objects or metadata after the request reports an error.
root_cause: data_integrity
resolution_type: code_fix
severity: high
tags: [r2, d1, site-storage, rollback, data-integrity]
---

# Site storage mutations need compensation across R2 and D1

## Problem

Site files are represented by bytes in R2 and catalog metadata in D1. A mutation that commits one system and then fails in the other can make the public object disagree with its catalog, or can expose only part of a multi-file operation.

## Symptoms

- A PUT that fails during metadata persistence can return an error while the old object has already been overwritten.
- An import or duplicate that fails after one file can leave partial storage or rows behind.
- A DELETE that removes storage before metadata persistence can lose bytes while the row remains.

## What Didn't Work

The original ordering performed direct R2 writes/deletes followed by independent D1 statements. Suppressing duplicate cleanup errors made a failed copy look like an ordinary request failure even when destination state remained.

## Solution

Use the smallest transaction boundary available for metadata, and compensate the external R2 mutation whenever that boundary fails:

- `putSiteFile` snapshots the prior object, writes the replacement, then batches the file upsert and site timestamp update. A failed batch restores the snapshot or removes a newly-created key (`src/sites.ts:584-604`).
- `deleteSiteFile` snapshots the object, deletes it, and batches the row delete with the site update. A failed batch restores the object (`src/sites.ts:808-833`).
- `importSiteZip` snapshots each affected key and catalog row before processing. Any storage or metadata failure restores all affected keys and rows, including the previous site timestamp (`src/sites.ts:659-691`).
- `duplicateSite` tracks every destination key and removes those keys plus the newly-created catalog rows on any copy or metadata failure (`src/sites.ts:393-429`).
- `deleteSite` copies existing objects to a temporary backup prefix before deleting the live prefix. If deletion or the atomic metadata batch fails, backups restore the live keys; successful deletion removes the backups (`src/sites.ts:762-798`).

Rollback failures are surfaced as explicit 500 errors rather than being swallowed. This preserves the original error when compensation succeeds and identifies a separate recovery condition when it does not.

## Why This Works

R2 and D1 do not share a transaction. The code therefore treats each operation as a two-phase boundary: preserve or stage the R2 state, perform the D1 commit atomically where possible, and restore the preserved state on failure. Multi-file operations retain enough prior state to undo every path touched, so an error cannot silently commit an arbitrary prefix.

For whole-site deletion, backup keys avoid loading every object into Worker memory while still providing a recoverable copy if the subsequent prefix delete or D1 batch fails. Metadata deletion remains ordered with `site_files` before `sites`, preserving the foreign-key dependency.

## Prevention

- For every mutation that spans R2 and D1, list the external mutation boundaries and define compensation for each failure point before implementation.
- Use D1 `batch` for related metadata changes that must agree, and test that a failed batch leaves the prior rows unchanged.
- For multi-file operations, inject failures on an intermediate R2 write, an intermediate metadata write, final metadata, and cleanup; assert both bytes and catalog rows return to their original state.
- Treat cleanup failures as actionable errors. Never convert a failed copy or rollback into an unexplained success or silently ignored partial result.

## Related Issues

- Loose-file replacement already demonstrates the same-file snapshot-and-restore technique in `src/files.ts`; the site paths now apply the equivalent boundary-specific protection.
