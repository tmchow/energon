import { FILE_ID_LEN } from "./config";
import { ApiError, nanoid } from "./http";
import type { Env } from "./types";

/** Shared capability-id helper for loose files and sites. */
export async function mintObjectId(env: Env, table: "loose_files" | "sites"): Promise<string> {
  const label = table === "sites" ? "site" : "file";
  for (let i = 0; i < 8; i++) {
    const id = nanoid(FILE_ID_LEN);
    const exists = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first();
    if (!exists) return id;
  }
  throw new ApiError(500, "id_failed", `Could not mint a ${label} id.`);
}
