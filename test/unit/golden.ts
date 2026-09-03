import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const GOLDEN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");

const UPDATE_HINT = "UPDATE_GOLDENS=1 npm run test:unit -- test/unit/golden.spec.ts";

export function canonicalize(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function updatingGoldens(): boolean {
  // CI must never rewrite goldens even if UPDATE_GOLDENS is set.
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  const value = process.env.UPDATE_GOLDENS;
  return value === "1" || value === "true";
}

function goldenPath(name: string): string {
  return join(GOLDEN_ROOT, `${name}.golden`);
}

function actualPath(path: string): string {
  return path.replace(/\.golden$/, ".actual");
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "ENOENT");
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function assertGolden(name: string, actual: string): void {
  const path = goldenPath(name);
  const leftover = actualPath(path);
  const canonical = canonicalize(actual);

  if (updatingGoldens()) {
    writeFile(path, canonical);
    unlinkIfPresent(leftover);
    return;
  }

  let expectedRaw: string;
  try {
    expectedRaw = readFileSync(path, "utf8");
  } catch (err) {
    if (!isEnoent(err)) throw err;
    writeFile(leftover, canonical);
    throw new Error(`Golden file missing: ${path}\nRun ${UPDATE_HINT}\nThen review: git diff test/golden/`);
  }

  const expected = canonicalize(expectedRaw);
  if (canonical === expected) {
    unlinkIfPresent(leftover);
    return;
  }

  writeFile(leftover, canonical);
  expect(
    canonical,
    `GOLDEN MISMATCH: ${name}\nTo update: ${UPDATE_HINT}\nTo review: diff ${path} ${leftover}`,
  ).toBe(expected);
}

export function assertJsonGolden(name: string, value: unknown): void {
  assertGolden(name, JSON.stringify(value, null, 2));
}
