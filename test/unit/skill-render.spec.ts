import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  brandFromName,
  parseGitHubRepo,
  runRender,
  tokenEnvFromBrand,
} from "../../scripts/render-skill.mjs";

const CATALOG_PATHS = [
  "marketplace.json",
  ".claude-plugin/marketplace.json",
  ".github/plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
];

describe("skill template", () => {
  it("committed plugin files match instance-skill.json plus the templates", () => {
    const result = spawnSync(process.execPath, ["scripts/render-skill.mjs", "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    for (const rel of CATALOG_PATHS) {
      expect(existsSync(rel), rel).toBe(false);
    }
    expect(existsSync(join(".agents", "skills", "energon"))).toBe(false);
    expect(existsSync(join(".claude", "skills", "energon"))).toBe(false);
  });

  it("skill:init requires --name or --skill, and --origin", () => {
    expect(() => runRender(["--init"])).toThrow(/--name \(or --skill\) and --origin/);
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

describe("skill:init", () => {
  const tmpRoots = [];
  afterEach(() => {
    for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("writes a named plugin package and catalogs, not a project-local skill", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    tmpRoots.push(root);
    const { dirty } = runRender(
      [
        "--init",
        "--name",
        "yourco",
        "--origin",
        "https://energon.your.co",
        "--repo",
        "acme/energon",
      ],
      { root },
    );

    expect(dirty.length).toBeGreaterThan(0);

    const pluginDir = join(root, "plugins", "yourco-energon");
    const skillMd = readFileSync(join(pluginDir, "skills", "yourco-energon", "SKILL.md"), "utf8");
    expect(skillMd.startsWith("---\nname: yourco-energon\n")).toBe(true);
    expect(skillMd).toContain("https://energon.your.co");
    expect(skillMd).toContain("YOURCO_ENERGON_TOKEN");

    const plugin = JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf8"));
    expect(plugin.$schema).toContain("agent-plugins.org");
    expect(plugin.name).toBe("yourco-energon");
    expect(plugin.homepage).toBe("https://energon.your.co");

    const claude = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(claude.name).toBe("yourco-energon");
    expect(claude.logo).toBeUndefined();

    const agents = JSON.parse(readFileSync(join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
    expect(agents.plugins[0].source.path).toBe("./plugins/yourco-energon");

    const claudeMarket = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(claudeMarket.plugins[0].source).toBe("./plugins/yourco-energon");
    expect(claudeMarket.name).toBe("yourco-energon");

    expect(existsSync(join(root, ".agents", "skills"))).toBe(false);
    expect(existsSync(join(pluginDir, "logo.svg"))).toBe(true);

    const instance = JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"));
    expect(instance.skill).toBe("yourco-energon");
    expect(instance.tokenEnv).toBe("YOURCO_ENERGON_TOKEN");
  });

  it("does not write marketplace catalogs for the placeholder host", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    tmpRoots.push(root);
    runRender([], { root });
    expect(existsSync(join(root, "plugins", "energon", "plugin.json"))).toBe(true);
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "plugins", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "skills"))).toBe(false);
  });

  it("throws and writes nothing when --init has --name but no --origin", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    tmpRoots.push(root);
    expect(() => runRender(["--init", "--name", "yourco"], { root })).toThrow(
      /--name \(or --skill\) and --origin/,
    );
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, ".claude-plugin"))).toBe(false);
    expect(existsSync(join(root, "instance-skill.json"))).toBe(false);
  });

  it("removes leftover project-local skill links", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    tmpRoots.push(root);
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    symlinkSync(".", join(root, ".agents", "skills", "energon"));
    symlinkSync(".", join(root, ".claude", "skills", "energon"));
    runRender(
      ["--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon"],
      { root },
    );
    expect(existsSync(join(root, ".agents", "skills", "energon"))).toBe(false);
    expect(existsSync(join(root, ".claude", "skills", "energon"))).toBe(false);
    expect(existsSync(join(root, ".agents", "skills", "yourco-energon"))).toBe(false);
  });

  it("fails --check when a placeholder tree still has a marketplace catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    tmpRoots.push(root);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{}\n");
    const { dirty } = runRender(["--check"], { root });
    expect(dirty).toContain(join(".claude-plugin", "marketplace.json"));
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(true);
  });
});
