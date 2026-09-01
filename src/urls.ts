import { FILE_ID_RE } from "./config";
import { basename, publicOrigin } from "./http";
import type { Env } from "./types";

/** Spaces to underscores so the path stays readable. Identity is the id, not this name. */
export function urlFilename(filename: string): string {
  return basename(filename).replace(/ /g, "_") || "file";
}

export function isFileId(id: string): boolean {
  return FILE_ID_RE.test(id);
}

export function filePublicPath(handle: string, id: string, filename: string): string {
  return `/${handle}/f/${id}/${urlFilename(filename)}`;
}

export function sitePublicPath(handle: string, slug: string, path = ""): string {
  const suffix = path ? `/${path}` : "/";
  return `/${handle}/s/${slug}${suffix}`;
}

export function filePublicUrl(env: Env, handle: string, id: string, filename: string): string {
  return `${publicOrigin(env)}${filePublicPath(handle, id, filename)}`;
}

export function sitePublicUrl(env: Env, handle: string, slug: string, path = ""): string {
  return `${publicOrigin(env)}${sitePublicPath(handle, slug, path)}`;
}
