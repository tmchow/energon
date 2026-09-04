import { describe, expect, it } from "vitest";
import { authMarkdown } from "../../src/auth-doc";
import { tokenExpiredError, unauthorized } from "../../src/auth";
import type { Env } from "../../src/types";

describe("authentication discovery", () => {
  const env = {
    PUBLIC_ORIGIN: "https://hub.acme.test",
    CONTENT_ORIGIN: "https://files.acme.test",
    TOKEN_ENV: "ACME_TOKEN",
    TOKEN_PREFIX: "acme_",
    ALLOW_UNLIMITED_TOKENS: "false",
  } as Env;

  it("describes the configured instance and only its available token lifetimes", () => {
    const doc = authMarkdown(env);
    expect(doc).toContain("https://hub.acme.test/tokens");
    expect(doc).toContain("https://hub.acme.test/v1/whoami");
    expect(doc).toContain("https://files.acme.test");
    expect(doc).toContain("Authorization: Bearer $ACME_TOKEN");
    expect(doc).toContain("acme_");
    expect(doc).not.toContain("ee_live_");
    expect(doc).not.toContain("ENERGON_TOKEN");
    expect(doc).toContain("Default lifetime: `90d`");
    expect(doc).not.toContain("`never`");
    expect(authMarkdown({ ...env, ALLOW_UNLIMITED_TOKENS: "true" })).toContain("`never`");
  });

  it("points missing, rejected, and expired credentials at public authentication instructions", async () => {
    for (const error of [
      unauthorized(env.PUBLIC_ORIGIN, undefined, env),
      unauthorized(env.PUBLIC_ORIGIN, "Rejected credential", env),
      tokenExpiredError(env.PUBLIC_ORIGIN, "2026-01-01T00:00:00Z", env),
    ]) {
      const response = error.toResponse(env.PUBLIC_ORIGIN);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        auth_url: "https://hub.acme.test/auth.md",
        tokens_url: "https://hub.acme.test/tokens",
      });
    }
  });
});
