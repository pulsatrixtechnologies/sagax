import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createLiveActivityTokenStore } from "../push/activity-devices.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createPushActivityRoutes } from "./push-activities.ts";
import { dispatchRoutes } from "./table.ts";

const TOKEN = "0123456789abcdef".repeat(4);

describe("/api/push/activities", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-la-routes-"));
    dirs.push(dir);
    const store = createLiveActivityTokenStore(dir);
    const routes = [createPushActivityRoutes({
      person: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      store,
      configured: () => true,
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
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/push/activities`;
    const call = (method: string, who: string | undefined, body?: unknown) =>
      fetch(base, { method, headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
        .then(async (r) => ({ status: r.status, text: await r.text() }));
    return { store, call };
  }

  it("registers an update token for the person and bot, masked, isolated", async () => {
    const { store, call } = await serve();
    const posted = await call("POST", "pr_bob", {
      token: TOKEN.toUpperCase(),
      kind: "update",
      botId: "scout",
      activityId: "act-1",
      environment: "sandbox",
      frequentUpdates: true,
    });
    expect(posted.status).toBe(200);
    expect(posted.text).not.toContain(TOKEN);
    expect(JSON.parse(posted.text)).toMatchObject({
      ok: true,
      configured: true,
      token: { token: "0123****cdef", kind: "update", botId: "scout", environment: "sandbox", frequentUpdates: true },
    });
    expect(store.listForBot("pr_bob", "scout")).toHaveLength(1);
    expect(JSON.parse((await call("GET", "pr_cara")).text).tokens).toEqual([]);
    expect(JSON.parse((await call("DELETE", "pr_cara", { token: TOKEN })).text)).toEqual({ ok: true, removed: false });
    expect(JSON.parse((await call("DELETE", "pr_bob", { token: TOKEN })).text)).toEqual({ ok: true, removed: true });
    expect(store.list("pr_bob")).toEqual([]);
  });

  it("registers a push-to-start token without botId and refuses update without botId", async () => {
    const { store, call } = await serve();
    expect((await call("POST", "pr_bob", { token: TOKEN, kind: "update" })).status).toBe(400);
    const start = await call("POST", "pr_bob", { token: TOKEN, kind: "start" });
    expect(start.status).toBe(200);
    expect(store.list("pr_bob")[0]?.kind).toBe("start");
    expect((await call("POST", undefined, { token: TOKEN, kind: "start" })).status).toBe(403);
  });
});
