import { describe, expect, it } from "vitest";
import {
  collectPathLiterals,
  dispatch,
  matchPath,
  methodMissFor,
} from "../../src/route-table";
import { V1_ADMIN, V1_CLASSES, V1_HANDSHAKE, V1_LOOSE_ONE, V1_TOKEN, v1PathLiterals } from "../../src/v1-routes";
import type { Env } from "../../src/types";

const env = {} as Env;
const exec = {} as ExecutionContext;

describe("route-table", () => {
  it("matches literals and regex groups", () => {
    expect(matchPath("/v1/whoami", "/v1/whoami")).toEqual([]);
    expect(matchPath("/v1/whoami", "/v1/whoami/")).toBeNull();
    expect(matchPath(V1_LOOSE_ONE, "/v1/files/abc123")).toEqual(["abc123"]);
    expect(matchPath(V1_LOOSE_ONE, "/v1/files/abc123/extra")).toEqual(["abc123"]);
    expect(matchPath(V1_LOOSE_ONE, "/v1/files")).toBeNull();
  });

  it("derives method-miss policy from auth kind", () => {
    expect(methodMissFor("none")).toBe("not_allowed");
    expect(methodMissFor("token")).toBe("continue");
    expect(methodMissFor("admin")).toBe("continue");
  });

  it("handshake method miss is 405 without consulting later tables", async () => {
    const response = await dispatch(
      new Request("https://e.test/v1/connections"),
      env,
      exec,
      "/v1/connections",
      "GET",
      V1_HANDSHAKE,
    );
    expect(response?.status).toBe(405);
    const body = (await response?.json()) as { error?: string };
    expect(body.error).toBe("method_not_allowed");
  });

  it("token and admin method miss fall through without authenticating", async () => {
    const tokenMiss = await dispatch(
      new Request("https://e.test/v1/cleanup"),
      env,
      exec,
      "/v1/cleanup",
      "GET",
      V1_TOKEN,
    );
    expect(tokenMiss).toBeNull();

    const adminMiss = await dispatch(
      new Request("https://e.test/v1/admin/sweep"),
      env,
      exec,
      "/v1/admin/sweep",
      "GET",
      V1_ADMIN,
    );
    expect(adminMiss).toBeNull();
  });

  it("keeps one path pattern per /v1 class table", () => {
    const keys = V1_CLASSES.flatMap((table) =>
      table.routes.map((route) => (typeof route.path === "string" ? route.path : route.path.source)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists pre-schema discovery paths with the authenticated table", () => {
    const literals = v1PathLiterals();
    expect(literals).toEqual(expect.arrayContaining(["/v1/help", "/v1/openapi.json", "/v1/health", "/v1/whoami"]));
    expect(collectPathLiterals(V1_CLASSES)).not.toContain("/v1/help");
  });
});
