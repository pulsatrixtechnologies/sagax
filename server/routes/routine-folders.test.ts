// POST /api/routines/folders (server/routes/routine-folders.ts): the body is
// checked, a hidden bot is 404, a bot the caller may not run is 403, and a
// member who may change the bot's routines arranges its folders, no admin.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { RoutineFolderUndo } from "../../shared/routine-folders.ts";
import { createRoutineFolderRoutes, type RoutineFolderManager, type RoutineFolderResultOf } from "./routine-folders.ts";
import { dispatchRoutes } from "./table.ts";

type R = { id: string; name: string; folder?: string; botId: string };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

const member: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s", label: "web", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: "pr_member" } as never,
};

function fakeManager() {
  const calls: unknown[][] = [];
  const result = (routines: R[] = [], undo?: RoutineFolderUndo): RoutineFolderResultOf<R> => ({ folders: ["Reports"], routines, ...(undo ? { undo } : {}) });
  const manager: RoutineFolderManager<R> = {
    createFolder: (...args) => { calls.push(["create", ...args]); return result(); },
    renameFolder: (...args) => { calls.push(["rename", ...args]); return args[1] === "Missing" ? null : result(); },
    deleteFolder: (...args) => { calls.push(["delete", ...args]); return result(); },
    reorderFolders: (...args) => { calls.push(["reorder", ...args]); return result(); },
    moveToFolder: (...args) => { calls.push(["move", ...args]); return result([{ id: "r1", name: "A", folder: "Reports", botId: "own-bot" }]); },
    sortByPrefix: (...args) => { calls.push(["sort", ...args]); return result([], { botId: args[0], folders: [], routines: [{ id: "r1", name: "[Reports] A" }] }); },
    restoreFolders: (...args) => { calls.push(["restore", ...args]); return result(); },
  };
  return { manager, calls };
}

async function serve(access: (botId: string) => "ok" | "hidden" | "needs_run") {
  const fake = fakeManager();
  const routes = [createRoutineFolderRoutes<R>({
    access: (_auth, botId) => access(botId),
    manager: () => fake.manager,
    onWire: (routine) => ({ ...routine, wire: true }),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: member, json, readBody })) json(res, 404, { error: "unrouted" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const post = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/routines/folders`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { post, calls: fake.calls };
}

describe("POST /api/routines/folders", () => {
  it("a member arranges the folders of their own bot: every action reaches the store", async () => {
    const { post, calls } = await serve(() => "ok");
    expect((await post({ action: "create", botId: "own-bot", name: "Reports" })).status).toBe(200);
    expect((await post({ action: "rename", botId: "own-bot", from: "Reports", to: "Briefs" })).status).toBe(200);
    expect((await post({ action: "reorder", botId: "own-bot", order: ["Briefs"] })).status).toBe(200);
    const moved = await post({ action: "move", botId: "own-bot", routineIds: ["r1"], folder: "Reports" });
    expect(moved).toEqual({ status: 200, body: { folders: ["Reports"], routines: [{ id: "r1", name: "A", folder: "Reports", botId: "own-bot", wire: true }] } });
    expect((await post({ action: "move", botId: "own-bot", routineIds: ["r1"], folder: null })).status).toBe(200);
    const sorted = await post({ action: "sort-by-prefix", botId: "own-bot" });
    expect(sorted.body.undo).toEqual({ botId: "own-bot", folders: [], routines: [{ id: "r1", name: "[Reports] A" }] });
    expect((await post({ action: "restore", botId: "own-bot", undo: sorted.body.undo })).status).toBe(200);
    expect((await post({ action: "delete", botId: "own-bot", name: "Briefs" })).status).toBe(200);
    expect(calls.map((call) => call[0])).toEqual(["create", "rename", "reorder", "move", "move", "sort", "restore", "delete"]);
    expect(calls[4]).toEqual(["move", "own-bot", ["r1"], null]);
  });

  it("a bot the caller cannot see is 404 and one they may not run is 403; nothing reaches the store", async () => {
    const { post, calls } = await serve((botId) => botId === "hidden-bot" ? "hidden" : "needs_run");
    expect((await post({ action: "create", botId: "hidden-bot", name: "X" })).status).toBe(404);
    const refused = await post({ action: "sort-by-prefix", botId: "someone-elses-bot" });
    expect(refused).toEqual({ status: 403, body: { error: "you need the right to run this bot's routines", code: "needs_run" } });
    expect(calls).toEqual([]);
  });

  it("refuses a malformed body, an unknown folder and an undo of another bot", async () => {
    const { post } = await serve(() => "ok");
    expect((await post({ action: "explode", botId: "own-bot" })).status).toBe(400);
    expect((await post({ action: "create", botId: "own-bot" })).status).toBe(400);
    expect((await post({ action: "rename", botId: "own-bot", from: "Missing", to: "X" })).status).toBe(404);
    expect((await post({ action: "restore", botId: "own-bot", undo: { botId: "other", folders: [], routines: [] } })).status).toBe(400);
  });
});
