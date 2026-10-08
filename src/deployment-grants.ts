import { assertEmailAllowed, grantActor, parseBearer } from "./auth";
import { hashesEqual } from "./gate";
import { FORBIDDEN_PUT_HEADERS } from "./guest-write";
import { ApiError, contentOrigin, isLocalHost, nanoid, secretJson, sha256Hex } from "./http";
import { assertCanMutate, resolveGrantExpiresAt } from "./policy";
import { deploymentApi } from "./site-deployment-api";
import { getDeployment, type DeploymentAuthority } from "./site-deployments";
import { getSiteById } from "./sites";
import type { Actor, DeploymentGrantRow, DeploymentIntent, Env, SiteDeploymentRow } from "./types";

export const DEPLOYMENT_GRANT_SECRET_PREFIX = "deployment_grant_";
export const DEPLOYMENT_GRANT_PATH = /^\/_deployment-grants\/([A-Za-z0-9]{24})(?:\/(files|archive|prepare|commit)(?:\/(.+))?)?$/;
const hashSecret = (secret: string) => sha256Hex(`energon-deployment-grant:${secret}`);
const invalidGrant = () => new ApiError(404, "grant_invalid", "No deployment grant matches that id and secret.");

export async function mintDeploymentGrant(env: Env, actor: Actor, body: Record<string, unknown>): Promise<Response> {
  if (!actor.tokenId || !actor.userId) throw new ApiError(401, "unauthorized", "Deployment grants require an account token.");
  const live = await grantActor(env, actor.tokenId);
  if (!("actor" in live)) throw new ApiError(410, "grant_failed", "The token can no longer authorize a deployment.");
  const target = body.target as Record<string, unknown>;
  if (Object.keys(target).some(key => !["type", "deployment_id", "site_id"].includes(key)) || typeof target.deployment_id !== "string") {
    throw new ApiError(400, "bad_target", "A deployment grant references an existing deployment_id.");
  }
  const deployment = await getDeployment(env.DB, target.deployment_id);
  if (!deployment || deployment.owner_id !== live.actor.userId || (target.site_id !== undefined && target.site_id !== deployment.site_id)) {
    throw new ApiError(404, "grant_not_found", "No owned deployment with that id.");
  }
  const now = new Date();
  if (!["uploading", "ready"].includes(deployment.state) || deployment.deadline <= now.toISOString()) {
    throw new ApiError(410, "grant_expired", "That deployment no longer accepts a grant.");
  }
  const site = await getSiteById(env, deployment.site_id);
  if (!site || site.lifecycle_state !== "live" || (site.expires_at && site.expires_at <= now.toISOString())) {
    throw new ApiError(410, "grant_expired", "That site no longer accepts a deployment.");
  }
  assertCanMutate(live.actor, site);
  if (site.content_generation !== deployment.base_generation) throw new ApiError(409, "site_busy", "The site changed since this deployment began.");
  const intent: DeploymentIntent = JSON.parse(deployment.input_json);
  const bytes = intent.archive?.size ?? intent.files!.reduce((sum, file) => sum + file.size, 0);
  if (body.max_bytes !== undefined && (typeof body.max_bytes !== "number" || !Number.isSafeInteger(body.max_bytes) || body.max_bytes < bytes)) {
    throw new ApiError(400, "bad_request", "max_bytes must cover the immutable deployment input.");
  }
  const expiresAt = [deployment.deadline, resolveGrantExpiresAt(body.expires_in, live.actor.tokenExpiresAt, now)].sort()[0];
  const id = nanoid(24);
  const secret = `${DEPLOYMENT_GRANT_SECRET_PREFIX}${nanoid(43)}`;
  await env.DB.prepare(`INSERT INTO upload_grants (id, secret_hash, token_id, user_email, user_id, target_kind,
    site_id, deployment_id, deployment_intent_hash, deployment_base_generation, max_bytes, state, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'site_deployment', ?, ?, ?, ?, ?, 'unused', ?, ?)`)
    .bind(id, await hashSecret(secret), actor.tokenId, live.actor.email, live.actor.userId!, deployment.site_id,
      deployment.id, deployment.intent_hash, deployment.base_generation, bytes, now.toISOString(), expiresAt).run();
  const url = `${contentOrigin(env)}/_deployment-grants/${id}`;
  return secretJson({ id, secret, header: "Authorization", scheme: "Bearer", expires_at: expiresAt,
    max_bytes: bytes, target: { type: "site_deployment", deployment_id: deployment.id, site_id: deployment.site_id },
    status_url: url, upload_url: `${url}/files/{path}`, archive_url: `${url}/archive`,
    prepare_url: `${url}/prepare`, commit_url: `${url}/commit` }, 201);
}

async function authorizeGrant(env: Env, id: string, secret: string, receiptOnly: boolean): Promise<{
  grant: DeploymentGrantRow; deployment: SiteDeploymentRow; actor: DeploymentAuthority;
}> {
  const grant = await env.DB.prepare("SELECT * FROM upload_grants WHERE id = ? AND target_kind = 'site_deployment'")
    .bind(id).first<DeploymentGrantRow>();
  if (!grant || !hashesEqual(grant.secret_hash, await hashSecret(secret))) throw invalidGrant();
  const deployment = await getDeployment(env.DB, grant.deployment_id);
  if (!deployment || grant.site_id !== deployment.site_id || grant.deployment_intent_hash !== deployment.intent_hash ||
      grant.deployment_base_generation !== deployment.base_generation || grant.user_id !== deployment.owner_id) throw invalidGrant();
  const token = await env.DB.prepare("SELECT user_email, user_id, revoked_at, expires_at FROM tokens WHERE id = ?")
    .bind(grant.token_id).first<{ user_email: string; user_id: string | null; revoked_at: string | null; expires_at: string | null }>();
  if (!token || token.revoked_at || grant.state === "revoked" || token.user_email !== grant.user_email || token.user_id !== grant.user_id) {
    throw new ApiError(410, "grant_failed", "The deployment grant has been revoked.");
  }
  assertEmailAllowed(env, token.user_email);
  const actor: DeploymentAuthority = { via: "grant", email: token.user_email, userId: token.user_id ?? undefined,
    tokenId: grant.token_id, tokenExpiresAt: token.expires_at, grantId: id };
  const now = new Date().toISOString();
  const terminal = deployment.terminal_at !== null;
  if (terminal && deployment.receipt_expires_at && deployment.receipt_expires_at <= now) {
    throw new ApiError(410, "grant_expired", "The deployment receipt has expired.");
  }
  if (receiptOnly && terminal) return { grant, deployment, actor };
  if (grant.expires_at <= now || deployment.deadline <= now || (token.expires_at && token.expires_at <= now)) {
    throw new ApiError(410, "grant_expired", "The deployment grant has expired.");
  }
  if (grant.state !== "unused") throw new ApiError(410, "grant_used", "The deployment grant no longer permits writes.");
  const site = await getSiteById(env, deployment.site_id);
  if (!site || site.lifecycle_state !== "live" || (site.expires_at && site.expires_at <= now)) {
    throw new ApiError(410, "grant_expired", "The site no longer accepts this deployment.");
  }
  assertCanMutate(actor, site);
  return { grant, deployment, actor };
}

export async function redeemDeploymentGrantRoute(env: Env, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== contentOrigin(env) && !isLocalHost(url.hostname)) return secretJson({ error: "not_found" }, 404);
    const match = DEPLOYMENT_GRANT_PATH.exec(url.pathname);
    if (!match) return secretJson({ error: "not_found" }, 404);
    const [, id, action, encodedPath] = match;
    const method = !action ? "GET" : action === "files" || action === "archive" ? "PUT" : "POST";
    if (request.method !== method || (action === "files" ? !encodedPath : encodedPath !== undefined)) {
      const response = secretJson({ error: "method_not_allowed", message: "Use the exact deployment operation URL and method." }, 405);
      response.headers.set("allow", method);
      return response;
    }
    if ((action === "prepare" || action === "commit") && request.body) {
      const reader = request.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.byteLength) {
            await reader.cancel();
            throw new ApiError(400, "bad_request", "Deployment operations do not accept a replacement intent or settings body.");
          }
        }
      } finally { reader.releaseLock(); }
    }
    for (const header of FORBIDDEN_PUT_HEADERS) {
      if (request.headers.has(header)) throw new ApiError(400, "bad_request", "Deployment grants cannot change site settings.");
    }
    const secret = parseBearer(request);
    if (!secret) throw invalidGrant();
    const receiptOnly = request.method === "GET" || action === "commit";
    const current = await authorizeGrant(env, id, secret, receiptOnly);
    const response = await deploymentApi(request, env, current.actor, current.deployment.site_id, current.deployment.id,
      action, encodedPath ? decodeURIComponent(encodedPath) : undefined,
      async () => { await authorizeGrant(env, id, secret, receiptOnly); });
    const data = await response.json() as Record<string, unknown>;
    if (data.status_url) data.status_url = `${contentOrigin(env)}/_deployment-grants/${id}`;
    return secretJson(data, response.status);
  } catch (error) {
    if (error instanceof ApiError) return secretJson({ error: error.code, message: error.message, ...error.extra }, error.status);
    if (error instanceof URIError) return secretJson({ error: "bad_path", message: "The path is not valid URL encoding." }, 400);
    console.error(error instanceof Error ? error.message : "Deployment grant operation failed");
    return secretJson({ error: "internal", message: "The deployment operation failed. Retry using the same grant." }, 500);
  }
}
