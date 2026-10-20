#!/usr/bin/env node
/**
 * Do not import Pele or mermaid from src/ — that would put the renderer into
 * the Worker isolate and every cold start.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(ROOT, "public", "static");

const BUILDS = [
  {
    name: "pele",
    dist: join(ROOT, "node_modules", "pele", "dist", "esm"),
    dest: join(STATIC, "pele"),
    entry: "lazy.js",
    chunkDir: "chunks",
  },
  {
    name: "mermaid",
    dist: join(ROOT, "node_modules", "mermaid", "dist"),
    dest: join(STATIC, "mermaid"),
    entry: "mermaid.esm.min.mjs",
    chunkDir: "chunks/mermaid.esm.min",
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function chunkNames(dir) {
  return readdirSync(dir).filter((name) => /\.m?js$/.test(name));
}

function vendorPresent({ dest, entry, chunkDir }) {
  const entryPath = join(dest, entry);
  if (!existsSync(entryPath) || statSync(entryPath).size < 1_000) return false;
  const chunks = join(dest, chunkDir);
  return existsSync(chunks) && chunkNames(chunks).length > 0;
}

if (process.argv.includes("--check")) {
  for (const build of BUILDS) {
    if (!vendorPresent(build)) fail(`public/static/${build.name} is missing; run node scripts/vendor-diagrams.mjs`);
  }
  process.exit(0);
}

for (const { name, dist, dest, entry, chunkDir } of BUILDS) {
  const srcEntry = join(dist, entry);
  const srcChunks = join(dist, chunkDir);
  if (!existsSync(srcEntry) || !existsSync(srcChunks)) {
    fail(`${name} is not installed (need ${srcEntry} and ${srcChunks}).`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, chunkDir), { recursive: true });
  copyFileSync(srcEntry, join(dest, entry));
  const chunks = chunkNames(srcChunks);
  if (chunks.length === 0) fail(`${name} ESM chunk directory had no module files.`);
  for (const chunk of chunks) copyFileSync(join(srcChunks, chunk), join(dest, chunkDir, chunk));
  console.log(`vendored ${name} ESM (${entry} + ${chunks.length} chunks) -> public/static/${name}`);
}
