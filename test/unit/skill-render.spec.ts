import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { brandFromName, parseGitHubRepo, tokenEnvFromBrand } from "../../scripts/render-skill.mjs";

describe("skill template", () => {
  it("committed SKILL.md matches instance-skill.json plus the template", () => {
    const result = spawnSync(process.execPath, ["scripts/render-skill.mjs", "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("skill:init requires --name or --skill, and --origin", () => {
    const result = spawnSync(process.execPath, ["scripts/render-skill.mjs", "--init"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toMatch(/--name \(or --skill\) and --origin/);
  });
});

describe("skill brand", () => {
  it("makes skill and marketplace the same PREFIX-energon name", () => {
    expect(brandFromName("cybertron")).toBe("cybertron-energon");
    expect(brandFromName("cybertron-energon")).toBe("cybertron-energon");
    expect(tokenEnvFromBrand("cybertron-energon")).toBe("CYBERTRON_ENERGON_TOKEN");
  });

  it("reads owner/repo from git or HTTPS GitHub remotes", () => {
    expect(parseGitHubRepo("git@github.com:cybertron/energon.git")).toBe("cybertron/energon");
    expect(parseGitHubRepo("https://github.com/cybertron/energon")).toBe("cybertron/energon");
  });
});
