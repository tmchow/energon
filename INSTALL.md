# Install Energon

This file is for **humans and agents**. Same steps. Do not invent a token.

There are two jobs:

1. **Deploy your own Energon** — fork this repo, create Cloudflare resources, render the skill, deploy.
2. **Connect an agent** — add the company marketplace, install the skill, export a token.

If you only need (2), skip to [Connect an agent](#connect-an-agent).

---

## Deploy your own Energon

You need a Cloudflare account (Workers Paid — unzip + 25 MB uploads), a hostname, and a GitHub repo that will be the marketplace teammates install from.

### 1. Fork or clone

Fork [`tmchow/energon`](https://github.com/tmchow/energon) into your org (or clone and add your own `origin`). After `skill:init`, the marketplace lives in this same tree. Point `origin` at **your** repo before you render the skill.

`tmchow/energon` accepts [issues](https://github.com/tmchow/energon/issues/new/choose) and does not merge unsolicited pull requests. Keep your Energon on the fork. See [CONTRIBUTING.md](./CONTRIBUTING.md).

```
your-org/energon
```

Do not reuse another Energon’s D1 `database_id` or R2 bucket. The committed `wrangler.toml` uses a placeholder id on purpose.

### 2. Create Cloudflare resources (once)

```bash
npm install
npx wrangler r2 bucket create energon
npx wrangler d1 create energon
```

Put the printed D1 `database_id` into `wrangler.toml`. Keep `database_name` and `bucket_name` as `energon` so the optional GitHub Actions deploy job does not need edits.

Ask the human for:

- Hub hostname (example: `https://energon.your.co`)
- Content hostname (example: `https://content.energon.your.co`; this must be separate from the hub)
- Email domains that may mint tokens (example: `your.co,your.com`)
- Write default: `org` (any token on this host — usual for coworker/agent sharing) or `owner` (only the creator)
- Whether content may live forever (`ALLOW_UNLIMITED_RETENTION=true`) or must expire
- Whether API tokens may be minted with no expiry (`ALLOW_UNLIMITED_TOKENS`, default allowed). Every token still gets a lifetime picked at mint (default 90 days); this only decides whether Never is on the menu for future mints. Tokens already minted keep working until revoked on `/tokens`.

### 3. Render this Energon’s skill

```bash
npm run skill:init -- --name yourco --origin https://energon.your.co
```

`--name yourco` becomes skill **and** marketplace `yourco-energon` (install `yourco-energon@yourco-energon`), token env `YOURCO_ENERGON_TOKEN`, and the GitHub repo from `git remote get-url origin`. Pass `--repo your-org/energon` if origin is still `tmchow/energon`.

Choose a name unique to this Energon (for example, `yourco` or `yourco-staging`). Generic `energon` identities and placeholder origins are rejected. Use your deployed HTTPS hub origin without a path.

That writes `plugins/yourco-energon/` (Agent Plugins package), the harness catalogs (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, and the Copilot/root copies), and `instance-skill.json`. The plugin lives in that subdirectory — not at the repo root, and not under `.agents/skills` or `.claude/skills`. Commit the result. After that, this fork is the marketplace teammates add.

Then set wrangler `[vars]` to the same values from `instance-skill.json`, as shown below.

After initialization, `npm run skill:render` refreshes the generated files and `npm run skill:render -- --check` fails if they drift from `instance-skill.json` + `templates/`. Before initialization, both commands validate templates without generating a plugin. The check is part of `npm run test:unit`.

Upstream contains templates and default configuration, with no generated plugin or marketplace catalogs. A fresh fork must run `skill:init` before distributing a plugin. Teammates install from **your** configured fork, never `tmchow/energon`.

If an existing fork uses the generic `energon` identity, rerun `skill:init` with a unique name and the same real origin. Commit the renamed plugin and catalogs, update the Worker identity variables below, and have teammates replace the old installation and token environment variable with the new names. Existing token values remain valid when `TOKEN_PREFIX` is unchanged.

### 4. Company vars (`wrangler.toml`)

Strings only (Wrangler). Committed defaults are company-shaped. Full table: [docs/DEPLOY.md](./docs/DEPLOY.md).

| Var | Typical company value |
| --- | --- |
| `PUBLIC_ORIGIN` | `https://energon.your.co` |
| `CONTENT_ORIGIN` | `https://content.energon.your.co` |
| `TOKEN_ENV` | match the rendered skill |
| `SKILL_NAME` / `MARKETPLACE_NAME` | match the rendered skill |
| `MARKETPLACE_REPO` | `your-org/energon` |
| `ALLOW_UNLIMITED_RETENTION` | `true` |
| `ALLOW_UNLIMITED_TOKENS` | `true` (Never stays on the token lifetime menu; only affects future mints) |
| `DEFAULT_TTL` / `MAX_TTL` | `never` |
| `WRITE_POLICY` | `org` |
| `ALLOWED_EMAIL_DOMAINS` | `your.co,your.com` |
| `ADMIN_EMAILS` | `you@your.co` (operators; empty means nobody) |
| `FOOTER_TEXT` | omit, or one internal line |

`WRITE_POLICY` is the default for **new** sites and files. Each object stores its own policy. The creator can lock one object to `owner` from the hub or `PATCH`. Anyone with a token can still read `/v1` and `duplicate_from`.

If these vars are omitted, code defaults are stricter: required TTL (7d / 30d cap) and `WRITE_POLICY=owner`.

### 5. Cloudflare Access

The Worker reads `Cf-Access-Authenticated-User-Email`. It does not implement signup.

- IdP: Google Workspace / Okta / GitHub Enterprise, restricted to your org.
- Also set `ALLOWED_EMAIL_DOMAINS` so a mis-aimed Access policy cannot mint tokens for random Gmail.

**Allow** (signed-in): `/`, `/account*`, `/about`, `/stats`, `/setup`, `/tokens`, `/admin`, `/connect`

**Bypass**: `/v1*`, `/health`, `/llms.txt`, `/auth.md`, `/favicon.svg`, `/static*`, and (by default) `/{handle}/s/*`, `/{handle}/f/*` on the content hostname

Leave `/v1*` on Bypass on the hub — agents send a bearer token and have no Access cookie. Published links stay easy to open on the content hostname. Do not put Access on the content hostname: the Worker rejects hub routes there, and the separate origin prevents published active content from inheriting the hub session. There is no `PUBLISH_VISIBILITY` var.

Disable or ignore `*.workers.dev` for humans; the Worker 403s the hub there.

### 6. Domain, secrets, deploy

- Custom domains → uncomment both `[[routes]]` entries in `wrangler.toml` (hub and content), or add both in the dashboard. The hub is the only domain that gets Cloudflare Access.
- GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- GitHub Actions variable: `ENABLE_PRODUCTION_DEPLOY` = `true` if you want push-to-`main` to migrate D1 and deploy. Leave it unset so CI is tests only.
- Apply migrations once: `npx wrangler d1 migrations apply energon --remote`
- Deploy: land on `main` (if the job is enabled) or `npx wrangler deploy` from a laptop after `wrangler login`.

Do not `wrangler login` from a cloud agent VM. Do not stamp `d1_migrations` or run ad-hoc `d1 execute` against production. New schema belongs in `migrations/` first.

Workers Paid is required. At typical company volume that is the $5/month floor.

### 7. Local check

```bash
npx wrangler d1 migrations apply energon --local
# .dev.vars: PUBLIC_ORIGIN=http://127.0.0.1:8787
#            CONTENT_ORIGIN=http://127.0.0.1:8787
#            DEV_ACCESS_EMAIL=you@your.co
npm run dev
```

Open http://127.0.0.1:8787. Access is not required on localhost.

---

## Connect an agent

Use this after yours is running. If you are still deploying, finish the section above first.

Ask the human for the **origin** (`https://energon.your.co`) and the **GitHub repo** that is the marketplace (usually the company fork). If they only have the origin, `GET {origin}/v1/help` (no auth) names `repo`, `install`, and `env`.

### Prompt you can paste (already on the README)

The human may have pasted the “Connect an agent” block from [README.md](./README.md). Follow this section.

### 1. Add the marketplace and install the skill

Install at **user (global) scope** so it is available in every project. Project or workspace scope only if the human asked for that.

Each Energon ships its own skill in its own repo, with its own name and token env. `yourco-energon` and another company's `esper-energon` can both live on the same machine. Install the one you want everywhere at user scope. If you belong to more than one organization, install each skill, or pin the second in that company's project settings. Do not install two marketplaces that share the same `name`.

Usually you only add the company repo:

```
your-org/energon
```

```
https://github.com/your-org/energon
```

Add that as a marketplace, then install the plugin named in `GET {origin}/v1/help` → `install`.

Or paste this, filling in the values from `/v1/help` or `/setup`:

```
Add the plugin marketplace at https://github.com/{owner/repo} ({owner/repo}) and install {plugin} at user (global) scope, using your normal plugin install flow. Do not install at project or workspace scope unless I ask.

Then read {origin}/auth.md. If {TOKEN_ENV} is already set, use it. Otherwise connect with a code: show me the link and code, wait for my approval, then save the delivered token as {TOKEN_ENV} where this environment keeps secrets, readable only by me. Do not invent a token.
```

Signed-in humans can copy a filled block from `{origin}/setup`.

Harness-specific commands (replace repo / plugin with this Energon’s values):

**Claude Code**

```
/plugin marketplace add your-org/energon
/plugin install yourco-energon@yourco-energon --scope user
```

**Cursor**

```
agent plugin marketplace add https://github.com/your-org/energon.git
agent plugin install yourco-energon@yourco-energon
```

Or in chat: ask Cursor to add the GitHub marketplace and install the plugin at user (global) scope. Cursor loads `plugins/{plugin}/` (`plugin.json` + `skills/`), not a `.cursor` folder.

**Codex / ChatGPT**

```
codex plugin marketplace add your-org/energon
codex plugin add yourco-energon@yourco-energon
```

**Grok**

```
grok plugin marketplace add your-org/energon
grok plugin install yourco-energon@yourco-energon --trust
```

**GitHub Copilot**

```
copilot plugin marketplace add your-org/energon
copilot plugin install yourco-energon@yourco-energon
```

### 2. Connect the agent

Ask the agent to connect. It reads `{origin}/auth.md`, uses `{TOKEN_ENV}` if it is already set, and otherwise shows you a verification link and an eight-digit code. Open the link, sign in through Access, enter the code, choose a lifetime, and approve. The token goes directly to the waiting agent, which saves it as `{TOKEN_ENV}` in this machine's secret store or a user-only file and tells you where. It appears on `/tokens` for revocation. There is no public signup.

For CI, scheduled jobs, or a hosted sandbox with a secret store, provision the token yourself:

1. Human opens `{origin}/tokens` while signed in through Access.
2. Create a token with a label and lifetime. The secret is shown once. It cannot be revealed later.
3. Export it. Do **not** invent a token. Do **not** commit it.

```
export YOURCO_ENERGON_TOKEN=ee_live_…
```

Replace `YOURCO_ENERGON_TOKEN` with the env name from `GET {origin}/v1/help` → `env`. In CI or a sandbox, put it in the platform's secret store under that name. On a workstation, add the line to `~/.zshrc` (or the equivalent) so new terminals keep it.

### 3. Smoke check

```
curl -sS {origin}/v1/whoami -H "Authorization: Bearer $YOURCO_ENERGON_TOKEN"
```

Then they can say: “Put this folder on Energon as lunch-poll” or “Hand this screenshot to the other chat.”

### Only if they asked to pin the plugin in a repo

Do not pin the plugin in a project by default. If they want teammates to get it from this repository:

```json
{
  "extraKnownMarketplaces": {
    "yourco-energon": {
      "source": { "source": "github", "repo": "your-org/energon" }
    }
  },
  "enabledPlugins": {
    "yourco-energon@yourco-energon": true
  }
}
```

Put that in `.claude/settings.json` and/or `.github/copilot/settings.json`, using the marketplace and plugin names from `/v1/help`.

---

## What you should not do

- Do not invent a token.
- Do not reuse another Energon’s D1 or R2.
- Do not put Access on `/v1`.
- Do not install two marketplaces that share the same `name`.
- Do not leave `{{ORIGIN}}` in a skill you ship to agents.
- Do not tell a company to install from `tmchow/energon`; generate and commit the plugin in its configured fork first.
