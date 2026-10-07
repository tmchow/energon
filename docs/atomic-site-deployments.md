# Atomic site deployments

A deployment stages a complete replacement without changing the live site. Read the site's `content_generation`, create a session with that `expected_version` and a persisted `<unix-milliseconds>.<UUIDv4>` idempotency key, upload the declared inputs, prepare until ready, and explicitly commit. The complete OpenAPI contract is [openapi/v1.json](../openapi/v1.json); the agent playbook is [the skill template](../templates/skill/SKILL.md.tmpl).

A manifest lists every desired path, exact byte size, SHA-256, and content type. A ZIP descriptor instead declares archive size and SHA-256 plus optional expanded-byte and file-count ceilings. Public deployment sessions replace the file set; omitted paths disappear at commit. The compatibility import endpoint merges paths, returning 200 synchronously or a staged session with 202 when `Prefer: respond-async` is present.

Sessions expire after one hour. Persist the request identity and poll status after an uncertain response; retry the same intent or commit rather than creating another session. Committed receipts remain for seven days. A stale generation fails with a conflict. A whole-site grant binds an existing owned session and authorizes only its declared uploads, status, preparation, and commit. Ordinary expiry permits recovery of an existing receipt, while revocation blocks it.

Site URLs remain stable. `X-Energon-Site-Version` reports the immutable version selected for a read. This is not a request header for choosing history. Each request selects independently, so an HTML page and subsequent asset requests may span a commit. There is no page-wide pinning, history browser, or rollback API. List and detail responses expose `content_generation` and `version_id`.

## Storage and limits

Pending uploads and retained old versions count toward the platform quota. Allow room for the old and new versions together, plus archive inputs and extracted outputs. Superseded versions have a five-minute grace and remain retained while read leases are active. Cleanup releases charges only after storage deletion is confirmed; admin health exposes `quota.pending_cleanup_bytes` and `quota.cleanup_failed_allocations` for diagnosis. A quota recomputation must preserve these charges.

Publish a directory through one deployment session. Each compatibility per-file edit copies the complete site, including unchanged files. Repeated edits therefore need more temporary storage than a single deployment. The Hub uses one session for a folder. Cleanup is bounded to 50 allocations per sweep, so large backlogs can take several sweeps to drain. Each site read acquires a D1 lease, including internal-cache hits; cache hits save the R2 body read, not the database work.

ZIP limits are independent: input defaults to 100 MiB, expanded content to 500 MiB, and export to 25 MiB. Operators can set `MAX_ZIP_IMPORT_BYTES`, `MAX_ZIP_EXTRACTED_BYTES`, and `MAX_ZIP_EXPORT_BYTES`. An existing `MAX_ZIP_BYTES` supplies a compatibility fallback, preserving smaller configured caps unless explicitly overridden. Read `/v1/help` for effective values. File limits and the hosting plan's per-request body limit still apply. Sessions resume between inputs and preparation steps, not within a partial file upload.

## Migration and rollout

Apply the additive database migration before enabling versioned writers. Existing sites cross a conversion barrier: freeze their mutable catalog, copy it into a complete immutable version, and switch the active pointer only after preparation succeeds. Concurrent mutation must fail or retry at that barrier; it must not publish an incomplete baseline. Preserve legacy objects until the baseline no longer needs them and cleanup is safe.

Before rollout, purge or wait out old public site cache entries that bypass the Worker. Set `cache.cross_version_cache = false` for the rollout. New site responses use private/no-store outer caching; internal cache identities include the immutable version. An old edge response can otherwise serve pre-migration content without consulting the current pointer or deletion state. Keep loose-file cache behavior separate.

Release validation must include native D1 race tests, real Worker streaming uploads, concurrent publication and reads, interrupted preparation, cleanup retries, quota repair, and cache behavior. Local tests are not proof of deployed memory, CPU, R2 multipart quiescence, or edge-cache behavior. This document records the rollout requirements; it does not claim production verification.

### Deployed resource qualification

The 2026-10-07 disposable Workers Free run passed small atomic publication, real internal-cache hits, no-purge cutover, password gating, cache-unavailable fallback, and a legacy fixture conversion preserving an uncataloged path. It did not qualify large ZIPs: a 100 MiB stored archive upload and preparation of a 100 MiB entry in a 500 MiB expanded archive both terminated with Cloudflare error 1102 (`exceededCpu`). Invocation telemetry reported 1,063 ms and 912 ms of CPU respectively before termination. These observed termination times are not a promised Free-plan budget.

The same-day disposable Workers Paid run, configured with `limits.cpu_ms = 30000`, successfully uploaded, prepared, committed, and hash-verified an exact 100 MiB stored ZIP and a compressed ZIP expanding to five 100 MiB files (500 MiB total). Two concurrent preparations of 100 MiB entries also completed. Expanded content above 500 MiB and an entry above 100 MiB were rejected before publication. On the tested workers.dev endpoint, exactly 104,857,600 input bytes succeeded; 104,857,601 bytes received a Cloudflare ingress 413. Other ingress configurations must be checked separately.

Cloudflare's sampled invocation aggregates reported maximum API CPU of 9.21 seconds and memory of 42,102,708 bytes, and maximum content Worker CPU of 6.04 seconds and memory of 29,836,164 bytes. These are maximum reported measurements, not a guarantee about every allocation or workload. Two concurrent slow 100 MiB downloads were paused for 25 seconds; cache-fill leases had ended while visitor leases remained independently bounded. Large ZIP support is qualified on this Paid execution profile, not Workers Free.

The deployed bridge rehearsal warmed the old implementation to confirmed automatic edge-cache hits, admitted a delayed old writer, deployed the bridge at full traffic, and waited for the old writer's successful response before conversion. Without a purge, the stable URL returned the updated legacy body with private/no-store caching. Legacy writes remained blocked until conversion was enabled, and all eight conversion steps preserved the current body and an uncataloged file. This qualifies the disposable rollout mechanism; each production operator must still establish their own writer drain and inspect independent cache rules.

### Enabling legacy conversion

Keep `SITE_VERSIONING_ENABLED` unset during the bridge rollout. This keeps background conversion off; attempts to update nonempty legacy sites return retryable `site_busy` while their existing content remains readable. Empty new sites can publish immediately. Never route traffic simultaneously to old mutable writers and enabled versioned writers.

Apply migration `0024_site_deployments.sql`, deploy the new Worker to 100% of traffic, and establish that old writer invocations have ended before setting `[vars].SITE_VERSIONING_ENABLED = "true"`. Check deployment traffic allocation and account for the maximum lifetime of an already admitted upload; merely waiting for the deployment command to finish is insufficient. Bypass any independently configured cache rules and confirm Worker-version cache isolation. The deployed drain and cache checks remain release prerequisites.

Once enabled, each cron sweep converts up to five legacy sites within a shared budget of about 400 estimated D1/R2 calls, 8 MiB copied, and 10 seconds; a 60-file site converts in about four sweeps. The budget stays below the Workers Free limit of 1,000 internal-service calls per invocation. The admin Health view and `GET /v1/admin/health` expose `site_conversions.enabled`, the pending count, and up to 25 per-site phases/errors. **Sweep now** or `POST /v1/admin/sweep` resumes a bounded batch; repeated batches advance inventory, quota reservation, copy, and publication. A request to update a legacy site also advances conversion within a smaller budget (about 150 calls, 4 MiB, 5 seconds), then returns `site_busy`. A small site usually finishes converting in that request; the retry must use freshly read metadata because conversion increments the site's content generation. Errors leave existing content readable and retain the conversion state for retry. Resolve missing or ambiguous objects and insufficient quota before retrying. Do not delete allocation or conversion rows to clear an error.

After any site converts, this version-aware Worker is the rollback floor. Use a forward fix; rolling back to the old mutable layout would serve stale bytes. Disabling the conversion flag pauses new migration work but does not undo published versions.

The range ZIP reader rejects encrypted/unsupported compression entries, malformed paths and overlapping entries. It also bounds compressed input that produces no output to 128 KiB, rejecting pathological empty-block streams rather than retaining unbounded decoder state. These parsing bounds are independent of the advertised archive and expanded-byte limits.

### Diagnosing retained reservations

Loose-file writes share the quota ledger. A successful catalog change hands off its reservation in the same transaction. Known cleanup that has not started can be swept. An interrupted direct write or uncertain deletion remains charged and blocks further mutations of that file, so a late operation cannot overwrite or delete its replacement. Reads remain available subject to the normal access and expiry rules.

Inspect retained work with a read-only query against the configured database:

```sql
SELECT id, state, reserved_bytes, created_at, cleanup_error,
       cleanup_owner, recovery_json
FROM storage_allocations
WHERE kind = 'legacy_reservation' AND state != 'released'
ORDER BY created_at;
```

The recovery record identifies the file, target and cleanup keys, and any retained rollback snapshot. Do not delete the reservation or use its age as evidence that a writer has stopped. For uncertain operations, establish writer drain and reconcile the actual R2 objects with the current catalog before releasing the charge. A quota recomputation deliberately retains unresolved reservations. There is no automatic repair for a lost in-memory rollback snapshot.

### Publication integrity checks

After rollout and conversion batches, both queries must return no rows:

```sql
SELECT s.id, s.active_version_id, v.state
FROM sites s LEFT JOIN site_versions v ON v.id = s.active_version_id
WHERE s.lifecycle_state = 'live' AND s.active_version_id IS NOT NULL
  AND (v.id IS NULL OR v.site_id != s.id OR v.state != 'active');

SELECT s.id, f.path, f.allocation_id, a.state
FROM sites s JOIN site_version_files f ON f.version_id = s.active_version_id
LEFT JOIN storage_allocations a ON a.id = f.allocation_id
WHERE s.lifecycle_state = 'live'
  AND (a.id IS NULL OR a.state != 'stored' OR a.object_key != f.object_key
       OR a.actual_bytes IS NULL OR a.actual_bytes != f.size);
```

These checks establish catalog consistency, not object presence. Verify representative R2 bodies and hashes separately, and record deployed resource, cache, and writer-drain evidence before enabling conversion.
