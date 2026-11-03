// A group's shared memory: one file per group, separate from every bot's
// own workspace, written with the bot memory's entry rules, loaded under the
// same budget, and gone with its group. The HTTP side (owner edits, members
// read, strangers get 404) is covered through the route table below.
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import {
  deleteGroupMemory,
  groupMemoryDoc,
  groupMemoryFile,
  groupMemorySystemPrompt,
  loadGroupMemory,
  readGroupMemory,
  saveGroupMemory,
  updateGroupMemory,
} from "./group-memory.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createGroupMemoryRoutes, type GroupMemoryRouteDeps } from "../routes/group-memory.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { readMemoryFile, updateMemory, workspaceDir } from "../workspace/workspace.ts";

let n = 0;
const fresh = () => `gm-test-${process.pid}-${++n}`;
const NOW = new Date(2026, 9, 1, 12);

describe("group memory storage", () => {
  it("appends dated entries from a room, like a bot's memory, in its own file", () => {
    const id = fresh();
    const result = updateGroupMemory(id, { action: "append", text: "The launch is on Friday" }, { source: 'room "Launch"', now: NOW });
    expect(result.ok).toBe(true);
    expect(readGroupMemory(id)).toBe('- 2026-10-01 · from room "Launch" · The launch is on Friday\n');
    expect(groupMemoryFile(id)).toContain("group-memory");
    expect(groupMemoryFile(id)).not.toContain(workspaceDir("x").replace(/x$/, ""));
  });

  it("never touches a bot's private memory, and a bot's memory never lands here", () => {
    const id = fresh();
    const botId = `bot-${fresh()}`;
    updateMemory(botId, { action: "append", text: "private: the owner's dentist is Tuesday" }, { now: NOW });
    updateGroupMemory(id, { action: "append", text: "shared: staging is down" }, { now: NOW });
    expect(readGroupMemory(id)).not.toContain("dentist");
    expect(readMemoryFile(botId).text).not.toContain("staging");
  });

  it("redacts secrets and refuses replace on a passage that is not there", () => {
    const id = fresh();
    updateGroupMemory(id, { action: "append", text: "api key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, { now: NOW });
    expect(readGroupMemory(id)).not.toContain("sk-ant-api03-AAAA");
    const refused = updateGroupMemory(id, { action: "replace", text: "x", oldText: "nowhere" });
    expect(refused).toMatchObject({ ok: false, code: "conflict" });
  });

  it("saves the owner's edit only against the hash they read", () => {
    const id = fresh();
    const first = saveGroupMemory(id, "- note one\n");
    expect(first.ok).toBe(true);
    const stale = groupMemoryDoc(id).hash;
    updateGroupMemory(id, { action: "append", text: "a bot wrote meanwhile" }, { now: NOW });
    const conflict = saveGroupMemory(id, "- my edit\n", stale);
    expect(conflict).toMatchObject({ ok: false, code: "conflict" });
    expect(readGroupMemory(id)).toContain("a bot wrote meanwhile");
    const ok = saveGroupMemory(id, "- my edit\n", groupMemoryDoc(id).hash);
    expect(ok.ok).toBe(true);
    expect(readGroupMemory(id)).toBe("- my edit\n");
  });

  it("hides expired entries from the prompt and goes away with its group", () => {
    const id = fresh();
    saveGroupMemory(id, "- 2026-09-01 · old trip · until 2026-09-05\n- 2026-09-30 · Standup at 9\n");
    expect(loadGroupMemory(id, NOW)?.text).not.toContain("old trip");
    expect(loadGroupMemory(id, NOW)?.text).toContain("Standup at 9");
    deleteGroupMemory(id);
    expect(existsSync(groupMemoryFile(id))).toBe(false);
    expect(loadGroupMemory(id, NOW)).toBeNull();
  });

  it("loads into a room prompt only when on, with content, and never for dms", () => {
    const id = fresh();
    expect(groupMemorySystemPrompt({ id, name: "Ops" }, { writes: true, now: NOW })).toBe("");
    saveGroupMemory(id, "- 2026-09-30 · Deploys happen after 17h\n");
    const prompt = groupMemorySystemPrompt({ id, name: "Ops" }, { writes: true, now: NOW });
    expect(prompt).toContain('Group memory of "Ops"');
    expect(prompt).toContain("Deploys happen after 17h");
    expect(prompt).toContain("group_memory_update");
    expect(groupMemorySystemPrompt({ id, name: "Ops", memoryEnabled: false }, { writes: true, now: NOW })).toBe("");
    expect(groupMemorySystemPrompt({ id, name: "Ops", dm: true }, { writes: true, now: NOW })).toBe("");
    expect(groupMemorySystemPrompt({ id, name: "Ops", peopleDm: true }, { writes: true, now: NOW })).toBe("");
    expect(groupMemorySystemPrompt({ id, name: "Ops" }, { writes: false, now: NOW })).toContain("cannot change it");
  });
});

describe("group memory routes", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  type Person = "owner" | "member" | "stranger";
  async function serve(groups: Record<string, { id: string; name: string; memoryEnabled?: boolean; peopleDm?: boolean }>) {
    const deps: GroupMemoryRouteDeps = {
      group: (id) => groups[id],
      canRead: (auth) => (auth as { session?: { id: string } }).session?.id !== "stranger",
      isOwner: (auth) => (auth as { session?: { id: string } }).session?.id === "owner",
      setEnabled: (id, enabled) => { groups[id]!.memoryEnabled = enabled; },
    };
    const routes = [createGroupMemoryRoutes(deps)];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = (req.headers["x-who"] as Person | undefined) ?? "owner";
      const auth = { kind: "session", scopes: ["client"], session: { id: who } } as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (method: string, path: string, who: Person, body?: unknown) =>
      fetch(`${base}${path}`, { method, headers: { "x-who": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
  }

  it("lets members read, only the owner write, and strangers see nothing", async () => {
    const id = fresh();
    const call = await serve({ [id]: { id, name: "Ops" } });
    const read = await call("GET", `/api/groups/${id}/memory`, "member");
    expect(read).toMatchObject({ status: 200, body: { enabled: true, canEdit: false, text: "" } });
    expect((await call("PUT", `/api/groups/${id}/memory`, "member", { text: "- hi\n" })).status).toBe(403);
    expect((await call("GET", `/api/groups/${id}/memory`, "stranger")).status).toBe(404);
    const saved = await call("PUT", `/api/groups/${id}/memory`, "owner", { text: "- hi\n", expectedHash: read.body.hash });
    expect(saved).toMatchObject({ status: 200, body: { canEdit: true, text: "- hi\n" } });
    const stale = await call("PUT", `/api/groups/${id}/memory`, "owner", { text: "- again\n", expectedHash: read.body.hash });
    expect(stale).toMatchObject({ status: 409, body: { code: "conflict", current: "- hi\n" } });
  });

  it("switches the group memory off for the owner and has none in a person-to-person dm", async () => {
    const id = fresh();
    const dm = fresh();
    const call = await serve({ [id]: { id, name: "Ops" }, [dm]: { id: dm, name: "", peopleDm: true } });
    expect(await call("PUT", `/api/groups/${id}/memory`, "owner", { enabled: false })).toMatchObject({ status: 200, body: { enabled: false } });
    expect((await call("PUT", `/api/groups/${id}/memory`, "owner", {})).status).toBe(400);
    expect((await call("GET", `/api/groups/${dm}/memory`, "owner")).status).toBe(404);
  });
});

describe("group_memory_update in the agents catalog", () => {
  it("is offered only to a room turn whose group memory is on", async () => {
    const { availableTools, catalogProfileFromEnv } = await import("../drivers/agents-catalog.ts");
    const names = (env: NodeJS.ProcessEnv) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", SAGAX_ROOM_TURN: "1", ...env })).map((tool) => tool.name);
    expect(names({ SAGAX_GROUP_MEMORY: "1" })).toContain("group_memory_update");
    expect(names({})).not.toContain("group_memory_update");
    expect(names({ SAGAX_GROUP_MEMORY: "0" })).not.toContain("group_memory_update");
  });
});
