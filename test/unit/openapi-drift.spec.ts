import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpBody } from "../../src/auth";
import { gatewayOpenapiResponse, openapiResponse } from "../../src/openapi";
import type { Env } from "../../src/types";
import { v1PathLiterals, v1PathPatterns } from "../../src/v1-routes";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const ORIGIN = "https://hub.energon.example.com";
const SAMPLE_PARAMS: Record<string, string> = { slug: "my-slug", id: "abc123", path: "docs/a.txt", deploymentId: "deployment123", grantId: "grant123" };

type Operation = { operationId?: string; tags?: string[]; responses?: Record<string, unknown>; security?: unknown[]; "x-energon-gateway"?: unknown };
type PathItem = Partial<Record<(typeof METHODS)[number], Operation>>;
type Spec = {
  openapi: string;
  tags: { name: string }[];
  paths: Record<string, PathItem>;
  components: { schemas: { Error: { properties: { error: { enum: string[] } } } } };
};

const spec = JSON.parse(readFileSync("openapi/v1.json", "utf8")) as Spec;
const help = helpBody(ORIGIN) as { openapi: string; gateway_openapi: string; sop: string[]; routes: Record<string, string> };

function operations(): { key: string; op: Operation }[] {
  const found: { key: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op) found.push({ key: `${method.toUpperCase()} ${path}`, op });
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

function runtimeErrorCodes(): string[] {
  const codes = new Set<string>();
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/new ApiError\(\s*\d+,\s*"([a-z_]+)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/new DeploymentError\(\s*"([a-z_]+)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/\berror:\s*"([a-z_]+)"/g)) codes.add(match[1]);
  }
  return [...codes].sort();
}

function sampleUrl(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => SAMPLE_PARAMS[name]);
}

function walkErrorCodes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) walkErrorCodes(child, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "x-error-codes") for (const code of value as string[]) into.add(code);
    else walkErrorCodes(value, into);
  }
}

describe("openapi/v1.json", () => {
  it("is OpenAPI 3.1.0 with an operationId and responses on every operation", () => {
    expect(spec.openapi).toBe("3.1.0");
    const ops = operations();
    expect(ops.length).toBeGreaterThan(0);
    for (const [path, item] of Object.entries(spec.paths)) {
      expect(METHODS.some((method) => item[method]), path).toBe(true);
    }
    for (const { key, op } of ops) {
      expect(op.operationId, key).toMatch(/^\w+$/);
      expect(Object.keys(op.responses ?? {}).length, key).toBeGreaterThan(0);
    }
  });

  it("gives every operation a unique verb-noun operationId and a declared tag", () => {
    const ops = operations();
    const ids = ops.map(({ op }) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const declared = new Set(spec.tags.map((tag) => tag.name));
    for (const { key, op } of ops) {
      expect(op.operationId, key).not.toMatch(/^(get|post|put|patch|delete)V[A-Z]|[a-z]id(?:[A-Z]|$)/);
      expect(op.tags?.length, key).toBeGreaterThan(0);
      expect(declared.has(op.tags![0]), key).toBe(true);
    }
  });

  it("serves deployment-grant paths on the dedicated content origin only", async () => {
    const split = await openapiResponse({ PUBLIC_ORIGIN: ORIGIN, CONTENT_ORIGIN: "https://share.example.com" } as Env).json() as Spec & { paths: Record<string, { servers?: unknown }> };
    expect(split.paths["/_deployment-grants/{grantId}/commit"].servers).toEqual([{ url: "https://share.example.com" }]);
    const local = await openapiResponse({ PUBLIC_ORIGIN: "http://127.0.0.1:8787", CONTENT_ORIGIN: "http://127.0.0.1:8787" } as Env);
    expect(local.status).toBe(200);
    expect(((await local.json()) as { paths: Record<string, { servers?: unknown }> }).paths["/_deployment-grants/{grantId}/commit"].servers).toBeUndefined();
  });

  it("lists the same operations as GET /v1/help routes", () => {
    const documented = operations().map(({ key }) => key);
    expect(documented).toContain("GET /llms.txt");
    expect(documented).toContain("GET /v1/openapi.json");
    expect(documented.sort()).toEqual(Object.keys(help.routes).sort());
  });

  it("only marks the discovery operations as unauthenticated", () => {
    const open = operations()
      .filter(({ op }) => Array.isArray(op.security) && op.security.length === 0)
      .map(({ key }) => key)
      .sort();
    expect(open).toEqual(["GET /auth.md", "GET /llms.txt", "GET /v1/health", "GET /v1/help", "GET /v1/openapi-gateway.json", "GET /v1/openapi.json", "POST /v1/connections", "POST /v1/connections/{id}/token"]);
  });

  it("documents every /v1 path the router serves, and nothing the router does not", () => {
    const templates = Object.keys(spec.paths).filter((path) => path.startsWith("/v1/"));
    const literals = v1PathLiterals();
    const patterns = v1PathPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    for (const template of templates) {
      const routed = literals.includes(template) || patterns.some((pattern) => pattern.test(sampleUrl(template)));
      expect(routed, `${template} has no route in the /v1 table`).toBe(true);
    }
    for (const literal of literals) {
      expect(templates, `${literal} is routed but not in openapi/v1.json`).toContain(literal);
    }
    for (const pattern of patterns) {
      const covered = templates.some((template) => pattern.test(sampleUrl(template)));
      expect(covered, `${pattern.source} is routed but not in openapi/v1.json`).toBe(true);
    }
  });

  it("enumerates exactly the error codes the Worker emits", () => {
    const documented = [...spec.components.schemas.Error.properties.error.enum].sort();
    expect(documented).toEqual(runtimeErrorCodes());

    const perOperation = new Set<string>();
    walkErrorCodes(spec.paths, perOperation);
    walkErrorCodes(spec.components, perOperation);
    for (const code of perOperation) expect(documented, code).toContain(code);
  });

  it("is advertised by GET /v1/help", () => {
    expect(help.openapi).toBe(`${ORIGIN}/v1/openapi.json`);
    expect(help.routes["GET /v1/openapi.json"]).toContain("no auth");
    expect(help.gateway_openapi).toBe(`${ORIGIN}/v1/openapi-gateway.json`);
    expect(help.sop.join("\n")).toContain(`import ${ORIGIN}/v1/openapi-gateway.json, not openapi.json, and bind the gateway credential to ${ORIGIN} only`);
  });
});

const GATEWAY_OPERATIONS = [
  "getHelp", "getHealth", "getLlmsTxt", "getGatewayOpenapi", "whoami",
  "listSites", "createSite", "getSite", "patchSite", "deleteSite", "getSiteFile", "deleteSiteFile",
  "listFiles", "getFile", "patchFile", "deleteFile", "duplicateFile",
  "cleanup", "mintGrant", "getGrant",
  "createDeployment", "getDeployment", "cancelDeployment", "prepareDeployment", "commitDeployment",
];
const EXCLUDED_OPERATIONS = [
  "createFile", "putFile", "putSiteFile", "importSite", "uploadDeploymentFile", "uploadDeploymentArchive",
  "exportOwned", "exportSite",
  "getDeploymentGrant", "uploadDeploymentGrantFile", "uploadDeploymentGrantArchive", "prepareDeploymentGrant", "commitDeploymentGrant",
  "revokeSelf", "startConnection", "exchangeConnection", "getAuthMarkdown", "getOpenapi",
  "listAdminAudit", "listAdminTokens", "revokeAdminTokens", "adminCleanup", "getAdminHealth", "recomputePlatformQuota", "sweepExpiredNow", "unlockShareGate",
];
const BYTE_RESPONSE_EXCEPTIONS = ["getFile", "getSiteFile"];
const SUCCESS_CONTENT = ["application/json", "text/markdown"];

type AnyDoc = { paths: Record<string, Record<string, unknown>>; components?: Record<string, Record<string, unknown>> };

function resolve(doc: AnyDoc, node: unknown): Record<string, unknown> {
  let current = node as Record<string, unknown> | undefined;
  for (let hops = 0; current && typeof current.$ref === "string"; hops++) {
    const ref = current.$ref as string;
    if (hops > 10 || !ref.startsWith("#/")) throw new Error(`unresolvable $ref ${ref}`);
    let target: unknown = doc;
    for (const part of ref.slice(2).split("/")) target = (target as Record<string, unknown> | undefined)?.[part];
    if (!target) throw new Error(`unresolvable $ref ${ref}`);
    current = target as Record<string, unknown>;
  }
  return current ?? {};
}

function gatewayShapeViolations(doc: AnyDoc): string[] {
  const violations: string[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method] as (Operation & { requestBody?: unknown }) | undefined;
      if (!op) continue;
      const id = op.operationId ?? `${method} ${path}`;
      if (op.requestBody) {
        for (const type of Object.keys(resolve(doc, op.requestBody).content ?? {})) {
          if (type !== "application/json") violations.push(`${id} accepts ${type}`);
        }
      }
      for (const [code, response] of Object.entries(op.responses ?? {})) {
        if (!/^(2\d\d|2XX|default)$/.test(code)) continue;
        for (const type of Object.keys(resolve(doc, response).content ?? {})) {
          if (!SUCCESS_CONTENT.includes(type) && !BYTE_RESPONSE_EXCEPTIONS.includes(id)) violations.push(`${id} returns ${type}`);
        }
      }
    }
  }
  return violations;
}

function operationIds(doc: AnyDoc): string[] {
  return Object.values(doc.paths).flatMap((item) => METHODS.flatMap((method) => {
    const op = item[method] as Operation | undefined;
    return op?.operationId ? [op.operationId] : [];
  }));
}

function syntheticDoc(operation: Record<string, unknown>, components: Record<string, Record<string, unknown>> = {}): AnyDoc {
  return { paths: { "/v1/x": { put: { operationId: "synthetic", responses: { "200": { content: { "application/json": {} } } }, ...operation } } }, components };
}

const SPLIT_ENV = { PUBLIC_ORIGIN: ORIGIN, CONTENT_ORIGIN: "https://share.example.com" } as Env;
const SAME_ENV = { PUBLIC_ORIGIN: "http://127.0.0.1:8787", CONTENT_ORIGIN: "http://127.0.0.1:8787" } as Env;

describe("gateway catalog", () => {
  it("classifies every operation in or out of the gateway catalog", () => {
    for (const { key, op } of operations()) expect(typeof op["x-energon-gateway"], key).toBe("boolean");
    const marked = operations().filter(({ op }) => op["x-energon-gateway"] === true).map(({ op }) => op.operationId).sort();
    expect(marked).toEqual([...GATEWAY_OPERATIONS].sort());
    const unmarked = operations().filter(({ op }) => op["x-energon-gateway"] === false).map(({ op }) => op.operationId).sort();
    expect(unmarked).toEqual([...EXCLUDED_OPERATIONS].sort());
  });

  it("serves exactly the gateway operations on the hub origin", async () => {
    for (const env of [SPLIT_ENV, SAME_ENV]) {
      const doc = await gatewayOpenapiResponse(env).json() as AnyDoc & { servers: unknown; tags: { name: string }[] };
      expect(operationIds(doc).sort()).toEqual([...GATEWAY_OPERATIONS].sort());
      expect(Object.keys(doc.paths).some((path) => path.startsWith("/_deployment-grants/"))).toBe(false);
      expect(Object.values(doc.paths).some((item) => "servers" in item)).toBe(false);
      expect(doc.servers).toEqual([{ url: env.PUBLIC_ORIGIN }]);
      for (const item of Object.values(doc.paths)) expect(METHODS.some((method) => item[method])).toBe(true);
      expect(doc.paths["/v1/files/{id}"].parameters).toEqual((spec.paths["/v1/files/{id}"] as Record<string, unknown>).parameters);
      const used = new Set(Object.values(doc.paths).flatMap((item) => METHODS.flatMap((method) => (item[method] as Operation | undefined)?.tags ?? [])));
      expect(doc.tags.map((tag) => tag.name).sort()).toEqual([...used].sort());
    }
  });

  it("keeps byte uploads and binary downloads out of the gateway catalog", async () => {
    const doc = await gatewayOpenapiResponse(SPLIT_ENV).json() as AnyDoc;
    expect(gatewayShapeViolations(doc)).toEqual([]);
    expect(BYTE_RESPONSE_EXCEPTIONS).toEqual(["getFile", "getSiteFile"]);
  });

  it("fails the shape check on byte bodies and binary responses", () => {
    expect(gatewayShapeViolations(syntheticDoc({ requestBody: { content: { "application/octet-stream": {} } } }))).toEqual(["synthetic accepts application/octet-stream"]);
    expect(gatewayShapeViolations(syntheticDoc({ requestBody: { content: { "application/zip": {} } } }))).toEqual(["synthetic accepts application/zip"]);
    expect(gatewayShapeViolations(syntheticDoc({ responses: { "200": { content: { "image/png": {} } } } }))).toEqual(["synthetic returns image/png"]);
    expect(gatewayShapeViolations(syntheticDoc({ responses: { default: { content: { "application/gzip": {} } } } }))).toEqual(["synthetic returns application/gzip"]);
    expect(gatewayShapeViolations(syntheticDoc(
      { responses: { "200": { $ref: "#/components/responses/Bytes" } } },
      { responses: { Bytes: { content: { "application/octet-stream": {} } } } },
    ))).toEqual(["synthetic returns application/octet-stream"]);
    expect(() => gatewayShapeViolations(syntheticDoc({ responses: { "200": { $ref: "#/components/responses/Missing" } } }))).toThrow("unresolvable");
  });

  it("steers publishing searches to grants and the skill", async () => {
    const doc = await gatewayOpenapiResponse(SPLIT_ENV).json() as { paths: Record<string, Record<string, { summary: string; description: string }>> };
    for (const [path, method] of [["/v1/grants", "post"], ["/v1/sites/{id}/deployments", "post"], ["/v1/sites", "post"], ["/v1/files/{id}/duplicate", "post"]]) {
      const op = doc.paths[path][method];
      expect(op.summary.toLowerCase(), path).toMatch(/publish|share/);
      const lead = op.description.split("\n")[0];
      for (const step of ["mint", "helper", "SHA-256", "URL and expiry", "Energon skill"]) expect(lead, `${path} ${step}`).toContain(step);
    }
    expect(doc.paths["/v1/grants"].post.summary).toContain("upload a local file");
    expect(doc.paths["/v1/files/{id}"].get.summary).toContain("stored bytes");
    expect(doc.paths["/v1/sites/{id}/files/{path}"].get.summary).toContain("stored bytes");
  });

  it("strips the gateway marker from both served documents", async () => {
    expect(await openapiResponse(SPLIT_ENV).text()).not.toContain("x-energon-gateway");
    expect(await gatewayOpenapiResponse(SPLIT_ENV).text()).not.toContain("x-energon-gateway");
  });

  it("keeps every existing operation in the full document", async () => {
    const doc = await openapiResponse(SPLIT_ENV).json() as AnyDoc;
    expect(operationIds(doc).sort()).toEqual([...GATEWAY_OPERATIONS, ...EXCLUDED_OPERATIONS].sort());
  });
});
