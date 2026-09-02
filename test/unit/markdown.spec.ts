import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("markdown mermaid vendor", () => {
  it("copies the pinned mermaid ESM into public/static/mermaid", () => {
    const check = spawnSync(process.execPath, ["scripts/vendor-mermaid.mjs", "--check"], { encoding: "utf8" });
    expect(check.status, check.stderr || check.stdout).toBe(0);
    const entry = resolve("public/static/mermaid/mermaid.esm.min.mjs");
    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(entry, "utf8")).toContain("chunks/mermaid.esm.min/");
  });
});
