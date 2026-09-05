import { describe, expect, it } from "vitest";
import { appFooter, documentShell, instanceFooter } from "../src/chrome";
import { access, assertDomBindings, json, mint, req } from "./helpers";

describe("signed-in pages", () => {
  it("hub HTML renders and its JS only binds existing elements", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control") || "").not.toMatch(/no-store/);
    const html = await res.text();
    expect(html).toContain("Energon");
    expect(html).toContain("Publish a document, prototype, or file.");
    expect(html).toContain('aria-label="Energon"');
    expect(html).toContain("/favicon.svg");
    expect(html).toContain("/f/{id}/");
    expect(html).toContain('"handle":"dev"');
    expect(html).toContain('"content_origin":"https://energon.example.com"');
    expect(html).toContain('"file_bytes":');
    expect(html).toContain('"write_policy":"instance"');
    expect(html).toContain('href="/tokens"');
    expect(html).toContain('href="/setup"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/stats"');
    expect(html).not.toContain("copy-agent-install");
    expect(html).toContain("Load more");
    expect(html).toContain('id="drop-overlay"');
    expect(html).toContain("Drop to stage");
    expect(html).toContain("pointerdown");
    expect(html).toContain("Type the exact name.");
    expect(html).toContain("/account/sites/");
    expect(html).toContain("/account/files/");
    expect(html).toContain('id="stage-password"');
    expect(html).toContain('id="stage-pw-gen"');
    expect(html).toContain('id="pw-dlg"');
    expect(html).toContain('id="pw-words"');
    expect(html).toContain("Generate a readable password");
    expect(html).toContain("Change or remove password");
    expect(html).toContain("only stores a hash");
    expect(html).toContain('id="stage-password" type="text"');
    expect(html).toContain("Leave empty so anyone with the link can open it.");
    expect(html).toContain('id="stage-ttl"');
    expect(html).toContain('id="stage-ttl-note"');
    expect(html).toContain('id="stage-write"');
    expect(html).toContain('id="write-dlg"');
    expect(html).toContain('id="write-dlg-select"');
    expect(html).toContain("function fillWriteSelect");
    expect(html).toContain("Who can write");
    expect(html).toContain("Only the creator");
    expect(html).toContain("Anyone with a token on this host.");
    expect(html).toContain("function fillTtlSelect");
    expect(html).toContain("3 months");
    expect(html).toContain("Never");
    expect(html).toContain("Expiration");
    expect(html).toContain('aria-label="When this expires"');
    expect(html).toContain("You can delete this whenever you want. Expiration is only the automatic stop.");
    expect(html).toContain("Longest allowed is");
    expect(html).not.toContain("This instance defaults to");
    expect(html).not.toContain("Never means keep it until someone deletes it.");
    expect(html).not.toContain('class="app-footer"');
    expect(html).not.toContain('placeholder="Leave empty so anyone with the link can open it"');
    expect(html).toContain('id="pw-dlg-input" type="text"');
    expect(html).toContain("created-by");
    expect(html).toContain("last-writer");
    expect(html).toContain("icon-btn-danger");
    expect(html).toContain("--warn:");
    expect(html).toContain('id="more-dlg"');
    expect(html).toContain("More actions");
    expect(html).toContain("function duplicateItem");
    expect(html).toContain("duplicate_from");
    expect(html).toContain("Duplicate site");
    expect(html).toContain("icon-btn-more");
    expect(html).not.toContain('label: "Open"');
    expect(html).not.toContain("__SCRIPT__");
    expect(html).not.toContain("__FOOTER__");
    expect(html).toContain("function nextNumberedSlug");
    expect(html).toContain("function firstFreeSlug");
    expect(html).toContain("res.status !== 410");
    expect(html).toContain("exists. Using");
    expect(html.indexOf('href="/tokens"')).toBeLessThan(html.indexOf('href="/setup"'));
    expect(html.indexOf('href="/setup"')).toBeLessThan(html.indexOf('href="/about"'));
    assertDomBindings(html);
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

    const tokens = await req("/tokens");
    expect(tokens.status).toBe(200);
    const tokensHtml = await tokens.text();
    expect(tokensHtml).toContain("Create token");
    expect(tokensHtml).toContain("ENERGON_TOKEN");
    expect(tokensHtml).toContain("shown once");
    expect(tokensHtml).not.toContain("Reveal returns the full secret");
    expect(tokensHtml).not.toContain("function reveal(");
    expect(tokensHtml).toContain("boot.token_env");
    expect(tokensHtml).toContain('id="mint-ttl"');
    expect(tokensHtml).toContain('aria-label="Token lifetime"');
    expect(tokensHtml).toContain("<th>Expires</th>");
    expect(tokensHtml).toContain('"Expired"');
    expect(tokensHtml).toContain("row-expired");
    expect(tokensHtml).toMatch(/"token_policy":\{"presets":\[\{"id":"1d"/);
    expect(tokensHtml).toContain('"default":"90d"');
    expect(tokensHtml).toContain('"allow_never":true');
    expect(tokensHtml).toContain("Type the exact label");
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
    expect(aboutHtml).toContain("diagram-proto");
    expect(aboutHtml).toContain("diagram-hand");
    expect(aboutHtml).toContain("diagram-pong");
    expect(aboutHtml).toContain("diagram-live");
    expect(aboutHtml).toContain("diagram-open");
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
    expect(statsHtml).toContain('data-sort="storage"');
    expect(statsHtml).toContain('data-sort="files"');
    expect(statsHtml).toContain('data-sort="sites"');
    expect(statsHtml).toContain("2 KB");
    expect(statsHtml).toContain("1 KB");
    expect(statsHtml).toContain("stats-ada@esperlabs.app");
    expect(statsHtml).toContain("stats-bob@esperlabs.app");
    expect(statsHtml).toContain('class="person you"');
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
