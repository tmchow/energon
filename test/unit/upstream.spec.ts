import { describe, expect, it } from "vitest";
import { bakedProductVersion } from "../../src/product-version";
import type { Env } from "../../src/types";
import {
  classifyUpstream,
  compareSemver,
  failedSnapshot,
  loadUpstream,
  pageChrome,
  parseGithubRelease,
  parseOperatorNotes,
  parseSemver,
  snapshotFromRelease,
  UPSTREAM_DOCS_UPDATE,
  type GithubRelease,
} from "../../src/upstream";

const release = (over: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: "v1.1.0",
  html_url: "https://example.test/releases/v1.1.0",
  published_at: "2026-09-14T00:00:00.000Z",
  body: "## Operator\n- Restart after deploy\n- D1: none",
  ...over,
});

describe("parseSemver", () => {
  it("reads v-prefixed and plain triples", () => {
    expect(parseSemver("1.0.0")).toEqual([1, 0, 0]);
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("  V10.0.1  ")).toEqual([10, 0, 1]);
  });

  it("rejects pre-release and incomplete values", () => {
    expect(parseSemver("1.0.0-rc.1")).toBeNull();
    expect(parseSemver("1.0")).toBeNull();
    expect(parseSemver("main")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders equal, older, and newer tags", () => {
    expect(compareSemver("1.0.0", "v1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeNull();
  });
});

describe("parseOperatorNotes", () => {
  it("returns Operator bullets and stops at the next heading", () => {
    expect(parseOperatorNotes("## Features\n- skip\n\n## Operator\n- D1: none\n* Restart after deploy\n\n## Bug Fixes\n- later")).toEqual([
      "D1: none",
      "Restart after deploy",
    ]);
  });

  it("is empty without an Operator heading", () => {
    expect(parseOperatorNotes("## Features\n- a")).toEqual([]);
    expect(parseOperatorNotes(null)).toEqual([]);
    expect(parseOperatorNotes("")).toEqual([]);
  });
});

describe("parseGithubRelease", () => {
  it("requires tag_name and html_url", () => {
    expect(parseGithubRelease({ tag_name: "v1.0.0" })).toBeNull();
    expect(parseGithubRelease({ tag_name: "v1.0.0", html_url: "https://example.test/r", published_at: 1 })).toEqual({
      tag_name: "v1.0.0",
      html_url: "https://example.test/r",
      published_at: "",
      body: null,
    });
  });
});

describe("classifyUpstream", () => {
  it("is update only when this build is a lower semver", () => {
    expect(classifyUpstream("1.0.0", "v1.1.0")).toBe("update");
    expect(classifyUpstream("1.1.0", "v1.0.0")).toBe("current");
    expect(classifyUpstream("1.0.0", "v1.0.0")).toBe("current");
    expect(classifyUpstream(null, "v1.1.0")).toBe("unknown");
    expect(classifyUpstream("dev", "v1.1.0")).toBe("unknown");
  });
});

describe("snapshots", () => {
  it("copies Operator notes onto an update snapshot", () => {
    const snap = snapshotFromRelease("1.0.0", release());
    expect(snap).toMatchObject({
      status: "update",
      this_version: "1.0.0",
      latest_tag: "v1.1.0",
      latest_url: "https://example.test/releases/v1.1.0",
      published_at: "2026-09-14T00:00:00.000Z",
      operator: ["Restart after deploy", "D1: none"],
      docs_url: UPSTREAM_DOCS_UPDATE,
    });
  });

  it("marks a matching tag current", () => {
    expect(snapshotFromRelease("1.0.0", release({ tag_name: "v1.0.0" })).status).toBe("current");
  });

  it("failedSnapshot never looks like an update", () => {
    expect(failedSnapshot("1.0.0")).toEqual({
      status: "failed",
      this_version: "1.0.0",
      latest_tag: null,
      latest_url: null,
      published_at: null,
      operator: [],
      docs_url: UPSTREAM_DOCS_UPDATE,
    });
  });
});

describe("loadUpstream", () => {
  it("uses UPSTREAM_RELEASE_JSON when set", async () => {
    const env = { UPSTREAM_RELEASE_JSON: JSON.stringify(release()) } as Env;
    const snap = await loadUpstream(env);
    expect(snap.status).toBe("update");
    expect(snap.this_version).toBe(bakedProductVersion());
    expect(snap.latest_tag).toBe("v1.1.0");
  });

  it("fails closed on invalid fixture JSON", async () => {
    const env = { UPSTREAM_RELEASE_JSON: "{not-json" } as Env;
    expect(await loadUpstream(env)).toEqual(failedSnapshot(bakedProductVersion()));
  });
});

describe("pageChrome", () => {
  it("loads upstream only for operators", async () => {
    const env = { FOOTER_TEXT: "cube", UPSTREAM_RELEASE_JSON: JSON.stringify(release()) } as Env;
    expect(await pageChrome(env, false)).toEqual({ footer: "cube", upstream: undefined });
    const admin = await pageChrome(env, true);
    expect(admin.footer).toBe("cube");
    expect(admin.upstream?.status).toBe("update");
  });
});

describe("bakedProductVersion", () => {
  it("reads the repo version.txt triple", () => {
    expect(bakedProductVersion()).toBe("1.0.0");
  });
});
