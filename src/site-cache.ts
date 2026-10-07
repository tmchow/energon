import {
  acquireVersionLease,
  releaseVersionLease,
  type VersionLease,
} from "./site-storage";
import type { Env } from "./types";

export interface SiteCacheSelection {
  siteId: string;
  versionId: string;
  path: string;
  objectKey: string;
  representation: string;
  rendererRevision: string;
  /** The caller has selected this version and checked current access, expiry and deletion. */
  publicUngated: boolean;
  markdown: boolean;
  download: boolean;
  expiresAt: string | null;
  headers: HeadersInit;
}

const FILL_DEADLINE_MS = 20_000;
const INTERNAL_TTL_SECONDS = 3600;
const BODY_HEADERS = [
  "content-type",
  "content-length",
  "etag",
  "content-encoding",
];

export function siteBodyCacheKey(selection: SiteCacheSelection): Request {
  const parts = [
    selection.siteId,
    selection.versionId,
    selection.path,
    selection.representation,
    selection.rendererRevision,
  ];
  return new Request(
    `https://site-body-cache.invalid/v1/${parts.map(encodeURIComponent).join("/")}`,
  );
}

function outgoing(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  for (const name of [
    "cdn-cache-control",
    "cloudflare-cdn-cache-control",
    "surrogate-control",
    "cache-tag",
    "expires",
  ])
    headers.delete(name);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function defaultCache(): Cache | undefined {
  try {
    return caches.default;
  } catch {
    return undefined;
  }
}

async function fillCache(
  env: Env,
  cache: Cache,
  key: Request,
  selection: SiteCacheSelection,
  ttl: number,
): Promise<void> {
  let lease: VersionLease | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      const error = new Error("Site cache fill deadline exceeded");
      controller?.error(error);
      void reader?.cancel(error).catch(() => undefined);
      reject(error);
    }, FILL_DEADLINE_MS);
  });
  const work = async () => {
    const acquired = await acquireVersionLease(
      env.DB,
      selection.versionId,
      "cache-fill",
    );
    lease = acquired;
    if (expired) {
      await releaseVersionLease(env.DB, acquired);
      return;
    }
    const object = await env.BUCKET.get(selection.objectKey);
    if (!object) return;
    if (expired) {
      await object.body.cancel();
      return;
    }
    reader = object.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        async pull(value) {
          try {
            const next = await reader!.read();
            if (expired) return;
            if (next.done) value.close();
            else value.enqueue(next.value);
          } catch (error) {
            if (!expired) value.error(error);
          }
        },
        cancel(reason) {
          return reader!.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
    const headers = new Headers({ "cache-control": `public, max-age=${ttl}` });
    const current = new Headers(selection.headers);
    for (const name of BODY_HEADERS) {
      const value = current.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set("content-length", String(object.size));
    await cache.put(key, new Response(body, { headers }));
  };
  try {
    await Promise.race([work(), deadline]);
  } catch {
    /* Cache availability never controls a visitor read. */
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader?.cancel().catch(() => undefined);
    if (lease) await releaseVersionLease(env.DB, lease).catch(() => undefined);
  }
}

export async function withSiteBodyCache(
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  request: Request,
  selection: SiteCacheSelection,
  readSelected: () => Promise<Response>,
  cache: Cache | undefined = defaultCache(),
): Promise<Response> {
  const remaining =
    selection.expiresAt === null
      ? INTERNAL_TTL_SECONDS
      : Math.floor((Date.parse(selection.expiresAt) - Date.now()) / 1000);
  const eligible =
    selection.publicUngated &&
    !selection.markdown &&
    !selection.download &&
    request.method === "GET" &&
    ![
      "range",
      "if-none-match",
      "if-modified-since",
      "if-match",
      "if-unmodified-since",
    ].some((name) => request.headers.has(name)) &&
    Number.isFinite(remaining) &&
    remaining > 0;
  if (!eligible || !cache) return outgoing(await readSelected());
  const key = siteBodyCacheKey(selection);
  try {
    const hit = await cache.match(key);
    if (hit?.status === 200 && hit.body) {
      return outgoing(new Response(hit.body, { headers: selection.headers }));
    }
    await hit?.body?.cancel();
  } catch {
    /* Misses and unavailable caches use the same selected version. */
  }
  const response = await readSelected();
  if (response.status === 200 && response.body && ctx) {
    try {
      ctx.waitUntil(
        fillCache(
          env,
          cache,
          key,
          selection,
          Math.min(INTERNAL_TTL_SECONDS, remaining),
        ),
      );
    } catch {
      /* A context that cannot retain work must not fail the visitor. */
    }
  }
  return outgoing(response);
}
