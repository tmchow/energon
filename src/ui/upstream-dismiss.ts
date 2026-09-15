export const UPSTREAM_DISMISS_PREFIX = "energon:dismissed-release:";

export function upstreamDismissKey(tag: string): string {
  return `${UPSTREAM_DISMISS_PREFIX}${tag}`;
}

export function readDismissedTag(tag: string | null | undefined): boolean {
  if (!tag || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(upstreamDismissKey(tag)) === "1";
  } catch {
    return false;
  }
}

export function writeDismissedTag(tag: string): void {
  try {
    localStorage.setItem(upstreamDismissKey(tag), "1");
  } catch {
    // Private mode can refuse storage; the mark stays for this session only via memory.
  }
}
