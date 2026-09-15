import { describe, expect, it } from "vitest";
import { decideLandingPath, inspectBranchPolicy, parseLandingArgs } from "../../scripts/deployment-repo.mjs";

type Reply = string | { error: string };

function ghFixture(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const run = (command: string, args: string[]) => {
    const path = args[1];
    calls.push(`${command} ${args.join(" ")}`);
    const reply = replies[path];
    if (reply === undefined) throw new Error(`unexpected call ${path}`);
    if (typeof reply !== "string") {
      const error = new Error(reply.error) as Error & { stderr: string };
      error.stderr = reply.error;
      throw error;
    }
    return reply;
  };
  return { run, calls };
}

const repo = "company/energon";
const protectionPath = `repos/${repo}/branches/main/protection`;
const rulesPath = `repos/${repo}/rules/branches/main`;
const unprotected = { [protectionPath]: { error: "HTTP 404: Branch not protected" }, [rulesPath]: "[]" };
const prRequired = {
  [protectionPath]: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 } }),
  [rulesPath]: JSON.stringify([{ type: "pull_request" }, { type: "non_fast_forward" }]),
};

describe("update landing path", () => {
  it("pushes main directly for an ordinary personal update", () => {
    const f = ghFixture(unprotected);
    const policy = inspectBranchPolicy(repo, "main", "/tmp", f.run);
    expect(policy).toEqual({ status: "known", repository: repo, branch: "main", requiresPullRequest: false, blocksMergeCommits: false, sources: [] });
    expect(f.calls).toEqual([`gh api ${protectionPath}`, `gh api ${rulesPath}`]);
    const decision = decideLandingPath({ policy, deployment: { status: "off" } });
    expect(decision).toEqual({ path: "push-main", reasons: [] });
  });

  it("uses a pull request when the company repository requires one", () => {
    const f = ghFixture(prRequired);
    const policy = inspectBranchPolicy(repo, "main", "/tmp", f.run);
    expect(policy.requiresPullRequest).toBe(true);
    const decision = decideLandingPath({ policy, deployment: { status: "off" } });
    expect(decision.path).toBe("pull-request");
    expect(decision.reasons).toEqual(["a pull request is required"]);
    const instructed = decideLandingPath({
      policy: { status: "known", requiresPullRequest: false, sources: [] },
      instructionsRequirePullRequest: true,
    });
    expect(instructed.path).toBe("pull-request");
    expect(instructed.reasons).toEqual(["this repository's instructions require a pull request"]);
    const both = decideLandingPath({ policy, instructionsRequirePullRequest: true });
    expect(both.reasons).toEqual(["this repository's instructions require a pull request", "a pull request is required"]);
  });

  it("routes status checks and push restrictions through a pull request and blocks linear-history branches", () => {
    const checks = inspectBranchPolicy(repo, "main", "/tmp", ghFixture({
      [protectionPath]: JSON.stringify({ required_status_checks: { contexts: ["ci"] }, restrictions: { users: [] } }),
      [rulesPath]: JSON.stringify([{ type: "required_signatures" }]),
    }).run);
    expect(checks.requiresPullRequest).toBe(true);
    expect(checks.sources).toEqual([
      "status checks must pass before a push lands",
      "commits must be signed",
      "pushes to the branch are restricted",
    ]);
    expect(decideLandingPath({ policy: checks, deployment: { status: "off" } }).path).toBe("pull-request");
    const disabledFlags = inspectBranchPolicy(repo, "main", "/tmp", ghFixture({
      [protectionPath]: JSON.stringify({
        required_signatures: { enabled: false },
        required_linear_history: { enabled: false },
        allow_force_pushes: { enabled: false },
      }),
      [rulesPath]: "[]",
    }).run);
    expect(disabledFlags).toMatchObject({ requiresPullRequest: false, blocksMergeCommits: false, sources: [] });
    const linear = inspectBranchPolicy(repo, "main", "/tmp", ghFixture({
      [protectionPath]: { error: "HTTP 404: Branch not protected" },
      [rulesPath]: JSON.stringify([{ type: "required_linear_history" }]),
    }).run);
    expect(linear.blocksMergeCommits).toBe(true);
    const decision = decideLandingPath({ policy: linear, deployment: { status: "off" } });
    expect(decision.path).toBe("blocked");
    expect(decision.reasons[0]).toContain("linear history is required");
  });

  it("uses a pull request when the operator asks for review even on an unprotected branch", () => {
    const policy = inspectBranchPolicy(repo, "main", "/tmp", ghFixture(unprotected).run);
    const decision = decideLandingPath({ policy, reviewRequested: true, deployment: { status: "off" } });
    expect(decision).toEqual({ path: "pull-request", reasons: ["the operator asked for review"] });
  });

  it("uses a pull request when a conflict needs a human decision", () => {
    const policy = inspectBranchPolicy(repo, "main", "/tmp", ghFixture(unprotected).run);
    const decision = decideLandingPath({
      policy,
      unresolvedDecisions: ["wrangler.toml: upstream added ROUTE_MODE; this installation customizes routes"],
      deployment: { status: "off" },
    });
    expect(decision.path).toBe("pull-request");
    expect(decision.reasons[0]).toMatch(/^needs a human decision: wrangler\.toml/);
  });

  it("treats a failed policy read as unknown and blocks instead of assuming either answer", () => {
    const f = ghFixture({ [protectionPath]: { error: "HTTP 403: Resource not accessible by integration" }, [rulesPath]: "[]" });
    const policy = inspectBranchPolicy(repo, "main", "/tmp", f.run);
    expect(policy.status).toBe("unknown");
    expect(policy.failures).toEqual(["branch protection: HTTP 403: Resource not accessible by integration"]);
    expect("requiresPullRequest" in policy).toBe(false);
    const decision = decideLandingPath({ policy, deployment: { status: "off" } });
    expect(decision.path).toBe("blocked");
    expect(decision.reasons).toEqual(["policy unknown: branch protection: HTTP 403: Resource not accessible by integration"]);
    expect(decideLandingPath({ policy: undefined }).path).toBe("blocked");
    const rulesFail = inspectBranchPolicy(repo, "main", "/tmp", ghFixture({
      [protectionPath]: { error: "HTTP 404: Branch not protected" },
      [rulesPath]: { error: "HTTP 500: upstream unavailable" },
    }).run);
    expect(rulesFail).toEqual({ status: "unknown", repository: repo, branch: "main", failures: ["rulesets: HTTP 500: upstream unavailable"] });
  });

  it("pushes main under existing deployment authorization and blocks without it", () => {
    const policy = inspectBranchPolicy(repo, "main", "/tmp", ghFixture(unprotected).run);
    const authorized = decideLandingPath({ policy, deployment: { status: "on", authorized: true } });
    expect(authorized.path).toBe("push-main");
    expect(authorized.reasons).toEqual(["pushing main migrates D1 and deploys under the operator's existing authorization"]);
    const unauthorized = decideLandingPath({ policy, deployment: { status: "on", authorized: false } });
    expect(unauthorized.path).toBe("blocked");
    expect(unauthorized.reasons[0]).toContain("has not authorized");
    const unknown = decideLandingPath({ policy, deployment: { status: "unknown", detail: "gh variable list: HTTP 403" } });
    expect(unknown).toEqual({ path: "blocked", reasons: ["deployment behavior unknown: gh variable list: HTTP 403"] });
    expect(decideLandingPath({ policy })).toEqual({
      path: "blocked",
      reasons: ["deployment behavior unknown: ENABLE_PRODUCTION_DEPLOY was not inspected"],
    });
    expect(decideLandingPath({ policy, deployment: { status: "error" } }).path).toBe("blocked");
  });

  it("parses landing-path CLI options into decideLandingPath inputs", () => {
    expect(parseLandingArgs([])).toEqual({
      branch: "main", instructionsRequirePullRequest: false, reviewRequested: false, unresolvedDecisions: [], deployment: undefined,
    });
    expect(parseLandingArgs(["--branch", "release", "--deploy", "on", "--authorized", "--review", "--instructions-require-pr",
      "--decision", "wrangler.toml routes", "--decision", "FOOTER_TEXT"])).toEqual({
      branch: "release", instructionsRequirePullRequest: true, reviewRequested: true,
      unresolvedDecisions: ["wrangler.toml routes", "FOOTER_TEXT"], deployment: { status: "on", authorized: true },
    });
    expect(parseLandingArgs(["--deploy", "unknown", "--deploy-detail", "gh variable list: HTTP 403"]).deployment)
      .toEqual({ status: "unknown", detail: "gh variable list: HTTP 403" });
    expect(() => parseLandingArgs(["--deploy", "maybe"])).toThrow("--deploy takes on, off, or unknown.");
    expect(() => parseLandingArgs(["--decision"])).toThrow("--decision needs a value.");
    expect(() => parseLandingArgs(["--force"])).toThrow("Unknown option --force.");
  });
});
