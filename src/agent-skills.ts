import { render, skillTemplateVars } from "../scripts/skill-template.mjs";
import { PRODUCT } from "./config";
import templates from "./generated/skill-templates.js";
import { contentOrigin, json, methodNotAllowed } from "./http";
import { identityFromEnv } from "./instance";
import { agentSkillsDiscovery } from "./policy";
import { bakedProductVersion } from "./product-version";
import type { Env } from "./types";

export const AGENT_SKILLS_PREFIX = "/.well-known/agent-skills/";

type Bundle = { name: string; index: string; files: Map<string, string> };

const bundleCache = new WeakMap<Env, Bundle>();

const HEADERS = {
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=300",
};

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  py: "text/x-python; charset=utf-8",
};

function bundleFor(env: Env): Bundle {
  const hit = bundleCache.get(env);
  if (hit) return hit;
  const id = identityFromEnv(env);
  const name = id.skill;
  const vars = skillTemplateVars({
    ...id,
    product: PRODUCT,
    marketplaceRepo: id.repo,
    marketplaceUrl: `https://github.com/${id.repo}`,
    version: bakedProductVersion() ?? "",
  });
  const files = new Map<string, string>();
  for (const [rel, text] of Object.entries(templates)) {
    if (rel.endsWith(".tmpl")) files.set(rel.slice(0, -".tmpl".length), render(text, vars));
    else files.set(rel, text);
  }
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(files.get("SKILL.md") ?? "")?.[1] ?? "";
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  if (!description) throw new Error("templates/skill/SKILL.md.tmpl has no frontmatter description");
  const index = JSON.stringify({ skills: [{ name, description, files: [...files.keys()] }] });
  const bundle = { name, index, files };
  bundleCache.set(env, bundle);
  return bundle;
}

export type AgentSkillsLink = { url: string; installLine: string };

/**
 * Where this Energon serves its well-known skill, or null when discovery is off or CONTENT_ORIGIN is
 * set but invalid. Unset CONTENT_ORIGIN means a single-origin local run, which serves it on `origin`.
 */
export function agentSkillsLink(origin: string, env?: Env): AgentSkillsLink | null {
  if (!agentSkillsDiscovery(env || {})) return null;
  let base = origin;
  if (env && (env.CONTENT_ORIGIN || "").trim()) {
    try {
      base = contentOrigin(env);
    } catch {
      return null;
    }
  }
  const url = `${base}${AGENT_SKILLS_PREFIX}`;
  return {
    url,
    installLine: `Well-known skill, no repository access needed: \`npx skills add ${base} -g\` installs this Energon's rendered skill from ${url}index.json. A tool gateway can load the same URL.`,
  };
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
