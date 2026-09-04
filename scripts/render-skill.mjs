#!/usr/bin/env node
/**
 * templates/ is the source. plugins/ is a render of those templates.
 *
 * Upstream validates templates without generating a plugin or catalogs.
 *
 * A fork runs --init. That writes plugins/{name}/, the harness catalogs, and
 * instance-skill.json. Commit those; that repo is the marketplace.
 *
 *   npm run skill:render
 *   npm run skill:render -- --check
 *   npm run skill:init -- --name cybertron --origin https://energon.cybertron.com
 */
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_TMPL_DIR = join(SCRIPT_ROOT, "templates", "skill");
const PLUGIN_TMPL_DIR = join(SCRIPT_ROOT, "templates", "plugin");
const MARKETPLACE_TMPL_DIR = join(SCRIPT_ROOT, "templates", "marketplace");

const MARKETPLACES = [
  { rel: "marketplace.json", tmpl: "claude.json.tmpl" },
  { rel: ".claude-plugin/marketplace.json", tmpl: "claude.json.tmpl" },
  { rel: ".github/plugin/marketplace.json", tmpl: "github.json.tmpl" },
  { rel: ".agents/plugins/marketplace.json", tmpl: "agents.json.tmpl" },
];

/** Missing instance configuration leaves the tree uninitialized. */
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

const SAFE_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_FIELDS = ["skill", "plugin", "marketplace"];

function hasPath(path) {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a safe single-segment slug`);
  }
}

/** Check lexical containment and resolve every existing ancestor for symlink escapes. */
function assertPathInside(root, candidate, label) {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  if (!isContained(rootPath, candidatePath)) {
    throw new Error(`${label} resolves outside ${rootPath}`);
  }

  const rootReal = realpathSync(rootPath);
  let ancestor = candidatePath;
  while (!hasPath(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`${label} has no existing parent`);
    ancestor = parent;
  }
  const candidateReal = resolve(realpathSync(ancestor), relative(ancestor, candidatePath));
  if (!isContained(rootReal, candidateReal)) {
    throw new Error(`${label} resolves outside ${rootReal}`);
  }
  return candidatePath;
}

function assertMutationPath(root, scope, candidate, label) {
  const candidatePath = assertPathInside(root, candidate, label);
  const scopePath = resolve(scope);
  if (!isContained(scopePath, candidatePath)) {
    throw new Error(`${label} resolves outside ${scopePath}`);
  }
  if (hasPath(scopePath)) assertPathInside(scopePath, candidatePath, label);
}

function validateIdentifiers(opts, source) {
  for (const field of IDENTIFIER_FIELDS) {
    assertIdentifier(opts[field], `${source} ${field}`);
  }
}

export function parseGitHubRepo(url) {
  if (!url) return "";
  const match = String(url).trim().match(/github\.com[:/]([^/]+)\/([^/#?]+)/i);
  if (!match) return "";
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

export function discoverRepo(root = SCRIPT_ROOT) {
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

function instancePath(root) {
  return join(root, "instance-skill.json");
}

function loadInstance(root) {
  try {
    const raw = JSON.parse(readFileSync(instancePath(root), "utf8"));
    const repo = raw.repo || raw.marketplaceRepo || OSS_DEFAULTS.repo;
    const opts = { ...OSS_DEFAULTS, ...raw, repo, marketplaceRepo: repo };
    validateIdentifiers(opts, "instance configuration");
    return opts;
  } catch (err) {
    if (err && err.code === "ENOENT") return { ...OSS_DEFAULTS };
    throw err;
  }
}

function parseArgs(argv, root) {
  const prev = loadInstance(root);
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

  --init                 write this host's plugin package and marketplace catalogs
  --name PREFIX          skill + marketplace become PREFIX-energon (cybertron → cybertron-energon)
  --skill NAME           slash command /NAME (defaults marketplace to the same NAME)
  --origin URL           public hostname, no trailing slash
  --repo OWNER/REPO      GitHub repo that is the marketplace. Default: git remote origin
  --token-env NAME       env var agents look for
  --org NAME             company name in prose
  --check                exit 1 if committed files drifted from templates`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }

  if (set.has("name")) {
    assertIdentifier(out.name, "--name");
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
    const found = discoverRepo(root);
    if (found) out.repo = found;
    if (found === "tmchow/energon" && out.skill !== "energon") {
      console.warn(
        "origin is still tmchow/energon. Fork first, or pass --repo your-org/energon so install points at this marketplace.",
      );
    }
  }
  if (!out.repo) out.repo = prev.repo || OSS_DEFAULTS.repo;
  if (!set.has("marketplaceUrl")) out.marketplaceUrl = `https://github.com/${out.repo}`;
  out.marketplaceRepo = out.repo;

  if (out.init && (!set.has("skill") || !set.has("origin"))) {
    throw new Error("skill:init requires --name (or --skill) and --origin");
  }
  validateIdentifiers(out, "argument");
  if (out.init || !isPlaceholder(out)) validateInstance(out);
  return { opts: out, prev };
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

function withTrailingNewline(text) {
  return `${String(text).replace(/\n$/, "")}\n`;
}

function sameContents(path, contents) {
  let prev;
  try {
    prev = readFileSync(path);
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
  const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (Buffer.compare(prev, next) === 0) return true;
  if (path.endsWith(".json") && !Buffer.isBuffer(contents)) {
    try {
      return JSON.stringify(JSON.parse(prev.toString("utf8"))) === JSON.stringify(JSON.parse(contents));
    } catch {
      return false;
    }
  }
  return false;
}

function writeOrCheck(root, path, contents, check, dirty) {
  if (sameContents(path, contents)) return;
  dirty.push(relative(root, path));
  if (check) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function isPlaceholder(opts) {
  return opts.origin === OSS_DEFAULTS.origin &&
    IDENTIFIER_FIELDS.every((field) => opts[field] === OSS_DEFAULTS[field]);
}

function validateInstance(opts) {
  for (const field of IDENTIFIER_FIELDS) {
    if (opts[field] === "energon" || opts[field] === "energon-energon") {
      throw new Error(`${field} must identify your instance; run skill:init with --name YOUR_ORG`);
    }
  }
  let origin;
  try {
    origin = new URL(opts.origin);
  } catch {
    throw new Error("origin must be an HTTPS origin for your deployed host");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash ||
      /(^|\.)example\.(com|net|org)\.?$/i.test(origin.hostname)) {
    throw new Error("origin must be an HTTPS origin for your deployed host, without placeholder domains");
  }
}

function validateTemplates(vars) {
  for (const dir of [PLUGIN_TMPL_DIR, SKILL_TMPL_DIR, MARKETPLACE_TMPL_DIR]) {
    for (const file of listTmplFiles(dir)) {
      if (file.endsWith(".tmpl")) render(readFileSync(join(dir, file), "utf8"), vars);
    }
  }
}

function entryExists(path) {
  return hasPath(path);
}

const AUTOLOAD_SKILL_DIRS = [
  [".agents", "skills"],
  [".claude", "skills"],
];

function pluginRel(opts, ...parts) {
  return join("plugins", opts.plugin, ...parts);
}

function listTmplFiles(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? join(prefix, name.name) : name.name;
    if (name.isDirectory()) out.push(...listTmplFiles(join(dir, name.name), rel));
    else out.push(rel);
  }
  return out;
}

function templateDestinations(root, tmplDir, destPrefix) {
  return listTmplFiles(tmplDir).map((file) =>
    join(root, destPrefix, file.endsWith(".tmpl") ? file.replace(/\.tmpl$/, "") : file),
  );
}

/** Validate every path that a render may delete or write before doing any mutation. */
function validateMutationTargets(root, prev, opts, catalogsRequired) {
  realpathSync(root);
  const pluginsRoot = join(root, "plugins");
  const pluginTargets = [
    ...templateDestinations(root, PLUGIN_TMPL_DIR, pluginRel(opts)),
    ...templateDestinations(root, SKILL_TMPL_DIR, pluginRel(opts, "skills", opts.skill)),
  ];
  const rootTargets = [];
  if (opts.updateMarketplace) {
    for (const { rel } of MARKETPLACES) {
      const target = join(root, rel);
      if (catalogsRequired || entryExists(target)) rootTargets.push(target);
    }
  }
  if (opts.init) rootTargets.push(instancePath(root));

  if (opts.init && prev.plugin !== opts.plugin) {
    const destination = join(root, "plugins", opts.plugin);
    if (entryExists(destination)) {
      throw new Error(`refusing to replace existing plugin destination ${destination}`);
    }
    pluginTargets.push(join(root, "plugins", prev.plugin));
  } else if (opts.init && prev.skill !== opts.skill) {
    pluginTargets.push(join(root, "plugins", opts.plugin, "skills", prev.skill));
  }

  for (const name of new Set([prev.skill, opts.skill].filter(Boolean))) {
    for (const parts of AUTOLOAD_SKILL_DIRS) {
      const target = join(root, ...parts, name);
      if (entryExists(target)) rootTargets.push(target);
    }
  }
  for (const target of pluginTargets) assertMutationPath(root, pluginsRoot, target, "plugin render target");
  for (const target of rootTargets) assertPathInside(root, target, "render target");
}

function removeStalePlugin(root, prev, opts, check) {
  if (check) return;
  if (prev.plugin !== opts.plugin) {
    rmSync(join(root, "plugins", prev.plugin), { recursive: true, force: true });
  } else if (prev.skill !== opts.skill) {
    rmSync(join(root, "plugins", opts.plugin, "skills", prev.skill), { recursive: true, force: true });
  }
}

function dropAutoloadSkills(root, names, check, dirty) {
  for (const name of new Set(names.filter(Boolean))) {
    for (const parts of AUTOLOAD_SKILL_DIRS) {
      const rel = join(...parts, name);
      const dest = join(root, rel);
      if (!entryExists(dest)) continue;
      dirty.push(rel);
      if (!check) rmSync(dest, { recursive: true, force: true });
    }
  }
}

function rejectPlaceholderCatalogs(root, check, dirty) {
  for (const { rel } of MARKETPLACES) {
    const dest = join(root, rel);
    if (!entryExists(dest)) continue;
    dirty.push(rel);
    if (!check) rmSync(dest, { recursive: true, force: true });
  }
}

function writeTmplTree(root, tmplDir, destPrefix, vars, check, dirty) {
  for (const file of listTmplFiles(tmplDir)) {
    const src = join(tmplDir, file);
    const dest = join(root, destPrefix, file.endsWith(".tmpl") ? file.replace(/\.tmpl$/, "") : file);
    const contents = file.endsWith(".tmpl")
      ? withTrailingNewline(render(readFileSync(src, "utf8"), vars))
      : readFileSync(src);
    writeOrCheck(root, dest, contents, check, dirty);
  }
}

function writePluginTree(root, opts, vars, check, dirty) {
  writeTmplTree(root, PLUGIN_TMPL_DIR, pluginRel(opts), vars, check, dirty);
  writeTmplTree(root, SKILL_TMPL_DIR, pluginRel(opts, "skills", opts.skill), vars, check, dirty);
}

function writeMarketplaces(root, opts, vars, check, dirty, required) {
  if (!opts.updateMarketplace) return;
  if (!required) {
    rejectPlaceholderCatalogs(root, check, dirty);
    return;
  }
  const rendered = new Map();
  for (const { rel, tmpl } of MARKETPLACES) {
    const dest = join(root, rel);
    if (!rendered.has(tmpl)) {
      rendered.set(
        tmpl,
        withTrailingNewline(render(readFileSync(join(MARKETPLACE_TMPL_DIR, tmpl), "utf8"), vars)),
      );
    }
    writeOrCheck(root, dest, rendered.get(tmpl), check, dirty);
  }
}

export function runRender(argv, { root = SCRIPT_ROOT } = {}) {
  const { opts, prev } = parseArgs(argv, root);
  const vars = varsFrom(opts);
  const dirty = [];
  const catalogsRequired = opts.init || (opts.updateMarketplace && !isPlaceholder(opts));

  validateMutationTargets(root, prev, opts, catalogsRequired);
  if (opts.init && (prev.plugin !== opts.plugin || prev.skill !== opts.skill)) {
    removeStalePlugin(root, prev, opts, opts.check);
  }
  dropAutoloadSkills(root, [prev.skill, opts.skill], opts.check, dirty);
  if (isPlaceholder(opts)) {
    validateTemplates(vars);
    const placeholder = pluginRel(opts);
    if (entryExists(join(root, placeholder))) dirty.push(placeholder);
  } else {
    writePluginTree(root, opts, vars, opts.check, dirty);
  }
  writeMarketplaces(root, opts, vars, opts.check, dirty, catalogsRequired);
  if (opts.init) {
    writeOrCheck(root, instancePath(root), `${JSON.stringify(instancePayload(opts), null, 2)}\n`, opts.check, dirty);
  }
  return { opts, vars, dirty };
}

function main() {
  const { opts, dirty } = runRender(process.argv.slice(2));
  if (opts.check) {
    if (dirty.length) {
      console.error(`skill drift: ${dirty.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("skill is up to date");
    }
  } else if (isPlaceholder(opts)) {
    if (dirty.includes(pluginRel(opts))) {
      console.error("placeholder plugin remains; remove plugins/energon or run skill:init for your instance");
      process.exitCode = 1;
    } else {
      console.log("templates validated; run skill:init with your instance name and origin to generate a plugin");
    }
  } else {
    console.log(`rendered ${opts.plugin}/${opts.skill}${dirty.length ? ` (${dirty.length} changed)` : ""}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
