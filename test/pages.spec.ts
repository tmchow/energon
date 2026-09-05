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
    const html = await res.text();
    for (const text of ["Publish a document, prototype, or file.", "Choose files", "Choose folder", "No sites yet", "No files yet", "Drop to stage"]) expect(html).toContain(text);
    for (const id of ["app", "pick-files", "pick-folder", "filepick", "folderpick", "q", "scope", "sort", "sites", "files", "drop-overlay", "pw-dlg", "write-dlg"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-label="Energon"');
    expect(html).toContain('aria-label="Pages"');
    expect(html).toMatch(/class="en-card[^"]*en-card--charged/);
    expect(html).not.toContain("function fillWriteSelect");
    expect(html).not.toContain("__SCRIPT__");
    const boot = bootstrap(html);
    expect(boot.page).toBe("hub");
    expect(boot.data.handle).toBe("dev");
    expect(boot.data.content_origin).toBe("https://energon.example.com");
    expect(boot.data.policy.write_policy).toBe("instance");
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
    for (const label of ["Copy URL", "Set password", "Delete", "More actions", "Download"]) expect(html).toContain(`aria-label="${label}"`);
  });

  it("setup and tokens are signed-in pages with working element bindings", async () => {
    const setup = await req("/setup");
    expect(setup.status).toBe(200);
    const setupHtml = await setup.text();
    expect(setupHtml).toContain("Add Energon to your agent.");
    expect(setupHtml).toContain("ENERGON_TOKEN");
    expect(setupHtml).toContain("tmchow/energon");
    expect(setupHtml).toContain("https://github.com/tmchow/energon");
    expect(setupHtml).toContain("https://agent-plugins.org/");
    expect(setupHtml).toContain("Claude Code");
    expect(setupHtml).toContain("OpenClaw");
    expect(setupHtml).toContain("energon");
    expect(setupHtml).toContain('href="/tokens"');
    expect(setupHtml).toContain('id="agent-install"');
    expect(setupHtml).toContain("Let your agent guide the install");
    expect(setupHtml).toContain("user (global) scope");
    expect(setupHtml).toContain("unless the human asked for that");
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
    assertDomBindings(tokensHtml);
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
    expect(statsHtml).toContain("Largest storage first.");
    expect(statsHtml).toContain("2 KB");
    expect(statsHtml).toContain("1 KB");
    expect(statsHtml).toContain("stats-ada@esperlabs.app");
    expect(statsHtml).toContain("stats-bob@esperlabs.app");
    expect(statsHtml).toContain("en-person--you");
    expect(statsHtml).toContain('aria-label="Rank people by"');
    expect(bootstrap(statsHtml).data.you.bytes).toBe(2048);
    expect(statsHtml).not.toContain("Platform cap");
    expect(statsHtml).not.toContain("20 GB");
    expect(statsHtml).not.toContain('class="app-footer"');
    assertDomBindings(statsHtml);
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
