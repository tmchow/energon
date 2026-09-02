import { describe, expect, it } from "vitest";
import workflow from "../../.github/workflows/decline-fork-prs.yml?raw";

function jobCondition() {
  const condition = workflow.match(/^    if: (.+)$/m)?.[1];
  if (!condition) throw new Error("decline job condition is missing");
  return condition;
}

function evaluatesFor(condition: string, repository: string, headRepository: string) {
  const canonicalRepository = condition.match(/github\.repository == '([^']+)'/)?.[1];
  const checksForFork = condition.includes(
    "github.event.pull_request.head.repo.full_name != github.repository",
  );
  return repository === canonicalRepository && checksForFork && headRepository !== repository;
}

describe("decline fork pull request workflow policy", () => {
  it("only declines cross-repository PRs received by the canonical repository", () => {
    const condition = jobCondition();
    expect(condition).toBe(
      "github.repository == 'tmchow/energon' && github.event.pull_request.head.repo.full_name != github.repository",
    );
    const cases = [
      { repository: "tmchow/energon", headRepository: "contributor/energon", runs: true },
      { repository: "tmchow/energon", headRepository: "tmchow/energon", runs: false },
      { repository: "company/energon", headRepository: "contributor/energon", runs: false },
    ];

    for (const scenario of cases) {
      expect(evaluatesFor(condition, scenario.repository, scenario.headRepository)).toBe(scenario.runs);
    }
  });

  it("preserves the canonical no-unsolicited-PR response", () => {
    expect(workflow).toContain("`tmchow/energon` does not merge unsolicited pull requests.");
    expect(workflow).toContain("https://github.com/tmchow/energon/issues/new/choose");
    expect(workflow).toContain("https://github.com/tmchow/energon/blob/main/CONTRIBUTING.md");
  });
});
