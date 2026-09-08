import { describe, expect, it } from "vitest";
import { appFooter, documentShell, instanceFooter } from "../src/chrome";
import { uiPage } from "../src/ui-render";
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
    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(uiPage("About", { page: "about", data: { email: "dev@example.com" }, footer: "  " })).not.toContain('class="en-footer"');
  });

  it("server-renders the hub and supplies hydration data without an inline DOM controller", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/private/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    for (const text of ["Publish a document, prototype, or file.", "Choose files", "Choose folder", "No sites yet", "No files yet", "Drop to stage"]) expect(html).toContain(text);
    for (const id of ["app", "pick-files", "pick-folder", "filepick", "folderpick", "q", "scope", "sort", "catalog-filters", "catalog-expires", "catalog-expires-before", "catalog-updated-before", "catalog-min-size", "catalog-select-matching", "catalog-cleanup", "catalog-cleanup-action", "catalog-cleanup-preview", "catalog-cleanup-ttl", "catalog-cleanup-dlg", "sites", "files", "account-export", "drop-overlay", "pw-dlg", "write-dlg", "ttl-dlg"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Download what you own");
    expect(html).toContain("Download everything you own");
    expect(html).toContain('href="/account/export"');
    expect(html).toContain("Work you only edited is not included");
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
    expect(html).toContain('aria-label="When this expires"');
    expect(html).toContain('aria-label="Expiry filter"');
    expect(html).toContain("Never expires");
    expect(html).not.toContain('id="catalog-last-read"');
    expect(html).not.toContain("Last read before");
    expect(html).not.toContain("Reads lag up to about a day.");
    expect(html).toContain(">Oldest<");
    expect(html).toContain("Select all matching these filters");
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
    expect(adminHub.indexOf('href="/stats"')).toBeLessThan(adminHub.indexOf('href="/admin"'));
  });

  it("renders catalog rows and the next-page control from real account data", async () => {
    const token = await mint("svelte-catalog", "svelte-catalog@esperlabs.app");
    for (const filename of ["svelte-one.md", "svelte-two.md"]) {
      await json("/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "X-Filename": filename, "content-type": "text/markdown" }, body: "# Svelte proof" });
    }
    const html = await (await req("/?q=svelte&sort=name&limit=1", { headers: access("svelte-catalog@esperlabs.app") })).text();
    const boot = bootstrap(html);
    expect(boot.data.files).toHaveLength(1);
    expect(boot.data.files_total).toBe(2);
    expect(boot.data.files_cursor).toBeTruthy();
    expect(boot.data.query).toMatchObject({ q: "svelte", sort: "name" });
    expect(html).toContain("svelte-one.md");
    expect(html).toContain("Load more");
    expect(html).toContain(">Expires<");
    expect(html).toContain(">Last writer<");
    expect(html).toContain(">Last read<");
    expect(html).toContain("No recorded read");
    expect(html).toContain('id="catalog-select-files"');
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
    expect(html).toContain("Retire old work.");
    expect(html).toContain('id="admin-health"');
    expect(html).toContain("Quota used is the ledger");
    expect(html).toContain("Expired awaiting purge");
    expect(html).toContain("Stale purge claims");
    expect(html).toContain('id="admin-health-recompute"');
    expect(html).toContain('id="admin-health-sweep"');
    expect(html).toContain('id="admin-health-unlock"');
    expect(html).toContain('id="admin-health-scope"');
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
    assertDomBindings(html);
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
