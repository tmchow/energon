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
  idp_sub?: string | null;
};

export function handleFromEmail(email: string): string {
  const local = String(email || "").split("@")[0] || "user";
  let s = local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  if (!s || !SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) s = `user-${s || nanoid(4)}`.replace(/-+/g, "-");
  if (!SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) s = `u-${nanoid(6).toLowerCase()}`;
  return s;
}

export async function getUser(env: Env, email: string): Promise<User | null> {
  return env.DB.prepare(`SELECT id, email, handle, idp_sub FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();
}

export async function getUserBySub(env: Env, idpSub: string): Promise<User | null> {
  return env.DB.prepare(`SELECT id, email, handle, idp_sub FROM users WHERE idp_sub = ?`)
    .bind(idpSub)
    .first<User>();
}

export async function getUserById(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare(`SELECT id, email, handle, idp_sub FROM users WHERE id = ?`)
    .bind(id)
    .first<User>();
}

function revokedEmail(id: string): string {
  return `revoked-${id}@invalid.invalid`;
}

async function insertUser(env: Env, email: string, idpSub: string | null): Promise<User> {
  const base = handleFromEmail(email);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const handle = SLUG_RE.test(candidate) && !RESERVED_HANDLES.has(candidate) ? candidate : `u-${nanoid(6).toLowerCase()}`;
    if (await handleOccupied(env, handle)) continue;
    const id = nanoid(16);
    const ts = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id, email, handle, created_at, idp_sub) VALUES (?, ?, ?, ?, ?)`).bind(
          id,
          email,
          handle,
          ts,
          idpSub,
        ),
        env.DB.prepare(`INSERT INTO handle_reservations (handle, user_id, created_at) VALUES (?, ?, ?)`).bind(handle, id, ts),
      ]);
      return { id, email, handle, idp_sub: idpSub };
    } catch {
      const raced = idpSub ? await getUserBySub(env, idpSub) : null;
      if (raced) return raced;
      const byEmail = await getUser(env, email);
      if (byEmail && (!idpSub || !byEmail.idp_sub || byEmail.idp_sub === idpSub)) return byEmail;
    }
  }
  throw new ApiError(500, "handle_failed", "Could not claim a URL handle.");
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

async function revokeUserTokens(env: Env, userId: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, userId),
    env.DB.prepare(`UPDATE tokens SET revoked_at = ? WHERE user_id IS NULL AND user_email = ? AND revoked_at IS NULL`).bind(
      now,
      email,
    ),
  ]);
}

async function retireUserEmail(env: Env, user: User): Promise<void> {
  const next = revokedEmail(user.id);
  await revokeUserTokens(env, user.id, user.email);
  await env.DB.batch([
    env.DB.prepare(`UPDATE sites SET created_by = ? WHERE owner_id = ?`).bind(next, user.id),
    env.DB.prepare(`UPDATE sites SET last_written_by = ? WHERE last_written_by = ?`).bind(next, user.email),
    env.DB.prepare(`UPDATE loose_files SET created_by = ? WHERE owner_id = ?`).bind(next, user.id),
    env.DB.prepare(`UPDATE loose_files SET last_written_by = ? WHERE last_written_by = ?`).bind(next, user.email),
    env.DB.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind(next, user.id),
  ]);
}

export async function ensureUser(env: Env, email: string, idpSub?: string | null): Promise<User> {
  const sub = (idpSub || "").trim() || null;
  if (sub) {
    const bySub = await getUserBySub(env, sub);
    if (bySub) {
      if (bySub.email !== email) {
        const occupant = await getUser(env, email);
        if (occupant && occupant.id !== bySub.id) {
          await retireUserEmail(env, occupant);
        }
        await env.DB.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind(email, bySub.id).run();
      }
      return { ...bySub, email };
    }
  }
  const byEmail = await getUser(env, email);
  if (byEmail) {
    if (sub && !byEmail.idp_sub) {
      await env.DB.prepare(`UPDATE users SET idp_sub = ? WHERE id = ? AND idp_sub IS NULL`).bind(sub, byEmail.id).run();
      return { ...byEmail, idp_sub: sub };
    }
    if (sub && byEmail.idp_sub && byEmail.idp_sub !== sub) {
      await retireUserEmail(env, byEmail);
      return insertUser(env, email, sub);
    }
    return byEmail;
  }
  return insertUser(env, email, sub);
}

export async function ensureHandle(env: Env, email: string, idpSub?: string | null): Promise<string> {
  return (await ensureUser(env, email, idpSub)).handle;
}

export function assertHandle(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!SLUG_RE.test(s) || RESERVED_HANDLES.has(s)) return null;
  return s;
}
