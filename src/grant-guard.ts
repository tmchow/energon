import { ApiError } from "./http";
import { GRANT_CLAIM_GRACE_SECONDS, grantClaimable, tokenExpired } from "./policy";
import type { Env } from "./types";

/** The lease an upload attempt holds on its grant. Passed to a mutator, it makes the commit consume the grant. */
export type GrantGuard = { grantId: string; leaseId: string };

/**
 * D1 batches do not abort when a statement changes zero rows, so every statement in a guarded commit repeats
 * this predicate: the catalog write and the grant consumption land together or not at all.
 */
export const GRANT_LEASE_SQL = `EXISTS (SELECT 1 FROM upload_grants g JOIN tokens t ON t.id = g.token_id
  WHERE g.id = ? AND g.lease_id = ? AND g.state = 'uploading' AND g.expires_at > ?
  AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?))`;

export function grantLeaseBinds(guard: GrantGuard, now: Date): [string, string, string, string] {
  const graceCutoff = new Date(now.getTime() - GRANT_CLAIM_GRACE_SECONDS * 1000).toISOString();
  return [guard.grantId, guard.leaseId, graceCutoff, now.toISOString()];
}

/** Marks the grant consumed only when `landedSql` proves this attempt's catalog write is in place. */
export function consumeGrantStatement(
  env: Env,
  guard: GrantGuard,
  now: Date,
  result: { id: string; url: string },
  landedSql: string,
  landedBinds: unknown[],
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE upload_grants SET state = 'consumed', result_id = ?, result_url = ?, consumed_at = ?, last_error = NULL
     WHERE id = ? AND lease_id = ? AND ${GRANT_LEASE_SQL} AND ${landedSql}`,
  ).bind(result.id, result.url, now.toISOString(), guard.grantId, guard.leaseId, ...grantLeaseBinds(guard, now), ...landedBinds);
}

/**
 * Explains a guarded commit that changed no rows when the grant itself is why. Returns null when the grant
 * still holds this lease and is valid, so the mutator reports its own conflict (busy, expired target, ...).
 */
export async function grantCommitFailure(env: Env, guard: GrantGuard): Promise<ApiError | null> {
  const row = await env.DB.prepare(
    `SELECT g.state, g.lease_id, g.expires_at, t.id AS token_id, t.revoked_at, t.expires_at AS token_expires_at
     FROM upload_grants g LEFT JOIN tokens t ON t.id = g.token_id WHERE g.id = ?`,
  )
    .bind(guard.grantId)
    .first<{
      state: string;
      lease_id: string | null;
      expires_at: string;
      token_id: string | null;
      revoked_at: string | null;
      token_expires_at: string | null;
    }>();
  if (!row || row.state !== "uploading" || row.lease_id !== guard.leaseId) {
    return new ApiError(409, "grant_busy", "Another upload holds this grant. Retry after it finishes.");
  }
  if (!row.token_id || row.revoked_at || tokenExpired(row.token_expires_at)) {
    return new ApiError(410, "grant_failed", "The token that minted this grant was revoked or expired. Ask for a new grant.", {
      reason: "token_revoked",
    });
  }
  if (!grantClaimable(row.expires_at)) {
    return new ApiError(410, "grant_expired", "This grant expired before the upload finished. Ask for a new grant.");
  }
  return null;
}
