import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nowIso } from "../src/config";
import worker from "../src/index";
import { ensureSchema } from "../src/db";
import { WRITE_CLAIM } from "../src/expire";
import { seedExpiredLooseFiles, snapshotR2Keys, withMutationLog } from "./mutation-harness";

describe("mock-free scheduled mutation convergence", () => {
  it("converges across the 100-row sweep boundary and becomes a no-op", async () => {
    await withMutationLog("scheduled-sweep-batch-convergence", async (log) => {
      log.write("setup", "phase_start", { expired_files: 101 });
      await ensureSchema(env.DB);
      await seedExpiredLooseFiles(env, 101, "b");
      expect(await looseFileCount()).toBe(101);

      log.write("act", "scheduled_tick", { tick: 1 });
      await runScheduled();
      const afterFirst = await scheduledState();
      log.snapshot("assert", "after_tick_1", afterFirst);
      expect(afterFirst.rows).toBe(1);
      expect(afterFirst.objects).toHaveLength(1);
      expect(afterFirst.quota_used).toBe(afterFirst.catalog_bytes);

      log.write("act", "scheduled_tick", { tick: 2 });
      await runScheduled();
      const afterSecond = await scheduledState();
      log.snapshot("assert", "after_tick_2", afterSecond);
      expect(afterSecond).toEqual({ rows: 0, objects: [], quota_used: 0, catalog_bytes: 0 });

      log.write("act", "scheduled_tick", { tick: 3 });
      await runScheduled();
      const afterThird = await scheduledState();
      log.snapshot("assert", "after_tick_3", afterThird);
      expect(afterThird).toEqual(afterSecond);
    });
  }, 30_000);

  it("retains a fresh claimed expiry and purges it after the claim becomes stale", async () => {
    await withMutationLog("scheduled-sweep-claim-retry", async (log) => {
      log.write("setup", "phase_start", { expired_files: 2 });
      await ensureSchema(env.DB);
      const [claimed] = await seedExpiredLooseFiles(env, 2, "c");
      const claim = `${WRITE_CLAIM}:scheduled-retry`;
      await env.DB.prepare(`UPDATE loose_files SET last_written_by = ?, updated_at = ? WHERE id = ?`)
        .bind(claim, nowIso(), claimed.id)
        .run();

      log.write("act", "scheduled_tick", { tick: 1, fresh_claim: claimed.id });
      await runScheduled();
      const retained = await env.DB.prepare(`SELECT id, last_written_by FROM loose_files ORDER BY id`)
        .all<{ id: string; last_written_by: string }>();
      const afterFirst = await scheduledState();
      log.snapshot("assert", "after_fresh_claim_tick", { retained: retained.results, ...afterFirst });
      expect(retained.results).toEqual([{ id: claimed.id, last_written_by: claim }]);
      expect(afterFirst.objects).toEqual([claimed.key]);
      expect(afterFirst.quota_used).toBe(claimed.size);
      expect(afterFirst.catalog_bytes).toBe(claimed.size);

      await env.DB.prepare(`UPDATE loose_files SET updated_at = ? WHERE id = ?`)
        .bind("2000-01-01T00:00:00.000Z", claimed.id)
        .run();
      log.write("act", "scheduled_tick", { tick: 2, stale_claim: claimed.id });
      await runScheduled();
      const afterSecond = await scheduledState();
      log.snapshot("assert", "after_stale_claim_tick", afterSecond);
      expect(afterSecond).toEqual({ rows: 0, objects: [], quota_used: 0, catalog_bytes: 0 });
    });
  });
});

async function runScheduled(): Promise<void> {
  const controller = createScheduledController({ cron: "*/5 * * * *" });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

async function looseFileCount(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM loose_files`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function scheduledState() {
  const [rows, objects, quota, catalog] = await Promise.all([
    looseFileCount(),
    snapshotR2Keys(env.BUCKET, "files/"),
    env.DB.prepare(`SELECT used FROM platform_quota WHERE id = 1`).first<{ used: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used FROM loose_files`).first<{ used: number }>(),
  ]);
  return {
    rows,
    objects,
    quota_used: Number(quota?.used ?? 0),
    catalog_bytes: Number(catalog?.used ?? 0),
  };
}
