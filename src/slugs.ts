/** Next candidate after a taken slug: `docs` → `docs-2`, `docs-2` → `docs-3`. */
export function nextNumberedSlug(slug: string): string {
  const raw = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  const m = /^(.*)-(\d+)$/.exec(raw);
  const base = (m?.[1] || raw).replace(/-+$/g, "") || "site";
  const n = m ? Number(m[2]) + 1 : 2;
  const suffix = `-${Number.isFinite(n) && n > 1 ? n : 2}`;
  let head = base.slice(0, Math.max(1, 63 - suffix.length)).replace(/-+$/g, "");
  if (!head) head = "site";
  return `${head}${suffix}`.slice(0, 63);
}
