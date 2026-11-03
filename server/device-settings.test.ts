import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { createDeviceSettingsBroker } from "./device-settings.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { createDeviceSettingRoutes } from "./routes/device-settings.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { deviceSettingsFrameAllowed } from "../shared/device-settings.ts";
import { decideBotAct } from "../shared/bot-act.ts";

describe("device settings broker (#1545)", () => {
  it("answers no-app at once when the person has no open app", async () => {
    const notified: string[] = [];
    const broker = createDeviceSettingsBroker({ notify: (p) => notified.push(p), openApps: () => 0 });
    expect(await broker.ask("ann", { op: "get", key: "device.openAtLogin", botName: "Wren" })).toEqual({ status: "no-app" });
    expect(notified).toEqual([]);
    expect(broker.size()).toBe(0);
  });

  it("takes the first app that holds it, and only the person's own answer", async () => {
    const broker = createDeviceSettingsBroker({ notify: () => {}, openApps: () => 2, newId: () => "r1" });
    const asked = broker.ask("ann", { op: "set", key: "device.openAtLogin", value: "on", botName: "Wren" }, 1_000);
    expect(broker.pendingFor("ann", "a")).toMatchObject([{ id: "r1", op: "set", key: "device.openAtLogin", value: "on", botName: "Wren" }]);
    // someone else sees nothing and cannot answer
    expect(broker.pendingFor("bob", "b")).toEqual([]);
    expect(broker.answer("bob", "b", "r1", { device: "desktop", value: "off" })).toMatchObject({ ok: false, status: 404 });
    // an iPhone that does not keep it, then the desktop that does
    expect(broker.answer("ann", "phone", "r1", { device: "ios", unsupported: true })).toEqual({ ok: true });
    expect(broker.pendingFor("ann", "phone")).toEqual([]);
    expect(broker.answer("ann", "desk", "r1", { device: "desktop", value: "on" })).toEqual({ ok: true });
    expect(await asked).toEqual({ status: "done", device: "desktop", value: "on" });
    expect(broker.size()).toBe(0);
  });

  it("says unsupported once every open app said so, failed with the app's reason, timeout otherwise", async () => {
    let id = 0;
    const broker = createDeviceSettingsBroker({ notify: () => {}, openApps: () => 1, newId: () => `r${++id}` });
    const none = broker.ask("ann", { op: "get", key: "device.haptics", botName: "Wren" }, 1_000);
    broker.answer("ann", "desk", "r1", { device: "desktop", unsupported: true });
    expect(await none).toEqual({ status: "unsupported" });
    const failed = broker.ask("ann", { op: "set", key: "device.microphone", value: "x", botName: "Wren" }, 1_000);
    broker.answer("ann", "desk", "r2", { device: "desktop", error: "No such microphone." });
    expect(await failed).toEqual({ status: "failed", device: "desktop", error: "No such microphone." });
    expect(await broker.ask("ann", { op: "get", key: "device.openAtLogin", botName: "Wren" }, 20)).toEqual({ status: "timeout" });
    expect(broker.size()).toBe(0);
  });

  it("frames reach the person's own streams only", () => {
    expect(deviceSettingsFrameAllowed({ kind: "device-settings", audience: "ann" }, "ann", "op")).toBe(true);
    expect(deviceSettingsFrameAllowed({ kind: "device-settings", audience: "ann" }, "bob", "op")).toBe(false);
    expect(deviceSettingsFrameAllowed({ kind: "device-settings", audience: "op" }, undefined, "op")).toBe(true);
  });

  it("is never a bot's own act call", () => {
    for (const path of ["/api/me/device-settings/apply", "/api/me/device-settings/requests", "/api/me/device-settings/requests/r1"]) {
      const decided = decideBotAct({ raw: { method: "POST", path, body: {} }, mode: "full", scopes: ["admin", "client"], neededScope: () => "client" });
      expect(decided, path).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/sagax_settings/) });
    }
  });
});

describe("device settings routes (#1545)", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(openApps = 1, saveSynced?: (person: string, key: string, value: string) => boolean) {
    const broker = createDeviceSettingsBroker({ notify: () => {}, openApps: () => openApps, newId: () => "r1" });
    const routes = [createDeviceSettingRoutes({
      broker: () => broker,
      // x-who is the person; x-agent stands for a bot's act replay
      app: (req) => typeof req.headers["x-who"] === "string" && !req.headers["x-agent"] ? { person: req.headers["x-who"], appId: String(req.headers["x-app"] ?? "a") } : null,
      person: () => "ann",
      isKey: (key) => key.startsWith("device.") || key === "omb-skin",
      ...(saveSynced ? { saveSynced } : {}),
      waitMs: 1_000,
    })];
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

  it("a round trip: the bot's read waits for the person's app", async () => {
    const call = await serve();
    const asked = call("POST", "/api/me/device-settings/apply", { op: "get", key: "device.openAtLogin", botName: "Wren" });
    let waiting: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      waiting = (await call("GET", "/api/me/device-settings/requests", undefined, { "x-who": "ann" })).body;
      if ((waiting.requests as unknown[]).length) break;
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(waiting.requests).toMatchObject([{ id: "r1", op: "get", key: "device.openAtLogin" }]);
    // a bot cannot answer in the person's place
    expect((await call("POST", "/api/me/device-settings/requests/r1", { device: "desktop", value: "on" }, { "x-who": "ann", "x-agent": "1" })).status).toBe(403);
    expect((await call("POST", "/api/me/device-settings/requests/r1", { device: "desktop", value: "off" }, { "x-who": "ann" })).body).toEqual({ ok: true });
    expect((await asked).body).toEqual({ key: "device.openAtLogin", value: "off", device: "desktop" });
  });

  it("no app open: a clear answer, or the synced preference saved for the person", async () => {
    const closed = await serve(0);
    expect(await closed("POST", "/api/me/device-settings/apply", { op: "set", key: "device.openAtLogin", value: "on" })).toMatchObject({ status: 409, body: { code: "no_app", error: expect.stringMatching(/No Sagax app/) } });
    const saved: string[] = [];
    const synced = await serve(0, (person, key, value) => { saved.push(`${person} ${key} ${value}`); return true; });
    expect((await synced("POST", "/api/me/device-settings/apply", { op: "set", key: "omb-skin", value: "night" })).body).toEqual({ key: "omb-skin", value: "night", device: "server" });
    expect(saved).toEqual(["ann omb-skin night"]);
    // never a key the channel does not carry
    expect((await synced("POST", "/api/me/device-settings/apply", { op: "get", key: "credentials" })).status).toBe(400);
  });
});
