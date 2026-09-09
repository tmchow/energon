# Product

<!-- impeccable:product-schema 1 -->

This file is the durable product record for the Energon application in this repository: the hub, tokens, setup, connect, about, stats, admin, password gate, and Markdown viewer surfaces. It does not cover the marketing site (private `tmchow/energon-marketing`) or the docs site. Positioning and boundaries are owned by [STRATEGY.md](STRATEGY.md); domain terms by [CONCEPTS.md](CONCEPTS.md). This file summarizes what design work needs from them and records decisions confirmed during init on 2026-09-08.

## Platform

web

## Users

**Primary for this application's UI: the publisher.** A person signed in to this Energon through Cloudflare Access who works with agents across sessions, tools, or machines. In the hub they upload a file or prepared site folder, set password, expiry, and write policy, open the result, copy its link, mint an API token, or approve an agent's connection request. Sometimes they act directly, sometimes through an agent, sometimes an agent acts autonomously within delegated authority. Human-to-human, human-to-agent, agent-to-human, and agent-to-agent use all belong.

**Secondary: the operator.** The individual or organization that forked and deployed this Energon into their own Cloudflare account. They use admin, stats, cleanup review, and token hygiene surfaces. When publisher and operator needs conflict on a surface, the publisher wins (confirmed at init).

**Non-browser user: the agent.** Agents publish, read, reference, revise, and copy through the `/v1` HTTP API, `/v1/help`, `/llms.txt`, and a generated skill bound to this Energon. Agents never see the hub UI, but the hub must make connecting an agent discoverable and the agent's actions visible.

Recipients of a shared link (teammates, clients) reach public content, the password gate, and the Markdown viewer without an Access session.

## Product Purpose

Energon gives documents, prototypes, and working files a stable link. Markdown renders as a readable page; a ready-to-serve HTML folder becomes a working site; other files are served as-is. The same link serves while the work is being refined and later as a reference for another task, in the same or a different agent tool, session, or machine.

Success is a publish loop that is straightforward from a browser and from compatible agent tools: publish once, open the result, keep the address for revision or reference, and see the consequences of each action (expiry, write policy, password, who last wrote) without a feature tour.

## Positioning

Agent-native publishing for documents, prototypes, and working files. Agents are the design center: they work with ordinary files over HTTP using their existing tools, without operating a human editor. People get a browser view of the same work and can upload directly. The distinctive value is the combination: useful browser views, direct file access for agents, stable-link revision and reference, one workflow for several artifact types, and infrastructure the operator controls. Do not claim competitors cannot offer individual capabilities.

## Operating Context

- Each Energon is self-hosted: a Cloudflare Worker with D1 (catalog) and R2 (bytes). Hub and `/v1` live on `PUBLIC_ORIGIN`; published bytes on a separate `CONTENT_ORIGIN` hostname in production.
- Sign-in is Cloudflare Access. Localhost skips Access for development. The handle is the email local-part and appears in public URLs (`/{handle}/s/{slug}/`, `/{handle}/f/{id}/{name}`).
- Agents connect through a token a human mints at `/tokens`, or through a connection request a human approves at `/connect`. Human approval is never automated.
- Publishing from the hub: choose one file or a prepared site folder (a ZIP is unpacked as a site), review password, expiry, and write settings, publish, then open or copy the link.
- Publishing from an agent: the generated plugin skill (Cursor, Claude Code, Codex, Copilot, and other compatible clients) turns a natural-language request into `/v1` calls.
- Content is served publicly by default. A share password gates reading; a write password lets someone outside the org replace bytes at a URL. Both are per object and shared secrets, not access control lists.
- Objects expire. Expiry, purge, and last-read tracking are operator-visible maintenance concerns. Last read is a floor, not a view count (edge cache).
- Admins (emails on `ADMIN_EMAILS`) may list metadata of others' content for maintenance and retire it host-wide; every such action is recorded. They never see published bytes or secrets.
- The full domain vocabulary (Site, Loose file, Write claim, Purge claim, Platform quota, Token Prefix, Share Password, Write Password, Admin Token) is in [CONCEPTS.md](CONCEPTS.md). Use those terms in UI copy.

## Capabilities and Constraints

Confirmed capabilities:

- Publish a site (named collection at a stable slug) or a loose file (short stable id). Replace one site path or loose file in place under write policy. Copy a site or file to an independent identity owned by the caller. Delete. List and search scoped to what the caller created, edited, or was involved in.
- Per-object write policy (`owner` or `org`), share password, write password, expiry.
- Tokens: mint with a chosen lifetime, one-time secret reveal, redacted catalog afterward, revoke. Admin tokens: at most 7 days, never "never".
- Connect flow: agent requests, human identifies the agent and enters its code, explicit approve or deny.
- Stats: storage and usage with clear units, per-person comparable values, lifetime totals only today.
- Admin: preview a host-wide retirement, then confirm; quota repair recomputes from the catalog and deletes nothing.
- Public Markdown viewer with raw access and download, readable code and tables, Mermaid, and no application JavaScript.

Boundaries future work must not imply away (from STRATEGY.md):

- Not a system of record, editor, version history, or merge model. Copies are independent objects. Last write wins.
- Not an org-wide catalog. Not a hosted public service (`getenergon.com` does not host files). Not a CDN or app platform; no server-side code, no source builds.
- Not per-user access control on links. Links are open by default; a password is a shared secret.
- Never default to overwrite. Never invent a token. Never automate human approval.

Technical constraints on UI work:

- Svelte 5 runes, server-rendered by the Worker with escaped hydration JSON; hashed browser assets under `/static/ui/`. Public gate and Markdown pages load no application bundle and render dates in UTC.
- Strict CSP and the hostname boundary are enforced by the Worker. The Markdown viewer retains its sanitizer.
- Interactive pages render dates in UTC on the server, then switch to local time on the client; every `time` element keeps the exact ISO timestamp.
- The verify-energon skill and `test/pages.spec.ts` name element ids, ARIA labels, and copy; changing a user-facing handle means updating those in the same change.
- Metrics that are not yet instrumented (successful write rate, revision share, return and reference use) must not be shown as if measured.

## Brand Commitments

- Name: Energon. "This Energon" for the deployed product. "Want to deploy your own Energon?" for the CTA. "The org" for people who can mint tokens.
- One-liner: agent-native publishing for documents, prototypes, and working files. Supporting message: "Built for agents. Ready for people." Friction line: "No repo to create. No deployment pipeline to configure. No new link for every update."
- Word choices: lead with rendered documents, working prototypes, and stable links. Say "read, reference, or update"; "publish" for the operation and "hand off" for one outcome; "independent copy", not "version control". Avoid "shared workspace", "edit together", "permanent link", "host identity", "deploy your own instance", "deploy your own host".
- On the hub, lead with the immediate upload task and make connecting an agent discoverable. Do not imply people need an agent to publish.
- Logo: `src/logo.svg`.
- The current visual direction (dark instrument, violet charge, cube and conduit motifs, from the Claude Design handoff recorded in DESIGN.md and `docs/design/DESIGN_SYSTEM.md`) is **not** a binding brand commitment (confirmed at init). Refinements preserve it; an explicit redesign may replace it through new-work.

## Evidence on Hand

- Product docs: [README.md](README.md), [STRATEGY.md](STRATEGY.md), [CONCEPTS.md](CONCEPTS.md), [INSTALL.md](INSTALL.md), [docs/SCENARIOS.md](docs/SCENARIOS.md).
- Demonstrations: terminal recordings and an overview diagram under `docs/assets/` (agent demo, human loop, machine handoff, plan review; `energon-workflows-overview.svg`).
- Solved-problem records under `docs/solutions/`.
- Incumbent UI: `src/ui/pages/`, `src/ui/components/`, tokens and component CSS under `src/ui/design/`, component specimen at `src/ui/specimen/`.
- Absent: customer names, testimonials, adoption numbers, benchmarks, pricing. Cross-tool demand is a positioning hypothesis, not observed adoption. Do not fabricate any of these.

## Product Principles

1. Lead with the task the person came to do, and keep what they need to know and what confirms completion beside it. No feature tour.
2. Make consequences accurate and visible: expiry, write policy, passwords, who can overwrite, what a revoke or retirement does. Product behavior and accurate consequences outrank visual fidelity.
3. Agents and people share one artifact. Every surface should make the agent path discoverable without implying people need an agent.
4. Stable links, not permanence. Copy and UI must never promise version history, immutability, ACLs, or merge.
5. Operator-owned and self-hosted. Nothing in the UI should depend on a specific chat product or agent, or on infrastructure the operator does not own.

## Accessibility & Inclusion

WCAG 2.2 AA is the required floor for the hub and for the public password gate and Markdown viewer (confirmed at init). Existing accessibility work is thin: a screen-reader-only utility and narrow-viewport layouts in `src/ui/styles.css`, focus-visible rings on inputs in the component CSS. There is no reduced-motion handling yet. Treat AA as a gap to close in future UI work, not a state already reached.
