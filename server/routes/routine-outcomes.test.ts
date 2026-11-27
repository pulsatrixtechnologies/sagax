// POST /api/routines/outcomes (#4098): body checked, hidden bot 404, needs_run
// 403, and a member who may change the bot's routines arranges its outcomes.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { OutcomeRecord } from "../../shared/outcome-records.ts";
import { createRoutineOutcomeRoutes, type RoutineOutcomeManager, type RoutineOutcomeResultOf } from "./routine-outcomes.ts";
import { dispatchRoutes } from "./table.ts";

type R = { id: string; name: string; outcome?: string; botId: string };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

const member: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s", label: "web", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: "pr_member" } as never,
};

const sample: OutcomeRecord = { id: "o1", name: "Inbox at zero", createdAt: 1, updatedAt: 1 };

function fakeManager() {
  const calls: unknown[][] = [];
  const result = (routines: R[] = []): RoutineOutcomeResultOf<R> => ({ outcomes: [sample], routines });
  const manager: RoutineOutcomeManager<R> = {
    createOutcome: (...args) => { calls.push(["create", ...args]); return result(); },
    renameOutcome: (...args) => { calls.push(["rename", ...args]); return args[1] === "missing" ? null : result(); },
    noteOutcome: (...args) => { calls.push(["note", ...args]); return result(); },
    reorderOutcomes: (...args) => { calls.push(["reorder", ...args]); return result(); },
    moveToOutcome: (...args) => { calls.push(["move", ...args]); return result([{ id: "r1", name: "A", outcome: "o1", botId: "own-bot" }]); },
    deleteOutcome: (...args) => { calls.push(["delete", ...args]); return result(); },
  };
  return { manager, calls };
}

async function serve(access: (botId: string) => "ok" | "hidden" | "needs_run") {
  const fake = fakeManager();
  const routes = [createRoutineOutcomeRoutes<R>({
    access: (_auth, botId) => access(botId),
    manager: () => fake.manager,
    onWire: (routine) => ({ ...routine, wire: true }),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: member, json, readBody })) {
      json(res, 404, { error: "unrouted" });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const post = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/routines/outcomes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { post, calls: fake.calls };
}

describe("POST /api/routines/outcomes", () => {
  it("a member arranges the outcomes of their own bot: every action reaches the store", async () => {
    const { post, calls } = await serve(() => "ok");
    expect((await post({ action: "create", botId: "own-bot", name: "Inbox at zero" })).status).toBe(200);
    expect((await post({ action: "rename", botId: "own-bot", id: "o1", name: "Zero" })).status).toBe(200);
    expect((await post({ action: "note", botId: "own-bot", id: "o1", note: "daily" })).status).toBe(200);
    expect((await post({ action: "note", botId: "own-bot", id: "o1", note: null })).status).toBe(200);
    expect((await post({ action: "reorder", botId: "own-bot", order: ["o1"] })).status).toBe(200);
    const moved = await post({ action: "move", botId: "own-bot", routineIds: ["r1"], outcome: "o1" });
    expect(moved).toEqual({
      status: 200,
      body: { outcomes: [sample], routines: [{ id: "r1", name: "A", outcome: "o1", botId: "own-bot", wire: true }] },
    });
    expect((await post({ action: "move", botId: "own-bot", routineIds: ["r1"], outcome: null })).status).toBe(200);
    expect((await post({ action: "delete", botId: "own-bot", id: "o1" })).status).toBe(200);
    expect(calls.map((call) => call[0])).toEqual(["create", "rename", "note", "note", "reorder", "move", "move", "delete"]);
    expect(calls[6]).toEqual(["move", "own-bot", ["r1"], null]);
  });

  it("a bot the caller cannot see is 404 and one they may not run is 403", async () => {
    const { post, calls } = await serve((botId) => botId === "hidden-bot" ? "hidden" : "needs_run");
    expect((await post({ action: "create", botId: "hidden-bot", name: "X" })).status).toBe(404);
    const refused = await post({ action: "delete", botId: "someone-elses-bot", id: "o1" });
    expect(refused).toEqual({ status: 403, body: { error: "you need the right to run this bot's routines", code: "needs_run" } });
    expect(calls).toEqual([]);
  });

  it("refuses a malformed body and an unknown outcome", async () => {
    const { post } = await serve(() => "ok");
    expect((await post({ action: "explode", botId: "own-bot" })).status).toBe(400);
    expect((await post({ action: "create", botId: "own-bot" })).status).toBe(400);
    expect((await post({ action: "rename", botId: "own-bot", id: "missing", name: "X" })).status).toBe(404);
  });
});
