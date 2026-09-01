#!/usr/bin/env node
/**
 * The committed plugin under plugins/ is the installable skill (complete
 * SKILL.md, no placeholders). templates/skill is only used to generate or
 * replace that skill.
 *
 * OSS ships a finished /energon skill. A fork runs --init to replace those
 * files. Skill name and marketplace name match (cybertron-energon@cybertron-energon).
 * The GitHub repo is this fork — read from `origin`, or pass --repo.
 *
 *   npm run skill:render
 *   npm run skill:render -- --check
 *   npm run skill:init -- --name cybertron --origin https://energon.cybertron.com
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMPL_DIR = join(ROOT, "templates", "skill");
const INSTANCE_PATH = join(ROOT, "instance-skill.json");

/** If instance-skill.json is missing, treat the tree as the public OSS skill. */
const OSS_DEFAULTS = {
  skill: "energon",
  plugin: "energon",
  marketplace: "energon",
  origin: "https://energon.example.com",
  tokenEnv: "ENERGON_TOKEN",
  tokenPrefix: "ee_live_",
  product: "Energon",
  org: "your company",
  repo: "tmchow/energon",
  marketplaceUrl: "https://github.com/tmchow/energon",
};

export function parseGitHubRepo(url) {
  if (!url) return "";
  const match = String(url).trim().match(/github\.com[:/]([^/]+)\/([^/#?]+)/i);
  if (!match) return "";
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

export function discoverRepo(root = ROOT) {
  try {
    const url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    return parseGitHubRepo(url);
  } catch {
    return "";
  }
}

export function brandFromName(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!s) return "";
  return s.endsWith("-energon") ? s : `${s}-energon`;
}

export function tokenEnvFromBrand(brand) {
  return `${String(brand).toUpperCase().replace(/-/g, "_")}_TOKEN`;
}

export function orgFromBrand(brand) {
  return String(brand)
    .replace(/-energon$/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadInstance() {
  if (!existsSync(INSTANCE_PATH)) return { ...OSS_DEFAULTS };
  const raw = JSON.parse(readFileSync(INSTANCE_PATH, "utf8"));
  const repo = raw.repo || raw.marketplaceRepo || OSS_DEFAULTS.repo;
  return { ...OSS_DEFAULTS, ...raw, repo, marketplaceRepo: repo };
}

function parseArgs(argv) {
  const prev = loadInstance();
  const out = { ...prev, check: false, init: false, updateMarketplace: true };
  const set = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === "--check") out.check = true;
    else if (a === "--init") out.init = true;
    else if (a === "--name") {
      out.name = next();
      set.add("name");
    } else if (a === "--skill") {
      out.skill = next();
      set.add("skill");
    } else if (a === "--plugin") {
      out.plugin = next();
      set.add("plugin");
    } else if (a === "--marketplace") {
      out.marketplace = next();
      set.add("marketplace");
    } else if (a === "--origin") {
      out.origin = next();
      set.add("origin");
    } else if (a === "--token-env") {
      out.tokenEnv = next();
      set.add("tokenEnv");
    } else if (a === "--token-prefix") {
      out.tokenPrefix = next();
      set.add("tokenPrefix");
    } else if (a === "--product") {
      out.product = next();
      set.add("product");
    } else if (a === "--org") {
      out.org = next();
      set.add("org");
    } else if (a === "--repo" || a === "--marketplace-repo") {
      out.repo = next();
      set.add("repo");
    } else if (a === "--marketplace-url") {
      out.marketplaceUrl = next();
      set.add("marketplaceUrl");
    } else if (a === "--no-marketplace") out.updateMarketplace = false;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  node scripts/render-skill.mjs [--check]
  node scripts/render-skill.mjs --init --name cybertron --origin URL

  --init                 replace the shipped skill with this host's values
  --name PREFIX          skill + marketplace become PREFIX-energon (cybertron → cybertron-energon)
  --skill NAME           slash command /NAME (defaults marketplace to the same NAME)
  --origin URL           public hostname, no trailing slash
  --repo OWNER/REPO      GitHub repo that is the marketplace. Default: git remote origin
  --token-env NAME       env var agents look for
  --org NAME             company name in prose
  --check                exit 1 if committed SKILL.md drifted`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }

  if (set.has("name")) {
    const brand = brandFromName(out.name);
    if (!brand) throw new Error("--name must be a slug, e.g. cybertron");
    if (!set.has("skill")) {
      out.skill = brand;
      set.add("skill");
    }
    if (!set.has("marketplace")) {
      out.marketplace = brand;
      set.add("marketplace");
    }
    if (!set.has("plugin")) {
      out.plugin = out.skill;
      set.add("plugin");
    }
    if (!set.has("tokenEnv")) out.tokenEnv = tokenEnvFromBrand(brand);
    if (!set.has("org")) out.org = orgFromBrand(brand);
  }

  if (!set.has("plugin")) out.plugin = out.skill;
  if (out.init && !set.has("marketplace")) out.marketplace = out.skill;
  out.origin = String(out.origin || "").replace(/\/$/, "");

  if (out.init && !set.has("repo")) {
    const found = discoverRepo();
    if (found) out.repo = found;
    if (found === "tmchow/energon" && out.skill !== "energon") {
      console.warn(
        "origin is still tmchow/energon. Fork first, or pass --repo your-org/energon so install points at this marketplace.",
      );
    }
  }
  if (!out.repo) out.repo = prev.repo || OSS_DEFAULTS.repo;
  if (!set.has("marketplaceUrl")) {
    out.marketplaceUrl = `https://github.com/${out.repo}`;
  }
  out.marketplaceRepo = out.repo;

  if (out.init && (!set.has("skill") || !out.origin)) {
    throw new Error("skill:init requires --name (or --skill) and --origin");
  }
  return { opts: out, prev, set };
}

function varsFrom(opts) {
  let host = opts.origin;
  try {
    host = new URL(opts.origin).host;
  } catch {
    /* keep raw */
  }
  return {
    SKILL_NAME: opts.skill,
    PLUGIN_NAME: opts.plugin,
    MARKETPLACE_NAME: opts.marketplace,
    ORIGIN: opts.origin,
    ORIGIN_HOST: host,
    TOKEN_ENV: opts.tokenEnv,
    TOKEN_PREFIX: opts.tokenPrefix,
    PRODUCT: opts.product,
    ORG: opts.org,
    MARKETPLACE_REPO: opts.marketplaceRepo,
    MARKETPLACE_URL: opts.marketplaceUrl,
    INSTALL_LINE: `${opts.plugin}@${opts.marketplace}`,
  };
}

function instancePayload(opts) {
  return {
    skill: opts.skill,
    plugin: opts.plugin,
    marketplace: opts.marketplace,
    origin: opts.origin,
    tokenEnv: opts.tokenEnv,
    tokenPrefix: opts.tokenPrefix,
    product: opts.product,
    org: opts.org,
    repo: opts.repo,
    marketplaceRepo: opts.repo,
    marketplaceUrl: opts.marketplaceUrl,
  };
}

function render(template, vars) {
  const missing = new Set();
  const text = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(vars[key]);
  });
  if (missing.size) throw new Error(`unknown template keys: ${[...missing].join(", ")}`);
  if (/\{\{[A-Z0-9_]+\}\}/.test(text)) throw new Error("unreplaced template tokens remain");
  return text;
}

function sameContents(path, contents) {
  if (!existsSync(path)) return false;
  const prev = readFileSync(path, "utf8");
  if (prev === contents) return true;
  if (path.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(prev)) === JSON.stringify(JSON.parse(contents));
    } catch {
      return false;
    }
  }
  return false;
}

function writeOrCheck(path, contents, check, dirty) {
  if (sameContents(path, contents)) return;
  dirty.push(relative(ROOT, path));
  if (check) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function upsertMarketplace(path, opts, check, dirty) {
  if (!existsSync(path)) return;
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.name = opts.marketplace;
  const current = json.plugins?.[0] || {};
  const pluginPath = `./plugins/${opts.plugin}`;
  const source =
    current.source && typeof current.source === "object"
      ? { ...current.source, path: pluginPath }
      : pluginPath;
  const plugin = {
    ...current,
    name: opts.plugin,
    source,
  };
  if (current.homepage !== undefined || opts.plugin !== current.name) plugin.homepage = opts.origin;
  json.plugins = [plugin];
  writeOrCheck(path, `${JSON.stringify(json, null, 2)}\n`, check, dirty);
}

function upsertPluginJson(path, opts, check, dirty) {
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const json = existing || {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: opts.plugin,
    version: "1.0.0",
    description: "Internal URLs for prototypes, markdown, and agent-made files so work can leave a session.",
    homepage: opts.origin,
    repository: opts.marketplaceUrl,
    keywords: [opts.skill, "static-hosting", "preview", "publish"],
    author: { name: opts.org, url: opts.marketplaceUrl },
  };
  json.name = opts.plugin;
  json.homepage = opts.origin;
  writeOrCheck(path, `${JSON.stringify(json, null, 2)}\n`, check, dirty);
}

function replacePluginTree(prev, opts, check) {
  if (check) return;
  const oldDir = join(ROOT, "plugins", prev.plugin);
  const newDir = join(ROOT, "plugins", opts.plugin);
  if (prev.plugin !== opts.plugin && existsSync(oldDir)) {
    if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true });
    cpSync(oldDir, newDir, { recursive: true });
    const oldSkillDir = join(newDir, "skills", prev.skill);
    const newSkillDir = join(newDir, "skills", opts.skill);
    if (prev.skill !== opts.skill && existsSync(oldSkillDir)) {
      mkdirSync(dirname(newSkillDir), { recursive: true });
      if (existsSync(newSkillDir)) rmSync(newSkillDir, { recursive: true, force: true });
      renameSync(oldSkillDir, newSkillDir);
    }
    rmSync(oldDir, { recursive: true, force: true });
  }

  const agentsSkills = join(ROOT, ".agents", "skills");
  if (!existsSync(agentsSkills)) return;
  const link = join(agentsSkills, opts.skill);
  const target = join("..", "..", "plugins", opts.plugin, "skills", opts.skill);
  const oldLink = join(agentsSkills, prev.skill);
  if (prev.skill !== opts.skill) {
    try {
      unlinkSync(oldLink);
    } catch {
      /* missing or already gone */
    }
  }
  try {
    if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link);
    if (!existsSync(link)) symlinkSync(target, link);
  } catch {
    /* hosts without symlink perms still have plugins/ */
  }
}

function main() {
  const { opts, prev } = parseArgs(process.argv.slice(2));
  const vars = varsFrom(opts);
  const dirty = [];

  if (opts.init && (prev.plugin !== opts.plugin || prev.skill !== opts.skill)) {
    replacePluginTree(prev, opts, opts.check);
  }

  const skillRel = join("plugins", opts.plugin, "skills", opts.skill);
  for (const file of readdirSync(TMPL_DIR)) {
    if (!file.endsWith(".tmpl")) continue;
    const name = file.replace(/\.tmpl$/, "");
    const rendered = render(readFileSync(join(TMPL_DIR, file), "utf8"), vars);
    const dest =
      name === "api.md"
        ? join(ROOT, skillRel, "references", "api.md")
        : join(ROOT, skillRel, name);
    writeOrCheck(dest, rendered, opts.check, dirty);
  }

  upsertPluginJson(join(ROOT, "plugins", opts.plugin, "plugin.json"), opts, opts.check, dirty);
  for (const extra of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const p = join(ROOT, "plugins", opts.plugin, extra);
    if (existsSync(p)) upsertPluginJson(p, opts, opts.check, dirty);
  }

  if (opts.updateMarketplace) {
    for (const rel of [
      "marketplace.json",
      ".claude-plugin/marketplace.json",
      ".github/plugin/marketplace.json",
      ".agents/plugins/marketplace.json",
    ]) {
      upsertMarketplace(join(ROOT, rel), opts, opts.check, dirty);
    }
  }

  if (opts.init) {
    writeOrCheck(INSTANCE_PATH, `${JSON.stringify(instancePayload(opts), null, 2)}\n`, opts.check, dirty);
  }

  if (opts.check) {
    if (dirty.length) {
      console.error(`skill render is stale:\n  ${dirty.join("\n  ")}\nRun: npm run skill:render`);
      process.exit(1);
    }
    console.log("skill render is current");
    return;
  }
  if (dirty.length) console.log(`wrote ${dirty.join(", ")}`);
  else console.log("skill files already match the template");
  console.log(`install ${vars.INSTALL_LINE}  origin ${vars.ORIGIN}  env ${vars.TOKEN_ENV}`);
  if (opts.init) {
    console.log(`Set wrangler [vars] SKILL_NAME=${opts.skill} MARKETPLACE_NAME=${opts.marketplace} MARKETPLACE_REPO=${opts.marketplaceRepo} TOKEN_ENV=${opts.tokenEnv} PUBLIC_ORIGIN=${opts.origin}`);
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
