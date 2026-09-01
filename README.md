# Energon

Energon is a Cloudflare Worker you instantiate for **your company**. It gives people and agents stable URLs for files and small sites so work can leave a chat, a laptop, or a session.

That is the whole product. Sharing is usually harder than building. An agent session cannot hand a file to another session, another machine, or a person without a URL.

There is no hosted public service in this repo. You fork it, stand up your own host, and install the skill that points at **your** origin.

- Product: **Energon**
- This repo: [`tmchow/energon`](https://github.com/tmchow/energon) (marketplace + Worker)
- Placeholder skill in this tree: `energon@energon` → `https://energon.example.com`
- Token env after a default render: `ENERGON_TOKEN` (your fork may rename it)

## What it is for

- **Prototypes.** A folder of HTML goes up. Anyone at the company can open it. No repo, no Pages project, no deploy pipeline.
- **Handoff.** One agent (or person) makes a markdown file, screenshot, PDF, or zip. Another agent on another machine fetches it. A human opens it. The URL is the transfer.
- **Living docs.** Markdown is a first-class file. Browsers render `.md` (GFM + mermaid). `curl` and `?raw=1` stay the source. `index.md` is a homepage when `index.html` is missing. Last write wins on that path.

A **site** is a named folder (`/{handle}/s/ios-brief/notes.md`). A **file** is one file with a short id (`/{handle}/f/{id}/screenshot.png`). Both keep the same URL when you PUT again.

## What it is not

Not a document editor. Not git. Not Slack. v1 is files, sites, and URLs, on purpose.

The hub (`/`, `/account`, `/tokens`, `/setup`) is behind Cloudflare Access. Published `/{handle}/s/*` and `/{handle}/f/*` links are easy to open unless you set an optional share password or put Access on those paths. Agents publish and fetch over `/v1` with a bearer token.

## Company controls

These are the knobs a company actually uses. Details: [docs/DEPLOY.md](./docs/DEPLOY.md).

| Need | Control |
| --- | --- |
| Who can sign in / mint tokens | Cloudflare Access + `ALLOWED_EMAIL_DOMAINS` |
| Default write sharing | `WRITE_POLICY` (`instance` = any token on this host, `owner` = only the creator) |
| Lock one object | Hub “Who can write” or `PATCH write_policy` (creator-only) |
| How long content lives | `ALLOW_UNLIMITED_RETENTION`, `DEFAULT_TTL`, `MAX_TTL` |
| Upload / bucket caps | `MAX_FILE_BYTES`, `MAX_PLATFORM_BYTES` |
| Copy instead of overwrite | `duplicate_from` |
| Optional public-link password | Share password on the human URL |
| Branding | `FOOTER_TEXT`, `npm run skill:init` |

This tree ships **company-shaped** wrangler defaults: `WRITE_POLICY=instance`, unlimited TTL. If you omit those vars, code defaults are stricter (`owner` writes, 7-day default, 30-day cap).

Lists (`GET /v1/sites`, `GET /v1/files`, the hub tables) only return things you created or last wrote. They are not a company catalog.

## Give this to an agent

Same steps for a human or an agent: [INSTALL.md](./INSTALL.md). Paste one of these.

### Stand up a company instance

```
Read INSTALL.md in this repository and stand up an Energon host for our company.

This repo is the marketplace and the Worker. Follow INSTALL.md exactly. Ask me for: our public hostname, Cloudflare account access, the email domains that may mint tokens, and whether coworkers’ tokens should overwrite each other’s files (WRITE_POLICY=instance) or only the creator (owner).

Do not invent a token. Do not reuse another instance’s D1 database_id or R2 bucket. After skill:init, commit the rendered skill so teammates install from this fork.
```

### Connect an agent to an existing host

```
Read INSTALL.md in this repository, section “Connect an agent”, and install Energon for this machine.

Ask me for our Energon origin (https://…) if it is not already in the environment or INSTALL.md. I will mint a token at {origin}/tokens and paste the secret. Export it as the token env named by GET {origin}/v1/help. Install the skill from our company repo at user (global) scope. Do not invent a token.
```

Signed-in humans can also copy a host-specific paste block from `{origin}/setup`.

## Local development

```bash
npm install
npx wrangler d1 migrations apply energon --local
cp .dev.vars.example .dev.vars
npm run dev
```

Open http://127.0.0.1:8787 — Access is not required on localhost. Identity defaults to `dev@example.com` (override with `DEV_ACCESS_EMAIL` in `.dev.vars`).

```bash
npm test
```

`npm run test:unit` is the fast Node suite. `npm run test:worker` boots the Worker. See **Working on this repository** in [AGENTS.md](./AGENTS.md).

GitHub Actions runs typecheck, lint, and both suites on every pull request and every push to `main`. Production deploy is **opt-in** (`ENABLE_PRODUCTION_DEPLOY` plus Cloudflare secrets). See [INSTALL.md](./INSTALL.md).

## License

[MIT](./LICENSE)
