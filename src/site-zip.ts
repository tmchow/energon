import { Inflate, strFromU8 } from "fflate";
import { ApiError, normalizeRelPath } from "./http";
import { skipZipJunk } from "./zip";

export interface SiteZipLimits {
  maxArchiveBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxRecords: number;
  maxDirectoryBytes: number;
  maxNameBytes: number;
}
export interface SiteZipArchive {
  key: string;
  size: number;
  etag: string;
}
export interface SiteZipEntry {
  path: string;
  dataOffset: number;
  compressedBytes: number;
  size: number;
  crc32: number;
  method: 0 | 8;
}
export interface SiteZipBudget {
  maxFileBytes: number;
  maxTotalBytes: number;
  totalBytes: number;
}
export interface SiteZipIndex {
  archive: SiteZipArchive;
  entries: SiteZipEntry[];
  totalBytes: number;
}

const RANGE_BYTES = 1024 * 1024;
const FEED_BYTES = 1024;
const MAX_SILENT_INPUT_BYTES = 128 * 1024;
const invalid = (message: string) => new ApiError(400, "invalid_zip", message);
const overLimit = () =>
  new ApiError(413, "too_large", "ZIP byte limit exceeded.");
const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (b: Uint8Array, p: number) => view(b).getUint16(p, true);
const u32 = (b: Uint8Array, p: number) => view(b).getUint32(p, true);
function u64(b: Uint8Array, p: number): number {
  if (p + 8 > b.length) throw invalid("Truncated ZIP64 field.");
  const n = Number(view(b).getBigUint64(p, true));
  if (!Number.isSafeInteger(n))
    throw invalid("ZIP64 offset exceeds safe integer range.");
  return n;
}
function range(offset: number, length: number, end: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > end - length
  ) {
    throw invalid("ZIP range is outside the archive.");
  }
}
function checkLimits(limits: Record<string, number>) {
  for (const n of Object.values(limits))
    if (!Number.isSafeInteger(n) || n < 0) throw invalid("Invalid ZIP limits.");
}

class ArchiveReader {
  private start = -1;
  private cached = new Uint8Array(0);
  constructor(
    private bucket: R2Bucket,
    private archive: SiteZipArchive,
  ) {}
  async read(offset: number, length: number): Promise<Uint8Array> {
    range(offset, length, this.archive.size);
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const at = offset + written;
      if (at < this.start || at >= this.start + this.cached.length) {
        const size = Math.min(RANGE_BYTES, this.archive.size - at);
        const object = await this.bucket.get(this.archive.key, {
          range: { offset: at, length: size },
          onlyIf: { etagMatches: this.archive.etag },
        });
        if (!object || !("body" in object) || object.etag !== this.archive.etag)
          throw invalid("ZIP archive changed or disappeared.");
        this.cached = new Uint8Array(await object.arrayBuffer());
        if (this.cached.length !== size) throw invalid("Truncated ZIP range.");
        this.start = at;
      }
      const count = Math.min(
        length - written,
        this.cached.length - (at - this.start),
      );
      result.set(
        this.cached.subarray(at - this.start, at - this.start + count),
        written,
      );
      written += count;
    }
    return result;
  }
}

function zip64Extra(extra: Uint8Array): Uint8Array | undefined {
  let found: Uint8Array | undefined;
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length) throw invalid("Truncated ZIP extra field.");
    const id = u16(extra, at),
      size = u16(extra, at + 2);
    if (at + 4 + size > extra.length)
      throw invalid("Truncated ZIP extra field.");
    if (id === 1) {
      if (found) throw invalid("Duplicate ZIP64 extra field.");
      found = extra.subarray(at + 4, at + 4 + size);
    }
    at += size + 4;
  }
  return found;
}
function sizes(
  extra: Uint8Array,
  size: number,
  compressed: number,
  offset?: number,
  disk?: number,
) {
  const zip64 = zip64Extra(extra);
  let at = 0;
  const next = () => {
    if (!zip64) throw invalid("Missing ZIP64 extra field.");
    const n = u64(zip64, at);
    at += 8;
    return n;
  };
  if (size === 0xffffffff) size = next();
  if (compressed === 0xffffffff) compressed = next();
  if (offset === 0xffffffff) offset = next();
  if (disk === 0xffff) {
    if (!zip64 || at + 4 > zip64.length)
      throw invalid("Missing ZIP64 disk field.");
    disk = u32(zip64, at);
  }
  if (disk !== undefined && disk !== 0)
    throw invalid("Split ZIP archives are unsupported.");
  return { size, compressed, offset };
}
export async function indexSiteZip(
  bucket: R2Bucket,
  key: string,
  limits: SiteZipLimits,
): Promise<SiteZipIndex> {
  checkLimits({ ...limits });
  const head = await bucket.head(key);
  if (!head) throw invalid("ZIP archive disappeared.");
  if (head.size > limits.maxArchiveBytes) throw overLimit();
  const archive = { key, size: head.size, etag: head.etag };
  const reader = new ArchiveReader(bucket, archive);
  const localReader = new ArchiveReader(bucket, archive);
  const tailOffset = Math.max(0, head.size - (65535 + 22));
  const tail = await reader.read(tailOffset, head.size - tailOffset);
  let end = tail.length - 22;
  while (
    end >= 0 &&
    (u32(tail, end) !== 0x06054b50 ||
      end + 22 + u16(tail, end + 20) !== tail.length)
  )
    end--;
  if (end < 0) throw invalid("Missing ZIP end record.");
  if (u16(tail, end + 4) || u16(tail, end + 6))
    throw invalid("Split ZIP archives are unsupported.");
  let count = u16(tail, end + 10),
    directorySize = u32(tail, end + 12),
    directoryOffset = u32(tail, end + 16);
  let directoryEnd = tailOffset + end;
  if (u16(tail, end + 8) !== count)
    throw invalid("Split ZIP archives are unsupported.");
  if (
    count === 65535 ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locatorOffset = directoryEnd - 20;
    const locator = await reader.read(locatorOffset, 20);
    if (
      u32(locator, 0) !== 0x07064b50 ||
      u32(locator, 4) !== 0 ||
      u32(locator, 16) !== 1
    )
      throw invalid("Invalid ZIP64 locator.");
    const at = u64(locator, 8),
      record = await reader.read(at, 56);
    const recordSize = u64(record, 4);
    if (
      u32(record, 0) !== 0x06064b50 ||
      recordSize < 44 ||
      recordSize > limits.maxDirectoryBytes ||
      at + 12 + recordSize !== locatorOffset
    )
      throw invalid("Invalid ZIP64 end record.");
    if (
      u32(record, 16) ||
      u32(record, 20) ||
      u64(record, 24) !== u64(record, 32)
    )
      throw invalid("Split ZIP archives are unsupported.");
    if (
      (count !== 65535 && count !== u64(record, 32)) ||
      (directorySize !== 0xffffffff && directorySize !== u64(record, 40)) ||
      (directoryOffset !== 0xffffffff && directoryOffset !== u64(record, 48))
    )
      throw invalid("ZIP64 end records disagree.");
    count = u64(record, 32);
    directorySize = u64(record, 40);
    directoryOffset = u64(record, 48);
    directoryEnd = at;
  }
  range(directoryOffset, directorySize, directoryEnd);
  if (directoryOffset + directorySize !== directoryEnd)
    throw invalid("Unexpected ZIP directory trailer.");
  if (count > limits.maxRecords || directorySize > limits.maxDirectoryBytes)
    throw invalid("ZIP directory metadata limit exceeded.");
  const entries: SiteZipEntry[] = [];
  const occupied: Array<{ start: number; end: number }> = [];
  let at = directoryOffset,
    totalBytes = 0;
  for (let i = 0; i < count; i++) {
    range(at, 46, directoryEnd);
    const record = await reader.read(at, 46);
    if (u32(record, 0) !== 0x02014b50)
      throw invalid("Invalid ZIP directory record.");
    const flags = u16(record, 8),
      method = u16(record, 10);
    if (flags & ~0x080e || (method !== 0 && method !== 8))
      throw invalid("Encrypted or unsupported ZIP entry.");
    const nameLength = u16(record, 28),
      extraLength = u16(record, 30),
      commentLength = u16(record, 32);
    if (!nameLength || nameLength > limits.maxNameBytes)
      throw invalid("ZIP filename limit exceeded.");
    const recordLength = 46 + nameLength + extraLength + commentLength;
    range(at, recordLength, directoryEnd);
    const variable = await reader.read(at + 46, nameLength + extraLength);
    const nameBytes = variable.subarray(0, nameLength);
    const name = strFromU8(nameBytes, !(flags & 2048));
    const parsed = sizes(
      variable.subarray(nameLength),
      u32(record, 24),
      u32(record, 20),
      u32(record, 42),
      u16(record, 34),
    );
    const localOffset = parsed.offset!;
    range(localOffset, 30, directoryOffset);
    const local = await localReader.read(localOffset, 30);
    if (
      u32(local, 0) !== 0x04034b50 ||
      u16(local, 6) !== flags ||
      u16(local, 8) !== method ||
      u16(local, 26) !== nameLength
    )
      throw invalid("ZIP local header disagrees with directory.");
    const localExtraLength = u16(local, 28),
      dataOffset = localOffset + 30 + nameLength + localExtraLength;
    range(
      localOffset,
      dataOffset - localOffset + parsed.compressed,
      directoryOffset,
    );
    const localVariable = await localReader.read(
      localOffset + 30,
      nameLength + localExtraLength,
    );
    if (!nameBytes.every((b, j) => b === localVariable[j]))
      throw invalid("ZIP local filename disagrees with directory.");
    const localSizes = sizes(
      localVariable.subarray(nameLength),
      u32(local, 22),
      u32(local, 18),
    );
    const crc = u32(record, 16);
    if (!(flags & 8)) {
      if (
        localSizes.size !== parsed.size ||
        localSizes.compressed !== parsed.compressed ||
        u32(local, 14) !== crc
      )
        throw invalid("ZIP local sizes disagree with directory.");
    } else if (
      (localSizes.size && localSizes.size !== parsed.size) ||
      (localSizes.compressed && localSizes.compressed !== parsed.compressed) ||
      (u32(local, 14) && u32(local, 14) !== crc)
    ) {
      throw invalid("ZIP local descriptor sizes disagree with directory.");
    }
    let recordEnd = dataOffset + parsed.compressed;
    if (flags & 8) {
      const wide =
        u32(record, 24) === 0xffffffff || u32(record, 20) === 0xffffffff;
      const available = Math.min(wide ? 24 : 16, directoryOffset - recordEnd);
      const descriptor = await localReader.read(recordEnd, available);
      const matches = (p: number) => {
        const length = p + (wide ? 20 : 12);
        return (
          descriptor.length >= length &&
          u32(descriptor, p) === crc &&
          (wide ? u64(descriptor, p + 4) : u32(descriptor, p + 4)) ===
            parsed.compressed &&
          (wide ? u64(descriptor, p + 12) : u32(descriptor, p + 8)) ===
            parsed.size
        );
      };
      const prefix =
        descriptor.length >= 4 &&
        u32(descriptor, 0) === 0x08074b50 &&
        matches(4)
          ? 4
          : 0;
      if (!matches(prefix))
        throw invalid("ZIP data descriptor disagrees with directory.");
      recordEnd += prefix + (wide ? 20 : 12);
    }
    if (method === 0 && parsed.size !== parsed.compressed)
      throw invalid("Stored ZIP lengths disagree.");
    occupied.push({ start: localOffset, end: recordEnd });
    if (!name.endsWith("/") && !skipZipJunk(name)) {
      if (
        name.includes("\0") ||
        name
          .replace(/\\/g, "/")
          .split("/")
          .some((s) => s === ".." || s === "" || s.includes(":"))
      )
        throw new ApiError(400, "bad_zip_path", "Unsafe ZIP path.");
      if (entries.length >= limits.maxFiles)
        throw new ApiError(
          400,
          "too_many_files",
          "ZIP file count limit exceeded.",
        );
      if (
        parsed.size > limits.maxFileBytes ||
        totalBytes > limits.maxTotalBytes - parsed.size
      )
        throw overLimit();
      totalBytes += parsed.size;
      entries.push({
        path: name,
        dataOffset,
        compressedBytes: parsed.compressed,
        size: parsed.size,
        crc32: crc,
        method,
      });
    }
    at += recordLength;
  }
  if (at !== directoryEnd)
    throw invalid("ZIP directory record count disagrees with size.");
  occupied.sort((a, b) => a.start - b.start);
  for (let i = 1; i < occupied.length; i++)
    if (occupied[i].start < occupied[i - 1].end)
      throw invalid("Overlapping ZIP records.");
  if (!entries.length)
    throw new ApiError(400, "empty_zip", "ZIP has no files.");
  const first = entries[0].path.split("/")[0];
  const strip =
    first !== "." &&
    first !== ".." &&
    entries.every((e) => e.path.startsWith(`${first}/`));
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = normalizeRelPath(
      strip ? entry.path.slice(first.length + 1) : entry.path,
    );
    if (!path) throw new ApiError(400, "bad_zip_path", "Unsafe ZIP path.");
    if (paths.has(path)) throw invalid("ZIP canonical path collision.");
    paths.add(path);
    entry.path = path;
  }
  return { archive, entries, totalBytes };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1));
  return n >>> 0;
});

// Only a fully consumed, successfully closed stream is a verified entry; callers must not publish partial output.
export function streamSiteZipEntry(
  bucket: R2Bucket,
  archive: SiteZipArchive,
  entry: SiteZipEntry,
  budget: SiteZipBudget,
): ReadableStream<Uint8Array> {
  checkLimits({ ...budget });
  range(entry.dataOffset, entry.compressedBytes, archive.size);
  if (
    entry.size > budget.maxFileBytes ||
    entry.size > budget.maxTotalBytes - budget.totalBytes
  )
    throw overLimit();
  const reader = new ArchiveReader(bucket, archive);
  let compressed = 0,
    emitted = 0,
    crc = -1,
    finished = false,
    silentInput = 0;
  let output: Uint8Array | undefined;
  const accept = (bytes: Uint8Array) => {
    if (bytes.length > entry.size - emitted)
      throw invalid("ZIP actual length exceeds declared length.");
    if (
      bytes.length > budget.maxFileBytes - emitted ||
      bytes.length > budget.maxTotalBytes - budget.totalBytes
    )
      throw overLimit();
    emitted += bytes.length;
    budget.totalBytes += bytes.length;
    for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
    if (bytes.length) {
      output = bytes;
      silentInput = 0;
    }
  };
  const inflater = entry.method === 8 ? new Inflate(accept) : undefined;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          while (!output && !finished) {
            const count = Math.min(
              FEED_BYTES,
              entry.compressedBytes - compressed,
            );
            const bytes = await reader.read(
              entry.dataOffset + compressed,
              count,
            );
            compressed += count;
            finished = compressed === entry.compressedBytes;
            if (inflater) {
              // Inflate retains unconsumed trailing data after BFINAL. Bound it without depending on private decoder state.
              silentInput += count;
              if (silentInput > MAX_SILENT_INPUT_BYTES)
                throw invalid(
                  "ZIP compressed input made no output progress within 128 KiB.",
                );
              inflater.push(bytes, finished);
            } else accept(bytes);
            if (finished) {
              if (emitted !== entry.size)
                throw invalid(
                  "ZIP actual length disagrees with declared length.",
                );
              if ((crc ^ -1) >>> 0 !== entry.crc32)
                throw invalid("ZIP CRC mismatch.");
            }
          }
          if (output) {
            controller.enqueue(output);
            output = undefined;
          }
          if (finished) controller.close();
        } catch (error) {
          controller.error(
            error instanceof ApiError
              ? error
              : invalid("Invalid compressed ZIP entry."),
          );
        }
      },
      cancel() {
        finished = true;
        output = undefined;
      },
    },
    { highWaterMark: 0 },
  );
}
