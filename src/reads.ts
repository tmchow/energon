import type { Env } from "./types";

export const READ_THROTTLE_MS = 60 * 60 * 1000;

export type ReadTarget = {
  table: "sites" | "loose_files";
  id: string;
  last_read_at?: string | null;
};

/**
 * Record that this object's bytes were served. Best effort, off the response
 * path, and skipped while the stored stamp is younger than READ_THROTTLE_MS so
 * a popular page does not turn every request into a D1 write. Public reads
 * answered from the edge cache never reach the Worker, so the stored value is a
 * floor.
 */
export function noteRead(env: Env, ctx: ExecutionContext | undefined, target: ReadTarget): void {
  const now = Date.now();
  const last = target.last_read_at ? Date.parse(target.last_read_at) : NaN;
  if (Number.isFinite(last) && now - last < READ_THROTTLE_MS) return;
  const stamp = new Date(now).toISOString();
  const floor = new Date(now - READ_THROTTLE_MS).toISOString();
  // The WHERE guard keeps concurrent isolates that all saw a stale row from moving the stamp backwards.
  const write = env.DB.prepare(
    `UPDATE ${target.table} SET last_read_at = ? WHERE id = ? AND (last_read_at IS NULL OR last_read_at < ?)`,
  )
    .bind(stamp, target.id, floor)
    .run()
    .then(
      () => undefined,
      () => undefined,
    );
  if (ctx) ctx.waitUntil(write);
}
