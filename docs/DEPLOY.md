# Energon configuration and operations

Use [INSTALL.md](../INSTALL.md) for the deployment sequence. This reference owns policy presets, variables, generated-plugin maintenance, and operations for personal and team installations. Keep each Energon's D1 catalog and R2 objects dedicated to that installation.

## Personal and team presets

Choose the use case before configuring Wrangler. Personal use does not require short-lived content. For personal work that should remain available until deliberately removed, put these strings under `[vars]`:

```toml
ALLOW_UNLIMITED_RETENTION = "true"
DEFAULT_TTL = "never"
MAX_TTL = "never"
WRITE_POLICY = "owner"
ALLOW_UNLIMITED_TOKENS = "true"
```

Owner-only writes restrict modifications to the creator; they do not make published links private. Never on the ordinary-token menu is a choice, not the default lifetime: the normal default remains 90 days, and the human chooses a lifetime when minting or approving a connection. Admin tokens cannot use Never.

For a trusted team whose token holders should be able to update one another's work, use the same retention and token settings with `WRITE_POLICY = "org"`. Choose finite content retention or disable Never for future ordinary tokens when the operator wants those restrictions, independently of personal versus team use.

The committed `wrangler.toml` uses the team settings. Omitting vars produces different code defaults: required content TTL, a 7-day default, a 30-day cap, and owner-only writes. Set the intended preset explicitly. `ADMIN_EMAILS` defaults to empty, so set the agreed administrator addresses separately. `ALLOWED_EMAIL_DOMAINS` supplements the exact-email Access admission policy; a shared domain alone is not a personal allowlist.

## Cron cost (every 5 minutes)

The trigger itself is not a separate product. Each run is a Worker invocation.

- `*/5 * * * *` → 12/hour × 24 × 30 = **8,640 invocations / month**
- Workers Paid ($5/mo, which you already need for 25 MB uploads): 10 million requests and 30 million CPU-ms included. 8,640 requests is noise.
- An empty sweep is one D1 `SELECT … LIMIT 100` and returns. You pay R2 deletes only when something actually expired.
- Cron does **not** retry on failure. Reads still enforce expiry, so a missed sweep does not serve dead content.

Hourly (`0 * * * *`) is also fine. Keep 5 minutes so R2 bytes leave soon after expiry.

## How expiry actually works

Two paths, on purpose:

1. **Cron** (`src/expire.ts` `sweepExpired`) — select `expires_at <= now`, delete R2 + D1, purge cache. Batch of 100.
2. **Read/write check** — GET/PUT/PATCH: if `expires_at` is in the past → **410 Gone**, then `waitUntil` purge that one object. Edge `s-maxage` is capped to leftover TTL.

`PUT` does not extend TTL. `PATCH { "ttl": "7d" }` resets from now, still capped by `MAX_TTL`. `"never"` is 400 unless `ALLOW_UNLIMITED_RETENTION=true`.

R2 lifecycle rules cannot do per-object `expires_at`. The Worker owns the clock.

API tokens expire on their own clock, separate from content. A human picks a lifetime on `/tokens` when minting (`1d`, `7d`, `30d`, `60d`, `90d`, `180d`, `365d`; default `90d`; `never` only when `ALLOW_UNLIMITED_TOKENS` allows it). Auth rejects an expired token with `401 token_expired`; the row stays listed on `/tokens` as expired so the owner can see why an agent stopped, and can still revoke it. There is no renew: the human mints a new token. Tokens minted before this column existed have no expiry.

`ADMIN_EMAILS` is a comma list of operator addresses. Only those people can mint an **admin** token from `/tokens` (`scope: admin`). Connect never grants that scope. Admin tokens last at most 7 days (default 1 day) and cannot be never. Admin routes also check that the owner is still on the list, so removing an email strips admin from every token at once. Ordinary `/v1` calls with an admin token still act as that account.

## Generated plugin maintenance

Installation and first rendering belong in [Configure this fork](../INSTALL.md#4-configure-this-fork). The installable package is the committed `plugins/{name}/` directory and marketplace catalogs; upstream contains only templates and placeholder configuration. The operator's fork must publish the generated package before another agent can install it.

`instance-skill.json` and `templates/` are the sources. Before initialization, `npm run skill:render` and its `--check` form validate templates without generating files. After initialization, render refreshes the package and catalogs; `--check` fails if they drift. Keep the Worker identity variables aligned with the manifest. Do not hand-edit generated files or put the publish skill in `.agents/skills` or `.claude/skills`.

Use distinct names for each installation. For a legacy generic identity, follow the migration guidance in [Configure this fork](../INSTALL.md#4-configure-this-fork); keep `TOKEN_PREFIX` unchanged to preserve existing token values.

## Instance vars (`wrangler.toml` `[vars]`)

Strings only (Wrangler).

| Var | Example or configuration | Default if unset |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `https://energon.your.co` | `https://energon.example.com` |
| `CONTENT_ORIGIN` | `https://share.your.co` | `https://content.energon.example.com` |
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` (hostname only) | unset; hostname JWT authentication unavailable |
| `ACCESS_AUD` | hub Access application audience tag | unset; hostname JWT authentication unavailable |
| `ALLOW_UNLIMITED_RETENTION` | `true` | `false` |
| `DEFAULT_TTL` | `never` | `7d` (`never` if unlimited is on and this is unset) |
| `MAX_TTL` | `never` | `30d` (`never` if unlimited) |
| `TTL_PRESETS` | omit (full catalog) | code catalog ∩ `MAX_TTL` |
| `ALLOW_UNLIMITED_TOKENS` | `true` | `true` (Never on the token lifetime menu; `false` removes it). Only affects future mints — tokens minted before, and Never tokens minted before you flip it, keep working until revoked on `/tokens`. |
| `ALLOWED_EMAIL_DOMAINS` | `your.co,your.com` | empty (any Access email) |
| `ADMIN_EMAILS` | `you@your.co` | empty (no one is admin; admin tokens and `/v1/admin` refuse) |
| `TOKEN_ENV` | match the rendered skill | `ENERGON_TOKEN` |
| `TOKEN_PREFIX` | `ee_live_` | `ee_live_` |
| `SKILL_NAME` | `yourco-energon` | `energon` |
| `MARKETPLACE_NAME` | same as `SKILL_NAME` | `energon` |
| `MARKETPLACE_REPO` | `your-org/energon` | `tmchow/energon` |
| `FOOTER_TEXT` | omit, or one company line | empty (no footer) |
| `MAX_FILE_BYTES` | omit (25 MB) | 25 MB |
| `MAX_PLATFORM_BYTES` | omit (20 GB) | 20 GB |
| `WRITE_POLICY` | `org` | `owner` |
| `DEV_ACCESS_EMAIL` | `.dev.vars` only | `dev@example.com` |

The catalog in code is:

`30m, 1h, 1d, 7d, 14d, 30d, 60d, 90d, 180d, 365d`

The hub shows those that fit under `MAX_TTL`, with human labels (**3 months**, not 90 days), plus **Never** only if unlimited is on. `TTL_PRESETS` is an optional hide-list, not how you invent new windows.

`GET /v1/help` echoes origin, token env, skill, install line, retention, token lifetime policy (`tokens`), and this Energon's file / platform caps.

## Migrations after a deploy

The Worker adds missing columns itself at startup (`ensureSchema`), and `migrations/` carries the same change for `wrangler d1 migrations apply`. `ADD COLUMN` is not idempotent, so order matters:

1. Apply migrations first: `npx wrangler d1 migrations apply energon --remote` (or let the deploy job do it).
2. Then deploy the Worker.

If the Worker deployed first, a later migration may fail with `duplicate column name`. Stop deployment and preserve the error, deployed version, migration history, and schema evidence. Compare the complete pending migration with the actual schema and arrange an explicit recovery plan; one existing column does not prove the migration completed. Do not stamp `d1_migrations`, rewrite an applied migration, or run ad hoc schema SQL to skip the failure.

**Rollback floor for token expiry.** Once any token has a non-null `expires_at`, do not roll back below the first build that enforces expiry: an older Worker ignores the column, so every finite-lifetime token, including expired ones, authenticates again. If you must roll back that far, revoke those tokens first:

```sql
SELECT id, user_email, label, expires_at FROM tokens WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
```

The same query with `expires_at IS NULL` lists never-expiring tokens, which is what to review after setting `ALLOW_UNLIMITED_TOKENS=false`: the flag stops new ones; revoke is the only lever for existing ones.

`MAX_FILE_BYTES` is one file, one zip upload, and one site zip export. Accepts `25mb`, `5mb`, or a raw byte count. `MAX_PLATFORM_BYTES` is the whole-bucket safety valve (default 20 GB).

`FOOTER_TEXT` is one line on signed-in pages. It is escaped as text — not HTML. Leave it empty for no footer. Use this variable instead of editing hub components to brand a fork.

`WRITE_POLICY` is the default for **new** sites and loose files: `owner` (only `created_by` may PUT/PATCH/DELETE) or `org` (any token on this host). Unset is `owner`. Each object stores its own `write_policy`. Stored NULL is treated as `org`. The creator can `PATCH { "write_policy": "owner" | "org" }`. Anyone with a token can still read via `/v1`.

## Customize a fork

Keep the diff small so merging `upstream/main` stays manageable. Worker, hub, `/v1`, template, and docs changes that apply to every Energon belong in a PR against `tmchow/energon`; keep this fork's identity files here. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Before an update, inspect local changes and retain the installation's account ID, D1/R2 bindings, both origins/routes, policy, Access vars, plugin identity, and token prefix. Review upstream changes before merging; do not replace the configured `wrangler.toml` or `instance-skill.json` with upstream placeholders. Compare new keys with `wrangler.example.toml`, apply only the settings needed, and regenerate the plugin after template changes. Review and commit generated changes to the fork. If this checkout has [`.agents/skills/update-from-upstream/SKILL.md`](../.agents/skills/update-from-upstream/SKILL.md), follow that skill. For a D1 Time Travel bookmark or an independent R2 copy without an upgrade, see [`.agents/skills/backup-this-energon/SKILL.md`](../.agents/skills/backup-this-energon/SKILL.md) and [Back up and restore D1 and R2](https://docs.getenergon.com/operate/disaster-recovery).

Supported customization uses Wrangler vars (`FOOTER_TEXT`, TTL, email domains, `WRITE_POLICY`) and `instance-skill.json`. Hub UI source is in `src/ui/`; direct component changes add merge conflicts. Use the updated checkout's [installation checks and migration order](../INSTALL.md#6-commit-and-deploy), then repeat acceptance checks for the upgraded Energon.

## Inventory Workers and hostnames

Use this read-only inventory during [installation preflight](../INSTALL.md#3-inspect-the-account-and-resources) and updates. Alongside Wrangler's D1 and R2 lists, inspect the deployed Worker configuration to match its storage binding IDs with this fork. Listing a Worker name alone does not establish ownership.

For a new installation or changed hostname, run the full inventory below. Create a scoped read-only API token with these permissions:

| Resource scope | Permission | Inventory |
| --- | --- | --- |
| Selected account | Workers Scripts Read | Worker scripts, settings, and custom domains |
| Each selected zone | Zone Read | Zone and account identity |
| Each selected zone | Workers Routes Read | Routes, including wildcard matches |
| Each selected zone | DNS Read | Existing hostname records |

Cloudflare documents the accepted permissions for [custom domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/), [zone details](https://developers.cloudflare.com/api/resources/zones/methods/get/), and [DNS records](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/). A working Wrangler login or an Access-only token does not establish DNS Read access. If DNS inventory returns 403, check the token's DNS Read permission and selected zone scope; do not interpret it as an empty zone.

For an update with unchanged hostnames, you can use existing read credentials without adding DNS Read only after verifying the deployed Worker's storage bindings, both custom domains' `service` and `zone_id`, and matching routes against this fork. Read bindings from `GET /accounts/{account_id}/workers/scripts/{worker_name}/settings`; compare the D1 database ID and R2 bucket name with `wrangler.toml`. If ownership is uncertain or any hostname or route will change, use the full inventory. This exception does not authorize replacing DNS records or routes.

Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `ENERGON_HUB_HOSTNAME`, and `ENERGON_CONTENT_HOSTNAME` in the environment to the selected account, one hostname's zone, and both hostnames. Run once for each zone if they differ. Use a read-only `CLOUDFLARE_API_TOKEN` that can list Workers, custom domains, zone routes, and DNS records; a credential scoped only to Access cannot do this. The zone ID is available on the zone's Cloudflare overview page. This script also checks that the zone belongs to the selected account.

```sh
node --input-type=module <<'JS'
import { cloudflareClient } from './scripts/setup-access.mjs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const zone = process.env.CLOUDFLARE_ZONE_ID;
const hosts = [process.env.ENERGON_HUB_HOSTNAME, process.env.ENERGON_CONTENT_HOSTNAME];
if (![account, zone].every(id => /^[a-f0-9]{32}$/.test(id ?? '')) || hosts.some(host => !host || /[/:\s]/.test(host))) throw new Error('Set the selected account, zone, and bare hostnames.');
const client = cloudflareClient(process.env.CLOUDFLARE_API_TOKEN);
const zoneInfo = (await client(`/zones/${zone}`)).result;
if (zoneInfo.account?.id !== account) throw new Error('Zone belongs to another account.');
const inventories = [
  [`/accounts/${account}/workers/scripts`, ['id']],
  [`/accounts/${account}/workers/domains`, ['id', 'hostname', 'service', 'environment', 'zone_id']],
  [`/zones/${zone}/workers/routes`, ['id', 'pattern', 'script']],
  ...hosts.map(host => [`/zones/${zone}/dns_records?name=${encodeURIComponent(host)}`, ['id', 'name', 'type', 'content', 'proxied'], true]),
];
for (const [path, fields, paginated] of inventories) {
  for (let page = 1; ; page++) {
    const data = await client(paginated ? `${path}&page=${page}&per_page=100` : path);
    if (!Array.isArray(data.result)) throw new Error(`Invalid inventory: ${path}`);
    if (!paginated && (data.result_info?.total_pages > 1 || data.result_info?.total_count > data.result.length)) throw new Error(`Incomplete inventory: ${path}; inspect the API pagination before continuing.`);
    for (const item of data.result) console.log(JSON.stringify({ path, ...Object.fromEntries(fields.map(key => [key, item[key]])) }));
    if (!paginated || (data.result_info?.total_pages ? page >= data.result_info.total_pages : data.result.length < 100)) break;
  }
}
JS
```

Review matching custom domains, wildcard routes, and DNS records before deploying. Failed or incomplete inventory is not proof a hostname is available. Do not replace an existing route or record to make a deployment succeed without establishing that it belongs to this Energon. Inspect Access separately through the [Access command contract](ACCESS-SETUP.md).

## Cloudflare Access

The [Access command contract](ACCESS-SETUP.md) owns credentials, preview/apply and read-only verification syntax, application destinations, and conflict recovery. [INSTALL.md](../INSTALL.md#5-configure-access) places that setup in the deployment workflow.

Hostname authentication requires `ACCESS_TEAM_DOMAIN` and the hub application's `ACCESS_AUD`. Energon verifies the JWT signature, issuer, audience, expiry, application token type, and user identity; an authenticated-email header alone is not trusted. When sign-in succeeds but the hub reports **Not signed in**, compare those vars with the active hub application and redeploy through the normal workflow.

Keep the whole human hub protected, agent paths on the documented bypass, and the content hostname free of Access. Removing a human from Access does not revoke their existing Energon API tokens; follow offboarding below. There is no `PUBLISH_VISIBILITY` var.

## Enable CI in a new fork

GitHub can leave inherited workflows disabled even when repository Actions permissions say they are enabled. Open the fork's **Actions** tab and, if offered, enable inherited workflows there. Do this before the configured commit is pushed or a PR is opened. A missing run is not a passing check.

From the configured fork, inspect actual workflow and run state:

```sh
gh workflow list --all
gh run list --limit 10
```

If a listed CI workflow is individually disabled, use `gh workflow enable ci.yml` after the fork's one-time enablement. A 404 before that first enablement does not establish that the committed workflow file is missing; inspect the Actions tab.

Enabling workflows does not replay old events. The checked-in CI runs on pushes to `main` and PR opened, synchronized, or reopened events; it has no manual `workflow_dispatch` trigger. Push the next intended commit after enablement, or reopen the relevant owned PR when appropriate, then confirm its new head has a CI run and inspect the result with `gh run view RUN_ID`. Do not use `gh workflow run ci.yml` or create empty commits to compensate for an unverified setup. Scheduled fuzzing is separate from PR CI and may remain disabled in a fork.

Keep `ENABLE_PRODUCTION_DEPLOY` unset while establishing CI. Enabling tests and enabling production deployment are separate decisions.

## GitHub deployment automation

CLI deployment in [INSTALL.md](../INSTALL.md#6-commit-and-deploy) is part 1: the first live Worker. Part 2 is optional: after that deploy is verified, the fork can update the Worker on every push to `main`. See [After the first deploy](../INSTALL.md#after-the-first-deploy-optional-automatic-updates). The fork's `.github/workflows/ci.yml` expects secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus repository variable `ENABLE_PRODUCTION_DEPLOY=true`. Unset means tests only. The job runs tests, applies remote D1 migrations, then deploys; pull requests cannot deploy.

Provision a separate deployment token scoped to the selected account and hostname zones, with permissions for Worker deployment, D1 migrations, R2 access, and custom domains. Use [Cloudflare's current Wrangler token reference](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/#cloudflare_api_token) and inspect the actual workflow when provisioning. The Access-only setup credential is not a deployment credential. Remove it from the agent environment after setup.

If resource names differ from the defaults, update the workflow's database name and Wrangler bindings together before enabling deployment. The account secret is an account ID, not a zone ID. Keep automated deployment disabled until configuration has been reviewed.

## Offboarding a person

There is no transfer-ownership feature, on purpose. Everything you need is already in place; this is the order to do it in.

1. Remove the person from Cloudflare Access (see [Cloudflare Access](#cloudflare-access)). That is outside Energon and it stops the human: no hub, no new tokens.
2. Revoke their API tokens. On `/admin`, type their handle in Tokens across accounts, List, then Revoke all. With an admin token, `GET /v1/admin/tokens?owner=handle` and `POST /v1/admin/tokens/revoke` with `{ "owner", "target": "all" }`, then resend with `confirm`. That stops their agents immediately.
3. Find what they own. On `/admin`, set Owner to their handle and Preview (or `POST /v1/admin/cleanup` with `target.owner`). You get metadata only: owner, name, size, last written, last read, expiry. The admin surface never returns bytes or secrets.
4. Keep the few things that matter. Anyone with a token can already read anything on this Energon over `/v1`, and Duplicate (the hub More actions menu, or `duplicate_from` on `POST /v1/sites` / `POST /v1/files`) makes an independent copy under the caller's own handle at a new address. That is how ownership moves: the colleague who needs it copies it, then the original expires. There is no bulk transfer because the handle is in the public URL and the R2 key; a copy is a new object with a new owner, which is the honest outcome. Old links to the original stop working when it expires, so tell people the new address.
5. Free the storage. Back on the same `/admin` preview, choose Set expiry (7 days unless you pick otherwise) or Delete, type the count, confirm. On offboarding the 7-day grace is notice for colleagues who may still hold links; the owner cannot see their catalog any more, so it is not for them. Every preview and execute is recorded in the audit log on `/admin` and `GET /v1/admin/audit`.
6. Afterwards. Expired objects are purged by the cron within minutes, or run Sweep now on `/admin`. Check the storage health readout there for expired awaiting purge and quota used. The departed handle stays reserved and stays in old URLs; that is harmless.

## What you should not do

Do not reuse another Energon’s D1 `database_id` or R2 bucket. Do not put Access on `/v1`. Do not install two marketplaces that share the same `name`. Do not leave `{{ORIGIN}}` in a skill you ship to agents. Do not `d1 execute` an `UPDATE ... SET owner_id` to move content between people; use copy-then-expire (see [Offboarding a person](#offboarding-a-person)). The audit log will not know about a hand edit.

## Agent connections

Keep `/connect` behind the same Access policy as `/tokens`; keep `/v1/connections` and its token polling endpoint under the existing `/v1*` bypass. Humans still authorize every credential. The new connection endpoints do not implement OAuth or public signup.

Migration `0014_agent_connections.sql` adds short-lived connection records. Request creation is limited to 20 per IP and 1000 on this Energon per ten minutes; pending clients poll at most every five seconds. Cron removes records more than a day past expiry. No API token or poll secret is stored in plaintext. The delivered credential appears in the existing Tokens UI. If delivery is lost, revoke that token before approving a replacement.
