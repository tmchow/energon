# Review Policy

How PR review, human or automated, raises findings in this repo and what it
leaves alone. The rules a change is checked against are in
`CODING_STANDARDS.md`. The PR process and template are in `AGENTS.md` and
`CONTRIBUTING.md`.

## How to raise a finding

- **Raise the whole class in one finding.** When a rule is broken on one path,
  check its siblings and list every instance in that finding. For a response
  rule, that is each host × responder × method. For a new object state, that
  is each feature named in `CODING_STANDARDS.md` ("A new state reaches every
  feature"). Missing siblings found one round or one PR at a time is the
  pattern this repo most needs to stop.
- **Name the rule and the failure.** State which rule applies and the concrete
  request, account, or sequence that breaks.
- **Check the shared layer first.** Before flagging a header or cache policy
  set in a helper, read the router and the outer response handler. A later
  layer may already set or override it.
- **Mark uncertainty as a question.** Phrase the finding as a question when
  you cannot verify it from the code.
- **Raise design problems once.** When the approach is wrong, raise it once as
  a design finding, not once per edge case.

## Severity

- **P0:** another account can read, detect, or overwrite an object, share
  password, or token; content is served unsandboxed from the content origin;
  data loss or orphaned R2 bytes; a production deploy or migration without
  authorization.
- **P1:** a user path fails in production but not locally (content host,
  fork settings, platform limits); quota or catalog drift; a mutation that
  leaves state needing an operator; unknown treated as "off" on a path that
  can land or deploy.
- **P2:** a contract surface out of date (help, `llms.txt`, OpenAPI, skill,
  verify map); UI states that mislead without losing data.
- **P3:** copy and polish. At most three per review.

## Evidence a finding needs

- **Platform behavior** (D1 limits, Workers static asset matching, cache
  purge, request budgets) cites the Cloudflare docs or a reproduction.
- **Browser behavior** (CORS, sandbox, opaque origins, preflight, fonts and
  module scripts) cites the spec or a browser run. A `curl` that succeeds does
  not show a page can read the response.
- **"Works locally"** is not evidence for content-host behavior, because local
  runs serve one origin.

## Check the PR body against the head

After fix-up commits, the What, Verify, and How to test sections still
describe the code at head. A How to test step that opens a removed file,
quotes old copy, or depends on recipe order is a finding.

## What not to flag

- **Anything lint, typecheck, oxlint, the drift tests, goldens, or CI already
  catches.** Existing oxlint complexity warnings in files the PR does not
  touch are known.
- **Code that is already fixed** on the current head.
- **Settled decisions.** A choice recorded in the PR body ("Decisions not
  taken", "Design decisions"), a plan, or `docs/solutions/`. For a security or
  data-loss risk, raise one question that cites the decision.
- **Intentional test fixtures.** Worker bindings in `vitest.config.ts`
  (hub and content origins, `esperlabs.app` emails).
- **Deployment identity absent upstream.** `plugins/`, marketplace catalogs,
  and real origins do not exist in this tree by design.
- **Old plans.** Files under `docs/plans/` are snapshots.
- **Findings already declined** with reasoning, unless there is new evidence.

## Maintaining this file

Add a "what not to flag" category only after the team has declined it across
several PRs. Rules about the code itself belong in `CODING_STANDARDS.md`.
