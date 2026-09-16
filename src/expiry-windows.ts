export const EXPIRES_WITHIN_WINDOWS = ["24h", "7d"] as const;
export type ExpiresWithin = (typeof EXPIRES_WITHIN_WINDOWS)[number];
export type ExpiryUrgency = "danger" | "warn" | "ttl";

const MS_HOUR = 3600_000;
export const EXPIRES_WITHIN_MS: Record<ExpiresWithin, number> = { "24h": 24 * MS_HOUR, "7d": 7 * 24 * MS_HOUR };

export function isExpiresWithin(raw: string): raw is ExpiresWithin {
  return (EXPIRES_WITHIN_WINDOWS as readonly string[]).includes(raw);
}

/** Cutoff for `expires_within`, computed at request time. */
export function expiresWithinBefore(window: ExpiresWithin, now = Date.now()): string {
  return new Date(now + EXPIRES_WITHIN_MS[window]).toISOString();
}

/** Catalog Expires cell: danger inside 24h, warn inside 7d, otherwise the ttl tone. */
export function expiryUrgency(expiresAt: string | null | undefined, now = Date.now()): ExpiryUrgency | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  const remaining = t - now;
  if (remaining <= EXPIRES_WITHIN_MS["24h"]) return "danger";
  if (remaining <= EXPIRES_WITHIN_MS["7d"]) return "warn";
  return "ttl";
}
