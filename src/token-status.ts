/** Token lifecycle shared by the Worker and the Tokens page. No imports so the UI bundle can type against it. */

export type TokenStatus = "live" | "stale" | "expired" | "revoked";

export const STALE_TOKEN_DAYS = 30;
const STALE_TOKEN_MS = STALE_TOKEN_DAYS * 86400000;

export type TokenLifecycleRow = {
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

/** A never-used token counts from mint, so a fresh unused token is live until the threshold passes. */
export function tokenStatus(row: TokenLifecycleRow, now = Date.now()): TokenStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at !== null) {
    const expires = Date.parse(row.expires_at);
    if (!Number.isFinite(expires) || expires <= now) return "expired";
  }
  const lastActivity = Date.parse(row.last_used_at ?? row.created_at);
  return Number.isFinite(lastActivity) && now - lastActivity < STALE_TOKEN_MS ? "live" : "stale";
}

export type TokenSummary = {
  id: string;
  label: string;
  hint: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  status: TokenStatus;
};

export const BULK_REVOKE_TARGETS = ["stale", "all"] as const;
export type BulkRevokeTarget = (typeof BULK_REVOKE_TARGETS)[number];

export function bulkRevokeEligible(target: BulkRevokeTarget, status: TokenStatus): boolean {
  switch (target) {
    case "stale":
      return status === "stale";
    case "all":
      return status !== "revoked";
    default: {
      const exhaustive: never = target;
      throw new Error(`Unhandled bulk revoke target: ${String(exhaustive)}`);
    }
  }
}

export type BulkRevokePreview = {
  target: BulkRevokeTarget;
  executed: false;
  matched: number;
  sample: Pick<TokenSummary, "id" | "label" | "hint" | "status" | "last_used_at">[];
  confirm: string;
};

export type BulkRevokeResult = { ok: true; target: BulkRevokeTarget; executed: true; revoked: number };
