import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createRoutineBulkRoutes, planRoutineBulk, routineBulkAnswer } from "./routine-bulk.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const member: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s", label: "web", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: "pr_member" } as never,
};

const routines = [{ id: "r1", botId: "b1" }, { id: "r2", botId: "b1" }, { id: "r3", botId: "b2" }];
const open = { hidden: () => false, needsRun: () => false };

describe("POST /api/routines/bulk (2026-10-29)", () => {
  it("plans the routines named, or all of one bot's", () => {
    expect(planRoutineBulk({ botId: "b1", action: "disable", routineIds: ["r1", "r1"] }, routines, open)).toEqual({ botId: "b1", action: "disable", ids: ["r1"] });
    expect(planRoutineBulk({ botId: "b1", action: "delete", all: true }, routines, open)).toEqual({ botId: "b1", action: "delete", ids: ["r1", "r2"] });
  });

  it("changes nothing for another bot's routine, a hidden bot, or without the right to run it", () => {
    expect(planRoutineBulk({ botId: "b1", action: "enable", routineIds: ["r1", "r3"] }, routines, open)).toMatchObject({ status: 404, error: expect.stringContaining("r3") });
    expect(planRoutineBulk({ botId: "b1", action: "enable", all: true }, routines, { ...open, hidden: () => true })).toMatchObject({ status: 404 });
    expect(planRoutineBulk({ botId: "b1", action: "enable", all: true }, routines, { ...open, needsRun: () => true })).toMatchObject({ status: 403, code: "needs_run" });
    expect(planRoutineBulk({ botId: "b1", action: "pause", all: true }, routines, open)).toMatchObject({ status: 400 });
    expect(planRoutineBulk({ botId: "b1", action: "enable", all: true, routineIds: ["r1"] }, routines, open)).toMatchObject({ status: 400 });
  });

  it("answers what changed and what each refusal said", () => {
    const plan = { botId: "b1", action: "delete" as const, ids: ["r1", "r2"] };
    expect(routineBulkAnswer(plan, [{ id: "r1", status: 200, body: {} }, { id: "r2", status: 403, body: { error: "no" } }]))
      .toEqual({ ok: false, action: "delete", botId: "b1", changed: ["r1"], refused: [{ id: "r2", error: "no" }] });
  });
});

describe("the bulk route", () => {
  it("changes each routine by its own PATCH or DELETE, and relays a row's refusal", async () => {
    const calls: unknown[] = [];
    const routes = [createRoutineBulkRoutes({
      access: (_auth, botId) => botId === "b1" ? "ok" : "hidden",
      routines: () => routines,
      patch: (_auth, _req, id, enabled) => { calls.push(["patch", id, enabled]); return { status: 200, body: {} }; },
      remove: (_auth, id) => { calls.push(["delete", id]); return id === "r2" ? { status: 403, body: { error: "needs run" } } : { status: 200, body: { ok: true } }; },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: member, json, readBody })) json(res, 404, { error: "unrouted" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const post = async (body: unknown) => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/routines/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    expect(await post({ botId: "b1", action: "disable", all: true })).toEqual({ status: 200, body: { ok: true, action: "disable", botId: "b1", changed: ["r1", "r2"] } });
    expect((await post({ botId: "b1", action: "delete", routineIds: ["r1", "r2"] })).body).toMatchObject({ ok: false, changed: ["r1"], refused: [{ id: "r2", error: "needs run" }] });
    expect((await post({ botId: "b2", action: "enable", all: true })).status).toBe(404);
    expect(calls).toEqual([["patch", "r1", false], ["patch", "r2", false], ["delete", "r1"], ["delete", "r2"]]);
  });
});
