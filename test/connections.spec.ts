import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { access, assertDomBindings, auth, json, mint, req } from "./helpers";

async function start(label = "test agent", ip = "192.0.2.1") {
  const result = await json("/v1/connections", {
    method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ label }),
  });
  expect(result.status).toBe(201);
  return result.body;
}
function exchange(connection: { id: string; poll_token: string }) {
  return json(`/v1/connections/${connection.id}/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ poll_token: connection.poll_token }),
  });
}
function decide(connection: { id: string; user_code: string }, action = "approve", email = "connect@esperlabs.app", ttl = "1d") {
  return json(`/account/connections/${connection.id}/${action}`, {
    method: "POST", headers: access(email, { "content-type": "application/json" }),
    body: JSON.stringify({ user_code: connection.user_code, ttl }),
  });
}

describe("agent connections", () => {
  it("requires human approval, delivers one account token, and supports ordinary revocation", async () => {
    const connection = await start();
    expect(connection.verification_uri).toBe(`https://hub.energon.example.com/connect?request=${connection.id}`);
    expect(connection.verification_uri).not.toContain(connection.user_code);
    expect(connection).not.toHaveProperty("token");
    const waiting = await exchange(connection);
    expect(waiting.status).toBe(202);
    expect(waiting.body.status).toBe("pending");
    expect((await exchange(connection)).status).toBe(429);
    const approval = await decide(connection);
    expect(approval.status).toBe(200);
    expect(approval.body).not.toHaveProperty("token");
    const issued = await exchange(connection);
    expect(issued.status).toBe(200);
    expect(issued.body.token).toMatch(/^ee_live_/);
    expect(issued.body.expires_at).toBeTruthy();
    const who = await json("/v1/whoami", { headers: auth(issued.body.token) });
    expect(who.status).toBe(200);
    expect(who.body.email).toBe("connect@esperlabs.app");
    expect(who.body.label).toBe("test agent");
    expect(who.body.admin).toBe(false);
    expect(issued.body.token).not.toMatch(/ee_live_adm_/);
    expect((await exchange(connection)).status).toBe(410);
    const list = await json("/account/data", { headers: access("connect@esperlabs.app") });
    expect(JSON.stringify(list.body)).not.toContain(issued.body.token);
    expect(list.body.tokens.some((t: { id: string }) => t.id === issued.body.id)).toBe(true);
    expect((await json(`/account/tokens/${issued.body.id}/revoke`, { method: "POST", headers: access("connect@esperlabs.app") })).status).toBe(200);
    expect((await json("/v1/whoami", { headers: auth(issued.body.token) })).status).toBe(401);
    const row = await env.DB.prepare("SELECT * FROM agent_connections WHERE id = ?").bind(connection.id).first();
    for (const secret of [connection.poll_token, connection.user_code, issued.body.token]) expect(JSON.stringify(row)).not.toContain(secret);
    expect(await mint("manual still works")).toMatch(/^ee_live_/);
  });

  it("binds approval to the human code and rejects foreign-origin or unauthorized decisions", async () => {
    const connection = await start();
    expect((await decide({ ...connection, user_code: "wrong" })).status).toBe(400);
    const foreign = await json(`/account/connections/${connection.id}/approve`, {
      method: "POST", headers: access("connect@esperlabs.app", { origin: "https://other.test", "content-type": "application/json" }),
      body: JSON.stringify({ user_code: connection.user_code }),
    });
    expect(foreign.status).toBe(403);
    expect((await decide(connection, "approve", "outsider@example.net")).status).toBe(403);
    expect((await exchange({ ...connection, poll_token: "wrong" })).status).toBe(401);
    expect((await decide(connection)).status).toBe(200);
    expect((await decide(connection, "approve", "another@esperlabs.app")).status).toBe(409);
    expect((await exchange(connection)).status).toBe(200);
  });

  it("issues exactly one credential when exchanges race", async () => {
    const connection = await start("race agent");
    await decide(connection);
    const results = await Promise.all([exchange(connection), exchange(connection)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 410]);
    const tokens = await env.DB.prepare("SELECT id FROM tokens WHERE label = 'race agent'").all();
    expect(tokens.results).toHaveLength(1);
  });

  it("denial, expiry, and too many code guesses cannot yield a token", async () => {
    const denied = await start();
    expect((await decide(denied, "deny")).status).toBe(200);
    expect((await exchange(denied)).status).toBe(403);
    const deniedBlank = await start("blank deny");
    const blankDeny = await json(`/account/connections/${deniedBlank.id}/deny`, {
      method: "POST",
      headers: access("connect@esperlabs.app", { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(blankDeny.status).toBe(200);
    expect(blankDeny.body.status).toBe("denied");
    expect((await exchange(deniedBlank)).status).toBe(403);
    const expired = await start();
    await env.DB.prepare("UPDATE agent_connections SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", expired.id).run();
    expect((await decide(expired)).status).toBe(410);
    expect((await exchange(expired)).status).toBe(410);
    const guessed = await start();
    for (let i = 0; i < 5; i++) await decide({ ...guessed, user_code: "wrong" });
    expect((await decide(guessed)).status).toBe(403);
    expect((await exchange(guessed)).status).toBe(403);
  });

  it("escapes the requested label and shows account, permissions, lifetime, and code confirmation", async () => {
    const connection = await start('<script>alert("x")</script>');
    const response = await req(`/connect?request=${connection.id}`, { headers: access("connect@esperlabs.app") });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const html = await response.text();
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("connect@esperlabs.app");
    expect(html).toContain("password-protected");
    expect(html).toContain("Approve connection");
    expect(html).toContain("hub.energon.example.com");
    expect(html).not.toContain('aria-label="Pages"');
    expect(html).not.toContain('class="en-footer"');
    expect(html).not.toContain(connection.user_code);
    expect(html).toContain('id="connect-code"');
    expect(html).toContain('maxlength="8"');
    expect(html).toContain("formnovalidate");
    expect(connection.user_code).toMatch(/^[0-9]{8}$/);
    expect(html).not.toContain(connection.poll_token);
    assertDomBindings(html);
    expect((await req(`https://energon.example.com/connect?request=${connection.id}`)).status).toBe(404);
    expect((await req(`https://hub.energon.example.com/connect?request=${connection.id}`)).status).toBe(401);
  });

  it("hydrates only public connection fields without exposing stored or issued secrets", async () => {
    const connection = await start("public connection fields");
    const row = await env.DB.prepare("SELECT label, expires_at, code_hash, poll_hash FROM agent_connections WHERE id = ?")
      .bind(connection.id).first<{ label: string; expires_at: string; code_hash: string; poll_hash: string }>();
    expect(row?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.poll_hash).toMatch(/^[a-f0-9]{64}$/);
    const response = await req(`/connect?request=${connection.id}`, { headers: access("connect@esperlabs.app") });
    expect(response.status).toBe(200);
    const html = await response.text();
    const bootstrap = html.match(/<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
    expect(bootstrap).not.toBeNull();
    expect(JSON.parse(bootstrap![1]).data.connection).toEqual({
      id: connection.id, label: row!.label, expires_at: row!.expires_at,
    });
    for (const secret of [row!.code_hash, row!.poll_hash, connection.user_code, connection.poll_token]) {
      expect(html).not.toContain(secret);
    }
    expect(html).not.toContain("code_hash");
    expect(html).not.toContain("poll_hash");
  });

  it("rolls back token issuance if consuming the approval fails", async () => {
    const connection = await start("rollback agent");
    await decide(connection);
    expect(connection.id).toMatch(/^[A-Za-z0-9]{24}$/);
    await env.DB.exec(`CREATE TRIGGER fail_connection_consume BEFORE UPDATE ON agent_connections WHEN NEW.id = '${connection.id}' AND NEW.status = 'consumed' BEGIN SELECT RAISE(ABORT, 'forced consume failure'); END;`);
    try {
      expect((await exchange(connection)).status).toBe(500);
      expect((await env.DB.prepare("SELECT id FROM tokens WHERE label = 'rollback agent'").all()).results).toHaveLength(0);
      expect((await env.DB.prepare("SELECT status FROM agent_connections WHERE id = ?").bind(connection.id).first())?.status).toBe("approved");
    } finally {
      await env.DB.exec("DROP TRIGGER fail_connection_consume");
    }
    expect((await exchange(connection)).status).toBe(200);
  });

  it("does not issue an approved token after the request expires", async () => {
    const connection = await start("expired approved agent");
    await decide(connection);
    await env.DB.prepare("UPDATE agent_connections SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", connection.id).run();
    expect((await exchange(connection)).status).toBe(410);
    expect((await env.DB.prepare("SELECT id FROM tokens WHERE label = 'expired approved agent'").all()).results).toHaveLength(0);
  });

  it("rejects invalid lifetimes without consuming the approval", async () => {
    const connection = await start();
    expect((await decide(connection, "approve", "connect@esperlabs.app", "100years")).status).toBe(400);
    expect((await exchange(connection)).status).toBe(202);
    expect((await decide(connection)).status).toBe(200);
    expect((await exchange(connection)).status).toBe(200);
  });

  it("rejects oversized streaming requests without requiring Content-Length", async () => {
    const response = await req("/v1/connections", {
      method: "POST", headers: { "content-type": "application/json" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(4097))); controller.close(); } }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "too_large", limit_bytes: 4096 });
  });

  it("bounds unauthenticated connection creation atomically", async () => {
    const results = await Promise.all(Array.from({ length: 22 }, () => json("/v1/connections", {
      method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "192.0.2.99" }, body: '{"label":"limit"}',
    })));
    expect(results.filter(r => r.status === 201)).toHaveLength(20);
    expect(results.filter(r => r.status === 429)).toHaveLength(2);
  });
});
