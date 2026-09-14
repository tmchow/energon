# Install Energon

This is the installation workflow for humans and agents, from an empty workspace to a verified deployment in the operator's Cloudflare account. If an Energon is already running and you only need access to it, skip to [Connect an agent](#connect-an-agent).

Use this file from the checkout you will deploy. The documentation website explains the product and links here; the checkout's instructions, configuration, migrations, and scripts must describe the same version. If an older fork lacks a documented command, review and merge the upstream changes first. Preserve its existing identity and resources as described in [Customize a fork](docs/DEPLOY.md#customize-a-fork).

## Deploy your own Energon

### Update an existing Energon

An ordinary update does not need new storage, a new plugin identity, or recreated Access applications. Start with the configured fork and preserve its account, bindings, origins, policy, Access vars, plugin identity, and token prefix while [reviewing and merging upstream changes](docs/DEPLOY.md#customize-a-fork).

1. Confirm the account and [inventory the existing resources](#3-inspect-the-account-and-resources). Match the deployed Worker and its bindings to this fork; do not adopt resources based on their names alone.
2. [Verify the existing Access applications by ID](docs/ACCESS-SETUP.md#verify-an-existing-configuration) using a read-only credential. Compare the returned team domain and hub audience with the configured vars. Different display names are supported; security differences stop verification. Do not run creation/apply to repair a mismatch without reviewing the reported settings.
3. Render the existing plugin, run checks, and [commit and deploy](#6-commit-and-deploy). Confirm [fork CI is enabled and actually runs](docs/DEPLOY.md#enable-ci-in-a-new-fork). Apply pending migrations before deploying.
4. Repeat [installation acceptance](#7-verify-the-installation), including human sign-in and real publishing. Reuse an existing valid agent token; request human approval only if a new connection is needed.

If the deployment predates a command used here, merge that command into the configured fork first. Return to first-install setup below only for resources that are genuinely missing and whose creation is authorized.

### 1. Choose the installation

Start by inspecting the current checkout, Git remotes, GitHub authentication, and available Cloudflare authentication. Reuse answers and authorization the operator has already supplied. Ask only for missing choices that cannot be established from that state:

| Choice | What to establish |
| --- | --- |
| Fork | The operator's GitHub account or organization and repository. If it does not exist, create a fork of [tmchow/energon](https://github.com/tmchow/energon) there, then clone it. Do not assume a fork exists before checking. |
| Cloudflare | The intended account name and ID, with Workers Paid enabled for unzip and 25 MB uploads. Installation needs permission to create dedicated storage and deploy a Worker. |
| Identity | Exact allowed sign-in emails, administrator emails, and preferred identity provider. For personal use, the owner can be both the sole allowed user and administrator. Confirm that choice rather than deriving it from a cloud account email alone. |
| Hostnames | Two distinct hostnames in Cloudflare-managed zones the operator controls: one for the hub and one for content. Short siblings such as `energon.your.co` and `share.your.co` work; nesting is unnecessary. |
| Policy | Personal or team use, plus any requested retention or token restrictions. Use the [personal or team preset](docs/DEPLOY.md#personal-and-team-presets) once that use is known. |
| Plugin | A unique name for this Energon, including a distinct name for staging if applicable. Generic `energon` identities are rejected. |

For personal use, the preset keeps content until deliberately removed, allows unlimited retention, uses owner-only writes, and offers Never for ordinary tokens. The normal token default remains 90 days; ask the human which lifetime to approve when connecting. Team use can allow colleagues to update one another's work. Content retention and token lifetime are separate choices.

An installation request authorizes setup and deployment of the named fork and resources; it does not authorize replacing unrelated resources. Human account authentication and agent connection approval remain human steps. Use a secret store or a user-only file for credentials, never the deployment prompt or chat.

### 2. Prepare the fork

Ensure `origin` points at the operator's fork and an `upstream` remote points at `https://github.com/tmchow/energon.git`. Inspect existing local work before changing branches or remotes; do not overwrite an initialized fork or discard its changes. Clone into a new directory if no checkout exists.

Run these inside that fork:

```bash
git remote -v
git status --short
npm ci
```

Keep configuration for this Energon and generated plugins on this fork. Upstream accepts improvements that apply to every Energon, without personal origins, resource IDs, or generated catalogs; see [CONTRIBUTING.md](./CONTRIBUTING.md).

### 3. Inspect the account and resources

Before creating anything:

```bash
npx wrangler whoami
```

Confirm the intended account and email, then set top-level `account_id` in `wrangler.toml` to that account ID. If local authentication is for another account, [select its existing named profile](docs/ACCESS-SETUP.md#select-the-account-before-creating-resources) and repeat `whoami`. A human completes missing interactive login on their local machine; never run interactive `wrangler login` in an unattended cloud agent.

With that account selected explicitly, inventory its storage:

```bash
npx wrangler r2 bucket list
npx wrangler d1 list
```

Use the [Worker and hostname inventory commands](docs/DEPLOY.md#inventory-workers-and-hostnames) to inspect existing Worker names, storage bindings, custom domains, DNS routes, and Access applications. Both hostname zones must belong to the selected account. A matching name is a conflict to investigate, not permission to adopt storage or replace another Worker. Never reuse another Energon's D1 database or R2 bucket. For an existing installation, prove its bindings belong to this fork before reusing them.

Complete first-time Zero Trust enrollment and identity-provider configuration if needed. Prefer the operator's chosen existing provider; Google Workspace does not require falling back to email PIN. These human/account setup steps are outside the installer command.

For a new installation, follow [Access setup prerequisites and preview](docs/ACCESS-SETUP.md#provide-a-scoped-setup-credential): provision the separate Access credential, save the account/provider/hostname/email inputs, and run its read-only plan. Resolve failed reads and existing-application conflicts before creating storage. Successful reads do not prove later write permission. For an existing deployment, use [verification by application ID](docs/ACCESS-SETUP.md#verify-an-existing-configuration) instead of the creation plan.

### 4. Configure this fork

After preflight, create dedicated storage for a new installation:

```bash
npx wrangler r2 bucket create energon
npx wrangler d1 create energon
```

Use these names only when they are available. If names conflict, choose unique names and update the Worker name, storage bindings, and migration command in the optional deployment workflow as applicable. Do not delete or reuse unrelated resources to keep the examples unchanged. Copy the new D1 `database_id` into `wrangler.toml`; keep binding names `DB` and `BUCKET`.

Initialize the plugin with the chosen name and real HTTPS hub origin (replace these examples):

```bash
npm run skill:init -- --name yourco --origin https://energon.your.co
```

This creates skill and marketplace `yourco-energon`, token environment variable `YOURCO_ENERGON_TOKEN`, and repository coordinates from `origin`. It writes `instance-skill.json`, `plugins/yourco-energon/`, and marketplace catalogs. Keep the package under `plugins/`; do not copy it into `.agents/skills` or `.claude/skills` where it would autoload while developing the Worker.

Set `[vars]` in `wrangler.toml` using the [configuration reference and preset](docs/DEPLOY.md#personal-and-team-presets). Match `PUBLIC_ORIGIN`, `TOKEN_ENV`, `TOKEN_PREFIX`, `SKILL_NAME`, `MARKETPLACE_NAME`, and `MARKETPLACE_REPO` to `instance-skill.json`. Set `CONTENT_ORIGIN` to the separate HTTPS content origin. Set `ADMIN_EMAILS` to the agreed exact addresses and `ALLOWED_EMAIL_DOMAINS` to the domains of all allowed sign-in addresses. An exact-email Access policy is the admission boundary; a shared domain such as `gmail.com` does not identify one person.

Configure both custom-domain routes in `wrangler.toml`, outside `[vars]`:

```toml
[[routes]]
pattern = "energon.your.co"
custom_domain = true

[[routes]]
pattern = "share.your.co"
custom_domain = true
```

Wrangler attaches these domains during deployment. Use the actual hostnames already checked during preflight. Separate origins prevent published active content from inheriting the hub's authenticated context.

For an already initialized fork, preserve its plugin name, origins, and token prefix. Refresh generated files with `npm run skill:render` after merging template changes. If it still uses a rejected generic identity, choose a unique name, rerun `skill:init` with the same deployed origin, update Wrangler's identity vars, and have users replace the old plugin and token environment name. Existing token values remain valid when `TOKEN_PREFIX` is unchanged.

### 5. Configure Access

For an existing deployment, use [read-only verification](docs/ACCESS-SETUP.md#verify-an-existing-configuration) and preserve its applications. For a new installation, return to the saved plan and follow [Apply and record the results](docs/ACCESS-SETUP.md#apply-and-record-the-results). The command creates or reuses the matching hub and public-path applications; it never rewrites conflicting applications. Keep the returned resource IDs with the installation record.

Copy the returned `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` into `[vars]`. The audience must belong to the hub application, not its bypass application. Energon verifies the signed hostname Access JWT before trusting an identity; an email header alone is not authentication.

The whole hub requires sign-in, including `/admin`, `/tokens`, `/connect`, and future hub pages. The six public hub paths are described in the [Access command contract](docs/ACCESS-SETUP.md#apply-and-record-the-results). Keep Access off the content hostname. Worker-level Access is unsuitable because this Worker also serves public content. The same applications and policies can be configured in the dashboard if the API path is unavailable.

### 6. Commit and deploy

Render and check the configured fork before deploying:

```bash
npm run skill:render
npm run skill:render -- --check
npx wrangler types
npm run typecheck
npm run lint
npm test
```

Worker tests use isolated fixtures; do not change their test identities to match this installation. Review `git status` and the diff for secrets and accidental unrelated changes. Commit the intended `wrangler.toml`, `instance-skill.json`, generated `plugins/` package, and all generated marketplace catalogs (`marketplace.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.github/plugin/marketplace.json`). Include deliberate workflow changes if resource names changed. Do not commit `.dev.vars`, credentials, or local Cloudflare state.

Ensure [inherited Actions workflows are enabled](docs/DEPLOY.md#enable-ci-in-a-new-fork), then push those commits to the operator's fork and verify the generated package is present on the branch its marketplace installs from, normally `main`. Follow the fork's PR policy if required. A local-only plugin cannot be installed by another agent. Keep automated production deployment disabled until configuration and account selection have been checked.

Apply migrations before deploying the Worker, using the configured database name if it differs:

```bash
npx wrangler d1 migrations apply energon --remote
npx wrangler deploy
```

Stop on a migration failure. Never stamp `d1_migrations` or execute ad hoc schema SQL to bypass it; see [Migration recovery](docs/DEPLOY.md#migrations-after-a-deploy). Do not deploy from an unrelated checkout or account. Record the deployed commit, account, resource IDs, origins, and plugin coordinates without secrets.

For later push-to-main deployment, see [GitHub deployment automation](docs/DEPLOY.md#github-deployment-automation). The optional job runs migrations before deployment; PR checks never deploy.

### 7. Verify the installation

Replace the example origins and probe without an Access session or API token:

```bash
curl -fsS https://energon.your.co/v1/health
curl -fsS https://energon.your.co/v1/help
curl -sS -o /dev/null -w '%{http_code}\n' https://energon.your.co/
curl -sS -o /dev/null -w '%{http_code}\n' https://energon.your.co/admin
curl -sS -o /dev/null -w '%{http_code}\n' https://energon.your.co/v1/whoami
curl -sS -o /dev/null -w '%{http_code}\n' https://share.your.co/
```

Expect health/help 200, anonymous hub/admin redirects to Access, and unauthenticated `whoami` 401 from Energon. The content root deliberately returns 404 without an Access redirect; it is not a second hub. In help, confirm both origins, plugin coordinates, retention, write policy, token lifetime choices, and limits. Disable or ignore `*.workers.dev` for human use; hub requests there are rejected.

Have the human sign in through the chosen provider and confirm their email and administrator access. Confirm the compiled `/static/ui/*` script loads, stage a disposable file and cancel it, and exercise catalog search. If sign-in succeeds but the hub says **Not signed in**, check the team domain and hub audience against the active Access application and redeploy. A health response does not prove the interactive interface or identity worked.

Follow [Connect an agent](#connect-an-agent). The human must approve the connection and its lifetime themselves; the agent should confirm authenticated `whoami` before publishing. Use the installed plugin and the running Energon's `/v1/help`, `/llms.txt`, and `/v1/openapi.json` for request syntax. Publish uniquely named disposable fixtures and use returned content URLs:

1. Open an HTML site with a stylesheet, relative asset, and JavaScript interaction in a browser.
2. Read rendered and raw Markdown, update it, and confirm the same URL returns the new bytes.
3. Download a binary fixture and compare its hash with the original.
4. Apply a share password. Confirm anonymous and wrong-password reads fail, then verify the correct password works.
5. Confirm an unauthenticated write cannot change the bytes. Delete only fixtures created for this check when cleanup is authorized, then confirm those links stop serving their content.

Keep sanitized requests, statuses, URLs, browser results, and workarounds. Record paths not tested, including cross-account owner-only writes or expiry when they were not exercised. Completion means the intended human is recognized, the plugin can be installed from the configured fork, and real published bytes load and update on the content origin. Deployment or health alone does not establish completion.

---

## Connect an agent

Start once this Energon is deployed, public discovery works, and human sign-in is verified. During installation, complete this connection flow and then return to the [publishing acceptance checks](#7-verify-the-installation).

Ask the human for the **origin** (`https://energon.your.co`) and the **GitHub repo** that is the marketplace (usually the company fork). If they only have the origin, `GET {origin}/v1/help` (no auth) names `repo`, `install`, and `env`.

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
