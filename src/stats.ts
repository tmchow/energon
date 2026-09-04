import { appHeader, documentShell, escapeHtml, instanceFooter, PRIVATE_HTML_HEADERS } from "./chrome";
import { PRODUCT, formatBytes, formatCount } from "./config";
import type { Actor, Env } from "./types";

type Bucket = {
  sites: number;
  files: number;
  bytes: number;
};

export type PersonStats = {
  email: string;
  handle: string;
  sites: number;
  files: number;
  bytes: number;
};

export type StatsPayload = {
  email: string;
  you: Bucket;
  system: Bucket & { people: number };
  people: PersonStats[];
};

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
       JOIN sites s ON s.handle = f.handle AND s.slug = f.slug
       WHERE s.created_by = ? OR s.last_written_by = ?`,
      email,
      email,
    ),
    scalar(
      env,
      `SELECT COALESCE(SUM(f.size), 0) AS n FROM site_files f
       JOIN sites s ON s.handle = f.handle AND s.slug = f.slug
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
              COUNT(DISTINCT s.handle || '/' || s.slug) AS sites,
              COUNT(f.path) AS site_files,
              COALESCE(SUM(f.size), 0) AS site_bytes
       FROM sites s
       LEFT JOIN users u ON u.id = s.owner_id
       LEFT JOIN site_files f ON f.handle = s.handle AND f.slug = s.slug
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
  return new Response(statsPage(stats, instanceFooter(env)), {
    headers: PRIVATE_HTML_HEADERS,
  });
}

export function statsPage(stats: StatsPayload, footer = ""): string {
  return documentShell({
    title: `Stats — ${PRODUCT}`,
    bodyClass: "page-stats",
    footer,
    body: `${appHeader({ active: "stats", email: stats.email })}
    <main class="wrap stats-wrap">
      <p class="kicker">How much is here</p>
      <h1 class="display">Storage and usage.</h1>
      <p class="lede">Your numbers cover work you created or last updated. Organization covers this instance. Files includes individual uploads and files inside sites. These are stored-content totals, not counts of views or handoffs.</p>
      <div class="stats-pair">
        ${pane("You", stats.email, [
          ["Sites", formatCount(stats.you.sites)],
          ["Files", formatCount(stats.you.files)],
          ["Storage", formatBytes(stats.you.bytes)],
        ])}
        ${pane("Organization", `${formatCount(stats.system.people)} ${stats.system.people === 1 ? "person" : "people"}`, [
          ["Sites", formatCount(stats.system.sites)],
          ["Files", formatCount(stats.system.files)],
          ["Storage", formatBytes(stats.system.bytes)],
        ])}
      </div>
      ${peopleList(stats.email, stats.people)}
    </main>
    ${stats.people.length ? peopleScript() : ""}`,
  });
}

function peopleList(me: string, people: PersonStats[]): string {
  if (people.length === 0) {
    return `<section class="stats-people card">
      <div class="stats-pane-head"><h2>People</h2><p>No one has published yet.</p></div>
    </section>`;
  }
  const maxBytes = Math.max(0, ...people.map((p) => p.bytes));
  const rows = people
    .map((p, i) => {
      const mine = p.email === me ? " you" : "";
      const pct = maxBytes > 0 ? (p.bytes / maxBytes) * 100 : 0;
      return `<li class="person${mine}" data-bytes="${p.bytes}" data-files="${p.files}" data-sites="${p.sites}" data-bytes-label="${escapeHtml(formatBytes(p.bytes))}" data-files-label="${escapeHtml(formatCount(p.files))}" data-sites-label="${escapeHtml(formatCount(p.sites))}">
        <div class="person-rank" aria-hidden="true">${i + 1}</div>
        <div class="person-who">
          <strong>${escapeHtml(p.handle)}</strong>
          <span>${escapeHtml(p.email)}</span>
        </div>
        <div class="person-val">${escapeHtml(formatBytes(p.bytes))}</div>
        <div class="person-bar" aria-hidden="true"><i style="width:${pct.toFixed(2)}%"></i></div>
      </li>`;
    })
    .join("");
  return `<section class="stats-people card" id="people">
    <div class="stats-people-head">
      <div class="stats-pane-head">
        <h2>People</h2>
        <p id="people-hint">Largest storage first.</p>
      </div>
      <div class="seg" role="tablist" aria-label="Rank people by">
        <button type="button" data-sort="storage" class="on" aria-pressed="true">Storage</button>
        <button type="button" data-sort="files" aria-pressed="false">Files</button>
        <button type="button" data-sort="sites" aria-pressed="false">Sites</button>
      </div>
    </div>
    <ol class="people">${rows}</ol>
  </section>`;
}

function peopleScript(): string {
  return `<script>
(function () {
  var root = document.getElementById("people");
  if (!root) return;
  var list = root.querySelector(".people");
  var hint = document.getElementById("people-hint");
  var labels = { storage: "Largest storage first.", files: "Most files first.", sites: "Most sites first." };
  var keys = { storage: "bytes", files: "files", sites: "sites" };
  root.querySelectorAll("[data-sort]").forEach(function (btn) {
    btn.addEventListener("click", function () { rank(btn.getAttribute("data-sort")); });
  });
  function rank(sort) {
    var key = keys[sort] || "bytes";
    root.querySelectorAll("[data-sort]").forEach(function (btn) {
      var on = btn.getAttribute("data-sort") === sort;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (hint) hint.textContent = labels[sort] || labels.storage;
    var items = Array.prototype.slice.call(list.querySelectorAll(".person"));
    items.sort(function (a, b) {
      var d = Number(b.getAttribute("data-" + key)) - Number(a.getAttribute("data-" + key));
      if (d) return d;
      return (a.querySelector("strong").textContent || "").localeCompare(b.querySelector("strong").textContent || "");
    });
    var max = 0;
    items.forEach(function (el) { max = Math.max(max, Number(el.getAttribute("data-" + key)) || 0); });
    items.forEach(function (el, i) {
      var n = Number(el.getAttribute("data-" + key)) || 0;
      el.querySelector(".person-rank").textContent = String(i + 1);
      el.querySelector(".person-val").textContent = el.getAttribute("data-" + key + "-label") || "0";
      el.querySelector(".person-bar i").style.width = max ? (n / max * 100).toFixed(2) + "%" : "0%";
      list.appendChild(el);
    });
  }
})();
</script>`;
}

function pane(title: string, sub: string, metrics: [string, string][]): string {
  const cells = metrics
    .map(
      ([label, value]) =>
        `<div class="metric"><div class="metric-value">${escapeHtml(value)}</div><div class="metric-label">${escapeHtml(label)}</div></div>`,
    )
    .join("");
  return `<section class="stats-pane card">
    <div class="stats-pane-head">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(sub)}</p>
    </div>
    <div class="metrics">${cells}</div>
  </section>`;
}

async function scalar(env: Env, sql: string, ...binds: string[]): Promise<number> {
  const stmt = env.DB.prepare(sql);
  const row = (binds.length ? stmt.bind(...binds) : stmt).first<{ n: number }>();
  return Number((await row)?.n ?? 0);
}
