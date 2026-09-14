import { instanceFooter } from "./chrome";
import { bakedProductVersion } from "./product-version";
import type { UpstreamSnapshot, UpstreamStatus } from "./page-data";
import type { Env } from "./types";

export const UPSTREAM_RELEASES_LATEST = "https://api.github.com/repos/tmchow/energon/releases/latest";
export const UPSTREAM_DOCS_UPDATE = "https://docs.getenergon.com/operate/upgrade-recover";
export const UPSTREAM_CACHE_SECONDS = 8 * 60 * 60;
const UPSTREAM_CACHE_URL = "https://energon.internal/upstream/releases/latest";
const UPSTREAM_USER_AGENT = "energon-upstream-check";

export type GithubRelease = {
  tag_name: string;
  html_url: string;
  published_at: string;
};

export function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export function parseGithubRelease(raw: unknown): GithubRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.tag_name !== "string" || typeof rec.html_url !== "string") return null;
  const published = typeof rec.published_at === "string" ? rec.published_at : "";
  return { tag_name: rec.tag_name, html_url: rec.html_url, published_at: published };
}

export function classifyUpstream(thisVersion: string | null, latestTag: string): UpstreamStatus {
  if (!thisVersion) return "unknown";
  const cmp = compareSemver(thisVersion, latestTag);
  if (cmp == null) return "unknown";
  return cmp < 0 ? "update" : "current";
}

export function snapshotFromRelease(thisVersion: string | null, release: GithubRelease): UpstreamSnapshot {
  const status = classifyUpstream(thisVersion, release.tag_name);
  return {
    status,
    this_version: thisVersion,
    latest_tag: release.tag_name,
    latest_url: release.html_url,
    published_at: release.published_at || null,
    docs_url: UPSTREAM_DOCS_UPDATE,
  };
}

export function failedSnapshot(thisVersion: string | null): UpstreamSnapshot {
  return {
    status: "failed",
    this_version: thisVersion,
    latest_tag: null,
    latest_url: null,
    published_at: null,
    docs_url: UPSTREAM_DOCS_UPDATE,
  };
}

export async function loadUpstream(env: Env): Promise<UpstreamSnapshot> {
  const thisVersion = bakedProductVersion();
  const release = env.UPSTREAM_RELEASE_JSON
    ? parseFixture(env.UPSTREAM_RELEASE_JSON)
    : await fetchLatestRelease();
  if (!release) return failedSnapshot(thisVersion);
  return snapshotFromRelease(thisVersion, release);
}

export async function pageChrome(
  env: Env,
  admin: boolean,
): Promise<{ footer: string; upstream?: UpstreamSnapshot }> {
  return {
    footer: instanceFooter(env),
    upstream: admin ? await loadUpstream(env) : undefined,
  };
}

function parseFixture(raw: string): GithubRelease | null {
  try {
    return parseGithubRelease(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const cached = await readCachedRelease();
  if (cached) return cached;
  let response: Response;
  try {
    response = await fetch(UPSTREAM_RELEASES_LATEST, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": UPSTREAM_USER_AGENT,
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  const release = parseGithubRelease(parsed);
  if (release) await writeCachedRelease(release);
  return release;
}

async function readCachedRelease(): Promise<GithubRelease | null> {
  try {
    const hit = await caches.default.match(UPSTREAM_CACHE_URL);
    if (!hit) return null;
    return parseGithubRelease(await hit.json());
  } catch {
    return null;
  }
}

async function writeCachedRelease(release: GithubRelease): Promise<void> {
  try {
    await caches.default.put(
      UPSTREAM_CACHE_URL,
      new Response(JSON.stringify(release), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${UPSTREAM_CACHE_SECONDS}`,
        },
      }),
    );
  } catch {
    // Isolate memory is enough when Cache is unavailable.
  }
}
