import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDeployment, githubRepo, inspectRepository, UPSTREAM_URL } from "../../scripts/deployment-repo.mjs";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
}).trim();

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(metadata = { nameWithOwner: "company/energon", isPrivate: true, isFork: false }) {
  const root = mkdtempSync(join(tmpdir(), "energon-copy-test-"));
  roots.push(root);
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const destination = join(root, "deployment");
  mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "test@example.test");
  git(source, "config", "user.name", "Test");
  writeFileSync(join(source, "config.txt"), "upstream defaults\n");
  git(source, "add", "config.txt");
  git(source, "commit", "-m", "initial source");
  writeFileSync(join(source, "app.txt"), "v1\n");
  git(source, "add", "app.txt");
  git(source, "commit", "-m", "app v1");
  git(source, "tag", "v1.0.0");
  git(root, "init", "--bare", remote);
  const calls: string[][] = [];
  // Git is real; only GitHub metadata and transport destinations use a local fixture.
  const run = (command: string, args: string[], cwd: string) => {
    calls.push([command, ...args]);
    if (command === "gh") {
      if (args[0] === "variable" && args[1] === "get") return "false";
      if (args[0] === "repo" && args[1] === "create") {
        git(cwd, "remote", "add", "origin", "https://github.com/company/energon.git");
        git(cwd, "config", "url." + remote + ".insteadOf", "https://github.com/company/energon.git");
      }
      if (args[0] === "repo" && args[1] === "view") return JSON.stringify(metadata);
      return "";
    }
    if (args[0] === "clone") {
      const result = git(cwd, ...args.map(arg => arg === UPSTREAM_URL ? source : arg));
      git(destination, "remote", "set-url", "upstream", UPSTREAM_URL);
      return result;
    }
    // `get-url` applies insteadOf; expose the logical URL while push/ls-remote use real Git transport.
    if (args[0] === "remote" && args[1] === "get-url" && args.at(-1) === "origin") {
      const push = args.includes("--push") ? git(cwd, "config", "--get-regexp", "remote.origin.(url|pushurl)") : "";
      if (push.includes("pushurl")) return push.split("\n").filter(line => line.includes("pushurl")).map(line => line.split(" ")[1]).join("\n");
      return git(cwd, "config", "--get", "remote.origin.url");
    }
    return git(cwd, ...args);
  };
  return { root, source, remote, destination, calls, run, metadata };
}

describe("deployment repositories", () => {
  it("copies full history into a private independent origin and supports an upstream merge", () => {
    const f = fixture();
    const result = createDeployment("company/energon", f.destination, f.run);
    expect(result).toMatchObject({ canonical: false, isFork: false, isPrivate: true, upstreamConfigured: true });
    expect(git(f.destination, "rev-list", "--count", "HEAD")).toBe("2");
    expect(git(f.remote, "rev-parse", "main")).toBe(git(f.source, "rev-parse", "main"));
    expect(git(f.destination, "config", "branch.main.remote")).toBe("origin");
    expect(f.calls.findIndex(call => call[1] === "push")).toBeGreaterThan(f.calls.findIndex(call => call[1] === "repo" && call[2] === "view"));
    git(f.destination, "config", "user.email", "test@example.test");
    git(f.destination, "config", "user.name", "Test");
    writeFileSync(join(f.destination, "config.txt"), "private company settings\n");
    git(f.destination, "add", "config.txt");
    git(f.destination, "commit", "-m", "customize deployment");
    writeFileSync(join(f.source, "app.txt"), "v2\n");
    git(f.source, "commit", "-am", "app v2");
    git(f.source, "tag", "v2.0.0");
    git(f.destination, "fetch", f.source, "refs/tags/v2.0.0:refs/remotes/upstream/releases/v2.0.0");
    git(f.destination, "switch", "-c", "update/v2");
    git(f.destination, "merge", "refs/remotes/upstream/releases/v2.0.0");
    expect(git(f.destination, "show", "HEAD:config.txt")).toBe("private company settings");
    expect(git(f.destination, "show", "HEAD:app.txt")).toBe("v2");
    writeFileSync(join(f.source, "config.txt"), "new upstream defaults\n");
    git(f.source, "commit", "-am", "change defaults");
    git(f.destination, "fetch", f.source, "main");
    expect(() => git(f.destination, "merge", "FETCH_HEAD")).toThrow();
    expect(git(f.destination, "status", "--short")).toContain("UU config.txt");
    expect(git(f.destination, "show", ":2:config.txt")).toBe("private company settings");
  }, 15_000);

  it.each([
    { nameWithOwner: "company/energon", isPrivate: false, isFork: false },
    { nameWithOwner: "company/energon", isPrivate: true, isFork: true },
    { nameWithOwner: "other/energon", isPrivate: true, isFork: false },
  ])("does not push when GitHub returns an unsafe destination: %j", metadata => {
    const f = fixture(metadata);
    expect(() => createDeployment("company/energon", f.destination, f.run)).toThrow();
    expect(f.calls.some(call => call[1] === "push")).toBe(false);
    expect(() => git(f.remote, "show-ref", "--head")).toThrow();
  });

  it("preserves an existing destination and stops before contacting GitHub", () => {
    const f = fixture();
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, "keep.txt"), "keep");
    expect(() => createDeployment("company/energon", f.destination, f.run)).toThrow(/already exists/);
    expect(existsSync(join(f.destination, "keep.txt"))).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it("stops before pushing if deployment cannot be disabled", () => {
    const f = fixture();
    const run = (command: string, args: string[], cwd: string) => {
      if (command === "gh" && args[0] === "variable" && args[1] === "get") return "true";
      return f.run(command, args, cwd);
    };
    expect(() => createDeployment("company/energon", f.destination, run)).toThrow(/deployment is disabled/);
    expect(f.calls.some(call => call[1] === "push")).toBe(false);
  });

  it("leaves an interrupted creation intact and does not push after a GitHub failure", () => {
    const f = fixture();
    const run = (command: string, args: string[], cwd: string) => {
      if (command === "gh" && args[0] === "repo" && args[1] === "create") throw new Error("permission denied");
      return f.run(command, args, cwd);
    };
    expect(() => createDeployment("company/energon", f.destination, run)).toThrow(/permission denied/);
    expect(existsSync(join(f.destination, ".git"))).toBe(true);
    expect(f.calls.some(call => call[1] === "push")).toBe(false);
  });

  it("distinguishes canonical source, legacy forks, and private copies by origin", () => {
    const f = fixture();
    createDeployment("company/energon", f.destination, f.run);
    f.metadata.isFork = true;
    expect(inspectRepository(f.destination, f.run)).toMatchObject({ canonical: false, isFork: true });
    f.metadata.isFork = false;
    f.metadata.nameWithOwner = "tmchow/energon";
    git(f.destination, "remote", "set-url", "origin", UPSTREAM_URL);
    expect(inspectRepository(f.destination, f.run).canonical).toBe(true);
  });

  it("refuses mismatched push and upstream destinations", () => {
    const f = fixture();
    createDeployment("company/energon", f.destination, f.run);
    git(f.destination, "config", "remote.origin.pushurl", "https://github.com/other/energon.git");
    expect(() => inspectRepository(f.destination, f.run)).toThrow(/destinations differ/);
    git(f.destination, "config", "--unset", "remote.origin.pushurl");
    git(f.destination, "remote", "set-url", "upstream", "https://github.com/other/energon.git");
    expect(() => inspectRepository(f.destination, f.run)).toThrow(/canonical/);
  });

  it.each(["https://github.com.evil.test/org/repo", "https://token@github.com/org/repo", "https://evil.test/github.com/org/repo", "--help"])("rejects ambiguous or credential-bearing Git URLs: %s", url => {
    expect(() => githubRepo(url)).toThrow();
  });
});
