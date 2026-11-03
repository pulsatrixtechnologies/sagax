import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { publicPresence } from "../../shared/presence.ts";
import { json, readBody } from "../harness/http.ts";
import { PresenceTracker } from "../presence.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createPresenceRoutes, presenceFrameAllowed, type PresenceViewer } from "./presence.ts";
import { dispatchRoutes } from "./table.ts";

describe("presence routes", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(organization = true) {
    const presence = new PresenceTracker();
    const hidden = new Set<string>(["pr_hid"]);
    const viewer = (auth: RequestAuth): PresenceViewer => {
      const id = (auth as { session?: { principalId?: string } }).session?.principalId;
      if (!id) return { ok: false, code: "session_required" };
      if (id === "pr_robot") return { ok: false, code: "service_account" };
      if (id === "pr_elsewhere") return { ok: false, code: "other_organization" };
      return { ok: true, id, sessionId: `s-${id}` };
    };
    const routes = [createPresenceRoutes({
      organization: () => organization,
      viewer,
      people: () => ["pr_alice", "pr_bob", "pr_hid"],
      view: (id) => presence.view(id),
      hidden: (id) => hidden.has(id),
      heartbeat: (id, sessionId, beat) => presence.heartbeat(id, sessionId, beat),
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, who?: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { ...(who ? { "x-who": who } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as any };
    };
    return { call, presence };
  }

  const beat = { pageId: "page-abcdef01", kind: "web", idleMs: 0 };

  it("lists every active person with their state; a hidden person reads offline, to an admin too", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/presence/heartbeat", "pr_bob", beat)).body).toMatchObject({ state: "online", principalId: "pr_bob" });
    expect((await call("POST", "/api/presence/heartbeat", "pr_hid", beat)).body).toMatchObject({ state: "online", hidden: true });
    const listed = await call("GET", "/api/org/presence", "pr_alice");
    expect(listed.status).toBe(200);
    const byId = Object.fromEntries((listed.body.people as Array<{ principalId: string; lastSeenAt: number | null }>).map((row) => [row.principalId, row]));
    expect(byId.pr_bob).toMatchObject({ state: "online" });
    expect(typeof byId.pr_bob.lastSeenAt).toBe("number");
    expect(byId.pr_hid).toEqual({ principalId: "pr_hid", state: "offline", lastSeenAt: null });
    expect(byId.pr_alice).toEqual({ principalId: "pr_alice", state: "offline", lastSeenAt: null });
  });

  it("a hidden person sees their own real state, marked hidden", async () => {
    const { call } = await serve();
    await call("POST", "/api/presence/heartbeat", "pr_hid", beat);
    const own = (await call("GET", "/api/org/presence", "pr_hid")).body.people.find((row: { principalId: string }) => row.principalId === "pr_hid");
    expect(own).toMatchObject({ state: "online", hidden: true });
  });

  it("nobody outside the organization's people gets anything", async () => {
    const { call } = await serve();
    expect(await call("GET", "/api/org/presence")).toMatchObject({ status: 401, body: { code: "session_required" } });
    expect(await call("GET", "/api/org/presence", "pr_robot")).toMatchObject({ status: 403, body: { code: "service_account" } });
    expect(await call("GET", "/api/org/presence", "pr_elsewhere")).toMatchObject({ status: 403, body: { code: "other_organization" } });
    expect(await call("POST", "/api/presence/heartbeat", "pr_robot", beat)).toMatchObject({ status: 403 });
    expect(await call("POST", "/api/presence/heartbeat", "pr_elsewhere", beat)).toMatchObject({ status: 403 });
    for (const response of [await call("GET", "/api/org/presence", "pr_robot"), await call("GET", "/api/org/presence", "pr_elsewhere")]) {
      expect(response.body.people).toBeUndefined();
    }
  });

  it("a solo server has no presence", async () => {
    const { call } = await serve(false);
    expect(await call("GET", "/api/org/presence", "pr_alice")).toMatchObject({ status: 404, body: { code: "identity_perspicax" } });
    expect((await call("POST", "/api/presence/heartbeat", "pr_alice", beat)).status).toBe(404);
  });

  it("refuses a malformed heartbeat and the wrong method", async () => {
    const { call } = await serve();
    for (const body of [{}, { ...beat, kind: "phone" }, { ...beat, idleMs: -1 }, { ...beat, pageId: "x" }, { ...beat, systemIdle: "asleep" }, { ...beat, extra: 1 }]) {
      expect((await call("POST", "/api/presence/heartbeat", "pr_alice", body)).status).toBe(400);
    }
    expect((await call("POST", "/api/org/presence", "pr_alice", {})).status).toBe(405);
    expect((await call("GET", "/api/presence/heartbeat", "pr_alice")).status).toBe(405);
  });

  it("the desktop's locked screen reads as away to the others", async () => {
    const { call } = await serve();
    await call("POST", "/api/presence/heartbeat", "pr_bob", { ...beat, kind: "desktop", systemIdle: "locked" });
    const bob = (await call("GET", "/api/org/presence", "pr_alice")).body.people.find((row: { principalId: string }) => row.principalId === "pr_bob");
    expect(bob.state).toBe("away");
  });
});

describe("presenceFrameAllowed", () => {
  it("reaches the organization's people only; an addressed frame its person only", () => {
    expect(presenceFrameAllowed({}, { presence: true, viewerId: "pr_a" })).toBe(true);
    expect(presenceFrameAllowed({}, { viewerId: "pr_a" })).toBe(false);
    expect(presenceFrameAllowed({}, { presence: true })).toBe(false);
    expect(presenceFrameAllowed({ audience: "PR_A" }, { presence: true, viewerId: "pr_a" })).toBe(true);
    expect(presenceFrameAllowed({ audience: "pr_b" }, { presence: true, viewerId: "pr_a" })).toBe(false);
    expect(presenceFrameAllowed({ audience: 7 }, { presence: true, viewerId: "pr_a" })).toBe(false);
    expect(publicPresence({ principalId: "pr_a", state: "away", lastSeenAt: 1 }, true).state).toBe("offline");
  });
});
