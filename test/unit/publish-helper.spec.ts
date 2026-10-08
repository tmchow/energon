import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../scripts/skill-template.mjs";
import { MAX_IMPORT_FILES } from "../../src/config";
import { DEPLOYMENT_GRANT_SECRET_PREFIX } from "../../src/deployment-grants";
import { GRANT_SECRET_PREFIX } from "../../src/grants";

const TOKEN_ENV = "ACME_ENERGON_TOKEN";
const TOKEN = "ee_live_testtoken123";
const VARS = {
  SKILL_NAME: "acme-energon",
  ORIGIN: "http://127.0.0.1:9",
  TOKEN_ENV,
  TOKEN_PREFIX: "ee_live_",
  PRODUCT: "Energon",
};

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function setup() {
  const root = tempDir("energon-helper-");
  const helper = join(root, "energon_publish.py");
  writeFileSync(helper, render(readFileSync(resolve("templates/skill/scripts/energon_publish.py.tmpl"), "utf8"), VARS));
  const stateDir = join(root, "state");
  const site = join(root, "site");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), "<h1>v1</h1>");
  mkdirSync(join(site, "css"));
  writeFileSync(join(site, "css", "app.css"), "body{}");
  return { root, helper, stateDir, site };
}

type Run = { status: number | null; stdout: string; stderr: string; json: Record<string, any> };

function run(helper: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<Run> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmpdir(), ...opts.env };
  return new Promise((done, fail) => {
    const child = spawn("python3", [helper, ...args], { env: env as NodeJS.ProcessEnv, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (status) => {
      let json: Record<string, any> = {};
      try {
        json = JSON.parse(stdout);
      } catch {
        /* not JSON */
      }
      done({ status, stdout, stderr, json });
    });
    child.stdin.end(opts.input ?? "");
  });
}

type Logged = { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer };

/** Minimal Energon stand-in: one site S1, one archive deployment D1, served on hub and grant paths. */
async function stubEnergon(
  opts: {
    contentOrigin?: (origin: string) => string | null;
    dropFirstCommit?: boolean;
    truncateFirstCommit?: boolean;
    dropFirstGrantPut?: boolean;
    dropCreate?: boolean;
    expireFirstCreate?: boolean;
    expiredSession?: boolean;
  } = {},
) {
  const log: Logged[] = [];
  let truncateCommit = opts.truncateFirstCommit ?? false;
  let grantConsumed = false;
  let dropGrantPut = opts.dropFirstGrantPut ?? false;
  const fileUrl = "https://content.test/f/F1";
  let archive: Buffer | null = null;
  let prepares = 0;
  let committed = false;
  let dropCommit = opts.dropFirstCommit ?? false;
  let created = false;
  let expireCreate = opts.expireFirstCreate ?? false;
  const status = () => {
    const ready = archive !== null && prepares >= 2;
    return {
      deployment_id: "D1",
      state: committed ? "committed" : ready ? "ready" : "uploading",
      expected_version: 7,
      next_action: committed ? null : ready ? "commit" : archive ? "prepare" : "upload",
      ...(committed ? { url: "https://content.test/s/acme/", version_id: "ver1" } : {}),
    };
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://stub").pathname;
      const body = Buffer.concat(chunks);
      log.push({ method: req.method ?? "", path, headers: req.headers, body });
      const send = (code: number, data: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const session = path.match(/^(?:\/v1\/sites\/S1\/deployments\/D1|\/_deployment-grants\/G1)(\/archive|\/prepare|\/commit)?$/);
      const route = `${req.method} ${session ? `session${session[1] ?? ""}` : path}`;
      const handlers: Record<string, () => void> = {
        "GET /v1/help": () => send(200, { content_origin: opts.contentOrigin?.(origin) ?? null }),
        "GET /v1/sites/S1": () => send(200, { id: "S1", content_generation: 7 }),
        "POST /v1/sites/S1/deployments": () => {
          if (expireCreate) {
            expireCreate = false;
            return send(410, { error: "idempotency_expired", message: "The retry identity is outside its creation window." });
          }
          send(created ? 200 : 201, status());
          created = true;
        },
        "GET session": () =>
          opts.expiredSession ? send(410, { error: "deployment_expired", message: "Preparation deadline has passed." }) : send(200, status()),
        "PUT session/archive": () => {
          archive = body;
          send(201, { stored: true });
        },
        "POST session/prepare": () => {
          prepares++;
          send(prepares >= 2 ? 200 : 202, status());
        },
        "POST session/commit": () => {
          if (dropCommit) {
            dropCommit = false;
            req.socket.destroy();
            return;
          }
          committed = true;
          if (truncateCommit) {
            truncateCommit = false;
            res.writeHead(200, { "content-type": "application/json", "content-length": "4096" });
            res.write('{"state":');
            setTimeout(() => req.socket.destroy(), 20);
            return;
          }
          send(200, status());
        },
        "POST /v1/files": () => {
          if (opts.dropCreate) return void req.socket.destroy();
          send(201, { id: "F1", url: fileUrl, content_generation: 1 });
        },
        "PUT /v1/files/F1": () => send(200, { id: "F1", url: fileUrl, content_generation: 2 }),
        "PUT /_grants/FG1": () => {
          if (grantConsumed) return send(410, { error: "grant_used", message: "This grant was already used.", url: fileUrl, result_id: "F1" });
          grantConsumed = true;
          if (dropGrantPut) {
            dropGrantPut = false;
            return void req.socket.destroy();
          }
          send(201, { id: "F1", url: fileUrl, content_generation: 1 });
        },
      };
      if (handlers[route]) return handlers[route]();
      send(404, { error: "not_found" });
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, log, archived: () => archive };
}

function grantFor(origin: string, secret: string) {
  const url = `${origin}/_deployment-grants/G1`;
  return JSON.stringify({
    id: "G1",
    secret,
    header: "Authorization",
    scheme: "Bearer",
    target: { type: "site_deployment", deployment_id: "D1", site_id: "S1" },
    status_url: url,
    upload_url: `${url}/files/{path}`,
    archive_url: `${url}/archive`,
    prepare_url: `${url}/prepare`,
    commit_url: `${url}/commit`,
  });
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const mode = (path: string) => statSync(path).mode & 0o777;

describe("upload helper", () => {
  it("pins MAX_FILES and secret prefixes to the Worker's constants", () => {
    const helper = render(readFileSync(resolve("templates/skill/scripts/energon_publish.py.tmpl"), "utf8"), VARS);
    expect(helper).toContain(`\nMAX_FILES = ${MAX_IMPORT_FILES}\n`);
    const prefixes = /SECRET_PATTERN = .*?for p in \(([^)]*)\)/s.exec(helper)?.[1] ?? "";
    expect(prefixes).toContain(JSON.stringify(GRANT_SECRET_PREFIX));
    expect(prefixes).toContain(JSON.stringify(DEPLOYMENT_GRANT_SECRET_PREFIX));
  });

  it("publishes the archive inspect persisted even after the folder changes, then removes its state", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon();
    const inspect = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(inspect.status).toBe(0);
    const archiveBytes = readFileSync(inspect.json.archive_path);
    expect(inspect.json.archive).toEqual({ size: archiveBytes.length, sha256: sha256(archiveBytes) });
    expect(inspect.json.files).toEqual(["css/app.css", "index.html"]);
    expect(inspect.json.idempotency_key).toMatch(/^\d{13}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    writeFileSync(join(site, "index.html"), "<h1>changed after inspect</h1>");
    const publish = await run(helper, ["publish-folder", site, "--site-id", "S1", "--origin", stub.origin, "--state-dir", stateDir], {
      env: { [TOKEN_ENV]: TOKEN },
    });
    expect(publish.status, publish.stderr).toBe(0);
    expect(publish.json).toMatchObject({ state: "committed", url: "https://content.test/s/acme/", version_id: "ver1" });
    expect(publish.stderr).toMatch(/changed since inspect/);
    expect(sha256(stub.archived()!)).toBe(inspect.json.archive.sha256);

    const create = stub.log.find((r) => r.method === "POST" && r.path === "/v1/sites/S1/deployments")!;
    expect(JSON.parse(create.body.toString())).toEqual({
      expected_version: 7,
      idempotency_key: inspect.json.idempotency_key,
      archive: inspect.json.archive,
    });
    const put = stub.log.find((r) => r.method === "PUT")!;
    expect(put.headers["content-type"]).toBe("application/zip");
    expect(put.headers["content-length"]).toBe(String(archiveBytes.length));
    expect(put.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(put.headers["user-agent"]).toMatch(/^energon-publish\//);
    expect(existsSync(inspect.json.state_path)).toBe(false);
    expect(existsSync(inspect.json.archive_path)).toBe(false);
  });

  it("deletes abandoned state and archives older than a day, keeping fresh ones", async () => {
    const { helper, stateDir, site } = setup();
    mkdirSync(stateDir, { recursive: true });
    const day = 24 * 60 * 60;
    for (const [name, age] of [["stale", 2 * day], ["recent", 60]] as const) {
      for (const ext of ["json", "zip"]) {
        const path = join(stateDir, `${name}.${ext}`);
        writeFileSync(path, "{}");
        const when = Date.now() / 1000 - age;
        utimesSync(path, when, when);
      }
    }
    const inspect = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(inspect.status, inspect.stderr).toBe(0);
    expect(existsSync(join(stateDir, "stale.json"))).toBe(false);
    expect(existsSync(join(stateDir, "stale.zip"))).toBe(false);
    expect(existsSync(join(stateDir, "recent.json"))).toBe(true);
    expect(existsSync(inspect.json.archive_path)).toBe(true);
  });

  it("starts a new transfer when the saved state came from another host", async () => {
    const { helper, stateDir, site } = setup();
    const first = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(first.status, first.stderr).toBe(0);
    const saved = JSON.parse(readFileSync(first.json.state_path, "utf8"));
    expect(typeof saved.host).toBe("string");
    writeFileSync(first.json.state_path, JSON.stringify({ ...saved, host: "some-other-host", deployment_id: "D9" }));
    const second = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(second.status, second.stderr).toBe(0);
    expect(second.json.deployment_id).toBeNull();
    expect(second.json.idempotency_key).not.toBe(first.json.idempotency_key);
  });

  it("starts a new deployment under a fresh key when the server says the old identity expired", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon({ expireFirstCreate: true });
    const inspect = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    const publish = await run(helper, ["publish-folder", site, "--site-id", "S1", "--origin", stub.origin, "--state-dir", stateDir], {
      env: { [TOKEN_ENV]: TOKEN },
    });
    expect(publish.status, publish.stderr).toBe(0);
    expect(publish.json).toMatchObject({ state: "committed" });
    const keys = stub.log
      .filter((r) => r.method === "POST" && r.path === "/v1/sites/S1/deployments")
      .map((r) => JSON.parse(r.body.toString()).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(inspect.json.idempotency_key);
    expect(keys[1]).not.toBe(keys[0]);
    expect(sha256(stub.archived()!)).toBe(inspect.json.archive.sha256);
  });

  it("replaces an unused key older than the server's creation window", async () => {
    const { helper, stateDir, site } = setup();
    const first = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    const saved = JSON.parse(readFileSync(first.json.state_path, "utf8"));
    const oldKey = `${Date.now() - 2 * 60 * 60 * 1000}.${saved.idempotency_key.split(".")[1]}`;
    writeFileSync(first.json.state_path, JSON.stringify({ ...saved, idempotency_key: oldKey }));
    const second = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(second.status, second.stderr).toBe(0);
    expect(second.json.idempotency_key).not.toBe(oldKey);
    expect(Number(second.json.idempotency_key.split(".")[0])).toBeGreaterThan(Date.now() - 60_000);
  });

  it("tells a grant publish to start over when its deployment expired", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon({ expiredSession: true });
    await run(helper, ["inspect", site, "--state-dir", stateDir]);
    const publish = await run(helper, ["publish-folder", site, "--grant-file", "-", "--origin", stub.origin, "--state-dir", stateDir], {
      input: grantFor(stub.origin, "deployment_grant_expiredsecret"),
    });
    expect(publish.status).toBe(1);
    expect(publish.json).toMatchObject({ error: "deployment_expired" });
    expect(publish.stderr).toMatch(/inspect --restart/);
  });

  it("still publishes the persisted archive when the folder later grows past the cap", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon();
    const inspect = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(inspect.status).toBe(0);
    for (let i = 0; i < 201; i++) writeFileSync(join(site, `extra-${i}.txt`), "x");
    const publish = await run(helper, ["publish-folder", site, "--site-id", "S1", "--origin", stub.origin, "--state-dir", stateDir], {
      env: { [TOKEN_ENV]: TOKEN },
    });
    expect(publish.status, publish.stderr).toBe(0);
    expect(publish.json).toMatchObject({ state: "committed" });
    expect(publish.stderr).toMatch(/changed since inspect/);
    expect(sha256(stub.archived()!)).toBe(inspect.json.archive.sha256);
  });

  it("leaves out hidden paths and symlinks unless --include-hidden, which still never adds a symlink", async () => {
    const { root, helper, stateDir, site } = setup();
    const outside = join(tempDir("energon-outside-"), "secret.txt");
    writeFileSync(outside, "outside");
    writeFileSync(join(site, ".env"), "KEY=1");
    mkdirSync(join(site, ".git"));
    writeFileSync(join(site, ".git", "config"), "[core]");
    symlinkSync(outside, join(site, "link.txt"));
    symlinkSync(join(root, "state"), join(site, "linked-dir"));
    const entries = (path: string) => Object.keys(unzipSync(readFileSync(path))).sort();

    const plain = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.json.files).toEqual(["css/app.css", "index.html"]);
    expect(entries(plain.json.archive_path)).toEqual(plain.json.files);

    const hidden = await run(helper, ["inspect", site, "--include-hidden", "--state-dir", stateDir]);
    expect(hidden.status, hidden.stderr).toBe(0);
    expect(hidden.json.files).toEqual([".env", ".git/config", "css/app.css", "index.html"]);
    expect(entries(hidden.json.archive_path)).toEqual(hidden.json.files);
  });

  it("resumes an interrupted grant publish with a re-minted grant and keeps secrets out of owner-only state", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon({ dropFirstCommit: true });
    const inspect = await run(helper, ["inspect", site, "--state-dir", stateDir]);
    const first = await run(helper, ["publish-folder", site, "--grant-file", "-", "--origin", stub.origin, "--state-dir", stateDir], {
      input: grantFor(stub.origin, "deployment_grant_firstsecret"),
    });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toMatch(/rerun/i);

    const stateText = readFileSync(inspect.json.state_path, "utf8");
    expect(JSON.parse(stateText)).toMatchObject({ idempotency_key: inspect.json.idempotency_key, deployment_id: "D1", site_id: "S1" });
    expect(stateText).not.toMatch(/grant_|ee_live_/);
    expect(mode(stateDir)).toBe(0o700);
    expect(mode(inspect.json.state_path)).toBe(0o600);
    expect(mode(inspect.json.archive_path)).toBe(0o600);
    expect(`${first.stdout}${first.stderr}`).not.toContain("firstsecret");

    const second = await run(helper, ["publish-folder", site, "--grant-file", "-", "--origin", stub.origin, "--state-dir", stateDir], {
      input: grantFor(stub.origin, "deployment_grant_secondsecret"),
    });
    expect(second.status, second.stderr).toBe(0);
    expect(second.json).toMatchObject({ state: "committed", version_id: "ver1", deployment_id: "D1" });
    expect(stub.log.filter((r) => r.method === "PUT")).toHaveLength(1);
    const put = stub.log.find((r) => r.method === "PUT")!;
    expect(put.headers["content-type"]).toBe("application/zip");
    expect(put.headers["x-filename"]).toBeUndefined();
    expect(sha256(put.body)).toBe(inspect.json.archive.sha256);
    expect(stub.log.every((r) => r.path === "/v1/help" || r.headers.authorization?.startsWith("Bearer deployment_grant_"))).toBe(true);
    expect(existsSync(inspect.json.state_path)).toBe(false);
    expect(readdirSync(stateDir)).toEqual([]);
  });

  it("refuses to send a grant secret to an origin other than the content origin", async () => {
    const { root, helper } = setup();
    const stub = await stubEnergon({ contentOrigin: (origin) => origin });
    const file = join(root, "note.md");
    writeFileSync(file, "# hi");
    const result = await run(helper, ["publish-file", file, "--grant-file", "-", "--origin", stub.origin], {
      input: JSON.stringify({ secret: "grant_abc", upload_url: "https://elsewhere.test/_grants/x" }),
    });
    expect(result.status).not.toBe(0);
    expect(result.json.error).toBe("origin_mismatch");
    expect(stub.log.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/help"]);
  });

  it("names the token env var when token mode has no token", async () => {
    const { root, helper } = setup();
    const file = join(root, "note.md");
    writeFileSync(file, "# hi");
    const result = await run(helper, ["publish-file", file]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(TOKEN_ENV);
  });

  it("rejects a grant without upload_url and an over-cap folder before any request", async () => {
    const { root, helper, stateDir } = setup();
    const stub = await stubEnergon();
    const file = join(root, "note.md");
    writeFileSync(file, "# hi");
    const grant = await run(helper, ["publish-file", file, "--grant-file", "-", "--origin", stub.origin], {
      input: JSON.stringify({ secret: "grant_abc" }),
    });
    expect(grant.status).not.toBe(0);
    expect(grant.stdout).toContain("upload_url");

    const big = join(root, "big");
    mkdirSync(big);
    for (let i = 0; i < 201; i++) writeFileSync(join(big, `f${i}.txt`), String(i));
    const folder = await run(helper, ["publish-folder", big, "--site-id", "S1", "--origin", stub.origin, "--state-dir", stateDir], {
      env: { [TOKEN_ENV]: TOKEN },
    });
    expect(folder.status).not.toBe(0);
    expect(folder.json.error).toBe("too_many_files");
    expect(stub.log).toEqual([]);
  });

  it("rejects a secret-looking argument value without echoing it", async () => {
    const { helper, site } = setup();
    for (const args of [
      ["publish-folder", site, "--site-id", "grant_leakedvalue0123456789abcdefghijklmnopqrstuvw"],
      ["publish-folder", site, "--site-id=ee_live_leakedvalue0123456789abcdef"],
    ]) {
      const result = await run(helper, args, { env: { [TOKEN_ENV]: TOKEN } });
      expect(result.status).not.toBe(0);
      expect(result.json.error).toBe("secret_in_argument");
      expect(`${result.stdout}${result.stderr}`).not.toContain("leakedvalue");
    }
    writeFileSync(join(site, "grant_report.md"), "ordinary name");
    expect((await run(helper, ["inspect", join(site, "grant_report.md")])).status).toBe(0);
  });
  it("treats a truncated commit response as lost and recovers through the status URL", async () => {
    const { helper, stateDir, site } = setup();
    const stub = await stubEnergon({ truncateFirstCommit: true });
    const publish = await run(helper, ["publish-folder", site, "--site-id", "S1", "--origin", stub.origin, "--state-dir", stateDir], {
      env: { [TOKEN_ENV]: TOKEN },
    });
    expect(publish.stderr).not.toMatch(/Traceback/);
    expect(publish.status, publish.stderr).toBe(0);
    expect(publish.json).toMatchObject({ state: "committed", url: "https://content.test/s/acme/" });
    expect(stub.log.filter((r) => r.method === "POST" && r.path.endsWith("/commit"))).toHaveLength(1);
  });

  it("reports the served paths when the server will strip a wrapping folder", async () => {
    const { root, helper, stateDir } = setup();
    const wrapped = join(root, "wrapped");
    mkdirSync(join(wrapped, "docs", "css"), { recursive: true });
    writeFileSync(join(wrapped, "docs", "index.html"), "<h1>hi</h1>");
    writeFileSync(join(wrapped, "docs", "css", "app.css"), "body{}");
    const inspect = await run(helper, ["inspect", wrapped, "--state-dir", stateDir]);
    expect(inspect.status, inspect.stderr).toBe(0);
    expect(inspect.json.files).toEqual(["css/app.css", "index.html"]);
    expect(inspect.stderr).toMatch(/docs\//);
  });

  describe("publish-file", () => {
    const fileIn = (root: string) => {
      const file = join(root, "note.md");
      writeFileSync(file, "# hi");
      return file;
    };
    const grant = (origin: string) => JSON.stringify({ secret: "grant_filesecret", upload_url: `${origin}/_grants/FG1` });

    it("publishes with a grant using the Bearer grant secret and no X-Filename", async () => {
      const { root, helper } = setup();
      const stub = await stubEnergon();
      const result = await run(helper, ["publish-file", fileIn(root), "--grant-file", "-", "--origin", stub.origin], { input: grant(stub.origin) });
      expect(result.status, result.stderr).toBe(0);
      expect(result.json).toMatchObject({ id: "F1", url: "https://content.test/f/F1" });
      const put = stub.log.find((r) => r.method === "PUT")!;
      expect(put.path).toBe("/_grants/FG1");
      expect(put.headers.authorization).toBe("Bearer grant_filesecret");
      expect(put.headers["x-filename"]).toBeUndefined();
      expect(put.body.toString()).toBe("# hi");
    });

    it("treats grant_used with a url after a lost grant PUT response as the published receipt", async () => {
      const { root, helper } = setup();
      const stub = await stubEnergon({ dropFirstGrantPut: true });
      const result = await run(helper, ["publish-file", fileIn(root), "--grant-file", "-", "--origin", stub.origin], { input: grant(stub.origin) });
      expect(result.status, result.stderr).toBe(0);
      expect(result.json).toMatchObject({ url: "https://content.test/f/F1", result_id: "F1" });
      expect(stub.log.filter((r) => r.method === "PUT")).toHaveLength(2);
    });

    it("creates with X-Filename in token mode and never retries the create", async () => {
      const { root, helper } = setup();
      const stub = await stubEnergon();
      const file = fileIn(root);
      const created = await run(helper, ["publish-file", file, "--filename", "Notes.md", "--origin", stub.origin], { env: { [TOKEN_ENV]: TOKEN } });
      expect(created.status, created.stderr).toBe(0);
      expect(created.json).toMatchObject({ id: "F1", content_generation: 1 });
      const post = stub.log.find((r) => r.method === "POST")!;
      expect(post.path).toBe("/v1/files");
      expect(post.headers["x-filename"]).toBe("Notes.md");
      expect(post.headers.authorization).toBe(`Bearer ${TOKEN}`);

      const lost = await stubEnergon({ dropCreate: true });
      const dropped = await run(helper, ["publish-file", file, "--origin", lost.origin], { env: { [TOKEN_ENV]: TOKEN } });
      expect(dropped.status).toBe(1);
      expect(dropped.json.error).toBe("no_response");
      expect(lost.log.filter((r) => r.method === "POST")).toHaveLength(1);
    });

    it("replaces with --file-id and sends --expected-version as X-Energon-Expected-Version", async () => {
      const { root, helper } = setup();
      const stub = await stubEnergon();
      const result = await run(helper, ["publish-file", fileIn(root), "--file-id", "F1", "--expected-version", "1", "--origin", stub.origin], {
        env: { [TOKEN_ENV]: TOKEN },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.json).toMatchObject({ id: "F1", content_generation: 2 });
      const put = stub.log.find((r) => r.method === "PUT")!;
      expect(put.path).toBe("/v1/files/F1");
      expect(put.headers["x-energon-expected-version"]).toBe("1");
    });

    it("rejects --expected-version without --file-id before any request", async () => {
      const { root, helper } = setup();
      const stub = await stubEnergon();
      const result = await run(helper, ["publish-file", fileIn(root), "--expected-version", "1", "--origin", stub.origin], {
        env: { [TOKEN_ENV]: TOKEN },
      });
      expect(result.status).toBe(1);
      expect(result.json.error).toBe("bad_arguments");
      expect(stub.log).toEqual([]);
    });
  });
});
