---
title: Node 24 and 26 CI Matrix with a Stated Minimum - Plan
type: chore
date: 2026-11-01
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Node 24 and 26 CI Matrix with a Stated Minimum - Plan

## Goal Capsule

- **Objective:** Operators who install or update Energon on Node 24 or Node 26 get code that CI has proven on their version, and they can see the supported minimum before they start.
- **Means:** Run the CI test job on a Node `[24, 26]` matrix behind a gate job that keeps the required check name, keep deploy on 24, and declare `engines.node >=24` in `package.json` and INSTALL.md (KTD1–KTD4).
- **Authority:** Product Contract Requirements, then KTDs, then units.
- **Stop conditions:** Stop if the `main` ruleset's required check cannot stay satisfied without a repository settings change.
- **Execution profile:** One PR. CI workflow, contribution-policy spec, `package.json`, lockfile root entry, and docs only.
- **Finish and ship:** `ce-work` implements; the LFG pipeline reviews and opens the PR. Closing Renovate PR #208 is left to the user.

## Product Contract

### Summary

Replace Renovate PR #208's single bump to Node 26 with a CI test matrix covering 24 and 26, keep the deploy job on 24, and make Node 24 the declared minimum.

### Problem Frame

Renovate PR #208 moves every workflow from Node 24 to 26. The Worker runs on workerd, so Node only drives tooling: wrangler, vitest, esbuild, jazzer, and `scripts/deployment-repo.mjs`, which operators run locally during install and upgrades. Most operators run Node 22 or 24 locally. Testing only on 26 could let code that needs 26 land unnoticed, and nothing tells operators which Node version is supported (`INSTALL.md` says only "needs Node.js").

### Requirements

**CI coverage**

- R1. The CI `test` job runs its full step list on Node 24 and on Node 26 for every PR and push to `main`.
- R2. The check name `Typecheck and tests`, which the `main` ruleset requires, keeps reporting and fails when either Node leg fails.
- R3. The `deploy` job stays on Node 24 and still waits for the tests to pass.

**Stated minimum**

- R4. `package.json` declares `"engines": { "node": ">=24" }`.
- R5. INSTALL.md states Node.js 24 or newer where it lists the helper's prerequisites, and README's local-source section states the same.

### Key Decisions

- **Test job runs a Node `[24, 26]` matrix.** (session-settled: user-approved — chosen over Renovate PR #208's single bump of all workflows to 26: operators' machines are mostly on 22/24, and CI on 26 alone could let 26-only code land unnoticed.) Governs R1.
- **Deploy stays on Node 24.** (session-settled: user-approved — chosen over moving deploy to 26 now: it only affects GitHub-hosted runners and needs no change in this PR.) Governs R3.
- **Declare `engines.node >=24` and document it.** (session-settled: user-approved — chosen over leaving the minimum unstated: makes the supported floor a deliberate decision, not whatever CI uses.) Governs R4, R5.

### Scope Boundaries

- Closing Renovate PR #208 happens after this PR opens, with the user's confirmation.
- The scheduled fuzz workflow stays on a single Node 24 job (KTD3).
- `engine-strict` is not enabled; npm warns on a lower Node version but still installs. Enforcing it would block operators on Node 22 outright, a separate decision.
- No Renovate rule changes for Node majors in this PR.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Matrix legs get their own names; a gate job keeps `Typecheck and tests`.** The `main` ruleset (id 22703276) requires the context `Typecheck and tests`. A matrix job reports `Typecheck and tests (24)` and `(26)`, which never satisfies that context, and giving both legs the same name would make two checks share one context. Rename the matrix job's display name to include the Node version, and add a small job named `Typecheck and tests` that `needs` the matrix and fails unless every leg succeeded (it runs with `if: always()` so a failed or cancelled leg reports failure, not skipped). Deployment repositories that copied the same ruleset keep working. Governs R2.
- KTD2. **Deploy keeps `needs` on the tests and its own `node-version: 24`.** `needs` on the gate (or the matrix job) waits for every leg. Governs R3.
- KTD3. **Fuzz stays single-version on 24.** It is a nightly ten-minute run on the ZIP parser, not a PR gate; doubling it adds cost without covering an operator path. Revisit when the default moves to 26.
- KTD4. **Refresh the lockfile root entry with npm, not by hand.** npm records the root `engines` in `package-lock.json` `packages[""]`. Regenerate with `npm install --package-lock-only` so the lock matches `package.json` and no dependency versions move.

### Assumptions

- Every devDependency (wrangler, vitest, oxlint, esbuild, jazzer) runs on Node 26; the Node 26 leg is where any incompatibility would show.
- No operator-facing doc besides INSTALL.md and README lists Node as a prerequisite; `docs/DEPLOY.md` and the `.agents/skills/` SOPs call `node` without stating prerequisites and inherit INSTALL.md's.

---

## Implementation Units

### U1. Run the test job on a Node 24/26 matrix behind a gate

- **Goal:** CI proves every PR on both Node versions while the required check name keeps working.
- **Requirements:** R1, R2, R3; KTD1, KTD2.
- **Dependencies:** none.
- **Files:** `.github/workflows/ci.yml`, `test/unit/contribution-policy.spec.ts`.
- **Approach:**
  1. Add `strategy.matrix.node: [24, 26]` with `fail-fast: false` to `test`, set `node-version` from the matrix, and name it `Typecheck and tests (Node <version>)`.
  2. Add a gate job named `Typecheck and tests` that needs `test`, runs `if: always()`, and fails unless `needs.test.result == 'success'`.
  3. Point `deploy` at the gate (or keep `needs: test`); leave its `node-version: 24`.
- **Patterns to follow:** existing pinned action SHAs and `timeout-minutes` in `ci.yml`; the workflow assertions in the contribution-policy spec.
- **Test scenarios:**
  - `ci.yml` has a job whose `name` is exactly `Typecheck and tests` (the ruleset context).
  - The `test` job's matrix includes Node 24 and 26.
  - The `deploy` job sets `node-version: 24`.
- **Verification:** contribution-policy tests pass; the PR's own checks show both legs and the `Typecheck and tests` gate green.

### U2. Declare and document the Node 24 minimum

- **Goal:** Operators see Node 24 as the supported minimum, and npm warns when they run older.
- **Requirements:** R4, R5; KTD4.
- **Dependencies:** none.
- **Files:** `package.json`, `package-lock.json`, `INSTALL.md`, `README.md`.
- **Approach:**
  1. Add `"engines": { "node": ">=24" }` to `package.json`.
  2. Regenerate the lockfile root entry with npm (KTD4).
  3. INSTALL.md helper prerequisites: "Node.js 24 or newer".
  4. README "Run the source locally": one line naming Node.js 24 or newer.
- **Test expectation:** none -- metadata and docs; verified by `npm ci` succeeding on both CI legs and a `package.json` JSON parse.
- **Verification:** `npm ci` works locally; the lockfile diff touches only the root `engines` entry.

---

## Verification Contract

| Check | Command | Applies to |
|---|---|---|
| Policy tests | `npm run test:unit -- test/unit/contribution-policy.spec.ts` | U1 |
| Workflow syntax | `actionlint .github/workflows/ci.yml` when installed, else YAML parse | U1 |
| Lockfile in sync | `npm ci` | U2 |
| PR checks | Both matrix legs and the `Typecheck and tests` gate pass on the PR | U1, U2 |

## Definition of Done

- Both units land; the checks above pass.
- The PR body notes that it supersedes Renovate PR #208.
