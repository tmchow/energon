---
title: D1 counts trigger writes in meta.changes, so trigger-simulated races pass the wrong way
date: 2026-10-12
category: database-issues
module: D1 race and failure-injection tests
problem_type: test_failure
component: database
symptoms:
  - A race test that should see 409 gets 200 from the guarded PATCH.
  - The row the guarded UPDATE targeted is unchanged, yet the code took its success path.
root_cause: wrong_api
resolution_type: test_fix
severity: medium
tags:
  - d1
  - triggers
  - race-tests
  - meta-changes
  - mutation-harness
  - compare-and-swap
---

# D1 counts trigger writes in meta.changes, so trigger-simulated races pass the wrong way

## Problem

Guarded writes in this Worker decide success with `d1Changed`, which is `meta.changes > 0` (`src/expire.ts:52-53`). In D1, `meta.changes` also counts rows that a trigger writes. A test that simulates "a competing write lands between the read and the guarded UPDATE" with a trigger therefore reports success even though the guarded UPDATE changed nothing. The code under test takes its success path and the test fails, or worse, a test written to expect success passes for the wrong reason.

## Symptoms

- While adding link access, a PATCH race test built on `withD1Trigger` (`test/mutation-harness.ts:209`) expected `409 link_access_conflict` and received `200`.
- The outer UPDATE never applied (the target column was still unchanged), but the response reported the change as committed.

## What Didn't Work

- A `BEFORE UPDATE OF link_access` trigger that writes the competing value to the same row, then `SELECT RAISE(IGNORE)`, so the outer statement skips the row. SQLite skips the outer update as intended, but D1 reports `meta.changes = 1` for the outer statement because the trigger's own write is counted.

A local probe in the vitest-pool-workers suite confirmed it: a table `probe(id, a, b)` with a trigger `BEFORE UPDATE OF a ... BEGIN UPDATE probe SET b = 'raced' WHERE id = OLD.id; SELECT RAISE(IGNORE); END`. Running `UPDATE probe SET a = 'set' WHERE id = 'x'` left `a` NULL and `b = 'raced'`, and returned `meta.changes: 1`.

## Solution

Inject the competing write from JavaScript, immediately before the guarded statement executes, by intercepting `env.DB.prepare` for that statement. The race then happens in front of the real `WHERE` clause, and `meta.changes` reflects only the guarded UPDATE. The repo already uses this for claim races in `test/api.purge-claim.spec.ts` ("returns file_busy when a write claim wins each PATCH update race"), and `test/link-access.spec.ts` wraps it as `withCompetingWrite`:

```ts
async function withCompetingWrite<T>(marker: string, competing: string, action: () => Promise<T>): Promise<T> {
  const db = env.DB;
  const originalPrepare = db.prepare.bind(db);
  let injected = false;
  db.prepare = ((sql: string) => {
    const statement = originalPrepare(sql);
    if (injected || !sql.startsWith(marker)) return statement;
    const originalBind = statement.bind.bind(statement);
    return Object.assign(statement, {
      bind: (...values: unknown[]) => {
        const bound = originalBind(...values);
        const originalRun = bound.run.bind(bound);
        return Object.assign(bound, {
          run: async () => {
            injected = true;
            await originalPrepare(competing).run();
            return originalRun();
          },
        });
      },
    });
  }) as typeof db.prepare;
  try {
    return await action();
  } finally {
    db.prepare = originalPrepare;
    expect(injected).toBe(true);
  }
}
```

Drive the request over HTTP inside `action`, then assert the conflict status and that the guarded column did not change.

## Why This Works

The interception runs the competing write as a separate statement before the guarded UPDATE, so the guarded `WHERE` evaluates against the changed row and matches zero rows. `meta.changes` is then 0 and `d1Changed` reports the loss, which is the production race the test is meant to reproduce. No trigger runs inside the guarded statement, so nothing inflates its change count.

## Prevention

- Use `withD1Trigger` with `RAISE(ABORT, ...)` only to inject failures (an aborted statement). Do not use triggers to simulate a lost race, and never rely on `RAISE(IGNORE)` to mean "zero rows changed".
- Mutation-check every race test: disable the guard (for example, make the guard SQL `1 = 1`) and confirm the test fails. The link-access race tests were mutation-checked this way when they were written.
- Assert `injected` is true, as `withCompetingWrite` does. An interception keyed on SQL text silently stops firing when the statement changes. `test/api.purge-claim.spec.ts` matches `loadReplaceableLooseFile`'s SELECT by its full column-list text, and adding a column to that SELECT made one of its tests fail with a misleading assertion instead of a clear "never intercepted".

## Related Issues

- `docs/solutions/database-issues/multi-field-patch-claim-atomicity.md`: asks for tests that install a competing write immediately before the guarded statement; this doc explains which injection method works in D1.
- `docs/solutions/database-issues/loose-file-expiry-purge-race.md`: its trigger advice covers metadata aborts, which remain valid.
