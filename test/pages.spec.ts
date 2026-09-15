import { describe, expect, it } from "vitest";
import { appFooter, documentShell, fontLinks, instanceFooter, navPrefetchScript } from "../src/chrome";
import { bakedProductVersion } from "../src/product-version";
import { uiPage } from "../src/ui-render";
import type { UpstreamSnapshot } from "../src/page-data";
import { UPSTREAM_DOCS_UPDATE } from "../src/upstream";
import { access, assertDomBindings, json, mint, req } from "./helpers";

describe("signed-in pages", () => {
  it("escapes hydrated data and footers without allowing a script-tag breakout", () => {
    const attack = '</script><script>alert("injected")</script>';
    const html = uiPage("<About>", { page: "about", data: { email: attack }, footer: attack });
    expect(html).toContain("<title>&lt;About&gt;</title>");
    expect(html).not.toContain(attack);
    expect(html).toContain('class="en-footer"');
    expect(bootstrap(html).data.email).toBe(attack);
    expect(bootstrap(html).footer).toBe(attack);
    expect(html.match(/<script\b/g)).toHaveLength(3);
    expect(uiPage("About", { page: "about", data: { email: "dev@example.com" }, footer: "  " })).not.toContain('class="en-footer"');
  });

  it("loads IBM Plex without a render-blocking Google Fonts import", async () => {
    const about = uiPage("About", { page: "about", data: { email: "dev@example.com" } });
    assertNonBlockingFonts(about, { prefetch: true });

    const gate = uiPage("Password — gated", { page: "gate", data: { action: "/x", wrong: false, passwordHeader: "X-Energon-Password" } });
    assertNonBlockingFonts(gate, { prefetch: false });
    expect(gate).not.toContain("<script");

    const markdown = uiPage("notes.md — Energon", { page: "markdown", data: { html: "<h1>Hi</h1>" } });
    assertNonBlockingFonts(markdown, { prefetch: false });

    const html = await (await req("/")).text();
    assertNonBlockingFonts(html, { prefetch: true });
  });

  it("server-renders the hub and supplies hydration data without an inline DOM controller", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    for (const text of ["Publish a document, prototype, or file.", "Choose files", "Choose folder", "Nothing published yet", "Drop to stage"]) expect(html).toContain(text);
    for (const id of ["app", "pick-files", "pick-folder", "filepick", "folderpick", "q", "scope", "kind", "sort", "catalog-filters-toggle", "catalog-filters", "catalog-expires", "catalog-expires-before", "catalog-updated-before", "catalog-min-size", "catalog-cleanup", "catalog-cleanup-action", "catalog-cleanup-run", "catalog-cleanup-ttl", "catalog-cleanup-dlg", "catalog", "drop-overlay", "pw-dlg", "write-dlg", "ttl-dlg"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('id="account-export"');
    expect(html).not.toContain("scan-examples");
    expect(html).not.toContain("Catalog marks");
    expect(html).not.toContain("Set view password");
    expect(html).toContain("Link access");
    expect(html).toContain("Copy a phrase to share the link");
    expect(html).toContain("Turn a password off and save to remove it");
    expect(html).toContain('id="pw-dlg-share-door"');
    expect(html).not.toContain('id="pw-dlg-input"');
    expect(html).not.toContain("Empty a box");
    expect(html).not.toContain("Energon only stores hashes");
    expect(html).not.toContain('id="pw-dlg-share-mode"');
    expect(html).toContain("The new timer starts now, not from when this was published.");
    expect(html).toContain('id="ttl-dlg-select"');
    expect(html).toContain('id="ttl-dlg-ok"');
    expect(html).toContain('for="ttl-dlg-select"');
    expect(html).not.toContain('aria-label="When this expires"');
    expect(html).toContain('id="catalog-status"');
    expect(html).toContain('tabindex="-1" aria-hidden="true"');
    expect(html).toContain("A date, 2026-01-01, or an ISO timestamp.");
    expect(html).toContain("Bytes, or a size like 500kb, 1mb, or 2gb.");
    expect(html).toContain('class="en-seg-pill"');
    expect(html).toContain('aria-label="Expiry filter"');
    expect(html).toContain("Never expires");
    expect(html).not.toContain('id="catalog-last-read"');
    expect(html).not.toContain("Last read before");
    expect(html).not.toContain("Reads lag up to about a day.");
    expect(html).toContain(">Oldest<");
    expect(html).toContain('aria-label="Cleanup action"');
    expect(html).toContain("Set expiry is the safe default");
    expect(html).toContain("Expire soon");
    expect(html).toContain('aria-pressed="false">Delete</button>');
    expect(html).not.toContain("unread");
    expect(html).not.toContain("Unread");
    expect(html).toContain('aria-label="Energon"');
    expect(html).toContain('aria-label="Pages"');
    expect(html).toMatch(/class="en-card[^"]*en-card--charged/);
    expect(html).not.toContain("function fillWriteSelect");
    expect(html).not.toContain("__SCRIPT__");
    const boot = bootstrap(html);
    expect(boot.page).toBe("hub");
    expect(boot.data.handle).toBe("dev");
    expect(boot.data.content_origin).toBe("https://energon.example.com");
    expect(boot.data.policy.write_policy).toBe("org");
    expect(boot.data.policy.default_ttl).toBe("never");
    expect(boot.data.words.length).toBeGreaterThan(100);
    expect(boot.data.query).toMatchObject({ q: "", scope: "involved", sort: "updated" });
    const asset = html.match(/<script type="module" src="([^"]+)"/)![1];
    expect(asset).toMatch(/^\/static\/ui\/app-[a-f0-9]{16}\.js$/);
    const response = await req(asset);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await req(`https://energon.example.com${asset}`)).status).toBe(404);
    expect((await req(asset, { method: "POST" })).status).toBe(405);
    expect(html.indexOf('href="/tokens"')).toBeLessThan(html.indexOf('href="/setup"'));
    expect(html.indexOf('href="/setup"')).toBeLessThan(html.indexOf('href="/about"'));
    expect(html).not.toContain('href="/admin"');
    const adminHub = await (await req("/", { headers: access("admin@esperlabs.app") })).text();
    expect(adminHub).toContain('href="/admin"');
    expect(adminHub).not.toContain('href="/admin#admin-update"');
    expect(adminHub).not.toContain(">Update<");
    expect(adminHub.indexOf('href="/stats"')).toBeLessThan(adminHub.indexOf('href="/admin"'));
  });

  it("shakes the password gate after a wrong phrase", () => {
    const ok = uiPage("Password — gated", { page: "gate", data: { action: "/x", wrong: false, passwordHeader: "X-Energon-Password" } });
    expect(ok).toContain("This link is password-protected.");
    expect(ok).toContain('class="en-card en-gate"');
    expect(ok).not.toContain("en-gate en-shake");
    expect(ok).not.toContain('<script type="module"');
    const html = uiPage("Password — gated", { page: "gate", data: { action: "/x", wrong: true, passwordHeader: "X-Energon-Password" } });
    expect(html).toContain("That password is wrong.");
    expect(html).toContain("en-gate en-shake");
  });

  it("renders public Markdown as the document without app chrome while hub branding stays local", async () => {
    const token = await mint("markdown-brand");
    const file = await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": "brand.md", "content-type": "text/markdown" }, body: "# Brand link" });
    const html = await (await req(file.body.url, { headers: { accept: "text/html" } })).text();
    expect(html).toContain("<h1>Brand link</h1>");
    expect(html).toContain('class="en-md"');
    expect(html).toContain('class="en-md-page"');
    expect(html).toMatch(/color-scheme:\s*light dark/);
    expect(html).toMatch(/en-md-diagram-preview/);
    expect(html).toMatch(/en-md-expand/);
    expect(html).toMatch(/en-md-table-preview/);
    expect(html).not.toMatch(/<a[^>]*class="en-brand"/);
    expect(html).not.toContain('class="en-top');
    expect(html).not.toContain('class="en-card');
    expect(html).not.toContain(">Raw<");
    expect(html).not.toContain("?raw=1");
    expect(html).not.toContain('<script type="module"');
    const shell = uiPage("notes.md — Energon", { page: "markdown", data: { html: "<h1>Hi</h1>" } });
    expect(shell).toContain('class="en-md"');
    expect(shell).toContain('class="en-md-page"');
    expect(shell).not.toMatch(/<a[^>]*class="en-brand"/);
    const hub = await (await req("/")).text();
    expect(hub).toMatch(/<a[^>]*class="en-brand"[^>]*href="\/"/);
  });

  it("renders catalog rows and the next-page control from real account data", async () => {
    const token = await mint("svelte-catalog", "svelte-catalog@esperlabs.app");
    for (const filename of ["svelte-one.md", "svelte-two.md"]) {
      await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": filename, "content-type": "text/markdown" }, body: "# Svelte proof" });
    }
    const html = await (await req("/?q=svelte&sort=name&limit=1", { headers: access("svelte-catalog@esperlabs.app") })).text();
    const boot = bootstrap(html);
    expect(boot.data.items).toHaveLength(1);
    expect(boot.data.items[0]).toMatchObject({ kind: "file", filename: "svelte-one.md" });
    expect(boot.data.total).toBe(2);
    expect(boot.data.cursor).toBeTruthy();
    expect(boot.data.query).toMatchObject({ q: "svelte", sort: "name" });
    expect(html).toContain("svelte-one.md");
    expect(html).toContain("Load more");
    expect(html).toContain(">Expires<");
    expect(html).not.toMatch(/<th[^>]*>Last writer<\/th>/);
    expect(html).not.toMatch(/<th[^>]*>Last read<\/th>/);
    expect(html).toContain('id="catalog-select-visible"');
    expect(html).toContain('id="catalog-select-matching"');
    expect(html).toContain('id="account-export"');
    expect(html).toContain("Download everything you own");
    expect(html).toContain('href="/account/export"');
    expect(html).toContain("Work you only edited is not included");
    expect(html).toContain("Select all matching these filters");
    expect(html).toContain('id="catalog-select-file-');
    expect(html).toContain('aria-label="File"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Select visible");
    expect(html).not.toContain("unread");
    expect(html).not.toMatch(/<th[^>]*>Created by<\/th>/);
    expect(html).not.toMatch(/<span class="en-badge[^"]*">password<\/span>/i);
    for (const label of ["Copy URL", "Delete", "More actions", "Download"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain("Set view password");
    expect(html).not.toContain("Catalog marks");
  });

  it("hydrates never-expires and size sort from the hub URL", async () => {
    const html = await (await req("/?expires=never&sort=size")).text();
    const boot = bootstrap(html);
    expect(boot.data.query).toMatchObject({ sort: "size", expires: { kind: "never" } });
    expect(html).toContain('id="catalog-expires"');
    expect(html).toContain('aria-pressed="true" class="on">Never expires</button>');
    expect(html).toContain('<option value="size" selected="">Size</option>');
  });

  it("catalog password marks appear only when a hash is set", async () => {
    const email = "svelte-marks@esperlabs.app";
    const token = await mint("svelte-marks", email);
    await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": "mark-open.md", "content-type": "text/markdown" }, body: "# open" });
    await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": "mark-view.md", "X-Energon-Set-Password": "view-secret", "content-type": "text/markdown" }, body: "# view" });
    await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": "mark-write.md", "X-Energon-Set-Write-Password": "write-secret", "content-type": "text/markdown" }, body: "# write" });
    const html = await (await req("/?q=mark-&sort=name", { headers: access(email) })).text();
    expect(html).toContain("mark-open.md");
    expect(html).toContain("mark-view.md");
    expect(html).toContain("mark-write.md");
    expect(html).toContain('aria-label="View password"');
    expect(html).toContain('aria-label="Write password"');
    expect(html).not.toContain("Set view password");
    expect(html).not.toContain("scan-examples");
    expect(html).toContain("id=\"pw-dlg\"");
    expect(html).toContain("Link access");
    expect(html).not.toMatch(/<span class="en-badge[^"]*">password<\/span>/i);
  });

  it("setup and tokens are signed-in pages with working element bindings", async () => {
    const setup = await req("/setup");
    expect(setup.status).toBe(200);
    const setupHtml = await setup.text();
    expect(setupHtml).toContain("Add Energon to your agent.");
    expect(setupHtml).toContain("ENERGON_TOKEN");
    expect(setupHtml).toContain("tmchow/energon");
    expect(setupHtml).toContain("https://github.com/tmchow/energon");
    expect(setupHtml).not.toContain("agent-plugins.org");
    expect(setupHtml).toContain("energon");
    expect(setupHtml).toContain('href="/tokens"');
    expect(setupHtml).toContain('id="agent-install"');
    expect(setupHtml).toContain("Install and connect in one step");
    expect(setupHtml).toContain("user (global) scope");
    expect(setupHtml).toContain("connect with a code");
    expect(setupHtml).toContain("/auth.md");
    expect(setupHtml).not.toContain('class="app-footer"');
    expect(setup.headers.get("cache-control")).toMatch(/private/);
    expect(setup.headers.get("cache-control") || "").not.toMatch(/no-store/);
    assertDomBindings(setupHtml);

    const secret = await mint("svelte-token-row", "dev@esperlabs.app");
    const tokens = await req("/tokens");
    expect(tokens.status).toBe(200);
    const tokensHtml = await tokens.text();
    expect(tokensHtml).toContain("Mint token");
    expect(tokensHtml).toContain("ENERGON_TOKEN");
    expect(tokensHtml).toContain("shown once");
    expect(tokensHtml).not.toContain(secret);
    expect(tokensHtml).toContain("svelte-token-row");
    expect(tokensHtml).toMatch(/<th[^>]*>Expires<\/th>/);
    expect(bootstrap(tokensHtml).data.token_env).toBe("ENERGON_TOKEN");
    expect(tokensHtml).not.toContain("Reveal returns the full secret");
    expect(tokensHtml).not.toContain("function reveal(");
    expect(tokensHtml).toContain('id="mint-ttl"');
    expect(tokensHtml).toContain('aria-label="Token lifetime"');
    expect(tokensHtml).toMatch(/"token_policy":\{"presets":\[\{"id":"1d"/);
    expect(tokensHtml).toContain('"default":"90d"');
    expect(tokensHtml).toContain('"allow_never":true');
    expect(tokensHtml).toContain("Type the label to confirm.");
    expect(tokensHtml).toContain('href="/setup"');
    expect(tokensHtml).not.toContain('class="app-footer"');
    expect(tokensHtml).not.toContain("__FOOTER__");
    expect(tokensHtml.indexOf('href="/tokens"')).toBeLessThan(tokensHtml.indexOf('href="/setup"'));
    expect(tokensHtml.indexOf(">Tokens</h2>")).toBeLessThan(tokensHtml.indexOf("Mint a token by hand"));
    expect(tokensHtml).toContain('id="tokens-show"');
    expect(tokensHtml).toContain('aria-label="Show tokens"');
    expect(tokensHtml).toContain('id="revoke-stale"');
    expect(tokensHtml).toContain('id="revoke-all"');
    expect(tokensHtml).toContain("Stale means unused for 30 days.");
    assertDomBindings(tokensHtml);
    const emptyHtml = await (await req("/tokens", { headers: access("notokens@esperlabs.app") })).text();
    expect(emptyHtml).toContain("No live tokens");
    expect(emptyHtml).toContain("Set up your agent and approve its code");

    const adminHtml = await (await req("/tokens", { headers: access("admin@esperlabs.app") })).text();
    expect(adminHtml).toContain('id="mint-scope"');
    expect(adminHtml).toContain('aria-label="Token authority"');
    expect(adminHtml).toContain('href="/admin"');
    expect(bootstrap(adminHtml).data.admin).toBe(true);
    expect(tokensHtml).not.toContain('id="mint-scope"');
    expect(tokensHtml).not.toContain('href="/admin"');
  });

  it("serves the Energon cube mark", async () => {
    const res = await req("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    const svg = await res.text();
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain("energon-glow");
  });

  it("about and stats are signed-in pages with you vs system counts", async () => {
    const about = await req("/about");
    expect(about.status).toBe(200);
    expect(about.headers.get("content-type")).toMatch(/html/);
    const aboutHtml = await about.text();
    expect(aboutHtml).toContain("Links are open by default");
    expect(aboutHtml).toContain("Open a working prototype");
    expect(aboutHtml).toContain("Last write wins");
    expect(aboutHtml).toContain("Read now. Reference later.");
    expect(aboutHtml).toContain("Continue here, or make a copy");
    expect(aboutHtml).toContain("share password");
    expect(aboutHtml).toContain("Why use Energon?");
    expect(aboutHtml).toContain("There is no editor");
    expect(aboutHtml).toContain("Agent-native publishing for documents, prototypes, and working files.");
    expect(aboutHtml).toContain("Want to deploy your own Energon?");
    expect(aboutHtml).toContain("https://github.com/tmchow/energon#deploy-your-own-energon");
    expect(aboutHtml).toContain("does not extend expiration");
    expect(aboutHtml).not.toContain("Anyone with the link can GET it");
    expect(aboutHtml).not.toContain("Why the links are open");
    expect(aboutHtml).not.toContain("PUTs");
    expect(aboutHtml).not.toContain("POST once");
    expect(aboutHtml).not.toContain("needs those bytes");
    expect(aboutHtml).toContain('id="prototype"');
    expect(aboutHtml).toContain('id="handoff"');
    expect(aboutHtml).toContain('id="pong"');
    expect(aboutHtml).toContain('id="living"');
    expect(aboutHtml).toContain('id="public"');
    expect(aboutHtml).not.toContain("flow-cube");
    expect(aboutHtml).toContain('aria-current="page"');
    expect(aboutHtml).not.toContain('class="app-footer"');

    const token = await mint("stats-ada", "stats-ada@esperlabs.app");
    await json("/v1/files", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "X-Filename": "blob.bin", "content-type": "application/octet-stream" },
      body: "x".repeat(2048),
    });
    const bob = await mint("stats-bob", "stats-bob@esperlabs.app");
    await json("/v1/files", {
      method: "POST",
      headers: { authorization: `Bearer ${bob}`, "X-Filename": "tiny.bin", "content-type": "application/octet-stream" },
      body: "y".repeat(1024),
    });
    const stats = await req("/stats", { headers: access("stats-ada@esperlabs.app") });
    expect(stats.status).toBe(200);
    const statsHtml = await stats.text();
    expect(statsHtml).toContain("You");
    expect(statsHtml).toContain("Organization");
    expect(statsHtml).toContain("People");
    expect(statsHtml).toContain("This Energon");
    expect(statsHtml).toContain('id="platform-headroom"');
    expect(statsHtml).toContain("Used against the cap that stops new publishes.");
    expect(statsHtml).toContain("20 GB");
    expect(statsHtml).toContain("Largest storage first.");
    expect(statsHtml).toContain("2 KB");
    expect(statsHtml).toContain("1 KB");
    expect(statsHtml).toContain("stats-ada@esperlabs.app");
    expect(statsHtml).toContain("stats-bob@esperlabs.app");
    expect(statsHtml).toContain("en-person--you");
    expect(statsHtml).toContain('aria-label="Rank people by"');
    expect(statsHtml).toContain('aria-label="Platform storage used"');
    const statsData = bootstrap(statsHtml).data;
    expect(statsData.you.bytes).toBe(2048);
    expect(statsData.platform.limit_bytes).toBe(20 * 1024 * 1024 * 1024);
    expect(statsData.platform.used_bytes).toBeGreaterThanOrEqual(3072);
    expect(statsHtml).not.toContain('class="app-footer"');
    assertDomBindings(statsHtml);
  });

  it("admin cleanup page is only for operators on ADMIN_EMAILS", async () => {
    const refused = await json("/admin", { headers: access("ada@esperlabs.app") });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("forbidden_admin");
    expect(JSON.stringify(refused.body)).not.toContain("admin-preview");

    const page = await req("/admin", { headers: access("admin@esperlabs.app") });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(">Admin</h1>");
    expect(html).toContain("Check this Energon, retire unused work, and revoke tokens.");
    expect(html).toContain('id="admin-health"');
    expect(html).toContain("Quota used is the ledger");
    expect(html).toContain("Expired awaiting purge");
    expect(html).toContain("Stale purge claims");
    expect(html).toContain('id="admin-health-recompute"');
    expect(html).toContain('id="admin-health-sweep"');
    expect(html).toContain('id="admin-health-unlock"');
    expect(html).toContain('id="admin-health-scope"');
    expect(html).toContain("obj:/handle/f/id/");
    expect(html).not.toContain("obj:/handle/f/id/name");
    expect(html).toContain('id="admin-health-recompute-dlg"');
    expect(html).toContain('id="admin-health-sweep-dlg"');
    expect(html).toContain('id="admin-owner"');
    expect(html).toContain('id="admin-q"');
    expect(html).toContain('id="admin-last-read"');
    expect(html).toContain('id="admin-preview"');
    expect(html).toContain('id="admin-audit"');
    expect(html).toContain('id="admin-dlg"');
    expect(html).toContain('id="admin-tokens-owner"');
    expect(html).toContain('id="admin-tokens-list"');
    expect(html).toContain('id="admin-tokens-table"');
    expect(html).toContain('id="admin-revoke-stale"');
    expect(html).toContain('id="admin-revoke-all"');
    expect(html).toContain('id="admin-tokens-dlg"');
    expect(html).toContain("Tokens across accounts");
    expect(html).toContain('aria-label="Cleanup action"');
    expect(html).toContain("The owner sees Expires");
    expect(html).toContain("Set expiry is the safe default");
    expect(html).toContain("Defaults to 7 days.");
    expect(html).toContain("Matches work with no recorded read too.");
    expect(html).not.toContain("Never-read");
    expect(html).not.toContain("set_ttl is the safe default");
    expect(html).not.toContain("Expire soon");
    expect(html).toContain('href="/admin"');
    expect(bootstrap(html).page).toBe("admin");
    expect(bootstrap(html).data.admin).toBe(true);
    expect(bootstrap(html).data.handle).toBe("user-admin");
    expect(bootstrap(html).data.health.quota.limit_bytes).toBe(20 * 1024 * 1024 * 1024);
    expect(bootstrap(html).data.health.quota.used_bytes).toBeGreaterThanOrEqual(0);
    expect(bootstrap(html).data.health.expired_awaiting_purge).toBeGreaterThanOrEqual(0);
    expect(html).toContain(`This Energon · ${bakedProductVersion()}`);
    expect(html).not.toContain('id="admin-update"');
    expect(html).not.toContain('href="/admin#admin-update"');
    expect(html).not.toContain("Could not check for a newer release.");
    expect(bootstrap(html).upstream.status).toBe("current");
    expect(bootstrap(html).upstream.this_version).toBe(bakedProductVersion());
    assertDomBindings(html);
  });

  it("admin update card and nav badge render from an update snapshot", () => {
    const html = uiPage("Admin — Energon", {
      page: "admin",
      data: adminPageData(),
      upstream: updateSnapshot(),
    });
    expect(html).toContain('id="admin-update"');
    expect(html).toContain("1.1.0 is available");
    expect(html).toContain("This Energon is 1.0.0.");
    expect(html).toContain("1.1.0 was released");
    expect(html).not.toContain("Restart after deploy");
    expect(html).not.toContain('id="admin-update-operator"');
    expect(html).toContain('id="admin-update-dismiss"');
    expect(html).toContain("Read the release");
    expect(html).toContain("How to update");
    expect(html).toContain(UPSTREAM_DOCS_UPDATE);
    expect(html).toContain('href="/admin#admin-update"');
    expect(html).toMatch(/Admin[\s\S]*Update/);
    expect(html.indexOf('id="admin-update"')).toBeLessThan(html.indexOf('id="admin-health"'));
    expect(html).toMatch(/id="admin-update"[^>]*class="en-card en-admin-card"/);
    expect(html).not.toMatch(/id="admin-update"[^>]*en-card--charged/);
    expect(html).toContain("This Energon · 1.0.0");
  });

  it("admin failed and unknown checks stay muted without a nav mark", () => {
    const failed = uiPage("Admin — Energon", {
      page: "admin",
      data: adminPageData(),
      upstream: {
        status: "failed",
        this_version: "1.0.0",
        latest_tag: null,
        latest_url: null,
        published_at: null,
        docs_url: UPSTREAM_DOCS_UPDATE,
      },
    });
    expect(failed).toContain('id="admin-update-note"');
    expect(failed).toContain("Could not check for a newer release.");
    expect(failed).not.toContain('id="admin-update"');
    expect(failed).not.toContain('href="/admin#admin-update"');

    const unknown = uiPage("Admin — Energon", {
      page: "admin",
      data: adminPageData(),
      upstream: {
        status: "unknown",
        this_version: null,
        latest_tag: "v1.1.0",
        latest_url: "https://example.test/releases/v1.1.0",
        published_at: null,
        docs_url: UPSTREAM_DOCS_UPDATE,
      },
    });
    expect(unknown).toContain("This build has no version. Latest release is 1.1.0.");
    expect(unknown).not.toContain('href="/admin#admin-update"');
  });

  it("FOOTER_TEXT becomes an escaped chrome footer; empty omits it", () => {
    expect(instanceFooter({})).toBe("");
    expect(instanceFooter({ FOOTER_TEXT: "  " })).toBe("");
    expect(instanceFooter({ FOOTER_TEXT: " Internal cube " })).toBe("Internal cube");
    expect(appFooter("")).toBe("");
    expect(appFooter("  ")).toBe("");

    const html = documentShell({
      title: "About",
      body: "<main class=\"wrap\"></main>",
      footer: "Internal cube <keep it here>.",
    });
    expect(html).toContain('class="app-footer"');
    expect(html).toContain("Internal cube &lt;keep it here&gt;.");
    expect(html).not.toContain("Internal cube <keep it here>.");

    const publicPage = documentShell({
      title: "note.md",
      body: "<main class=\"wrap\"></main>",
    });
    expect(publicPage).not.toContain('class="app-footer"');
  });
});

function bootstrap(html: string) {
  const match = html.match(/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

function assertNonBlockingFonts(html: string, opts: { prefetch: boolean }) {
  expect(html).not.toMatch(/@import[^;]*fonts\.googleapis/);
  expect(html).not.toContain("family=Michroma");
  expect(html).toContain(fontLinks());
  if (opts.prefetch) expect(html).toContain(navPrefetchScript());
  else expect(html).not.toContain(navPrefetchScript());
}

function adminPageData() {
  return {
    email: "admin@esperlabs.app",
    handle: "admin",
    admin: true,
    policy: { presets: [{ id: "7d", label: "7 days" }], default_ttl: "7d", allow_unlimited: false, write_policy: "owner" },
    health: {
      quota: { used_bytes: 0, catalog_bytes: 0, limit_bytes: 1 },
      expired_awaiting_purge: 0,
      stale_purge_claims: 0,
      locked_gates: 0,
      locked_scopes: [],
      sites: 0,
      files: 0,
      people: 0,
    },
  };
}

function updateSnapshot(): UpstreamSnapshot {
  return {
    status: "update",
    this_version: "1.0.0",
    latest_tag: "v1.1.0",
    latest_url: "https://example.test/releases/v1.1.0",
    published_at: "2026-09-14T00:00:00.000Z",
    docs_url: UPSTREAM_DOCS_UPDATE,
  };
}
