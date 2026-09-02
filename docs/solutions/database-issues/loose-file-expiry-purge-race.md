---
title: Loose-file replacement versus expiry purge race
date: 2026-09-01
category: database-issues
module: loose-file storage
problem_type: database_issue
component: database
symptoms:
  - A replacement can overwrite an active expiry-purge marker.
  - The purge can delete replacement bytes while retaining the catalog row.
  - A live loose-file row can point at an object that no longer exists.
root_cause: concurrency
resolution_type: code_fix
severity: high
tags:
  - loose-files
  - expiration
  - purge
  - compare-and-swap
---

# Loose-file replacement versus expiry purge race

## Problem

Loose-file replacement used an initial row snapshot, wrote the replacement to R2, and then updated D1 without a generation guard. An expiry purge could claim the row between those operations, delete the newly written object, and then fail its conditional row delete after the replacement overwrote the purge marker.

## Symptoms

- A catalog row remains available while its R2 bytes are missing.
- The failure requires an interleaving between replacement, expiry claim, and R2 deletion, so sequential tests do not expose it.

## What Didn't Work

The existing purge marker only protected PATCH TTL updates. It did not protect the pre-fix `putLooseFile` path, whose unconditional catalog update could replace the marker after `claimExpiredFile` claimed the row.

## Solution

Use a distinct, unique write claim in `loose_files.last_written_by` before reading or writing R2. The claim compares the row's observed expiry and writer, rejects active purge/write markers, and requires the expiry still to be in the future:

```sql
UPDATE loose_files
SET last_written_by = ?, updated_at = ?
WHERE id = ?
  AND (expires_at IS NULL OR expires_at > ?)
  AND ((expires_at = ?) OR (expires_at IS NULL AND ? IS NULL))
  AND ifnull(last_written_by, '') = ?
  AND ifnull(last_written_by, '') NOT LIKE ?
  AND ifnull(last_written_by, '') NOT LIKE ?
```

`putLooseFile` keeps this marker through the R2 replacement, the guarded metadata update, and renamed-object cleanup. It releases the marker with `WHERE id = ? AND last_written_by = ?`; failed pre-commit operations restore the previous object and writer with the same CAS discipline. `claimExpiredFile` treats a fresh write marker like a fresh purge marker and takes its filename from the claimed row before deleting R2.

## Why This Works

The purge and replacement now compete for the same D1 row claim before either operation can mutate R2. If replacement claims first, purge observes a fresh write claim and does nothing until replacement has committed and released it. If purge claims first, replacement's CAS fails before any R2 write. A deterministic deferred-operation test covers both orderings and verifies the end state is either a complete replacement or a complete purge.

## Prevention

- Claim a catalog generation with a conditional D1 update before touching external storage.
- Keep the claim through every storage mutation and release it only after catalog commit and cleanup.
- Test both claim orderings with deferred R2 operations, asserting both catalog presence and object presence together.

## Related Issues

- `test/api.purge-claim.spec.ts` contains the deferred replacement/purge interleaving tests.
