import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { json, origin, req } from "./helpers";
import { sha256Hex } from "../src/http";

const headers = { origin, "Cf-Access-Authenticated-User-Email": "ada@esperlabs.app", "content-type": "application/json" };

describe("human account site deployments", () => {
  it("stages a ZIP, resumes via account routes, and publishes only after commit", async () => {
    const created = await json("/account/sites", { method: "POST", headers, body: JSON.stringify({ slug: "account-deployment" }) });
    expect(created.status).toBe(201);
    const site = created.body;
    const started = await json(`/account/sites/${site.id}/import`, {
      method: "POST", headers: { ...headers, "content-type": "application/zip", prefer: "respond-async" },
      body: zipSync({ "index.html": strToU8("committed account ZIP"), "a.txt": strToU8("asset") }),
    });
    expect(started.status).toBe(202);
    expect(started.body.state).toBe("uploading");
    const session = new URL(started.body.status_url, origin).pathname;
    expect(session).toBe(`/account/sites/${site.id}/deployments/${started.body.deployment_id}`);
    const before = await req(site.url);
    expect(await before.text()).not.toBe("committed account ZIP");
    let status = (await json(session, { headers })).body;
    for (let i = 0; i < 10 && status.state !== "ready"; i++) {
      const step = await json(`${session}/prepare`, { method: "POST", headers });
      expect([200, 202]).toContain(step.status); status = step.body;
    }
    expect(status.state).toBe("ready");
    const commit = await json(`${session}/commit`, { method: "POST", headers });
    expect(commit.status).toBe(200);
    expect(commit.body.state).toBe("committed");
    expect(await (await req(site.url)).text()).toBe("committed account ZIP");
    expect((await json(session, { headers })).body.url).toBe(site.url);
  });

  it("requires trusted human mutation requests and supports cancelling a session", async () => {
    const site = await json("/account/sites", { method: "POST", headers, body: JSON.stringify({ slug: "account-cancel" }) });
    const base = `/account/sites/${site.body.id}/deployments`;
    const body = JSON.stringify({ expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`, files: [] });
    const rejected = await req(base, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body });
    expect(rejected.status).toBe(403);
    const started = await json(base, { method: "POST", headers, body });
    expect(started.status).toBe(201);
    const session = `${base}/${started.body.deployment_id}`;
    expect((await req(`${session}/prepare/extra`, { method: "POST", headers })).status).toBe(405);
    expect((await req(session, { method: "DELETE", headers })).status).toBe(204);
    expect((await json(session, { headers })).body.state).toBe("aborted");
  });
});

it("uploads account manifest paths with spaces, Unicode, and literal percent signs", async () => {
  const site = await json("/account/sites", { method: "POST", headers, body: JSON.stringify({ slug: "account-paths" }) });
  const paths = ["folder/hello world.txt", "café.txt", "%literal.txt"];
  const hash = await sha256Hex("ok");
  const base = `/account/sites/${site.body.id}/deployments`;
  const created = await json(base, { method: "POST", headers, body: JSON.stringify({ expected_version: 0,
    idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
    files: paths.map(path => ({ path, size: 2, sha256: hash, content_type: "text/plain" })),
  }) });
  expect(created.status).toBe(201);
  const session = `${base}/${created.body.deployment_id}`;
  for (const path of paths) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    expect((await req(`${session}/files/${encoded}`, { method: "PUT", headers, body: "ok" })).status).toBe(201);
  }
  expect((await req(`${session}/prepare`, { method: "POST", headers })).status).toBe(200);
  expect((await req(`${session}/commit`, { method: "POST", headers })).status).toBe(200);
  for (const path of paths) {
    expect(await (await req(site.body.url + path.split("/").map(encodeURIComponent).join("/"))).text()).toBe("ok");
  }
});
