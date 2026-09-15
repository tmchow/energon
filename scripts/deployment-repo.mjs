import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const UPSTREAM_REPO = "tmchow/energon";
export const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPO}.git`;

export function githubRepo(url) {
  const match = url.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
  if (!match) throw new Error("Expected a GitHub remote without embedded credentials.");
  return match[1];
}

export function runCommand(command, args, cwd) {
  return execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
  }).trim();
}

export function inspectRepository(cwd = process.cwd(), run = runCommand) {
  const git = (...args) => run("git", args, cwd);
  const repository = githubRepo(git("remote", "get-url", "origin"));
  const pushUrls = git("remote", "get-url", "--push", "--all", "origin").split("\n");
  if (pushUrls.length !== 1 || githubRepo(pushUrls[0]).toLowerCase() !== repository.toLowerCase()) {
    throw new Error("origin fetch and push destinations differ; resolve them before continuing.");
  }
  const metadata = JSON.parse(run("gh", ["repo", "view", repository, "--json", "nameWithOwner,isFork,isPrivate"], cwd));
  if (metadata.nameWithOwner?.toLowerCase() !== repository.toLowerCase() ||
      typeof metadata.isFork !== "boolean" || typeof metadata.isPrivate !== "boolean") {
    throw new Error("GitHub did not confirm the origin repository identity and visibility.");
  }
  const canonical = repository.toLowerCase() === UPSTREAM_REPO.toLowerCase();
  const upstreamConfigured = git("remote").split("\n").includes("upstream");
  if (upstreamConfigured && githubRepo(git("remote", "get-url", "upstream")).toLowerCase() !== UPSTREAM_REPO.toLowerCase()) {
    throw new Error("upstream does not point to the canonical Energon repository. Inspect it before changing remotes.");
  }
  return { repository: metadata.nameWithOwner, canonical, isFork: metadata.isFork,
    isPrivate: metadata.isPrivate, upstream: UPSTREAM_REPO, upstreamUrl: UPSTREAM_URL, upstreamConfigured };
}

function ghApi(run, cwd, path) {
  try {
    return { ok: true, body: JSON.parse(run("gh", ["api", path], cwd)) };
  } catch (error) {
    const message = String(error.stderr || error.message || error).trim();
    // A 404 with this body is GitHub's definitive answer for a branch with no classic protection.
    if (/Branch not protected/i.test(message)) return { ok: true, body: null };
    return { ok: false, message };
  }
}

export function inspectBranchPolicy(repository, branch = "main", cwd = process.cwd(), run = runCommand) {
  const encoded = encodeURIComponent(branch);
  const protection = ghApi(run, cwd, `repos/${repository}/branches/${encoded}/protection`);
  const rules = ghApi(run, cwd, `repos/${repository}/rules/branches/${encoded}`);
  const failures = [];
  if (!protection.ok) failures.push(`branch protection: ${protection.message}`);
  if (!rules.ok) failures.push(`rulesets: ${rules.message}`);
  if (failures.length) return { status: "unknown", repository, branch, failures };
  const body = protection.body ?? {};
  const ruleTypes = Array.isArray(rules.body) ? rules.body.map((rule) => rule.type) : [];
  // Classic protection reports some settings as objects that are present when set, others as { enabled }.
  const sources = [];
  if (body.required_pull_request_reviews || ruleTypes.includes("pull_request")) sources.push("a pull request is required");
  if (body.required_status_checks || ruleTypes.includes("required_status_checks")) sources.push("status checks must pass before a push lands");
  if (body.required_signatures?.enabled || ruleTypes.includes("required_signatures")) sources.push("commits must be signed");
  if (body.restrictions || ruleTypes.includes("update")) sources.push("pushes to the branch are restricted");
  const blocksMergeCommits = Boolean(body.required_linear_history?.enabled) || ruleTypes.includes("required_linear_history");
  return { status: "known", repository, branch, requiresPullRequest: sources.length > 0, blocksMergeCommits, sources };
}

export function decideLandingPath({ policy, instructionsRequirePullRequest = false, reviewRequested = false,
  unresolvedDecisions = [], deployment }) {
  if (!policy || policy.status !== "known") {
    const failures = policy?.failures?.length ? policy.failures : ["repository policy was not inspected"];
    return { path: "blocked", reasons: failures.map((failure) => `policy unknown: ${failure}`) };
  }
  if (policy.blocksMergeCommits) {
    return { path: "blocked", reasons: ["linear history is required; a regular merge cannot land and squashing would erase upstream ancestry"] };
  }
  const reasons = [];
  if (instructionsRequirePullRequest) reasons.push("this repository's instructions require a pull request");
  if (policy.requiresPullRequest) reasons.push(...policy.sources);
  if (reviewRequested) reasons.push("the operator asked for review");
  if (unresolvedDecisions.length) reasons.push(...unresolvedDecisions.map((item) => `needs a human decision: ${item}`));
  if (reasons.length) return { path: "pull-request", reasons };
  return deploymentGate(deployment);
}

function deploymentGate(deployment) {
  if (deployment?.status === "off") return { path: "push-main", reasons: [] };
  if (deployment?.status !== "on") {
    return { path: "blocked", reasons: [`deployment behavior unknown: ${deployment?.detail ?? "ENABLE_PRODUCTION_DEPLOY was not inspected"}`] };
  }
  if (!deployment.authorized) return { path: "blocked", reasons: ["pushing main migrates D1 and deploys; the operator has not authorized that"] };
  return { path: "push-main", reasons: ["pushing main migrates D1 and deploys under the operator's existing authorization"] };
}

export function parseLandingArgs(args) {
  const input = { branch: "main", instructionsRequirePullRequest: false, reviewRequested: false, unresolvedDecisions: [], deployment: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => { if (i + 1 >= args.length) throw new Error(`${arg} needs a value.`); return args[++i]; };
    if (arg === "--branch") input.branch = value();
    else if (arg === "--instructions-require-pr") input.instructionsRequirePullRequest = true;
    else if (arg === "--review") input.reviewRequested = true;
    else if (arg === "--decision") input.unresolvedDecisions.push(value());
    else if (arg === "--deploy") {
      const status = value();
      if (!["on", "off", "unknown"].includes(status)) throw new Error("--deploy takes on, off, or unknown.");
      input.deployment = { ...input.deployment, status };
    } else if (arg === "--deploy-detail") input.deployment = { ...(input.deployment ?? { status: "unknown" }), detail: value() };
    else if (arg === "--authorized") input.deployment = { ...(input.deployment ?? { status: "unknown" }), authorized: true };
    else throw new Error(`Unknown option ${arg}.`);
  }
  return input;
}

export function createDeployment(repository, directory, run = runCommand) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[\w.-]+$/.test(repository ?? "") || repository.toLowerCase() === UPSTREAM_REPO.toLowerCase()) {
    throw new Error("Choose a new deployment repository as OWNER/REPO, distinct from upstream.");
  }
  if (!directory) throw new Error("Choose a new local directory for the deployment checkout.");
  const cwd = resolve(directory);
  try {
    lstatSync(cwd);
    throw new Error("Destination already exists; inspect or resume it using INSTALL.md. Nothing was overwritten.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  run("gh", ["auth", "status", "--hostname", "github.com"], process.cwd());
  run("git", ["clone", "--origin", "upstream", "--branch", "main", UPSTREAM_URL, cwd], process.cwd());
  run("gh", ["repo", "create", repository, "--private", "--source", cwd, "--remote", "origin"], cwd);
  const info = inspectRepository(cwd, run);
  if (info.repository.toLowerCase() !== repository.toLowerCase() || !info.isPrivate || info.isFork || info.canonical) {
    throw new Error("Destination must be the requested independent private repository. Source has not been pushed.");
  }
  if (run("git", ["ls-remote", "origin"], cwd)) {
    throw new Error("Destination contains refs. Source has not been pushed; inspect the repository before resuming.");
  }
  // A repository-level false overrides an organization's inherited deploy opt-in.
  run("gh", ["variable", "set", "ENABLE_PRODUCTION_DEPLOY", "--body", "false", "--repo", repository], cwd);
  if (run("gh", ["variable", "get", "ENABLE_PRODUCTION_DEPLOY", "--repo", repository], cwd) !== "false") {
    throw new Error("Could not verify production deployment is disabled. Source has not been pushed.");
  }
  run("git", ["push", "--set-upstream", "origin", "main:main"], cwd);
  const commit = run("git", ["rev-parse", "HEAD"], cwd);
  const remoteCommit = run("git", ["ls-remote", "origin", "refs/heads/main"], cwd).split(/\s/)[0];
  if (commit !== remoteCommit) throw new Error("Remote main does not match the copied source; inspect before configuring.");
  return { ...info, directory: cwd, sourceCommit: commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, repository, directory, ...extra] = process.argv.slice(2);
    if (command === "inspect" && !repository) console.log(JSON.stringify(inspectRepository(), null, 2));
    else if (command === "branch-policy" && !directory) {
      const info = inspectRepository();
      console.log(JSON.stringify(inspectBranchPolicy(info.repository, repository || "main"), null, 2));
    } else if (command === "landing-path") {
      const { branch, ...input } = parseLandingArgs(process.argv.slice(3));
      const policy = inspectBranchPolicy(inspectRepository().repository, branch);
      console.log(JSON.stringify({ policy, ...decideLandingPath({ policy, ...input }) }, null, 2));
    }
    else if (command === "create" && repository && directory && !extra.length) {
      console.log(JSON.stringify(createDeployment(repository, directory), null, 2));
    } else throw new Error("Usage: node scripts/deployment-repo.mjs inspect | branch-policy [BRANCH] | landing-path [--branch B] [--deploy on|off|unknown] [--authorized] [--review] [--instructions-require-pr] [--decision TEXT]... | create OWNER/REPO NEW_DIRECTORY");
  } catch (error) {
    console.error(error.message);
    console.error("If creation was interrupted, keep the checkout and repository for inspection; do not retry over them.");
    process.exitCode = 1;
  }
}
