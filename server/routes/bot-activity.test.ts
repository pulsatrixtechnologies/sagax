// The bot panel's activity list (GET /api/bots/:id/activity) and one
// entry's detail, through the route table: a person lists and opens only
// their own threads, sees a routine run only when routineSeenBy says so
// (without its private thread), and a sub-agent on someone else's thread
// shows no request text.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../auth/request-auth.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import type { BotActivityDetail, BotActivityItem } from "../../shared/bot-activity.ts";
import { createBotActivityReader, createBotActivityRoutes, stepError, STEP_ERROR_CHARS, type ActivityMessage, type ActivityTask, type BotActivityRouteDeps } from "./bot-activity.ts";
import { dispatchRoutes } from "./table.ts";
import { commandSummary, toolDetailPreview } from "../tools/tool-summary.ts";

const NOW = 1_800_000_000_000;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const tasks: ActivityTask[] = [
  { threadId: "t-alice", title: "Refactor the parser", createdAt: NOW - 60_000, updatedAt: NOW - 1_000, busy: true, activity: "working", turnStartedAt: NOW - 30_000, ownerPrincipalId: "alice" },
  { threadId: "t-bob", title: "Bob's secret plan", createdAt: NOW - 120_000, updatedAt: NOW - 5_000, ownerPrincipalId: "bob" },
  { threadId: "t-routine", title: "Nightly dispatch", createdAt: NOW - 600_000, updatedAt: NOW - 500_000, routineRunId: "run-1", ownerPrincipalId: "alice" },
  { threadId: "t-old", title: "Last month", createdAt: NOW - 40 * 86_400_000, updatedAt: NOW - 40 * 86_400_000, ownerPrincipalId: "alice" },
];
const runs = [
  { id: "run-1", routineId: "r1", routineName: "Nightly dispatch", botId: "pepper", status: "completed", target: "bot", runOn: "auto", scheduledFor: NOW - 600_000, startedAt: NOW - 600_000, finishedAt: NOW - 500_000, manual: false, createdAt: NOW - 600_000, threadId: "t-routine" },
] as unknown as RoutineRun[];
const messages: Record<string, ActivityMessage[]> = {
  "t-alice": [
    { id: "u1", role: "user", kind: "text", at: NOW - 30_000, text: "go" },
    { id: "a1", role: "bot", kind: "activity", at: NOW - 20_000, tool: { name: "mcp__sagax-desktop__shell", ok: true, summary: "ls", files: ["src/a.ts"] } },
    { id: "a2", role: "bot", kind: "activity", at: NOW - 10_000, tool: { name: "Edit", files: ["src/b.ts"] } },
    { id: "d1", role: "bot", kind: "digest", at: NOW - 9_000, digest: { access: { via: "subscription", payer: "speaker" } } },
  ],
  "t-bob": [
    { id: "u2", role: "user", kind: "text", at: NOW - 6_000 },
    { id: "b2", role: "bot", kind: "text", at: NOW - 5_000, turnSucceeded: false },
  ],
};

/** Threads are their owner's; routine runs: alice's (the bot owner), or
 * anyone holding run (carol). */
function deps(overrides: Partial<BotActivityRouteDeps> = {}): BotActivityRouteDeps {
  return {
    bot: (id) => (id === "pepper" ? { id, name: "Pepper", modelSelection: { instanceId: "claude", model: "sonnet" } } : id === "echo" ? { id, name: "Echo" } : null),
    tasks: (botId) => (botId === "pepper" ? tasks : []),
    viewerId: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
    threadReadable: (botId, threadId, viewerId) => !viewerId || (botId === "echo" ? threadId === "t-echo-alice" && viewerId === "alice" : tasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId),
    threadWritable: (_botId, threadId, viewerId) => !viewerId || tasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
    runs: (botId) => runs.filter((run) => run.botId === botId),
    runSeen: (_run, viewerId) => !viewerId || viewerId === "alice" || viewerId === "carol",
    messages: (threadId, limit) => ({ messages: (messages[threadId] ?? []).slice(-limit), hasMore: false }),
    children: (_botId, threadId) => threadId === "t-alice"
      ? [{ botId: "echo", threadId: "t-echo-alice", title: "Write the tests", status: "running", startedAt: NOW - 15_000 }]
      : threadId === "t-bob" ? [{ botId: "echo", threadId: "t-echo-bob", title: "Bob's private ask", status: "completed", startedAt: NOW - 4_000 }] : [],
    personName: (id) => ({ alice: "Alice", bob: "Bob" } as Record<string, string>)[id] ?? "",
    organization: () => true,
    now: () => NOW,
    ...overrides,
  };
}

async function serve(routeDeps: BotActivityRouteDeps = deps()): Promise<string> {
  const routes = [createBotActivityRoutes(routeDeps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = req.headers["x-viewer"];
    const auth = typeof who === "string"
      ? { kind: "session", scopes: ["client"], session: { id: who, principalId: who } }
      : { kind: "loopback", scopes: ["admin"] };
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: auth as never, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (base: string, path: string, viewer?: string) => {
  const res = await fetch(`${base}${path}`, { headers: viewer ? { "x-viewer": viewer } : {} });
  return { status: res.status, body: await res.json() as { items?: BotActivityItem[]; subagents?: BotActivityItem[]; item?: BotActivityDetail } };
};

describe("bot activity API", () => {
  it("is open to a client session (member and phone) for reads only", () => {
    expect(requiredScope("GET", "/api/bots/pepper/activity")).toBe("client");
    expect(requiredScope("GET", "/api/bots/pepper/activity/item")).toBe("client");
    expect(requiredScope("POST", "/api/bots/pepper/activity")).not.toBe("client");
  });

  it("lists a person's own threads only, running first, and the routine runs they may see", async () => {
    const base = await serve();
    const alice = await get(base, "/api/bots/pepper/activity", "alice");
    expect(alice.status).toBe(200);
    expect(alice.body.items!.map((item) => item.id)).toEqual(["thread:t-alice", "thread:t-routine"]);
    expect(alice.body.items![0]).toMatchObject({ kind: "session", status: "running", title: "Refactor the parser", threadId: "t-alice", childCount: 1, startedBy: { kind: "person", name: "Alice" } });
    expect(alice.body.items![1]).toMatchObject({ kind: "routine", status: "finished", startedBy: { kind: "routine", name: "Nightly dispatch" } });

    const bob = await get(base, "/api/bots/pepper/activity", "bob");
    expect(bob.body.items!.map((item) => item.id)).toEqual(["thread:t-bob"]);
    expect(bob.body.items![0]).toMatchObject({ status: "failed" });
    // 2026-11-06: a finished conversation spans its newest turn, not the thread's age
    expect(bob.body.items![0]).toMatchObject({ startedAt: NOW - 6_000, endedAt: NOW - 5_000 });
    expect(JSON.stringify(bob.body)).not.toContain("Refactor the parser");
    expect(JSON.stringify(alice.body)).not.toContain("secret plan");
  });

  it("shows a run-level holder the owner's routine run without its private thread", async () => {
    const base = await serve();
    const carol = await get(base, "/api/bots/pepper/activity", "carol");
    expect(carol.body.items).toEqual([expect.objectContaining({ id: "run:run-1", kind: "routine", title: "Nightly dispatch" })]);
    expect(carol.body.items![0]).not.toHaveProperty("threadId");
    const detail = await get(base, "/api/bots/pepper/activity/item?runId=run-1", "carol");
    expect(detail.status).toBe(200);
    expect(detail.body.item).toMatchObject({ steps: [], files: [], canStop: false });
    expect(detail.body.item).not.toHaveProperty("threadId");
    // Someone without run sees no run at all.
    expect((await get(base, "/api/bots/pepper/activity/item?runId=run-1", "bob")).status).toBe(404);
  });

  it.each([
    { status: "failed", threadId: "t-bob" },
    { status: "failed", threadId: undefined },
    { status: "blocked", threadId: "t-bob" },
    { status: "blocked", threadId: undefined },
  ] as const)("gives a $status run's access card only to its audience (thread: $threadId)", async ({ status, threadId }) => {
    const failed = [
      { id: "run-2", routineId: "r2", routineName: "Bob's check", botId: "pepper", status, target: "bot", runOn: "auto", scheduledFor: NOW - 4_000, startedAt: NOW - 4_000, finishedAt: NOW - 3_000, manual: true, createdAt: NOW - 4_000, ...(threadId ? { threadId } : {}), error: "no credentials" },
    ] as unknown as RoutineRun[];
    const card = { reason: "no_access", engine: "Claude", botId: "pepper", ownerPrincipalId: "alice", payer: "owner", payerPrincipalId: "alice", routine: true, cause: "no_credentials" } as const;
    const asked: Array<string | undefined> = [];
    const base = await serve(deps({
      runs: () => [...runs, ...failed],
      // the bot's owner and bob (the person it runs as) see the run
      runSeen: (_run, viewerId) => !viewerId || viewerId === "alice" || viewerId === "bob",
      runAccessCard: (run, viewerId) => { asked.push(viewerId); return run.id === "run-2" && viewerId === "alice" ? card : undefined; },
    }));
    // alice owns the bot: bob's thread stays his, the card is hers
    const owner = await get(base, "/api/bots/pepper/activity/item?runId=run-2", "alice");
    expect(owner.status).toBe(200);
    expect(owner.body.item).toMatchObject({ id: "run:run-2", status: "failed", steps: [], note: "no credentials", access: card });
    expect(owner.body.item).not.toHaveProperty("threadId");
    expect(JSON.stringify(owner.body)).not.toContain("secret plan");
    // bob reads his own thread there, without her card
    const runAs = await get(base, "/api/bots/pepper/activity/item?runId=run-2", "bob");
    if (threadId) expect(runAs.body.item).toMatchObject({ threadId });
    else expect(runAs.body.item).not.toHaveProperty("threadId");
    expect(runAs.body.item).not.toHaveProperty("access");
    expect(asked).toEqual(["alice", "bob"]);
    // a completed run never asks for a card
    asked.length = 0;
    await get(base, "/api/bots/pepper/activity/item?runId=run-1", "alice");
    expect(asked).toEqual([]);
  });

  it("opens the detail of one's own thread: steps with where they ran, files, payer, sub-agents", async () => {
    const base = await serve();
    const { status, body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice", "alice");
    expect(status).toBe(200);
    expect(body.item).toMatchObject({
      engine: { instanceId: "claude", model: "sonnet" },
      via: "subscription",
      payer: "speaker",
      files: ["src/a.ts", "src/b.ts"],
      canStop: true,
    });
    expect(body.item!.steps).toEqual([
      expect.objectContaining({ name: "mcp__sagax-desktop__shell", ok: true, where: "computer" }),
      expect.objectContaining({ name: "Edit", where: "server" }),
    ]);
    expect(body.item!.steps[1]).not.toHaveProperty("ok");
    expect(body.item!.children).toEqual([expect.objectContaining({ kind: "subagent", botName: "Echo", title: "Write the tests", threadId: "t-echo-alice", status: "running" })]);
  });

  it("keeps a quiet pre-check out of the list and does not call it a failure", async () => {
    const quiet = {
      id: "run-quiet", routineId: "rquiet", routineName: "Poll", botId: "pepper", status: "nothing_to_report",
      target: "bot", runOn: "auto", scheduledFor: NOW - 1_000, finishedAt: NOW - 500, manual: false, createdAt: NOW - 1_000,
      quietReason: "No change",
    } as unknown as RoutineRun;
    const base = await serve(deps({
      runs: (botId) => [...runs, quiet].filter((run) => run.botId === botId),
    }));
    const alice = await get(base, "/api/bots/pepper/activity", "alice");
    expect(alice.body.items!.map((item) => item.id)).not.toContain("run:run-quiet");
    const detail = await get(base, "/api/bots/pepper/activity/item?runId=run-quiet", "alice");
    expect(detail.status).toBe(200);
    expect(detail.body.item).toMatchObject({ id: "run:run-quiet", status: "finished" });
  });

  it("answers another person's thread exactly like a missing one", async () => {
    const base = await serve();
    expect((await get(base, "/api/bots/pepper/activity/item?threadId=t-bob", "alice")).status).toBe(404);
    expect((await get(base, "/api/bots/pepper/activity/item?threadId=nope", "alice")).status).toBe(404);
    expect((await get(base, "/api/bots/ghost/activity", "alice")).status).toBe(404);
  });

  it("hides a sub-agent's request text when its thread is not the viewer's", async () => {
    const base = await serve();
    const { body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-bob", "bob");
    expect(body.item!.children).toEqual([expect.objectContaining({ botId: "echo", title: "Echo", status: "finished" })]);
    expect(body.item!.children[0]).not.toHaveProperty("threadId");
    expect(JSON.stringify(body)).not.toContain("private ask");
  });

  it("gives the operator (no viewer) everything, and no place labels on a solo server", async () => {
    const base = await serve(deps({ organization: () => false }));
    const list = await get(base, "/api/bots/pepper/activity");
    expect(list.body.items!.map((item) => item.id)).toEqual(["thread:t-alice", "thread:t-bob", "thread:t-routine"]);
    const detail = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice");
    expect(detail.body.item!.steps.every((step) => !("where" in step))).toBe(true);
  });

  it("marks coding work from tool calls, not titles, and filters on it", async () => {
    const base = await serve();
    const alice = await get(base, "/api/bots/pepper/activity", "alice");
    expect(alice.body.items![0]).toMatchObject({ id: "thread:t-alice", coding: true, currentStep: "Edit", canStop: true });
    expect(alice.body.items![1]).not.toHaveProperty("coding");
    expect((await get(base, "/api/bots/pepper/activity?filter=coding", "alice")).body.items!.map((item) => item.id)).toEqual(["thread:t-alice"]);
    expect((await get(base, "/api/bots/pepper/activity?filter=other", "alice")).body.items!.map((item) => item.id)).toEqual(["thread:t-routine"]);
    // bob's own view: not coding, not his to stop when it is not running
    const bob = await get(base, "/api/bots/pepper/activity?filter=coding", "bob");
    expect(bob.body.items).toEqual([]);
  });

  it("calls profile imports not coding, and file changes inside a repository coding", async () => {
    const extra: ActivityTask[] = [
      { threadId: "t-soul", title: "Import this as your directive, soul, identity", createdAt: NOW - 9_000, updatedAt: NOW - 8_000, ownerPrincipalId: "alice", cwd: "/repo" },
      { threadId: "t-docs", title: "Tidy up", createdAt: NOW - 9_000, updatedAt: NOW - 7_000, ownerPrincipalId: "alice", cwd: "/repo" },
    ];
    const extraMessages: Record<string, ActivityMessage[]> = {
      "t-soul": [{ id: "s1", role: "bot", kind: "activity", at: NOW - 8_500, tool: { name: "Write", ok: true, files: ["/home/pepper/SOUL.md"] } }],
      "t-docs": [{ id: "s2", role: "bot", kind: "activity", at: NOW - 7_500, tool: { name: "Write", ok: true, files: ["/repo/docs/guide.md"] } }],
    };
    const base = await serve(deps({
      tasks: (botId) => (botId === "pepper" ? [...tasks, ...extra] : []),
      threadReadable: (_botId, threadId, viewerId) => !viewerId || [...tasks, ...extra].find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
      messages: (threadId, limit) => ({ messages: (extraMessages[threadId] ?? messages[threadId] ?? []).slice(-limit), hasMore: false }),
      inRepository: (cwd) => cwd === "/repo",
    }));
    const coding = await get(base, "/api/bots/pepper/activity?filter=coding", "alice");
    expect(coding.body.items!.map((item) => item.id)).toEqual(["thread:t-alice", "thread:t-docs"]);
    const other = await get(base, "/api/bots/pepper/activity?filter=other", "alice");
    expect(other.body.items!.map((item) => item.id)).toEqual(["thread:t-soul", "thread:t-routine"]);
  });

  it("gives a coding entry its code work: folder, branch, and the pull request its calls opened", async () => {
    const extra: ActivityTask[] = [
      { threadId: "t-pr", title: "Ship the lexer", createdAt: NOW - 9_000, updatedAt: NOW - 2_000, ownerPrincipalId: "alice", cwd: "/repo/src" },
    ];
    const extraMessages: Record<string, ActivityMessage[]> = {
      "t-pr": [
        { id: "p0", role: "user", kind: "text", at: NOW - 8_000, text: "ship it" },
        { id: "p1", role: "bot", kind: "activity", at: NOW - 7_000, tool: { name: "Bash", ok: true, input: "{\"command\":\"gh pr create --title \\\"Split the lexer\\\"\"}", output: "https://github.com/acme/parser/pull/42" } },
        // a request that quotes gh is no pull request
        { id: "p2", role: "bot", kind: "activity", at: NOW - 6_000, tool: { name: "Agent", ok: true, input: "{\"prompt\":\"then gh pr create\"}", output: "https://github.com/acme/parser/pull/43" } },
      ],
    };
    const base = await serve(deps({
      tasks: (botId) => (botId === "pepper" ? [...tasks, ...extra] : []),
      threadReadable: (_botId, threadId, viewerId) => !viewerId || [...tasks, ...extra].find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
      messages: (threadId, limit) => ({ messages: (extraMessages[threadId] ?? messages[threadId] ?? []).slice(-limit), hasMore: false }),
      repository: (cwd) => (cwd === "/repo/src" ? { root: "/repo", branch: "fix/lexer", origin: { repo: "acme/parser", url: "https://github.com/acme/parser" } } : undefined),
    }));
    const coding = await get(base, "/api/bots/pepper/activity?filter=coding", "alice");
    const entry = coding.body.items!.find((item) => item.id === "thread:t-pr")!;
    expect(entry.code).toMatchObject({ folder: "/repo", branch: "fix/lexer", repo: "acme/parser", repoUrl: "https://github.com/acme/parser" });
    expect(entry.code!.pullRequests).toEqual([{ repo: "acme/parser", number: 42, url: "https://github.com/acme/parser/pull/42", title: "Split the lexer", action: "opened", at: NOW - 7_000 }]);
    // not coding, no code work
    const other = await get(base, "/api/bots/pepper/activity?filter=other", "alice");
    expect(other.body.items!.every((item) => !item.code)).toBe(true);
    // bob sees none of it
    expect((await get(base, "/api/bots/pepper/activity", "bob")).body.items!.some((item) => item.id === "thread:t-pr")).toBe(false);
  });

  it("lists the sub-agents a person's own threads started, without others' request text", async () => {
    const base = await serve();
    const alice = await get(base, "/api/bots/pepper/activity", "alice");
    expect(alice.body.subagents).toEqual([expect.objectContaining({ kind: "subagent", botName: "Echo", title: "Write the tests", status: "running", parentId: "thread:t-alice", threadId: "t-echo-alice" })]);
    const bob = await get(base, "/api/bots/pepper/activity", "bob");
    expect(bob.body.subagents).toEqual([expect.objectContaining({ title: "Echo", status: "finished", parentId: "thread:t-bob" })]);
    expect(JSON.stringify(bob.body)).not.toContain("private ask");
    expect(JSON.stringify(bob.body)).not.toContain("Write the tests");
    // the coding filter carries no sub-agents
    expect((await get(base, "/api/bots/pepper/activity?filter=coding", "alice")).body.subagents).toEqual([]);
  });

  it("lists an archived thread only when the reader asks for it (#3464)", async () => {
    const archived: ActivityTask = { threadId: "t-arch", title: "Ended hand-over", createdAt: NOW - 90_000, updatedAt: NOW - 3_000_000, archivedAt: NOW - 2_000_000, ownerPrincipalId: "alice" };
    const reader = createBotActivityReader(deps({
      tasks: (botId) => (botId === "pepper" ? [...tasks, archived] : []),
      threadReadable: () => true,
      messages: (threadId, limit) => ({ messages: (threadId === "t-arch" ? [{ id: "x1", role: "user", kind: "text", at: NOW - 3_100_000, text: "go" }] as ActivityMessage[] : messages[threadId] ?? []).slice(-limit), hasMore: false }),
    }));
    const bot = { id: "pepper", name: "Pepper" };
    expect(reader.list(bot, "alice", 50).map((item) => item.id)).not.toContain("thread:t-arch");
    expect(reader.list(bot, "alice", 50, undefined, { archived: true }).map((item) => item.id)).toContain("thread:t-arch");
  });

  it("leaves out a conversation nobody wrote in yet, greeting or not", async () => {
    const empty: ActivityTask = { threadId: "t-empty", title: "New thread", createdAt: NOW - 1_000, updatedAt: NOW - 1_000, ownerPrincipalId: "alice" };
    const greeting: ActivityMessage = { id: "g1", role: "bot", kind: "text", at: NOW - 1_000, text: "Hi, I'm Pepper." };
    const base = await serve(deps({
      tasks: (botId) => (botId === "pepper" ? [...tasks, empty] : []),
      messages: (threadId, limit) => ({ messages: (threadId === "t-empty" ? [greeting] : messages[threadId] ?? []).slice(-limit), hasMore: false }),
    }));
    const { body } = await get(base, "/api/bots/pepper/activity");
    expect(body.items!.map((item) => item.id)).not.toContain("thread:t-empty");
  });

  it("refuses writes and a detail without a target", async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/bots/pepper/activity`, { method: "POST" })).status).toBe(405);
    expect((await get(base, "/api/bots/pepper/activity/item")).status).toBe(400);
  });

  it("nests a sub-agent's calls under its Agent step, with its request and report, and lists parallel tasks once", async () => {
    const parallelTasks: ActivityTask[] = [
      ...tasks,
      { threadId: "t-par", title: "Draft the email", createdAt: NOW - 8_000, updatedAt: NOW - 1_000, busy: true, activity: "working", turnStartedAt: NOW - 7_000, ownerPrincipalId: "alice", parallelOf: { threadId: "t-alice" } },
    ];
    const agentInput = JSON.stringify({ description: "check the logs", prompt: "Read the server logs and list errors", subagent_type: "general-purpose" });
    const base = await serve(deps({
      tasks: (botId) => (botId === "pepper" ? parallelTasks : []),
      threadReadable: (_botId, threadId, viewerId) => !viewerId || parallelTasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
      threadWritable: (_botId, threadId, viewerId) => !viewerId || parallelTasks.find((task) => task.threadId === threadId)?.ownerPrincipalId === viewerId,
      messages: (threadId, limit) => ({ hasMore: false, messages: (threadId === "t-alice" ? [
        { id: "s1", role: "bot", kind: "activity", at: NOW - 20_000, tool: { name: "Agent", itemId: "tu-agent", input: agentInput, output: "Two errors found", ok: true } },
        { id: "s2", role: "bot", kind: "activity", at: NOW - 19_000, tool: { name: "Read", itemId: "tu-read", parentItemId: "tu-agent", input: "{\"file_path\":\"/var/log/app.log\"}", ok: true } },
        { id: "s3", role: "bot", kind: "activity", at: NOW - 18_000, tool: { name: "Bash", itemId: "tu-bash", summary: "ls" } },
      ] as ActivityMessage[] : messages[threadId] ?? []).slice(-limit) }),
      children: (_botId, threadId) => threadId === "t-alice"
        ? [{ botId: "pepper", threadId: "t-par", title: "Draft the email", status: "running", startedAt: NOW - 8_000, parallel: true }]
        : [],
    }));
    const list = await get(base, "/api/bots/pepper/activity", "alice");
    expect(list.body.items!.find((item) => item.id === "thread:t-par")).toMatchObject({ parallel: true, status: "running", canStop: true });
    // listed once, as its own entry, not again among the sub-agents
    expect(list.body.subagents!.some((item) => item.threadId === "t-par")).toBe(false);
    const detail = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice", "alice");
    const steps = detail.body.item!.steps;
    expect(steps.find((step) => step.id === "s1")).toMatchObject({
      name: "Agent",
      subagent: { description: "check the logs", prompt: "Read the server logs and list errors", type: "general-purpose", result: "Two errors found" },
    });
    expect(steps.find((step) => step.id === "s2")).toMatchObject({ parentId: "s1", input: "{\"file_path\":\"/var/log/app.log\"}" });
    expect(steps.find((step) => step.id === "s3")).not.toHaveProperty("parentId");
    expect(detail.body.item!.children).toEqual([expect.objectContaining({ threadId: "t-par", parallel: true, canStop: true })]);
  });
});

// 2026-11-02: a run's steps said "The tool failed and returned no error
// message" for every failure: the step never carried the call's output.
describe("a failed step's error", () => {
  it("is the stored output, bounded and redacted; a success or an empty output carries none", () => {
    expect(stepError("Microsoft Graph API error: 404 Not Found")).toBe("Microsoft Graph API error: 404 Not Found");
    expect(stepError("x".repeat(2_000))).toHaveLength(STEP_ERROR_CHARS);
    expect(stepError("   ")).toBeUndefined();
    expect(stepError(undefined)).toBeUndefined();
    expect(stepError("Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("reaches the run's steps for a failed call only", async () => {
    const base = await serve(deps({
      messages: (threadId, limit) => ({ hasMore: false, messages: (threadId === "t-alice" ? [
        { id: "f1", role: "bot", kind: "activity", at: NOW - 20_000, tool: { name: "mcp__outlook__get_message", input: "{\"message_id\":\"AAMkAGI2THVSAAA=\"}", output: "Graph 404 ErrorItemNotFound", ok: false } },
        { id: "f2", role: "bot", kind: "activity", at: NOW - 19_000, tool: { name: "mcp__outlook__get_message", output: "a whole email body", ok: true } },
      ] as ActivityMessage[] : messages[threadId] ?? []).slice(-limit) }),
    }));
    const detail = await get(base, "/api/bots/pepper/activity/item?threadId=t-alice", "alice");
    const steps = detail.body.item!.steps;
    expect(steps.find((step) => step.id === "f1")).toMatchObject({ ok: false, error: "Graph 404 ErrorItemNotFound" });
    expect(steps.find((step) => step.id === "f2")).not.toHaveProperty("error");
  });
});

// 2026-10-29: a Retry in a bot's main chat (its turn only listed routines)
// showed under Details > Coding as « hello · Running · 27 sub-agents », and
// its sheet piled up every earlier turn: old git work, a usage-limit error,
// and the teammates an earlier turn handed work to, all « Waiting on you ».
describe("a conversation's entry is its newest turn", () => {
  const main: ActivityTask = { threadId: "t-main", title: "hello", createdAt: NOW - 8 * 3_600_000, updatedAt: NOW - 1_000, busy: true, activity: "working", turnStartedAt: NOW - 22_000, ownerPrincipalId: "alice" };
  const earlier = NOW - 6 * 3_600_000;
  const history: ActivityMessage[] = [
    { id: "h1", role: "user", kind: "text", at: earlier - 60_000, text: "hello", parentId: null },
    { id: "h2", role: "bot", kind: "activity", at: earlier - 50_000, tool: { name: "Bash", ok: true, input: "{\"command\":\"git commit -am wip && git push\"}" } },
    { id: "h3", role: "bot", kind: "activity", at: earlier - 40_000, tool: { name: "Edit", ok: true, files: ["/srv/app/src/a.ts"] } },
    { id: "h4", role: "user", kind: "text", at: earlier, text: "Hand the routine review to the team\nand wait for them", parentId: "h3" },
    { id: "h5", role: "bot", kind: "activity", at: earlier + 10_000, tool: { name: "mcp__agents__handoff", ok: true } },
    { id: "h6", role: "bot", kind: "activity", at: earlier + 20_000, tool: { name: "Error: Claude stopped with an error (HTTP 400 usage limits)", ok: false } },
    // Retry: the same words forked beside the first try
    { id: "h7", role: "user", kind: "text", at: NOW - 22_000, text: "Hand the routine review to the team\nand wait for them", parentId: "h3" },
    { id: "h8", role: "bot", kind: "activity", at: NOW - 15_000, tool: { name: "mcp__agents__list_routines", summary: "mcp__agents__list_routines" } },
  ];
  const teammates = Array.from({ length: 27 }, (_, index) => ({
    botId: "echo", threadId: `t-echo-${index}`, title: "@echo · work", status: "waiting" as const, startedAt: earlier + 10_000,
  }));
  const mainDeps = (overrides: Partial<BotActivityRouteDeps> = {}) => deps({
    tasks: (botId) => (botId === "pepper" ? [main] : []),
    threadReadable: (botId, threadId, viewerId) => !viewerId || (botId === "pepper" ? threadId === "t-main" : viewerId === "alice"),
    threadWritable: (_botId, threadId, viewerId) => !viewerId || threadId === "t-main",
    runs: () => [],
    messages: (threadId, limit) => ({ messages: (threadId === "t-main" ? history : []).slice(-limit), hasMore: false }),
    children: (_botId, threadId) => (threadId === "t-main" ? [...teammates, { botId: "echo", threadId: "t-echo-now", title: "Check the schedule", status: "running", startedAt: NOW - 10_000 }] : []),
    inRepository: () => false,
    ...overrides,
  });

  it("is not Coding for an earlier turn's git work, and keeps that code work", async () => {
    const base = await serve(mainDeps());
    const list = await get(base, "/api/bots/pepper/activity", "alice");
    const entry = list.body.items!.find((item) => item.id === "thread:t-main")!;
    expect(entry).not.toHaveProperty("coding");
    expect(entry.code).toBeDefined();
    expect((await get(base, "/api/bots/pepper/activity?filter=coding", "alice")).body.items).toEqual([]);
  });

  it("is Coding while its own turn does code work", async () => {
    const coding = [...history, { id: "h9", role: "bot", kind: "activity", at: NOW - 5_000, tool: { name: "Edit", files: ["/srv/app/src/b.ts"] } } as ActivityMessage];
    const base = await serve(mainDeps({ messages: (threadId, limit) => ({ messages: (threadId === "t-main" ? coding : []).slice(-limit), hasMore: false }) }));
    const entry = (await get(base, "/api/bots/pepper/activity", "alice")).body.items!.find((item) => item.id === "thread:t-main")!;
    expect(entry).toMatchObject({ coding: true });
  });

  it("stays Coding as a whole when its folder is a repository", async () => {
    const base = await serve(mainDeps({
      tasks: (botId) => (botId === "pepper" ? [{ ...main, cwd: "/srv/app" }] : []),
      inRepository: (cwd) => cwd === "/srv/app",
    }));
    const entry = (await get(base, "/api/bots/pepper/activity", "alice")).body.items!.find((item) => item.id === "thread:t-main")!;
    expect(entry).toMatchObject({ coding: true });
  });

  it("is titled by the request its turn answers, says it is a retry, and keeps the thread's title", async () => {
    const base = await serve(mainDeps());
    const entry = (await get(base, "/api/bots/pepper/activity", "alice")).body.items!.find((item) => item.id === "thread:t-main")!;
    expect(entry).toMatchObject({ title: "Hand the routine review to the team", threadTitle: "hello", retry: true });
  });

  it("is titled by a new request without the retry mark", async () => {
    const asked = [...history.slice(0, 6), { id: "h7", role: "user", kind: "text", at: NOW - 22_000, text: "  list my routines  ", parentId: "h6" } as ActivityMessage];
    const base = await serve(mainDeps({ messages: (threadId, limit) => ({ messages: (threadId === "t-main" ? asked : []).slice(-limit), hasMore: false }) }));
    const entry = (await get(base, "/api/bots/pepper/activity", "alice")).body.items!.find((item) => item.id === "thread:t-main")!;
    expect(entry.title).toBe("list my routines");
    expect(entry).not.toHaveProperty("retry");
  });

  it("lists only its own turn's steps, files and sub-agents in the sheet", async () => {
    const base = await serve(mainDeps());
    const { body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-main", "alice");
    expect(body.item!.steps.map((step) => step.id)).toEqual(["h8"]);
    expect(body.item!.stepsTruncated).toBe(true);
    expect(body.item!.files).toEqual([]);
    expect(body.item!.children.map((child) => child.threadId)).toEqual(["t-echo-now"]);
    expect(body.item!.childCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain("usage limits");
  });

  it("moves an earlier turn's teammates to the list's sub-agents, each opening its own conversation", async () => {
    const base = await serve(mainDeps());
    const list = await get(base, "/api/bots/pepper/activity", "alice");
    const waiting = list.body.subagents!.filter((item) => item.status === "waiting");
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((item) => item.threadId?.startsWith("t-echo-") && item.parentId === "thread:t-main")).toBe(true);
    expect(list.body.items!.find((item) => item.id === "thread:t-main")!.childCount).toBe(1);
  });

  it("does not count a teammate the viewer cannot open as waiting on them", async () => {
    const base = await serve(mainDeps({
      threadReadable: (botId, threadId, viewerId) => !viewerId || (botId === "pepper" && threadId === "t-main"),
    }));
    const list = await get(base, "/api/bots/pepper/activity", "alice");
    expect(list.body.subagents!.some((item) => item.status === "waiting")).toBe(false);
    expect(list.body.subagents!.every((item) => !item.threadId)).toBe(true);
  });
});

// 2026-11-02: work another bot handed over showed under Details > Coding
// (« Running · from Echo ») while it only read an issue and its pull
// requests, asked who was around, coordinated, commented on the issue and
// picked a computer. A work thread keeps every request one conversation
// sends this bot (server/store.ts workThread), and each request lands as
// the requesting bot's line (`roomRequest`), never a person's: the newest
// turn started nowhere, so an earlier request's commit made this one Coding.
describe("work another bot hands over is Coding only for its own request's code work", () => {
  const work: ActivityTask = {
    threadId: "t-work", title: "@Echo · work", createdAt: NOW - 3 * 3_600_000, updatedAt: NOW - 1_000, busy: true, activity: "working",
    turnStartedAt: NOW - 40_000, ownerPrincipalId: "alice", openedBy: { botId: "echo", name: "Echo", kind: "work", at: NOW - 3 * 3_600_000 },
  };
  const earlier = NOW - 2 * 3_600_000;
  const request = (id: string, at: number, text: string): ActivityMessage =>
    ({ id, role: "bot", kind: "text", at, text: `@Pepper ${text}`, roomRequest: { id: `req-${id}`, phase: "request" }, sender: null });
  const call = (id: string, at: number, tool: NonNullable<ActivityMessage["tool"]>): ActivityMessage => ({ id, role: "bot", kind: "activity", at, tool });
  // a shell call as the store keeps it (server/index.ts, item.started):
  // commandSummary (newlines folded, cut at 200) and toolDetailPreview
  const shell = (name: string, command: string) => ({ name, ok: true, summary: commandSummary({ command }), input: toolDetailPreview({ command }) });
  // an issue comment longer than the summary, its quoted text listing git lines
  const comment = "gh issue comment 1905 --body \"Steps to reproduce:\ngit checkout -b check\ngit push origin check\nThen approve once and the card shows twice, which is what the screenshot attached to the issue shows as well, on a clean checkout of main.\"";
  // The first request: real code work, a commit, a push and a pull request.
  const first: ActivityMessage[] = [
    request("r1", earlier, "Fix the parser and open a pull request"),
    call("w1", earlier + 10_000, { name: "Edit", ok: true, files: ["/srv/app/src/parser.ts"] }),
    call("w2", earlier + 20_000, shell("Bash", "git commit -am 'Fix the parser' && git push -u origin fix/parser")),
    call("w3", earlier + 30_000, { ...shell("Bash", "gh pr create --title \"Fix the parser\""), output: "https://github.com/acme/parser/pull/42" }),
    { id: "w4", role: "bot", kind: "text", at: earlier + 40_000, text: "Opened #42.", turnSucceeded: true },
  ];
  // The request running now reads, coordinates and comments: no code work.
  const reading: ActivityMessage[] = [
    request("r2", NOW - 40_000, "Look at the approval card issue and say what you find on it"),
    call("x1", NOW - 35_000, shell("sagax-environment__run_command", "cd /work/app && gh issue view 1905 && gh pr list --search 1905")),
    call("x2", NOW - 30_000, { name: "github__issue_read", ok: true, input: JSON.stringify({ owner: "acme", repo: "app", issue_number: 1905 }) }),
    call("x3", NOW - 28_000, { name: "github__pull_request_read", ok: true, input: JSON.stringify({ owner: "acme", repo: "app", pull_number: 1907 }) }),
    call("x4", NOW - 25_000, { name: "mcp__agents__whos_around", ok: true }),
    call("x5", NOW - 20_000, { name: "mcp__agents__coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["echo"], message: "Found it.\ngit push was never the problem." }) }),
    // the teammate's reply and the resume it starts: the same request goes on
    { id: "x5r", role: "bot", kind: "activity", at: NOW - 18_000, roomRequest: { id: "req-ask-echo", phase: "result" }, tool: { name: "Echo replied", ok: true } },
    call("x5s", NOW - 17_000, { name: "Resumed with Echo results, reviewing", ok: true }),
    call("x6", NOW - 15_000, shell("sagax-environment__run_command", comment)),
    call("x6b", NOW - 12_000, { name: "github__add_issue_comment", ok: true, input: JSON.stringify({ owner: "acme", repo: "app", issue_number: 1905, body: "Steps:\ngit checkout -b check\ngit push origin check" }) }),
    call("x7", NOW - 10_000, shell("sagax-environment__run_command", "git diff $(git merge-base origin/main HEAD) --stat")),
    call("x8", NOW - 5_000, { name: "computer_select", ok: true, input: JSON.stringify({ computer: "this-mac" }) }),
  ];
  const workDeps = (thread: ActivityMessage[], overrides: Partial<BotActivityRouteDeps> = {}) => deps({
    tasks: (botId) => (botId === "pepper" ? [work] : []),
    threadReadable: (botId, threadId, viewerId) => !viewerId || (botId === "pepper" && threadId === "t-work"),
    threadWritable: (_botId, threadId, viewerId) => !viewerId || threadId === "t-work",
    runs: () => [],
    messages: (threadId, limit) => ({ messages: (threadId === "t-work" ? thread : []).slice(-limit), hasMore: false }),
    children: () => [],
    inRepository: () => false,
    ...overrides,
  });
  const entryOf = async (base: string) => (await get(base, "/api/bots/pepper/activity", "alice")).body.items!.find((item) => item.id === "thread:t-work")!;

  it("is not Coding when its request only reads, coordinates and comments, and keeps the earlier request's code work", async () => {
    // the comment's summary is cut inside its quoted text
    expect(comment.length).toBeGreaterThan(200);
    const base = await serve(workDeps([...first, ...reading]));
    const entry = await entryOf(base);
    expect(entry).toMatchObject({ kind: "hop", status: "running", startedBy: { kind: "bot", name: "Echo" } });
    expect(entry).not.toHaveProperty("coding");
    expect(entry.code!.pullRequests.map((pull) => pull.number)).toEqual([42]);
    expect((await get(base, "/api/bots/pepper/activity?filter=coding", "alice")).body.items).toEqual([]);
    expect((await get(base, "/api/bots/pepper/activity?filter=other", "alice")).body.items!.map((item) => item.id)).toEqual(["thread:t-work"]);
  });

  it("lists only its own request's steps in the sheet", async () => {
    const base = await serve(workDeps([...first, ...reading]));
    const { body } = await get(base, "/api/bots/pepper/activity/item?threadId=t-work", "alice");
    expect(body.item!.steps.map((step) => step.id)).toEqual(["x1", "x2", "x3", "x4", "x5", "x5r", "x5s", "x6", "x6b", "x7", "x8"]);
    expect(body.item!.stepsTruncated).toBe(true);
    expect(body.item!.files).toEqual([]);
    expect(body.item).not.toHaveProperty("coding");
  });

  it("does not inherit Coding from an earlier request when its folder is a repository", async () => {
    const base = await serve(workDeps([...first, ...reading], {
      tasks: (botId) => (botId === "pepper" ? [{ ...work, cwd: "/srv/app" }] : []),
      inRepository: (cwd) => cwd === "/srv/app",
    }));
    expect(await entryOf(base)).not.toHaveProperty("coding");
  });

  it("reads a person's own line in a work thread like their conversation: a repository's job as a whole", async () => {
    const asked: ActivityMessage[] = [
      ...first,
      { id: "p1", role: "user", kind: "text", at: NOW - 20_000, text: "What did you change?", parentId: "w4" },
      call("p2", NOW - 10_000, { name: "Read", ok: true, files: ["/srv/app/src/parser.ts"] }),
    ];
    const inRepository = await serve(workDeps(asked, {
      tasks: (botId) => (botId === "pepper" ? [{ ...work, cwd: "/srv/app" }] : []),
      inRepository: (cwd) => cwd === "/srv/app",
    }));
    expect(await entryOf(inRepository)).toMatchObject({ coding: true });
    expect(await entryOf(await serve(workDeps(asked)))).not.toHaveProperty("coding");
  });

  it("is Coding once its own request changes code, and stays Coding while it goes on reading", async () => {
    const coding = [
      ...first,
      ...reading.slice(0, 3),
      call("y1", NOW - 27_000, { name: "Edit", ok: true, files: ["/srv/app/src/approval-card.tsx"] }),
      ...reading.slice(3),
    ];
    const base = await serve(workDeps(coding));
    expect(await entryOf(base)).toMatchObject({ coding: true });
    const pushed = [...first, ...reading, call("y2", NOW - 2_000, shell("Bash", "cd /srv/app && git push origin fix/approval-card"))];
    expect(await entryOf(await serve(workDeps(pushed)))).toMatchObject({ coding: true });
  });

  it("reads a request longer than the page as the turn it was, so a coding job does not drop out of Coding", async () => {
    // a page of 8: the request and its edit scroll out while the panel polls
    // and the job goes on reading
    const edited = [...first, request("r3", NOW - 60_000, "Fix the approval card"), call("z1", NOW - 50_000, { name: "Edit", ok: true, files: ["/srv/app/src/approval-card.tsx"] })];
    const read = (index: number) => call(`z${index + 2}`, NOW - 40_000 + index * 100, { name: "github__issue_read", ok: true, input: JSON.stringify({ issue_number: 1900 + index }) });
    let thread = edited;
    let clock = NOW;
    const base = await serve(workDeps(edited, {
      now: () => clock,
      messages: (threadId, limit) => {
        const all = threadId === "t-work" ? thread : [];
        return { messages: all.slice(-Math.min(limit, 8)), hasMore: all.length > 8 };
      },
    }));
    expect(await entryOf(base)).toMatchObject({ coding: true });
    for (let poll = 0; poll < 6; poll++) {
      thread = [...thread, read(poll * 3), read(poll * 3 + 1), read(poll * 3 + 2)];
      clock += 5_000;
      expect(await entryOf(base)).toMatchObject({ coding: true });
    }
    // a new request whose line scrolled out before any scan saw it is not that turn
    thread = [...thread, request("r4", NOW - 10_000, "Say who is around"), ...Array.from({ length: 9 }, (_, index) => read(100 + index))];
    clock += 5_000;
    expect(await entryOf(base)).not.toHaveProperty("coding");
  });

  it("names no step of the request before as the step of a request that just started", async () => {
    const started = [...first, request("r2", NOW - 5_000, "Say who is around")];
    const entry = await entryOf(await serve(workDeps(started)));
    expect(entry).toMatchObject({ status: "running" });
    expect(entry).not.toHaveProperty("currentStep");
    // its own call, once it runs, is its step
    const asking = [...started, call("v1", NOW - 2_000, { name: "mcp__agents__whos_around" })];
    expect(await entryOf(await serve(workDeps(asking)))).toMatchObject({ currentStep: "mcp__agents__whos_around" });
  });

  it("reads a settled request's outcome from its own turn, never the request before", async () => {
    const settled = (thread: ActivityMessage[]) => workDeps(thread, { tasks: (botId) => (botId === "pepper" ? [{ ...work, busy: false, activity: undefined }] : []) });
    const refused: ActivityMessage[] = [...first.slice(0, -1), { id: "w4", role: "bot", kind: "text", at: earlier + 40_000, text: "The push was refused.", turnSucceeded: false }];
    const answered: ActivityMessage[] = [
      ...refused,
      request("r2", NOW - 40_000, "Say who is around"),
      call("v1", NOW - 30_000, { name: "mcp__agents__whos_around", ok: true }),
      { id: "v2", role: "bot", kind: "text", at: NOW - 20_000, text: "Echo is around." },
    ];
    expect(await entryOf(await serve(settled(answered)))).toMatchObject({ status: "finished" });
    const failed: ActivityMessage[] = [...first, request("r2", NOW - 40_000, "Say who is around"), { id: "v2", role: "bot", kind: "text", at: NOW - 20_000, text: "No one answered.", turnSucceeded: false }];
    expect(await entryOf(await serve(settled(failed)))).toMatchObject({ status: "failed" });
  });
});

describe("activity list reuses one message page per thread", () => {
  it("calls messagesTail once per listed thread, not once per helper", async () => {
    const calls: Array<{ threadId: string; limit: number }> = [];
    const base = await serve(deps({
      messages: (threadId, limit) => {
        calls.push({ threadId, limit });
        return { messages: (messages[threadId] ?? []).slice(-limit), hasMore: false };
      },
    }));
    await get(base, "/api/bots/pepper/activity", "alice");
    const byThread = new Map<string, number>();
    for (const call of calls) byThread.set(call.threadId, (byThread.get(call.threadId) ?? 0) + 1);
    // Busy alice + completed routine thread: each paid one messagesTail (the
    // coding-scan page), reused for untouched / settled / currentStep.
    expect(byThread.get("t-alice")).toBe(1);
    expect(byThread.get("t-routine")).toBe(1);
    expect(byThread.has("t-bob")).toBe(false);
    expect(byThread.has("t-old")).toBe(false);
  });
});
