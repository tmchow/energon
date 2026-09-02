---
title: Batch site-import catalog upserts to remove D1 round trips
date: 2026-09-02
category: database-issues
module: site-storage
problem_type: performance_issue
component: database
symptoms:
  - A maximum-file-count site ZIP import issued one independent D1 upsert per file.
  - This optimization session measured a 2789.132 ms baseline mean and a 3531.489 ms p95 and p99, including Worker startup.
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [site-storage, zip-import, d1, batching, performance, round-trips]
---

# Batch site-import catalog upserts to remove D1 round trips

## Problem

A site ZIP import wrote each file to R2, then awaited a separate D1 metadata upsert. Because one archive can contain 200 files (`src/config.ts:7`), database round trips accumulated into a measurable worst-case latency cost.

## Symptoms

- In this optimization session, a controlled 200-file import benchmark including Worker startup measured a 2789.132 ms mean, 2729.865 ms p50, and 3531.489 ms p95 and p99.
- A same-runtime probe in this session measured 200 sequential D1 upserts at 527–967 ms, compared with 9–244 ms for one oversized diagnostic batch. The probe exposed the round-trip cost, but the 200-statement batch was not a production-valid implementation because D1 accepts at most 100 statements per batch.
- The pre-change source issued one metadata request per file, so its D1 request count scaled directly with archive file count.

The process measurement used `hyperfine --warmup 3 --runs 10` around a Worker test that created a site and imported one valid 200-file archive. The isolated probe alternated five sets of 200 sequential and batched upserts in one Worker runtime.

## What Didn't Work

The V8 profile captured in this session did not justify micro-optimizing ZIP path checks. `fflate` decompression accounted for 39.2% of its samples, while individual Energon path and policy functions each accounted for less than 1%. That would have added behavior risk without addressing the measured database round trips.

Submitting all 200 catalog upserts in one D1 batch also did not satisfy the provider contract. Local Miniflare accepted the oversized batch, but production D1 caps a batch at 100 statements. The final implementation therefore keeps the round-trip reduction while splitting the prepared statements at that boundary.

## Solution

Keep the existing per-file R2 order, but collect each prepared catalog upsert and submit the ordered statements in batches of at most 100:

```ts
const upserts: D1PreparedStatement[] = [];

for (const file of files) {
  await env.BUCKET.put(key, file.bytes, options);
  upserts.push(siteFileUpsert(env, handle, slug, file.path, size, contentType, ts, email));
}

for (let i = 0; i < upserts.length; i += D1_BATCH_MAX_STATEMENTS) {
  await env.DB.batch(upserts.slice(i, i + D1_BATCH_MAX_STATEMENTS));
}
```

The shared upsert still uses the same `INSERT ... ON CONFLICT ... DO UPDATE` statement (`src/sites.ts:92-110`). `importSiteZip` appends prepared statements and response paths during the existing R2 loop, then executes each bounded batch in order before updating the site row (`src/sites.ts:714-735`).

The compensation boundary remains intact. Before writes begin, the import records prior catalog rows; immediately before each R2 write, it snapshots that object. If an R2 write, any bounded D1 batch, or the site update fails, it restores affected R2 objects and catalog rows. Successful compensation releases reserved storage and rethrows the original error; failed compensation reports `site_import_rollback_failed` before the release (`src/sites.ts:702-743`).

The controlled first candidate measured a 1803.630 ms mean, 1760.086 ms p50, and 2266.538 ms p95 and p99, about 35–36% faster than baseline. After enforcing the 100-statement limit, the same harness was rerun separately and measured a 1092.172 ms mean, 1076.085 ms p50, and 1188.516 ms p95 and p99. The headline retains the conservative controlled A/B result because the final rerun happened later rather than interleaved with its baseline.

## Why This Works

The change reduces 200 D1 upsert requests to two ordered batch requests without removing or reordering metadata statements. [Cloudflare documents `D1Database.batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) as one call that executes its prepared statements sequentially as a transaction and rolls the sequence back when a statement fails. Energon still retains explicit compensation because its R2 operations are separate calls and a maximum-size import spans two D1 transactions (`src/sites.ts:722-743`).

Behavior remained isomorphic:

- Ordering is preserved because `unpackZip` builds an ordered file array (`src/zip.ts:87-110`) and the import loop appends both `written` paths and upserts in that order before processing consecutive slices (`src/sites.ts:722-734`).
- Tie-breaking, floating-point behavior, and RNG are not involved.
- During this session, `shasum -a 256 -c` passed for the captured ZIP output, and the aggregate five-import response signature remained `c24d1aeb068f45215f32a4a34522eb1333380381c13e7a6bf4d776e57d5e3872`.
- The integrity tests inject a one-shot batch failure, allow later restoration batches to succeed, and verify that catalog sizes and R2 bytes return to their original values. A 200-file regression also asserts that the import uses exactly two 100-statement batches (`test/site-integrity.spec.ts:82-143`).

This session's verification run passed generated types, type checking, lint, 155 unit tests, and 100 Worker tests. These results describe the branch before merge; they do not imply that it has shipped.

## Prevention

- Benchmark the supported 200-file boundary before and after changing the import pipeline, with identical startup treatment and at least p50, p95, and p99 measurements.
- Separate CPU profiling from I/O probes. The former identified decompression; the latter exposed the avoidable D1 request pattern.
- Keep golden ZIP and import-response outputs for every performance lever.
- Preserve the shared 100-statement ceiling and the max-size regression; local test runtimes may accept oversized batches that production D1 rejects.
- Preserve one-shot D1 failure injection. Failing every batch would test rollback failure instead of successful compensation after an import batch fails.
- Verify result equivalence, D1 transaction failure, and cross-store recovery independently whenever changing catalog batching.

## Related Issues

- [Site storage mutations need compensation across R2 and D1](./site-storage-mutation-rollback.md) defines the integrity contract this optimization preserves.
- [Issue #19](https://github.com/tmchow/energon/issues/19) tracks adjacent ZIP resource-limit pressure; it did not prescribe this batching implementation.
