import { env } from "cloudflare:test";
import { deflateSync, strToU8, zipSync, Zip, ZipDeflate } from "fflate";
import { describe, expect, it } from "vitest";
import {
  indexSiteZip,
  streamSiteZipEntry,
  type SiteZipLimits,
} from "../src/site-zip";

const limits: SiteZipLimits = {
  maxArchiveBytes: 4 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 3 * 1024 * 1024,
  maxFiles: 20,
  maxRecords: 40,
  maxDirectoryBytes: 128 * 1024,
  maxNameBytes: 1024,
};
async function stage(
  bytes: Uint8Array,
  overrides: Partial<SiteZipLimits> = {},
) {
  const key = `zip-reader/${crypto.randomUUID()}`;
  await env.BUCKET.put(key, bytes);
  return indexSiteZip(env.BUCKET, key, { ...limits, ...overrides });
}
async function extract(
  index: Awaited<ReturnType<typeof stage>>,
  position = 0,
  totalBytes = 0,
) {
  return new Response(
    streamSiteZipEntry(env.BUCKET, index.archive, index.entries[position], {
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxTotalBytes,
      totalBytes,
    }),
  ).arrayBuffer();
}
function signatures(bytes: Uint8Array, value: number) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: number[] = [];
  for (let i = 0; i <= bytes.length - 4; i++)
    if (v.getUint32(i, true) === value) found.push(i);
  return found;
}
function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function zip64Descriptor() {
  const plain = strToU8("ZIP64 streaming file");
  const compressed = deflateSync(plain);
  const bytes = new Uint8Array(31 + compressed.length + 24 + 75 + 56 + 20 + 22);
  const view = new DataView(bytes.buffer);
  const u16 = (p: number, n: number) => view.setUint16(p, n, true);
  const u32 = (p: number, n: number) => view.setUint32(p, n, true);
  const u64 = (p: number, n: number) => view.setBigUint64(p, BigInt(n), true);
  u32(0, 0x04034b50);
  u16(4, 45);
  u16(6, 8);
  u16(8, 8);
  u16(26, 1);
  bytes[30] = 97;
  bytes.set(compressed, 31);
  const descriptor = 31 + compressed.length;
  u32(descriptor, 0x08074b50);
  u32(descriptor + 4, crc32(plain));
  u64(descriptor + 8, compressed.length);
  u64(descriptor + 16, plain.length);
  const cd = descriptor + 24;
  u32(cd, 0x02014b50);
  u16(cd + 6, 45);
  u16(cd + 8, 8);
  u16(cd + 10, 8);
  u32(cd + 16, crc32(plain));
  u32(cd + 20, 0xffffffff);
  u32(cd + 24, 0xffffffff);
  u16(cd + 28, 1);
  u16(cd + 30, 28);
  u32(cd + 42, 0xffffffff);
  bytes[cd + 46] = 97;
  u16(cd + 47, 1);
  u16(cd + 49, 24);
  u64(cd + 51, plain.length);
  u64(cd + 59, compressed.length);
  u64(cd + 67, 0);
  const end64 = cd + 75;
  u32(end64, 0x06064b50);
  u64(end64 + 4, 44);
  u16(end64 + 12, 45);
  u16(end64 + 14, 45);
  u64(end64 + 24, 1);
  u64(end64 + 32, 1);
  u64(end64 + 40, 75);
  u64(end64 + 48, cd);
  const locator = end64 + 56;
  u32(locator, 0x07064b50);
  u64(locator + 8, end64);
  u32(locator + 16, 1);
  const end = locator + 20;
  u32(end, 0x06054b50);
  u16(end + 8, 65535);
  u16(end + 10, 65535);
  u32(end + 12, 0xffffffff);
  u32(end + 16, 0xffffffff);
  return { bytes, plain };
}

describe("R2 site ZIP reader", () => {
  it("extracts stored and deflated files, strips wrapper and skips junk", async () => {
    const index = await stage(
      zipSync({
        "site/a": [strToU8("stored"), { level: 0 }],
        "site/b": strToU8("deflated"),
        "site/.DS_Store": strToU8("junk"),
      }),
    );
    expect(index.entries.map((e) => e.path)).toEqual(["a", "b"]);
    expect(new TextDecoder().decode(await extract(index))).toBe("stored");
    expect(new TextDecoder().decode(await extract(index, 1))).toBe("deflated");
  });
  it("supports ZIP64 and signed 64-bit data descriptors", async () => {
    const { bytes, plain } = zip64Descriptor();
    expect(new Uint8Array(await extract(await stage(bytes)))).toEqual(plain);
  });
  it("accepts signed ZIP32 descriptors and Unicode names", async () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, bytes) => {
      if (error) throw error;
      chunks.push(bytes);
    });
    const file = new ZipDeflate("site/é.html");
    zip.add(file);
    file.push(strToU8("hello descriptor"), true);
    zip.end();
    const archive = new Uint8Array(
      chunks.reduce((n, chunk) => n + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.length;
    }
    const index = await stage(archive);
    expect(index.entries[0].path).toBe("é.html");
    expect(new TextDecoder().decode(await extract(index))).toBe(
      "hello descriptor",
    );
  });
  it("rejects truncated compressed data with structurally consistent offsets", async () => {
    const original = zipSync({ a: strToU8("hello world".repeat(500)) });
    const cd = signatures(original, 0x02014b50)[0];
    const archive = new Uint8Array(original.length - 2);
    archive.set(original.subarray(0, cd - 2));
    archive.set(original.subarray(cd), cd - 2);
    const v = new DataView(archive.buffer);
    v.setUint32(18, v.getUint32(18, true) - 2, true);
    v.setUint32(cd - 2 + 20, v.getUint32(cd - 2 + 20, true) - 2, true);
    v.setUint32(archive.length - 6, cd - 2, true);
    await expect(extract(await stage(archive))).rejects.toThrow();
  });
  it("rejects encryption, split disks, unsupported methods and ZIP64 contradictions", async () => {
    for (const [offset, value] of [
      [8, 1],
      [10, 99],
      [34, 1],
    ] as const) {
      const bytes = zipSync({ a: strToU8("x") });
      const cd = signatures(bytes, 0x02014b50)[0];
      new DataView(bytes.buffer).setUint16(cd + offset, value, true);
      await expect(stage(bytes)).rejects.toThrow();
    }
    const { bytes } = zip64Descriptor();
    new DataView(bytes.buffer).setUint16(bytes.length - 14, 2, true);
    new DataView(bytes.buffer).setUint16(bytes.length - 12, 2, true);
    await expect(stage(bytes)).rejects.toThrow(/disagree/);
  });
  it("rejects CRC corruption after extraction", async () => {
    const bytes = zipSync({ a: strToU8("hello") });
    const cd = signatures(bytes, 0x02014b50)[0];
    new DataView(bytes.buffer).setUint32(14, 123, true);
    new DataView(bytes.buffer).setUint32(cd + 16, 123, true);
    await expect(extract(await stage(bytes))).rejects.toThrow(/CRC/);
  });
  it("rejects truncated archives, unsafe paths and canonical collisions", async () => {
    const bytes = zipSync({ a: strToU8("x") });
    await expect(stage(bytes.subarray(0, bytes.length - 2))).rejects.toThrow();
    await expect(
      stage(zipSync({ "../x": strToU8("x") })),
    ).rejects.toMatchObject({ code: "bad_zip_path" });
    await expect(
      stage(zipSync({ a: strToU8("x"), "./a": strToU8("y") })),
    ).rejects.toThrow(/collision/);
  });
  it("rejects overlapping local records and local-directory disagreement", async () => {
    const bytes = zipSync({ a: strToU8("x"), b: strToU8("y") });
    const cds = signatures(bytes, 0x02014b50);
    new DataView(bytes.buffer).setUint32(cds[1] + 42, 0, true);
    await expect(stage(bytes)).rejects.toThrow();
    const other = zipSync({ a: strToU8("x") });
    other[30] = 98;
    await expect(stage(other)).rejects.toThrow(/local/);
  });
  it("bounds metadata work including ignored entries and declared expansion", async () => {
    await expect(
      stage(zipSync({ a: strToU8("abc") }), { maxTotalBytes: 2 }),
    ).rejects.toMatchObject({ code: "too_large" });
    await expect(
      stage(zipSync({ a: strToU8("x"), ".DS_Store": strToU8("x") }), {
        maxRecords: 1,
      }),
    ).rejects.toThrow();
    await expect(
      stage(zipSync({ abc: strToU8("x") }), { maxNameBytes: 2 }),
    ).rejects.toThrow();
  });
  it("bounds emitted expansion even when consistent headers lie, and shares a total budget", async () => {
    const bytes = zipSync({ a: new Uint8Array(400_000) });
    const cd = signatures(bytes, 0x02014b50)[0];
    const view = new DataView(bytes.buffer);
    view.setUint32(22, 1, true);
    view.setUint32(cd + 24, 1, true);
    await expect(extract(await stage(bytes))).rejects.toThrow(/length|limit/);
    const index = await stage(zipSync({ a: strToU8("abc") }));
    await expect(extract(index, 0, limits.maxTotalBytes - 2)).rejects.toThrow(
      /limit/,
    );
  });
  it("uses bounded reads and only produces output in response to pulls", async () => {
    const input = new Uint8Array(256_000);
    crypto.getRandomValues(input.subarray(0, 65536));
    const index = await stage(zipSync({ a: [input, { level: 0 }] }));
    const budget = {
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxTotalBytes,
      totalBytes: 0,
    };
    const stream = streamSiteZipEntry(
      env.BUCKET,
      index.archive,
      index.entries[0],
      budget,
    );
    await Promise.resolve();
    expect(budget.totalBytes).toBe(0);
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value!.length).toBeLessThanOrEqual(1024);
    expect(budget.totalBytes).toBe(first.value!.length);
    await Promise.resolve();
    expect(budget.totalBytes).toBe(first.value!.length);
    await reader.cancel();
  });
  it("retains separate bounded directory and local-header windows", async () => {
    const bytes = zipSync(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${i}.bin`, [new Uint8Array(128 * 1024), { level: 0 as const }]])));
    const originalGet = env.BUCKET.get.bind(env.BUCKET);
    const ranges: number[] = [];
    env.BUCKET.get = ((key: string, options?: R2GetOptions) => {
      if (options?.range && "length" in options.range) ranges.push(options.range.length!);
      return originalGet(key, options);
    }) as R2Bucket["get"];
    try {
      const index = await stage(bytes);
      expect(index.entries).toHaveLength(10);
      expect(ranges.length).toBeLessThanOrEqual(5);
      expect(Math.max(...ranges)).toBeLessThanOrEqual(1024 * 1024);
    } finally {
      env.BUCKET.get = originalGet;
    }
  });
  it("bounds high-ratio output per pull and range requests against native R2", async () => {
    const input = new Uint8Array(2 * 1024 * 1024);
    const index = await stage(zipSync({ a: input }));
    const originalGet = env.BUCKET.get.bind(env.BUCKET);
    const sizes: number[] = [];
    env.BUCKET.get = ((key: string, options?: R2GetOptions) => {
      if (options?.range && "length" in options.range)
        sizes.push(options.range.length!);
      return originalGet(key, options);
    }) as R2Bucket["get"];
    try {
      const budget = {
        maxFileBytes: limits.maxFileBytes,
        maxTotalBytes: limits.maxTotalBytes,
        totalBytes: 0,
      };
      const reader = streamSiteZipEntry(
        env.BUCKET,
        index.archive,
        index.entries[0],
        budget,
      ).getReader();
      let count = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        expect(next.value.length).toBeLessThan(1_100_000);
        count += next.value.length;
        await Promise.resolve();
        expect(budget.totalBytes).toBe(count);
      }
      expect(count).toBe(input.length);
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(65536);
    } finally {
      env.BUCKET.get = originalGet;
    }
  });
  it("rejects long trailing DEFLATE padding before the decoder can retain the archive", async () => {
    const original = zipSync({ a: strToU8("hello") });
    const cd = signatures(original, 0x02014b50)[0];
    const padding = 256 * 1024;
    const archive = new Uint8Array(original.length + padding);
    archive.set(original.subarray(0, cd));
    archive.set(original.subarray(cd), cd + padding);
    const v = new DataView(archive.buffer);
    v.setUint32(18, v.getUint32(18, true) + padding, true);
    v.setUint32(
      cd + padding + 20,
      v.getUint32(cd + padding + 20, true) + padding,
      true,
    );
    v.setUint32(archive.length - 6, cd + padding, true);
    await expect(extract(await stage(archive))).rejects.toThrow(
      /no output progress/,
    );
  });
  it("rejects archive replacement between indexing and extraction", async () => {
    const index = await stage(zipSync({ a: strToU8("original") }));
    await env.BUCKET.put(
      index.archive.key,
      zipSync({ a: strToU8("replacement") }),
    );
    await expect(extract(index)).rejects.toThrow(/changed/);
  });
});
