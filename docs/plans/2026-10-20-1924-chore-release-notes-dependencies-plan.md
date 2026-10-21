---
title: Dependency Updates in Release Notes - Plan
type: chore
date: 2026-10-20
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Dependency Updates in Release Notes - Plan

## Goal Capsule

- **Objective:** Operators reading an Energon Release PR or GitHub Release see every Renovate dependency change that lands in their deployment repository when they merge it, including dev tooling, CI runtimes, and security bumps. Dependabot PRs stay outside this work (see Scope Boundaries).
- **Means:** Carry non-runtime dependency updates on the `build` commit type and show `build` as a "Dependencies" release-notes section (KTD1, KTD2).
- **Authority:** Product Contract Requirements, then KTDs, then units.
- **Stop conditions:** Stop if release-please cannot show `build` as a section, or if the Renovate preset order makes the runtime `fix(deps)` rule unreachable.
- **Execution profile:** Config and docs only; verified by unit policy tests and a Renovate config validation.
- **Finish and ship:** `ce-work` implements; the LFG pipeline reviews and opens the PR.

## Product Contract

### Summary

Unhide the `build` commit type in release-please as a "Dependencies" section, make Renovate title every non-runtime dependency update `build(...)`, and update the docs that state which commit types reach operators.

### Problem Frame

Release PR #174 (1.15.2) listed three entries. It omitted Node 24 in CI, TypeScript 7, vitest 5, and the sharp and undici security bumps, because Renovate titled them `chore(...)` and release-please hides `chore`. Operators merge whole releases into deployment repositories, so these changes reach them unannounced.

### Requirements

**Release notes**

- R1. Release notes show a "Dependencies" section listing `build` commits; `chore` and the other hidden types stay hidden.
- R2. Runtime `dependencies` updates keep appearing under Bug Fixes as `fix(deps)`.

**Renovate titles**

- R3. Renovate titles devDependency, GitHub Actions, workflow Node version, and npm `overrides` updates with the `build` type.

**Contributor and release docs**

- R4. AGENTS.md, CONTRIBUTING.md, and the cut-release skill state that `build` appears in releases as Dependencies and is reserved for dependency changes.

### Key Decisions

- **`build` is the carrier type, shown as "Dependencies".** (session-settled: user-approved — chosen over unhiding `chore` or inventing a new type: `build` covers external dependencies in Conventional Commits and the PR-title check already accepts it.) Governs R1, R3.
- **Runtime dependencies stay `fix(deps)`.** (session-settled: user-approved — chosen over moving them to `build`: they change the shipped Worker and belong under Bug Fixes.) Governs R2.
- **No GitHub repository or Dependabot settings change in this work.** (session-settled: user-approved — chosen over disabling Dependabot security updates here: a settings change needs its own confirmation.)

### Scope Boundaries

- Rewriting titles of already-merged PRs for 1.15.2 is handled separately, outside this PR.
- Dependabot security-update PRs (for example #173) still arrive as `chore(deps)` and stay hidden until Dependabot is configured or disabled.
- Listing individual packages inside grouped Renovate PRs is not built; release-please only reads commit titles. Clearer group names are the bounded improvement (KTD4).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Add a catch-all `build` packageRule ahead of the runtime rule.** `config:recommended` extends `:semanticPrefixFixDepsChoreOthers`, whose packageRules set `chore` for `*` and `fix` for `dependencies`. User packageRules apply after preset rules, so a top-level `semanticCommitType` would lose; a first user rule `matchPackageNames: ["*"]` → `build` overrides the preset, and the existing `dependencies` rule re-applies `fix` after it. This covers devDependencies, `overrides`, GitHub Actions, and Node in workflows without per-manager rules. Source: `lib/config/presets/internal/default.preset.ts` and `config.preset.ts` in renovatebot/renovate. (session-settled: user-approved — instantiates the `build` carrier decision; governs R2, R3.)
- KTD2. **Add `build` to `changelog-sections` as visible "Dependencies".** release-please filters by type only, so the section is the whole mechanism. Governs R1.
- KTD3. **Drop the explicit `semanticCommitType: "chore"` from the devDependencies and actions rules.** They would otherwise override KTD1. Keep their scopes (`deps-dev`, `deps`).
- KTD4. **Rename Renovate groups to read as sentences in a changelog.** `runtime` → `runtime dependencies`, `tooling` → `dev tooling`, `actions` → `GitHub Actions`, so entries read "update runtime dependencies" rather than "update runtime". Group branch names change once; open group PRs are superseded on the next Renovate run.

### Assumptions

- Renovate vulnerability-alert PRs inherit `semanticCommitType` from packageRules, so the `overrides` security bumps become `build(deps)`.
- A batch containing only `build` commits will open a Release PR on its own; this is intended and noted in the PR body.

### Risks & Dependencies

- Renovate validates config only when it runs. The validator (`npx --package renovate renovate-config-validator`) is the pre-merge check.
- A contributor using `build` for a non-dependency build change would put it under "Dependencies". The docs in R4 steer them to `chore` or `ci`.

---

## Implementation Units

### U1. Show `build` as Dependencies in release-please

- **Goal:** Release notes include a Dependencies section.
- **Requirements:** R1; KTD2.
- **Dependencies:** none.
- **Files:** `release-please-config.json`, `test/unit/contribution-policy.spec.ts`.
- **Approach:** Replace the hidden `build` entry with `{ "type": "build", "section": "Dependencies" }`, placed after Reverts so it renders last.
- **Patterns to follow:** existing `changelog-sections` entries; the release-please assertions in the "keeps release-please on canonical main" test.
- **Test scenarios:**
  - The config declares `"type": "build"` with section "Dependencies" and without `"hidden": true`.
  - `chore`, `docs`, and `ci` remain hidden.
- **Verification:** policy test passes and fails if `build` is re-hidden.

### U2. Title non-runtime dependency updates `build`

- **Goal:** Renovate PRs for devDependencies, Actions, Node, and overrides use `build`.
- **Requirements:** R2, R3; KTD1, KTD3, KTD4.
- **Dependencies:** none.
- **Files:** `renovate.json`.
- **Approach:**
  1. Insert a first packageRule matching all packages that sets `semanticCommitType` to `build`.
  2. Keep the `dependencies` rule setting `fix` / `deps`.
  3. Remove `semanticCommitType: "chore"` from the devDependencies and actions rules.
  4. Rename the three group names per KTD4.
- **Test expectation:** none -- Renovate config has no repo test harness; verified by the Renovate config validator.
- **Verification:** `renovate-config-validator` reports the config valid.

### U3. Update release and contribution docs

- **Goal:** Docs state that `build` reaches operators as Dependencies.
- **Requirements:** R4.
- **Dependencies:** U1.
- **Files:** `AGENTS.md`, `CONTRIBUTING.md`, `.agents/skills/cut-release/SKILL.md`, `test/unit/contribution-policy.spec.ts`.
- **Approach:**
  1. `AGENTS.md` PR-title bullet: operators see `feat`, `fix`, `perf`, breaking, and `build` (Dependencies).
  2. `CONTRIBUTING.md` Commits and titles: one line that `build` appears in release notes as Dependencies and is for dependency changes.
  3. cut-release "Read the diff": `build` counts as releasable; the hidden-noise list drops nothing else.
- **Test scenarios:**
  - AGENTS.md mentions `build` as Dependencies in the release-please sentence.
- **Verification:** contribution-policy tests pass.

---

## Verification Contract

| Check | Command | Applies to |
|---|---|---|
| Policy tests | `npm run test:unit -- test/unit/pr-title.spec.ts test/unit/contribution-policy.spec.ts` | U1, U3 |
| Renovate config | `npx --yes --package renovate -- renovate-config-validator` | U2 |
| JSON validity | `node -e 'JSON.parse(require("fs").readFileSync(f))'` per edited JSON file | U1, U2 |

## Definition of Done

- All three units land; the checks above pass.
- No experimental or abandoned edits remain in the diff.
