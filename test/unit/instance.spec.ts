import { describe, expect, it } from "vitest";
import { ENV_TOKEN } from "../../src/config";
import { identityFromEnv, installLine, REPO_MARKETPLACE, REPO_SKILL } from "../../src/instance";

describe("identityFromEnv", () => {
  it("this repo advertises the placeholder energon skill", () => {
    const id = identityFromEnv({});
    expect(id.skill).toBe(REPO_SKILL);
    expect(id.marketplace).toBe(REPO_MARKETPLACE);
    expect(id.repo).toBe("tmchow/energon");
    expect(id.tokenEnv).toBe(ENV_TOKEN);
    expect(installLine(id)).toBe("energon@energon");
  });

  it("a private Energon advertises its own rendered skill and hostname", () => {
    const id = identityFromEnv({
      PUBLIC_ORIGIN: "https://energon.cybertron.com",
      TOKEN_ENV: "CYBERTRON_ENERGON_TOKEN",
      SKILL_NAME: "cybertron-energon",
      MARKETPLACE_NAME: "cybertron-energon",
      MARKETPLACE_REPO: "cybertron/energon",
    });
    expect(installLine(id)).toBe("cybertron-energon@cybertron-energon");
    expect(id.repo).toBe("cybertron/energon");
    expect(id.origin).toBe("https://energon.cybertron.com");
    expect(id.tokenEnv).toBe("CYBERTRON_ENERGON_TOKEN");
  });
});
