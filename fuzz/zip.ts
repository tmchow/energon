import assert from "node:assert/strict";
import { ApiError, normalizeRelPath } from "../src/http";
import { packZip, unpackZip, type UnpackedFile } from "../src/zip";

const MAX_INPUT_BYTES = 64 * 1024;
const EXTENSIONS = ["html", "css", "js", "json", "md", "png", "woff2", "txt"];

function comparePaths(a: UnpackedFile, b: UnpackedFile): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function assertSafeArchive(files: UnpackedFile[]): void {
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    assert.equal(file.path, normalizeRelPath(file.path));
    assert(!paths.has(file.path));
    paths.add(file.path);
    totalBytes += file.bytes.byteLength;
  }
  assert(totalBytes <= MAX_INPUT_BYTES);
}

function generatedFiles(data: Uint8Array): { files: UnpackedFile[]; wrappingFolder: boolean } {
  const count = 1 + (data[0] ?? 0) % 4;
  const wrappingFolder = ((data[1] ?? 0) & 1) === 1;
  const files: UnpackedFile[] = [];
  let offset = 2 + count;

  for (let index = 0; index < count; index += 1) {
    const selector = data[2 + index] ?? index;
    const extension = EXTENSIONS[selector % EXTENSIONS.length];
    const directory = index === 0 && !wrappingFolder ? "" : `assets-${selector % 4}/`;
    const wrapper = wrappingFolder ? `site-${data[1] ?? 0}/` : "";
    const remaining = Math.max(0, data.byteLength - offset);
    const length = Math.min(remaining, selector);
    const bytes = data.subarray(offset, offset + length);
    offset += length;
    files.push({ path: `${wrapper}${directory}file-${index}.${extension}`, bytes });
  }

  return { files, wrappingFolder };
}

function expectedAfterImport(files: UnpackedFile[], wrappingFolder: boolean): UnpackedFile[] {
  return files
    .map((file) => ({
      path: wrappingFolder ? file.path.slice(file.path.indexOf("/") + 1) : file.path,
      bytes: file.bytes,
    }))
    .sort(comparePaths);
}

function assertSameFiles(actual: UnpackedFile[], expected: UnpackedFile[]): void {
  // Jazzer passes Buffers while unpackZip returns Uint8Arrays, so compare values without constructor-sensitive equality.
  assert.equal(actual.length, expected.length);
  for (let fileIndex = 0; fileIndex < actual.length; fileIndex += 1) {
    assert.equal(actual[fileIndex].path, expected[fileIndex].path);
    assert.equal(actual[fileIndex].bytes.byteLength, expected[fileIndex].bytes.byteLength);
    for (let byteIndex = 0; byteIndex < actual[fileIndex].bytes.byteLength; byteIndex += 1) {
      assert.equal(actual[fileIndex].bytes[byteIndex], expected[fileIndex].bytes[byteIndex]);
    }
  }
}

export function fuzz(data: Uint8Array): void {
  if (data.byteLength > MAX_INPUT_BYTES) return;

  if (((data[0] ?? 0) & 1) === 0) {
    try {
      assertSafeArchive(unpackZip(data, MAX_INPUT_BYTES));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    return;
  }

  const generated = generatedFiles(data.subarray(1));
  const archive = packZip(generated.files, MAX_INPUT_BYTES);
  const unpacked = unpackZip(archive, MAX_INPUT_BYTES).sort(comparePaths);
  assertSameFiles(unpacked, expectedAfterImport(generated.files, generated.wrappingFolder));
}
