import { render } from "../scripts/skill-template.mjs";
import { PRODUCT } from "./config";
import templates from "./generated/skill-templates.js";
import { contentOrigin, json, methodNotAllowed } from "./http";
import { identityFromEnv, installLine } from "./instance";
import { agentSkillsDiscovery } from "./policy";
import { bakedProductVersion } from "./product-version";
import type { Env } from "./types";

export const AGENT_SKILLS_PREFIX = "/.well-known/agent-skills/";

type Bundle = { name: string; index: string; files: Map<string, string> };

let cached: { key: string; bundle: Bundle } | null = null;

const HEADERS = {
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=300",
};

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  py: "text/x-python; charset=utf-8",
};

/** Template variables match scripts/render-skill.mjs varsFrom, minus ORG (no runtime source). */
function skillVars(env: Env): Record<string, string> {
  const id = identityFromEnv(env);
  let host = id.origin;
  try {
    host = new URL(id.origin).host;
  } catch {
    /* keep raw */
  }
  return {
    SKILL_NAME: id.skill,
    PLUGIN_NAME: id.plugin,
    MARKETPLACE_NAME: id.marketplace,
    ORIGIN: id.origin,
    ORIGIN_HOST: host,
    TOKEN_ENV: id.tokenEnv,
    TOKEN_PREFIX: id.tokenPrefix,
    PRODUCT,
    MARKETPLACE_REPO: id.repo,
    MARKETPLACE_URL: `https://github.com/${id.repo}`,
    INSTALL_LINE: installLine(id),
    VERSION: bakedProductVersion() ?? "",
  };
}

function bundleFor(env: Env): Bundle {
  const vars = skillVars(env);
  const key = JSON.stringify(vars);
  if (cached?.key === key) return cached.bundle;
  const files = new Map<string, string>();
  for (const [rel, text] of Object.entries(templates).sort(([a], [b]) => a.localeCompare(b))) {
    if (rel.endsWith(".tmpl")) files.set(rel.slice(0, -".tmpl".length), render(text, vars));
    else files.set(rel, text);
  }
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(files.get("SKILL.md") ?? "")?.[1] ?? "";
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  if (!description) throw new Error("templates/skill/SKILL.md.tmpl has no frontmatter description");
  const index = JSON.stringify({ skills: [{ name: vars.SKILL_NAME, description, files: [...files.keys()] }] });
  const bundle = { name: vars.SKILL_NAME!, index, files };
  cached = { key, bundle };
  return bundle;
}

/** Origin serving the well-known skill, or null when the operator turned discovery off. */
export function agentSkillsOrigin(origin: string, env?: Env): string | null {
  if (!agentSkillsDiscovery(env || {})) return null;
  try {
    return env ? contentOrigin(env) : origin;
  } catch {
    // Unset CONTENT_ORIGIN: single-origin local runs serve it on the public origin.
    return origin;
  }
}

export function agentSkillsUrl(origin: string, env?: Env): string | null {
  const base = agentSkillsOrigin(origin, env);
  return base && `${base}${AGENT_SKILLS_PREFIX}`;
}

export function agentSkillsInstallLine(origin: string, env?: Env): string | null {
  const base = agentSkillsOrigin(origin, env);
  return base && `Well-known skill, no repository access needed: \`npx skills add ${base} -g\` installs this Energon's rendered skill from ${base}${AGENT_SKILLS_PREFIX}index.json. A tool gateway can load the same URL.`;
}

/** Serves `path` (already under AGENT_SKILLS_PREFIX); the caller decides which hosts may reach this. */
export function agentSkillsResponse(request: Request, env: Env, path: string): Response {
  const notFound = () => json({ error: "not_found", message: "No agent skill file at this path." }, 404);
  if (!agentSkillsDiscovery(env)) return notFound();
  const bundle = bundleFor(env);
  const rest = path.slice(AGENT_SKILLS_PREFIX.length);
  let body: string | undefined;
  let type: string | undefined;
  if (rest === "index.json") {
    body = bundle.index;
    type = "application/json; charset=utf-8";
  } else if (rest.startsWith(`${bundle.name}/`)) {
    const file = rest.slice(bundle.name.length + 1);
    body = bundle.files.get(file);
    type = CONTENT_TYPES[file.split(".").pop() ?? ""] ?? "text/plain; charset=utf-8";
  }
  if (body === undefined) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": type!, ...HEADERS } });
}
