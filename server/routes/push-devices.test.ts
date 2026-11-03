import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createPushDeviceStore } from "../push/devices.ts";
import { createAndroidPushDeviceStore } from "../push/fcm-devices.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createPushDeviceRoutes } from "./push-devices.ts";
import { dispatchRoutes } from "./table.ts";

const TOKEN = "0123456789abcdef".repeat(4);

describe("/api/push/devices", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve(withAndroid = false) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-push-routes-"));
    dirs.push(dir);
    const store = createPushDeviceStore(dir);
    const android = createAndroidPushDeviceStore(dir);
    const routes = [createPushDeviceRoutes({
      person: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      store,
      ...(withAndroid ? { android: { store: android, configured: () => true } } : {}),
      configured: () => false,
      defaultEnvironment: () => "production",
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/push/devices`;
    const call = (method: string, who: string | undefined, body?: unknown) =>
      fetch(base, { method, headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
        .then(async (r) => ({ status: r.status, text: await r.text() }));
    return { store, android, call };
  }

  it("registers the signed-in person's phone, answers it masked, and removes it", async () => {
    const { store, call } = await serve();
    const posted = await call("POST", "pr_bob", { token: TOKEN.toUpperCase(), platform: "ios", environment: "sandbox", appVersion: "0.4.15 (15)", deviceName: "Bob", settings: { sound: false } });
    expect(posted.status).toBe(200);
    expect(posted.text).not.toContain(TOKEN);
    expect(JSON.parse(posted.text)).toMatchObject({ ok: true, configured: false, device: { token: "0123****cdef", environment: "sandbox", settings: { sound: false, badge: true, nudgeSound: true } } });
    expect(store.list("pr_bob")[0]).toMatchObject({ token: TOKEN, environment: "sandbox", deviceName: "Bob" });
    const listed = await call("GET", "pr_bob");
    expect(listed.text).not.toContain(TOKEN);
    expect(JSON.parse(listed.text).devices).toHaveLength(1);
    // another person neither sees nor removes it
    expect(JSON.parse((await call("GET", "pr_cara")).text).devices).toEqual([]);
    expect(JSON.parse((await call("DELETE", "pr_cara", { token: TOKEN })).text)).toEqual({ ok: true, removed: false });
    expect(JSON.parse((await call("DELETE", "pr_bob", { token: TOKEN })).text)).toEqual({ ok: true, removed: true });
    expect(store.list("pr_bob")).toEqual([]);
  });

  it("uses the server's environment when the phone does not say, and refuses bad input or no person", async () => {
    const { store, call } = await serve();
    expect((await call("POST", "pr_bob", { token: TOKEN, platform: "ios" })).status).toBe(200);
    expect(store.list("pr_bob")[0]!.environment).toBe("production");
    expect((await call("POST", "pr_bob", { token: "not-hex", platform: "ios" })).status).toBe(400);
    expect((await call("POST", "pr_bob", { token: TOKEN, platform: "android" })).status).toBe(400);
    expect((await call("POST", undefined, { token: TOKEN, platform: "ios" })).status).toBe(403);
  });

  it("registers an Android phone's FCM token (2026-10-26), masked, and removes it", async () => {
    const { android, call } = await serve(true);
    const fcm = `fcm:${"x".repeat(150)}`;
    const posted = await call("POST", "pr_bob", { token: fcm, platform: "android", appVersion: "1.0.0", deviceName: "Pixel" });
    expect(posted.status).toBe(200);
    expect(posted.text).not.toContain(fcm);
    expect(android.list("pr_bob")[0]).toMatchObject({ token: fcm, platform: "android" });
    expect(JSON.parse((await call("GET", "pr_bob")).text)).toMatchObject({ androidConfigured: true, devices: [{ platform: "android" }] });
    expect(JSON.parse((await call("DELETE", "pr_bob", { token: fcm })).text)).toEqual({ ok: true, removed: true });
    expect((await call("POST", "pr_bob", { token: "short", platform: "android" })).status).toBe(400);
  });
});
