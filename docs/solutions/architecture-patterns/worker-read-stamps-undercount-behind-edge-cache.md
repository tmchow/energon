---
title: Worker-side read stamps are a floor behind the edge cache; view counts belong to edge logs
date: 2026-09-08
category: architecture-patterns
module: read tracking and public edge cache
problem_type: architecture_pattern
component: database
severity: medium
applies_when:
  - "Adding a read counter, last-read stamp, or popularity signal written from Worker code"
  - "Changing PUBLIC_CACHE_SECONDS, the cache-control header on public content, or the [cache] block in wrangler.toml"
  - "Writing copy that describes last_read_at or a filter built on it"
  - "Deciding how to answer a request for view counts or read analytics"
root_cause: config_error
resolution_type: config_change
related_components:
  - tooling
tags: [last-read-at, edge-cache, s-maxage, workers-cache, view-counts, inactivity, admin-cleanup, analytics]
---

# Worker-side read stamps are a floor behind the edge cache; view counts belong to edge logs

## Context

PR #67 added `last_read_at` to `sites` and `loose_files` (`migrations/0019_last_read_at.sql`). `noteRead` in `src/reads.ts` stamps it when the Worker serves an object's bytes, off the response path through `ctx.waitUntil`, and skips the write while the stored stamp is younger than `READ_THROTTLE_MS` (one hour, `src/reads.ts:3`, `src/reads.ts:23`). The column exists as an inactivity signal for cleanup: the `last_read_before` filter in `src/catalog.ts:302-304` matches rows whose stamp is null or older than the cutoff, and admin cleanup and the hub `/admin` page expose it.

While implementing it, the agent found that public, unpassworded GETs mostly never reach the Worker. `wrangler.toml` enables the Workers edge cache (`[cache] enabled = true`, `wrangler.toml:46-47`), and `src/cache.ts` set `s-maxage` from a constant then named `CACHE_UNTIL_PURGE_SECONDS = 31536000`, one year. A public object read once a day from a single colo would be answered from the edge for a year without a single stamp. The column was useless for exactly the content it was meant to cover.

PR #68 renamed the constant to `PUBLIC_CACHE_SECONDS = 86400` (`src/config.ts:14-15`). `publicCacheControl` now emits `s-maxage` as the smaller of that value and the object's remaining lifetime (`src/cache.ts:3-7`). The stamp lags real public reads by at most about a day plus the hourly throttle, and that bound is stated in the help body (`src/auth.ts:466`), `llms.txt` (`src/llms.ts:42`), the `noteRead` doc comment, and the migration header. PR #71 made the hub copy honest: the admin preview shows "No recorded read" for a null stamp (`src/ui/pages/Admin.svelte:117`) and the filter note says "Reads lag up to about a day" (`src/ui/pages/Admin.svelte:138`).

## Guidance

Treat any read signal written by the Worker as a floor, never a count, and pick the design by what the signal is for.

1. A Worker-side stamp can only say "read at least this recently". Every edge cache hit at any TTL above zero bypasses the Worker, so a counter incremented there undercounts and a timestamp there lags. Label it as a floor everywhere it appears: help text, `llms.txt`, hub copy. Write "No recorded read", never "unread" or "never viewed".

2. The cache TTL is the one knob that bounds the lag. `PUBLIC_CACHE_SECONDS` is the ceiling on how stale `last_read_at` can be for public content. Its doc comment says so (`src/config.ts:14`). Anyone touching it must know both directions: shortening it further buys accuracy that no consumer of `last_read_before` needs, and lengthening it silently widens the window in which an actively read object looks idle to cleanup, with no test or type error to catch it.

3. Do not tighten the TTL toward zero to make the stamp exact. Per this session's cost analysis, a cache miss costs one Worker invocation plus one R2 read, both priced per million requests at fractions of a dollar, and the cache is per colo, so the long TTL mostly helped hot assets that Energon has few of. One day is the balance point between an honest inactivity signal and cost.

4. If anyone wants real view counts, source them from the edge, not from Worker code. The requests the Worker never sees are still visible to Cloudflare: the GraphQL Analytics API can aggregate HTTP requests by path, and Logpush of the HTTP requests dataset can stream them (both plan dependent). A scheduled job would pull those into D1. Under that design the edge cache should stay long, because the Worker is no longer the observer. The two designs pull the TTL in opposite directions, so decide which one you are building before touching `PUBLIC_CACHE_SECONDS`.

Hashed static assets under `/static/ui/` are separate: `src/index.ts:145` sets `max-age=31536000, immutable` and they carry no read stamp, so the one-day cap does not apply to them.

## Why This Matters

The failure is silent. The stamp is written correctly for every request the Worker sees, tests that hit the Worker directly all pass, and only production traffic served from the edge reveals that popular public objects show no reads. An admin running `last_read_before` against that data would expire or delete content people open every day. Because the coupling lives in a numeric constant and a `wrangler.toml` flag rather than in a type or a test, the only guard is the comment on `PUBLIC_CACHE_SECONDS` and this document.

## When to Apply

- Adding any read counter, last-read stamp, or popularity signal written from Worker code.
- Changing `PUBLIC_CACHE_SECONDS`, the `cache-control` header on public content, or the `[cache]` block in `wrangler.toml`.
- Writing or reviewing copy that describes `last_read_at` or a filter built on it.
- Deciding how to answer a request for view counts or read analytics.

## Examples

Before PR #68 (`src/config.ts` as of PR #67):

```ts
/** Shared cache keeps public bytes until we purge on write or delete. HTTP has no infinite TTL. */
export const CACHE_UNTIL_PURGE_SECONDS = 31536000;
```

After PR #68 (`src/config.ts:14-15`):

```ts
/** Edge hits skip the Worker, so this TTL bounds how far last_read_at can lag real public reads. Writes and deletes still purge early. */
export const PUBLIC_CACHE_SECONDS = 86400;
```

The stamp itself, throttled and guarded so concurrent isolates cannot move it backwards (`src/reads.ts:20-37`):

```ts
if (Number.isFinite(last) && now - last < READ_THROTTLE_MS) return;
const write = env.DB.prepare(
  `UPDATE ${target.table} SET last_read_at = ? WHERE id = ? AND (last_read_at IS NULL OR last_read_at < ?)`,
).bind(stamp, target.id, floor).run();
if (ctx) ctx.waitUntil(write);
```

Copy that respects the floor (`src/ui/pages/Admin.svelte:117`):

```svelte
<Timestamp value={row.last_read_at} empty="No recorded read" />
```

## Related

- PR #67 added `last_read_at` and `noteRead`. PR #68 capped the public edge cache at one day. PR #71 changed the admin copy to "No recorded read". All three are merged as of this writing.
- `src/auth.ts` `helpBody` and `src/llms.ts` carry the floor sentence; `test/unit/golden.spec.ts` freezes both. `test/api.spec.ts` asserts the `s-maxage` value.
- `.agents/skills/verify-energon/features/admin-cleanup.md` names the "No recorded read" cell text for the user-path drive.
