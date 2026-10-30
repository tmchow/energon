# Coding Standards

The judgement rules code in this repo follows. They cover the defect classes
that recur most in this repo's review history, especially the ones that took
a second or third PR to finish. Apply them while writing a change; reviewers
check the change against them.

This is not a full checklist, and a change can be wrong in ways it does not
mention. When another doc owns a rule, this file links to that doc and does not
restate it. Lint, typecheck, `openapi-drift`, goldens, and `skill:render --check`
enforce the mechanical rules, so they are not repeated here. How review raises
and skips findings is in `REVIEW.md`.

## Rules for every change

### A response rule covers every way the object is served

A header, status, sandbox, or method rule for published content applies to
every response that serves that object, not only the path that prompted the
change:

- **Both hosts.** `PUBLIC_ORIGIN` and `CONTENT_ORIGIN` take different code
  paths, and a later step on one host can overwrite what an earlier step set.
  Put the rule at the shared point every response passes through, not in one
  helper.
- **Every responder.** HTML, rendered markdown, raw bytes, directory listings,
  404s, the gated 401, and trailing-slash redirects.
- **Every method the route advertises.** If a preflight or `Allow` header names
  a method, that method is served with the same status and headers as GET.
- **Every content type in the class.** A rule for "scriptable" content covers
  every type a browser will run script in, not the familiar ones.

Tests for these rules run against the content host. Local `wrangler dev` and
verify-energon serve one origin, so they cannot show a cross-origin failure.

### A new state reaches every feature that touches the object

When a change adds an object state, access mode, or field (private links,
write policy, expiry, recovery-blocked), trace it through every feature that
reads, lists, writes, or describes objects in the same PR: hub catalog and
sheets, `/v1` list and get, cleanup by id and by filter, admin cleanup and
health, export, upload grants, guest writes, gates, and the publish skill.
A feature the PR does not change still needs a decision about the new state.

### One contract, every surface, same diff

When a `/v1` route, body, status, `ApiError` code, or agent-facing behavior
changes, every statement of it changes in the same diff: `helpBody`,
`llms.txt`, `openapi/v1.json`, `templates/skill/`, the goldens, and the
verify-energon feature files that name it. Hub copy that a recipe quotes
(dialog confirm text, labels, element ids) is part of the contract. The
`AGENTS.md` Layout table owns the list of surfaces; the Schema section owns
the three schema representations.

A documented alias, field, or cursor keeps working until the docs stop
advertising it.

### Other accounts cannot tell private from missing

A lookup by a client-supplied id, slug, or handle checks the caller's scope
before it returns anything. A response to an account that cannot see an
object is the same as for an object that does not exist: same status, same
skip reason, same timing class. Fallbacks that resolve a bare slug must not
reach another account's object or its secrets.

### Unknown is not "off"

A read that fails is unknown, not absent, false, or empty. Only a specific
expected answer (a 404 the API documents as "not set", a field explicitly
`false`) may mean absent. Check the value, not the presence of the key:
`{ enabled: false }` is off.

When the "on" answer would trigger a deploy, migration, overwrite, or
password rotation, unknown takes the safe branch and says so. A failed load
must not leave the UI in a state where saving replaces data the user never saw.

### Whatever grows has a bound that matches the platform

Each list, batch, upload, or loop fed by users or history has an explicit cap
sized against the real platform limit (D1 bound parameters and statement
size, Workers subrequest and CPU budgets, isolate memory). See the Cloudflare
limits pages rather than copying numbers here.

- Batch statements that bind one parameter per item.
- Page, and disclose what was left out with a cursor, `total`, or a count.
- Enforce byte caps on the stream itself. A missing or false
  `Content-Length` must not skip the cap.

### Mutations clean up on every exit and never race their own bookkeeping

Writes span D1, R2, and the edge cache, so each one can fail halfway.

- Take a snapshot, reservation, or temp object inside the `try` whose
  `finally` releases it. Do the checks that can reject (quota, claims) before
  creating anything that needs cleanup.
- A counter or ledger update is one statement against current rows, not a
  read followed by a write of the computed value.
- A rollback or restore must not resurrect bytes a concurrent purge or delete
  already removed. Check the purge claim before restoring.
- Work after the commit (cache purge, audit, migration side effects) is
  best-effort: it runs in `waitUntil` with a logged catch, never fails the
  request, and correctness never depends on it succeeding.
- A background sweep must not pick up rows a request is still creating.

`docs/solutions/database-issues/` holds the worked cases: rollback, purge
races, patch claim atomicity, quota drift.

### Changing what a URL means accounts for what caches already hold

When a change moves, deletes, privatizes, or re-versions content, decide what
the edge cache and browsers already hold for the old URL: purge it, make it
`no-store`, or version the URL. Vendored assets whose entry filename does not
change between releases carry a version in the URL.

### A UI action acts on exactly what the user sees

A bulk target built from hub state matches the visible, selected set. An empty
selection never means "everything". A filter that the target cannot carry
disables the action instead of being dropped. Responses are matched to the
request that asked for them, so a slow reply for a previous row cannot
overwrite the current one. Loading, failed, empty, and success render
differently; a failure never shows as a success flash or as empty data.

### Tests fail when the change is reverted

A test reaches the changed branch on the topology where the bug lives (the
content host, a fork with restrictive settings, an unsized body). Tests read
values that change every release, such as `version.txt`, instead of pinning
them, and do not inherit a fork's `wrangler.toml` settings.

## Area rules

### verify-energon recipes

- **Recipes run in any order.** Each recipe mints its own fixtures under a
  prefix no other recipe's query matches, and its assertions still hold after
  other recipes have run.
- **Identities derive from the doctor email.** Second identities use
  `DOMAIN="${EMAIL#*@}"`, never a fixed domain, so recipes work on a
  domain-locked deployment.
- **Commands capture what they assert.** A step that checks a status code or
  header records it.

The same-PR rule for keeping the map current is in `AGENTS.md`, Verify like a
user.

### Deployment-repository skills and scripts

Skills and helpers under `.agents/skills/` and `scripts/deployment-repo.mjs`
run against repositories this tree cannot see. They resolve state from the
remote (fetch before comparing to `origin/main`; read the variable at both
repository and organization level) rather than assuming the local checkout or
a default. The Unknown-is-not-off rule applies with extra force here because
landing can deploy production.

## Maintaining this file

- **Bar for adding a rule.** The defect class has recurred across several PRs,
  or one fix needed follow-up PRs to finish. No existing lint, typecheck, drift
  test, or CI check covers it. It fits in a few sentences that stay true
  without naming specific numbers or symbols.
- **When a rule becomes a check.** Promote a rule to a test or lint rule (as
  `openapi-drift.spec.ts` did for the `/v1` document) when the defect itself is
  machine-checkable. Then remove it here.
- **Review procedure goes elsewhere.** How to raise or skip a finding belongs
  in `REVIEW.md`.
- **Link the owner.** When a rule depends on a limit, list, or procedure that
  another doc owns, link that doc instead of copying the detail.
- **Remove rules that stop earning their place.** Remove a rule once a check
  covers it, or when reviewers keep raising it and authors keep declining it.
