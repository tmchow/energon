# Energon

<div align="center">
  <img src="./src/logo.svg" width="112" alt="Energon logo">
</div>

<div align="center">

[![CI](https://github.com/tmchow/energon/actions/workflows/ci.yml/badge.svg)](https://github.com/tmchow/energon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

<p align="center">
  <a href="https://getenergon.com">Website</a> ·
  <a href="https://docs.getenergon.com">Documentation</a> ·
  <a href="https://docs.getenergon.com/use/http-api">HTTP API</a>
</p>

**Agent-native publishing for documents, prototypes, and working files.**

Built for agents to publish, read, reference, and revise ordinary files without operating a human editor. Ready for people to open, explore, and upload directly. Markdown renders as a document; a ready-to-serve HTML folder becomes a working site. Permitted updates keep the same URL across sessions and agent tools. Energon runs in your own Cloudflare account.

**No repo to create. No deployment pipeline to configure. No new link for every update.** Once yours is running, publish prepared files directly. Build your prototype before uploading if it needs a build step; Energon serves the output. Updates keep the address until expiry or deletion. Make an independent copy when you want to try another direction.

<div align="center">
  <a href="./docs/SCENARIOS.md">
    <img src="./docs/assets/energon-workflows-overview.svg" width="800" alt="Three Energon workflows: publish a prototype for Slack, share an editable plan for human review, and move a ZIP from a local agent to a cloud agent">
  </a>
</div>

<p align="center"><em>Prototype publishing, human review, and cross-machine agent handoff. <a href="./docs/SCENARIOS.md">Explore the animated workflows →</a></em></p>

> Energon is self-hosted software. There is no hosted Energon and no account at getenergon.com. This repository is the source for an Energon you deploy; it ships templates and placeholder configuration, not a generated plugin.

## Where things live

| You want to | Go to |
| --- | --- |
| Understand what Energon is and why | [getenergon.com](https://getenergon.com), [Core concepts](https://docs.getenergon.com/overview/core-concepts), [Architecture](https://docs.getenergon.com/overview/architecture) |
| Publish from the hub or an agent | [Get started](https://docs.getenergon.com/start/overview), [Publish through the HTTP API](https://docs.getenergon.com/use/publish-with-api) |
| Call `/v1` directly | [HTTP API](https://docs.getenergon.com/use/http-api); on a running Energon, `GET {origin}/v1/help` and `GET {origin}/v1/openapi.json` are the source of truth |
| Deploy, configure, administer, or recover an Energon | [INSTALL.md](./INSTALL.md), [docs/DEPLOY.md](./docs/DEPLOY.md), [Deploy an Energon host](https://docs.getenergon.com/operate/deploy-company-host), [Operate Energon](https://docs.getenergon.com/operate/overview) |
| Sharing, passwords, guest writes, expiry | [Security and sharing](https://docs.getenergon.com/security/overview), [Let an outside agent update a URL](https://docs.getenergon.com/use/guest-write) |
| Change this code | [AGENTS.md](./AGENTS.md), [CONTRIBUTING.md](./CONTRIBUTING.md), [Contribute](https://docs.getenergon.com/contribute/overview) |

## Three ways in

They are not interchangeable.

### Deploy your own Energon

Fork [`tmchow/energon`](https://github.com/tmchow/energon), then follow [INSTALL.md](./INSTALL.md). You need a Cloudflare account on Workers Paid, a hub hostname and a separate content hostname, Cloudflare Access on the hub, and a D1 database and R2 bucket that no other Energon uses.

```bash
git clone https://github.com/your-org/energon.git
cd energon
npm install
npx wrangler r2 bucket create energon
npx wrangler d1 create energon
npm run skill:init -- --name yourco --origin https://energon.your.co
```

`skill:init` renders the plugin, marketplace catalogs, and token environment variable for your Energon. Commit them so teammates install from your fork.

### Connect an agent to an existing Energon

Open that Energon's `/setup` page, or read `GET {origin}/v1/help`. Both name the marketplace repo, plugin, and token environment variable. Install the plugin at user scope with your agent's normal plugin flow; [INSTALL.md](./INSTALL.md#connect-an-agent) lists the commands for Claude Code, Cursor, Codex, Grok, and GitHub Copilot.

The agent then follows `{origin}/auth.md`. If the token variable is already set, it uses it. Otherwise it shows you a link and an eight-digit code; you sign in, approve, and the agent saves the delivered token. For CI and hosted sandboxes, mint a token at `{origin}/tokens` and store it in the environment's secret store. Tokens are shown once.

### Run the source locally

```bash
git clone https://github.com/tmchow/energon.git
cd energon
npm install
npm run db:local
cp .dev.vars.example .dev.vars
npm run dev
```

Open <http://127.0.0.1:8787>. Localhost skips Cloudflare Access and signs you in as `dev@example.com`; set `DEV_ACCESS_EMAIL` in `.dev.vars` to change that.

## Give this to an agent

### Deploy Energon

```text
Read INSTALL.md in this repository and deploy Energon for me or my organization.

Follow INSTALL.md exactly. Ask me for our hub hostname, content hostname, who may mint tokens, and whether coworkers' tokens should overwrite each other's files (WRITE_POLICY=org) or only the creator (owner).

Do not invent a token. Do not reuse another Energon's D1 database_id or R2 bucket. After skill:init, commit the generated plugin and catalogs so teammates install from this fork.
```

### Connect an agent to an Energon that exists

```text
Read INSTALL.md in this repository, section "Connect an agent", and install Energon for this machine.

Ask me for our Energon origin (https://...) if it is not already in the environment or INSTALL.md. Install the skill from this Energon's repo at user (global) scope. Then read {origin}/auth.md: if the token env named by GET {origin}/v1/help is set, use it; otherwise connect with a code, show me the link and code, and after I approve, save the token as that env where this environment keeps secrets. If I already use another Energon, this skill has a different name. Install it too, or pin it in this repo. Do not invent a token.
```

A running Energon's `/setup` page has the same prompt filled with its own values.

## Working on this repo

[AGENTS.md](./AGENTS.md) is the guide to changing this tree: layout, schema rules, the focused test map, and how to verify a change like a user. The short version:

```bash
npm run dev          # local Worker on http://127.0.0.1:8787
npm run db:local     # apply D1 migrations to local state
npm run types        # generate Wrangler binding types (CI runs this before typecheck)
npm run typecheck    # Worker, tests, and Svelte UI
npm run lint         # oxlint
npm run test:unit    # Node tests, no Miniflare
npm run test:worker  # boots the Worker and drives it over SELF.fetch
npm test             # both suites
npm run skill:render # validate templates; regenerate the plugin on an initialized fork
```

`npm run deploy` and `npm run db:remote` touch production and are for a human-authorized flow only.

## Contributing

[Issues](https://github.com/tmchow/energon/issues/new/choose) and pull requests are welcome against `tmchow/energon`, including from forks. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and fill the PR template. Keep your deployed Energon's identity (wrangler ids, origins, generated plugin) on your fork.

Report vulnerabilities privately per [SECURITY.md](./SECURITY.md). Do not put secrets or customer content in a public issue.

## Origins

[Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) made "create something, get a link" feel obvious but keeps the artifact inside Claude. [ht-ml.app](https://ht-ml.app) carries that onto a public HTML host. [Proof](https://www.proofeditor.ai) makes Markdown collaboration simple. [Shopify Quick](https://shopify.engineering/quick) showed how good it feels when a folder becomes a link on your own infrastructure. Energon combines them: mixed file types, any agent harness, operator-owned infrastructure, shared writes, and externally shareable links.

## License

[MIT](./LICENSE)
