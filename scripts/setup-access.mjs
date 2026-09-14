import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const BYPASS = ["/v1*", "/health", "/llms.txt", "/auth.md", "/favicon.svg", "/static*"];

function validateBaseConfig(input, additionalKeys = []) {
  const required = ["account_id", "hub_hostname", "content_hostname", "identity_provider_id", "allowed_emails", ...additionalKeys];
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !required.includes(key))) {
    throw new Error(`Configuration accepts only: ${required.join(", ")}`);
  }
  if (!/^[a-f0-9]{32}$/.test(input.account_id ?? "")) throw new Error("account_id must be a Cloudflare account ID.");
  for (const key of ["hub_hostname", "content_hostname"]) {
    if (typeof input[key] !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(input[key])) {
      throw new Error(`${key} must be a lowercase hostname, without a scheme, path, or wildcard.`);
    }
  }
  if (input.hub_hostname === input.content_hostname) throw new Error("Hub and content hostnames must differ.");
  if (!/^[a-f0-9-]{36}$/.test(input.identity_provider_id ?? "")) throw new Error("identity_provider_id must identify an existing provider.");
  if (!Array.isArray(input.allowed_emails) || input.allowed_emails.length === 0 || input.allowed_emails.some((email) => typeof email !== "string" || !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email))) {
    throw new Error("allowed_emails must contain exact email addresses.");
  }
  return { ...input, allowed_emails: [...new Set(input.allowed_emails.map((email) => email.toLowerCase()))].sort() };
}

export function validateConfig(input) {
  return validateBaseConfig(input);
}

function validateVerificationConfig(input) {
  const keys = ["hub_application_id", "bypass_application_id"];
  const config = validateBaseConfig(input, keys);
  for (const key of keys) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config[key] ?? "")) throw new Error(`${key} must be an existing application ID for --verify.`);
  }
  if (config.hub_application_id === config.bypass_application_id) throw new Error("Hub and bypass application IDs must differ.");
  return config;
}

export function cloudflareClient(token) {
  if (!token?.trim() || /[\r\n]/.test(token)) throw new Error("Set CLOUDFLARE_ACCESS_API_TOKEN in the environment.");
  return async (path, method = "GET", body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Cloudflare ${method} ${path}: invalid response (${response.status}).`); }
    // Provider responses can include credentials; never echo API response bodies.
    if (!response.ok || data.success !== true) throw new Error(`Cloudflare ${method} ${path} failed (${response.status}). Check account scope and Access permissions; rerun to reconcile any partial creation.`);
    return data;
  };
}

async function list(client, path) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const { result, result_info: info } = await client(`${path}?page=${page}&per_page=100`);
    if (!Array.isArray(result)) throw new Error(`Incomplete inventory: ${path}`);
    all.push(...result);
    if (info?.total_pages !== undefined ? page >= info.total_pages : result.length < 100) return all;
  }
  throw new Error(`Inventory exceeded 100 pages: ${path}`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function differingFields(actual, desired, fields) {
  return fields.filter((key) => !isDeepStrictEqual(canonical(actual[key]), canonical(desired[key])));
}

function policyDifferences(actual, desired, names = true) {
  const fields = [...(names ? ["name"] : []), "decision", "include", "exclude", "require"];
  const normalized = { ...actual, include: actual.include ?? [], exclude: actual.exclude ?? [], require: actual.require ?? [] };
  return [...differingFields(normalized, desired, fields), ...["approval_required", "isolation_required", "session_duration", "connection_rules"].filter((key) => actual[key])];
}

function samePolicy(actual, desired) {
  return policyDifferences(actual, desired).length === 0;
}

function appPolicyIds(app) {
  return (app.policies ?? []).map((p) => typeof p === "string" ? p : p.id).sort();
}

function appDifferences(actual, desired, names = true) {
  const fields = [...(names ? ["name"] : []), "type", "session_duration", "auto_redirect_to_identity", "allowed_idps", "destinations"];
  const differences = differingFields(actual, desired, fields);
  for (const key of ["allow_authenticate_via_warp", "options_preflight_bypass"]) if (actual[key]) differences.push(key);
  if (actual.domain && !desired.destinations.some((d) => d.type === "public" && d.uri === actual.domain)) differences.push("domain");
  if (actual.self_hosted_domains?.some((domain) => !desired.destinations.some((d) => d.uri === domain))) differences.push("self_hosted_domains");
  if (!isDeepStrictEqual(appPolicyIds(actual), appPolicyIds(desired))) differences.push("policies");
  return differences;
}

function sameApp(actual, desired) {
  return appDifferences(actual, desired).length === 0;
}

function touchesHost(app, host) {
  const domains = [app.domain, ...(app.self_hosted_domains ?? []), ...(app.destinations ?? []).filter((d) => d.type === "public").map((d) => d.uri)].filter(Boolean);
  return domains.some((domain) => {
    const hostname = domain.split("/")[0];
    return hostname === host || (hostname.startsWith("*.") && host.endsWith(hostname.slice(1))) || hostname === "*";
  });
}

async function inventory(config, client) {
  const base = `/accounts/${config.account_id}/access`;
  const organization = (await client(`${base}/organizations`)).result;
  const team = organization?.auth_domain;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team ?? "")) throw new Error("Complete Zero Trust enrollment before setup; organization must have an auth_domain.");
  const providers = await list(client, `${base}/identity_providers`);
  const provider = providers.find((p) => p.id === config.identity_provider_id);
  if (!provider) throw new Error("Selected identity provider is not visible in this account. Check ID and read permissions.");
  const apps = await list(client, `${base}/apps`);
  const prefix = `Energon ${config.hub_hostname}`;
  const desiredPolicies = [
    { name: `${prefix} members`, decision: "allow", include: config.allowed_emails.map((email) => ({ email: { email } })), exclude: [], require: [] },
    { name: `${prefix} public`, decision: "bypass", include: [{ everyone: {} }], exclude: [], require: [] },
  ];
  const desiredApps = [
    { name: `${prefix} hub`, type: "self_hosted", allow_authenticate_via_warp: false, session_duration: "24h", auto_redirect_to_identity: true, allowed_idps: [provider.id], destinations: [{ type: "public", uri: config.hub_hostname }] },
    { name: `${prefix} public`, type: "self_hosted", allow_authenticate_via_warp: false, session_duration: "24h", auto_redirect_to_identity: false, allowed_idps: [], destinations: BYPASS.map((path) => ({ type: "public", uri: config.hub_hostname + path })) },
  ];
  return { base, team, provider, apps, desiredApps, desiredPolicies };
}

function rejectOverlaps(apps, selected, config) {
  const overlaps = apps.filter((a) => !selected.some((match) => match?.id === a.id) && (touchesHost(a, config.hub_hostname) || touchesHost(a, config.content_hostname) || a.destinations?.some((d) => ["worker", "all_workers", "preview_worker", "all_preview_workers"].includes(d.type))));
  if (overlaps.length) throw new Error(`Existing Access applications overlap the requested hostnames or use Worker-level destinations: ${overlaps.map((a) => a.id).join(", ")}. Inspect these IDs; no changes made. For existing Energon apps use --verify with explicit IDs.`);
}

export async function verifyAccess(rawConfig, client) {
  const config = validateVerificationConfig(rawConfig);
  const { base, team, apps, desiredApps, desiredPolicies } = await inventory(config, client);
  const ids = [config.hub_application_id, config.bypass_application_id];
  const selected = [];
  const policyIds = [];
  for (const [i, id] of ids.entries()) {
    if (apps.filter((a) => a.id === id).length !== 1) throw new Error(`Application ${id} is missing or ambiguous in this account; no changes made.`);
    const actual = (await client(`${base}/apps/${id}`)).result;
    if (actual?.id !== id) throw new Error(`Application readback ID differs from ${id}; no changes made.`);
    const attached = await list(client, `${base}/apps/${id}/policies`);
    if (attached.length !== 1 || !attached[0]?.id) throw new Error(`Application ${id}: expected exactly one policy; found IDs ${attached.map((p) => p?.id ?? "missing").join(", ") || "none"}. No changes made.`);
    const policy = attached[0];
    const policyDiff = policyDifferences(policy, desiredPolicies[i], false);
    if (policyDiff.length) throw new Error(`Policy ${policy.id} on application ${id} differs: ${policyDiff.join(", ")}. No changes made.`);
    const differences = appDifferences(actual, { ...desiredApps[i], policies: [policy.id] }, false);
    if (differences.length) throw new Error(`Application ${id} differs: ${differences.join(", ")}. No changes made.`);
    // Embedded policy settings can carry application-specific overrides.
    for (const embedded of actual.policies ?? []) {
      if (embedded && typeof embedded === "object") {
        const diff = policyDifferences({ ...policy, ...embedded }, desiredPolicies[i], false);
        if (diff.length) throw new Error(`Embedded policy ${embedded.id} on application ${id} differs: ${diff.join(", ")}. No changes made.`);
      }
    }
    selected.push(actual);
    policyIds.push(policy.id);
  }
  rejectOverlaps(apps, selected, config);
  if (!selected[0].aud) throw new Error(`Hub application ${ids[0]} returned no audience tag.`);
  return { verified: true, applied: false, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: selected[0].aud, application_ids: ids, policy_ids: policyIds };
}

export async function setupAccess(rawConfig, client, apply = false, report = () => {}) {
  const config = validateConfig(rawConfig);
  const { base, team, provider, apps, desiredApps, desiredPolicies } = await inventory(config, client);
  const policies = await list(client, `${base}/policies`);
  const matchingPolicies = desiredPolicies.map((desired) => {
    const matches = policies.filter((p) => p.name === desired.name);
    if (matches.length > 1 || (matches.length === 1 && !samePolicy(matches[0], desired))) throw new Error(`Policy conflict: IDs ${matches.map((p) => p.id).join(", ")}; differs: ${matches.length === 1 ? policyDifferences(matches[0], desired).join(", ") : "duplicate names"}. No changes made.`);
    return matches[0];
  });
  const matchingApps = desiredApps.map((desired, i) => {
    const matches = apps.filter((a) => a.name === desired.name);
    if (matches.length > 1 || (matches.length === 1 && (!matchingPolicies[i] || !sameApp(matches[0], { ...desired, policies: [{ id: matchingPolicies[i].id }] })))) throw new Error(`Application conflict: IDs ${matches.map((a) => a.id).join(", ")}; differs: ${matches.length === 1 && matchingPolicies[i] ? appDifferences(matches[0], { ...desired, policies: [matchingPolicies[i].id] }).join(", ") : "missing policy or duplicate names"}. No changes made. Use --verify with explicit IDs for an existing installation.`);
    return matches[0];
  });
  rejectOverlaps(apps, matchingApps, config);
  const plan = { account_id: config.account_id, hub: config.hub_hostname, content: config.content_hostname, provider: { id: provider.id, name: provider.name, type: provider.type }, allowed_emails: config.allowed_emails, resources: desiredApps.map((a, i) => ({ app: a.name, app_action: matchingApps[i] ? "reuse" : "create", policy_action: matchingPolicies[i] ? "reuse" : "create" })) };
  report({ plan });
  if (!apply) return { applied: false, plan };
  for (let i = 0; i < desiredPolicies.length; i++) {
    if (!matchingPolicies[i]) {
      matchingPolicies[i] = (await client(`${base}/policies`, "POST", desiredPolicies[i])).result;
      report({ created_policy: matchingPolicies[i]?.id });
    }
    if (!matchingPolicies[i]?.id || !samePolicy(matchingPolicies[i], desiredPolicies[i])) throw new Error("Policy creation returned unexpected settings; stop and inspect before rerunning.");
  }
  for (let i = 0; i < desiredApps.length; i++) {
    const desired = { ...desiredApps[i], policies: [{ id: matchingPolicies[i].id, precedence: 1 }] };
    if (!matchingApps[i]) {
      matchingApps[i] = (await client(`${base}/apps`, "POST", desired)).result;
      report({ created_application: matchingApps[i]?.id });
    }
    const id = matchingApps[i]?.id;
    if (!id) throw new Error("Application creation returned no ID; stop and inspect before rerunning.");
    const actual = (await client(`${base}/apps/${id}`)).result;
    if (!sameApp(actual, desired)) throw new Error(`Application readback differs: ${id}. Stop and inspect before rerunning.`);
    matchingApps[i] = actual;
  }
  if (!matchingApps[0].aud) throw new Error("Hub application returned no audience tag.");
  return { applied: true, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: matchingApps[0].aud, application_ids: matchingApps.map((a) => a.id), policy_ids: matchingPolicies.map((p) => p.id) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run setup:access -- --config <file.json> [--apply | --verify]\nDefault: read-only creation plan; --verify checks explicit existing app IDs without writes. Requires CLOUDFLARE_ACCESS_API_TOKEN. Never changes providers or deletes resources.");
    return;
  }
  if (args[0] !== "--config" || !args[1] || args.length > 3 || (args[2] && !["--apply", "--verify"].includes(args[2]))) throw new Error("Usage: --config <file.json> [--apply | --verify]");
  const config = JSON.parse(await readFile(args[1], "utf8"));
  const client = cloudflareClient(process.env.CLOUDFLARE_ACCESS_API_TOKEN);
  const result = args[2] === "--verify" ? await verifyAccess(config, client) : await setupAccess(config, client, args[2] === "--apply", (event) => console.log(JSON.stringify(event)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
