---
title: Credential expiry must be a separate policy from content expiry
date: 2026-09-02
category: architecture-patterns
module: token expiration policy
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "Adding expiry to a new entity type (credentials, sessions, invites) where the codebase already has expiry or retention machinery for another type (content, files, sites)"
  - "The existing expiry helper treats unparseable or missing values as never-expire, which is right for content and wrong for auth-sensitive rows"
  - "Deciding whether an expired row is swept or retained as an audit trail"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - database
tags: [token-expiry, credential-expiry, fail-closed, policy-separation, api-tokens, content-retention, authentication]
---

# Credential expiry must be a separate policy from content expiry

## Context

Adding per-token expiration (`expires_at` on the API Token, plan: `docs/plans/2026-09-02-0233-feat-api-token-expiration-plan.md`, branch `tmchow/feat-api-key-expiration`, unmerged as of this writing) meant Energon now has two independent expiry regimes: content retention (sites and loose files, `src/expire.ts`) and Token Expiry (`src/policy.ts`, `src/auth.ts`). The natural first move — reuse the retention machinery for tokens, since both are "an `expires_at` column that gets checked against `Date.now()`" — was tried in the first draft and rejected during doc review. Content and credentials fail differently, get configured differently, and get cleaned up differently, and conflating them would have shipped three separate bugs at once.

## Guidance

Treat expiry as three distinct decisions per resource type, and give each type its own primitives rather than sharing the content ones:

**1. Fail-closed vs fail-open on bad data.** `isExpired()` (`src/expire.ts:25-29`) is deliberately fail-open: `if (!expiresAt) return false;`, and a value that fails `Date.parse` also returns `false` because the `Number.isFinite(t)` check short-circuits the `&&`. That is correct for content — never delete a site or file because its `expires_at` column got corrupted. `tokenExpired()` (`src/policy.ts:236-240`) is the fail-closed mirror for credentials:

```ts
export function tokenExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const t = Date.parse(expiresAt);
  return !Number.isFinite(t) || t <= now;
}
```
Null/undefined still means "never expires" (so existing rows without the column stay valid), but any non-null value that doesn't parse counts as expired rather than immortal. The first draft cited `isExpired()` directly for token checks; a security reviewer during doc review caught that it would authenticate a token forever off a corrupted `expires_at`.

**2. Separate policy functions and a separate catalog, even where the shapes look identical.** Content retention (`instancePolicy()`, `src/policy.ts:125-182`) reads `ALLOW_UNLIMITED_RETENTION`, `DEFAULT_TTL`, `MAX_TTL`, `TTL_PRESETS`; it caps at 30 days when unlimited is off and treats `""`, `"none"`, `"unlimited"` as never (`isNever()`, `src/policy.ts:118-123`) via `resolveExpiresAt()` (`src/policy.ts:256-300`), which also accepts arbitrary durations, not just presets. Tokens get their own catalog and defaults instead of parameterizing the existing ones:

```ts
export const TOKEN_TTL_CATALOG = ["1d", "7d", "30d", "60d", "90d", "180d", "365d"] as const;
export const TOKEN_DEFAULT_TTL = "90d";
```
`tokenPolicy()` (`src/policy.ts:199-208`) builds a `TokenPolicy` from only `ALLOW_UNLIMITED_TOKENS`, and `resolveTokenExpiresAt()` (`src/policy.ts:220-233`) resolves against that policy's fixed preset list: missing/empty input takes the default, and anything not in the catalog is a 400 `bad_ttl` — no arbitrary durations, unlike content's `resolveExpiresAt()`. Unit tests in `test/unit/policy.spec.ts` assert that the content-only env vars (`ALLOW_UNLIMITED_RETENTION`, `DEFAULT_TTL`, `MAX_TTL`, `TTL_PRESETS`) have no effect on `tokenPolicy()`'s output.

The "unset means allowed" default is also load-bearing and worth calling out on its own: `allowUnlimitedTokens()` (`src/policy.ts:195-197`) returns `true` when `ALLOW_UNLIMITED_TOKENS` is `undefined` (so `never` stays available on deployments that predate this feature) but, once the var is set to anything, delegates to the shared `flag()` helper (`src/policy.ts:48-51`):

```ts
function flag(value: string | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
```
`flag()` is an allow-list, not a deny-list — anything other than `1`/`true`/`yes` (including a typo like `"off"` or `"flase"`) resolves to `false`. The first draft used a three-word deny list instead, which would have accepted a typo'd value as truthy.

**3. Decide what happens to the record after it expires, per resource semantics.** Content sweeps and deletes: `sweepExpired()` and `purgeExpiredSite()`/`purgeExpiredFile()` (`src/expire.ts:154-351`) claim the row, delete the R2 object, then delete the D1 row — the resource is gone. Tokens do the opposite: an expired row is never purged. It stays in the table, and `listTokens()` (`src/auth.ts:245-278`) reports it with `expired: tokenExpired(r.expires_at)` (`src/auth.ts:274`) so `/tokens` can grey it out with a Revoke action. This is safe specifically because a token row is hash-only (`token_hash`, no recoverable secret), and it's useful because the row is the audit trail for why an agent's requests started failing.

That distinction carries into the auth error itself. `requireToken()` (`src/auth.ts:69-117`) checks in this order: bearer present → prefix matches → row found and not revoked → **`tokenExpired(row.expires_at)`** (`src/auth.ts:95`) → email allowed → bump `last_used_at`. Revoked wins over expired, and expiry is checked before `last_used_at` is ever touched, so an expired token never looks recently used. The 401 on expiry is a distinct code, `token_expired`, not the generic `unauthorized`, and its message is written as a terminal instruction for an agent (`tokenExpiredError()`, `src/auth.ts:34-43`): "Tokens cannot be extended... Do not retry with this token. Do not invent a token." That branch only executes after a token hash already matched a 32-character random secret (`hashToken()` / `TOKEN_SECRET_LEN`), so distinguishing it from `unauthorized` leaks nothing about tokens that don't exist.

## Why This Matters

Content retention and Token Expiry look like the same primitive — a nullable timestamp compared to now — but the failure modes point opposite directions. Content should survive ambiguity (never silently deleting someone's site because of a parse error); credentials should not (never silently authenticating on corrupted data). Content should disappear when it expires (that's the point of retention); a credential's row should outlive the credential (that's the audit trail). Sharing the machinery would have meant: an unparseable `expires_at` making a dead token immortal, content-only env vars accidentally capping or defaulting token lifetimes, and either silently purging the evidence of why a token stopped working or leaving agents to retry against a token that will never work again with only a generic `unauthorized` to go on. All three of these were caught by security review, not by initial implementation intuition.

## When to Apply

- Whenever a new resource type introduces its own `expires_at`/TTL concept and there's an existing expiry system in the codebase to reach for.
- Before assuming "same field name, same shape" implies "same function." Ask explicitly: what should happen on unparseable data (fail open or closed), what should the default and cap be, and what should happen to the record after expiry (delete vs. retain-and-mark).
- Especially when the new resource is a credential, secret, or anything security-adjacent — default to fail-closed and to keeping an audit trail, and get a security-focused review pass before merging, even if the content-side precedent fails open.

## Examples

Before (rejected first draft, per the security reviewer's finding): token expiry checks called `isExpired()` from `src/expire.ts` directly, and `ALLOW_UNLIMITED_TOKENS` acceptance used a small deny-list of falsy strings.

After (current code): `tokenExpired()` (`src/policy.ts:236-240`) fail-closes on unparseable non-null values; `allowUnlimitedTokens()` (`src/policy.ts:195-197`) delegates to the shared allow-list `flag()` (`src/policy.ts:48-51`) once the var is set; `TOKEN_TTL_CATALOG`/`TOKEN_DEFAULT_TTL` (`src/policy.ts:185-186`) and `tokenPolicy()`/`resolveTokenExpiresAt()` (`src/policy.ts:199-233`) are wholly separate from `instancePolicy()`/`resolveExpiresAt()`; expired tokens stay listed via `listTokens()` (`src/auth.ts:245-278`) instead of being swept like `src/expire.ts`'s `sweepExpired()` does for sites and files; and `requireToken()` (`src/auth.ts:69-117`) orders the expiry check after revocation and before the `last_used_at` bump, returning the terminal `token_expired` error (`src/auth.ts:34-43`) rather than the generic `unauthorized`.

Also load-bearing but out of scope for this note: rollback hazard — an older Worker build that doesn't know about the `expires_at` column on `tokens` would revive expired tokens, so `docs/DEPLOY.md` now records a rollback floor for this migration.

Verified by `test/unit/policy.spec.ts`, `test/unit/auth.spec.ts`, and `test/api.spec.ts`, plus a manual verify-energon drive and an agent acceptance run confirming a single request against an expired token, followed by a stop with no retry.

## Related

- [Custom token prefixes must be used across the token lifecycle](../runtime-errors/custom-token-prefix-authentication.md) — same token lifecycle in `src/auth.ts`; the same "do not let token behavior inherit an unrelated default" principle.
- [Loose-file replacement versus expiry purge race](../database-issues/loose-file-expiry-purge-race.md) — the content expiry and purge machinery in `src/expire.ts` that this learning deliberately does not reuse for credentials.
- [Validate the published content origin before writes](../security-issues/published-content-origin-validation.md) — another fail-closed-before-mutation precedent in this codebase.
- `docs/plans/2026-09-02-0233-feat-api-token-expiration-plan.md` — the plan, including the doc-review finding that replaced the `isExpired()` reuse.
- `docs/DEPLOY.md` — the rollback floor for the `expires_at` migration on `tokens`.

