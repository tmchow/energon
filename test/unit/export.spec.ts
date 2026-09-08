import { describe, expect, it } from "vitest";
import { MAX_IMPORT_FILES } from "../../src/config";
import { assertOwnedExportFits, type OwnedExportCounts } from "../../src/export";
import { ApiError } from "../../src/http";

const under: OwnedExportCounts = { sites: 2, files: 3, content_files: 5, content_bytes: 100 };

describe("assertOwnedExportFits", () => {
  it("allows an archive under both caps", () => {
    expect(() => assertOwnedExportFits(under, MAX_IMPORT_FILES, 1000)).not.toThrow();
  });

  it("refuses a file count over the cap with the totals", () => {
    const counts: OwnedExportCounts = { sites: 1, files: 1, content_files: 201, content_bytes: 50 };
    let caught: unknown;
    try {
      assertOwnedExportFits(counts, 200, 1000);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(400);
    expect((caught as ApiError).code).toBe("too_many_files");
    expect((caught as ApiError).message).toContain("GET /v1/sites/{id}/export");
    expect((caught as ApiError).extra).toMatchObject({
      limit_files: 200,
      actual_files: 201,
      sites: 1,
      files: 1,
      actual_bytes: 50,
    });
  });

  it("refuses bytes over the cap with the totals", () => {
    const counts: OwnedExportCounts = { sites: 2, files: 0, content_files: 4, content_bytes: 2000 };
    let caught: unknown;
    try {
      assertOwnedExportFits(counts, 200, 1000);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(413);
    expect((caught as ApiError).code).toBe("too_large");
    expect((caught as ApiError).message).toContain("GET /v1/sites/{id}/export");
    expect((caught as ApiError).extra).toMatchObject({
      limit_bytes: 1000,
      actual_bytes: 2000,
      actual_files: 4,
      sites: 2,
      files: 0,
    });
  });
});
