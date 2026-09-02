import { describe, expect, it } from "vitest";
import { parseFormPassword } from "../../src/gate";

describe("parseFormPassword", () => {
  it("reads a urlencoded password", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
    });
    await expect(parseFormPassword(request)).resolves.toBe("hunter2");
  });

  it("rejects multipart before parsing", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    await expect(parseFormPassword(request)).rejects.toMatchObject({
      status: 415,
      code: "bad_content_type",
    });
  });

  it("rejects a body over the gate cap", async () => {
    const request = new Request("https://content.example.com/a/s/x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${"x".repeat(3000)}`,
    });
    await expect(parseFormPassword(request)).rejects.toMatchObject({
      status: 413,
      code: "too_large",
    });
  });
});
