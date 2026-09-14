# Set up Access from the terminal

Use this from an operator-owned fork after the operator has authorized deployment. Wrangler manages storage and Worker deployment; `setup:access` manages the hostname-based Access applications and policies. It does not enroll a Zero Trust organization, create an identity provider, attach domains, or deploy the Worker.

## Select the account before creating resources

Run `npx wrangler whoami` and confirm the intended account and email. Set `account_id` in `wrangler.toml` explicitly. Do this before the R2/D1 creation steps in [INSTALL.md](../INSTALL.md).

If Wrangler is signed into a work account and you need a personal account, select an existing named profile with `npx wrangler auth activate personal .`, then repeat `npx wrangler whoami`. The directory binding avoids changing the default profile used elsewhere. Do not assume `whoami --profile personal` works. If authentication is missing, a human must complete the supported login flow on their local machine; unattended agents need a provisioned credential.

Complete Zero Trust enrollment and configure the desired identity provider first. For a Google Workspace account, explicitly select its existing Workspace provider rather than silently choosing email PIN. This command reuses a provider by ID and never changes it. First-time Google provider creation is a separate Cloudflare setup step.

## Provide a scoped setup credential

Normal Wrangler OAuth does not provide the Access administration permissions this command needs. Have the operator provision `CLOUDFLARE_ACCESS_API_TOKEN` in the environment through a secret store or a user-only file outside the repo. Do not put the secret in command arguments, the JSON config, logs, or chat.

Scope this credential to the selected account, with:

- **Access: Apps and Policies — Edit**
- **Access: Organizations, Identity Providers, and Groups — Read**

The preview reads the organization, provider inventory, applications, and reusable policies. Any failed read stops setup. Successful reads do not prove write permission: a denied create stops apply and reports the failed operation. The command does not retry writes automatically. After correcting permissions, rerun it to reconcile already-created resources.

This is a setup credential, not the token for GitHub deployment. For optional GitHub Actions, provision `CLOUDFLARE_API_TOKEN` separately with permissions for the workflow's Worker deployment, D1 migrations, R2 access, and custom domains, scoped to the target account/zones; use Cloudflare's current permission reference when provisioning. Do not copy the Access-only token into deployment secrets. `CLOUDFLARE_ACCOUNT_ID` is the selected account's ID, not a zone ID.

## Preview the configuration

Save non-secret inputs in a local JSON file outside the repository:

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

## Apply and record the results

```sh
npm run setup:access -- --config /path/to/access-setup.json --apply
```

The command creates two reusable policies and two applications:

1. The entire hub hostname requires sign-in through the selected provider and allows only the listed emails. This covers `/admin` and future hub pages as well as `/tokens` and `/connect`.
2. A more-specific application bypasses Access for `/v1*`, `/health`, `/llms.txt`, `/auth.md`, `/favicon.svg`, and `/static*` on the hub.

No Access application is created on the content hostname. Apps use a 24-hour Access session; this is separate from API token lifetime and content retention.

The command reads back the application settings and prints non-secret resource IDs and `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`. Save this output with the deployment record and copy the two vars into `[vars]` in `wrangler.toml`. The AUD must belong to the hub app, not the bypass app. These vars require an Energon version that supports hostname Access JWT validation.

Rerunning with the same inputs reuses matching resources without writes. After an interrupted run, it discovers resources by their deterministic names; if settings differ, it stops for manual review. Do not run multiple installers for the same host concurrently. There is no automatic rollback: keep already-created IDs and resolve the reported conflict rather than deleting unrelated resources.

## Finish deployment and verify it

Return to [INSTALL.md](../INSTALL.md) for storage bindings, plugin generation, and both custom-domain routes. Apply migrations before deployment:

```sh
npx wrangler d1 migrations apply energon --remote
npx wrangler deploy
```

Only run these in the explicitly authorized account/fork. Keep preview deployments separate from production and retain migration history.

Verify anonymous hub and `/admin` requests redirect to Access, `/v1/help` is public, and `/v1/whoami` without a token returns 401. Public content must not redirect to Access. Complete a real human sign-in and confirm the hub email and admin page; health/help alone cannot prove authentication works. Finally connect an agent through `/auth.md`, have the human approve its code, publish a small site or file, and fetch its returned content URL without an API token. Check updates at the same URL and inspect the rendered page in a browser.

Cloudflare references: [API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [Access applications API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/), [Access policies API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/).
