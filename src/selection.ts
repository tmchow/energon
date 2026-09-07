import {
  assertNever,
  CRITERIA_KEYS,
  criteriaFrom,
  criteriaSql,
  SITE_SIZE_SQL,
  type CatalogKind,
  type CriteriaKey,
  type SelectionCriteria,
} from "./catalog";
import { isPurgeClaimed } from "./expire";
import { involvedInLoose } from "./files";
import { ApiError } from "./http";
import { canMutate } from "./policy";
import { getSiteById, involvedInSite } from "./sites";
import type { Actor, Env } from "./types";
import { isFileId } from "./urls";

export const CLEANUP_MAX_ITEMS = 100;
export const CLEANUP_SCAN_BOUND = 300;
export const CLEANUP_SAMPLE = 10;

export type SelectionObjects = "sites" | "files" | "both";

export type Selection =
  | { kind: "criteria"; criteria: SelectionCriteria; objects: SelectionObjects }
  | { kind: "explicit"; sites: string[]; files: string[] };

export type ObjectRef = { kind: "site"; id: string } | { kind: "file"; id: string };

export type CleanupObject = {
  ref: ObjectRef;
  key: string;
  name: string;
  bytes: number;
  expires_at: string | null;
  updated_at: string;
  involved: boolean;
  writable: boolean;
  purging: boolean;
};

export type SkipReason = "not_found" | "not_writable" | "purging" | "already_expiring" | "gone" | "busy";
export type SkippedObject = { kind: ObjectRef["kind"]; ref: string; reason: SkipReason };
export type SkipPredicate = (object: CleanupObject) => SkipReason | null;

export type ResolvedSelection = {
  matched: number;
  eligible: CleanupObject[];
  skipped: SkippedObject[];
  bytes: number;
};

export type SkippedSummary = { total: number; by_reason: Partial<Record<SkipReason, number>>; sample: SkippedObject[] };

const TARGET_KEYS = new Set<string>([...CRITERIA_KEYS, "kind", "sites", "files"]);

export function refString(ref: ObjectRef): string {
  return ref.id;
}

export function refKey(ref: ObjectRef): string {
  return `${ref.kind}:${refString(ref)}`;
}

export function summarizeSkipped(skipped: SkippedObject[]): SkippedSummary {
  const by_reason: Partial<Record<SkipReason, number>> = {};
  for (const item of skipped) by_reason[item.reason] = (by_reason[item.reason] ?? 0) + 1;
  return { total: skipped.length, by_reason, sample: skipped.slice(0, CLEANUP_SAMPLE) };
}

function badTarget(message: string): ApiError {
  return new ApiError(400, "bad_target", message);
}

function stringList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw badTarget(`target.${field} must be an array of strings.`);
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw badTarget(`target.${field} entries must be non-empty strings.`);
    }
    seen.add(entry.trim());
  }
  return [...seen];
}

function selectionObjects(raw: unknown): SelectionObjects {
  if (raw === undefined) return "both";
  if (raw === "sites" || raw === "files") return raw;
  throw badTarget("target.kind must be sites or files.");
}

/**
 * Explicit ids and filters never mix: an agent that sends both is confused about
 * what it is deleting, and the safe answer is to make it say so.
 */
export function parseSelection(raw: unknown): Selection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw badTarget("target must be an object: { sites, files } or list filters. {} selects everything you are involved in.");
  }
  const target = raw as Record<string, unknown>;
  const unknown = Object.keys(target).filter((key) => !TARGET_KEYS.has(key));
  if (unknown.length) throw badTarget(`Unknown target keys: ${unknown.join(", ")}.`);
  const explicit = "sites" in target || "files" in target;
  if (explicit) {
    const mixed = Object.keys(target).filter((key) => key !== "sites" && key !== "files");
    if (mixed.length) throw badTarget(`Send either ids (sites, files) or filters (${mixed.join(", ")}), not both.`);
    return {
      kind: "explicit",
      sites: "sites" in target ? stringList(target.sites, "sites") : [],
      files: "files" in target ? stringList(target.files, "files") : [],
    };
  }
  const objects = selectionObjects(target.kind);
  const parsed = criteriaFrom(target);
  if (parsed.malformed.length) {
    const keys: CriteriaKey[] = [...new Set(parsed.malformed)];
    throw new ApiError(400, "bad_query", `Malformed target filters: ${keys.join(", ")}.`, { fields: keys });
  }
  return { kind: "criteria", criteria: parsed.criteria, objects };
}

type SiteScanRow = {
  id: string;
  handle: string;
  slug: string;
  owner_id: string | null;
  created_by: string;
  last_written_by: string | null;
  write_policy: string | null;
  updated_at: string;
  expires_at: string | null;
  size: number;
};

type FileScanRow = {
  id: string;
  filename: string;
  owner_id: string | null;
  created_by: string;
  last_written_by: string | null;
  write_policy: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  size: number;
};

function siteObject(actor: Actor, row: SiteScanRow): CleanupObject {
  const ref: ObjectRef = { kind: "site", id: row.id };
  return {
    ref,
    key: refKey(ref),
    name: row.slug,
    bytes: Number(row.size ?? 0),
    expires_at: row.expires_at ?? null,
    updated_at: row.updated_at,
    involved: involvedInSite(actor, row),
    writable: canMutate(actor, row),
    purging: isPurgeClaimed(row.last_written_by),
  };
}

function fileObject(actor: Actor, row: FileScanRow): CleanupObject {
  const ref: ObjectRef = { kind: "file", id: row.id };
  return {
    ref,
    key: refKey(ref),
    name: row.filename,
    bytes: Number(row.size ?? 0),
    expires_at: row.expires_at ?? null,
    updated_at: row.updated_at || row.created_at,
    involved: involvedInLoose(actor, row),
    writable: canMutate(actor, row),
    purging: isPurgeClaimed(row.last_written_by),
  };
}

const SITE_SCAN_SELECT =
  `s.id, s.handle, s.slug, s.owner_id, s.created_by, s.last_written_by, s.write_policy, s.updated_at, s.expires_at, ${SITE_SIZE_SQL} AS size`;
const FILE_SCAN_SELECT =
  `id, filename, owner_id, created_by, last_written_by, write_policy, created_at, updated_at, expires_at, size`;

type Scan = { objects: CleanupObject[]; truncated: boolean };

async function scanSites(env: Env, actor: Actor, criteria: SelectionCriteria): Promise<Scan> {
  const sql = criteriaSql("sites", criteria, actor.email, actor.userId);
  const rows = await env.DB.prepare(
    `SELECT ${SITE_SCAN_SELECT}
     FROM sites s
     LEFT JOIN site_files f ON s.id = f.site_id
     WHERE ${sql.where}
     GROUP BY s.id
     ${sql.having ? `HAVING ${sql.having}` : ""}
     ORDER BY s.updated_at ASC, s.id ASC
     LIMIT ?`,
  )
    .bind(...sql.whereBinds, ...sql.havingBinds, CLEANUP_SCAN_BOUND + 1)
    .all<SiteScanRow>();
  const found = rows.results || [];
  return { objects: found.slice(0, CLEANUP_SCAN_BOUND).map((row) => siteObject(actor, row)), truncated: found.length > CLEANUP_SCAN_BOUND };
}

async function scanFiles(env: Env, actor: Actor, criteria: SelectionCriteria): Promise<Scan> {
  const sql = criteriaSql("files", criteria, actor.email, actor.userId);
  const rows = await env.DB.prepare(
    `SELECT ${FILE_SCAN_SELECT}
     FROM loose_files
     WHERE ${sql.where}
     ORDER BY COALESCE(updated_at, created_at) ASC, id ASC
     LIMIT ?`,
  )
    .bind(...sql.whereBinds, CLEANUP_SCAN_BOUND + 1)
    .all<FileScanRow>();
  const found = rows.results || [];
  return { objects: found.slice(0, CLEANUP_SCAN_BOUND).map((row) => fileObject(actor, row)), truncated: found.length > CLEANUP_SCAN_BOUND };
}

function scansFor(objects: SelectionObjects): CatalogKind[] {
  switch (objects) {
    case "sites":
      return ["sites"];
    case "files":
      return ["files"];
    case "both":
      return ["sites", "files"];
    default:
      return assertNever(objects);
  }
}

type Candidates = { objects: CleanupObject[]; unresolved: SkippedObject[]; truncated: boolean };

async function criteriaCandidates(env: Env, actor: Actor, criteria: SelectionCriteria, objects: SelectionObjects): Promise<Candidates> {
  const result: Candidates = { objects: [], unresolved: [], truncated: false };
  for (const kind of scansFor(objects)) {
    const scan = kind === "sites" ? await scanSites(env, actor, criteria) : await scanFiles(env, actor, criteria);
    result.objects.push(...scan.objects);
    result.truncated = result.truncated || scan.truncated;
  }
  return result;
}

async function lookupSite(env: Env, actor: Actor, id: string): Promise<CleanupObject | null> {
  const site = await getSiteById(env, id);
  if (!site) return null;
  const usage = await env.DB.prepare(`SELECT ${SITE_SIZE_SQL} AS size FROM site_files f WHERE f.site_id = ?`)
    .bind(site.id)
    .first<{ size: number }>();
  return siteObject(actor, {
    id: site.id,
    handle: site.handle,
    slug: site.slug,
    owner_id: site.owner_id ?? null,
    created_by: site.created_by,
    last_written_by: site.last_written_by,
    write_policy: site.write_policy ?? null,
    updated_at: site.updated_at,
    expires_at: site.expires_at ?? null,
    size: Number(usage?.size ?? 0),
  });
}

async function lookupFile(env: Env, actor: Actor, id: string): Promise<CleanupObject | null> {
  if (!isFileId(id)) return null;
  const row = await env.DB.prepare(`SELECT ${FILE_SCAN_SELECT} FROM loose_files WHERE id = ?`).bind(id).first<FileScanRow>();
  return row ? fileObject(actor, row) : null;
}

async function explicitCandidates(env: Env, actor: Actor, sites: string[], files: string[]): Promise<Candidates> {
  const result: Candidates = { objects: [], unresolved: [], truncated: false };
  const seen = new Set<string>();
  const keep = (object: CleanupObject | null, skipped: SkippedObject): void => {
    if (!object) {
      result.unresolved.push(skipped);
      return;
    }
    if (seen.has(object.key)) return;
    seen.add(object.key);
    result.objects.push(object);
  };
  for (const id of sites) keep(await lookupSite(env, actor, id), { kind: "site", ref: id, reason: "not_found" });
  for (const id of files) keep(await lookupFile(env, actor, id), { kind: "file", ref: id, reason: "not_found" });
  return result;
}

function tooMany(matched: number, resolved?: Omit<ResolvedSelection, "matched">): ApiError {
  const extra: Record<string, unknown> = { limit: CLEANUP_MAX_ITEMS, matched };
  if (resolved) {
    extra.eligible = resolved.eligible.length;
    extra.skipped = summarizeSkipped(resolved.skipped);
    extra.bytes = resolved.bytes;
  }
  return new ApiError(
    413,
    "cleanup_too_many",
    `Cleanup handles at most ${CLEANUP_MAX_ITEMS} eligible objects per call. Narrow the target (q, created_by, expires_before, updated_before, min_size, kind) or pass explicit ids, then retry.`,
    extra,
  );
}

function classify(object: CleanupObject, skip?: SkipPredicate): SkipReason | null {
  if (object.purging) return "purging";
  if (!object.writable) return "not_writable";
  return skip ? skip(object) : null;
}

/**
 * Write claims are not a skip reason here: they clear within seconds, so a preview
 * that named them would drift against its own execute for no reason.
 */
export async function resolveSelection(env: Env, actor: Actor, selection: Selection, skip?: SkipPredicate): Promise<ResolvedSelection> {
  let candidates: Candidates;
  switch (selection.kind) {
    case "explicit": {
      const requested = selection.sites.length + selection.files.length;
      if (requested > CLEANUP_MAX_ITEMS) throw tooMany(requested);
      candidates = await explicitCandidates(env, actor, selection.sites, selection.files);
      break;
    }
    case "criteria":
      candidates = await criteriaCandidates(env, actor, selection.criteria, selection.objects);
      break;
    default:
      return assertNever(selection);
  }
  const eligible: CleanupObject[] = [];
  const skipped: SkippedObject[] = [...candidates.unresolved];
  for (const object of candidates.objects) {
    const reason = classify(object, skip);
    if (reason) skipped.push({ kind: object.ref.kind, ref: refString(object.ref), reason });
    else eligible.push(object);
  }
  const bytes = eligible.reduce((sum, object) => sum + object.bytes, 0);
  const matched = candidates.objects.length + candidates.unresolved.length;
  if (candidates.truncated || eligible.length > CLEANUP_MAX_ITEMS) throw tooMany(matched, { eligible, skipped, bytes });
  return { matched, eligible, skipped, bytes };
}
