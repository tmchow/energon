import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  brandFromName,
  parseGitHubRepo,
  readProductVersion,
  runRender,
  tokenEnvFromBrand,
} from "../../scripts/render-skill.mjs";
import { render } from "../../scripts/skill-template.mjs";
import skillTemplates from "../../src/generated/skill-templates.js";
import { WRITE_PASSWORD_HEADER } from "../../src/config";
import { GRANT_AUTH_HEADER, GRANT_UPLOAD_PREFIX } from "../../src/grant-protocol";

const CATALOG_PATHS = [
  "marketplace.json",
  ".claude-plugin/marketplace.json",
  ".github/plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
];

const disposableRoots: string[] = [];
const TEST_VERSION = "9.9.9";

function writeProductVersion(root: string, version = TEST_VERSION) {
  writeFileSync(join(root, "version.txt"), `${version}\n`);
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "energon-skill-"));
  disposableRoots.push(root);
  writeProductVersion(root);
  return root;
}

function pluginManifests(root: string, plugin: string) {
  return {
    generic: JSON.parse(readFileSync(join(root, "plugins", plugin, "plugin.json"), "utf8")),
    claude: JSON.parse(readFileSync(join(root, "plugins", plugin, ".claude-plugin", "plugin.json"), "utf8")),
    codex: JSON.parse(readFileSync(join(root, "plugins", plugin, ".codex-plugin", "plugin.json"), "utf8")),
  };
}

function marketplaceVersions(root: string) {
  return {
    root: JSON.parse(readFileSync(join(root, "marketplace.json"), "utf8")).plugins[0].version,
    claude: JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8")).plugins[0].version,
    github: JSON.parse(readFileSync(join(root, ".github", "plugin", "marketplace.json"), "utf8")).plugins[0].version,
    agents: JSON.parse(readFileSync(join(root, ".agents", "plugins", "marketplace.json"), "utf8")).plugins[0].version,
  };
}

function makeDisposableRepo() {
  const root = mkdtempSync(join(tmpdir(), "energon-render-"));
  disposableRoots.push(root);
  writeProductVersion(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(resolve("scripts/render-skill.mjs"), join(root, "scripts/render-skill.mjs"));
  cpSync(resolve("scripts/skill-template.mjs"), join(root, "scripts/skill-template.mjs"));
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
  it("the checkout matches its configured render state", () => {
    const result = spawnSync(process.execPath, ["scripts/render-skill.mjs", "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(existsSync(join(".agents", "skills", "energon"))).toBe(false);
    expect(existsSync(join(".claude", "skills", "energon"))).toBe(false);
  });

  it("skill templates name the write-password header from config", () => {
    const skill = readFileSync(resolve("templates/skill/SKILL.md.tmpl"), "utf8");
    const api = readFileSync(resolve("templates/skill/references/api.md.tmpl"), "utf8");
    expect(skill).toContain(WRITE_PASSWORD_HEADER);
    expect(api).toContain(WRITE_PASSWORD_HEADER);
  });

  it("skill templates name the upload-grant path and header from the grant protocol", () => {
    const skill = readFileSync(resolve("templates/skill/SKILL.md.tmpl"), "utf8");
    const api = readFileSync(resolve("templates/skill/references/api.md.tmpl"), "utf8");
    expect(skill).toContain(GRANT_AUTH_HEADER);
    expect(api).toContain(GRANT_AUTH_HEADER);
    expect(api).toContain(GRANT_UPLOAD_PREFIX);
  });

  it("rendered SKILL.md teaches gateway mode and the bundled helper", () => {
    const skill = render(skillTemplates["SKILL.md.tmpl"], {
      SKILL_NAME: "acme-energon",
      ORIGIN: "https://energon.acme.test",
      ORIGIN_HOST: "energon.acme.test",
      TOKEN_ENV: "ACME_ENERGON_TOKEN",
      TOKEN_PREFIX: "ee_live_",
      PRODUCT: "Energon",
      INSTALL_LINE: "acme-energon@acme-energon",
    });
    const hardRules = skill.slice(skill.indexOf("## Hard rules"), skill.indexOf("## Gateway mode"));
    expect(hardRules).toMatch(/1\. \*\*Gateway mode first\.\*\*.*search.*`mintGrant`.*`createDeployment`/);
    expect(hardRules).toContain("follow **Gateway mode** below instead");

    const gateway = skill.slice(skill.indexOf("## Gateway mode"), skill.indexOf("## Decide: site or loose file?"));
    expect(gateway).toContain("search the gateway");
    expect(gateway).toContain("never through the gateway");
    expect(gateway).toContain("GET https://energon.acme.test/v1/help");
    expect(gateway).toContain("agent_skills_url");
    expect(gateway).toContain('curl -fsS "${AGENT_SKILLS_URL}acme-energon/scripts/energon_publish.py"');
    expect(gateway).toContain("python3 scripts/energon_publish.py publish-file");
    expect(gateway).toContain("python3 scripts/energon_publish.py publish-folder");
    expect(gateway).toContain('"type":"site_deployment"');
    expect(gateway).toContain("same `deployment_id`");
    expect(gateway).toContain("/llms.txt");
    expect(gateway).not.toContain("Bearer $ACME_ENERGON_TOKEN");

    const scenarioE = skill.slice(skill.indexOf("## Scenario E"), skill.indexOf("## Scenario F"));
    expect(scenarioE).toContain("python3 scripts/energon_publish.py publish-folder ./dist --site-id {id}");
  });

  it("skill:init requires --name or --skill, and --origin", () => {
    expect(() => runRender(["--init"])).toThrow(/--name \(or --skill\) and --origin/);
  });
});

describe("shared skill renderer", () => {
  it("rejects unknown keys and leftover tokens", () => {
    expect(() => render("a {{KNOWN}} {{NOPE}}", { KNOWN: "x" })).toThrow("unknown template keys: NOPE");
    expect(() => render("{{A}}", { A: "{{B}}" })).toThrow("unreplaced template tokens remain");
  });

  it("the build bundles exactly the files under templates/skill with their raw contents", () => {
    const dir = resolve("templates/skill");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [relative(dir, join(d, e.name)).split(sep).join("/")],
      );
    const files = walk(dir).sort();
    expect(files).toContain("SKILL.md.tmpl");
    expect(Object.keys(skillTemplates).sort()).toEqual(files);
    for (const file of files) expect(skillTemplates[file]).toBe(readFileSync(join(dir, file), "utf8"));
  });

  it("renders the bundled skill from runtime identity without ORG", () => {
    const vars = {
      SKILL_NAME: "acme-energon",
      PLUGIN_NAME: "acme-energon",
      MARKETPLACE_NAME: "acme-energon",
      ORIGIN: "https://energon.acme.test",
      ORIGIN_HOST: "energon.acme.test",
      TOKEN_ENV: "ACME_ENERGON_TOKEN",
      TOKEN_PREFIX: "ee_live_",
      PRODUCT: "Energon",
      MARKETPLACE_REPO: "acme/energon",
      MARKETPLACE_URL: "https://github.com/acme/energon",
      INSTALL_LINE: "acme-energon@acme-energon",
      VERSION: TEST_VERSION,
    };
    for (const [file, template] of Object.entries(skillTemplates)) {
      if (!file.endsWith(".tmpl")) continue;
      const text = render(template, vars);
      expect(text).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    }
    expect(render(skillTemplates["SKILL.md.tmpl"], vars)).toContain("energon.acme.test");
  });

  it("renders the upload helper with the instance identity and no leftover placeholders", () => {
    const helper = render(skillTemplates["scripts/energon_publish.py.tmpl"], {
      SKILL_NAME: "acme-energon",
      ORIGIN: "https://energon.acme.test",
      TOKEN_ENV: "ACME_ENERGON_TOKEN",
      TOKEN_PREFIX: "ee_live_",
      PRODUCT: "Energon",
    });
    expect(helper).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    expect(helper).toContain('DEFAULT_ORIGIN = "https://energon.acme.test"');
    expect(helper).toContain('TOKEN_ENV = "ACME_ENERGON_TOKEN"');
  });
});

describe("skill brand", () => {
  it.each([false, true])("keeps explicit value options over name defaults (name last: %s)", (nameLast) => {
    const root = makeTempRoot();
    const values = [
      "--skill", "custom-skill", "--plugin", "custom-plugin", "--marketplace", "custom-marketplace",
      "--origin", "https://first.example.test", "--origin", "https://custom.example.test/",
      "--token-env", "CUSTOM_TOKEN", "--token-prefix", "custom_", "--product", "Custom Product", "--org", "Custom Org",
      "--repo", "first/repo", "--marketplace-repo", "custom/repo", "--marketplace-url", "https://custom.example.test/install",
    ];
    const name = ["--name", "mybrand"];
    const { opts } = runRender(["--init", "--check", "--no-marketplace", ...(nameLast ? [...values, ...name] : [...name, ...values])], { root });
    expect(opts).toMatchObject({
      name: "mybrand", skill: "custom-skill", plugin: "custom-plugin", marketplace: "custom-marketplace",
      origin: "https://custom.example.test", tokenEnv: "CUSTOM_TOKEN", tokenPrefix: "custom_", product: "Custom Product", org: "Custom Org",
      repo: "custom/repo", marketplaceRepo: "custom/repo", marketplaceUrl: "https://custom.example.test/install",
      init: true, check: true, updateMarketplace: false,
    });
  });

  it("preserves argument errors and consumes a following flag as a value", () => {
    const root = makeTempRoot();
    expect(() => runRender(["--token-prefix"], { root })).toThrow("missing value for --token-prefix");
    expect(() => runRender(["toString"], { root })).toThrow("unknown arg: toString");
    expect(() => runRender(["--unknown"], { root })).toThrow("unknown arg: --unknown");
    expect(runRender(["--token-prefix", "--check"], { root }).opts).toMatchObject({ tokenPrefix: "--check", check: false });
  });

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
    const root = makeTempRoot();
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
    expect(skillMd).toContain("token_expired");
    expect(skillMd).toContain(WRITE_PASSWORD_HEADER);
    const plugin = JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf8"));
    expect(plugin.$schema).toContain("agent-plugins.org");
    expect(plugin.name).toBe("yourco-energon");
    expect(plugin.version).toBe(TEST_VERSION);
    expect(plugin.homepage).toBe("https://energon.your.co");
    expect(JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")).logo).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root, ".agents", "plugins", "marketplace.json"), "utf8")).plugins[0].source.path).toBe(
      "./plugins/yourco-energon",
    );
    const claudeMarket = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(claudeMarket.metadata.pluginRoot).toBeUndefined();
    expect(claudeMarket.plugins[0].source).toBe("./plugins/yourco-energon");
    expect(claudeMarket.plugins[0].skills).toEqual(["./skills/yourco-energon"]);
    expect(existsSync(join(root, ".agents", "skills"))).toBe(false);
    expect(existsSync(join(pluginDir, "logo.svg"))).toBe(true);
    expect(runRender(["--check"], { root }).dirty).toEqual([]);
    writeFileSync(join(pluginDir, "skills", "yourco-energon", "SKILL.md"), "stale");
    expect(runRender(["--check"], { root }).dirty).toContain(join("plugins", "yourco-energon", "skills", "yourco-energon", "SKILL.md"));
    runRender([], { root });
    expect(runRender(["--check"], { root }).dirty).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "yourco-energon",
      tokenEnv: "YOURCO_ENERGON_TOKEN",
    });
  });

  it("renders no plugin or catalogs before initialization", () => {
    const root = makeTempRoot();
    runRender([], { root });
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(runRender(["--check"], { root }).dirty).toEqual([]);
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "plugins", "marketplace.json"))).toBe(false);
    expect(existsSync(join(root, ".agents", "skills", "energon"))).toBe(false);
  });

  it.each([
    ["--skill", "energon"],
    ["--plugin", "energon"],
    ["--marketplace", "energon"],
    ["--name", "energon"],
    ["--origin", "https://energon.example.com"],
    ["--origin", "https://example.org"],
    ["--origin", "http://energon.your.co"],
    ["--origin", "https://energon.your.co/path"],
    ["--origin", "not-a-url"],
  ])("rejects unconfigured %s %s before writing", (option, value) => {
    const root = makeTempRoot();
    expect(() => runRender([
      "--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon", option, value,
    ], { root })).toThrow(/must name this Energon|must be an HTTPS origin/);
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, "instance-skill.json"))).toBe(false);
    for (const rel of CATALOG_PATHS) expect(existsSync(join(root, rel))).toBe(false);
  });

  it("validates upstream template variables without generating files", () => {
    const root = makeDisposableRepo();
    cpSync(resolve("instance-skill.json"), join(root, "instance-skill.json"));
    writeFileSync(join(root, "templates", "skill", "SKILL.md.tmpl"), "{{UNKNOWN_VARIABLE}}");
    const result = runRenderer(root, ["--check"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown template keys: UNKNOWN_VARIABLE");
    expect(existsSync(join(root, "plugins", "energon"))).toBe(false);
  });

  it("requires generic deployed identities to be renamed and supports that migration", () => {
    const root = makeTempRoot();
    writeFileSync(join(root, "instance-skill.json"), JSON.stringify({
      skill: "energon", plugin: "energon", marketplace: "energon", origin: "https://energon.your.co",
    }));
    mkdirSync(join(root, "plugins", "energon"), { recursive: true });
    writeFileSync(join(root, "plugins", "energon", "SKILL.md"), "old generic skill");
    expect(() => runRender([], { root })).toThrow(/must name this Energon/);
    expect(readFileSync(join(root, "plugins", "energon", "SKILL.md"), "utf8")).toBe("old generic skill");
    runRender(["--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon"], { root });
    expect(existsSync(join(root, "plugins", "energon"))).toBe(false);
    expect(existsSync(join(root, "plugins", "yourco-energon", "skills", "yourco-energon", "SKILL.md"))).toBe(true);
    expect(runRender(["--check"], { root }).dirty).toEqual([]);
  });

  it("reports a stale upstream placeholder without regenerating or changing it", () => {
    const root = makeTempRoot();
    const plugin = join(root, "plugins", "energon");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "SKILL.md"), "legacy placeholder");
    expect(runRender(["--check"], { root }).dirty).toContain(join("plugins", "energon"));
    expect(readFileSync(join(plugin, "SKILL.md"), "utf8")).toBe("legacy placeholder");
  });

  it("throws and writes nothing when --init has --name but no --origin", () => {
    const root = makeTempRoot();
    expect(() => runRender(["--init", "--name", "yourco"], { root })).toThrow(
      /--name \(or --skill\) and --origin/,
    );
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, ".claude-plugin"))).toBe(false);
    expect(existsSync(join(root, "instance-skill.json"))).toBe(false);
  });

  it("removes leftover project-local skill links", () => {
    const root = makeTempRoot();
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
    const root = makeTempRoot();
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{}\n");
    const { dirty } = runRender(["--check"], { root });
    expect(dirty).toContain(join(".claude-plugin", "marketplace.json"));
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(true);
  });

  it("rejects placeholder catalog cleanup through a symlinked parent", () => {
    const root = makeTempRoot();
    const outside = mkdtempSync(join(tmpdir(), "energon-outside-"));
    disposableRoots.push(outside);
    writeFileSync(join(outside, "marketplace.json"), "must survive\n");
    symlinkSync(outside, join(root, ".claude-plugin"));

    expect(() => runRender(["--check"], { root })).toThrow(/resolves outside/);
    expect(readFileSync(join(outside, "marketplace.json"), "utf8")).toBe("must survive\n");
  });
});

describe("plugin version", () => {
  const initArgs = ["--init", "--name", "yourco", "--origin", "https://energon.your.co", "--repo", "acme/energon"];

  it("reads the checkout version.txt triple", () => {
    expect(readProductVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("stamps version.txt onto generated plugin and marketplace manifests", () => {
    const root = makeTempRoot();
    const { vars } = runRender(initArgs, { root });
    expect(vars.VERSION).toBe(TEST_VERSION);
    const manifests = pluginManifests(root, "yourco-energon");
    expect(manifests.generic.version).toBe(TEST_VERSION);
    expect(manifests.claude.version).toBe(TEST_VERSION);
    expect(manifests.codex.version).toBe(TEST_VERSION);
    expect(marketplaceVersions(root)).toEqual({
      root: TEST_VERSION,
      claude: TEST_VERSION,
      github: TEST_VERSION,
      agents: TEST_VERSION,
    });
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "yourco-energon",
      plugin: "yourco-energon",
      marketplace: "yourco-energon",
      origin: "https://energon.your.co",
      repo: "acme/energon",
    });
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).not.toHaveProperty("version");
  });

  it("fails --check when generated manifests lag version.txt, then render catches up", () => {
    const root = makeTempRoot();
    runRender(initArgs, { root });
    writeProductVersion(root, "1.5.0");
    const stale = runRender(["--check"], { root }).dirty;
    expect(stale).toEqual(expect.arrayContaining([
      join("plugins", "yourco-energon", "plugin.json"),
      join("plugins", "yourco-energon", ".claude-plugin", "plugin.json"),
      join("plugins", "yourco-energon", ".codex-plugin", "plugin.json"),
      "marketplace.json",
      join(".claude-plugin", "marketplace.json"),
      join(".github", "plugin", "marketplace.json"),
      join(".agents", "plugins", "marketplace.json"),
    ]));
    expect(pluginManifests(root, "yourco-energon").generic.version).toBe(TEST_VERSION);

    runRender([], { root });
    expect(runRender(["--check"], { root }).dirty).toEqual([]);
    expect(pluginManifests(root, "yourco-energon").generic.version).toBe("1.5.0");
    expect(pluginManifests(root, "yourco-energon").claude.version).toBe("1.5.0");
    expect(pluginManifests(root, "yourco-energon").codex.version).toBe("1.5.0");
    expect(marketplaceVersions(root)).toEqual({
      root: "1.5.0",
      claude: "1.5.0",
      github: "1.5.0",
      agents: "1.5.0",
    });
    expect(JSON.parse(readFileSync(join(root, "instance-skill.json"), "utf8"))).toMatchObject({
      skill: "yourco-energon",
      repo: "acme/energon",
    });
  });

  it("fails clearly when version.txt is missing or invalid and writes nothing", () => {
    const missing = mkdtempSync(join(tmpdir(), "energon-skill-"));
    disposableRoots.push(missing);
    expect(() => runRender(initArgs, { root: missing })).toThrow(/version\.txt is missing/);
    expect(existsSync(join(missing, "plugins"))).toBe(false);

    for (const value of ["", "v1.4.0", "1.4.0-rc.1", "1.4", "latest"]) {
      const root = makeTempRoot();
      writeProductVersion(root, value);
      expect(() => runRender(initArgs, { root }), value).toThrow(/version\.txt must be a x\.y\.z triple/);
      expect(existsSync(join(root, "plugins"))).toBe(false);
    }
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


describe("publishing examples", () => {
  it("uses PUT for site uploads and response URLs for public content", () => {
    const skill = readFileSync(resolve("templates/skill/SKILL.md.tmpl"), "utf8");
    const api = readFileSync(resolve("templates/skill/references/api.md.tmpl"), "utf8");
    expect(skill).toContain("curl -sS -X PUT {{ORIGIN}}/v1/sites/{id}/files/index.html");
    for (const text of [skill, api]) {
      expect(text).not.toContain("{{ORIGIN}}/{handle}/");
      expect(text).not.toContain("Published `/sites`");
    }
    expect(api).toContain("then `index.md`");
  });
});
