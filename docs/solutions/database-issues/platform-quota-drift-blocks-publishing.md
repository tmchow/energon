---
title: Platform quota drift blocks publishing; R2 orphans only cost money
date: 2026-09-08
category: database-issues
module: platform storage ledger
problem_type: database_issue
component: database
symptoms:
  - "Every publish fails with 413 storage_cap while the catalog is far below the platform cap"
  - "platform_quota.used is larger than SUM(size) over site_files and loose_files"
  - "Nothing on the hub explains the refusal until the health card exists"
root_cause: logic_error
resolution_type: tooling_addition
severity: high
tags: [platform-quota, storage-cap, ledger-drift, r2-orphans, admin-health, recompute, d1, r2]
---

# Platform quota drift blocks publishing; R2 orphans only cost money

## Problem

`platform_quota.used` is a single-row ledger (`src/db.ts:113-116`, `migrations/0012_platform_quota.sql`) that every publish reserves against before writing bytes (`assertStorageRoom`, `src/http.ts:301-324`). Reservations that are never released make the ledger drift high. Once it reaches the platform cap, every publish on this Energon fails with `413 storage_cap` even though the real catalog is well under the limit, and before PR #74 there was nowhere to see that the two numbers disagreed.

The same storage area has a second, quieter inconsistency: R2 objects with no catalog row, and catalog rows whose bytes are gone. During the admin-tooling design in September 2026 the two were deliberately separated. Ledger drift blocks users and shipped a fix. Orphans cost storage money and block nobody, so the bucket scan was deferred with its design recorded here.

## Symptoms

- `POST /v1/files` and site publishes return `413 storage_cap` with a `used_bytes` figure nobody recognizes (`src/http.ts:249-259`).
- `GET /v1/admin/health` shows `quota.used_bytes` above `quota.catalog_bytes` (`src/admin-health.ts:52-57`).
- Deleting content does not bring `used_bytes` back down by the expected amount.

## What Didn't Work

- Relying on bootstrap to self-correct. `ensureSchema` inserts the row at zero and reseeds from `SUM(size)` only `WHERE id = 1 AND used = 0` (`src/db.ts:184-190`). A drifted ledger is never zero, so it is never touched again.
- Treating release as reliable. `releaseStorage` clamps at zero and swallows its own failure (`UPDATE platform_quota SET used = MAX(0, used - ?)` with `.catch(() => undefined)`, `src/http.ts:292-299`). A failed or interrupted release after a reservation is invisible, and the clamp means errors can only accumulate upward.
- Reading the catalog instead of the ledger. `usedStorage` falls back to `totalStoredBytes` only when the ledger row is missing (`src/http.ts:272-276`). Replacing the ledger with a live `SUM` on every publish would lose the atomic reserve that stops concurrent publishes from jointly overshooting the cap.

## Solution

PR #74 made the drift visible and repairable without deleting anything:

- `GET /v1/admin/health` and the `/admin` health card show `used_bytes`, `catalog_bytes`, and `limit_bytes` side by side (`src/admin-health.ts:23-66`). Drift is the difference.
- `POST /v1/admin/quota/recompute` (hub twin `POST /account/admin/quota/recompute`, button `#admin-health-recompute` behind a confirm dialog, `src/ui/components/AdminHealth.svelte:90-100`) sets the ledger from the catalog in one statement and records the action in `admin_audit` (`src/admin-health.ts:68-78`):

```sql
UPDATE platform_quota SET used = (
  (SELECT COALESCE(SUM(size), 0) FROM site_files) +
  (SELECT COALESCE(SUM(size), 0) FROM loose_files)
) WHERE id = 1
```

The subqueries run inside the `UPDATE` (`src/http.ts:278-290`), the same shape as bootstrap, so a snapshot read in JavaScript cannot overwrite a reservation that landed between read and write. A recompute during an in-flight publish can still drop that publish's reservation; that is the accepted repair contract, stated in PR #74.

### Deferred: the R2 orphan scan

Publish writes R2 first and D1 second (`src/files.ts:106-119`); a failure between them deletes the key on a best-effort basis, so an orphaned object needs the cleanup itself to fail. Catalog rows with missing bytes need the reverse. Both are reachable but neither changes the ledger, because the ledger is computed from D1 row sizes, not from the bucket. Orphan bytes cost storage money and nothing else, so the scan was not built. If it is ever needed, the design agreed at the time was:

- Walk the bucket a few `list` pages per request (R2 returns up to 1000 keys per page, the same bound `deletePrefix` uses for deletes at `src/sites.ts:135`), and return the R2 cursor so the caller continues in a later request. A Worker request has a bounded CPU budget and I/O wait does not count against it, so a few pages of list plus lookups fit comfortably.
- Cross-check keys against the catalog with `IN (...)` lookups in batches of about 90. D1 caps a statement at 100 bound parameters; PR #66 hit that limit in bulk token revoke and settled on 90 (`src/auth.ts:328-329`).
- Treat an object as an orphan only if it is older than an age guard of about an hour. A publish in flight has R2 bytes with no row yet.
- Report catalog rows with missing bytes; never delete them automatically. The owner may re-upload to the same address.
- At roughly 100k objects this is about 100 pages and around 20 requests, fine as an admin action. At around 1M objects a cron with persisted progress becomes worth it, and that needs a table, so it belongs in `migrations/` first.

## Why This Works

The ledger exists to make the cap check atomic, not to be the source of truth. D1 row sizes are the truth, and `recomputeStorage` re-derives the ledger from them in a single statement. Because failures only push `used` upward (release clamps at zero and swallows errors), recompute can only lower the figure toward reality, which is why it is safe to expose as a one-click repair. Making `used_bytes` and `catalog_bytes` visible together turns a mystery `413` into a number an operator can act on.

Separating drift from orphans kept the shipped surface small. The verify recipe proves the repair end to end by setting the ledger wrong in a throwaway D1 and recomputing (`.agents/skills/verify-energon/features/admin-health.md`).

## Prevention

- When a counter is derived from rows you already store, ship the recompute alongside the counter. A ledger with no repair path is a latent outage.
- Show the ledger and its ground truth next to each other wherever the ledger is displayed, so drift is a visible number rather than an inferred one.
- Keep the repair as a single `UPDATE ... SET x = (SELECT ...)` so it cannot clobber concurrent reservations with a stale snapshot.
- When a release path swallows errors by design, say so in a comment and make sure a recompute exists; do not add a second silent correction such as a bootstrap reseed that only fires in a state the bug never produces.
- Before building a consistency scanner, ask who it unblocks. Drift blocked every publisher; orphans blocked no one. Ship in that order.
- Any future bucket walk must respect three limits at once: R2 list page size, D1 bound-parameter count, and Worker request CPU. Batch at 90 parameters, return a cursor, and age-guard by about an hour.

## Related Issues

- `site-storage-mutation-rollback.md` documents the per-mutation R2 and D1 compensation that makes orphans rare in the first place. This document covers the ledger those mutations reserve against and what to do when it drifts anyway.
- `loose-file-expiry-purge-race.md` asserts quota accounting in its native D1 abort tests.
- PR #74 shipped health, recompute, sweep, and gate unlock, and explicitly excluded the orphan scan and any new tables. PR #66 is where the D1 bound-parameter limit was hit. Both are merged as of this writing.
- `.agents/skills/verify-energon/features/admin-health.md` is the user-path recipe for the recompute repair.
