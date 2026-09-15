# Install Energon

This is the installation workflow for humans and agents, from an empty workspace to a verified deployment in the operator's Cloudflare account. If an Energon is already running and you only need access to it, skip to [Connect an agent](#connect-an-agent).

Use this file from the checkout you will deploy. The documentation website explains the product and links here; the checkout's instructions, configuration, migrations, and scripts must describe the same version. If an older deployment repository lacks a documented command, review and merge the upstream changes first. Preserve its existing identity and resources as described in [Customize a deployment repository](docs/DEPLOY.md#customize-a-deployment-repository).

## Deploy your own Energon

Installation is two parts:

1. **First deploy** — create a private deployment repository, configure this Energon, and take the Worker live with Wrangler on the operator's machine (steps 1–7). Enabling GitHub Actions so tests run is part of this; those checks do not deploy.
2. **Automatic updates (optional)** — after the first deploy is verified, connect the deployment repository so a push to `main` migrates D1 and deploys the Worker. See [After the first deploy](#after-the-first-deploy-optional-automatic-updates).

An already-running Energon uses [Update an existing Energon](#update-an-existing-energon).

To move an existing public fork to a private repository, use [Migrate an existing public fork](docs/DEPLOYMENT-REPOSITORY.md#migrate-an-existing-public-fork). That move is separate from an ordinary software update.

### Update an existing Energon

An ordinary update does not need new storage, a new plugin identity, or recreated Access applications. Start with the configured deployment repository and preserve its account, bindings, origins, policy, Access vars, plugin identity, and token prefix while [reviewing and merging upstream changes](docs/DEPLOY.md#customize-a-deployment-repository). If this checkout has [`.agents/skills/update-from-upstream/SKILL.md`](.agents/skills/update-from-upstream/SKILL.md), follow that skill; the steps below remain the procedure when the skill is absent or the operator is working by hand.

First follow [Review an upstream release](docs/DEPLOYMENT-REPOSITORY.md#review-an-upstream-release) to resolve repository identity, fetch the published tag, prove ancestry, merge it on a temporary local branch with a regular merge, and choose how to land. That section owns the landing decision: a routine update pushes `main` directly when the deployment repository's instructions, branch protection, and rulesets allow it; a pull request is for repositories that require one, an operator who asked for review, or a conflict that needs a human decision; a failed policy read is unknown and is resolved, not assumed. Use the verified deployment repository explicitly for GitHub reads and writes. Never squash, rebase away upstream history, or force-push.

Before landing, inspect Actions variables and the actual workflows in the verified deployment repository. A repository-level `ENABLE_PRODUCTION_DEPLOY=false` explicitly disables the stock deploy job. A missing repository variable does not rule out an inherited organization variable; resolve that value before treating deployment as off. A failed read is unknown. With the stock workflow, `true` means landing on `main` migrates D1 and deploys. Land only within the operator's authorization, including the possible deployment consequence, and reuse authorization already given instead of asking again at each step. If deployment is off, a separate deployment request is needed to change the live Worker. Turning automation on later does not replay an old push. Keep code acceptance distinct from deployment automation, and report an updated source separately from a verified live deployment. A data backup with no upgrade is [`.agents/skills/backup-this-energon/SKILL.md`](.agents/skills/backup-this-energon/SKILL.md).

1. Confirm the account and [inventory the existing resources](#3-inspect-the-account-and-resources). Match the deployed Worker and its bindings to this deployment repository; do not adopt resources based on their names alone.
2. [Verify the existing Access applications by ID](docs/ACCESS-SETUP.md#verify-an-existing-configuration) using a read-only credential. Compare the returned team domain and hub audience with the configured vars. Different display names are supported; security differences stop verification. Do not run creation/apply to repair a mismatch without reviewing the reported settings.
3. Render the existing plugin, run checks, and [commit and deploy](#6-commit-and-deploy). `npm run skill:render` stamps the merged `version.txt` into the generated plugin and marketplace manifests; commit those generated files. Landing this repository or deploying the Worker does not update plugins already installed on agent machines; after the marketplace has the new package, [refresh installed plugins](#refresh-an-installed-plugin). When the operator asks for the deploy and this checkout has [`.agents/skills/deploy-this-energon/SKILL.md`](.agents/skills/deploy-this-energon/SKILL.md), follow that skill. Confirm [deployment repository CI is enabled and actually runs](docs/DEPLOY.md#enable-ci-in-a-new-deployment-repository). Apply pending migrations before deploying.
4. Repeat [installation acceptance](#7-verify-the-installation), including human sign-in and real publishing. Reuse an existing valid agent token; request human approval only if a new connection is needed.

If the deployment predates a command used here, merge that command into the configured deployment repository first. Return to first-install setup below only for resources that are genuinely missing and whose creation is authorized.

### 1. Choose the installation

Start by inspecting the current checkout, Git remotes, GitHub authentication, and available Cloudflare authentication. Reuse answers and authorization the operator has already supplied. Ask only for missing choices that cannot be established from that state:

| Choice | What to establish |
| --- | --- |
| Deployment repository | The GitHub user or organization and a new repository name. Create an independent private repository before committing instance settings. |
| Cloudflare | The intended account name and ID, with Workers Paid enabled for unzip and 25 MB uploads. Installation needs permission to create dedicated storage and deploy a Worker. |
| Identity | Exact allowed sign-in emails, administrator emails, and preferred identity provider. For personal use, the owner can be both the sole allowed user and administrator. Confirm that choice rather than deriving it from a cloud account email alone. |
| Hostnames | Two distinct hostnames in Cloudflare-managed zones the operator controls: one for the hub and one for content. Short siblings such as `energon.your.co` and `share.your.co` work; nesting is unnecessary. |
| Policy | Personal or team use, plus any requested retention or token restrictions. Use the [personal or team preset](docs/DEPLOY.md#personal-and-team-presets) once that use is known. |
| Plugin | A unique name for this Energon, including a distinct name for staging if applicable. Generic `energon` identities are rejected. |

For personal use, the preset keeps content until deliberately removed, allows unlimited retention, uses owner-only writes, and offers Never for ordinary tokens. The normal token default remains 90 days; ask the human which lifetime to approve when connecting. Team use can allow colleagues to update one another's work. Content retention and token lifetime are separate choices.

An installation request authorizes setup and deployment of the named deployment repository and resources; it does not authorize replacing unrelated resources. Human account authentication and agent connection approval remain human steps. Use a secret store or a user-only file for credentials, never the deployment prompt or chat.

<a id="2-prepare-the-fork"></a>

### 2. Prepare the deployment repository

New installations use an **independent private repository**, with the full upstream Git history. This is a normal Git copy, outside GitHub's fork network. Public forks are for contributing improvements upstream. Do not use a ZIP, a new initial commit, GitHub's template button, or a shallow clone for installation.

From a checkout of the upstream source, run the helper with the operator's chosen GitHub owner/repository and a **new** local directory:

```sh
node scripts/deployment-repo.mjs create your-org/energon ../yourco-energon
```

If no source checkout exists yet, clone `https://github.com/tmchow/energon.git` into a fresh directory and read its `INSTALL.md` first. The helper needs Node.js, Git, and GitHub CLI authenticated for repository creation in the chosen account. It clones upstream `main` with full history, creates a private repository, verifies its identity and visibility, then pushes only `main`. It records the copied commit. Initial installation uses that inspected source revision; later upgrades select a published release. It sets the new repository's `ENABLE_PRODUCTION_DEPLOY=false` and verifies that value before pushing, overriding any organization-level opt-in. It does not configure Cloudflare.

The destination checkout has `origin` pointing to the operator's repository and `upstream` pointing to `https://github.com/tmchow/energon.git`. Continue all remaining installation steps **inside that new checkout**, using its instructions:

```sh
cd ../yourco-energon
node scripts/deployment-repo.mjs inspect
git status --short
npm ci
```

Before configuring, confirm `canonical: false`, `isFork: false`, `isPrivate: true`, and `upstreamConfigured: true`. For an existing independent copy, clone that repository or reuse its checkout after inspecting local changes; do not run creation again. If `upstream` is missing, add the canonical URL above after confirming the existing remotes. A public independent repository needs the operator's visibility decision before private configuration is committed. A legacy public fork follows [Move an existing deployment to a private repository](docs/DEPLOYMENT-REPOSITORY.md#migrate-an-existing-public-fork).

If creation or its first push fails, the helper leaves the checkout and any created repository intact. Inspect both before resuming. Confirm the destination is the intended empty private non-fork repository, both origin fetch and push URLs target it, `ENABLE_PRODUCTION_DEPLOY` is explicitly false in the destination, and the checked-out source is unchanged before retrying a normal `git push --set-upstream origin main:main`. If it contains commits, compare them first. Never force-push or mirror-push to repair an interrupted installation.

Keep this Energon's configuration and generated plugins in the private repository. Credentials remain in secret stores, as before. Non-credential origins, resource IDs, administrator addresses, and policies can stay in `wrangler.toml`. Repository privacy does not change published-link access: public discovery still advertises the origins, repository coordinates, plugin identity, and runtime policy. See [CONTRIBUTING.md](./CONTRIBUTING.md) for improvements suitable for the public upstream.

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

Use the [Worker and hostname inventory commands](docs/DEPLOY.md#inventory-workers-and-hostnames) to inspect existing Worker names, storage bindings, custom domains, DNS routes, and Access applications. Both hostname zones must belong to the selected account. A matching name is a conflict to investigate, not permission to adopt storage or replace another Worker. Never reuse another Energon's D1 database or R2 bucket. For an existing installation, prove its bindings belong to this deployment repository before reusing them.

Complete first-time Zero Trust enrollment and identity-provider configuration if needed. Prefer the operator's chosen existing provider; Google Workspace does not require falling back to email PIN. These human/account setup steps are outside the installer command.

For a new installation, follow [Access setup prerequisites and preview](docs/ACCESS-SETUP.md#provide-a-scoped-setup-credential): provision the separate Access credential, save the account/provider/hostname/email inputs, and run its read-only plan. Resolve failed reads and existing-application conflicts before creating storage. Successful reads do not prove later write permission. For an existing deployment, use [verification by application ID](docs/ACCESS-SETUP.md#verify-an-existing-configuration) instead of the creation plan.

<a id="4-configure-this-fork"></a>

### 4. Configure this deployment repository

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

For an already initialized deployment repository, preserve its plugin name, origins, and token prefix. Refresh generated files with `npm run skill:render` after merging template changes or a new `version.txt`. Generated plugin versions follow the Energon release in `version.txt`; there is no per-instance plugin version. If it still uses a rejected generic identity, choose a unique name, rerun `skill:init` with the same deployed origin, update Wrangler's identity vars, and have users replace the old plugin and token environment name. Existing token values remain valid when `TOKEN_PREFIX` is unchanged.

### 5. Configure Access

For an existing deployment, use [read-only verification](docs/ACCESS-SETUP.md#verify-an-existing-configuration) and preserve its applications. For a new installation, return to the saved plan and follow [Apply and record the results](docs/ACCESS-SETUP.md#apply-and-record-the-results). The command creates or reuses the matching hub and public-path applications; it never rewrites conflicting applications. Keep the returned resource IDs with the installation record.

Copy the returned `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` into `[vars]`. The audience must belong to the hub application, not its bypass application. Energon verifies the signed hostname Access JWT before trusting an identity; an email header alone is not authentication.

The whole hub requires sign-in, including `/admin`, `/tokens`, `/connect`, and future hub pages. The six public hub paths are described in the [Access command contract](docs/ACCESS-SETUP.md#apply-and-record-the-results). Keep Access off the content hostname. Worker-level Access is unsuitable because this Worker also serves public content. The same applications and policies can be configured in the dashboard if the API path is unavailable.

### 6. Commit and deploy

Render and check the configured deployment repository before deploying:

```bash
npm run skill:render
npm run skill:render -- --check
npx wrangler types
npm run typecheck
npm run lint
npm test
```

Worker tests use isolated fixtures; do not change their test identities to match this installation. Review `git status` and the diff for secrets and accidental unrelated changes. Commit the intended `wrangler.toml`, `instance-skill.json`, generated `plugins/` package, and all generated marketplace catalogs (`marketplace.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.github/plugin/marketplace.json`). Include deliberate workflow changes if resource names changed. Do not commit `.dev.vars`, credentials, or local Cloudflare state.

Ensure [inherited Actions workflows are enabled](docs/DEPLOY.md#enable-ci-in-a-new-deployment-repository), then push those commits to the operator's deployment repository and verify the generated package is present on the branch its marketplace installs from, normally `main`. Follow the deployment repository's PR policy if required. A local-only plugin cannot be installed by another agent. Leave `ENABLE_PRODUCTION_DEPLOY=false` for this first deploy so Actions is tests only.

Apply migrations before deploying the Worker, using the configured database name if it differs:

```bash
npx wrangler d1 migrations apply energon --remote
npx wrangler deploy
```

Stop on a migration failure. Never stamp `d1_migrations` or execute ad hoc schema SQL to bypass it; see [Migration recovery](docs/DEPLOY.md#migrations-after-a-deploy). Do not deploy from an unrelated checkout or account. Record the deployed commit, account, resource IDs, origins, and plugin coordinates without secrets.

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

Keep sanitized requests, statuses, URLs, browser results, and workarounds. Record paths not tested, including cross-account owner-only writes or expiry when they were not exercised. Completion means the intended human is recognized, the plugin can be installed from the configured deployment repository, and real published bytes load and update on the content origin. Deployment or health alone does not establish completion.

### After the first deploy: optional automatic updates

This automates deployment of accepted code. It never fetches or automatically merges upstream releases.

The Worker is already live from step 6. Later code changes can use the same laptop Wrangler commands, or this deployment repository can update the Worker on every push to `main`. That second path is optional and is a separate decision from enabling CI tests.

1. Keep [deployment repository CI](docs/DEPLOY.md#enable-ci-in-a-new-deployment-repository) enabled so tests run on pull requests and on `main`.
2. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account ID, not a zone ID). Provision a deploy token scoped to the selected account and hostname zones. The Access setup credential is not a deployment token. See [GitHub deployment automation](docs/DEPLOY.md#github-deployment-automation).
3. Set the repository variable `ENABLE_PRODUCTION_DEPLOY=true`.
4. A later push or merge to `main` then runs tests, remote D1 migrations, and `wrangler deploy`. Pull requests never deploy.

Keep the variable false to keep Actions as tests only. To catch up to a published upstream release after that, use [`.agents/skills/update-from-upstream/SKILL.md`](.agents/skills/update-from-upstream/SKILL.md) when this checkout has it. To deploy code from your machine while the variable is false, use [`.agents/skills/deploy-this-energon/SKILL.md`](.agents/skills/deploy-this-energon/SKILL.md).

---

## Connect an agent

Start once this Energon is deployed, public discovery works, and human sign-in is verified. During installation, complete this connection flow and then return to the [publishing acceptance checks](#7-verify-the-installation).

Start with the **origin** (`https://energon.your.co`). `GET {origin}/v1/help` (no auth) supplies the marketplace's GitHub repository at `identity.repo`, the plugin at `install`, and the token environment variable at `env`. Use those values rather than guessing the repository from the hostname. If an older deployment omits `identity.repo`, ask the operator for the deployment repository's GitHub repository.

### Private repository access

The generated plugin lives in this Energon's private deployment repository. The agent's machine needs GitHub read access to download it and future plugin updates. An Energon API token does not grant GitHub access; GitHub access does not authorize publishing.

Verify access from the same environment that will install the plugin:

```sh
git ls-remote https://github.com/your-org/energon.git HEAD
```

Use the operator's real repository and their existing Git credential helper or SSH identity. Authenticate through the client's supported GitHub flow when needed, including organization SSO authorization. Never embed credentials in a repository URL, prompt, generated plugin, or committed settings. GitHub CLI authentication alone does not prove another client can clone the repository.

A private repository may appear as 404 when access is missing. Stop that installation and request the required access; do not make the repository public. After access works, use the client's normal marketplace installation below and verify it loaded this Energon's generated skill, origin, and token environment.

If the client cannot consume private marketplaces but supports local skills, clone the repository with authenticated Git into a user-owned directory and install **only** `plugins/{plugin}/skills/{skill}/` using the client's supported local-skill mechanism at user scope. Keep that directory's references together, record the source commit and path, and refresh it from the private repository when updating. Do not install all repository skills: the operator skills manage deployments and releases. Local installation is complete only after the client loads the generated publish skill. If neither installation path is available, use this Energon's public `/v1/help`, `/llms.txt`, and `/auth.md` with human-approved API access; report plugin installation as unavailable. The API remains usable without GitHub access.

### 1. Add the marketplace and install the skill

Install at **user (global) scope** so it is available in every project. Project or workspace scope only if the human asked for that.

Each Energon ships its own skill in its own repo, with its own name and token env. `yourco-energon` and another company's `esper-energon` can both live on the same machine. Install the one you want everywhere at user scope. If you belong to more than one organization, install each skill, or pin the second in that company's project settings. Do not install two marketplaces that share the same `name`.

The shortest path is the Skills CLI, which installs the same skill across compatible agents. Use `--skill` so you install this Energon's publish skill, not the operator skills from the same repo. After merging marketplace template changes, run `npm run skill:render` so the catalog can find that skill:

```
npx skills add your-org/energon --skill yourco-energon -g
```

Or add the company repo as a marketplace:

```
your-org/energon
```

```
https://github.com/your-org/energon
```

Add that as a marketplace, then install the plugin named in `GET {origin}/v1/help` → `install`.

Or paste this, filling in the values from `/v1/help` or `/setup`:

```
Install {plugin} at user (global) scope from https://github.com/{owner/repo} ({owner/repo}). Run `npx skills add {owner/repo} --skill {plugin} -g`, or add that GitHub marketplace and install {plugin} with your normal plugin flow. Do not install at project or workspace scope unless I ask.

If this repository is private, verify GitHub read access from this environment first. Keep GitHub credentials separate from the Energon token. If private marketplace installation is unavailable, follow INSTALL.md "Private repository access" for the local-skill or API fallback. Never make the repository public to install it.

Then read {origin}/auth.md. If {TOKEN_ENV} is already set, use it. Otherwise connect with a code: show me the link and code, wait for my approval, then save the delivered token as {TOKEN_ENV} where this environment keeps secrets, readable only by me. Do not invent a token.
```

Signed-in humans can copy a filled block from `{origin}/setup`.

Harness-specific commands (replace repo / plugin with this Energon’s values):

**Skills CLI** (same command as above; works across compatible agents)

```
npx skills add your-org/energon --skill yourco-energon -g
```

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

<a id="refresh-an-installed-plugin"></a>

### Refresh an installed plugin

Updating the deployment repository or deploying the Worker does not update plugins already installed on agent machines. Claude Code and Codex copy the plugin into a versioned local cache and skip the update when the reported version is unchanged. That is why generated manifests follow `version.txt` instead of staying at `1.0.0`.

After this Energon lands a release, `npm run skill:render` stamps the new `version.txt` into the committed plugin. Clients with GitHub read access then refresh. Use the marketplace and plugin names from `GET {origin}/v1/help` (examples below use `yourco-energon`).

**Skills CLI**

```
npx skills update yourco-energon -g
```

**Claude Code**

```
claude plugin marketplace update yourco-energon
claude plugin update yourco-energon@yourco-energon
```

Then `/reload-plugins` in an open session, or start a new session. An install that still reports `1.0.0` moves once the marketplace plugin version is no longer `1.0.0`. `/plugin update` compares the version string, not git contents; a hardcoded `1.0.0` leaves the cached copy in place. Third-party marketplaces have auto-update off by default; enable it in `/plugin` → Marketplaces if you want Claude Code to pull new versions in the background after startup.

**Codex**

Git marketplaces refresh on startup. To refresh now:

```
codex plugin marketplace upgrade yourco-energon
codex plugin add yourco-energon@yourco-energon
```

Codex stores each version at `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`. A new version is a new cache directory. Re-adding after a marketplace upgrade is what moves an existing `1.0.0` install onto the release version.

**Cursor, Grok, Copilot**

Use that client's marketplace refresh and plugin update (or reinstall) after the deployment repository has the new generated plugin.

Private repositories still need GitHub read access for updates. If the client installed from a local clone instead of the marketplace, pull that clone and reinstall the skill from `plugins/{plugin}/skills/{skill}/` as in [Private repository access](#private-repository-access).

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
- Do not tell a company to install from `tmchow/energon`; generate and commit the plugin in its configured deployment repository first.
