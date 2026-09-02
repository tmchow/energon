---
name: Energon
last_updated: 2026-09-02
---

# Energon Strategy

## Purpose

An agent finishes a doc, a small HTML app, a screenshot, or a PDF, and the person needs a link a coworker or an outsider can open. The hosts that make that a one-step thing are tied to one chat product or are public services, and the Quick-shaped tools that run on your own infrastructure are not something an agent in any harness can reach for the same way. The crux is getting a company-owned host to be as easy for an agent as a native artifact surface, without the bytes leaving infrastructure the company controls.

## Positioning

Energon is the fork you run in your own Cloudflare account, with a skill named for your host that works the same from Cursor, Claude Code, Codex, and any client that installs Agent Plugins. Every file and small site gets a stable HTTP address that survives overwrites, and who may overwrite it is a per-object choice between the creator and the whole instance, so one link can go to a teammate or outside the company and still be yours.

## Users

**Primary:** A person who works across several agent harnesses - They're hiring Energon to turn what their agent just made into a stable link a teammate or outsider can open, without leaving the agent or picking a host per artifact. That this need spans harnesses is the bet, not yet observed adoption.

**Secondary:** The company operator who forks and runs the host - They're hiring Energon to give the whole team that link without standing up or trusting a public service.

## Boundaries

- Not a company catalog or search. Lists only return what you created or last wrote.
- Not a document editor or collaboration surface. `curl` and `?raw=1` stay the source; last write wins.
- Not a hosted public service. This repo is what you fork; there is no energon.com to sign up for.
- Not a general-purpose CDN or app platform. Files and small sites only, no server-side code.
- Not per-user access control on published links. Links are open by default; a share password is a shared secret, not an ACL.

_Resist a change when:_ it makes publishing depend on a specific chat product, a specific agent, or infrastructure the company does not own.

## Key metrics

- **Successful write rate** - Share of `POST`/`PUT` on `/v1/sites` and `/v1/files` that return a URL, per instance, weekly; Worker logs. Not yet instrumented.
- **Active publishers** - Distinct people who created or last wrote an object in the last 30 days; D1 `sites` / `loose_files` (`last_written_by`, `updated_at`). Derivable today; `/stats` shows only lifetime totals.
- **Token-to-first-write** - Median minutes from a token being minted to that person's first successful write; D1 `tokens.created_at` joined to the first object they created. Derivable today.
- **Second-write share** - Share of objects created in a window that were overwritten at least once, meaning the address held; D1 `updated_at > created_at`. Derivable today.

## Tracks

### Publish loop

The `/v1` API, the per-instance skill, and the copy-paste prompts that let an agent in any harness install the skill, use a human-minted token, POST once, and PUT thereafter. Includes the instrumentation the metrics above need.

_Why it serves the approach:_ The approach is only true if the same skill works from every agent a person uses.

### Ownership and trust

Cloudflare Access, token prefixes, write policy (owner vs instance), share passwords, expiry, and storage integrity across mutations.

_Why it serves the approach:_ A company-owned host has to be safe to hand a token to every teammate and safe to send a link outside.

### Fork and run

`skill:init`, the marketplace catalogs, `INSTALL.md`, `docs/DEPLOY.md`, and the upstream-merge story so one company's instance does not collide with another's.

_Why it serves the approach:_ The product is the fork; if standing up a host is hard, nobody gets the link.

## Brand

**One-liner:** An agent publishes over HTTP. A person opens the link.

**Key message:** A company host for files and small sites, agent-native on purpose, running in your Cloudflare account.
