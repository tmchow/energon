import { describe, expect, it } from "vitest";
import { agentSkillsResponse } from "../../src/agent-skills";
import { helpBody } from "../../src/auth";
import { llmsTxt } from "../../src/llms";
import type { Env } from "../../src/types";

const HUB = "https://hub.energon.example.com";
const CONTENT = "https://energon.example.com";
const BASE = { PUBLIC_ORIGIN: HUB, CONTENT_ORIGIN: CONTENT, SKILL_NAME: "acme" } as Env;
const WELL_KNOWN = `${CONTENT}/.well-known/agent-skills/`;

function get(env: Env, path: string): Response {
  return agentSkillsResponse(new Request(`${CONTENT}${path}`), env, path);
}

describe("well-known agent skills", () => {
  it("advertises the content-origin URL when the switch is unset", async () => {
    expect((helpBody(HUB, BASE) as { agent_skills_url: string | null }).agent_skills_url).toBe(WELL_KNOWN);
    expect(llmsTxt(HUB, BASE)).toContain(`npx skills add ${CONTENT}`);
    const index = get(BASE, "/.well-known/agent-skills/index.json");
    expect(index.status).toBe(200);
    expect(((await index.json()) as { skills: { name: string }[] }).skills[0]!.name).toBe("acme");
  });

  it("404s, reports null, and drops the llms line when switched off", async () => {
    const env = { ...BASE, AGENT_SKILLS_DISCOVERY: "false" } as Env;
    expect(get(env, "/.well-known/agent-skills/index.json").status).toBe(404);
    expect(get(env, "/.well-known/agent-skills/acme/SKILL.md").status).toBe(404);
    expect((helpBody(HUB, env) as { agent_skills_url: string | null }).agent_skills_url).toBeNull();
    expect(llmsTxt(HUB, env)).not.toContain("/.well-known/agent-skills/");
    expect(llmsTxt(HUB, env)).not.toContain(`npx skills add ${CONTENT}`);
  });

  it("keeps it on only for a truthy value once set", async () => {
    const on = { ...BASE, AGENT_SKILLS_DISCOVERY: "yes" } as Env;
    expect(get(on, "/.well-known/agent-skills/index.json").status).toBe(200);
    const typo = { ...BASE, AGENT_SKILLS_DISCOVERY: "on" } as Env;
    expect(get(typo, "/.well-known/agent-skills/index.json").status).toBe(404);
  });

  it("renders the instance token prefix and env into the served skill", async () => {
    const env = { ...BASE, TOKEN_PREFIX: "acme_tok_", TOKEN_ENV: "ACME_TOKEN" } as Env;
    const api = await get(env, "/.well-known/agent-skills/acme/references/api.md").text();
    expect(api).toContain("acme_tok_");
    expect(api).not.toContain("ee_live_");
    const skill = await get(env, "/.well-known/agent-skills/acme/SKILL.md").text();
    expect(skill).toContain("ACME_TOKEN");
    expect(skill).not.toContain("{{");
  });

  it("uses the public origin when no content origin is configured", () => {
    const env = { PUBLIC_ORIGIN: "http://127.0.0.1:8787" } as Env;
    expect((helpBody("http://127.0.0.1:8787", env) as { agent_skills_url: string | null }).agent_skills_url).toBe(
      "http://127.0.0.1:8787/.well-known/agent-skills/",
    );
  });
});
