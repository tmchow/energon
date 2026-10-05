import { describe, expect, it } from "vitest";
import { IN_MEMORY_BYTES } from "../../src/config";
import { readUpload, sweepStaleTmp } from "../../src/upload";

function streamedRequest(bytes: number): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return new Request("https://e.test/v1/files", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readUpload", () => {
  it("buffers a body without Content-Length up to the in-memory cap", async () => {
    const upload = await readUpload(streamedRequest(1024), {} as R2Bucket, 100 * 1024 * 1024, "");
    expect(upload.size).toBe(1024);
    expect(upload.stagedKey).toBeUndefined();
  });

  it("asks for Content-Length when an unsized body passes the in-memory cap", async () => {
    await expect(readUpload(streamedRequest(IN_MEMORY_BYTES + 1), {} as R2Bucket, 100 * 1024 * 1024, "")).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining("Content-Length"),
    });
  });
});

describe("sweepStaleTmp", () => {
  it("deletes only tmp objects older than an hour", async () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const deleted: string[][] = [];
    const bucket = {
      async list(options: R2ListOptions) {
        expect(options.prefix).toBe("tmp/");
        return {
          objects: [
            { key: "tmp/uploads/old", uploaded: new Date(now - 2 * 60 * 60 * 1000) },
            { key: "tmp/snapshots/fresh", uploaded: new Date(now - 60 * 1000) },
          ],
          truncated: false,
        };
      },
      async delete(keys: string[]) {
        deleted.push(keys);
      },
    } as unknown as R2Bucket;
    await sweepStaleTmp(bucket, now);
    expect(deleted).toEqual([["tmp/uploads/old"]]);
  });
});
