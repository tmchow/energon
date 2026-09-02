import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brandFromName, parseGitHubRepo, tokenEnvFromBrand } from "../../scripts/render-skill.mjs";

function makeDisposableRepo() {
  const repo = mkdtempSync(join(tmpdir(), "energon-render-"));
  mkdirSync(join(repo, "scripts"), { recursive: true });
  cpSync(resolve("scripts/render-skill.mjs"), join(repo, "scripts/render-skill.mjs"));
  cpSync(resolve("templates/skill"), join(repo, "templates/skill"), { recursive: true });
  mkdirSync(join(repo, "plugins", "old-plugin", "skills", "old-skill"), { recursive: true });
  writeFileSync(join(repo, "plugins", "old-plugin", "skills", "old-skill", "SKILL.md"), "old skill\n");
  writeFileSync(
    join(repo, "instance-skill.json"),
    `${JSON.stringify(
      {
        skill: "old-skill",
        plugin: "old-plugin",
        marketplace: "old-marketplace",
        origin: "https://old.example.test",
        tokenEnv: "OLD_TOKEN",
        tokenPrefix: "old_",
        product: "Old",
        org: "Old Org",
        repo: "old/repo",
        marketplaceRepo: "old/repo",
        marketplaceUrl: "https://github.com/old/repo",
      },
      null,
      2,
    )}\n`,
  );
  return repo;
}

function runRenderer(repo: string, args: string[]) {
  return spawnSync(process.execPath, [join(repo, "scripts/render-skill.mjs"), ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

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

  it.each([
    ["--plugin", "../outside"],
    ["--skill", "nested/skill"],
    ["--marketplace", "nested\\marketplace"],
    ["--plugin", resolve("/tmp", "outside-plugin")],
  ])("rejects unsafe %s values before writing", (option, value) => {
    const repo = makeDisposableRepo();
    const outside = join(repo, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");

    const result = runRenderer(repo, [
      "--init",
      "--skill",
      "new-skill",
      "--origin",
      "https://new.example.test",
      "--no-marketplace",
      option,
      value,
    ]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
    expect(readFileSync(join(repo, "instance-skill.json"), "utf8")).toContain('"plugin": "old-plugin"');
  });

  it("rejects unsafe identifiers loaded from instance-skill.json", () => {
    const repo = makeDisposableRepo();
    const outside = join(repo, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    const configPath = join(repo, "instance-skill.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugin = "../outside";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runRenderer(repo, ["--init", "--skill", "new-skill", "--origin", "https://new.example.test"]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
    expect(readFileSync(configPath, "utf8")).toContain('"plugin": "../outside"');
  });

  it("refuses to replace an existing plugin destination", () => {
    const repo = makeDisposableRepo();
    const destination = join(repo, "plugins", "new-plugin");
    mkdirSync(destination, { recursive: true });
    const sentinel = join(destination, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");

    const result = runRenderer(repo, [
      "--init",
      "--skill",
      "new-skill",
      "--plugin",
      "new-plugin",
      "--marketplace",
      "new-marketplace",
      "--origin",
      "https://new.example.test",
      "--no-marketplace",
    ]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
    expect(existsSync(join(repo, "plugins", "old-plugin", "skills", "old-skill", "SKILL.md"))).toBe(true);
  });

  it("rejects symlinked render destinations outside the plugin root", () => {
    const repo = makeDisposableRepo();
    const outside = join(repo, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    symlinkSync(outside, join(repo, "plugins", "old-plugin", "skills", "new-skill"));

    const result = runRenderer(repo, [
      "--init",
      "--skill",
      "new-skill",
      "--plugin",
      "old-plugin",
      "--origin",
      "https://new.example.test",
      "--no-marketplace",
    ]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
  });

  it("keeps valid fork initialization behavior", () => {
    const repo = makeDisposableRepo();

    const result = runRenderer(repo, [
      "--init",
      "--skill",
      "new-skill",
      "--plugin",
      "new-plugin",
      "--marketplace",
      "new-marketplace",
      "--origin",
      "https://new.example.test",
      "--repo",
      "new-org/new-repo",
      "--no-marketplace",
    ]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(existsSync(join(repo, "plugins", "new-plugin", "skills", "new-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, "plugins", "old-plugin"))).toBe(false);
    expect(JSON.parse(readFileSync(join(repo, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "new-skill",
      plugin: "new-plugin",
      marketplace: "new-marketplace",
    });
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
