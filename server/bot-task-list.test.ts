import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBotTaskStore } from "./bot-task-list.ts";
import { botTasksFrameAllowed, sameBotTaskOwner, type BotTasksFrame } from "../shared/bot-task-list.ts";
import { createBotTaskInternalRoutes, createBotTaskRoutes } from "./routes/bot-task-list.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-"));
  dirs.push(dir);
  return createBotTaskStore({ file: join(dir, "bot-tasks.json"), now: () => 1_700_000_000_000 });
}

describe("bot task store", () => {
  it("lets the bot add, advance and finish, and only a reopen brings it back", () => {
    const tasks = store();
    const added = tasks.add("bot-1", { title: "Relire" }, "pr_a");
    if (!added.ok) throw new Error(added.error);
    expect(added.task.state).toBe("doing");
    expect(tasks.move("bot-1", added.task.id, "reopen", "pr_a").ok).toBe(false);
    const waiting = tasks.move("bot-1", added.task.id, "advance", "pr_a");
    if (!waiting.ok) throw new Error(waiting.error);
    expect(waiting.task.state).toBe("waiting");
    expect(tasks.move("bot-1", added.task.id, "advance", "pr_a")).toMatchObject({ ok: false, code: "cannot_advance" });
    const done = tasks.move("bot-1", added.task.id, "complete", "pr_a");
    if (!done.ok) throw new Error(done.error);
    expect(done.task.state).toBe("done");
    const again = tasks.move("bot-1", added.task.id, "complete", "pr_a");
    if (!again.ok) throw new Error(again.error);
    expect(again.task.state).toBe("done");
    const open = tasks.move("bot-1", added.task.id, "reopen", "pr_a");
    if (!open.ok) throw new Error(open.error);
    expect(open.task.state).toBe("doing");
    expect(tasks.move("bot-1", added.task.id, "complete", "pr_b")).toMatchObject({ ok: false, code: "not_found" });
    expect(tasks.add("bot-1", { title: "x", state: "done" })).toMatchObject({ ok: true, task: { state: "done" } });
    expect(tasks.add("bot-1", { title: "x", state: "later" })).toMatchObject({ ok: false, code: "bad_task" });
  });
});

function request(path: string, method: string) {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = {};
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let resolve!: (value: { status: number; body: string }) => void;
  const done = new Promise<{ status: number; body: string }>((r) => { resolve = r; });
  res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof res.write;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string));
    resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
    return res;
  }) as typeof res.end;
  return { req, res, done };
}

const auth = (id: string): RequestAuth => ({ kind: "session", via: "cookie", scopes: ["client"], session: { id: "s", principalId: id } as never });

describe("bot task routes", () => {
  it("the person reopens, and the bot cannot", async () => {
    const tasks = store();
    const added = tasks.add("bot-1", { title: "Choisir", state: "waiting" }, "pr_a");
    if (!added.ok) throw new Error(added.error);
    tasks.move("bot-1", added.task.id, "complete", "pr_a");
    const person = createBotTaskRoutes({
      tasks: () => tasks,
      mayUseBot: () => true,
      owner: (who) => who.kind === "session" ? who.session.principalId : undefined,
      mayView: (_who, task) => task.ownerId === "pr_a",
    });
    const { req, res, done } = request(`/api/bots/bot-1/task-list/${added.task.id}/reopen`, "POST");
    process.nextTick(() => req.push(null));
    await person({ req, res, url: new URL(`http://x${req.url}`), path: req.url!, method: "POST", auth: auth("pr_a"), json, readBody });
    const answer = JSON.parse((await done).body) as { task: { state: string } };
    expect(answer.task.state).toBe("doing");

    const internal = createBotTaskInternalRoutes({ tasks: () => tasks, ownsThread: () => true, speaker: () => "pr_a" });
    tasks.move("bot-1", added.task.id, "complete", "pr_a");
    const refused = request("/api/internal/task-list", "POST");
    process.nextTick(() => { refused.req.push(JSON.stringify({ action: "reopen", task_id: added.task.id })); refused.req.push(null); });
    const ires = new ServerResponse(refused.req);
    const chunks: Buffer[] = [];
    let resolve!: (value: { status: number; body: string }) => void;
    const idone = new Promise<{ status: number; body: string }>((r) => { resolve = r; });
    ires.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof ires.write;
    ires.end = ((chunk?: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); resolve({ status: ires.statusCode, body: Buffer.concat(chunks).toString("utf8") }); return ires; }) as typeof ires.end;
    await internal({
      res: ires, path: "/api/internal/task-list", method: "POST", json,
      readBody: async () => ({ action: "reopen", task_id: added.task.id }),
      capability: { botId: "bot-1", threadId: "t1", generation: "g" },
    });
    expect(JSON.parse((await idone).body)).toMatchObject({ code: "bad_action" });
    expect(tasks.list("bot-1")[0]?.state).toBe("done");
  });

  // 2026-10-28: the panel's first read on a server with no task yet. No file,
  // or a file that does not parse, is an empty list (200), never an error.
  it("answers an empty list when bot-tasks.json is missing or unreadable", async () => {
    for (const content of [null, "{not json", "[]", JSON.stringify({ tasks: "nope" })]) {
      const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-"));
      dirs.push(dir);
      const file = join(dir, "bot-tasks.json");
      if (content !== null) writeFileSync(file, content);
      const routes = createBotTaskRoutes({
        tasks: () => createBotTaskStore({ file }),
        mayUseBot: () => true,
        owner: () => "pr_a",
        mayView: () => true,
      });
      const { req, res, done } = request("/api/bots/bot-1/task-list", "GET");
      await routes({ req, res, url: new URL(`http://x${req.url}`), path: req.url!, method: "GET", auth: auth("pr_a"), json, readBody });
      const answer = await done;
      expect(answer.status, String(content)).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({ tasks: [] });
    }
  });
});

// Regression: the bot's tool and the panel are one list with one owner rule.
// The turn's speaker is stored lowercased; the panel's viewer is compared
// the same way, and each change sends a frame for that person only.
describe("one task list for the bot's tool and the panel", () => {
  it("the panel's read shows what the bot added, and each change sends that person a frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-"));
    dirs.push(dir);
    const frames: BotTasksFrame[] = [];
    const tasks = createBotTaskStore({ file: join(dir, "bot-tasks.json"), onChange: (frame) => frames.push(frame) });
    const internal = createBotTaskInternalRoutes({ tasks: () => tasks, ownsThread: () => true, speaker: () => "pr_abc" });
    let added: { task: { id: string; threadId?: string } } | undefined;
    await internal({
      res: {} as never, path: "/api/internal/task-list", method: "POST",
      json: ((_res: unknown, _status: number, value: unknown) => { added = value as typeof added; }) as never,
      readBody: async () => ({ action: "add", title: "Pick a meeting time", state: "waiting" }),
      capability: { botId: "bot-1", threadId: "t-9", generation: "g" },
    });
    expect(added?.task.threadId).toBe("t-9");
    expect(frames).toEqual([{ kind: "bot.tasks", botId: "bot-1", audience: "pr_abc" }]);

    const panel = createBotTaskRoutes({
      tasks: () => tasks,
      mayUseBot: () => true,
      owner: (who) => who.kind === "session" ? who.session.principalId : undefined,
      mayView: (who, task) => sameBotTaskOwner(task.ownerId, who.kind === "session" ? who.session.principalId : undefined),
    });
    const { req, res, done } = request("/api/bots/bot-1/task-list", "GET");
    await panel({ req, res, url: new URL(`http://x${req.url}`), path: req.url!, method: "GET", auth: auth("PR_ABC"), json, readBody });
    expect((JSON.parse((await done).body) as { tasks: Array<{ title: string }> }).tasks.map((task) => task.title)).toEqual(["Pick a meeting time"]);

    expect(botTasksFrameAllowed(frames[0]!, "pr_abc", "pr_local")).toBe(true);
    expect(botTasksFrameAllowed(frames[0]!, "pr_other", "pr_local")).toBe(false);
    expect(botTasksFrameAllowed(frames[0]!, undefined, "pr_abc")).toBe(true);
  });
});

// Regression: the bot recorded a finished task and named tasks by title;
// the panel must show the state the server holds, with its history, and the
// person moves and removes tasks from the panel.
describe("bot tool states and person moves", () => {
  async function tool(internal: ReturnType<typeof createBotTaskInternalRoutes>, body: Record<string, unknown>) {
    let status = 0;
    let answer: unknown;
    await internal({
      res: {} as never, path: "/api/internal/task-list", method: "POST",
      json: ((_res: unknown, code: number, value: unknown) => { status = code; answer = value; }) as never,
      readBody: async () => body,
      capability: { botId: "bot-1", threadId: "t-1", generation: "g" },
    });
    return { status, body: answer as { task?: { id: string; state: string; note?: string; history?: Array<{ state: string; by: string }> }; code?: string } };
  }

  it("keeps the state the bot set, by id or by title, with a note and the history", async () => {
    let clock = 1_000;
    const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-"));
    dirs.push(dir);
    const tasks = createBotTaskStore({ file: join(dir, "bot-tasks.json"), now: () => clock++ });
    const internal = createBotTaskInternalRoutes({ tasks: () => tasks, ownsThread: () => true, speaker: () => "pr_a" });
    expect((await tool(internal, { action: "add", title: "Demo task", state: "done" })).body.task?.state).toBe("done");
    await tool(internal, { action: "add", title: "Pick a time" });
    const byTitle = await tool(internal, { action: "complete", title: "pick a time" });
    expect(byTitle.body.task?.state).toBe("done");
    expect(byTitle.body.task?.history?.map((event) => `${event.state}/${event.by}`)).toEqual(["doing/bot", "done/bot"]);
    const noted = await tool(internal, { action: "note", title: "Demo task", note: "Checked twice." });
    expect(noted.body.task?.note).toBe("Checked twice.");
    expect((await tool(internal, { action: "complete", title: "nothing like it" })).body.code).toBe("not_found");
    expect((await tool(internal, { action: "reopen", title: "Demo task" })).body.code).toBe("bad_action");
    // reloaded from disk: the same states
    const again = createBotTaskStore({ file: join(dir, "bot-tasks.json") });
    expect(again.list("bot-1").map((task) => `${task.title}:${task.state}`).sort()).toEqual(["Demo task:done", "Pick a time:done"]);
  });

  it("lets the person resume, reopen and remove from the panel, and records who did it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-tasks-"));
    dirs.push(dir);
    const tasks = createBotTaskStore({ file: join(dir, "bot-tasks.json") });
    const added = tasks.add("bot-1", { title: "Choose", state: "waiting" }, "pr_a");
    if (!added.ok) throw new Error(added.error);
    const panel = createBotTaskRoutes({
      tasks: () => tasks,
      mayUseBot: () => true,
      owner: (who) => who.kind === "session" ? who.session.principalId : undefined,
      mayView: (who, task) => sameBotTaskOwner(task.ownerId, who.kind === "session" ? who.session.principalId : undefined),
    });
    const call = async (path: string, method: string) => {
      const { req, res, done } = request(path, method);
      process.nextTick(() => req.push(null));
      await panel({ req, res, url: new URL(`http://x${path}`), path, method, auth: auth("pr_a"), json, readBody });
      const answer = await done;
      return { status: answer.status, body: JSON.parse(answer.body) as { task?: { state: string; history?: Array<{ by: string }> }; removed?: boolean } };
    };
    const base = `/api/bots/bot-1/task-list/${added.task.id}`;
    expect((await call(`${base}/resume`, "POST")).body.task?.state).toBe("doing");
    expect((await call(`${base}/resume`, "POST")).status).toBe(409);
    const done = await call(`${base}/complete`, "POST");
    expect(done.body.task?.state).toBe("done");
    expect(done.body.task?.history?.at(-1)?.by).toBe("person");
    expect((await call(`${base}/reopen`, "POST")).body.task?.state).toBe("doing");
    expect((await call(base, "DELETE")).body.removed).toBe(true);
    expect(tasks.list("bot-1")).toEqual([]);
    expect((await call(base, "DELETE")).status).toBe(404);
  });
});
