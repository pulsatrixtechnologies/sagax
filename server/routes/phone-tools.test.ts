import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createPhoneToolBroker, type PhoneToolBroker } from "../phone-tools.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchInternalRoutes } from "./internal-route.ts";
import { createCardScanKey, openSealedCard, sealCardForTest } from "../../shared/phone-card-seal.ts";
import { createPhoneCardScanRoutes, createPhoneToolInternalRoutes, createPhoneToolRoutes } from "./phone-tools.ts";
import { dispatchRoutes } from "./table.ts";

describe("phone tool routes", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve(options: { turnError?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-phone-routes-"));
    dirs.push(dir);
    const broker: PhoneToolBroker = createPhoneToolBroker({ dataDir: dir, notify: () => {} });
    const routes = [createPhoneToolRoutes({
      broker: () => broker,
      // a phone says who it is with x-who and x-device (the harness reads the
      // session or the companion's vouched device instead)
      // x-transport stands for the connection (the harness reads the socket)
      phone: (req) => {
        const who = req.headers["x-who"];
        const device = req.headers["x-device"];
        const transport = req.headers["x-transport"] === "local" ? "local" as const : "protected" as const;
        return typeof who === "string" && typeof device === "string" ? { person: who, deviceId: device, transport } : null;
      },
      botName: (id) => (id === "bot1" ? "Wren" : undefined),
    })];
    const internal = [createPhoneToolInternalRoutes({
      broker: () => broker,
      turn: () => (options.turnError ? { error: options.turnError } : { person: "ann", botName: "Wren" }),
      waitMs: 200,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/internal/")) {
        const handled = await dispatchInternalRoutes(internal, {
          res, path: url.pathname, method: req.method ?? "GET", json,
          capability: { botId: "bot1", threadId: "t1", generation: "g" },
          readBody: () => readBody(req),
        });
        if (!handled) json(res, 404, { from: "inline" });
        return;
      }
      const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    return { call, broker };
  }

  const ann = { "x-who": "ann", "x-device": "phone-a" };

  it("a phone on plain local Wi-Fi registers, but offers nothing", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/me/phone-tools/device", { tools: ["location"], transport: "local" }, { ...ann, "x-transport": "local" })).body).toEqual({ ok: true, tools: [] });
    // the body cannot claim a protected route the connection is not
    expect((await call("POST", "/api/me/phone-tools/device", { tools: ["location"], transport: "protected" }, { ...ann, "x-transport": "local" })).body).toEqual({ ok: true, tools: [] });
    expect((await call("POST", "/api/internal/phone-tools", { tool: "location" })).body.error).toMatch(/HTTPS or Tailscale/);
  });

  it("refuses phone-tool routes when the session is no longer live (port of upstream 035101e08)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-phone-live-"));
    dirs.push(dir);
    const broker = createPhoneToolBroker({ dataDir: dir, notify: () => {} });
    let live = true;
    const routes = [createPhoneToolRoutes({
      broker: () => broker,
      phone: (req) => {
        const who = req.headers["x-who"];
        const device = req.headers["x-device"];
        return typeof who === "string" && typeof device === "string"
          ? { person: who, deviceId: device, transport: "protected" }
          : null;
      },
      botName: () => "Wren",
      live: () => live,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const auth = { kind: "session", session: { id: "sess-1" }, via: "bearer", scopes: ["admin"] } as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "content-type": "application/json", "x-who": "ann", "x-device": "session:sess-1" };
    expect((await fetch(`${base}/api/me/phone-tools/device`, { method: "POST", headers, body: JSON.stringify({ tools: ["status"] }) })).status).toBe(200);
    live = false;
    expect((await fetch(`${base}/api/me/phone-tools/requests`, { headers })).status).toBe(401);
    expect((await fetch(`${base}/api/me/phone-tools/device`, { method: "POST", headers, body: JSON.stringify({ tools: ["status"] }) })).status).toBe(401);
  });

  it("refuses anything that is not a person's phone", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/me/phone-tools/device", { tools: ["location"] })).status).toBe(403);
    expect((await call("GET", "/api/me/phone-tools/requests")).status).toBe(403);
  });

  it("a phone registers, the bot asks, the phone answers, the turn gets it", async () => {
    const { call } = await serve();
    expect(await call("POST", "/api/me/phone-tools/device", { deviceName: "iPhone", tools: ["location", "status"], transport: "protected" }, ann)).toEqual({ status: 200, body: { ok: true, tools: ["location", "status"] } });

    const asked = call("POST", "/api/internal/phone-tools", { tool: "location", args: { reason: "météo" } });
    // the phone sees it
    let pending = await call("GET", "/api/me/phone-tools/requests", undefined, ann);
    for (let i = 0; i < 20 && !(pending.body.requests as unknown[]).length; i += 1) pending = await call("GET", "/api/me/phone-tools/requests", undefined, ann);
    const [request] = pending.body.requests as Array<{ id: string; tool: string; botName: string; allowAlways: boolean }>;
    expect(request).toMatchObject({ tool: "location", botName: "Wren", allowAlways: true });
    // another person's phone sees nothing
    expect((await call("GET", "/api/me/phone-tools/requests", undefined, { "x-who": "bob", "x-device": "phone-b" })).body.requests).toEqual([]);
    expect((await call("POST", `/api/me/phone-tools/requests/${request!.id}`, { decision: "once", result: { latitude: 45.50169, longitude: -73.56726 } }, ann)).status).toBe(200);
    expect((await asked).body).toEqual({ status: "done", tool: "location", result: { latitude: 45.502, longitude: -73.567, precise: false } });
  });

  it("hands back the request id when the phone is slow, and the bot waits again", async () => {
    const { call } = await serve();
    await call("POST", "/api/me/phone-tools/device", { tools: ["status"], transport: "protected" }, ann);
    const first = await call("POST", "/api/internal/phone-tools", { tool: "status" });
    expect(first.body.status).toBe("pending");
    const requestId = String(first.body.requestId);
    const again = call("POST", "/api/internal/phone-tools", { request_id: requestId });
    await call("POST", `/api/me/phone-tools/requests/${requestId}`, { decision: "deny" }, ann);
    expect((await again).body).toEqual({ status: "denied" });
  });

  it("refuses a tool no phone offers, bad arguments, and a turn that is not the owner's", async () => {
    const { call } = await serve();
    await call("POST", "/api/me/phone-tools/device", { tools: ["status"], transport: "protected" }, ann);
    expect((await call("POST", "/api/internal/phone-tools", { tool: "location" })).status).toBe(409);
    expect((await call("POST", "/api/internal/phone-tools", { tool: "contacts", args: {} })).status).toBe(400);
    const other = await serve({ turnError: "Only the bot's owner, in their own conversation, can use their phone." });
    expect((await other.call("POST", "/api/internal/phone-tools", { tool: "status" })).status).toBe(403);
  });

  it("lists and removes Toujours permettre grants with the bot's name", async () => {
    const { call, broker } = await serve();
    await call("POST", "/api/me/phone-tools/device", { tools: ["status"], transport: "protected" }, ann);
    const request = broker.request({ person: "ann", botId: "bot1", botName: "Wren", threadId: "t1", tool: "status", args: {} });
    await call("POST", `/api/me/phone-tools/requests/${request.id}`, { decision: "always", result: {} }, ann);
    expect((await call("GET", "/api/me/phone-tools/grants", undefined, ann)).body).toEqual({ grants: [{ botId: "bot1", botName: "Wren", tool: "status", access: "read", key: "status:read" }] });
    expect((await call("DELETE", "/api/me/phone-tools/grants", { botId: "bot1", key: "status:read" }, ann)).body).toEqual({ ok: true, removed: true });
    expect((await call("GET", "/api/me/phone-tools/grants", undefined, ann)).body).toEqual({ grants: [] });
  });
});

describe("Scanner avec l'iPhone (row 84)", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-card-scan-"));
    dirs.push(dir);
    const broker = createPhoneToolBroker({ dataDir: dir, notify: () => {} });
    const routes = [
      createPhoneToolRoutes({
        broker: () => broker,
        phone: (req) => (req.headers["x-device"] === "phone-a" ? { person: String(req.headers["x-who"]), deviceId: "phone-a", transport: "protected" as const } : null),
        botName: () => undefined,
      }),
      createPhoneCardScanRoutes({
        broker: () => broker,
        // the computer: x-desktop names the person; a bot's shell has none
        desktop: (req) => (typeof req.headers["x-desktop"] === "string" ? req.headers["x-desktop"] : null),
        waitMs: 200,
      }),
    ];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
  }

  const phone = { "x-who": "ann", "x-device": "phone-a" };
  const desk = { "x-desktop": "ann" };

  it("is offered only when a phone of the person can scan, and only to the person's computer", async () => {
    const call = await serve();
    expect((await call("GET", "/api/me/phone-tools/card-scan", undefined, desk)).body).toEqual({ available: false });
    await call("POST", "/api/me/phone-tools/device", { tools: ["card_scan"], transport: "protected" }, phone);
    expect((await call("GET", "/api/me/phone-tools/card-scan", undefined, desk)).body).toEqual({ available: true });
    expect((await call("POST", "/api/me/phone-tools/card-scan", {})).status).toBe(403);
  });

  it("the server relays only a sealed envelope the form opens; it never holds the number (Owner 2026-10-21)", async () => {
    const call = await serve();
    await call("POST", "/api/me/phone-tools/device", { tools: ["card_scan"], transport: "protected" }, phone);
    // the form's one-time key is required
    expect((await call("POST", "/api/me/phone-tools/card-scan", {}, desk)).status).toBe(400);
    const key = await createCardScanKey();
    const started = await call("POST", "/api/me/phone-tools/card-scan", { publicKey: key.publicKey }, desk);
    const id = String(started.body.requestId);
    expect(started.status).toBe(200);
    const pending = await call("GET", "/api/me/phone-tools/requests", undefined, phone);
    expect(pending.body.requests).toMatchObject([{ id, tool: "card_scan", allowAlways: false, args: { publicKey: key.publicKey } }]);
    expect((await call("POST", `/api/me/phone-tools/card-scan/${id}/wait`, {}, desk)).body).toEqual({ status: "pending", requestId: id });
    // a phone that sends the number in clear is refused
    expect((await call("POST", `/api/me/phone-tools/requests/${id}`, { decision: "once", result: { number: "4111111111111111" } }, phone)).status).toBe(400);
    await call("POST", "/api/me/phone-tools/device", { tools: ["card_scan"], transport: "protected" }, phone);
    const second = String((await call("POST", "/api/me/phone-tools/card-scan", { publicKey: key.publicKey }, desk)).body.requestId);
    const sealed = await sealCardForTest(key.publicKey, second, { number: "4111 1111 1111 1111", expMonth: 9, expYear: 2029, holder: "ANN", cvc: "123" });
    expect((await call("POST", `/api/me/phone-tools/requests/${second}`, { decision: "once", result: sealed }, phone)).status).toBe(200);
    // another person's computer reads nothing
    expect((await call("POST", `/api/me/phone-tools/card-scan/${second}/wait`, {}, { "x-desktop": "bob" })).status).toBe(404);
    const done = await call("POST", `/api/me/phone-tools/card-scan/${second}/wait`, {}, desk);
    expect(done.body).toEqual({ status: "done", sealed });
    expect(JSON.stringify(done.body)).not.toContain("4111");
    await expect(openSealedCard(key, second, done.body.sealed as typeof sealed)).resolves.toEqual({ number: "4111111111111111", expMonth: 9, expYear: 2029, holder: "ANN" });
    // read once
    expect((await call("POST", `/api/me/phone-tools/card-scan/${second}/wait`, {}, desk)).status).toBe(404);
  });

  it("the computer can cancel, and a phone cannot answer Toujours permettre", async () => {
    const call = await serve();
    await call("POST", "/api/me/phone-tools/device", { tools: ["card_scan"], transport: "protected" }, phone);
    const key = await createCardScanKey();
    const first = String((await call("POST", "/api/me/phone-tools/card-scan", { publicKey: key.publicKey }, desk)).body.requestId);
    expect((await call("POST", `/api/me/phone-tools/requests/${first}`, { decision: "always", result: await sealCardForTest(key.publicKey, first, { number: "4111111111111111" }) }, phone)).status).toBe(400);
    expect((await call("DELETE", `/api/me/phone-tools/card-scan/${first}`, undefined, desk)).body).toEqual({ ok: true, cancelled: true });
    expect((await call("GET", "/api/me/phone-tools/requests", undefined, phone)).body.requests).toEqual([]);
  });
});
