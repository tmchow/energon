import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_FILES } from "../../src/config";
import { ApiError } from "../../src/http";
import { packZip, unpackZip } from "../../src/zip";

describe("unpackZip", () => {
  it("strips a single wrapping folder", () => {
    const buf = zipSync({
      "my-site/index.html": strToU8("<h1>root</h1>"),
      "my-site/css/app.css": strToU8("body{}"),
    });
    const files = unpackZip(buf);
    expect(files.map((f) => f.path).sort()).toEqual(["css/app.css", "index.html"]);
  });

  it("keeps paths when there is no single wrapper", () => {
    const buf = zipSync({
      "index.html": strToU8("a"),
      "docs/readme.md": strToU8("b"),
    });
    expect(unpackZip(buf).map((f) => f.path).sort()).toEqual(["docs/readme.md", "index.html"]);
  });

  it("skips OS junk and rejects traversal", () => {
    const junk = zipSync({
      "site/index.html": strToU8("ok"),
      "site/.DS_Store": strToU8("x"),
      "__MACOSX/site/._index.html": strToU8("x"),
    });
    expect(unpackZip(junk).map((f) => f.path)).toEqual(["index.html"]);

    const evil = zipSync({ "../secret.txt": strToU8("nope") });
    expect(() => unpackZip(evil)).toThrow(ApiError);
    try {
      unpackZip(evil);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("bad_zip_path");
    }
  });

  it("rejects an empty zip and a non-zip body", () => {
    expect(() => unpackZip(new Uint8Array([1, 2, 3, 4]))).toThrow(ApiError);
    const empty = zipSync({});
    expect(() => unpackZip(empty)).toThrow(ApiError);
  });

  it("rejects an archive with too many file entries", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_IMPORT_FILES; i += 1) {
      entries[`site/file-${i}.txt`] = strToU8("x");
    }
    const archive = zipSync(entries);

    let caught: unknown;
    try {
      unpackZip(archive);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("too_many_files");
  });

  it("rejects aggregate uncompressed bytes even when each file is within the cap", () => {
    const archive = zipSync({
      "site/first.txt": strToU8("123456"),
      "site/second.txt": strToU8("abcdef"),
    });

    let caught: unknown;
    try {
      unpackZip(archive, 10);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("too_large");
    expect((caught as ApiError).extra).toMatchObject({ limit_bytes: 10, actual_bytes: 12 });
  });

  it("rechecks actual aggregate bytes after decompression", () => {
    const archive = zipSync({
      "site/first.txt": [strToU8("123456"), { level: 0 }],
      "site/second.txt": [strToU8("abcdef"), { level: 0 }],
    });
    const tampered = archive.slice();
    const centralDirectoryOffsets: number[] = [];
    for (let i = 0; i < tampered.length - 3; i += 1) {
      if (tampered[i] === 0x50 && tampered[i + 1] === 0x4b && tampered[i + 2] === 0x01 && tampered[i + 3] === 0x02) {
        centralDirectoryOffsets.push(i);
      }
    }
    for (const offset of centralDirectoryOffsets) {
      tampered[offset + 24] = 4;
      tampered[offset + 25] = 0;
      tampered[offset + 26] = 0;
      tampered[offset + 27] = 0;
    }

    let caught: unknown;
    try {
      unpackZip(tampered, 10);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("too_large");
    expect((caught as ApiError).extra).toMatchObject({ limit_bytes: 10, actual_bytes: 12 });
  });
});

describe("packZip", () => {
  it("round-trips files and refuses an empty site", () => {
    const bytes = packZip([
      { path: "index.html", bytes: strToU8("<h1>x</h1>") },
      { path: "css/app.css", bytes: strToU8("body{}") },
    ]);
    expect(unpackZip(bytes).map((f) => f.path).sort()).toEqual(["css/app.css", "index.html"]);
    expect(() => packZip([])).toThrow(ApiError);
  });
});
