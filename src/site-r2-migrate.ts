import { purgeContent } from "./cache";
import { siteKey } from "./config";
import { copyR2Object, deletePrefix } from "./http";
import type { Env } from "./types";

let remapped = false;

/**
 * After D1 gains site ids, objects may still live under sites/{handle}/{slug}/.
 * Copy each legacy prefix onto sites/{handle}/{id}/ once, then delete the legacy
 * keys. Also purge the old public path /{handle}/s/{slug}/ so shared cache cannot
 * keep serving guessable pre-id URLs. Idempotent across boots via the in-memory
 * latch; safe to re-run after resetLegacySiteR2RemapForTests in the test isolate.
 */
export async function remapLegacySiteR2(env: Env, ctx?: ExecutionContext): Promise<void> {
  if (remapped) return;
  const rows = await env.DB.prepare(`SELECT id, handle, slug FROM sites WHERE id IS NOT NULL AND id != ''`).all<{
    id: string;
    handle: string;
    slug: string;
  }>();
  const stalePublicPrefixes: string[] = [];
  for (const site of rows.results || []) {
    if (!site.handle || !site.slug || site.id === site.slug) continue;
    // Pre-id public URLs were /{handle}/s/{slug}/ (cached with long s-maxage).
    stalePublicPrefixes.push(`/${site.handle}/s/${site.slug}/`);
    const legacyPrefix = `sites/${site.handle}/${site.slug}/`;
    const legacyKeys = await listKeys(env.BUCKET, legacyPrefix);
    if (legacyKeys.length === 0) continue;
    for (const key of legacyKeys) {
      const rel = key.slice(legacyPrefix.length);
      if (!rel) continue;
      await copyR2Object(env.BUCKET, key, siteKey(site.handle, site.id, rel));
    }
    await deletePrefix(env.BUCKET, legacyPrefix);
  }
  await purgeContent(ctx, stalePublicPrefixes);
  remapped = true;
}

/** Test-only: allow a second remap pass in the same isolate. */
export function resetLegacySiteR2RemapForTests(): void {
  remapped = false;
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}
