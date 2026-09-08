import { uiPage } from "./ui-render";
import { instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT } from "./config";
import type { Actor, Env } from "./types";

export type { StatsPayload, PersonStats } from "./page-data";
import type { StatsPayload, PersonStats } from "./page-data";

export async function loadStats(env: Env, email: string): Promise<StatsPayload> {
  const involved = "created_by = ? OR last_written_by = ?";
  const [
    youSites,
    youLoose,
    youSiteFiles,
    youSiteBytes,
    youLooseBytes,
    systemSites,
    systemLoose,
    systemSiteFiles,
    systemSiteBytes,
    systemLooseBytes,
    peopleCount,
    people,
  ] = await Promise.all([
    scalar(env, `SELECT COUNT(*) AS n FROM sites WHERE ${involved}`, email, email),
    scalar(env, `SELECT COUNT(*) AS n FROM loose_files WHERE ${involved}`, email, email),
    scalar(
      env,
      `SELECT COUNT(*) AS n FROM site_files f
       JOIN sites s ON s.id = f.site_id
       WHERE s.created_by = ? OR s.last_written_by = ?`,
      email,
      email,
    ),
    scalar(
      env,
      `SELECT COALESCE(SUM(f.size), 0) AS n FROM site_files f
       JOIN sites s ON s.id = f.site_id
       WHERE s.created_by = ? OR s.last_written_by = ?`,
      email,
      email,
    ),
    scalar(env, `SELECT COALESCE(SUM(size), 0) AS n FROM loose_files WHERE ${involved}`, email, email),
    scalar(env, `SELECT COUNT(*) AS n FROM sites`),
    scalar(env, `SELECT COUNT(*) AS n FROM loose_files`),
    scalar(env, `SELECT COUNT(*) AS n FROM site_files`),
    scalar(env, `SELECT COALESCE(SUM(size), 0) AS n FROM site_files`),
    scalar(env, `SELECT COALESCE(SUM(size), 0) AS n FROM loose_files`),
    scalar(env, `SELECT COUNT(*) AS n FROM users`),
    listPeople(env),
  ]);

  return {
    email,
    you: {
      sites: youSites,
      files: youLoose + youSiteFiles,
      bytes: youSiteBytes + youLooseBytes,
    },
    system: {
      sites: systemSites,
      files: systemLoose + systemSiteFiles,
      bytes: systemSiteBytes + systemLooseBytes,
      people: peopleCount,
    },
    people,
  };
}

async function listPeople(env: Env): Promise<PersonStats[]> {
  const rows = await env.DB.prepare(
    `WITH site_usage AS (
       SELECT COALESCE(u.email, s.created_by) AS email,
              COUNT(DISTINCT s.id) AS sites,
              COUNT(f.path) AS site_files,
              COALESCE(SUM(f.size), 0) AS site_bytes
       FROM sites s
       LEFT JOIN users u ON u.id = s.owner_id
       LEFT JOIN site_files f ON f.site_id = s.id
       GROUP BY 1
     ),
     file_usage AS (
       SELECT COALESCE(u.email, lf.created_by) AS email,
              COUNT(*) AS files,
              COALESCE(SUM(lf.size), 0) AS bytes
       FROM loose_files lf
       LEFT JOIN users u ON u.id = lf.owner_id
       GROUP BY 1
     )
     SELECT u.email, u.handle,
            COALESCE(su.sites, 0) AS sites,
            COALESCE(su.site_files, 0) + COALESCE(fu.files, 0) AS files,
            COALESCE(su.site_bytes, 0) + COALESCE(fu.bytes, 0) AS bytes
     FROM users u
     LEFT JOIN site_usage su ON su.email = u.email
     LEFT JOIN file_usage fu ON fu.email = u.email
     ORDER BY bytes DESC, u.handle ASC`,
  ).all<PersonStats>();
  return (rows.results || []).map((r) => ({
    email: r.email,
    handle: r.handle,
    sites: Number(r.sites) || 0,
    files: Number(r.files) || 0,
    bytes: Number(r.bytes) || 0,
  }));
}

export async function statsResponse(env: Env, actor: Actor): Promise<Response> {
  const stats = await loadStats(env, actor.email);
  return new Response(statsPage({ ...stats, admin: Boolean(actor.admin) }, instanceFooter(env)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

export function statsPage(stats: StatsPayload, footer = ""): string {
  return uiPage(`Stats — ${PRODUCT}`, { page: "stats", data: stats, footer });
}

async function scalar(env: Env, sql: string, ...binds: string[]): Promise<number> {
  const stmt = env.DB.prepare(sql);
  const row = (binds.length ? stmt.bind(...binds) : stmt).first<{ n: number }>();
  return Number((await row)?.n ?? 0);
}
