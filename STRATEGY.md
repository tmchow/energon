---
name: Energon
last_updated: 2026-09-04
---

# Energon Strategy

## Purpose

People and agents produce briefs, plans, prototypes, screenshots, PDFs, and working files. Making that work useful to the next person or agent often means choosing a different sharing workflow for each format, setting up a publishing pipeline, or sending another attachment after every change. Work left in a local folder or a chat session can be hard to retrieve from another machine or tool.

The job is to give that work a stable link: a document someone can read, a prototype they can explore, or files an agent can retrieve. The same link can be used while the work is being refined and later as a reference for another task. Handoff is one use; viewing your own prototype or returning to a plan in the same agent tomorrow matters too.

## Positioning

Energon is agent-native publishing for documents, prototypes, and working files. Agents are the design center: they publish, read, reference, revise, and copy through an HTTP API using ordinary files, without operating a human editor. Human workflows are built in, not excluded: people can upload directly through the hub and open the same work in a browser. Markdown renders as a readable page; a ready-to-serve HTML folder becomes a working site. An agent can consult the work without changing it, or replace its contents at the existing address when write policy permits. Authenticated users and agents can make independent copies to explore another direction.

The distinctive value is the combination: useful browser views, direct file access for agents, stable-link revision and reference, and one workflow for several artifact types on infrastructure you control. Agent-native means agents work with the underlying files using their existing tools, while people get a browser view of the same work. It does not mean only agents can publish or only agent-authored work belongs here.

Each instance runs in its operator's Cloudflare account and ships a host-specific skill for compatible agent tools, including Cursor, Claude Code, and Codex. Once the instance exists, publishing a file or prepared site needs no new repository or deployment pipeline. Energon does not build source projects or run server-side application code. Links serve the current contents until expiry or deletion; a copy is a separate object, not a version-history entry. Write permissions, expiry, and share passwords are per object.

It is not a system of record. Code and anything that must be versioned and reviewed stays in the repo. Energon holds the documents, previews, and working files around that work.

## Users

**Primary:** A person working with agents across sessions, tools, or machines. They want one way to publish, view, revise, and reference work without choosing a host per artifact or creating a repository for it. Sometimes they upload or share directly; sometimes they ask an agent; sometimes an agent acts autonomously within delegated authority. Human-to-human, human-to-agent, agent-to-human, and agent-to-agent use all belong. Cross-tool demand remains a positioning hypothesis, not observed adoption.

**Secondary:** The individual or company operator who forks and runs the host. They want that workflow on infrastructure they control, with their own identity, token, and retention policies.

## Boundaries

- Not a repo or system of record. Code and anything that needs versioning and review stays in git. Copies are independent objects; there are no branches, merges, or revision history.
- Not a company-wide catalog. Listing and search are scoped to what you created, edited, or were involved in; no one can dump another person's catalog.
- Not a document editor. People edit in their own tools or through agents. Shared writes happen through in-place replacement under write policy; `curl` and `?raw=1` stay the source, last write wins, no merge. Referencing an artifact does not require permission to change it.
- Not a hosted public service. This repo is what you fork; running an instance requires setup in your own Cloudflare account.
- Not a general-purpose CDN or app platform. Files and small sites only, no server-side code.
- Not per-user access control on published links. Links are open by default; a share password is a shared secret, not an ACL.

_Resist a change when:_ it makes publishing depend on a specific chat product, a specific agent, or infrastructure the company does not own.

## Key metrics

- **Successful write rate** - Share of `POST`/`PUT` on `/v1/sites` and `/v1/files` that return a URL, per instance, weekly; Worker logs. Not yet instrumented.
- **Active publishers** - Distinct people who created or last wrote an object in the last 30 days; D1 `sites` / `loose_files` (`last_written_by`, `updated_at`). Derivable today; `/stats` shows only lifetime totals.
- **Token-to-first-write** - Median minutes from a token being minted to that person's first successful write; D1 `tokens.created_at` joined to the first object they created. Derivable today.
- **Revision share** - Share of objects whose contents were replaced at the same address. Needs write-event instrumentation to distinguish byte replacement from metadata changes; `updated_at > created_at` alone is not proof.
- **Return and reference use** - Reads after initial publication, including the same person or agent returning later. Needs read instrumentation; request logs cannot establish whether a human used the work as reference without additional evidence.
- **Cross-account handoff share** - Objects read or updated by another account. Different creator and last-writer values provide a partial signal today; read measurement needs instrumentation. This captures one use of the product, not all useful activity.

## Tracks

### Publish loop

The hub upload flow, `/v1` API, per-instance skill, and copy-paste prompts. A person or agent publishes once, opens the result, and retains its address for revision or reference. Authenticated copies create independent alternatives. Includes the instrumentation the metrics above need.

_Why it serves the approach:_ Publishing and returning to the work must be straightforward from a browser and compatible agent tools, without changing workflow for every format.

### Ownership and trust

Cloudflare Access, token prefixes, write policy (owner vs instance), share passwords, expiry, and storage integrity across mutations.

_Why it serves the approach:_ A company-owned host has to be safe to hand a token to every teammate and safe to send a link outside.

### Fork and run

`skill:init`, the marketplace catalogs, `INSTALL.md`, `docs/DEPLOY.md`, and the upstream-merge story so one company's instance does not collide with another's.

_Why it serves the approach:_ The product is the fork; if standing up a host is hard, nobody gets the link.

## Brand

**One-liner:** Agent-native publishing for documents, prototypes, and working files.

**Supporting message:** Built for agents. Ready for people.

**Key message:** Built for agents to publish, read, reference, and revise. Ready for people to open, explore, and upload directly. Markdown renders as a document; prepared HTML renders as a working site. Permitted updates keep the same URL across sessions and agent tools. Runs in your own Cloudflare account.

**Messaging hierarchy:** Lead product introductions with agent-native publishing, then demonstrate rendered work and stable-link reference and revision. Handoff is an outcome, not the whole category. On the hub, lead with the immediate upload task and make connecting an agent discoverable. Do not imply people need an agent to publish, or that a stable URL alone distinguishes the product.

**Friction line:** No repo to create. No deployment pipeline to configure. No new link for every update.

**Scope of that promise:** The instance is already deployed and the files are ready to serve. Building a prototype may still happen before upload. Stable links serve current contents, not immutable revisions, and stop working at expiry or deletion.

**Word choices:** Lead with rendered documents, working prototypes, and stable links. Say "read, reference, or update" so agent use is not reduced to editing. Use "publish" for the operation and "hand off" for one outcome. Say "independent copy", not "version control". Avoid "shared workspace", "edit together", and "permanent link", which imply capabilities we do not provide. Explain agent interoperability and owned infrastructure without claiming competitors cannot offer individual capabilities.
