import { RESERVED_HANDLES, SLUG_RE } from "./config";
import { ApiError, nanoid } from "./http";
import type { Env } from "./types";

/**
 * A handle is a public URL label, not the account.
 *
 * - users.handle is what new publishes use (email local-part today).
 * - sites.handle and loose_files.handle are snapshots. Never rewrite them.
 *   Old URLs keep returning 200. Do not 301 — curl and many agents will not follow.
 * - A name is taken only while it is in use: someone's current handle, or a
 *   live file/site still stamped with it. No live objects and not current → free.
 * Changing the current handle is not exposed yet. When it is: update
 * users.handle, leave object snapshots alone, release the old name only if
 * handleOccupied() is false.
 */
export type User = {
  id: string;
  email: string;
  handle: string;
};

export function handleFromEmail(email: string): string {
  const local = String(email || "").split("@")[0] || "user";
  let s = local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  if (!s || !SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) s = `user-${s || nanoid(4)}`.replace(/-+/g, "-");
  if (!SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) s = `u-${nanoid(6).toLowerCase()}`;
  return s;
}

export async function getUser(env: Env, email: string): Promise<User | null> {
  return env.DB.prepare(`SELECT id, email, handle FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();
}

export async function handleOccupied(env: Env, handle: string, exceptUserId?: string): Promise<boolean> {
  if (RESERVED_HANDLES.has(handle) || !SLUG_RE.test(handle)) return true;
  const current = exceptUserId
    ? await env.DB.prepare(`SELECT id FROM users WHERE handle = ? AND id != ?`).bind(handle, exceptUserId).first()
    : await env.DB.prepare(`SELECT id FROM users WHERE handle = ?`).bind(handle).first();
  if (current) return true;
  const site = await env.DB.prepare(`SELECT slug FROM sites WHERE handle = ? LIMIT 1`).bind(handle).first();
  if (site) return true;
  const file = await env.DB.prepare(`SELECT id FROM loose_files WHERE handle = ? LIMIT 1`).bind(handle).first();
  return Boolean(file);
}

/** Drop a reservation when it is not current and nothing live is stamped with it. */
export async function releaseHandleIfUnused(env: Env, handle: string): Promise<boolean> {
  if (await handleOccupied(env, handle)) return false;
  await env.DB.prepare(`DELETE FROM handle_reservations WHERE handle = ?`).bind(handle).run();
  return true;
}

export async function ensureUser(env: Env, email: string): Promise<User> {
  const existing = await getUser(env, email);
  if (existing) return existing;
  const base = handleFromEmail(email);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const handle = SLUG_RE.test(candidate) && !RESERVED_HANDLES.has(candidate) ? candidate : `u-${nanoid(6).toLowerCase()}`;
    if (await handleOccupied(env, handle)) continue;
    const id = nanoid(16);
    const ts = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id, email, handle, created_at) VALUES (?, ?, ?, ?)`).bind(id, email, handle, ts),
        env.DB.prepare(`INSERT INTO handle_reservations (handle, user_id, created_at) VALUES (?, ?, ?)`).bind(handle, id, ts),
      ]);
      return { id, email, handle };
    } catch {
      const raced = await getUser(env, email);
      if (raced) return raced;
    }
  }
  throw new ApiError(500, "handle_failed", "Could not claim a URL handle.");
}

/** Current handle for new publishes. Not the snapshot on existing objects. */
export async function ensureHandle(env: Env, email: string): Promise<string> {
  return (await ensureUser(env, email)).handle;
}

export function assertHandle(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) return null;
  return s;
}
