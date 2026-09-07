import { CACHE_UNTIL_PURGE_SECONDS } from "./config";

export function publicCacheControl(remainingSeconds?: number | null): string {
  const sMax =
    remainingSeconds == null
      ? CACHE_UNTIL_PURGE_SECONDS
      : Math.min(CACHE_UNTIL_PURGE_SECONDS, Math.max(1, remainingSeconds));
  return `public, max-age=0, must-revalidate, s-maxage=${sMax}`;
}

export function privateCacheControl(): string {
  return "private, no-store";
}

export function siteCacheTag(handle: string, id: string): string {
  return `site-${handle}-${id}`;
}

export function fileCacheTag(id: string): string {
  return `file-${id}`;
}

/** Drop cached public GETs under these path prefixes. No-op if Workers Cache is unavailable. */
export async function purgeContent(ctx: ExecutionContext | undefined, prefixes: string[]): Promise<void> {
  if (!ctx || prefixes.length === 0) return;
  const api = (ctx as ExecutionContext & { cache?: { purge: (opts: { pathPrefixes: string[] }) => Promise<unknown> } })
    .cache;
  if (!api?.purge) return;
  await api.purge({ pathPrefixes: prefixes });
}

export function sitePrefix(handle: string, id: string): string {
  return `/${handle}/s/${id}/`;
}

export function filePrefix(handle: string, id: string): string {
  return `/${handle}/f/${id}/`;
}
