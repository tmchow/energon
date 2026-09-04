---
name: Energon
last_updated: 2026-09-04
---

# Energon Strategy

## Purpose

Agents produce work that does not belong in a repo: briefs, plans, prototypes, screenshots, PDFs, working sets in transit between machines. Today that work is durable only if it lands in git. Everything else ends up in temp files and chat artifacts that a second session, a second machine, a second agent, or a second person cannot find or open. The hosts that would fix this are tied to one chat product or are public services, and the tools that run on your own infrastructure are not something an agent in any harness can reach for the same way. The crux is giving agents one company-owned place to hand things off that is as easy to use as a native artifact surface, without the bytes leaving infrastructure the company controls.

## Positioning

Energon is the handoff layer for agent work that does not belong in a repo. It is the fork you run in your own Cloudflare account, with a skill named for your host that works the same from Cursor, Claude Code, Codex, and any client that installs Agent Plugins. Any agent writes a file or small site; any agent or person opens it later from a stable HTTP address, from another session, machine, or harness. The address survives overwrites, who may overwrite is a per-object choice between the creator and the whole instance, and expiry and share passwords are set per object, so one link can go to a teammate or outside the company and still be yours.

It is not a system of record. Code and anything that must be versioned and reviewed stays in the repo. Energon holds the outputs around that work and the things in transit between agents.

## Users

**Primary:** A person running agents in more than one place - local and cloud, several harnesses, several machines, across sessions. They're hiring Energon so those agents can hand work to each other and to people through a link, without leaving the agent, picking a host per artifact, or forcing the work into a repo. That this need spans harnesses is the bet, not yet observed adoption.

**Secondary:** The company operator who forks and runs the host - They're hiring Energon to give the whole team that link without standing up or trusting a public service.

## Boundaries

- Not a repo or system of record. Code and anything that needs versioning and review stays in git; Energon holds outputs and work in transit.
- Not a company-wide catalog. Listing and search are scoped to what you created, edited, or were involved in; no one can dump another person's catalog.
- Not a document editor. Shared writes happen through in-place replacement under write policy; `curl` and `?raw=1` stay the source, last write wins, no merge.
- Not a hosted public service. `getenergon.com` explains the project but does not provide an Energon account or host files; this repo is what you fork and run.
- Not a general-purpose CDN or app platform. Files and small sites only, no server-side code.
- Not per-user access control on published links. Links are open by default; a share password is a shared secret, not an ACL.

_Resist a change when:_ it makes publishing depend on a specific chat product, a specific agent, or infrastructure the company does not own.

## Key metrics

- **Successful write rate** - Share of `POST`/`PUT` on `/v1/sites` and `/v1/files` that return a URL, per instance, weekly; Worker logs. Not yet instrumented.
- **Active publishers** - Distinct people who created or last wrote an object in the last 30 days; D1 `sites` / `loose_files` (`last_written_by`, `updated_at`). Derivable today; `/stats` shows only lifetime totals.
- **Token-to-first-write** - Median minutes from a token being minted to that person's first successful write; D1 `tokens.created_at` joined to the first object they created. Derivable today.
- **Second-write share** - Share of objects created in a window that were overwritten at least once, meaning the address held; D1 `updated_at > created_at`. Derivable today.
- **Handoff share** - Share of objects read or overwritten by a token other than the creator's; overwrites are derivable today from `last_written_by != created_by`, reads need Worker log instrumentation. This is the metric the positioning depends on.

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

**One-liner:** Give your agents a place to hand things off.

**Eyebrow:** For agent work that doesn't belong in a repo.

**Key message:** Briefs, prototypes, screenshots, PDFs. Any agent publishes, any agent or person opens the link later, from anywhere. Runs in your Cloudflare account with expiry and passwords per file. The same skill works from Cursor, Claude Code, Codex, and any client that installs Agent Plugins.

**Word choices:** Say "hand off", not "publish", when describing the category; publishing is one use. Avoid "everything your agents make" and "a shared place", which read as a repo replacement. Name the artifact types so the boundary against git is concrete.
