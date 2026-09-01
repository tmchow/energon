import { privateCacheControl, publicCacheControl, purgeContent, siteCacheTag, sitePrefix } from "./cache";
import {
  involvementSql,
  likeNeedle,
  nextSiteCursor,
  siteCursorSql,
  takePage,
  type ListPage,
  type ListQuery,
} from "./catalog";
import { brandMark, documentShell } from "./chrome";
import { MAX_IMPORT_FILES, PRODUCT, RESERVED_SLUGS, SLUG_RE, formatBytes, siteKey } from "./config";
import {
  expiredError,
  expiredHtml,
  isExpired,
  purgeExpiredSite,
  remainingCacheSeconds,
  schedulePurgeExpiredSite,
} from "./expire";
import { isMarkdownName, respondMarkdown } from "./markdown";
import { passwordEcho, passwordHashFromInput, protectContent } from "./gate";
import { ensureHandle, ensureUser } from "./handles";
import { ApiError, assertStorageRoom, basename, contentDisposition, copyR2Object, deletePrefix, htmlPage, json, normalizeRelPath, publicOrigin, tooLarge, wantsDownload } from "./http";
import { contentTypeFor } from "./mime";
import {
  assertCanMutate,
  assertCanSetWritePolicy,
  instancePolicy,
  requestedWritePolicy,
  resolveCreateWritePolicy,
  resolveExpiresAt,
  resolveWritePolicy,
} from "./policy";
import type { Actor, Env, SiteFileRow, SiteRow } from "./types";
import { sitePublicUrl } from "./urls";
import { packZip, unpackZip } from "./zip";

const SITE_SELECT =
  `handle, slug, created_at, updated_at, created_by, last_written_by, password_hash, expires_at, write_policy`;

export function assertSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw new ApiError(
      400,
      "bad_slug",
      `Slug '${slug}' is invalid. Use 1–63 characters: lowercase letters, numbers, and hyphens, not starting or ending with a hyphen. Example: lunch-poll.`,
    );
  }
  if (RESERVED_SLUGS.has(s)) {
    throw new ApiError(
      400,
      "reserved_slug",
      `Slug '${s}' is reserved by ${PRODUCT}. Pick another name.`,
    );
  }
  return s;
}

export function assertFilePath(path: string): string {
  const decoded = safeDecode(path);
  const normalized = normalizeRelPath(decoded);
  if (!normalized) {
    throw new ApiError(
      400,
      "bad_path",
      `Path '${path}' is not a safe relative file path. Remove leading slashes and '..' segments.`,
    );
  }
  return normalized;
}

function safeDecode(path: string): string {
  try {
    return path
      .split("/")
      .map((p) => decodeURIComponent(p))
      .join("/");
  } catch {
    throw new ApiError(400, "bad_path", "That path is not valid URL encoding.");
  }
}

export async function getSite(env: Env, handle: string, slug: string): Promise<SiteRow | null> {
  return env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE handle = ? AND slug = ?`)
    .bind(handle, slug)
    .first<SiteRow>();
}

async function findSiteForActor(env: Env, actor: Actor, slug: string): Promise<SiteRow | null> {
  const handle = await ensureHandle(env, actor.email);
  const mine = await getSite(env, handle, slug);
  if (mine) return mine;
  const rows = await env.DB.prepare(`SELECT ${SITE_SELECT} FROM sites WHERE slug = ?`)
    .bind(slug)
    .all<SiteRow>();
  const found = rows.results || [];
  if (found.length === 1) return found[0]!;
  return null;
}

async function fileCount(env: Env, handle: string, slug: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_files WHERE handle = ? AND slug = ?`)
    .bind(handle, slug)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function createSite(
  env: Env,
  actor: Actor,
  slugRaw: string,
  overwrite: boolean,
  password?: string,
  ctx?: ExecutionContext,
  ttl?: unknown,
  writePolicy?: unknown,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const slug = assertSlug(slugRaw);
  const user = await ensureUser(env, actor.email);
  const handle = user.handle;
  let existing = await getSite(env, handle, slug);
  if (existing && isExpired(existing.expires_at)) {
    const purged = await purgeExpiredSite(env, ctx, handle, slug);
    existing = purged ? null : await getSite(env, handle, slug);
  }
  const url = sitePublicUrl(env, handle, slug);
  const hash = await passwordHashFromInput(password);
  const policy = instancePolicy(env);
  if (!existing) {
    const resolved = resolveExpiresAt(policy, ttl);
    const storedWrite = resolveCreateWritePolicy(env, writePolicy);
    const ts = new Date().toISOString();
    const stored = hash === undefined ? null : hash;
    await env.DB.prepare(
      `INSERT INTO sites (handle, slug, owner_id, created_at, updated_at, created_by, last_written_by, password_hash, expires_at, write_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(handle, slug, user.id, ts, ts, actor.email, actor.email, stored, resolved.expiresAt, storedWrite)
      .run();
    return {
      status: 201,
      body: {
        slug,
        handle,
        url,
        created: true,
        password_protected: Boolean(stored),
        password: passwordEcho(password, stored) ?? null,
        ttl: resolved.ttl,
        expires_at: resolved.expiresAt,
        write_policy: storedWrite,
      },
    };
  }
  if (!overwrite) {
    const count = await fileCount(env, handle, slug);
    throw new ApiError(
      409,
      "site_exists",
      `Site '${slug}' already exists at ${url} (last written by ${existing.last_written_by}). To write into it, POST again with overwrite: true. To keep both, pick a new slug.`,
      {
        url,
        handle,
        last_written_by: existing.last_written_by,
        updated_at: existing.updated_at,
        file_count: count,
        password_protected: Boolean(existing.password_hash),
        expires_at: existing.expires_at ?? null,
        hint: "Retry with {\"slug\":\"" + slug + "\",\"overwrite\":true} to claim this bucket. That does not delete existing files. Or pick a new slug.",
      },
    );
  }
  assertCanMutate(actor, existing);
  const ts = new Date().toISOString();
  const resolved = ttl === undefined ? null : resolveExpiresAt(policy, ttl);
  if (hash === undefined && !resolved) {
    await env.DB.prepare(`UPDATE sites SET updated_at = ?, last_written_by = ? WHERE handle = ? AND slug = ?`)
      .bind(ts, actor.email, handle, slug)
      .run();
  } else if (hash === undefined && resolved) {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, expires_at = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, resolved.expiresAt, handle, slug)
      .run();
  } else if (resolved) {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, password_hash = ?, expires_at = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, hash, resolved.expiresAt, handle, slug)
      .run();
    purgeContent(ctx, [sitePrefix(handle, slug)]);
  } else {
    await env.DB.prepare(
      `UPDATE sites SET updated_at = ?, last_written_by = ?, password_hash = ? WHERE handle = ? AND slug = ?`,
    )
      .bind(ts, actor.email, hash, handle, slug)
      .run();
    purgeContent(ctx, [sitePrefix(handle, slug)]);
  }
  return {
    status: 200,
    body: {
      slug,
      handle,
      url,
      created: false,
      claimed: true,
      password_protected: hash === undefined ? Boolean(existing.password_hash) : Boolean(hash),
      password: passwordEcho(password, hash) ?? null,
      expires_at: resolved ? resolved.expiresAt : existing.expires_at ?? null,
      ttl: resolved ? resolved.ttl : undefined,
      write_policy: resolveWritePolicy(existing.write_policy),
    },
  };
}
