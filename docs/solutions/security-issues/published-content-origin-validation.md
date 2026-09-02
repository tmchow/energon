---
title: Validate the published content origin before writes
date: 2026-09-01
category: security-issues
module: published-content-boundary
problem_type: security_issue
component: infrastructure
symptoms:
  - "The hub emitted published links on the authenticated host."
  - "A missing or invalid CONTENT_ORIGIN could fail after a file write had already persisted data."
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [content-origin, origin-isolation, published-content, fail-closed]
---

# Validate the published content origin before writes

## Problem

Energon serves authenticated hub pages and user-published HTML from the same Worker. The origin split is only effective when the hub gives the browser the content host and every publishing operation validates that host before mutating storage.

## Symptoms

- The hub's slug availability check followed a cross-origin redirect without CORS and treated an existing slug as available.
- A write could persist R2 and D1 state, then return a 503 while constructing the public URL if `CONTENT_ORIGIN` was unavailable.

## What Didn't Work

- Keeping the hub's single `origin` value for all browser URLs sent slug probes and launch links to the hub. The hub redirect protected the eventual page load but did not make the browser's cross-origin `fetch` reliable.
- Checking `CONTENT_ORIGIN` only inside `filePublicUrl` detected bad configuration too late. The storage mutation had already completed.

## Solution

Expose both origins in the hub bootstrap. Keep `origin` for hub and API requests, and use `content_origin` for published links and content probes:

```js
const ORIGIN = (boot.origin || location.origin).replace(/\/$/, "");
const CONTENT_ORIGIN = (boot.content_origin || ORIGIN).replace(/\/$/, "");
```

Validate the content origin at the start of each loose-file publishing operation, before the first storage mutation. `contentOrigin(env)` rejects missing, malformed, or same-origin production configuration with a 503. The same preflight applies to create, duplicate, and replacement paths in `src/files.ts`.

## Why This Works

The browser now probes and displays the host that serves published content, so it does not depend on a cross-origin redirect from the authenticated hub. The Worker also checks the fail-closed boundary before writing R2 or D1, which prevents a configuration error from leaving an object the caller never received.

## Prevention

- Keep API and hub URLs on `PUBLIC_ORIGIN`; build published URLs from `CONTENT_ORIGIN`.
- When a URL builder can throw for configuration, call its validation before any storage mutation in each create, copy, replace, or import path.
- Test both the rendered hub bootstrap and the write failure path. Assert that an unavailable content origin causes a 503 and zero storage writes.

## Related Issues

- Related: PR #7 review feedback on hub content URLs and write ordering.
