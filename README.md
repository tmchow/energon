# Energon

<div align="center">
  <img src="./src/logo.svg" width="112" alt="Energon logo">
</div>

<div align="center">

[![CI](https://github.com/tmchow/energon/actions/workflows/ci.yml/badge.svg)](https://github.com/tmchow/energon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

**One company-owned place where any agent can publish a file or small site and hand a human a stable link.**

Energon runs in your Cloudflare account. Agents write over HTTP; humans open normal web links. Markdown, HTML folders, screenshots, PDFs, and other files share one host instead of being scattered across chat artifacts, public paste services, static hosts, and drives.

> Energon is self-hosted software, not a hosted service or a curl installer. Start with [Deploy a company host](#deploy-a-company-host), or give [this prompt](#give-this-to-an-agent) to an agent.

## TL;DR

**The problem:** Agents can create useful artifacts, but those artifacts are often trapped in one chat product, published to someone else's service, or split across tools depending on whether the output is HTML, Markdown, or a binary file.

**The solution:** Energon gives every compatible agent the same token-authenticated HTTP API. It stores bytes in your R2 bucket, metadata in D1, and serves stable links from a separate content hostname.

### Why Energon?

| Need | What Energon does | Example |
| --- | --- | --- |
| Publish from different agents | Ships an instance-specific [Agent Plugin](https://agent-plugins.org/) for Cursor, Claude Code, Codex, Copilot, Grok, and other compatible clients | “Put this folder on Energon as `lunch-poll`” |
| Keep related files together | Publishes a named site with nested paths | `/ada/s/lunch-poll/` |
| Hand off one artifact | Publishes a loose file with a short, stable ID | `/ada/f/x7k2q9/brief.md` |
| Revise without moving the link | Replaces one site path or loose file in place | `PUT /v1/files/x7k2q9` |
| Control who may overwrite | Stores `owner` or `instance` write policy per site or file | Lock a final brief to its creator |
| Share outside the company | Serves content without an Access session, optionally behind a share password | Send the same preview URL to a client |
| Keep company data on company infrastructure | Runs as a Cloudflare Worker backed by your D1 and R2 | No public paste-service account |

## Quick example

Once a host exists and a human has exported the token named by `GET /v1/help`:

```bash
export ENERGON_ORIGIN=https://energon.your.co

# Inspect this instance's live routes, limits, retention, and token env name.
curl -sS "$ENERGON_ORIGIN/v1/help"

# Confirm the token and its expiry.
curl -sS "$ENERGON_ORIGIN/v1/whoami" \
  -H "Authorization: Bearer $ENERGON_TOKEN"

# Reserve a stable site URL. Never assume overwrite permission.
curl -sS "$ENERGON_ORIGIN/v1/sites" \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"lunch-poll","overwrite":false,"ttl":"7d"}'

# Publish the homepage.
curl -sS "$ENERGON_ORIGIN/v1/sites/lunch-poll/files/index.html" \
  -X PUT \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @index.html

# Or upload an entire site from a ZIP after creating its slug.
curl -sS "$ENERGON_ORIGIN/v1/sites/lunch-poll/import" \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @site.zip

# Inspect the site without downloading every file.
curl -sS "$ENERGON_ORIGIN/v1/sites/lunch-poll" \
  -H "Authorization: Bearer $ENERGON_TOKEN"
```

The create and write responses return both `url` for humans and `api_url` for agents. ZIP import requires an existing slug; if every archive entry is inside one wrapping directory, Energon strips that directory so `index.html` lands at the site root. A site serves `index.html` first, then `index.md`; without either, its root shows a file list.

## How it works

```text
                         company Cloudflare account

 agent / curl
      │  Bearer token
      ▼
┌──────────────────────── hub hostname ────────────────────────┐
│ Cloudflare Access ── humans: hub, account, setup, tokens     │
│ Energon Worker     ── agents: /v1 API                        │
└──────────────┬─────────────────────────────┬──────────────────┘
               │ metadata                    │ bytes
               ▼                             ▼
          ┌─────────┐                   ┌─────────┐
          │   D1    │                   │   R2    │
          │ catalog │                   │ objects │
          └─────────┘                   └────┬────┘
                                           │ public or passworded
                                           ▼
                              ┌─────────────────────────┐
                              │ separate content host   │
                              │ /{handle}/s/...         │
                              │ /{handle}/f/...         │
                              └────────────┬────────────┘
                                           ▼
                                        browser
```

The hostname split matters: active content never inherits the hub's Access session. Public responses can be cached at the edge; writes and deletes purge the affected cache entries.

## Design principles

1. **One publishing primitive across agent harnesses.** The deployed instance renders its own plugin name, origin, token environment variable, and operating instructions. Two organizations can install two separately named Energon instances without colliding.
2. **Stable addresses, explicit mutation.** A site owns a human-chosen slug. A loose file gets a short ID. Updates use `PUT`; they do not mint a new URL. Writes are last-write-wins on the affected path.
3. **Humans control credentials and destructive choices.** Humans mint tokens through Access. Agents must not invent tokens, guess ownership of an existing slug, or silently opt into overwrite.
4. **Open links are deliberate.** Published URLs are public by default so recipients do not need a company login. Share passwords gate sensitive links; token-authenticated `/v1` reads bypass those passwords.
5. **The running instance is the source of truth.** `GET /v1/help` describes the deployed host's identity, routes, limits, retention policy, and token policy. Installed skills tell agents to consult it instead of assuming upstream defaults.

## When to use Energon

| Capability | Energon | Object storage alone | Static-site platform | Shared document editor |
| --- | --- | --- | --- | --- |
| Agent-oriented HTTP workflow | Built in | Build it yourself | Usually build/deploy oriented | Usually UI oriented |
| One file and multi-file sites | Both | Objects, no site behavior | Sites | Documents |
| Stable replace-in-place URL | Yes | Depends on your URL layer | Usually | Yes |
| Company-owned infrastructure | Your Cloudflare account | Usually | Usually | Vendor hosted |
| External link without company login | Yes, optional password | Depends on policy | Usually | Depends on sharing policy |
| Comments, suggestions, and merge history | No | No | Git-based at best | Yes |

Use Energon for prototypes, rendered Markdown, agent-to-agent handoffs, screenshots, PDFs, and small sites that need a durable link. Use a document editor for collaborative review, a full application platform for builds and server-side runtimes, and direct object storage when you only need a storage API.

## Installation

There are three distinct installation paths. They are not interchangeable.

### Deploy a company host

Fork [`tmchow/energon`](https://github.com/tmchow/energon) into your organization, then follow [INSTALL.md](./INSTALL.md). The short version is:

```bash
git clone https://github.com/your-org/energon.git
cd energon
npm install
npx wrangler r2 bucket create energon
npx wrangler d1 create energon
npm run skill:init -- --name yourco --origin https://energon.your.co
```

Then configure a distinct hub hostname and content hostname, Cloudflare Access, D1, R2, and deployment credentials. Workers Paid is required for the supported upload limits. Do not reuse another instance's D1 database ID or R2 bucket.

### Connect an agent to an existing host

Open the deployed host's `/setup`, or read `GET {origin}/v1/help`. Both provide the actual marketplace, plugin, and token environment variable for that instance.

```text
# Claude Code
/plugin marketplace add your-org/energon
/plugin install yourco-energon@yourco-energon --scope user

# Cursor
agent plugin marketplace add https://github.com/your-org/energon.git
agent plugin install yourco-energon@yourco-energon

# Codex / ChatGPT
codex plugin marketplace add your-org/energon
codex plugin add yourco-energon@yourco-energon

# Grok
grok plugin marketplace add your-org/energon
grok plugin install yourco-energon@yourco-energon --trust

# GitHub Copilot
copilot plugin marketplace add your-org/energon
copilot plugin install yourco-energon@yourco-energon
```

A human then signs in at `{origin}/tokens`, mints a token, and exports it under the environment variable named by `/v1/help`. The secret is shown once and cannot be recovered later.

### Run the source locally

```bash
git clone https://github.com/tmchow/energon.git
cd energon
npm install
npx wrangler d1 migrations apply energon --local
cp .dev.vars.example .dev.vars
npm run dev
```

Open <http://127.0.0.1:8787>. Localhost skips Cloudflare Access and defaults to `dev@example.com`; set `DEV_ACCESS_EMAIL` in `.dev.vars` to change the identity.

## Give this to an agent

### Stand up a company host

```text
Read INSTALL.md in this repository and stand up an Energon host for our company.

Follow INSTALL.md exactly. Ask me for our hub hostname, content hostname, who may mint tokens, and whether coworkers' tokens should overwrite each other's files (WRITE_POLICY=instance) or only the creator (owner).

Do not invent a token. Do not reuse another instance's D1 database_id or R2 bucket. After skill:init, commit the generated plugin and catalogs so teammates install from this fork.
```

### Connect an agent to a host that exists

```text
Read INSTALL.md in this repository, section "Connect an agent", and install Energon for this machine.

Ask me for our Energon origin (https://...) if it is not already in the environment or INSTALL.md. I will mint a token at {origin}/tokens and paste the secret. Export it as the token env named by GET {origin}/v1/help. Install the skill from our company repo at user (global) scope. If I already use another Energon, this skill has a different name. Install it too, or pin it in this repo. Do not invent a token.
```

The deployed host's `/setup` page has the same prompt filled with its own values.

## API reference

All authenticated routes use:

```bash
-H "Authorization: Bearer $ENERGON_TOKEN"
```

Errors are JSON with `error`, `message`, and `hub`. The live, machine-readable reference is always `GET {origin}/v1/help`.

### Sites

| Method and path | Purpose |
| --- | --- |
| `POST /v1/sites` | Create or explicitly claim a slug; can duplicate another site |
| `GET /v1/sites` | List sites you created or last wrote, with search and pagination |
| `GET /v1/sites/{slug}` | List a site's files |
| `PATCH /v1/sites/{slug}` | Change password, TTL, or write policy |
| `DELETE /v1/sites/{slug}` | Delete the site and all its objects |
| `PUT /v1/sites/{slug}/files/{path}` | Create or replace one path with the raw request body |
| `GET /v1/sites/{slug}/files/{path}` | Read one path as raw bytes with a token |
| `DELETE /v1/sites/{slug}/files/{path}` | Delete one path |
| `POST /v1/sites/{slug}/import` | Import an `application/zip` archive |
| `GET /v1/sites/{slug}/export` | Export the site as a zip |

```bash
# Create a password-protected site using the instance default write policy.
curl -sS "$ENERGON_ORIGIN/v1/sites" \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"private-draft","overwrite":false,"password":"correct horse battery staple"}'

# Replace one path without changing the site's expiry.
curl -sS "$ENERGON_ORIGIN/v1/sites/private-draft/files/notes.md" \
  -X PUT \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "Content-Type: text/markdown; charset=utf-8" \
  --data-binary @notes.md
```

### Loose files

| Method and path | Purpose |
| --- | --- |
| `POST /v1/files` | Upload one file or duplicate an existing file into a new ID |
| `GET /v1/files` | List loose files you created or last wrote, with search and pagination |
| `GET /v1/files/{id}` | Read raw bytes; `?download=1` sets attachment disposition |
| `PUT /v1/files/{id}` | Replace bytes while preserving the ID and public URL |
| `PATCH /v1/files/{id}` | Change password, TTL, or write policy |
| `DELETE /v1/files/{id}` | Delete the object and catalog row |

```bash
# Create a loose file. The JSON response contains its id and stable url.
curl -sS "$ENERGON_ORIGIN/v1/files" \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -F "file=@brief.pdf" \
  -F "ttl=30d"

# Replace it later. Do not POST again.
curl -sS "$ENERGON_ORIGIN/v1/files/{id}" \
  -X PUT \
  -H "Authorization: Bearer $ENERGON_TOKEN" \
  -H "X-Filename: brief.pdf" \
  --data-binary @brief.pdf
```

### Instance and identity

| Method and path | Purpose | Authentication |
| --- | --- | --- |
| `GET /v1/help` | Identity, SOP, routes, limits, retention, and token policy | None |
| `GET /v1/health` | Return `{ "ok": true }` | None |
| `GET /v1/whoami` | Return token owner, label, and expiry | Token |

For headers, response shapes, filters, duplication, ZIP behavior, and error handling, see the rendered plugin's `references/api.md` or query the deployed `/v1/help`.

## Configuration

The committed [wrangler.toml](./wrangler.toml) is a complete, company-shaped example with placeholder origins and database ID. A typical fork changes these values:

```toml
[vars]
PUBLIC_ORIGIN = "https://energon.your.co"                  # Hub and /v1
CONTENT_ORIGIN = "https://content.energon.your.co"         # Published bytes; must be separate
TOKEN_ENV = "YOURCO_ENERGON_TOKEN"                         # Must match the rendered skill
SKILL_NAME = "yourco-energon"
MARKETPLACE_NAME = "yourco-energon"
MARKETPLACE_REPO = "your-org/energon"
TOKEN_PREFIX = "ee_live_"

ALLOW_UNLIMITED_RETENTION = "true"
DEFAULT_TTL = "never"
MAX_TTL = "never"
WRITE_POLICY = "instance"                                 # owner or instance

ALLOW_UNLIMITED_TOKENS = "true"                           # Affects future mints only
ALLOWED_EMAIL_DOMAINS = "your.co,your.com"
FOOTER_TEXT = ""
```

Code defaults are stricter when retention and write-policy variables are absent: seven-day default retention, a 30-day maximum, and creator-only writes. `PUT` never extends content TTL; `PATCH { "ttl": "7d" }` resets it from the current time. Token expiry is a separate clock.

See [docs/DEPLOY.md](./docs/DEPLOY.md) for every variable, custom-domain and Access rules, cache behavior, cron costs, migration policy, and fork hygiene.

## Repository commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local Worker on port 8787 |
| `npm run db:local` | Apply D1 migrations to local state |
| `npm run db:remote` | Apply migrations remotely; reserved for an authorized production operation |
| `npm run types` | Generate Wrangler binding types |
| `npm run typecheck` | Type-check Worker and tests |
| `npm run lint` | Run oxlint |
| `npm run lint:fix` | Apply safe lint fixes |
| `npm run test:unit` | Run fast Node tests without Miniflare |
| `npm run test:worker` | Boot the Worker and run integration/API tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm test` | Run unit and Worker suites |
| `npm run skill:init -- --name yourco --origin https://energon.your.co` | Render a fork's instance-specific plugin and catalogs |
| `npm run skill:render` | Re-render the committed plugin from templates and `instance-skill.json` |
| `npm run skill:render -- --check` | Fail if rendered output has drifted |
| `npm run vendor:mermaid` | Refresh the locally served Mermaid browser asset |
| `npm run deploy` | Deploy with Wrangler; only for a human-authorized production flow |

While editing, use the focused test map in [AGENTS.md](./AGENTS.md). CI generates Wrangler types, type-checks, lints, and runs both suites.

## Troubleshooting

### `401 unauthorized` or `401 token_expired`

Stop retrying. A human must sign in at `{origin}/tokens` and mint a new token. Tokens are shown once, cannot be revealed later, and expired tokens cannot be extended. Confirm the correct environment variable with:

```bash
curl -sS "$ENERGON_ORIGIN/v1/help"
```

### `409 site_exists`

The slug is already claimed. Read the returned URL and last writer, then choose a new slug or ask the human before retrying with `"overwrite": true`. Claiming a slug does not wipe its existing paths.

### `404 site_not_found` on `PUT`

Create the site with `POST /v1/sites` first. Energon never creates a missing site implicitly. Likewise, replacing a loose file requires an existing ID.

### `413 too_large` or `413 storage_cap`

The default limit is 25 MB per file and per ZIP upload, with at most 200 files in an imported archive and a 20 GB platform safety cap. Split the artifact, use a different delivery system, or delete old content after the human confirms.

### `410 expired`

The content passed its `expires_at` and is gone or awaiting purge. Publish it again under a new object; retrying the expired URL will not restore it.

### Local D1 or type errors after a fresh clone

```bash
npx wrangler d1 migrations apply energon --local
npm run types
npm run typecheck
```

Do not delete `.wrangler/state`; it is the local database.

### The hub works but published URLs fail in production

Verify that `PUBLIC_ORIGIN` and `CONTENT_ORIGIN` are different custom hostnames and that both route to the Worker. Cloudflare Access belongs on the hub, not the content hostname. Production content publication fails closed when the separate origin is missing.

## Limitations

- **No hosted public instance:** this repository is source for a company fork. `https://energon.example.com` and `plugins/energon` are placeholders until `npm run skill:init` renders a real instance.
- **Cloudflare-specific:** the supported deployment uses Workers, D1, R2, Access, custom domains, and a Workers Paid plan.
- **Public by default:** anyone with a published link can open it unless a share password is set. A share password protects public reads, not token-authenticated `/v1` reads.
- **Not collaborative editing:** there are no comments, suggestions, merges, or version history. Writes are last-write-wins per path.
- **No recycle bin:** deletes are destructive; expired content is purged.
- **Bounded artifacts:** defaults cap one file or ZIP at 25 MB, one ZIP at 200 files, and total stored content at 20 GB.
- **Scoped catalog:** `GET /v1/sites` and `GET /v1/files` return only objects the token owner created or last wrote, not a company-wide inventory.

## FAQ

### Is published content private?

Not by default. Public links intentionally skip Cloudflare Access so an external recipient can open the same URL. Set a share password for link-level protection. Keep the hub and API on a different hostname from published content.

### Should I publish a site or a loose file?

Use a site for several related files, a prototype, or a document with assets. Use a loose file for one screenshot, PDF, Markdown file, or archive that should remain an archive.

### Can two coworkers update the same URL?

Yes when its write policy is `instance`. With `owner`, only the creator can mutate it. The creator can change that policy later. Concurrent edits do not merge; the last successful write to a path wins.

### Can I use more than one Energon host?

Yes. Each fork renders a distinct plugin name and token environment variable. Install each at user scope, or pin an organization's plugin in its repositories.

### Can an agent mint or recover a token?

No. A signed-in human mints it at `/tokens`. The secret is displayed once. It cannot be recovered or renewed, and an expired token must be replaced.

### Why separate hub and content hostnames?

Published HTML can be active content. Serving it from a separate hostname prevents it from sharing the hub's Access session and authenticated UI origin.

### Where did the idea come from?

[Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) made the “create something, get a link” workflow feel obvious, but keeps the artifact inside Claude products. [ht-ml.app](https://ht-ml.app) carries that idea onto a public HTML host. [Proof](https://www.proofeditor.ai) makes Markdown collaboration simple. [Shopify Quick](https://shopify.engineering/quick) showed how good it feels when a folder becomes a link on your own infrastructure. Energon is the combination this project wanted: mixed file types, different agent harnesses, company-owned infrastructure, teammate writes, and externally shareable links.

## About contributions

> *About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

For Energon specifically, [issues are welcome](https://github.com/tmchow/energon/issues/new/choose), but do not open a pull request against `tmchow/energon` unless the owner asked for it. A workflow closes pull requests from forks. Keep instance-specific changes on your company fork. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Report vulnerabilities privately; do not put secrets or customer content in a public issue. Follow [SECURITY.md](./SECURITY.md) for the current reporting channel.

## License

[MIT](./LICENSE)
