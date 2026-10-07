import { ApiError, legacyQuotaStatement, storageCap, STORED_BYTES_SQL, type LegacyReservationRecovery } from "./http";
import { fileKey } from "./config";

export const VERSION_LEASE_MS = 120_000;
export const VERSION_GRACE_MS = 300_000;

export interface StorageAllocation {
  id: string;
  owner_id: string;
  site_id: string | null;
  version_id: string | null;
  deployment_id: string | null;
  object_key: string | null;
  multipart_id: string | null;
  reserved_bytes: number;
  actual_bytes: number | null;
  result_sha256?: string | null;
  state: string;
  attempt_id: string;
  cleanup_error?: string | null;
}

export async function reserveAllocation(db: D1Database, input: {
  ownerId: string; siteId?: string; versionId?: string; deploymentId?: string;
  kind: string; key: string; bytes: number; cap: number;
}, now = new Date()): Promise<StorageAllocation> {
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new Error("Invalid allocation size");
  const id = crypto.randomUUID();
  const attempt = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO storage_allocations
      (id, owner_id, site_id, version_id, deployment_id, kind, object_key, reserved_bytes, attempt_id, writer_expires_at, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM platform_quota WHERE id = 1 AND used + ? <= ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM sites WHERE id = ? AND lifecycle_state = 'live'))`)
      .bind(id, input.ownerId, input.siteId ?? null, input.versionId ?? null, input.deploymentId ?? null,
        input.kind, input.key, input.bytes, attempt, new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString(),
        input.bytes, input.cap, input.siteId ?? null, input.siteId ?? null),
    db.prepare(`UPDATE platform_quota SET used = used + ? WHERE id = 1
      AND EXISTS (SELECT 1 FROM storage_allocations WHERE id = ?)`)
      .bind(input.bytes, id),
  ]);
  const allocation = await db.prepare("SELECT * FROM storage_allocations WHERE id = ?").bind(id).first<StorageAllocation>();
  if (allocation) return allocation;
  const used = await db.prepare("SELECT used FROM platform_quota WHERE id = 1").first<{ used: number }>();
  if (!used) throw new Error("Storage ledger is unavailable");
  if (used.used + input.bytes > input.cap) throw storageCap(used.used, input.bytes, input.cap);
  throw new ApiError(409, "site_busy", "The site no longer accepts this upload.");
}

export async function markAllocationStored(db: D1Database, id: string, attempt: string, bytes: number, now = new Date(), sha256?: string): Promise<void> {
  const result = await db.prepare(`UPDATE storage_allocations SET state = 'stored', actual_bytes = ?, result_sha256 = ?, quiesced_at = ?
    WHERE id = ? AND attempt_id = ? AND state IN ('reserved', 'writing') AND writer_expires_at > ?
      AND reserved_bytes >= ?`).bind(bytes, sha256 ?? null, now.toISOString(), id, attempt, now.toISOString(), bytes).run();
  if (!result.meta.changes) throw new ApiError(409, "site_busy", "The upload attempt is no longer current.");
}

export async function writeAllocation(db: D1Database, bucket: R2Bucket, allocation: StorageAllocation,
  body: ReadableStream<Uint8Array>, expectedHash?: string, contentType = "application/octet-stream"):
  Promise<{ size: number; sha256: string }> {
  if (!allocation.object_key) throw new Error("Allocation has no object key");
  const multipart = await bucket.createMultipartUpload(allocation.object_key, { httpMetadata: { contentType } });
  const registered = await db.prepare(`UPDATE storage_allocations SET multipart_id = ?, state = 'writing', writer_expires_at = ?
    WHERE id = ? AND attempt_id = ? AND state = 'reserved' AND writer_expires_at > ?
    AND (deployment_id IS NULL OR EXISTS (SELECT 1 FROM site_deployments d WHERE d.id = deployment_id AND d.state = 'uploading' AND d.deadline > ?))`)
    .bind(multipart.uploadId, new Date(Date.now() + VERSION_LEASE_MS).toISOString(), allocation.id, allocation.attempt_id, new Date().toISOString(), new Date().toISOString()).run();
  if (!registered.meta.changes) {
    await multipart.abort();
    throw new ApiError(409, "site_busy", "The upload attempt expired before writing.");
  }
  const digest = new crypto.DigestStream("SHA-256");
  const hasher = digest.getWriter();
  const reader = body.getReader();
  const parts: R2UploadedPart[] = [];
  const buffer = new Uint8Array(5 * 1024 * 1024);
  let buffered = 0;
  let size = 0;
  async function heartbeat() {
    const now = new Date();
    const renewed = await db.prepare(`UPDATE storage_allocations SET writer_expires_at = ?
      WHERE id = ? AND attempt_id = ? AND state = 'writing' AND writer_expires_at > ?`)
      .bind(new Date(now.getTime() + VERSION_LEASE_MS).toISOString(), allocation.id, allocation.attempt_id, now.toISOString()).run();
    if (!renewed.meta.changes) throw new ApiError(409, "site_busy", "The upload attempt is no longer current.");
  }
  let heartbeatRunning = false;
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void heartbeat().catch(async error => {
      heartbeatError = error;
      await reader.cancel(error).catch(() => undefined);
    }).finally(() => { heartbeatRunning = false; });
  }, 30_000);
  try {
    for (;;) {
      if (heartbeatError) throw heartbeatError;
      const chunk = await reader.read();
      if (heartbeatError) throw heartbeatError;
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > allocation.reserved_bytes) throw new ApiError(400, "bad_request", "Upload exceeds its declared size.");
      await hasher.write(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const length = Math.min(buffer.length - buffered, chunk.value.byteLength - offset);
        buffer.set(chunk.value.subarray(offset, offset + length), buffered);
        offset += length;
        buffered += length;
        if (buffered === buffer.length) {
          await heartbeat();
          parts.push(await multipart.uploadPart(parts.length + 1, buffer));
          buffered = 0;
        }
      }
    }
    await hasher.close();
    const sha256 = Array.from(new Uint8Array(await digest.digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (size !== allocation.reserved_bytes) throw new ApiError(400, "bad_request", "Upload does not match its declared size.");
    if (expectedHash && sha256 !== expectedHash.toLowerCase()) throw new ApiError(400, "checksum_mismatch", "Upload does not match its declared SHA-256.");
    await heartbeat();
    if (buffered || parts.length === 0) parts.push(await multipart.uploadPart(parts.length + 1, buffer.subarray(0, buffered)));
    await multipart.complete(parts);
    await markAllocationStored(db, allocation.id, allocation.attempt_id, size, new Date(), sha256);
    return { size, sha256 };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await hasher.abort(error).catch(() => undefined);
    await digest.digest.catch(() => undefined);
    // Cleanup owns cancellation and charge release; a failed abort must remain visible.
    await cleanupAllocation(db, bucket, allocation.id, new Date(), allocation.attempt_id).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(timer);
    reader.releaseLock();
    hasher.releaseLock();
  }
}

export async function cleanupAllocation(db: D1Database, bucket: R2Bucket, id: string, now = new Date(), cancellingAttempt?: string): Promise<void> {
  const owner = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE storage_allocations SET state = 'deleting', cleanup_owner = ?, cleanup_started_at = ?
    WHERE id = ? AND state != 'released' AND kind != 'legacy_reservation'
      AND (state != 'writing' OR writer_expires_at <= ? OR attempt_id = ?)
      AND (cleanup_owner IS NULL OR cleanup_started_at <= ?)
      AND (NOT EXISTS (SELECT 1 FROM site_version_files WHERE allocation_id = storage_allocations.id)
        OR EXISTS (SELECT 1 FROM site_versions WHERE id = version_id AND state = 'retiring'))`)
    .bind(owner, now.toISOString(), id, now.toISOString(), cancellingAttempt ?? "", new Date(now.getTime() - VERSION_LEASE_MS).toISOString()).run();
  if (!claimed.meta.changes) return;
  const allocation = await db.prepare("SELECT * FROM storage_allocations WHERE id = ? AND cleanup_owner = ?")
    .bind(id, owner).first<StorageAllocation>();
  if (!allocation) return;
  try {
    if (allocation.multipart_id && allocation.object_key) {
      try { await bucket.resumeMultipartUpload(allocation.object_key, allocation.multipart_id).abort(); }
      catch (error) {
        // Only a confirmed absent upload is quiescent; transport errors retain the charge.
        if (!/NoSuchUpload|10024/.test(String(error))) throw error;
      }
    }
    if (allocation.object_key) await bucket.delete(allocation.object_key);
    await db.batch([
      db.prepare(`UPDATE storage_allocations SET state = 'released', deleted_at = ?, released_at = ?, cleanup_error = NULL
        WHERE id = ? AND state = 'deleting' AND cleanup_owner = ?`)
        .bind(now.toISOString(), now.toISOString(), id, owner),
      db.prepare(`UPDATE platform_quota SET used = ${STORED_BYTES_SQL} WHERE id = 1
        AND EXISTS (SELECT 1 FROM storage_allocations WHERE id = ? AND state = 'released' AND cleanup_owner = ?)`)
        .bind(id, owner),
    ]);
  } catch (error) {
    await db.prepare("UPDATE storage_allocations SET cleanup_owner = NULL, cleanup_error = ? WHERE id = ? AND cleanup_owner = ? AND state = 'deleting'")
      .bind(String(error).slice(0, 1000), id, owner).run();
    throw error;
  }
}

export interface VersionLease { id: string; versionId: string; generation: string }

export async function acquireVersionLease(db: D1Database, versionId: string, operation: string, now = new Date()): Promise<VersionLease> {
  const lease = { id: crypto.randomUUID(), versionId, generation: crypto.randomUUID() };
  const result = await db.prepare(`INSERT INTO site_operation_leases (id, version_id, operation, generation, expires_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_versions WHERE id = ? AND state IN ('active', 'superseded', 'sealed'))`)
    .bind(lease.id, versionId, operation, lease.generation, new Date(now.getTime() + VERSION_LEASE_MS).toISOString(), versionId).run();
  if (!result.meta.changes) throw new ApiError(409, "site_busy", "The selected site version is no longer readable.");
  return lease;
}

export async function renewVersionLease(db: D1Database, lease: VersionLease, now = new Date()): Promise<boolean> {
  const result = await db.prepare(`UPDATE site_operation_leases SET expires_at = ?
    WHERE id = ? AND generation = ? AND expires_at > ?
      AND EXISTS (SELECT 1 FROM site_versions WHERE id = version_id AND state IN ('active', 'superseded', 'sealed'))`)
    .bind(new Date(now.getTime() + VERSION_LEASE_MS).toISOString(), lease.id, lease.generation, now.toISOString()).run();
  return result.meta.changes > 0;
}

export async function releaseVersionLease(db: D1Database, lease: VersionLease): Promise<void> {
  await db.prepare("DELETE FROM site_operation_leases WHERE id = ? AND generation = ?").bind(lease.id, lease.generation).run();
}

export async function retireVersion(db: D1Database, versionId: string, now = new Date()): Promise<boolean> {
  if (versionId.startsWith("legacy:")) return false;
  await db.prepare(`UPDATE site_versions SET state = 'superseded', superseded_at = ? WHERE id = ? AND state = 'active'
    AND NOT EXISTS (SELECT 1 FROM sites WHERE active_version_id = site_versions.id)`)
    .bind(now.toISOString(), versionId).run();
  const result = await db.prepare(`UPDATE site_versions SET state = 'retiring' WHERE id = ?
    AND state = 'superseded' AND superseded_at <= ?
    AND NOT EXISTS (SELECT 1 FROM sites WHERE active_version_id = site_versions.id)
    AND NOT EXISTS (SELECT 1 FROM site_operation_leases WHERE version_id = site_versions.id AND expires_at > ?)`)
    .bind(versionId, new Date(now.getTime() - VERSION_GRACE_MS).toISOString(), now.toISOString()).run();
  return result.meta.changes > 0;
}

export function startVersionLeaseHeartbeat(db: D1Database, lease: VersionLease, onLost?: (error: unknown) => void): {
  assertActive(): void; stop(): void;
} {
  let failure: unknown;
  let stopped = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (stopped || renewing || failure) return;
    renewing = true;
    void renewVersionLease(db, lease).then(valid => {
      if (!valid) throw new Error("Version read lease expired");
    }).catch(error => {
      failure = error;
      clearInterval(timer);
      onLost?.(error);
    }).finally(() => { renewing = false; });
  }, 30_000);
  return {
    assertActive() { if (failure) throw failure; },
    stop() { stopped = true; clearInterval(timer); },
  };
}

export function leaseVersionStream(db: D1Database, lease: VersionLease, body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const finish = async (error?: unknown) => {
    if (ended) return;
    ended = true;
    heartbeat.stop();
    if (error) {
      controller.error(error);
      await reader.cancel(error).catch(() => undefined);
    }
    await releaseVersionLease(db, lease).catch(error => console.error("Version lease release pending", lease.id, error));
  };
  const heartbeat = startVersionLeaseHeartbeat(db, lease, error => { void finish(error); });
  return new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    async pull() {
      try {
        heartbeat.assertActive();
        const result = await reader.read();
        if (ended) return;
        heartbeat.assertActive();
        if (result.done) {
          await finish();
          controller.close();
        } else controller.enqueue(result.value);
      } catch (error) { await finish(error); }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await finish();
    },
  });
}

export async function sweepLegacyReservations(db: D1Database, bucket: R2Bucket, now = new Date()): Promise<void> {
  // Direct PUTs have no cancellation handle. Age is diagnostic evidence, never proof of quiescence.
  await db.prepare(`UPDATE storage_allocations SET cleanup_error =
    'Uncertain loose-file write; confirm writer drain and reconcile recorded keys before releasing quota.'
    WHERE kind = 'legacy_reservation' AND state != 'released' AND cleanup_error IS NULL
    AND (state != 'cleanup_pending' OR cleanup_owner IS NOT NULL)
    AND (writer_expires_at <= ? OR recovery_json IS NULL)`).bind(now.toISOString()).run();
  const pending = (await db.prepare(`SELECT id FROM storage_allocations
    WHERE kind = 'legacy_reservation' AND state = 'cleanup_pending' AND quiesced_at IS NOT NULL
    AND cleanup_owner IS NULL ORDER BY created_at LIMIT 50`)
    .all<{ id: string }>()).results;
  for (const allocation of pending) {
    await cleanupLegacyReservation(db, bucket, allocation.id, now).catch(error => console.error("Loose-file cleanup pending", allocation.id, error));
  }
}

export async function cleanupLegacyReservation(db: D1Database, bucket: R2Bucket, id: string, now = new Date(), heldClaim?: string): Promise<void> {
  const owner = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE storage_allocations SET cleanup_owner = ?, cleanup_started_at = ?
    WHERE id = ? AND kind = 'legacy_reservation' AND state = 'cleanup_pending' AND quiesced_at IS NOT NULL
    AND cleanup_owner IS NULL`)
    .bind(owner, now.toISOString(), id).run();
  if (!claimed.meta.changes) return;
  let deleteStarted = false;
  let fileClaim: { id: string; token: string; writer: string | null; updatedAt: string | null } | undefined;
  try {
    const allocation = await db.prepare("SELECT recovery_json FROM storage_allocations WHERE id = ? AND cleanup_owner = ?")
      .bind(id, owner).first<{ recovery_json: string | null }>();
    const recovery: LegacyReservationRecovery | null = allocation?.recovery_json ? JSON.parse(allocation.recovery_json) : null;
    if (!recovery?.fileId || !recovery.cleanupKey) throw new Error("Reservation lacks cleanup identity; manual reconciliation required.");
    const row = await db.prepare("SELECT filename, last_written_by, updated_at FROM loose_files WHERE id = ?")
      .bind(recovery.fileId).first<{ filename: string; last_written_by: string | null; updated_at: string | null }>();
    const otherReservation = await db.prepare(`SELECT id FROM storage_allocations WHERE kind = 'legacy_reservation'
      AND state != 'released' AND id != ? AND json_extract(recovery_json, '$.fileId') = ? LIMIT 1`)
      .bind(id, recovery.fileId).first();
    if (otherReservation) throw new Error("Another unresolved write targets this file; reconcile it before cleanup.");
    if (row) {
      if (fileKey(recovery.fileId, row.filename) === recovery.cleanupKey) throw new Error("Cleanup key is current published content; manual reconciliation required.");
      const { isWriteClaimed, isPurgeClaimed, newWriteToken } = await import("./expire");
      // The quiesced handoff may outlive its publisher; only its exact recorded claim can be recovered.
      const publishingClaim = recovery.operation === "replace" && row.last_written_by === recovery.claimToken;
      if (!publishingClaim && row.last_written_by !== heldClaim && (isWriteClaimed(row.last_written_by) || isPurgeClaimed(row.last_written_by))) throw new Error("File mutation is still claimed; retry cleanup later.");
      if (row.last_written_by !== heldClaim) {
        const token = newWriteToken();
        const locked = await db.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ?
          WHERE id = ? AND filename = ? AND last_written_by IS ? AND updated_at IS ?`)
          .bind(token, now.toISOString(), recovery.fileId, row.filename, row.last_written_by, row.updated_at).run();
        if (!locked.meta.changes) throw new Error("File changed before cleanup; retry later.");
        fileClaim = { id: recovery.fileId, token, writer: row.last_written_by, updatedAt: row.updated_at };
      }
    }
    deleteStarted = true;
    await bucket.delete(recovery.cleanupKey);
    await db.batch([
      db.prepare(`UPDATE storage_allocations SET state = 'released', released_at = ?, deleted_at = ?, cleanup_error = NULL
        WHERE id = ? AND cleanup_owner = ? AND state = 'cleanup_pending'`)
        .bind(now.toISOString(), now.toISOString(), id, owner),
      legacyQuotaStatement(db),
    ]);
  } catch (error) {
    await db.prepare(`UPDATE storage_allocations SET cleanup_owner = ?, state = ?, cleanup_error = ?
      WHERE id = ? AND cleanup_owner = ? AND state != 'released'`)
      .bind(deleteStarted ? owner : null, deleteStarted ? "uncertain" : "cleanup_pending",
        String(error).slice(0, 1000), id, owner).run();
    throw error;
  } finally {
    if (fileClaim) await db.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ? AND last_written_by = ?`)
      .bind(fileClaim.writer, fileClaim.updatedAt, fileClaim.id, fileClaim.token).run();
  }
}

export async function storageCleanupStatus(db: D1Database): Promise<{ pendingBytes: number; failedAllocations: number }> {
  const row = await db.prepare(`SELECT COALESCE(SUM(reserved_bytes), 0) AS pendingBytes,
    COUNT(CASE WHEN cleanup_error IS NOT NULL THEN 1 END) AS failedAllocations
    FROM storage_allocations WHERE state != 'released' AND (state = 'deleting' OR kind = 'legacy_reservation')`)
    .first<{ pendingBytes: number; failedAllocations: number }>();
  return row ?? { pendingBytes: 0, failedAllocations: 0 };
}

export async function sweepSiteStorage(db: D1Database, bucket: R2Bucket, now = new Date()): Promise<void> {
  await sweepLegacyReservations(db, bucket, now);
  const ts = now.toISOString();
  const versions = (await db.prepare(`SELECT id FROM site_versions v WHERE v.id NOT LIKE 'legacy:%' AND (
    (state = 'superseded' AND superseded_at <= ?)
    OR (state = 'active' AND NOT EXISTS (SELECT 1 FROM sites WHERE active_version_id = v.id))
    OR (state IN ('candidate', 'sealed') AND (NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = v.site_id AND s.lifecycle_state IN ('live', 'creating'))
      OR EXISTS (SELECT 1 FROM site_deployments d WHERE d.version_id = v.id AND
      (d.deadline <= ? OR d.state IN ('aborted', 'expired', 'failed'))))))
    ORDER BY created_at LIMIT 50`).bind(new Date(now.getTime() - VERSION_GRACE_MS).toISOString(), ts).all<{ id: string }>()).results;
  for (const { id } of versions) {
    await retireVersion(db, id, now);
    await db.prepare(`UPDATE site_versions SET state = 'retiring' WHERE id = ? AND state IN ('candidate', 'sealed')
      AND NOT EXISTS (SELECT 1 FROM sites WHERE active_version_id = site_versions.id)
      AND (NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = site_versions.site_id AND s.lifecycle_state IN ('live', 'creating'))
        OR EXISTS (SELECT 1 FROM site_deployments WHERE version_id = site_versions.id
        AND (deadline <= ? OR state IN ('aborted', 'expired', 'failed'))))
      AND NOT EXISTS (SELECT 1 FROM site_operation_leases WHERE version_id = site_versions.id AND expires_at > ?)`)
      .bind(id, ts, ts).run();
  }
  const allocations = (await db.prepare(`SELECT a.id FROM storage_allocations a WHERE a.state != 'released'
    AND a.kind != 'legacy_reservation'
    AND NOT EXISTS (SELECT 1 FROM storage_allocations r WHERE r.kind = 'legacy_reservation' AND r.state != 'released'
      AND json_extract(r.recovery_json, '$.snapshotKey') = a.object_key) AND (
      a.state = 'deleting' OR EXISTS (SELECT 1 FROM site_versions v WHERE v.id = a.version_id AND v.state = 'retiring')
      OR (a.deployment_id IS NOT NULL AND EXISTS (SELECT 1 FROM site_deployments d WHERE d.id = a.deployment_id
        AND (d.deadline <= ? OR d.state IN ('aborted', 'expired', 'failed', 'committed')))
        AND NOT EXISTS (SELECT 1 FROM site_version_files f WHERE f.allocation_id = a.id))
      OR (a.deployment_id IS NULL AND a.version_id IS NULL AND a.created_at <= ?))
    ORDER BY COALESCE(a.cleanup_started_at, a.created_at) LIMIT 50`).bind(ts, new Date(now.getTime() - 3_600_000).toISOString()).all<{ id: string }>()).results;
  for (const { id } of allocations) {
    await cleanupAllocation(db, bucket, id, now).catch(error => console.error("Allocation cleanup pending", id, error));
  }
  await db.prepare(`DELETE FROM site_operation_leases WHERE id IN (SELECT id FROM site_operation_leases WHERE expires_at <= ? LIMIT 100)`).bind(ts).run();
  const retired = (await db.prepare(`SELECT id FROM site_versions WHERE state = 'retiring' AND id NOT LIKE 'legacy:%'
    AND NOT EXISTS (SELECT 1 FROM storage_allocations a WHERE a.version_id = site_versions.id AND a.state != 'released') LIMIT 50`)
    .all<{ id: string }>()).results;
  for (const { id } of retired) {
    await db.batch([
      db.prepare("DELETE FROM site_version_files WHERE version_id = ?").bind(id),
      db.prepare("UPDATE site_versions SET state = 'retired' WHERE id = ? AND state = 'retiring'").bind(id),
    ]);
  }
}
