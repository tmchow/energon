import { IN_MEMORY_BYTES, TMP_PREFIX, formatBytes, tmpKey } from "./config";
import { ApiError, capStream, putFromStaged, readBodyCapped, tooLarge } from "./http";

/** Enough leading bytes for contentTypeFor's magic-number sniffing. */
const HEAD_BYTES = 512;
const STALE_TMP_MS = 60 * 60 * 1000;

/**
 * One uploaded file body. Bodies over IN_MEMORY_BYTES are staged in R2 before any write claim is taken,
 * so a slow client cannot hold a claim past its staleness window. Read with withUpload so staging is cleaned up.
 */
export type Upload = { size: number; head: Uint8Array } & (
  | { body: Uint8Array | Blob; stagedKey?: undefined }
  | { stagedKey: string; body?: undefined }
);

export function uploadFromBytes(bytes: Uint8Array): Upload {
  return { size: bytes.byteLength, head: bytes.subarray(0, HEAD_BYTES), body: bytes };
}

export async function uploadFromFile(file: File): Promise<Upload> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  return { size: file.size, head, body: file };
}

function declaredLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

export type UploadChecks = { sha256?: string | null };

export async function readUpload(
  request: Request,
  bucket: R2Bucket,
  maxBytes: number,
  origin: string,
  checks: UploadChecks = {},
): Promise<Upload> {
  const expected = checks.sha256 ? checks.sha256.toLowerCase() : null;
  const inMemory = async (bytes: Uint8Array): Promise<Upload> => {
    if (expected && (await sha256OfBytes(bytes)) !== expected) throw checksumMismatch();
    return uploadFromBytes(bytes);
  };
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) throw tooLarge(declared, origin, maxBytes);
  if (declared === null) {
    const limit = Math.min(maxBytes, IN_MEMORY_BYTES);
    try {
      return await inMemory(await readBodyCapped(request, limit, origin));
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "too_large" || limit === maxBytes) throw err;
      throw new ApiError(
        413,
        "too_large",
        `Uploads over ${formatBytes(limit)} need a Content-Length header. Retry with Content-Length set (most HTTP clients do this for a file body).`,
        { limit_bytes: limit },
      );
    }
  }
  if (declared <= IN_MEMORY_BYTES || !request.body) return inMemory(await readBodyCapped(request, maxBytes, origin));

  const stagedKey = tmpKey("uploads");
  let head: Uint8Array = new Uint8Array(0);
  const keepHead = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (head.byteLength < HEAD_BYTES) head = concatBytes(head, chunk.subarray(0, HEAD_BYTES - head.byteLength));
      controller.enqueue(chunk);
    },
  });
  const { readable, writable } = new FixedLengthStream(declared);
  const pipeFailed = request.body.pipeThrough(keepHead).pipeTo(writable).then(() => false, () => true);
  try {
    // R2 verifies the digest while storing, so a large body is never hashed on the Worker's CPU budget.
    await bucket.put(stagedKey, readable, expected ? { sha256: expected } : undefined);
  } catch (err) {
    await bucket.delete(stagedKey).catch(() => undefined);
    if (await pipeFailed) throw incomplete(declared);
    throw expected ? checksumMismatch() : err;
  }
  if (await pipeFailed) {
    await bucket.delete(stagedKey).catch(() => undefined);
    throw incomplete(declared);
  }
  return { size: declared, head, stagedKey };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function checksumMismatch(): ApiError {
  return new ApiError(400, "checksum_mismatch", "The upload body does not match the expected SHA-256. Nothing was published; retry with the right bytes.");
}

function incomplete(declared: number): ApiError {
  return new ApiError(400, "bad_request", `The upload body did not match its Content-Length (${declared} bytes). Retry the upload.`);
}

export async function withUpload<T>(
  request: Request,
  bucket: R2Bucket,
  maxBytes: number,
  origin: string,
  fn: (upload: Upload) => Promise<T>,
  checks?: UploadChecks,
): Promise<T> {
  const upload = await readUpload(request, bucket, maxBytes, origin, checks);
  try {
    return await fn(upload);
  } finally {
    if (upload.stagedKey) await bucket.delete(upload.stagedKey).catch(() => undefined);
  }
}

export async function putUpload(bucket: R2Bucket, key: string, upload: Upload, options?: R2PutOptions): Promise<void> {
  if (upload.stagedKey !== undefined) await putFromStaged(bucket, upload.stagedKey, key, options);
  else await bucket.put(key, upload.body, options);
}

/** formData() buffers the whole body, so multipart stays under IN_MEMORY_BYTES; raw bodies go up to maxBytes. */
export async function readUploadForm(request: Request, maxBytes: number, origin: string): Promise<FormData> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) throw tooLarge(declared, origin, maxBytes);
  const limit = Math.min(maxBytes, IN_MEMORY_BYTES);
  const multipartTooLarge = (actual: number) => limit === maxBytes
    ? tooLarge(actual, origin, maxBytes)
    : new ApiError(
      413,
      "too_large",
      `Multipart uploads are capped at ${formatBytes(IN_MEMORY_BYTES)}. Send the file as a raw body with header X-Filename instead; raw bodies go up to ${formatBytes(maxBytes)}.`,
      { limit_bytes: IN_MEMORY_BYTES, actual_bytes: actual },
    );
  if (declared !== null && declared > limit) throw multipartTooLarge(declared);
  if (!request.body) return request.formData();
  // Unsized bodies would otherwise reach formData(), which buffers everything before any size check.
  const capped = capStream(request.body, limit, multipartTooLarge);
  return new Response(capped, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
}

/** Removes staged uploads and snapshots left behind by an isolate that died mid-request. */
export async function sweepStaleTmp(bucket: R2Bucket, now = Date.now()): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: TMP_PREFIX, cursor, limit: 1000 });
    const stale = listed.objects.filter((object) => now - object.uploaded.getTime() > STALE_TMP_MS).map((object) => object.key);
    if (stale.length) await bucket.delete(stale);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
