# Set up Access from the terminal

This is the `setup:access` command contract. Follow [INSTALL.md](../INSTALL.md) for the installation sequence; use this reference at its Access preview and apply steps after the operator has authorized deployment. Wrangler manages storage and Worker deployment; `setup:access` manages the hostname-based Access applications and policies. It does not enroll a Zero Trust organization, create an identity provider, attach domains, or deploy the Worker.

## Select the account before creating resources

Run `npx wrangler whoami` and confirm the intended account and email. Set `account_id` in `wrangler.toml` explicitly. The [installation preflight](../INSTALL.md#3-inspect-the-account-and-resources) owns account and resource selection; this command uses the same account ID in its JSON configuration.

If Wrangler is signed into a work account and you need a personal account, select an existing named profile with `npx wrangler auth activate personal .`, then repeat `npx wrangler whoami`. The directory binding avoids changing the default profile used elsewhere. Do not assume `whoami --profile personal` works. If authentication is missing, a human must complete the supported login flow on their local machine; unattended agents need a provisioned credential.

Complete Zero Trust enrollment and configure the desired identity provider first. For a Google Workspace account, explicitly select its existing Workspace provider rather than silently choosing email PIN. This command reuses a provider by ID and never changes it. First-time Google provider creation is a separate Cloudflare setup step.

## Provide a scoped setup credential

Normal Wrangler OAuth does not provide the Access administration permissions this command needs. Have the operator provision `CLOUDFLARE_ACCESS_API_TOKEN` in the environment through a secret store or a user-only file outside the repo. Do not put the secret in command arguments, the JSON config, logs, or chat.

Scope this credential to the selected account, with:

- **Access: Apps and Policies — Read** for preview or verification; **Edit** for apply
- **Access: Organizations, Identity Providers, and Groups — Read**

Preview reads the organization, provider inventory, applications, and reusable policies. Verification reads the organization, providers, applications, and policies attached to the selected applications. Any failed read stops setup. Successful reads do not prove write permission: a denied create stops apply and reports the failed operation. The command does not retry writes automatically. After correcting permissions, rerun it to reconcile already-created resources.

For ongoing deployment credentials, see [GitHub deployment automation](DEPLOY.md#github-deployment-automation). Do not reuse this Access-only credential as the deployment token.

## Preview the configuration

First find the existing provider ID. The read-only endpoint is `GET /accounts/{account_id}/access/identity_providers`. Set `CLOUDFLARE_ACCOUNT_ID` to the confirmed account ID and use the setup credential already in the environment. This example prints only provider IDs, names, and types; provider configuration can contain secrets and must not be logged.

```sh
node --input-type=module <<'JS'
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_ACCESS_API_TOKEN;
if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token) throw new Error("Set the selected account ID and setup credential in the environment.");
for (let page = 1; ; page++) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/access/identity_providers?page=${page}&per_page=100`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Provider inventory failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success || !Array.isArray(data.result)) throw new Error("Provider inventory failed.");
  for (const { id, name, type } of data.result) console.log(JSON.stringify({ id, name, type }));
  if (data.result_info?.total_pages ? page >= data.result_info.total_pages : data.result.length < 100) break;
}
JS
```

Select the provider the operator requested, then save non-secret inputs in a local JSON file outside the repository:

```json
{
  "account_id": "0123456789abcdef0123456789abcdef",
  "hub_hostname": "energon.your.co",
  "content_hostname": "share.your.co",
  "identity_provider_id": "11111111-1111-4111-8111-111111111111",
  "allowed_emails": ["owner@your.co"]
}
```

Use actual account/provider IDs. The hostnames must differ; short sibling hostnames are fine. `allowed_emails` is an exact-email list, not a domain wildcard. Set `ADMIN_EMAILS` and `ALLOWED_EMAIL_DOMAINS` separately in Wrangler for Energon's application policy.

```sh
npm run setup:access -- --config /path/to/access-setup.json
```

Review the account ID, selected provider, allowed emails, and create/reuse actions. No resources change without `--apply`. If an existing app covers either hostname (including a matching wildcard), setup stops. Worker-level Access destinations also require manual review because they may protect all Worker hostnames. The tool never deletes or rewrites another app to make room.

## Verify an existing configuration

Use this mode for ordinary updates or an installation created through the dashboard or another tool. It selects existing applications by ID and ignores display names. It never creates, updates, or deletes resources, and cannot be combined with `--apply`. A Read credential is sufficient; there is no need to grant Edit for an update check.

Inventory application IDs with `GET /accounts/{account_id}/access/apps`. From the repository root, this prints only IDs, names, and public destinations using the same environment credential:

```sh
node --input-type=module <<'JS'
import { cloudflareClient } from './scripts/setup-access.mjs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/.test(account ?? '')) throw new Error('Set the selected account ID.');
const client = cloudflareClient(process.env.CLOUDFLARE_ACCESS_API_TOKEN);
for (let page = 1; ; page++) {
  const data = await client(`/accounts/${account}/access/apps?page=${page}&per_page=100`);
  if (!Array.isArray(data.result)) throw new Error('Invalid application inventory.');
  for (const { id, name, domain, destinations } of data.result) console.log(JSON.stringify({ id, name, domain, destinations }));
  if (data.result_info?.total_pages ? page >= data.result_info.total_pages : data.result.length < 100) break;
}
JS
```

Match the hub hostname and its six public bypass paths to the intended applications. Add their distinct IDs to a copy of the JSON configuration above:

```json
{
  "account_id": "0123456789abcdef0123456789abcdef",
  "hub_hostname": "energon.your.co",
  "content_hostname": "share.your.co",
  "identity_provider_id": "11111111-1111-4111-8111-111111111111",
  "allowed_emails": ["owner@your.co"],
  "hub_application_id": "22222222-2222-4222-8222-222222222222",
  "bypass_application_id": "33333333-3333-4333-8333-333333333333"
}
```

```sh
npm run setup:access -- --config /path/to/access-verify.json --verify
```

Verification reads each selected application and all pages of its attached policies, including reusable and application-specific policies. It requires the same security settings as setup: self-hosted applications, 24-hour sessions, the exact hub/provider/email allow policy, and exactly one public bypass policy covering the six paths below. Array ordering and display names may differ. Additional policies, policy overrides, WARP or preflight bypasses, unexpected destinations, and other overlapping hostname or Worker-level applications are refused.

On success, JSON includes `verified: true`, `applied: false`, `application_ids`, `policy_ids`, `ACCESS_TEAM_DOMAIN`, and the hub's `ACCESS_AUD`. Compare these with the installation record and Wrangler vars. A failure identifies the application or policy ID and differing fields; inspect those settings and the intended policy before making any changes. Failure does not authorize recreation or deletion. Creation preview/apply reject the verification-only ID fields, so keep the two configuration files separate when both are needed.

## Apply and record the results

```sh
npm run setup:access -- --config /path/to/access-setup.json --apply
```

The command creates two reusable policies and two applications:

1. The entire hub hostname requires sign-in through the selected provider and allows only the listed emails. This covers `/admin` and future hub pages as well as `/tokens` and `/connect`.
2. A more-specific application bypasses Access for `/v1*`, `/health`, `/llms.txt`, `/auth.md`, `/favicon.svg`, and `/static*` on the hub.

No Access application is created on the content hostname. Apps use a 24-hour Access session; this is separate from API token lifetime and content retention.

The command reads back the application settings and prints non-secret resource IDs and `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`. Save this output with the deployment record and copy the two vars into `[vars]` in `wrangler.toml`. The AUD must belong to the hub app, not the bypass app. The current Worker uses these vars for hostname Access JWT validation.

Rerunning with the same inputs reuses matching resources without writes. After an interrupted run, it discovers resources by their deterministic names; if settings differ, it stops for manual review. Do not run multiple installers for the same host concurrently. There is no automatic rollback: keep already-created IDs and resolve the reported conflict rather than deleting unrelated resources.

## Return to installation

After the read-only preview, return to [Configure this fork](../INSTALL.md#4-configure-this-fork). After verification, return to [Update an existing Energon](../INSTALL.md#update-an-existing-energon). After apply and readback, return to [Configure Access](../INSTALL.md#5-configure-access) to copy the values, then continue through commit, migration, deployment, and acceptance checks. This command does not perform those steps.

Cloudflare references: [API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [Access applications API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/), [Access policies API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/).
