---
title: Legacy schema upgrades must add columns before indexes
date: 2026-09-01
category: database-issues
module: database schema initialization
problem_type: database_issue
component: database
symptoms:
  - "Schema initialization fails with SQLite errors for missing owner_id, expires_at, or write_policy columns."
  - "Routes using a supported pre-0006 schema remain unavailable because ensureSchema stops before adding columns."
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - "legacy-schema"
  - "schema-upgrade"
  - "index-ordering"
---

# Legacy schema upgrades must add columns before indexes

## Problem

Energon supports upgrading databases whose tables were created through migration 0005. Those tables do not yet have the columns added by migrations 0006, 0009, and 0010. The schema bootstrap attempted every `CREATE INDEX` statement before its legacy-column checks, so an index referencing a missing column aborted the upgrade.

## Symptoms

- A request or scheduled run against a supported older database fails with a SQLite `no such column` error.
- The failure repeats because the column additions are never reached.

## What Didn't Work

Running all idempotent `CREATE TABLE` and `CREATE INDEX` statements in one list did not make the upgrade safe. `CREATE INDEX IF NOT EXISTS` is only idempotent when the index already exists; it still validates referenced columns when the index is missing.

## Solution

`ensureSchema` now executes three ordered phases in `src/db.ts:1-84` and `src/db.ts:88-113`:

1. Create missing tables.
2. For a database with an existing `tokens` table, add the known legacy columns.
3. Create indexes after the column phase completes.

The `columnsReady && existing` guard preserves the existing cache invariant: a fresh database is always initialized, even when the module-level cache was set by another runtime database, while a successfully upgraded database avoids repeated work.

The regression in `test/unit/db.spec.ts:4-81` models the documented migration-0005 table shapes, verifies the missing columns are added, and verifies indexes that depend on those columns are created.

## Why This Works

SQLite validates every column named by a new index. Separating index statements from table statements makes the dependency explicit: `ALTER TABLE` can establish each missing column before SQLite validates `idx_sites_owner`, `idx_sites_expires_at`, `idx_loose_files_owner`, and the other derived indexes. The upgrade remains additive, so existing rows and the migration-0005 primary-key shape are not rebuilt.

## Prevention

- Keep schema bootstrap statements grouped by dependency order: tables, additive column upgrades, then indexes.
- Maintain a regression fixture for each supported legacy boundary and assert both upgraded columns and dependent indexes.
- Preserve fresh-database and cached-database paths separately in tests; module-level readiness state must not suppress initialization for a different database.

## Related Issues

- `migrations/0006_users.sql`, `migrations/0009_expires_at.sql`, and `migrations/0010_write_policy.sql` document the additive column boundaries represented by this test.
