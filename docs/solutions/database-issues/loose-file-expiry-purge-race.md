---
title: Loose-file replacement versus expiry purge race
date: 2026-09-01
last_updated: 2026-09-02
category: database-issues
module: loose-file storage
problem_type: database_issue
component: database
symptoms:
  - A replacement can overwrite an active expiry-purge marker.
  - The purge can delete replacement bytes while retaining the catalog row.
  - A failed delete rollback can overwrite a concurrent replacement.
  - A stale write claim can keep a live file permanently busy.
  - A PATCH race can report an active writer as an expired file.
root_cause: concurrency
resolution_type: code_fix
severity: high
tags:
  - loose-files
  - expiration
  - purge
  - write-claims
  - compare-and-swap
---

# Loose-file replacement versus expiry purge race

## Problem

Loose-file replacement used an initial row snapshot, wrote the replacement to R2, and then updated D1 without a generation guard. An expiry purge could claim the row between those operations, delete the newly written object, and then fail its conditional row delete after the replacement overwrote the purge marker.

Manual deletion exposed the same boundary in reverse. It snapshotted and deleted the R2 object without a claim. If its D1 delete failed after a concurrent replacement committed, rollback could restore the old bytes over metadata for the replacement.

The initial claim fix also needed a lifecycle beyond acquisition and release. A failed post-commit release could leave a `__energon_writing__` marker on a non-expired row, permanently blocking later PUT and PATCH requests. PATCH also treated every guarded UPDATE miss as expiry, so a writer that claimed the row after PATCH's snapshot surfaced as `410 expired` instead of `409 file_busy`.

## Symptoms

- A catalog row remains available while its R2 bytes are missing.
- The failure requires an interleaving between replacement, expiry claim, and R2 deletion, so sequential tests do not expose it.
- A live file returns `409 file_busy` forever after an abandoned write marker.
- A PATCH racing with an active replacement returns `410 expired`, misleading clients into treating a temporary conflict as deletion.

## What Didn't Work

The existing purge marker only protected PATCH TTL updates. It did not protect the pre-fix `putLooseFile` path, whose unconditional catalog update could replace the marker after `claimExpiredFile` claimed the row.

Adding compensation to deletion was not sufficient on its own. The snapshot and restore steps preserved sequential failure behavior, but without a claim they could race a replacement and turn rollback itself into the corrupting write.

Rejecting every write marker was safe only while release was assumed to succeed. Logging a failed release without a stale-claim recovery rule turned the marker into a permanent lock. Likewise, mapping a zero-row PATCH UPDATE directly to `expiredError` relied on the initial snapshot even though another writer could claim the row before the guarded statement ran.

## Solution

Use a distinct, unique write claim in `loose_files.last_written_by` before reading or writing R2. The claim compares the row's observed expiry and writer, rejects purge claims and fresh write claims, permits stale write-claim reclamation, and requires the expiry still to be in the future:

```sql
UPDATE loose_files
SET last_written_by = ?, updated_at = ?
WHERE id = ?
  AND (expires_at IS NULL OR expires_at > ?)
  AND ((expires_at = ?) OR (expires_at IS NULL AND ? IS NULL))
  AND ifnull(last_written_by, '') = ?
  AND ifnull(last_written_by, '') NOT LIKE ?
  AND (
    ifnull(last_written_by, '') NOT LIKE ?
    OR updated_at IS NULL
    OR updated_at <= ?
  )
```

`putLooseFile` keeps this marker through the R2 replacement, the guarded metadata update, and renamed-object cleanup. It releases the marker with `WHERE id = ? AND last_written_by = ?`; failed pre-commit operations restore the previous object and writer with the same CAS discipline. `claimExpiredFile` treats a fresh write marker like a fresh purge marker and takes its filename from the claimed row before deleting R2.

`deleteLooseFile` acquires the same leased marker before it snapshots or deletes R2. Its claim variant permits an already-expired row so an authorized delete can still complete, while the compare-and-swap predicates continue to reject active purge and write claims (`src/expire.ts:75-129`). The catalog delete requires the unique claim token. On failure, deletion restores R2 before releasing the marker; a missing row after failed acquisition remains `410 expired`, while a competing writer remains `409 file_busy` (`src/files.ts:712-787`).

Write markers are leases. Their `updated_at` timestamp makes an abandoned marker reclaimable after the shared stale-claim interval, while the unique token and writer snapshot keep reclamation compare-and-swap safe (`src/expire.ts:63-118`). When a stale marker is replaced, rollback restores the file creator rather than reinstalling the abandoned marker (`src/expire.ts:106-107`). PUT and PATCH reject only fresh write claims in their initial snapshots (`src/files.ts:396-398`, `src/files.ts:552-554`).

Every PATCH UPDATE applies the same predicate: purge claims always block the mutation, while write claims block it only while their lease is fresh (`src/files.ts:580-620`). If a guarded UPDATE changes zero rows, PATCH reads the current marker and returns `409 file_busy` for a write claim; purge, expiry, or row removal remains `410 expired` (`src/files.ts:638-645`).

## Why This Works

The purge, replacement, and manual deletion now compete for the same D1 row claim before any operation can mutate R2. If replacement claims first, purge and deletion cannot touch its bytes. If purge or deletion claims first, replacement's CAS fails before any R2 write. Deterministic tests cover the replacement/purge orderings and attempt a replacement during deletion, verifying that storage and catalog state move together (`test/api.purge-claim.spec.ts:5-45`).

Keeping the deletion claim through compensation closes the rollback race. A failed catalog delete cannot restore old bytes while another request commits new metadata, because replacement stays blocked until rollback finishes and the marker is released. The failure-path test also verifies that a successful rollback restores the prior writer (`test/files.spec.ts:254-320`).

The lease closes the crash/release-failure state without weakening active concurrency protection: only a marker whose stored timestamp has crossed the stale cutoff can be replaced. The post-UPDATE read closes the separate PATCH snapshot race by classifying the state that actually defeated the conditional write, rather than guessing from the earlier snapshot.

## Prevention

- Claim a catalog generation with a conditional D1 update before touching external storage.
- Keep the claim through every storage mutation and release it only after catalog commit and cleanup.
- Keep the claim through compensation too; releasing it before rollback reopens the race the claim was meant to prevent.
- Give temporary claims a bounded lease, and use the current token plus timestamp in the reclamation predicate.
- After a guarded mutation loses, classify the current state before choosing a permanent (`410`) or retryable (`409`) response.
- Test both claim orderings with deferred R2 operations, asserting both catalog presence and object presence together.
- Test stale recovery and fresh rejection on every mutation surface, plus each guarded UPDATE variant that can lose after its snapshot.

## Related Issues

- `test/api.purge-claim.spec.ts` contains the deletion/replacement race, deferred replacement/purge interleavings, stale and active claim cases, and the PATCH race matrix.
- PR #12 established the leased write-claim lifecycle. The deletion and rollback extension is in PR #28, open as of 2026-09-02.
