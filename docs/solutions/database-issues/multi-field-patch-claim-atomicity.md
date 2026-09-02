---
title: Multi-field patches must cross claim guards atomically
date: 2026-09-02
category: database-issues
module: content metadata patches
problem_type: database_issue
component: database
symptoms:
  - A rejected multi-field PATCH can persist an earlier field.
  - The response reports a claim conflict while password or retention metadata has already changed.
root_cause: concurrency
resolution_type: code_fix
severity: high
tags:
  - d1
  - patch
  - atomicity
  - purge-claims
  - write-claims
  - compare-and-swap
---

# Multi-field patches must cross claim guards atomically

## Problem

Site and loose-file PATCH requests could change password or retention metadata in one D1 UPDATE and then change `write_policy` in a second UPDATE. A purge or write claim could win between the statements, so the request returned a conflict after partially applying the patch.

## Symptoms

- A loose-file PATCH can return `409 file_busy` while its password has already changed.
- A site PATCH can return `410 expired` while its password has already changed.
- The requested `write_policy` remains unchanged, leaving a state that no successful response described.

## What Didn't Work

Applying the same claim predicate to each UPDATE protected each statement independently, but did not make the sequence atomic. The first statement could commit before a claim caused the second statement to affect zero rows.

## Solution

Build the assignment list exclusively from fixed, allowlisted column fragments and execute every requested field in one guarded UPDATE. The loose-file path adds password, expiry, and write policy to one statement whose predicate rejects purge claims and fresh write claims (`src/files.ts:572-594`). The site path uses the same single-statement shape with its purge-claim predicate (`src/sites.ts:478-499`).

Cache invalidation remains after the successful statement and only runs for fields that affect public content (`src/files.ts:596-598`, `src/sites.ts:501-503`).

## Why This Works

D1 applies a single UPDATE atomically. Either the claim predicate still matches and all requested columns change together, or it does not match and none of them change. The caller can therefore trust that a conflict response did not persist an undocumented prefix of the PATCH.

The deterministic tests install a competing write or purge claim immediately before the guarded statement runs, then assert both password and write policy retain their original values (`test/api.purge-claim.spec.ts:302-409`).

## Prevention

- Treat one HTTP PATCH as one database mutation when its fields share an authorization and conflict boundary.
- Do not assume identical WHERE predicates make a sequence of statements atomic.
- Construct dynamic SET clauses only from fixed internal fragments; bind every value.
- Inject the competing claim immediately before execution and assert every requested field remains unchanged on conflict.
- Keep cache invalidation after the successful atomic mutation.

## Related Issues

- [Loose-file replacement versus expiry purge race](./loose-file-expiry-purge-race.md) defines the claim lifecycle and conflict responses.
- [Site storage mutations need compensation across R2 and D1](./site-storage-mutation-rollback.md) covers the broader requirement that failed cross-system mutations preserve their prior state.
