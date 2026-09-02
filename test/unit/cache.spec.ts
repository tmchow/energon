import { describe, expect, it } from "vitest";
import { purgeContent } from "../../src/cache";

describe("purgeContent", () => {
  it("no-ops when the cache API is missing", async () => {
    await expect(purgeContent({ waitUntil() {} } as unknown as ExecutionContext, ["/{a}/s/x/"])).resolves.toBeUndefined();
  });

  it("throws when purge rejects so a privacy transition cannot succeed", async () => {
    const ctx = {
      cache: {
        purge: async () => {
          throw new Error("purge rejected");
        },
      },
      waitUntil() {},
    } as unknown as ExecutionContext;
    await expect(purgeContent(ctx, ["/{a}/s/x/"])).rejects.toThrow(/purge rejected/);
  });
});
