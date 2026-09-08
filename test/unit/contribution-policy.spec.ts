import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = join(root, ".github/workflows");

function workflowFiles() {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({ name, body: readFileSync(join(workflowsDir, name), "utf8") }));
}

describe("contribution policy", () => {
  it("does not auto-close fork pull requests", () => {
    expect(existsSync(join(workflowsDir, "decline-fork-prs.yml"))).toBe(false);
  });

  it("runs CI on pull_request and never uses pull_request_target", () => {
    const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(ci).toMatch(/^on:\n  pull_request:$/m);
    expect(ci).toMatch(/^permissions:\n  contents: read$/m);
    for (const workflow of workflowFiles()) {
      expect(/^[ \t]*pull_request_target[ \t]*:/m.test(workflow.body)).toBe(false);
    }
  });

  it("keeps a PR template agents can fill without conventional-commit prefixes", () => {
    const template = readFileSync(join(root, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
    for (const heading of ["## What", "## Why", "## Verify", "## Risk", "## Authorship"]) {
      expect(template).toContain(heading);
    }
    expect(template).toContain("Required headings:");
    expect(template).toContain("Add extra ## headings when they help a reviewer.");
    expect([...template.matchAll(/^## .+$/gm)].map((match) => match[0])).toEqual([
      "## What",
      "## Why",
      "## Verify",
      "## Risk",
      "## Authorship",
    ]);
    expect(template).toContain("**Model:**");
    expect(template).toContain("**Human review:**");
    expect(template).toContain("**Tests:**");
    expect(template).toContain("**verify-energon:**");
    expect(template).toContain(".agents/skills/verify-energon/SKILL.md");
    expect(template).toContain("No feat:/fix:/chore: prefix");
    expect(template).not.toMatch(/^Fork PRs are closed automatically/m);
  });

  it("states that issues and pull requests are welcome", () => {
    const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
    expect(contributing).toContain("Issues and pull requests are welcome");
    expect(contributing).not.toContain("Pull requests are not.");
    expect(contributing).toContain("Do **not** use conventional-commit prefixes");
    expect(contributing).toContain("verify-energon skill");
    expect(contributing).toContain("Keep the required headings");
    expect(contributing).toContain("Add extra `##` sections when they help a reviewer");
  });

  it("tells agents to read and run the verify-energon skill", () => {
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain(".agents/skills/verify-energon/SKILL.md");
    expect(agents).toContain("name that file in Verify");
    expect(agents).toContain("Add extra `##` sections when they help a reviewer");
  });
});
