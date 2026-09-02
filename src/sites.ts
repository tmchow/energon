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
  isPurgeClaimed,
  PURGE_CLAIM_LIKE,
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
