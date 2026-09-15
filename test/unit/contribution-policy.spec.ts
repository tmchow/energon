import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
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

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(next));
    else if (entry.isFile()) out.push(next);
  }
  return out;
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

  it("keeps a PR template agents can fill with conventional-commit titles", () => {
    const template = readFileSync(join(root, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
    for (const heading of [
      "## What",
      "## Why",
      "## Verify",
      "## How to test",
      "## Risk",
      "## Authorship",
    ]) {
      expect(template).toContain(heading);
    }
    expect(template).toContain("Required headings:");
    expect(template).toContain("Add extra ## headings when they help a reviewer.");
    expect([...template.matchAll(/^## .+$/gm)].map((match) => match[0])).toEqual([
      "## What",
      "## Why",
      "## Verify",
      "## How to test",
      "## Risk",
      "## Authorship",
    ]);
    expect(template).toContain("**Model:**");
    expect(template).not.toContain("**Human review:**");
    expect(template).toContain("**Tests:**");
    expect(template).toContain("**verify-energon:**");
    expect(template).toContain("A triage agent will follow these steps");
    expect(template).toMatch(/^1\.\s*$/m);
    expect(template).toContain(".agents/skills/verify-energon/SKILL.md");
    expect(template).toContain("Conventional Commits");
    expect(template).not.toContain("No feat:/fix:/chore: prefix");
    expect(template).not.toMatch(/^Fork PRs are closed automatically/m);
  });

  it("states that issues and pull requests are welcome", () => {
    const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
    expect(contributing).toContain("Issues and pull requests are welcome");
    expect(contributing).not.toContain("Pull requests are not.");
    expect(contributing).toContain("Conventional Commits");
    expect(contributing).toContain("Pull request title");
    expect(contributing).not.toContain("Do **not** use conventional-commit prefixes");
    expect(contributing).toContain("verify-energon skill");
    expect(contributing).toContain("Keep the required headings");
    expect(contributing).toContain("Add extra `##` sections when they help a reviewer");
    expect(contributing).toContain("before you build");
    expect(contributing).toContain("How to test");
    expect(contributing).toContain("triage agent");
    expect(contributing).not.toContain("whether a human reviewed");
  });

  it("tells agents to read and run the verify-energon skill", () => {
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain(".agents/skills/verify-energon/SKILL.md");
    expect(agents).toContain("name that file in Verify");
    expect(agents).toContain("Add extra `##` sections when they help a reviewer");
    expect(agents).toContain("When you triage a PR, run **How to test** as written");
    expect(agents).toContain("Conventional Commit");
    expect(agents).toContain(".agents/skills/cut-release/SKILL.md");
    expect(agents).toContain(".agents/skills/update-from-upstream/SKILL.md");
    expect(agents).toContain(".agents/skills/deploy-this-energon/SKILL.md");
    expect(agents).toContain(".agents/skills/backup-this-energon/SKILL.md");
    expect(agents).toContain(
      "Only `verify-energon`, `cut-release`, `update-from-upstream`, `deploy-this-energon`, and `backup-this-energon` belong there",
    );
    expect(agents).toContain("Do not put the **publish** skill");
  });

  it("keeps release-please on canonical main and does not deploy", () => {
    const workflow = readFileSync(join(workflowsDir, "release-please.yml"), "utf8");
    expect(workflow).toMatch(/^on:\n  push:\n    branches: \[main\]$/m);
    expect(workflow).toContain('github.repository == \'tmchow/energon\'');
    expect(workflow).toContain("googleapis/release-please-action@");
    expect(workflow).not.toMatch(/^[ \t]*pull_request[ \t]*:/m);
    expect(/^[ \t]*pull_request_target[ \t]*:/m.test(workflow)).toBe(false);
    expect(workflow).not.toContain("wrangler deploy");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("issues: write");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(
      "An explicit `permissions` block without `issues: write` is none",
    );
    const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(ci).toMatch(/^permissions:\n  contents: read$/m);
    const config = readFileSync(join(root, "release-please-config.json"), "utf8");
    expect(config).toContain('"release-type": "simple"');
    expect(config).toContain('"type": "docs"');
    expect(config).toContain('"type": "ci"');
    expect(config).toContain('"type": "chore"');
    expect(config).toMatch(/"type": "docs",\s*"hidden": true/);
    expect(config).toMatch(/"type": "ci",\s*"hidden": true/);
    expect(config).toMatch(/"type": "chore",\s*"hidden": true/);
    expect(readFileSync(join(root, "CONTRIBUTING.md"), "utf8")).toContain("## Releases");
    const skill = readFileSync(join(root, ".agents/skills/cut-release/SKILL.md"), "utf8");
    expect(skill).toContain("node scripts/deployment-repo.mjs inspect");
    expect(skill).toContain("canonical: true");
    expect(skill).toContain('gh pr list --repo "$RELEASE_REPO" --label "autorelease: pending"');
  });

  it("ships deployment update and backup skills that resolve this checkout", () => {
    const update = readFileSync(join(root, ".agents/skills/update-from-upstream/SKILL.md"), "utf8");
    expect(update).toContain("node scripts/deployment-repo.mjs inspect");
    expect(update).toContain("`isFork: false` is valid");
    expect(update).toContain("docs/DEPLOYMENT-REPOSITORY.md");
    expect(update).toContain("time-travel info");
    expect(update).toContain("Do not create, delete, empty, or rebind");
    expect(update).toContain("ENABLE_PRODUCTION_DEPLOY");
    expect(update).toContain("push or merge to `main` is the deploy");
    expect(update).toContain("do not treat this as off");
    expect(update).toContain("does not redeploy this commit");
    expect(update).toContain("deployment is on or unknown");
    expect(update).toContain("unless the operator authorized");
    expect(update).not.toMatch(/automatically deploy|deploy automatically|default to deploy/i);
    expect(update).toContain("node scripts/deployment-repo.mjs landing-path --deploy off");
    expect(update).toContain("Never squash, rebase away upstream history, or force-push");
    expect(update).toContain("The temporary local branch is not a PR");
    expect(update).toContain("`policy unknown` means the policy read failed");
    expect(update).toContain("Reuse existing authorization");
    expect(update).toContain("updated source, not an updated Energon");
    expect(update).toContain("contributions to upstream still go through the upstream PR process");
    expect(update).not.toMatch(/reviewable (release )?update/i);

    const repoDoc = readFileSync(join(root, "docs/DEPLOYMENT-REPOSITORY.md"), "utf8");
    expect(repoDoc).toContain("### Choose how to land");
    expect(repoDoc).toContain("### Verify what landed");
    expect(repoDoc).toContain("node scripts/deployment-repo.mjs landing-path --deploy off");
    expect(repoDoc).toContain("| `push-main` |");
    expect(repoDoc).toContain("| `pull-request` |");
    expect(repoDoc).toContain("| `blocked` |");
    expect(repoDoc).toContain("Do not assume \"unprotected\" and do not assume \"PR required\"");
    expect(repoDoc).toContain("Never squash, rebase away upstream commits, or force-push");
    expect(repoDoc).toContain("always use the process in [CONTRIBUTING.md](../CONTRIBUTING.md)");

    const install = readFileSync(join(root, "INSTALL.md"), "utf8");
    expect(install).toContain("Installation is two parts:");
    expect(install).toContain("That section owns the landing decision");
    expect(install).toContain("reuse authorization already given");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("A failed policy read is unknown, not a default");
    expect(install).toContain("After the first deploy: optional automatic updates");

    const deploy = readFileSync(join(root, ".agents/skills/deploy-this-energon/SKILL.md"), "utf8");
    expect(deploy).toContain("node scripts/deployment-repo.mjs inspect");
    expect(deploy).toContain("canonical: false");
    expect(deploy).toContain("PASTE_FROM_WRANGLER_D1_CREATE");
    expect(deploy).toContain("Development work does not authorize production changes");
    expect(deploy).toContain("Never default to deploying");
    expect(deploy).toContain("time-travel info");
    expect(deploy).toContain("migrations apply <database_name> --remote");
    expect(deploy).toContain("ENABLE_PRODUCTION_DEPLOY");
    expect(deploy).toContain("do not treat this as off");
    expect(deploy).toContain("Never stamp `d1_migrations`");
    expect(deploy).toContain("Do not adopt, create, delete, empty, or rebind");
    expect(deploy).toContain("**Verify the installation**");
    expect(deploy).not.toMatch(/automatically deploy|deploy automatically/i);
    expect(install).toContain(".agents/skills/deploy-this-energon/SKILL.md");
    expect(update).toContain("`deploy-this-energon`");

    const backup = readFileSync(join(root, ".agents/skills/backup-this-energon/SKILL.md"), "utf8");
    expect(backup).toContain("wrangler.toml");
    expect(backup).toContain("time-travel info");
    expect(backup).toContain("PASTE_FROM_WRANGLER_D1_CREATE");
    expect(backup).toContain("Do not restore");
    expect(backup).toContain("incomplete");
    expect(backup).not.toMatch(/automatically restore|restore automatically/i);
  });

  it("keeps shipped skill names, symlinks, and cross-references in sync", () => {
    const skillsDir = join(root, ".agents/skills");
    const skillNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of skillNames) {
      const skill = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
      expect(skill.match(/^name: (.+)$/m)?.[1], `${name}/SKILL.md frontmatter name`).toBe(name);
    }

    for (const mirror of [".claude/skills", ".cursor/skills"]) {
      const links = readdirSync(join(root, mirror)).sort();
      expect(links, `${mirror} entries`).toEqual(skillNames);
      for (const name of links) {
        expect(readlinkSync(join(root, mirror, name)), `${mirror}/${name} target`).toBe(
          `../../.agents/skills/${name}`,
        );
      }
    }

    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    const listed = agents.match(/Only (`[^`]+`(?:, `[^`]+`)*, and `[^`]+`) belong there/)?.[1];
    expect(listed, "AGENTS.md allowed-skill list").toBeDefined();
    expect([...listed!.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort()).toEqual(skillNames);
    for (const name of skillNames) {
      expect(agents).toContain(`.agents/skills/${name}/SKILL.md`);
      expect(agents).toContain(`| \`.agents/skills/${name}/\` |`);
    }

    const prose = [
      join(root, "AGENTS.md"),
      join(root, "INSTALL.md"),
      join(root, "CONTRIBUTING.md"),
      ...walkFiles(join(root, "docs")).filter((file) => file.endsWith(".md")),
      ...walkFiles(skillsDir).filter((file) => file.endsWith(".md")),
    ];
    for (const file of prose) {
      const body = readFileSync(file, "utf8");
      for (const match of body.matchAll(/`([a-z0-9-]+)` skill\b/g)) {
        expect(skillNames, `${file} references skill \`${match[1]}\``).toContain(match[1]);
      }
      for (const match of body.matchAll(/\.agents\/skills\/([a-z0-9-]+)\//g)) {
        expect(skillNames, `${file} links .agents/skills/${match[1]}/`).toContain(match[1]);
      }
    }
  });

  it("does not hard-code tmchow/energon in shipped skills", () => {
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toMatch(
      /Skills under `\.agents\/skills\/` ship in every deployment repository[\s\S]*Do not hard-code destination repository coordinates/,
    );
    expect(agents).toContain("Do not put `tmchow/energon` in these files.");
    for (const file of walkFiles(join(root, ".agents/skills"))) {
      expect(readFileSync(file, "utf8").includes("tmchow/energon"), file).toBe(false);
    }
  });

  it("lints PR titles as conventional commits without pull_request_target", () => {
    const workflow = readFileSync(join(workflowsDir, "pr-title.yml"), "utf8");
    expect(workflow).toContain("edited");
    expect(workflow).toContain("scripts/check-pr-title.mjs");
    expect(workflow).toContain("github.event.pull_request.title");
    expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
    expect(/^[ \t]*pull_request_target[ \t]*:/m.test(workflow)).toBe(false);
    expect(readFileSync(join(root, "test/tsconfig.json"), "utf8")).toContain("pr-title.spec.ts");
  });
});
