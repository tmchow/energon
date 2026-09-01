import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
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
