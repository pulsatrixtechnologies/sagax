// GET /api/bots/:id/inbound-mail (contract C of 2026-10-21): the bot's own
// email address from the Perspicax relay, through the route table on a real
// HTTP server. Visibility is the one path check every client route passes
// (bot-visibility.ts pathSubject); this route answers for the bot it is given.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { BotInboundMail, LocalPartResult } from "../bot-mail-addresses.ts";
import { createBotInboundMailReadRoutes, type BotInboundMailReadDeps } from "./bot-inbound-mail.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
let changes: Array<{ botId: string; sub: string; localPart: string }> = [];
let audits: Array<Record<string, unknown>> = [];
let answerChange: (localPart: string) => LocalPartResult = (localPart) => ({ ok: true, mail: { available: true, address: `${localPart}@bots.example.org`, enabled: false } });
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const MAIL: Record<string, BotInboundMail> = {
  bot_abc: { available: true, address: "cryptic@bots.example.org", enabled: true },
  bot_off: { available: true, address: "ember@bots.example.org", enabled: false },
};

async function serve(deps: Partial<BotInboundMailReadDeps> = {}): Promise<string> {
  const routes = [createBotInboundMailReadRoutes({
    bot: (id) => (id === "bot_abc" || id === "bot_off" || id === "bot_local" ? { id } : null),
    organization: () => true,
    address: async (id) => MAIL[id] ?? { available: false, address: null, enabled: false },
    // the loopback caller owns bot_abc and bot_off, not bot_local
    ownerSub: (_auth, id) => (id === "bot_local" ? null : "u_123"),
    setLocalPart: async (botId, sub, localPart) => {
      changes.push({ botId, sub, localPart });
      return answerChange(localPart);
    },
    record: (_auth, row) => audits.push(row as unknown as Record<string, unknown>),
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("GET /api/bots/:id/inbound-mail", () => {
  it("answers the bot's address and whether the admin turned it off, uncached", async () => {
    const base = await serve();
    const on = await fetch(`${base}/api/bots/bot_abc/inbound-mail`);
    expect(on.status).toBe(200);
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect(await on.json()).toEqual({ available: true, address: "cryptic@bots.example.org", enabled: true, canChange: true });
    expect(await (await fetch(`${base}/api/bots/bot_off/inbound-mail`)).json()).toEqual({ available: true, address: "ember@bots.example.org", enabled: false, canChange: true });
  });

  it("available false on a solo server, without asking Perspicax", async () => {
    let asked = 0;
    const base = await serve({ organization: () => false, address: async () => { asked += 1; return MAIL.bot_abc!; } });
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail`)).json()).toEqual({ available: false, address: null, enabled: false });
    expect(asked).toBe(0);
  });

  it("available false when the read fails", async () => {
    const base = await serve({ address: async () => { throw new Error("down"); } });
    const response = await fetch(`${base}/api/bots/bot_abc/inbound-mail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, address: null, enabled: false, canChange: false });
  });

  it("404 for a bot that is not there; other methods and paths pass", async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/bots/nobody/inbound-mail`)).status).toBe(404);
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail`, { method: "POST" })).json()).toEqual({ from: "inline routes" });
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail/x`)).json()).toEqual({ from: "inline routes" });
  });
});

describe("PUT /api/bots/:id/inbound-mail (v2, JC decision 4): the owner changes the address", () => {
  const put = (base: string, botId: string, body: unknown) => fetch(`${base}/api/bots/${botId}/inbound-mail`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  afterEach(() => {
    changes = [];
    audits = [];
    answerChange = (localPart) => ({ ok: true, mail: { available: true, address: `${localPart}@bots.example.org`, enabled: false } });
  });

  it("sends the owner's Perspicax id and the new local part, answers the new address, writes one audit row", async () => {
    const base = await serve();
    const res = await put(base, "bot_abc", { localPart: "factures" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, address: "factures@bots.example.org", enabled: false, canChange: true });
    expect(changes).toEqual([{ botId: "bot_abc", sub: "u_123", localPart: "factures" }]);
    expect(audits).toEqual([{ botId: "bot_abc", address: "factures@bots.example.org" }]);
  });

  it("403 for anyone but the owner, without asking Perspicax; a viewer who is not the owner sees no Change", async () => {
    const base = await serve();
    const res = await put(base, "bot_local", { localPart: "factures" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_owner" });
    expect(changes).toEqual([]);
    expect(await (await fetch(`${base}/api/bots/bot_local/inbound-mail`)).json()).toMatchObject({ canChange: false });
  });

  it("400 on a malformed local part before Perspicax is asked", async () => {
    const base = await serve();
    for (const localPart of ["", "Factures", "-x", "a b", 7]) {
      const res = await put(base, "bot_abc", { localPart });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid" });
    }
    expect(changes).toEqual([]);
  });

  it.each([
    ["taken", 409],
    ["invalid", 400],
    ["not_owner", 403],
    ["no_bot", 404],
    ["unavailable", 503],
    // Perspicax's own per bot and per owner limit (second review)
    ["rate_limited", 429],
  ] as const)("maps Perspicax's %s to %i with a readable reason, no audit row", async (error, status) => {
    answerChange = () => ({ ok: false, error });
    const base = await serve();
    const res = await put(base, "bot_abc", { localPart: "factures" });
    expect(res.status).toBe(status);
    const body = await res.json() as { error: string; message: unknown };
    expect(body.error).toBe(error);
    expect(typeof body.message).toBe("string");
    expect(audits).toEqual([]);
  });

  it("second review: 5 changes a minute per bot and per owner, then 429 with a reason and Retry-After, without asking Perspicax", async () => {
    let now = 1_000_000;
    const base = await serve({ now: () => now });
    for (let i = 0; i < 5; i++) expect((await put(base, "bot_abc", { localPart: `essai${i}` })).status).toBe(200);
    const limited = await put(base, "bot_abc", { localPart: "essai5" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    const body = await limited.json() as { error: string; message: string };
    expect(body.error).toBe("rate_limited");
    expect(body.message).toMatch(/minute/);
    expect(changes).toHaveLength(5);
    // the same owner's other bot shares the owner's budget
    expect((await put(base, "bot_off", { localPart: "autre" })).status).toBe(429);
    expect(changes).toHaveLength(5);
    // a minute later it works again
    now += 61_000;
    expect((await put(base, "bot_abc", { localPart: "reprise" })).status).toBe(200);
  });

  it("a malformed local part is not counted (Perspicax is never asked)", async () => {
    const base = await serve({ now: () => 5_000 });
    for (let i = 0; i < 8; i++) expect((await put(base, "bot_abc", { localPart: "Mauvais" })).status).toBe(400);
    expect((await put(base, "bot_abc", { localPart: "bon" })).status).toBe(200);
  });

  it("off on a solo server", async () => {
    const base = await serve({ organization: () => false });
    expect((await put(base, "bot_abc", { localPart: "factures" })).status).toBe(404);
  });
});
