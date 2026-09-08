import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prTitleError } from "../../scripts/check-pr-title.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/check-pr-title.mjs");

describe("prTitleError", () => {
  it("accepts conventional commit titles", () => {
    expect(prTitleError("feat: show expiry on the catalog row")).toBeNull();
    expect(prTitleError("feat(hub): show expiry on the catalog row")).toBeNull();
    expect(prTitleError("fix(v1): reject empty overwrite")).toBeNull();
    expect(prTitleError("feat(v1)!: drop the old header")).toBeNull();
    expect(prTitleError("docs: explain squash titles")).toBeNull();
    expect(prTitleError("ci: lint PR titles as conventional commits")).toBeNull();
  });

  it("rejects titles that will not parse as conventional commits", () => {
    expect(prTitleError("")).toContain("empty");
    expect(prTitleError("Cap public edge cache at one day")).toContain("Conventional Commit");
    expect(prTitleError("feat: Cap public edge cache")).toContain("lowercase");
    expect(prTitleError("feat: add a period.")).toContain("period");
    expect(prTitleError("feat:")).toContain("Conventional Commit");
    expect(prTitleError("wip: try something")).toContain("Conventional Commit");
  });
});

describe("scripts/check-pr-title.mjs", () => {
  it("exits 0 for a valid title and 1 for an invalid title", () => {
    const ok = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, PR_TITLE: "docs: require how to test" },
    });
    expect(ok.status).toBe(0);
    const bad = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, PR_TITLE: "Drop human-review from PRs" },
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Conventional Commit");
  });
});
