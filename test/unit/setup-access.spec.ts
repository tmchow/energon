import { describe, expect, it } from "vitest";
import { setupAccess, validateConfig } from "../../scripts/setup-access.mjs";

const config = { account_id: "a".repeat(32), hub_hostname: "hub.example.com", content_hostname: "share.example.com", identity_provider_id: "11111111-1111-4111-8111-111111111111", allowed_emails: ["Owner@example.com"] };
function fixture() {
  const apps: any[] = [], policies: any[] = [], writes: string[] = [];
  let failApp = false;
  const client = async (path: string, method = "GET", body?: any): Promise<any> => {
    if (path.endsWith("/organizations")) return { result: { auth_domain: "example.cloudflareaccess.com" } };
    if (path.includes("/identity_providers?")) return { result: [{ id: config.identity_provider_id, name: "Workspace", type: "google-apps" }] };
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
