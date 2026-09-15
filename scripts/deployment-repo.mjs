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
    else if (command === "create" && repository && directory && !extra.length) {
      console.log(JSON.stringify(createDeployment(repository, directory), null, 2));
    } else throw new Error("Usage: node scripts/deployment-repo.mjs inspect | create OWNER/REPO NEW_DIRECTORY");
  } catch (error) {
    console.error(error.message);
    console.error("If creation was interrupted, keep the checkout and repository for inspection; do not retry over them.");
    process.exitCode = 1;
  }
}
