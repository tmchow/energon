import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const disposableRoots: string[] = [];

function makeDisposableRepo() {
  const root = mkdtempSync(join(tmpdir(), "energon-render-"));
  disposableRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(resolve("scripts/render-skill.mjs"), join(root, "scripts/render-skill.mjs"));
  cpSync(resolve("templates"), join(root, "templates"), { recursive: true });
  mkdirSync(join(root, "plugins", "old-plugin", "skills", "old-skill"), { recursive: true });
  writeFileSync(join(root, "plugins", "old-plugin", "skills", "old-skill", "SKILL.md"), "old skill\n");
  writeFileSync(
    join(root, "instance-skill.json"),
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
  return root;
}

function runRenderer(root: string, args: string[]) {
  return spawnSync(process.execPath, [join(root, "scripts/render-skill.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of disposableRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("skill template", () => {
  it("committed plugin files match instance-skill.json plus the templates", () => {
    const result = spawnSync(process.execPath, ["scripts/render-skill.mjs", "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    for (const rel of CATALOG_PATHS) expect(existsSync(rel), rel).toBe(false);
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
  it("writes a named plugin package and catalogs, not a project-local skill", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(root);
    const { dirty } = runRender(
      ["--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon"],
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
    expect(JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")).logo).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root, ".agents", "plugins", "marketplace.json"), "utf8")).plugins[0].source.path).toBe(
      "./plugins/yourco-energon",
    );
    expect(JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8")).plugins[0].source).toBe(
      "./plugins/yourco-energon",
    );
    expect(existsSync(join(root, ".agents", "skills"))).toBe(false);
    expect(existsSync(join(pluginDir, "logo.svg"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "yourco-energon",
      tokenEnv: "YOURCO_ENERGON_TOKEN",
    });
  });

  it("does not write marketplace catalogs for the placeholder host", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(root);
    runRender([], { root });
    expect(existsSync(join(root, "plugins", "energon", "plugin.json"))).toBe(true);
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "plugins", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "skills", "energon"))).toBe(false);
  });

  it("throws and writes nothing when --init has --name but no --origin", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(root);
    expect(() => runRender(["--init", "--name", "yourco"], { root })).toThrow(
      /--name \(or --skill\) and --origin/,
    );
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, ".claude-plugin"))).toBe(false);
    expect(existsSync(join(root, "instance-skill.json"))).toBe(false);
  });

  it("removes leftover project-local skill links", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(root);
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    symlinkSync(".", join(root, ".agents", "skills", "energon"));
    symlinkSync(".", join(root, ".claude", "skills", "energon"));
    runRender(["--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon"], { root });
    expect(existsSync(join(root, ".agents", "skills", "energon"))).toBe(false);
    expect(existsSync(join(root, ".claude", "skills", "energon"))).toBe(false);
    expect(existsSync(join(root, ".agents", "skills", "yourco-energon"))).toBe(false);
  });

  it("fails --check when a placeholder tree still has a marketplace catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(root);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{}\n");
    const { dirty } = runRender(["--check"], { root });
    expect(dirty).toContain(join(".claude-plugin", "marketplace.json"));
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(true);
  });
});

describe("render path safety", () => {
  it.each([
    ["--plugin", "../outside"],
    ["--skill", "nested/skill"],
    ["--marketplace", "nested\\marketplace"],
    ["--plugin", resolve("/tmp", "outside-plugin")],
  ])("rejects unsafe %s values before writing", (option, value) => {
    const root = makeDisposableRepo();
    const outside = join(root, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    const result = runRenderer(root, [
      "--init", "--skill", "new-skill", "--origin", "https://new.example.test", "--no-marketplace", option, value,
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
    expect(readFileSync(join(root, "instance-skill.json"), "utf8")).toContain('"plugin": "old-plugin"');
  });

  it("rejects unsafe identifiers loaded from instance-skill.json", () => {
    const root = makeDisposableRepo();
    const configPath = join(root, "instance-skill.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugin = "../outside";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const result = runRenderer(root, ["--init", "--skill", "new-skill", "--origin", "https://new.example.test"]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(configPath, "utf8")).toContain('"plugin": "../outside"');
  });

  it("refuses to replace an existing plugin destination", () => {
    const root = makeDisposableRepo();
    const destination = join(root, "plugins", "new-plugin");
    mkdirSync(destination, { recursive: true });
    const sentinel = join(destination, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    const result = runRenderer(root, [
      "--init", "--skill", "new-skill", "--plugin", "new-plugin", "--marketplace", "new-marketplace",
      "--origin", "https://new.example.test", "--no-marketplace",
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
    expect(existsSync(join(root, "plugins", "old-plugin", "skills", "old-skill", "SKILL.md"))).toBe(true);
  });

  it("rejects symlinked render destinations outside the root", () => {
    const root = makeDisposableRepo();
    const outside = join(root, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    symlinkSync(outside, join(root, "plugins", "old-plugin", "skills", "new-skill"));
    const result = runRenderer(root, [
      "--init", "--skill", "new-skill", "--plugin", "old-plugin", "--origin", "https://new.example.test", "--no-marketplace",
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
  });

  it("rejects symlinked autoload deletion targets outside the root", () => {
    const root = makeDisposableRepo();
    const outside = mkdtempSync(join(tmpdir(), "energon-outside-"));
    disposableRoots.push(outside);
    const sentinel = join(outside, "sentinel.txt");
    writeFileSync(sentinel, "must survive\n");
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    symlinkSync(outside, join(root, ".agents", "skills", "old-skill"));
    const result = runRenderer(root, ["--init", "--skill", "new-skill", "--origin", "https://new.example.test"]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("must survive\n");
  });

  it("keeps valid fork initialization behavior", () => {
    const root = makeDisposableRepo();
    const result = runRenderer(root, [
      "--init", "--skill", "new-skill", "--plugin", "new-plugin", "--marketplace", "new-marketplace",
      "--origin", "https://new.example.test", "--repo", "new-org/new-repo", "--no-marketplace",
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(existsSync(join(root, "plugins", "new-plugin", "skills", "new-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "plugins", "old-plugin"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "new-skill", plugin: "new-plugin", marketplace: "new-marketplace",
    });
  });
});
