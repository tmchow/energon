import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { redeemDeploymentGrantRoute } from "../src/deployment-grants";
import { sha256Hex } from "../src/http";
import { auth, createSite, json, mint } from "./helpers";

async function fixture() {
  const token = await mint(`deployment-grant-${crypto.randomUUID()}`);
  const site = await createSite(token, `grant-${crypto.randomUUID().slice(0, 8)}`);
  const created = await json(`/v1/sites/${site.id}/deployments`, { method: "POST", headers: auth(token), body: JSON.stringify({
    expected_version: 0, idempotency_key: `${Date.now()}.${crypto.randomUUID()}`,
    files: [{ path: "index.html", size: 5, sha256: await sha256Hex("hello"), content_type: "text/html" }],
  }) });
  expect(created.status).toBe(201);
  const deploymentId = created.body.deployment_id;
  const grant = await json("/v1/grants", { method: "POST", headers: auth(token), body: JSON.stringify({
    target: { type: "site_deployment", deployment_id: deploymentId }, expires_in: "15m",
  }) });
  expect(grant.status).toBe(201);
  const request = (suffix = "", method = "GET", body?: string, secret = grant.body.secret) => redeemDeploymentGrantRoute(env,
    new Request(`${env.CONTENT_ORIGIN}/_deployment-grants/${grant.body.id}${suffix}`, { method,
      headers: { authorization: `Bearer ${secret}` }, ...(body === undefined ? {} : { body }) }));
  return { token, site, deploymentId, grant: grant.body, request };
}

describe("whole-site deployment grants", () => {
  it("uses only its credential to upload, prepare, commit and recover a receipt", async () => {
    const f = await fixture();
    expect((await f.request("/files/index.html", "PUT", "hello")).status).toBe(201);
    expect((await f.request("/prepare", "POST")).status).toBe(200);
    const response = await f.request("/commit", "POST");
    expect(response.status).toBe(200);
    const committed = await response.json();
    expect(committed).toMatchObject({ deployment_id: f.deploymentId, state: "committed", url: f.site.url });
    expect(await (await f.request("/commit", "POST")).json()).toEqual(committed);
    expect((await env.DB.prepare("SELECT state FROM upload_grants WHERE id = ?").bind(f.grant.id).first())?.state).toBe("consumed");
    await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", f.grant.id).run();
    expect((await f.request()).status).toBe(200);
  });

  it("rejects undeclared paths, settings, wrong secrets and revoked token access", async () => {
    const f = await fixture();
    expect((await f.request("/files/other.html", "PUT", "hello")).status).toBe(400);
    expect((await f.request("/settings", "POST", "{}")).status).toBe(404);
    expect((await f.request("", "DELETE")).status).toBe(405);
    expect((await f.request("", "GET", undefined, "wrong")).status).toBe(404);
    await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256Hex(f.token)).run();
    expect((await f.request()).status).toBe(410);
    expect((await f.request("/files/index.html", "PUT", "hello")).status).toBe(410);
  });
});

it("expires mutation authority while retaining terminal results for exactly seven days", async () => {
  const f = await fixture();
  await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", f.grant.id).run();
  expect((await f.request("/files/index.html", "PUT", "hello")).status).toBe(410);
  await env.DB.prepare("UPDATE upload_grants SET expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() + 60_000).toISOString(), f.grant.id).run();
  expect((await f.request("/files/index.html", "PUT", "hello")).status).toBe(201);
  await f.request("/prepare", "POST");
  await f.request("/commit", "POST");
  const { purgeGrants } = await import("../src/grants");
  const terminal = await env.DB.prepare("SELECT receipt_expires_at FROM site_deployments WHERE id = ?").bind(f.deploymentId)
    .first<{ receipt_expires_at: string }>();
  await purgeGrants(env, Date.parse(terminal!.receipt_expires_at) - 1);
  expect(await env.DB.prepare("SELECT id FROM upload_grants WHERE id = ?").bind(f.grant.id).first()).not.toBeNull();
  await purgeGrants(env, Date.parse(terminal!.receipt_expires_at));
  expect((await f.request()).status).toBe(404);
});

it("rejects altered grant intent and wrong hosts without redirecting credentials", async () => {
  const f = await fixture();
  const altered = await json("/v1/grants", { method: "POST", headers: auth(f.token), body: JSON.stringify({
    target: { type: "site_deployment", deployment_id: f.deploymentId, files: [] },
  }) });
  expect(altered.status).toBe(400);
  const wrongHost = await redeemDeploymentGrantRoute(env, new Request(`${env.PUBLIC_ORIGIN}/_deployment-grants/${f.grant.id}`, {
    headers: { authorization: `Bearer ${f.grant.secret}` },
  }));
  expect(wrongHost.status).toBe(404);
  expect(wrongHost.headers.has("location")).toBe(false);
  await env.DB.prepare("UPDATE upload_grants SET deployment_base_generation = 7 WHERE id = ?").bind(f.grant.id).run();
  expect((await f.request()).status).toBe(404);
});

it("allows two grants to recover one publication without advancing the generation twice", async () => {
  const f = await fixture();
  await f.request("/files/index.html", "PUT", "hello");
  await f.request("/prepare", "POST");
  const second = await json("/v1/grants", { method: "POST", headers: auth(f.token), body: JSON.stringify({
    target: { type: "site_deployment", deployment_id: f.deploymentId },
  }) });
  expect(second.status).toBe(201);
  const responses = await Promise.all([f.request("/commit", "POST"), redeemDeploymentGrantRoute(env,
    new Request(`${env.CONTENT_ORIGIN}/_deployment-grants/${second.body.id}/commit`, { method: "POST",
      headers: { authorization: `Bearer ${second.body.secret}` } }))]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect((await env.DB.prepare("SELECT content_generation FROM sites WHERE id = ?").bind(f.site.id).first())?.content_generation).toBe(1);
});

it("revalidates revocation after a streamed upload before recording the file", async () => {
  const f = await fixture();
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent) { controller.close(); return; }
      sent = true;
      await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE token_hash = ?")
        .bind(new Date().toISOString(), await sha256Hex(f.token)).run();
      controller.enqueue(new TextEncoder().encode("hello"));
    },
  }, { highWaterMark: 0 });
  const response = await redeemDeploymentGrantRoute(env, new Request(`${env.CONTENT_ORIGIN}/_deployment-grants/${f.grant.id}/files/index.html`, {
    method: "PUT", headers: { authorization: `Bearer ${f.grant.secret}` }, body,
  }));
  expect(response.status).toBe(410);
  expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_version_files WHERE version_id =
    (SELECT version_id FROM site_deployments WHERE id = ?)`).bind(f.deploymentId).first())?.n).toBe(0);
});

it("lets the owner recover a receipt after token revocation and expires it explicitly", async () => {
  const f = await fixture();
  await f.request("/files/index.html", "PUT", "hello");
  await f.request("/prepare", "POST");
  await f.request("/commit", "POST");
  await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), await sha256Hex(f.token)).run();
  expect((await f.request()).status).toBe(410);
  const recoveryToken = await mint("deployment-grant-owner-recovery");
  const recovered = await json(`/v1/sites/${f.site.id}/deployments/${f.deploymentId}`, { headers: auth(recoveryToken) });
  expect(recovered.status).toBe(200);
  expect(recovered.body.url).toBe(f.site.url);
  await env.DB.prepare("UPDATE site_deployments SET receipt_expires_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), f.deploymentId).run();
  expect((await json(`/v1/sites/${f.site.id}/deployments/${f.deploymentId}`, { headers: auth(recoveryToken) })).status).toBe(410);
});

it("accepts empty streamed operation bodies but rejects nonempty settings bodies", async () => {
  const f = await fixture();
  expect((await f.request("/files/index.html", "PUT", "hello")).status).toBe(201);
  expect((await f.request("/prepare", "POST", "")).status).toBe(200);
  expect((await f.request("/commit", "POST", "{}")).status).toBe(400);
  expect((await f.request("/commit", "POST", "")).status).toBe(200);
});
