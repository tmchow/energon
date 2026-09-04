import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpBody } from "../../src/auth";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const ORIGIN = "https://hub.energon.example.com";
const SAMPLE_PARAMS: Record<string, string> = { slug: "my-slug", id: "abc123", path: "docs/a.txt" };

type Operation = { operationId?: string; responses?: Record<string, unknown>; security?: unknown[] };
type PathItem = Partial<Record<(typeof METHODS)[number], Operation>>;
type Spec = {
  openapi: string;
  paths: Record<string, PathItem>;
  components: { schemas: { Error: { properties: { error: { enum: string[] } } } } };
};

const spec = JSON.parse(readFileSync("openapi/v1.json", "utf8")) as Spec;
const router = readFileSync("src/index.ts", "utf8");
const help = helpBody(ORIGIN) as { openapi: string; routes: Record<string, string> };

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
    for (const match of source.matchAll(/\berror:\s*"([a-z_]+)"/g)) codes.add(match[1]);
  }
  return [...codes].sort();
}

function routerLiterals(): string[] {
  return [...router.matchAll(/path === "(\/v1\/[^"]+)"/g)].map((match) => match[1]);
}

function routerPatterns(): RegExp[] {
  return [...router.matchAll(/path\.match\(\/(\^\\\/v1\\\/[^\n]*?)\/\)/g)].map((match) => new RegExp(match[1]));
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
    expect(open).toEqual(["GET /auth.md", "GET /llms.txt", "GET /v1/health", "GET /v1/help", "GET /v1/openapi.json"]);
  });

  it("documents every /v1 path the router serves, and nothing the router does not", () => {
    const templates = Object.keys(spec.paths).filter((path) => path.startsWith("/v1/"));
    const literals = routerLiterals();
    const patterns = routerPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    for (const template of templates) {
      const routed = literals.includes(template) || patterns.some((pattern) => pattern.test(sampleUrl(template)));
      expect(routed, `${template} has no route in src/index.ts`).toBe(true);
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
  });
});
