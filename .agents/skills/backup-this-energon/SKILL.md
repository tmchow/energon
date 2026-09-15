---
name: backup-this-energon
description: Capture a restore point for this Energon's data (D1 Time Travel bookmark, optional D1 export, independent R2 copy). Use when asked to back up, snapshot, export D1, or copy R2 — with or without an upgrade. Does not restore. Does not deploy.
---

# Back up this Energon

This skill captures **data**. Recovery also needs the configured deployment repository and its private GitHub access; the public upstream alone cannot recreate company customizations. Catalog state lives in D1. Published bytes live in R2. Either side alone leaves incomplete links.

The long-form recovery contract and restore runbook are the checkout’s disaster-recovery / “Back up and restore D1 and R2” guide. This skill is the capture SOP. It does not walk restore.

An ordinary upgrade does not require this skill. Time Travel plus “do not pave live R2” is enough for that path (`update-from-upstream`).

## This Energon

Read `wrangler.toml`: `account_id` if set, D1 `database_name` / `database_id`, R2 `bucket_name`, both origins.

```
npx wrangler whoami
```

Inventory-match the deployed Worker’s D1 and R2 bindings to this file before any remote command (INSTALL.md “Inspect the account and resources”). A matching name is not ownership.

**Stop** if this checkout is still the unconfigured template: missing `account_id`, example origins, or a placeholder `database_id` (`00000000-0000-4000-8000-000000000001` or `PASTE_FROM_WRANGLER_D1_CREATE`). There is no live Energon here to copy.

Do not run interactive `wrangler login` in an unattended cloud agent.

## Hard stops

- Do not restore. No `wrangler d1 time-travel restore`. No R2 restore over the live bucket. No `d1 execute --remote --file` against production.
- Do not create, delete, empty, or rebind the live D1 or R2.
- Do not stamp `d1_migrations` or run ad hoc production SQL.
- Do not commit a D1 export. Token hashes, emails, and connection rows are in that SQL.
- Do not put the only D1 dump in the live content bucket (same failure domain).
- Do not `rclone sync` in a way that deletes backup objects missing from the source. Use `copy` to a timestamped destination.
- Do not invent a backup target. If they have no independent R2/S3 remote, say the generation is D1-only and incomplete.
- Do not claim “backed up” for a Time Travel bookmark alone when they asked for a durable copy of published files.

## 1. D1 bookmark (always)

Production-storage D1 already has Time Travel (any minute in the plan window). Record the current bookmark using this Energon’s database name:

```
npx wrangler d1 info <database_name>
npx wrangler d1 time-travel info <database_name>
```

Confirm `version` is production (Time Travel). Write down the bookmark, time, database name, and `database_id`. This is the cheap restore point for a recent catalog mistake. It is not a file you own, and it expires with the plan window.

## 2. D1 export (only if they asked, or need longer than Time Travel)

```
npx wrangler d1 export <database_name> --remote --output=<path-outside-the-repo>
```

A running export blocks other D1 requests. Treat the file as secret. Tell them where it is; do not paste it into chat. Copy it onward if it first landed next to the only R2 objects.

## 3. R2 copy (required for a complete generation)

R2 durability is not a backup. Deletes and overwrites are permanent. Cloudflare has no one-click bucket backup.

Walk an **independent** boundary (another account, another bucket with different credentials, or another provider). Example shape only — use their remotes:

```
rclone copy <live>:<bucket> <backup>:<bucket>/<timestamp> --metadata --checksum
rclone check <live>:<bucket> <backup>:<bucket>/<timestamp> --download
```

If they have no backup remote, stop after the bookmark (and optional export) and say the generation is **D1-only / incomplete**. Do not create a new live bucket to hold the copy.

## 4. Manifest

Record one generation: D1 bookmark and/or export path, R2 snapshot path, start/end time, object count, byte count, verification result, deployment repository coordinates, source commit, operator. Verify that the recovery operator can read the private repository containing the configured source and generated plugin. Record how Actions and Cloudflare credentials will be re-provisioned without copying their values into the manifest. A Git copy does not back up D1 or R2; a data generation alone does not preserve uncommitted source changes. A continuously changing Energon cannot promise a transactional D1-plus-R2 snapshot. If they need zero skew, they must pause mutating `/v1` first (see the disaster-recovery guide).

## Verify

You have the bookmark text. If they asked for a durable file copy, the export path is outside the repo and/or the R2 check passed. Nothing was restored. Live bindings are unchanged.
