import { PURGE_CLAIM_LIKE, WRITE_CLAIM_LIKE } from "./expire";
import { contentTypeFor } from "./mime";
import { MAX_IMPORT_FILES } from "./config";
import { normalizeRelPath, sha256Hex } from "./http";
import { OWNER_WRITE_SQL, ownerWriteBinds } from "./policy";
import { GRANT_LEASE_SQL, grantLeaseBinds, type GrantGuard } from "./grant-guard";
import type { Actor, DeploymentIntent, DeploymentReceipt, SiteDeploymentRow, SiteVersionFileRow } from "./types";

const HOUR = 3_600_000;
const RECEIPT_LIFETIME = 7 * 24 * HOUR;
const IDEMPOTENCY_KEY = /^(0|[1-9]\d{0,15})\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export class DeploymentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DeploymentError";
  }
}

export function canonicalDeploymentIntent(intent: DeploymentIntent): string {
  return canonicalIntent(intent, MAX_IMPORT_FILES);
}

function canonicalIntent(intent: DeploymentIntent, maxFiles: number): string {
  if (!intent || !["replace", "merge"].includes(intent.mode)) throw new DeploymentError("invalid_intent", "Invalid deployment mode.");
  if (intent.archive) {
    if (intent.files !== undefined || !Number.isSafeInteger(intent.archive.size) || intent.archive.size < 0 ||
        !SHA256.test(intent.archive.sha256) || !Number.isSafeInteger(intent.archive.maxExtractedBytes) || intent.archive.maxExtractedBytes < 0 ||
        !Number.isSafeInteger(intent.archive.maxFiles) || intent.archive.maxFiles < 1 || intent.archive.maxFiles > MAX_IMPORT_FILES) {
      throw new DeploymentError("invalid_intent", "Invalid archive declaration.");
    }
    return JSON.stringify({ mode: intent.mode, archive: { size: intent.archive.size, sha256: intent.archive.sha256,
      maxExtractedBytes: intent.archive.maxExtractedBytes, maxFiles: intent.archive.maxFiles } });
  }
  if (!Array.isArray(intent.files) || intent.files.length > maxFiles) throw new DeploymentError("invalid_intent", "Invalid manifest size.");
  const paths = new Set<string>();
  const files = intent.files.map(file => {
    if (typeof file.path !== "string" || !file.path || file.path.length > 1024 || normalizeRelPath(file.path) !== file.path ||
        paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !SHA256.test(file.sha256) ||
        typeof file.contentType !== "string" || !file.contentType || file.contentType.length > 256 || /[\r\n]/.test(file.contentType)) {
      throw new DeploymentError("invalid_intent", "Invalid or duplicate manifest path.");
    }
    paths.add(file.path);
    return { path: file.path, size: file.size, sha256: file.sha256, contentType: file.contentType };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!Number.isSafeInteger(files.reduce((sum, file) => sum + file.size, 0))) throw new DeploymentError("invalid_intent", "Manifest is too large.");
  return JSON.stringify({ mode: intent.mode, files });
}

export async function getDeployment(db: D1Database, id: string): Promise<SiteDeploymentRow | null> {
  return db.prepare("SELECT * FROM site_deployments WHERE id = ?").bind(id).first<SiteDeploymentRow>();
}

export async function createDeployment(db: D1Database, input: {
  siteId: string; ownerId: string; baseGeneration: number; idempotencyKey: string; intent: DeploymentIntent; allowHidden?: boolean;
}, now = new Date()): Promise<SiteDeploymentRow> {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || !Number.isSafeInteger(input.baseGeneration) || input.baseGeneration < 0) {
    throw new DeploymentError("invalid_intent", "Invalid retry identity or base generation.");
  }
  const canonical = canonicalDeploymentIntent(input.intent);
  const hash = await sha256Hex(JSON.stringify({ baseGeneration: input.baseGeneration, intent: JSON.parse(canonical) }));
  const lookup = () => db.prepare("SELECT * FROM site_deployments WHERE owner_id = ? AND site_id = ? AND idempotency_key = ?")
    .bind(input.ownerId, input.siteId, input.idempotencyKey).first<SiteDeploymentRow>();
  const existing = await lookup();
  if (existing) return matchingRetry(existing, hash, now);
  const timestamp = Number(input.idempotencyKey.split(".")[0]);
  if (!Number.isSafeInteger(timestamp) || timestamp < now.getTime() - HOUR || timestamp > now.getTime() + 300_000) {
    throw new DeploymentError("idempotency_expired", "The retry identity is outside its creation window.");
  }
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const ts = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO site_deployments (id, site_id, owner_id, version_id, base_generation, mode, input_json, intent_hash,
      idempotency_key, created_at, deadline) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM sites WHERE id = ? AND (lifecycle_state = 'live' OR (? = 1 AND lifecycle_state = 'creating'))
        AND conversion_state != 'converting'
        AND content_generation = ? AND (expires_at IS NULL OR expires_at > ?))
      ON CONFLICT(owner_id, site_id, idempotency_key) DO NOTHING`)
      .bind(id, input.siteId, input.ownerId, versionId, input.baseGeneration, input.intent.mode, canonical, hash,
        input.idempotencyKey, ts, new Date(now.getTime() + HOUR).toISOString(), input.siteId, input.allowHidden ? 1 : 0, input.baseGeneration, ts),
    db.prepare(`INSERT INTO site_versions (id, site_id, created_at)
      SELECT version_id, site_id, created_at FROM site_deployments WHERE id = ?`).bind(id),
  ]);
  const created = await lookup();
  if (!created) throw new DeploymentError("deployment_conflict", "The site is unavailable or its generation changed.");
  return matchingRetry(created, hash, now);
}

function matchingRetry(row: SiteDeploymentRow, hash: string, now: Date): SiteDeploymentRow {
  if (row.intent_hash !== hash) throw new DeploymentError("idempotency_conflict", "The retry identity already names another intent.");
  if (row.receipt_expires_at && row.receipt_expires_at <= now.toISOString()) throw new DeploymentError("idempotency_expired", "The receipt has expired.");
  return row;
}

export async function recordDeploymentFile(db: D1Database, deploymentId: string, file: SiteVersionFileRow, now = new Date(), actor?: DeploymentAuthority): Promise<void> {
  const auth = preparationAuthority(actor, now.toISOString());
  const result = await db.prepare(`INSERT INTO site_version_files (version_id, path, allocation_id, object_key, size, sha256, content_type)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM site_deployments d JOIN site_versions v ON v.id = d.version_id
      JOIN storage_allocations a ON a.id = ? WHERE d.id = ? AND d.version_id = ?
      AND d.state = 'uploading' AND d.deadline > ? AND v.state = 'candidate'
      AND a.version_id = v.id AND a.deployment_id = d.id AND a.object_key = ? AND a.actual_bytes = ? AND a.state = 'stored' AND ${auth.sql})
    ON CONFLICT(version_id, path) DO NOTHING`).bind(file.version_id, file.path, file.allocation_id, file.object_key,
      file.size, file.sha256, file.content_type, file.allocation_id, deploymentId, file.version_id, now.toISOString(), file.object_key, file.size, ...auth.binds).run();
  if (!result.meta.changes) {
    const existing = await db.prepare(`SELECT f.* FROM site_version_files f JOIN site_deployments d ON d.version_id = f.version_id WHERE f.version_id = ? AND f.path = ? AND d.id = ? AND ${auth.sql}`)
      .bind(file.version_id, file.path, deploymentId, ...auth.binds).first<SiteVersionFileRow>();
    if (!existing || Object.keys(file).some(key => existing[key as keyof SiteVersionFileRow] !== file[key as keyof SiteVersionFileRow])) {
      throw new DeploymentError("deployment_conflict", "The file cannot be recorded.");
    }
  }
}

export async function sealDeployment(db: D1Database, id: string, now = new Date(), actor?: DeploymentAuthority, compatibilityBaseVersionId?: string): Promise<void> {
  const auth = preparationAuthority(actor, now.toISOString());
  const deployment = await getDeployment(db, id);
  if (!deployment) throw new DeploymentError("deployment_missing", "Deployment not found.");
  if (deployment.deadline <= now.toISOString()) throw new DeploymentError("deployment_expired", "Preparation deadline has passed.");
  if (deployment.state === "ready") return;
  const intent: DeploymentIntent = JSON.parse(deployment.input_json);
  let maxFiles = MAX_IMPORT_FILES;
  // Only trusted snapshot writers may preserve an already over-limit baseline.
  if (compatibilityBaseVersionId && intent.mode === "merge" && (intent.archive || intent.files?.length === 0)) {
    const baseline = await db.prepare(`SELECT COUNT(f.path) AS count FROM sites s JOIN site_version_files f ON f.version_id = s.active_version_id
      WHERE s.id = ? AND s.active_version_id = ? AND s.content_generation = ?`)
      .bind(deployment.site_id, compatibilityBaseVersionId, deployment.base_generation).first<{ count: number }>();
    maxFiles = Math.max(maxFiles, baseline?.count ?? 0);
  }
  const files = (await db.prepare("SELECT * FROM site_version_files WHERE version_id = ? ORDER BY path LIMIT ?")
    .bind(deployment.version_id, maxFiles + 1).all<SiteVersionFileRow>()).results;
  const manifest = files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256, contentType: file.content_type }));
  const byPath = new Map(manifest.map(file => [file.path, file]));
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const actual = canonicalIntent({ mode: deployment.mode, files: manifest }, maxFiles);
  if (intent.archive) await validateArchiveCandidate(db, deployment, intent.archive, files);
  else if (intent.mode === "replace" ? actual !== deployment.input_json : intent.files!.some(file => {
        const row = byPath.get(file.path);
        return !row || row.size !== file.size || row.sha256 !== file.sha256 || row.contentType !== file.contentType;
      })) {
    throw new DeploymentError("deployment_incomplete", "Candidate does not match the declared input.");
  }
  const hash = await sha256Hex(actual);
  await db.batch([
    db.prepare(`UPDATE site_versions SET state = 'sealed', manifest_hash = ?, file_count = ?, total_bytes = ?, sealed_at = ?
      WHERE id = ? AND state = 'candidate' AND (SELECT COUNT(*) FROM site_version_files WHERE version_id = ?) = ?
      AND EXISTS (SELECT 1 FROM site_deployments d WHERE id = ? AND state = 'uploading' AND deadline > ? AND ${auth.sql})`)
      .bind(hash, files.length, total, now.toISOString(), deployment.version_id, deployment.version_id, files.length, id, now.toISOString(), ...auth.binds),
    db.prepare(`UPDATE site_deployments SET state = 'ready' WHERE id = ? AND state = 'uploading' AND deadline > ?
      AND EXISTS (SELECT 1 FROM site_versions WHERE id = version_id AND state = 'sealed' AND manifest_hash = ?)`)
      .bind(id, now.toISOString(), hash),
  ]);
  if ((await getDeployment(db, id))?.state !== "ready") throw new DeploymentError("deployment_conflict", "Candidate changed while sealing.");
}

async function validateArchiveCandidate(db: D1Database, deployment: SiteDeploymentRow,
  archive: NonNullable<DeploymentIntent["archive"]>, files: SiteVersionFileRow[]): Promise<void> {
  const progress: { index: { entries: Array<{ path: string; size: number }> }; next: number;
    copies: Array<{ path: string; size: number; content_type: string; sha256?: string }>; copyNext: number } | null =
    deployment.prepare_cursor ? JSON.parse(deployment.prepare_cursor) : null;
  if (!progress || progress.next !== progress.index.entries.length || progress.copyNext !== progress.copies.length ||
      progress.index.entries.length > archive.maxFiles ||
      progress.index.entries.reduce((sum, entry) => sum + entry.size, 0) > archive.maxExtractedBytes)
    throw new DeploymentError("deployment_incomplete", "Archive preparation is incomplete.");
  const expected = new Map<string, { size: number; contentType: string; sha256?: string }>([
    ...progress.index.entries.map(entry => [entry.path, { size: entry.size, contentType: contentTypeFor(entry.path, new Uint8Array()) }] as const),
    ...progress.copies.map(file => [file.path, { size: file.size, contentType: file.content_type, sha256: file.sha256 }] as const),
  ]);
  const receipts = (await db.prepare(`SELECT id, result_sha256 FROM storage_allocations
    WHERE deployment_id = ? AND version_id = ? AND state = 'stored'`)
    .bind(deployment.id, deployment.version_id).all<{ id: string; result_sha256: string }>()).results;
  const hashes = new Map(receipts.map(receipt => [receipt.id, receipt.result_sha256]));
  if (expected.size !== progress.index.entries.length + progress.copies.length ||
      (deployment.mode === "replace" && progress.copies.length !== 0) || files.length !== expected.size || files.some(file => {
    const entry = expected.get(file.path);
    return !entry || entry.size !== file.size || entry.contentType !== file.content_type ||
      (entry.sha256 !== undefined && entry.sha256 !== file.sha256) || hashes.get(file.allocation_id) !== file.sha256;
  })) throw new DeploymentError("deployment_incomplete", "Candidate does not match the prepared archive.");
}

function preparationAuthority(actor: DeploymentAuthority | undefined, now: string): { sql: string; binds: unknown[] } {
  if (!actor) return { sql: "1 = 1", binds: [] };
  const auth = authorityPredicate(actor, now);
  const writeSql = actor.writePasswordHash ? "s.write_password_hash = ?" : OWNER_WRITE_SQL.replace(/\b(write_policy|owner_id|created_by)\b/g, "s.$1");
  const writeBinds = actor.writePasswordHash ? [actor.writePasswordHash] : ownerWriteBinds(actor);
  return { sql: `${auth.sql} AND EXISTS (SELECT 1 FROM sites s WHERE s.id = d.site_id AND s.lifecycle_state = 'live'
    AND (s.expires_at IS NULL OR s.expires_at > ?) AND ${writeSql})`, binds: [...auth.binds, now, ...writeBinds] };
}

export type DeploymentAuthority = Actor & { grantId?: string; writePasswordHash?: string; legacyGrant?: GrantGuard; writtenVia?: string; activateHidden?: boolean };

function authorityPredicate(actor: DeploymentAuthority, now: string, receipt = false): { sql: string; binds: unknown[] } {
  if (actor.legacyGrant) return { sql: GRANT_LEASE_SQL, binds: grantLeaseBinds(actor.legacyGrant, new Date(now)) };
  if (actor.via === "grant") {
    return { sql: `EXISTS (SELECT 1 FROM upload_grants g JOIN tokens t ON t.id = g.token_id
      WHERE g.id = ? AND g.target_kind = 'site_deployment' AND g.deployment_id = d.id AND g.site_id = d.site_id
      AND g.deployment_intent_hash = d.intent_hash AND g.deployment_base_generation = d.base_generation
      AND t.revoked_at IS NULL AND g.state != 'revoked' ${receipt ? "" : "AND g.state = 'unused' AND g.expires_at > ? AND (t.expires_at IS NULL OR t.expires_at > ?)"}
      AND t.user_email = ? AND (t.user_id IS NULL OR t.user_id = ?))`,
    binds: receipt ? [actor.grantId ?? "", actor.email, actor.userId ?? null] : [actor.grantId ?? "", now, now, actor.email, actor.userId ?? null] };
  }
  if (actor.via === "token") {
    return { sql: `EXISTS (SELECT 1 FROM tokens t WHERE t.id = ? AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > ?) AND t.user_email = ? AND (t.user_id IS NULL OR t.user_id = ?))`,
    binds: [actor.tokenId ?? "", now, actor.email, actor.userId ?? null] };
  }
  return { sql: "1 = 1", binds: [] };
}

export async function commitDeployment(db: D1Database, id: string, actor: DeploymentAuthority, resultUrl: string, now = new Date()): Promise<DeploymentReceipt> {
  const ts = now.toISOString();
  const deployment = await getDeployment(db, id);
  if (!deployment) throw new DeploymentError("deployment_missing", "Deployment not found.");
  const auth = authorityPredicate(actor, ts, Boolean(deployment.receipt_json));
  const writeSql = actor.writePasswordHash ? "s.write_password_hash = ?" : OWNER_WRITE_SQL.replace(/\b(write_policy|owner_id|created_by)\b/g, "s.$1");
  const writeBinds = actor.writePasswordHash ? [actor.writePasswordHash] : ownerWriteBinds(actor);
  const receiptAccess = actor.via === "grant" ? "1 = 1" : "d.owner_id = ?";
  const receiptBinds = actor.via === "grant" ? [] : [actor.userId ?? ""];
  const allowed = deployment.receipt_json
    ? await db.prepare(`SELECT d.id FROM site_deployments d WHERE d.id = ? AND ${receiptAccess} AND ${auth.sql}`)
      .bind(id, ...receiptBinds, ...auth.binds).first()
    : await db.prepare(`SELECT d.id FROM site_deployments d JOIN sites s ON s.id = d.site_id
      WHERE d.id = ? AND ${writeSql} AND ${auth.sql}`).bind(id, ...writeBinds, ...auth.binds).first();
  if (!allowed) throw new DeploymentError("deployment_forbidden", "Deployment authority is no longer valid.");
  if (deployment.receipt_json) {
    if (deployment.receipt_expires_at! <= ts) throw new DeploymentError("deployment_expired", "The receipt has expired.");
    return JSON.parse(deployment.receipt_json) as DeploymentReceipt;
  }
  if (deployment.deadline <= ts) throw new DeploymentError("deployment_expired", "Preparation deadline has passed.");
  const attempt = crypto.randomUUID();
  const receipt: DeploymentReceipt = { deploymentId: id, versionId: deployment.version_id, outcome: "committed", url: resultUrl, committedAt: ts };
  const witness = "EXISTS (SELECT 1 FROM site_deployments d WHERE d.id = ? AND d.commit_attempt = ? AND d.state = 'committing')";
  // Every effect requires this invocation's nonce: a zero-row transition must be a no-op for the entire batch.
  await db.batch([
    db.prepare(`UPDATE site_deployments AS d SET state = 'committing', commit_attempt = ? WHERE id = ? AND state = 'ready'
      AND deadline > ? AND ${auth.sql} AND EXISTS (SELECT 1 FROM sites s WHERE s.id = d.site_id
        AND s.content_generation = d.base_generation AND (s.lifecycle_state = 'live' OR (? = 1 AND s.lifecycle_state = 'creating'))
        AND s.conversion_state != 'converting'
        AND s.last_written_by NOT LIKE ? AND s.last_written_by NOT LIKE ?
        AND (s.expires_at IS NULL OR s.expires_at > ?) AND ${writeSql})
      AND EXISTS (SELECT 1 FROM site_versions v WHERE v.id = d.version_id AND v.site_id = d.site_id AND v.state = 'sealed' AND v.manifest_hash IS NOT NULL)`)
      .bind(attempt, id, ts, ...auth.binds, actor.activateHidden ? 1 : 0, PURGE_CLAIM_LIKE, WRITE_CLAIM_LIKE, ts, ...writeBinds),
    db.prepare(`UPDATE site_versions SET state = 'superseded', superseded_at = ?
      WHERE id = (SELECT COALESCE(active_version_id, 'legacy:' || id) FROM sites WHERE id = ?) AND ${witness}`).bind(ts, deployment.site_id, id, attempt),
    db.prepare(`UPDATE sites SET active_version_id = ?, content_generation = content_generation + 1, conversion_state = 'versioned', lifecycle_state = 'live',
      updated_at = ?, last_written_by = ?, written_via = ? WHERE id = ? AND ${witness}`)
      .bind(deployment.version_id, ts, actor.email, actor.writtenVia ?? actor.via, deployment.site_id, id, attempt),
    db.prepare(`UPDATE site_versions SET state = 'active' WHERE id = ? AND ${witness}`).bind(deployment.version_id, id, attempt),
    db.prepare(`UPDATE upload_grants SET state = 'consumed', consumed_at = ?, result_id = ?, result_url = ?, receipt_expires_at = ?
      WHERE id = ? AND ${witness}`).bind(ts, actor.legacyGrant ? deployment.site_id : id, resultUrl, new Date(now.getTime() + RECEIPT_LIFETIME).toISOString(), actor.legacyGrant?.grantId ?? (actor.via === "grant" ? actor.grantId ?? "" : ""), id, attempt),
    db.prepare(`UPDATE site_deployments SET state = 'committed', terminal_at = ?, receipt_expires_at = ?, receipt_json = ?
      WHERE id = ? AND commit_attempt = ? AND state = 'committing'`)
      .bind(ts, new Date(now.getTime() + RECEIPT_LIFETIME).toISOString(), JSON.stringify(receipt), id, attempt),
  ]);
  const result = await getDeployment(db, id);
  if (result?.receipt_json) return JSON.parse(result.receipt_json) as DeploymentReceipt;
  throw new DeploymentError("deployment_conflict", "The site, candidate, or authority changed before publication.");
}
