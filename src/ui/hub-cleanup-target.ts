export type HubCleanupFind = {
  q: string;
  scope: string;
  expires: 'any' | 'never';
  expiresBefore: string;
  updatedBefore: string;
  lastReadBefore: string;
  minSize: string;
};

export type HubCleanupPick =
  | { matching: true }
  | { matching: false; sites: readonly string[]; files: readonly string[] };

export function hubCleanupTarget(pick: HubCleanupPick, find: HubCleanupFind): Record<string, unknown> | null {
  if (pick.matching) {
    const target: Record<string, unknown> = {};
    if (find.q.trim()) target.q = find.q.trim();
    if (find.scope !== 'involved') target.scope = find.scope;
    if (find.expires === 'never') target.expires = 'never';
    else if (find.expiresBefore.trim()) target.expires_before = find.expiresBefore.trim();
    if (find.updatedBefore.trim()) target.updated_before = find.updatedBefore.trim();
    if (find.lastReadBefore.trim()) target.last_read_before = find.lastReadBefore.trim();
    if (find.minSize.trim()) target.min_size = find.minSize.trim();
    return target;
  }
  if (!pick.sites.length && !pick.files.length) return null;
  const target: Record<string, unknown> = {};
  if (pick.sites.length) target.sites = [...pick.sites];
  if (pick.files.length) target.files = [...pick.files];
  return target;
}
