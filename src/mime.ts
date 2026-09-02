const BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

const TEXT_EXTS = new Set(["html", "htm", "css", "js", "mjs", "json", "map", "txt", "md", "csv", "xml", "svg"]);

function extOf(filename: string): string {
  const base = filename.split("/").pop() || filename;
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

function sniffMagic(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6 && hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (bytes.length >= 4 && hasPrefix(bytes, [0x50, 0x4b]) && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return "application/zip";
  }
  if (hasPrefix(bytes, [0x1f, 0x8b])) return "application/gzip";
  return null;
}

export function contentTypeFor(filename: string, bytes: Uint8Array, hint?: string | null): string {
  const ext = extOf(filename);
  if (TEXT_EXTS.has(ext) && BY_EXT[ext]) return BY_EXT[ext];
  const magic = sniffMagic(bytes);
  if (magic === "application/zip" && ext && ext !== "zip") {
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  if (magic) return magic;
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (hint && hint !== "application/octet-stream") return hint;
  return "application/octet-stream";
}
