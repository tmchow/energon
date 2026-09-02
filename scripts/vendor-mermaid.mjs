#!/usr/bin/env node
/**
 * Copy the pinned mermaid ESM build into public/ so Wrangler serves it as
 * a static asset. Do not import mermaid from src/ — that would put ~1 MB
 * gzip into the Worker isolate and every cold start.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "node_modules", "mermaid", "dist");
const DEST = join(ROOT, "public", "static", "mermaid");
const ENTRY = "mermaid.esm.min.mjs";
const CHUNK_DIR = "chunks/mermaid.esm.min";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function vendorPresent() {
  const entry = join(DEST, ENTRY);
  const chunkDir = join(DEST, CHUNK_DIR);
  if (!existsSync(entry) || statSync(entry).size < 1_000) return false;
  if (!existsSync(chunkDir)) return false;
  const chunks = readdirSync(chunkDir).filter((name) => name.endsWith(".mjs"));
  return chunks.length > 0;
}

if (process.argv.includes("--check")) {
  if (!vendorPresent()) fail("public/static/mermaid is missing; run node scripts/vendor-mermaid.mjs");
  process.exit(0);
}

const srcEntry = join(DIST, ENTRY);
const srcChunks = join(DIST, CHUNK_DIR);
if (!existsSync(srcEntry) || !existsSync(srcChunks)) {
  fail("mermaid is not installed (need node_modules/mermaid/dist).");
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(join(DEST, CHUNK_DIR), { recursive: true });
copyFileSync(srcEntry, join(DEST, ENTRY));
let chunks = 0;
for (const name of readdirSync(srcChunks)) {
  if (!name.endsWith(".mjs")) continue;
  copyFileSync(join(srcChunks, name), join(DEST, CHUNK_DIR, name));
  chunks += 1;
}
if (chunks === 0) fail("mermaid ESM chunk directory had no .mjs files.");
console.log(`vendored mermaid ESM (${ENTRY} + ${chunks} chunks) -> public/static/mermaid`);
