import { unzipSync, zipSync, type Zippable } from "fflate";
import { MAX_FILE_BYTES, MAX_IMPORT_FILES, PRODUCT, formatBytes } from "./config";
import { ApiError, normalizeRelPath, tooLarge } from "./http";

export type UnpackedFile = { path: string; bytes: Uint8Array };

const ALREADY_COMPRESSED_EXTENSIONS = new Set([
  "7z",
  "avif",
  "bz2",
  "gif",
  "gz",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "pdf",
  "png",
  "rar",
  "webm",
  "webp",
  "woff",
  "woff2",
  "zip",
]);

function isAlreadyCompressed(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && ALREADY_COMPRESSED_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function stripWrappingFolder(paths: string[]): (path: string) => string {
  const files = paths.filter((p) => p && !p.endsWith("/"));
  if (files.length === 0) return (p) => p;
  const first = files[0].split("/")[0];
  if (!first || first === ".." || first === ".") return (p) => p;
  const allInside = files.every((p) => p.startsWith(`${first}/`));
  if (allInside) return (p) => p.slice(first.length + 1);
  return (p) => p;
}

function skipZipJunk(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.includes("__MACOSX")) return true;
  const base = parts[parts.length - 1] || "";
  if (base === ".DS_Store" || base === "Thumbs.db") return true;
  return false;
}

function hasUnsafeSegments(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.some((s) => s === ".." || s === "" || s.includes(":"));
}

export function unpackZip(buf: Uint8Array, maxBytes = MAX_FILE_BYTES): UnpackedFile[] {
  let importedEntries = 0;
  let importedBytes = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(buf, {
      filter: (file) => {
        if (!file.name || file.name.endsWith("/") || skipZipJunk(file.name)) return false;
        const size = file.originalSize ?? 0;
        if (size > maxBytes) {
          throw tooLarge(size, "", maxBytes);
        }
        if (importedEntries >= MAX_IMPORT_FILES) {
          throw new ApiError(
            400,
            "too_many_files",
            `That zip has more than ${MAX_IMPORT_FILES} files. ${PRODUCT} imports at most ${MAX_IMPORT_FILES} files per zip to prevent accidents. Split the site, then retry.`,
          );
        }
        if (importedBytes + size > maxBytes) {
          throw tooLarge(importedBytes + size, "", maxBytes);
        }
        importedEntries += 1;
        importedBytes += size;
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      400,
      "invalid_zip",
      "That body is not a readable zip. POST Content-Type application/zip with a real zip archive.",
    );
  }

  const names = Object.keys(raw).filter((name) => name && !name.endsWith("/") && !skipZipJunk(name));
  if (names.length === 0) {
    throw new ApiError(400, "empty_zip", "That zip has no files in it.");
  }
  if (names.length > MAX_IMPORT_FILES) {
    throw new ApiError(
      400,
      "too_many_files",
      `That zip has ${names.length} files. ${PRODUCT} imports at most ${MAX_IMPORT_FILES} files per zip to prevent accidents. Split the site, then retry.`,
    );
  }
  for (const name of names) {
    if (hasUnsafeSegments(name)) {
      throw new ApiError(
        400,
        "bad_zip_path",
        `Zip entry '${name}' is not a safe relative path. Remove '..' segments and absolute paths, then retry.`,
      );
    }
  }

  const strip = stripWrappingFolder(names);
  const out: UnpackedFile[] = [];
  let actualBytes = 0;
  for (const name of names) {
    const bytes = raw[name];
    if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength, "", maxBytes);
    actualBytes += bytes.byteLength;
    if (actualBytes > maxBytes) throw tooLarge(actualBytes, "", maxBytes);
    const stripped = strip(name);
    const path = normalizeRelPath(stripped);
    if (!path) {
      throw new ApiError(
        400,
        "bad_zip_path",
        `Zip entry '${name}' is not a safe relative path. Remove '..' segments and absolute paths, then retry.`,
      );
    }
    if (skipZipJunk(path)) continue;
    out.push({ path, bytes });
  }
  if (out.length === 0) {
    throw new ApiError(400, "empty_zip", "That zip has no files left after stripping junk and the wrapping folder.");
  }
  return out;
}

export function packZip(files: UnpackedFile[], maxBytes = MAX_FILE_BYTES, maxFiles = MAX_IMPORT_FILES): Uint8Array {
  if (files.length === 0) {
    throw new ApiError(400, "empty_site", `That site has no files to zip.`);
  }
  if (files.length > maxFiles) {
    throw new ApiError(
      400,
      "too_many_files",
      `That site has ${files.length} files. ${PRODUCT} exports at most ${maxFiles} files per zip. Split the site, then retry.`,
    );
  }
  const rec: Zippable = {};
  let total = 0;
  for (const f of files) {
    const path = normalizeRelPath(f.path);
    if (!path) {
      throw new ApiError(
        400,
        "bad_zip_path",
        `Path '${f.path}' is not a safe relative path. Remove '..' segments and absolute paths, then retry.`,
      );
    }
    if (f.bytes.byteLength > maxBytes) throw tooLarge(f.bytes.byteLength, "", maxBytes);
    total += f.bytes.byteLength;
    rec[path] = isAlreadyCompressed(path) ? [f.bytes, { level: 0 }] : f.bytes;
  }
  if (total > maxBytes) {
    throw new ApiError(
      413,
      "too_large",
      `That site is over the ${formatBytes(maxBytes)} export cap (${(total / (1024 * 1024)).toFixed(1)} MB of files). ${PRODUCT} zips at most ${formatBytes(maxBytes)} so a download stays small. Split the site, then retry.`,
      { limit_bytes: maxBytes, actual_bytes: total },
    );
  }
  try {
    return zipSync(rec);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, "export_failed", "Could not assemble a zip of that site. Try again.");
  }
}
