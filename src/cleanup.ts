import { assertNever } from "./catalog";
import { deleteLooseFile, patchLoose } from "./files";
import { ApiError, json, publicOrigin, sha256Hex } from "./http";
import { instancePolicy, resolveExpiresAt, type InstancePolicy, type ResolvedTtl } from "./policy";
import {
  CLEANUP_SAMPLE,
  parseSelection,
  refString,
  resolveSelection,
  summarizeSkipped,
  type CleanupObject,
  type ObjectRef,
  type ResolvedSelection,
  type Selection,
  type SkipPredicate,
  type SkipReason,
  type SkippedObject,
  type SkippedSummary,
} from "./selection";
import { deleteSite, patchSite } from "./sites";
import type { Actor, Env } from "./types";

/** Bump when the canonical confirm string changes shape so stale confirms drift instead of executing. */
const CONFIRM_VERSION = "1";
const EXPIRE_GRACE_SECONDS = 30 * 60;
const CONFIRM_RE = /^[0-9a-f]{32}$/;

export type CleanupActionKind = "delete" | "set_ttl" | "expire";

export type CleanupAction =
  | { kind: "delete" }
  | { kind: "set_ttl"; ttlInput: unknown; ttl: ResolvedTtl }
  | { kind: "expire"; ttlInput: unknown; ttl: ResolvedTtl };

export type CleanupRequest = { selection: Selection; action: CleanupAction; confirm: string | null };
export type CleanupPlan = { resolved: ResolvedSelection; confirm: string };

export type ObjectSummary = {
  kind: ObjectRef["kind"];
  ref: string;
  name: string;
  bytes: number;
  expires_at: string | null;
  updated_at: string;
};
export type AppliedObject = { kind: ObjectRef["kind"]; ref: string; name: string; bytes: number; expires_at?: string | null };
export type FailedObject = { kind: ObjectRef["kind"]; ref: string; error: string };

export type CleanupPreview = {
  action: CleanupActionKind;
  ttl?: string;
  executed: false;
  matched: number;
  eligible: number;
  bytes: number;
  skipped: SkippedSummary;
  sample: ObjectSummary[];
  confirm: string;
};

export type CleanupResult = {
  action: CleanupActionKind;
  ttl?: string;
  executed: true;
  applied: { total: number; bytes: number; objects: AppliedObject[] };
  skipped: SkippedSummary;
  failed: { total: number; objects: FailedObject[] };
};

export type CleanupOutcome =
  | { kind: "preview"; preview: CleanupPreview }
  | { kind: "drift"; preview: CleanupPreview }
  | { kind: "executed"; result: CleanupResult };

function expireGrace(policy: InstancePolicy): number {
  return policy.maxSeconds != null && policy.maxSeconds < EXPIRE_GRACE_SECONDS ? policy.maxSeconds : EXPIRE_GRACE_SECONDS;
}

function parseAction(env: Env, body: Record<string, unknown>): CleanupAction {
  const hasTtl = Object.prototype.hasOwnProperty.call(body, "ttl");
  const policy = instancePolicy(env);
  switch (body.action) {
    case "delete":
      if (hasTtl) throw new ApiError(400, "bad_action", "delete does not take ttl. Use set_ttl to change expiry instead.");
      return { kind: "delete" };
    case "set_ttl":
      if (!hasTtl) {
        throw new ApiError(400, "ttl_required", "set_ttl needs ttl: a preset like 7d, or never where this Energon allows it.", {
          presets: policy.presets.map((p) => p.id),
          default_ttl: policy.defaultTtl,
        });
      }
      return { kind: "set_ttl", ttlInput: body.ttl, ttl: resolveExpiresAt(policy, body.ttl) };
    case "expire": {
      if (hasTtl) throw new ApiError(400, "bad_action", "expire uses a fixed 30m grace. Use set_ttl to pick a ttl.");
      const grace = expireGrace(policy);
      return { kind: "expire", ttlInput: grace, ttl: resolveExpiresAt(policy, grace) };
    }
    default:
      throw new ApiError(400, "bad_action", "action must be delete, set_ttl, or expire.");
  }
}

function parseConfirm(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const confirm = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!CONFIRM_RE.test(confirm)) {
    throw new ApiError(400, "bad_confirm", "confirm must be the confirm string from a preview of this same request. Omit it to preview.");
  }
  return confirm;
}

export function parseCleanupRequest(env: Env, body: Record<string, unknown>): CleanupRequest {
  if (!Object.prototype.hasOwnProperty.call(body, "target")) {
    throw new ApiError(400, "bad_target", "target is required. Send { sites, files } ids or list filters; {} selects everything you are involved in.");
  }
  return { selection: parseSelection(body.target), action: parseAction(env, body), confirm: parseConfirm(body.confirm) };
}

function ttlLabel(action: CleanupAction): string | undefined {
  return action.kind === "delete" ? undefined : action.ttl.ttl;
}

export async function confirmToken(action: CleanupAction, eligible: CleanupObject[]): Promise<string> {
  const keys = eligible.map((object) => object.key).sort();
  const canonical = [CONFIRM_VERSION, action.kind, ttlLabel(action) ?? "", ...keys].join("\n");
  return (await sha256Hex(canonical)).slice(0, 32);
}

/** `expire` never moves an expiry later, so anything already inside the grace window is left alone. */
function alreadyExpiring(cutoffIso: string | null): SkipPredicate | undefined {
  if (cutoffIso === null) return undefined;
  const cutoff = Date.parse(cutoffIso);
  return (object) => {
    if (object.expires_at === null) return null;
    const at = Date.parse(object.expires_at);
    return Number.isFinite(at) && at <= cutoff ? "already_expiring" : null;
  };
}

export async function planCleanup(env: Env, actor: Actor, request: CleanupRequest): Promise<CleanupPlan> {
  const skip = request.action.kind === "expire" ? alreadyExpiring(request.action.ttl.expiresAt) : undefined;
  const resolved = await resolveSelection(env, actor, request.selection, skip);
  return { resolved, confirm: await confirmToken(request.action, resolved.eligible) };
}

function summary(object: CleanupObject): ObjectSummary {
  return {
    kind: object.ref.kind,
    ref: refString(object.ref),
    name: object.name,
    bytes: object.bytes,
    expires_at: object.expires_at,
    updated_at: object.updated_at,
  };
}

export function previewBody(action: CleanupAction, plan: CleanupPlan): CleanupPreview {
  const preview: CleanupPreview = {
    action: action.kind,
    executed: false,
    matched: plan.resolved.matched,
    eligible: plan.resolved.eligible.length,
    bytes: plan.resolved.bytes,
    skipped: summarizeSkipped(plan.resolved.skipped),
    sample: plan.resolved.eligible.slice(0, CLEANUP_SAMPLE).map(summary),
    confirm: plan.confirm,
  };
  const ttl = ttlLabel(action);
  if (ttl !== undefined) preview.ttl = ttl;
  return preview;
}

async function expiresFrom(response: Response): Promise<string | null> {
  const body = (await response.json()) as { expires_at?: string | null };
  return body.expires_at ?? null;
}

async function applyOne(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  action: CleanupAction,
  object: CleanupObject,
): Promise<AppliedObject> {
  const ref = object.ref;
  const applied: AppliedObject = { kind: ref.kind, ref: refString(ref), name: object.name, bytes: object.bytes };
  switch (action.kind) {
    case "delete":
      switch (ref.kind) {
        case "site":
          await deleteSite(env, ctx, actor, ref.id);
          return applied;
        case "file":
          await deleteLooseFile(env, ctx, actor, ref.id);
          return applied;
        default:
          return assertNever(ref);
      }
    case "set_ttl":
    case "expire": {
      const patch = { ttl: action.ttlInput, setTtl: true };
      switch (ref.kind) {
        case "site": {
          const response = await patchSite(env, actor, ref.id, patch, ctx);
          applied.expires_at = await expiresFrom(response);
          return applied;
        }
        case "file": {
          const response = await patchLoose(env, actor, ref.id, patch, ctx);
          applied.expires_at = await expiresFrom(response);
          return applied;
        }
        default:
          return assertNever(ref);
      }
    }
    default:
      return assertNever(action);
  }
}

type Failure = { kind: "skipped"; reason: SkipReason } | { kind: "failed"; error: string };

function normalizeFailure(err: unknown): Failure {
  if (!(err instanceof ApiError)) {
    console.error("cleanup item failed", err instanceof Error ? err.stack || err.message : err);
    return { kind: "failed", error: "internal" };
  }
  if (err.status === 403) return { kind: "skipped", reason: "not_writable" };
  if (err.status === 404 || err.status === 410) return { kind: "skipped", reason: "gone" };
  if (err.status === 409 && err.code.endsWith("_busy")) return { kind: "skipped", reason: "busy" };
  return { kind: "failed", error: err.code };
}

/**
 * Sequential on purpose: each item takes its own claims and R2 round trips, and a
 * failure must not stop the rest of the batch.
 */
export async function executeCleanup(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  request: CleanupRequest,
  plan: CleanupPlan,
): Promise<CleanupResult> {
  const applied: AppliedObject[] = [];
  const failed: FailedObject[] = [];
  const skipped: SkippedObject[] = [...plan.resolved.skipped];
  let bytes = 0;
  for (const object of plan.resolved.eligible) {
    try {
      applied.push(await applyOne(env, ctx, actor, request.action, object));
      bytes += object.bytes;
    } catch (err) {
      const failure = normalizeFailure(err);
      const ref = refString(object.ref);
      if (failure.kind === "skipped") skipped.push({ kind: object.ref.kind, ref, reason: failure.reason });
      else failed.push({ kind: object.ref.kind, ref, error: failure.error });
    }
  }
  const result: CleanupResult = {
    action: request.action.kind,
    executed: true,
    applied: { total: applied.length, bytes, objects: applied },
    skipped: summarizeSkipped(skipped),
    failed: { total: failed.length, objects: failed },
  };
  const ttl = ttlLabel(request.action);
  if (ttl !== undefined) result.ttl = ttl;
  return result;
}

export async function runCleanup(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<CleanupOutcome> {
  const request = parseCleanupRequest(env, body);
  const plan = await planCleanup(env, actor, request);
  if (request.confirm === null) return { kind: "preview", preview: previewBody(request.action, plan) };
  if (request.confirm !== plan.confirm) return { kind: "drift", preview: previewBody(request.action, plan) };
  return { kind: "executed", result: await executeCleanup(env, ctx, actor, request, plan) };
}

export async function cleanupResponse(
  env: Env,
  ctx: ExecutionContext | undefined,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<Response> {
  const outcome = await runCleanup(env, ctx, actor, body);
  switch (outcome.kind) {
    case "preview":
      return json(outcome.preview);
    case "executed":
      return json(outcome.result);
    case "drift":
      return new ApiError(
        409,
        "cleanup_drift",
        "The selection changed since that preview. Review this fresh preview and resend with its confirm.",
        outcome.preview,
      ).toResponse(publicOrigin(env));
    default:
      return assertNever(outcome);
  }
}
