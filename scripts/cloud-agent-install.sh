#!/usr/bin/env bash
set -euo pipefail

# Idempotent Cloud Agent bootstrap for the Energon Worker.
# Safe to run repeatedly and against cached state.

npm ci

# worker-configuration.d.ts is generated (gitignored) but required by typecheck.
npm run types

# Local D1 lives under .wrangler/state; applying migrations is a no-op once applied.
npx wrangler d1 migrations apply energon --local

# Local dev secrets. Keep any existing file the agent may have customized.
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
