import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareClient, setupAccess, validateConfig, verifyAccess } from "../../scripts/setup-access.mjs";

const config = { account_id: "a".repeat(32), hub_hostname: "hub.example.com", content_hostname: "share.example.com", identity_provider_id: "11111111-1111-4111-8111-111111111111", allowed_emails: ["Owner@example.com"] };
function fixture() {
  const apps: any[] = [], policies: any[] = [], writes: string[] = [];
  let failApp = false;
  const client = async (path: string, method = "GET", body?: any): Promise<any> => {
    if (path.endsWith("/organizations")) return { result: { auth_domain: "example.cloudflareaccess.com" } };
    if (path.includes("/identity_providers?")) return { result: [{ id: config.identity_provider_id, name: "Workspace", type: "google-apps" }] };
    if (/\/apps\/[^/]+\/policies\?/.test(path)) {
      const app = apps.find((a) => path.includes(`/apps/${a.id}/`));
      return { result: structuredClone((app?.policies ?? []).map((p: any) => policies.find((policy) => policy.id === (typeof p === "string" ? p : p.id)))) };
    }
    if (path.includes("/policies?")) return { result: structuredClone(policies) };
    if (path.includes("/apps?")) return { result: structuredClone(apps) };
    if (method === "POST") {
      if (path.endsWith("/apps") && failApp) throw new Error("Network interrupted");
      writes.push(path);
      const collection = path.endsWith("/apps") ? apps : policies;
      const item = { ...structuredClone(body), id: `${path.endsWith("/apps") ? "app" : "policy"}-${collection.length}`, aud: "hub-aud" };
      collection.push(item);return { result: structuredClone(item) };
    }
    return { result: structuredClone(apps.find((a) => path.endsWith("/" + a.id))) };
  };
  return { apps, policies, writes, client, interrupt: (value: boolean) => { failApp = value; } };
}

describe("Access setup", () => {
  it("plans without writes and reports the exact operator identity", async () => {
    const f = fixture();const result = await setupAccess(config, f.client);
    expect(result.applied).toBe(false);expect(f.writes).toEqual([]);
    if (result.applied) throw new Error("Expected preview");
    expect(result.plan.allowed_emails).toEqual(["owner@example.com"]);
  });
  it("creates the hub and six-path bypass then reuses them without writes", async () => {
    const f = fixture();const result = await setupAccess(config, f.client, true);
    expect(result).toMatchObject({ applied: true, ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com", ACCESS_AUD: "hub-aud" });
    expect(f.apps[0].allowed_idps).toEqual([config.identity_provider_id]);
    expect(f.apps[1].destinations).toHaveLength(6);
    expect(f.apps.flatMap((a) => a.destinations).some((d) => d.uri.includes(config.content_hostname))).toBe(false);
    expect(f.policies[0].include).toEqual([{ email: { email: "owner@example.com" } }]);
    await setupAccess(config, f.client, true);expect(f.writes).toHaveLength(4);
  });
  it.each(["domain", "warp", "approval", "isolation", "duration"])("rejects unexpected %s overrides on existing resources", async (field) => {
    const f = fixture();await setupAccess(config, f.client, true);f.writes.length = 0;
    if (field === "domain") f.apps[1].domain = config.content_hostname;
    if (field === "warp") f.apps[0].allow_authenticate_via_warp = true;
    if (field === "approval") f.policies[0].approval_required = true;
    if (field === "isolation") f.policies[0].isolation_required = true;
    if (field === "duration") f.policies[0].session_duration = "1h";
    await expect(setupAccess(config, f.client, true)).rejects.toThrow(/conflict/);expect(f.writes).toEqual([]);
  });
  it("resumes after policies were created but application creation failed", async () => {
    const f = fixture();f.interrupt(true);
    await expect(setupAccess(config, f.client, true)).rejects.toThrow("Network interrupted");
    expect(f.policies).toHaveLength(2);f.interrupt(false);
    await setupAccess(config, f.client, true);expect(f.writes).toHaveLength(4);
  });
  it("recovers when creation succeeded but the response was lost", async () => {
    const f = fixture();let lost = false;
    const client = async (path: string, method?: string, body?: unknown) => {
      const response = await f.client(path, method, body);
      if (!lost && method === "POST" && path.endsWith("/apps")) { lost = true;throw new Error("Response lost"); }
      return response;
    };
    await expect(setupAccess(config, client, true)).rejects.toThrow("Response lost");
    await setupAccess(config, f.client, true);expect(f.apps).toHaveLength(2);expect(f.policies).toHaveLength(2);
  });
  it("checks later inventory pages for conflicting applications", async () => {
    const f = fixture();
    const client = async (path: string, method?: string, body?: unknown) => {
      if (path.includes("/apps?page=1")) return { result: [], result_info: { total_pages: 2 } };
      if (path.includes("/apps?page=2")) return { result: [{ id: "other", domain: config.content_hostname }], result_info: { total_pages: 2 } };
      return f.client(path, method, body);
    };
    await expect(setupAccess(config, client, true)).rejects.toThrow("overlap");expect(f.writes).toEqual([]);
  });
  it("rejects altered policies before any writes", async () => {
    const f = fixture();await setupAccess(config, f.client, true);f.writes.length = 0;
    f.policies[0].include = [{ everyone: {} }];
    await expect(setupAccess(config, f.client, true)).rejects.toThrow("Policy conflict");expect(f.writes).toEqual([]);
  });
  it.each(["hub.example.com", "share.example.com", "*.example.com"])("rejects overlapping destination %s before writes", async (uri) => {
    const f = fixture();f.apps.push({ id: "other", name: "other", destinations: [{ type: "public", uri }] });
    await expect(setupAccess(config, f.client, true)).rejects.toThrow("overlap");expect(f.writes).toEqual([]);
  });
  it.each(["worker", "all_workers", "preview_worker", "all_preview_workers"])("rejects %s destinations before preview or apply writes", async (type) => {
    for (const apply of [false, true]) {
      const f = fixture();f.apps.push({ id: "other", name: "other", destinations: [{ type }] });
      await expect(setupAccess(config, f.client, apply)).rejects.toThrow("overlap");expect(f.writes).toEqual([]);
    }
  });
  it("rejects missing providers before writes", async () => {
    const f = fixture();
    await expect(setupAccess({ ...config, identity_provider_id: "22222222-2222-4222-8222-222222222222" }, f.client, true)).rejects.toThrow("not visible");
    expect(f.writes).toEqual([]);
  });
  it("fails readback drift without creating the bypass application", async () => {
    const f = fixture();const client = async (path: string, method?: string, body?: any) => {
      const response = await f.client(path, method, body);
      if (path.endsWith("/apps/app-0")) response.result.allowed_idps = [];
      return response;
    };
    await expect(setupAccess(config, client, true)).rejects.toThrow("readback differs");expect(f.apps).toHaveLength(1);
  });
  it.each([{ content_hostname: config.hub_hostname }, { hub_hostname: "https://hub.example.com" }, { allowed_emails: [] }, { allowed_emails: ["*@example.com"] }, { account_id: "../account" }, { token: "not-permitted" }])("rejects invalid configuration %j", (overrides) => {
    expect(() => validateConfig({ ...config, ...overrides })).toThrow();
  });
});


async function existing() {
  const f = fixture();
  await setupAccess(config, f.client, true);
  f.writes.length = 0;
  f.apps.forEach((app, i) => { app.id = `${i + 2}`.repeat(8) + "-1111-4111-8111-111111111111"; app.name = `Custom application ${i}`; });
  f.policies.forEach((policy, i) => { policy.name = `Custom policy ${i}`; });
  const input = { ...config, hub_application_id: f.apps[0].id, bypass_application_id: f.apps[1].id };
  const reads: string[] = [];
  const client = async (path: string, method = "GET", body?: unknown) => {
    expect(method).toBe("GET");
    expect(body).toBeUndefined();
    reads.push(path);
    return f.client(path, method, body);
  };
  return { ...f, input, client, reads };
}

describe("existing Access verification", () => {
  it("accepts custom display names with exact security settings and only reads", async () => {
    const f = await existing();
    f.apps[0].domain = config.hub_hostname;
    f.apps[1].domain = config.hub_hostname + "/v1*";
    f.apps[1].destinations.reverse();
    f.policies.push({ id: "unrelated", name: "Unrelated", decision: "bypass" });
    expect(await verifyAccess(f.input, f.client)).toMatchObject({ verified: true, applied: false, ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com", ACCESS_AUD: "hub-aud", application_ids: [f.apps[0].id, f.apps[1].id], policy_ids: ["policy-0", "policy-1"] });
    expect(f.reads).toContain(`/accounts/${config.account_id}/access/apps/${f.apps[0].id}/policies?page=1&per_page=100`);
    expect(f.writes).toEqual([]);
  });
  it.each([false, true])("rejects verification IDs in creation mode (apply=%s) before requests", async (apply) => {
    const f = await existing();
    await expect(setupAccess(f.input, f.client, apply)).rejects.toThrow("Configuration accepts only");
    expect(f.reads).toEqual([]);
  });
  it.each(["missing", "swapped", "same", "malformed"])("rejects %s IDs without writes", async (problem) => {
    const f = await existing();
    if (problem === "missing") f.input.hub_application_id = "ffffffff-1111-4111-8111-111111111111";
    if (problem === "swapped") [f.input.hub_application_id, f.input.bypass_application_id] = [f.input.bypass_application_id, f.input.hub_application_id];
    if (problem === "same") f.input.bypass_application_id = f.input.hub_application_id;
    if (problem === "malformed") f.input.hub_application_id = "../../apps";
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });
  it.each(["allowed_idps", "destinations", "domain", "self_hosted_domains", "allow_authenticate_via_warp", "options_preflight_bypass", "type", "session_duration", "auto_redirect_to_identity", "policies"])("reports application ID and differing %s", async (field) => {
    const f = await existing();
    const values: Record<string, unknown> = { allowed_idps: [], destinations: [{ type: "public", uri: config.content_hostname }], domain: "*.example.com", self_hosted_domains: [config.content_hostname], allow_authenticate_via_warp: true, options_preflight_bypass: true, type: "saas", session_duration: "720h", auto_redirect_to_identity: false, policies: [{ id: "policy-0" }, { id: "policy-1" }] };
    f.apps[0][field] = values[field];
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow(f.apps[0].id);
    expect(f.writes).toEqual([]);
  });
  it.each(["decision", "include", "exclude", "require", "approval_required", "isolation_required", "session_duration", "connection_rules"])("reports attached policy ID and differing %s", async (field) => {
    const f = await existing();
    const values: Record<string, unknown> = { decision: "bypass", include: [{ everyone: {} }], exclude: [{ email: { email: "owner@example.com" } }], require: [{ service_token: { token_id: "other" } }], approval_required: true, isolation_required: true, session_duration: "720h", connection_rules: { rdp: {} } };
    f.policies[0][field] = values[field];
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow(`Policy policy-0 on application ${f.apps[0].id} differs: ${field}`);
    expect(f.writes).toEqual([]);
  });
  it("rejects mismatched readback IDs rather than trusting inventory", async () => {
    const f = await existing();
    const client = async (path: string) => {
      const r = await f.client(path);
      if (path.endsWith(`/apps/${f.apps[0].id}`)) r.result.id = f.apps[1].id;
      return r;
    };
    await expect(verifyAccess(f.input, client)).rejects.toThrow("readback ID differs");
  });
  it("rejects embedded policy overrides even if policy inventory matches", async () => {
    const f = await existing();
    f.apps[0].policies = [{ ...f.policies[0], include: [{ everyone: {} }] }];
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow("Embedded policy policy-0");
  });
  it("rejects partial embedded policy overrides", async () => {
    const f = await existing();
    f.apps[0].policies = [{ id: "policy-0", approval_required: true }];
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow("Embedded policy policy-0");
  });
  it.each(["public", "worker", "all_workers", "preview_worker", "all_preview_workers"])("rejects another %s overlap with its ID", async (type) => {
    const f = await existing();
    f.apps.push({ id: "overlapping-app", destinations: [{ type, uri: config.content_hostname }] });
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow("overlapping-app");
  });
  it.each(["share.example.com", "*.example.com"])("rejects another app's legacy self-hosted domain %s", async (domain) => {
    const f = await existing();
    f.apps.push({ id: "legacy-overlap", domain: "unrelated.example.net", self_hosted_domains: [domain] });
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow("legacy-overlap");
  });
  it("rejects an extra policy on a later attached-policy page", async () => {
    const f = await existing();
    const client = async (path: string) => {
      if (path.includes(`/apps/${f.apps[0].id}/policies?`)) return { result: [path.includes("page=1&") ? f.policies[0] : f.policies[1]], result_info: { total_pages: 2 } };
      return f.client(path);
    };
    await expect(verifyAccess(f.input, client)).rejects.toThrow("expected exactly one policy; found IDs policy-0, policy-1");
  });
  it("rejects an unknown attached policy reference", async () => {
    const f = await existing();
    f.apps[0].policies = [{ id: "unknown-policy" }];
    await expect(verifyAccess(f.input, f.client)).rejects.toThrow("expected exactly one policy");
  });
});


describe("Cloudflare client diagnostics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/zones/zone/dns_records?name=share.example.com", "GET", "DNS Read permission", "earlier writes"],
    ["/accounts/account/access/apps", "GET", "account/zone scope", "earlier writes"],
    ["/accounts/account/access/apps", "POST", "earlier writes may have succeeded", "empty inventory"],
  ])("explains failed %s %s without exposing response data", async (path, method, expected, absent) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false, errors: [{ message: "sensitive response detail" }],
    }), { status: 403 })));
    const failure = cloudflareClient("test-token")(path, method);
    await expect(failure).rejects.toThrow(expected);
    await expect(failure).rejects.not.toThrow(absent);
    await expect(failure).rejects.not.toThrow("sensitive response detail");
    await expect(failure).rejects.not.toThrow("test-token");
    if (method === "GET") await expect(failure).rejects.toThrow("do not treat it as an empty inventory");
  });
});
