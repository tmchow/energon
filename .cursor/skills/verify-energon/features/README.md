# Energon verification map

This directory is the maintained source for verifying the user-facing behavior of a local Energon host. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-energon/bin/launch` so the Worker uses `/tmp/energon-verify/$RUN/persist`, not `.wrangler/state`.
- Origin is `http://127.0.0.1:$PORT` (default port `18787`). `GET /v1/help` `hub`, `content_origin`, and the origin of `openapi` must equal that origin. `GET /v1/openapi.json` (no auth) is the `/v1` contract with `servers[0].url` set to that origin; use it to check a route's request shape or `error` code before reporting a product bug.
- Run `.cursor/skills/verify-energon/bin/doctor` and require pid ownership of the port, hub HTML, and a signed-in email.
- Mint with `.cursor/skills/verify-energon/bin/mint-token` when the recipe needs `/v1`. Do not invent a token.
- Identity on localhost is `dev@example.com` unless `.dev.vars` sets `DEV_ACCESS_EMAIL`. Handle is the email local-part (`dev` for the default).
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer `#id`, ARIA labels, and `/v1` paths over CSS position or tab order.
- Treat every command as literal. Keep slugs, headers, and filenames unchanged.
- HTTP actions use `curl` against `$ORIGIN` with `Authorization: Bearer $TOKEN` on `/v1`.
- Browser actions use the hub at `$ORIGIN/` and the ids in the skill Drive section.
- Restore or delete fixture objects in persist-backed storage; do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen or write JSON.
- Browser proof includes a screenshot with the Energon name and `#who` email visible.
- HTTP proof includes method, path, status, and body (or content-type + excerpt for file bytes).
- Mutation proof includes a read-only second view: public URL, hub catalog, or `GET /v1/sites/{slug}`.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with energon-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Discovery documents](./discovery.md) covers unauthenticated `GET /v1/help`, `GET /v1/openapi.json`, `GET /v1/health`, `GET /llms.txt`, and `GET /auth.md`.
- [Publish a site](./publish-site.md) covers creating a named folder, writing files, serving the public URL, overwrite, duplicate, and mermaid on HTML markdown.
- [Publish a file](./publish-file.md) covers minting a loose file with a stable id, replacing bytes, and downloading.
- [Connect an agent](./connect-agent.md) covers request, human code approval/denial, one-time delivery, and revocation.
- [Mint a token](./mint-token.md) covers mint with a lifetime, whoami with `expires_at`, the expired-token `401 token_expired`, and revoke on the Tokens page and hub API.
- [Share password](./share-password.md) covers setting a password, the public gate, header unlock, and clearing.
- [Hub catalog](./hub-catalog.md) covers listing, search, scope, opening a public URL, and delete.
