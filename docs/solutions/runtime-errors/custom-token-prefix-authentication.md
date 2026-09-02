---
title: Custom token prefixes must be used across the token lifecycle
date: 2026-09-02
category: runtime-errors
module: token authentication
problem_type: runtime_error
component: authentication
symptoms:
  - A token minted by an instance with a custom prefix is rejected by its own authenticated API routes.
  - Token hints display the default prefix instead of the configured instance prefix.
  - Help text advertises a prefix that differs from the one used to mint or mask tokens.
root_cause: config_error
resolution_type: code_fix
severity: high
tags:
  - token-authentication
  - runtime-identity
  - token-prefix
---

# Custom token prefixes must be used across the token lifecycle

## Problem

An Energon instance can configure `TOKEN_PREFIX`, and `identityFromEnv` resolves that setting for authentication and help output. Token minting and masking instead used the compile-time default, so a custom instance returned credentials that its own API rejected and showed misleading token hints.

## Symptoms

Authentication checks the runtime prefix before hashing or looking up a token (`src/auth.ts:47-65`). The account minting path returned a token built with the default prefix, and token listing used the default prefix when masking secrets. The worker fixture did not override `TOKEN_PREFIX`, so the mismatch was invisible to the existing route tests.

## What Didn't Work

- Keeping the default `TOKEN_PREFIX` in minting and masking did not work for deployments that set `TOKEN_PREFIX`; the configured identity and compile-time constant then described different token formats.

## Solution

Derive every token presentation value from the same runtime identity. `mintToken` now prefixes new secrets with `identityFromEnv(env).tokenPrefix`, and `maskToken` accepts the environment so `listTokens` can use that same prefix (`src/auth.ts:141-167`, `src/auth.ts:170-202`). Calls that omit an environment retain the default behavior because `identityFromEnv({})` falls back to the default in `src/instance.ts:23-42`.

The regression test mints a token with `TOKEN_PREFIX: "custom_"`, stores the resulting hash, and sends the returned credential through `requireToken`; it also checks custom masking and help output (`test/unit/auth.spec.ts`). Route coverage continues to assert that the public help contract and default authentication guidance agree (`test/routes.spec.ts`).

## Why This Works

`identityFromEnv` is the runtime source of truth for an instance's token prefix. Authentication already reads it before accepting a bearer token, while help output already publishes it (`src/auth.ts:47-58`, `src/auth.ts:235-247`). Making minting and masking read that same identity removes the configuration split without changing default or legacy token behavior.

## Prevention

- Test each configurable credential format through the complete lifecycle: mint, authenticate, list/mask, and publish help.
- Keep token construction, validation, and presentation derived from `identityFromEnv(env)` rather than importing a compile-time default directly.
- Preserve a default-prefix test so deployments without `TOKEN_PREFIX` continue to accept existing default-format tokens.

## Related Issues

- None found in the repository's documented-solutions corpus.
