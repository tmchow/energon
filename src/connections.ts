import { assertEmailAllowed, hashToken, maskToken } from "./auth";
import { TOKEN_SECRET_LEN } from "./config";
import { hashesEqual } from "./gate";
import { ApiError, nanoid, publicOrigin, secretJson, sha256Hex } from "./http";
import { identityFromEnv } from "./instance";
import { resolveTokenExpiresAt, tokenPolicy } from "./policy";
import type { Actor, Env } from "./types";

const CONNECTION_SECONDS = 600;
const POLL_SECONDS = 5;

type Connection = {
  id: string;
  label: string;
  code_hash: string;
  status: "pending" | "approved" | "denied" | "consumed";
  expires_at: string;
  user_id: string | null;
  token_expires_at: string | null;
};

type ConnectionState = Pick<Connection, "status" | "expires_at">;
type HumanConnection = Pick<Connection, "id" | "label" | "code_hash" | "status" | "expires_at">;
type PollConnection = Pick<Connection, "label" | "status" | "expires_at" | "user_id" | "token_expires_at">;

function assertActive(row: ConnectionState | null): asserts row is ConnectionState {
  if (!row || row.status === "consumed" || row.expires_at <= new Date().toISOString()) {
    throw new ApiError(410, "connection_expired", "This connection request ended. Start a new request; do not reuse its secrets.");
  }
  if (row.status === "denied") throw new ApiError(403, "connection_denied", "The connection was denied. Stop and ask the human before trying again.");
}

export async function startConnection(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 64) throw new ApiError(400, "bad_label", "Give this agent a label of 1 to 64 characters.");
  const id = nanoid(24);
  const pollToken = nanoid(48);
  const userCode = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => String(byte % 10)).join("");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONNECTION_SECONDS * 1000).toISOString();
  const since = new Date(now.getTime() - CONNECTION_SECONDS * 1000).toISOString();
  const [ipHash, pollHash, codeHash] = await Promise.all([
    sha256Hex(request.headers.get("CF-Connecting-IP") || "unknown"),
    hashToken(pollToken),
    sha256Hex(`${id}:${userCode}`),
  ]);
  // Count and insert in one statement so concurrent anonymous requests cannot exceed either cap.
  const inserted = await env.DB.prepare(
    `INSERT INTO agent_connections (id, label, poll_hash, code_hash, ip_hash, created_at, expires_at, status, attempts, next_poll_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?
     WHERE (SELECT COUNT(*) FROM agent_connections WHERE ip_hash = ? AND created_at > ?) < 20
       AND (SELECT COUNT(*) FROM agent_connections WHERE created_at > ?) < 1000`,
  ).bind(id, label, pollHash, codeHash, ipHash, now.toISOString(), expiresAt, now.toISOString(), ipHash, since, since).run();
  if (!inserted.meta.changes) throw new ApiError(429, "connection_rate_limited", "Too many connection requests. Wait ten minutes before starting another.");
  return secretJson({
    id, poll_token: pollToken, user_code: userCode,
    verification_uri: `${publicOrigin(env)}/connect?request=${id}`,
    expires_in: CONNECTION_SECONDS, interval: POLL_SECONDS,
  }, 201);
}

export async function connectionForHuman(env: Env, id: string): Promise<HumanConnection> {
  const row = await env.DB.prepare("SELECT id, label, code_hash, status, expires_at FROM agent_connections WHERE id = ?").bind(id).first<HumanConnection>();
  assertActive(row);
  if (row.status !== "pending") throw new ApiError(409, "connection_decided", "This request has already been approved. Return to the agent.");
  return row;
}

export async function decideConnection(env: Env, id: string, actor: Actor, body: Record<string, unknown>, approve: boolean): Promise<Response> {
  const row = await connectionForHuman(env, id);
  // Deny is available without the agent code so a surprise request can be rejected.
  // Approve still requires the code shown by the agent.
  if (approve) {
    const code = typeof body.user_code === "string" ? body.user_code.trim() : "";
    if (!hashesEqual(await sha256Hex(`${id}:${code}`), row.code_hash)) {
      await env.DB.prepare(
        `UPDATE agent_connections SET attempts = attempts + 1, status = CASE WHEN attempts >= 4 THEN 'denied' ELSE status END
         WHERE id = ? AND status = 'pending'`,
      ).bind(id).run();
      throw new ApiError(400, "connection_bad_code", "Enter the code shown by your agent. Five incorrect attempts end this request.");
    }
  }
  const now = new Date();
  const tokenExpiresAt = approve ? resolveTokenExpiresAt(tokenPolicy(env), body.ttl, now) : null;
  const result = await env.DB.prepare(
    `UPDATE agent_connections SET status = ?, user_id = ?, token_expires_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at > ?`,
  ).bind(approve ? "approved" : "denied", actor.userId, tokenExpiresAt, id, now.toISOString()).run();
  if (!result.meta.changes) throw new ApiError(409, "connection_decided", "This request has already ended or been decided.");
  return secretJson({ status: approve ? "approved" : "denied" });
}

export async function exchangeConnection(env: Env, id: string, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.poll_token !== "string" || body.poll_token.length !== 48) {
    throw new ApiError(401, "connection_invalid", "Invalid connection credentials.");
  }
  const pollHash = await hashToken(body.poll_token);
  const row = await env.DB.prepare("SELECT label, status, expires_at, user_id, token_expires_at FROM agent_connections WHERE id = ? AND poll_hash = ?").bind(id, pollHash).first<PollConnection>();
  if (!row) throw new ApiError(401, "connection_invalid", "Invalid connection credentials.");
  assertActive(row);
  const now = new Date();
  const timestamp = now.toISOString();
  if (row.status === "pending") {
    const polled = await env.DB.prepare(
      "UPDATE agent_connections SET next_poll_at = ? WHERE id = ? AND status = 'pending' AND next_poll_at <= ?",
    ).bind(new Date(now.getTime() + POLL_SECONDS * 1000).toISOString(), id, timestamp).run();
    if (!polled.meta.changes) throw new ApiError(429, "connection_slow_down", "Wait at least five seconds between polls.");
    return secretJson({ status: "pending", interval: POLL_SECONDS }, 202);
  }
  const user = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(row.user_id).first<{ id: string; email: string }>();
  if (!user) throw new ApiError(403, "connection_denied", "The approving account is no longer available.");
  assertEmailAllowed(env, user.email);
  const tokenId = nanoid(12);
  const token = `${identityFromEnv(env).tokenPrefix}${nanoid(TOKEN_SECRET_LEN)}`;
  const tokenHash = await hashToken(token);
  // The batch consumes approval and inserts its token atomically; only one concurrent poll can receive a secret.
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tokens (id, user_email, user_id, label, token_hash, token_hint, created_at, expires_at, scope)
       SELECT ?, ?, user_id, label, ?, ?, ?, token_expires_at, 'account' FROM agent_connections
       WHERE id = ? AND poll_hash = ? AND status = 'approved' AND expires_at > ?`,
    ).bind(tokenId, user.email, tokenHash, maskToken(token, env), timestamp, id, pollHash, timestamp),
    env.DB.prepare(
      `UPDATE agent_connections SET status = 'consumed' WHERE id = ? AND status = 'approved'
       AND EXISTS (SELECT 1 FROM tokens WHERE id = ?)`,
    ).bind(id, tokenId),
  ]);
  if (!inserted.meta.changes) throw new ApiError(410, "connection_expired", "This request was already consumed or expired. Start a new connection if delivery failed.");
  return secretJson({ id: tokenId, token, label: row.label, expires_at: row.token_expires_at });
}

export async function purgeConnections(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM agent_connections WHERE expires_at < ?")
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).run();
}
