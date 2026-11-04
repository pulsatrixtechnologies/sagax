// Parallel tasks end to end (shared/parallel-tasks.ts): the real harness with
// the fake claude CLI in `slow` mode, where each prompt carrying [gate:NAME]
// holds its reply until the test drops that gate. A message sent while the
// conversation works can join the running turn (steer), wait for it (after)
// or run as its own task (parallel); parallel tasks run at once, finish in
// any order, answer in the conversation as replies to their own request,
// never see each other's words, can be stopped one by one and respect the
// per-person limit.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const SEND_P1 = randomUUID();
const SEND_P2 = randomUUID();

posixOnly("parallel tasks e2e", () => {
  let child: ChildProcess;
  let home: string;
  let gates: string;
  let base = "";
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const messages = async (_botId: string, threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const tasks = async (botId: string): Promise<any[]> => (await getBot(botId)).tasks ?? [];
  const open = (name: string) => writeFileSync(join(gates, name), "go");
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  /** A bot on the gated fake, with its first turn running on `gate`. */
  const busyBot = async (gate: string) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: `[gate:${gate}] main work`, threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the main turn to start");
    return bot as { id: string; threadId: string };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-parallel-"));
    gates = join(home, "gates");
    mkdirSync(gates, { recursive: true });
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        // a turn whose Agent call starts a sub-agent that reads a file
        claudeAgent: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
            { name: "Agent", id: "agent-1", input: { description: "check the logs", prompt: "Read the server logs and list errors", subagent_type: "general-purpose" }, output: [{ type: "text", text: "Two errors found" }] },
            { name: "Read", parent: "agent-1", input: { file_path: "/var/log/app.log" }, output: "error A\nerror B" },
            { name: "Bash", input: { command: "echo done" }, output: "done" },
          ]) },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        // every turn asks the person to approve a command, then replies
        askFirst: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_ACP, fullAuto: false } },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("two parallel requests run beside the main turn, finish in any order and answer their own request", async () => {
    const bot = await busyBot("main1");
    const first = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p1] summarize the logs", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P1 });
    const second = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p2] draft the email", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P2 });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.parallel).toMatchObject({ state: "running" });
    expect(second.body.parallel).toMatchObject({ state: "running" });
    const p1 = first.body.parallel.threadId as string;
    const p2 = second.body.parallel.threadId as string;
    expect(p1).not.toBe(p2);
    // a retry of the same send answers with the same request, no new task
    const retry = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p1] summarize the logs", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P1 });
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect((await tasks(bot.id)).filter((task) => task.parallelOf)).toHaveLength(2);

    // all three run at once: the main turn and both tasks
    await waitFor(async () => (await tasks(bot.id)).filter((task) => task.busy).length === 3, "three turns at once");
    const linked = (await tasks(bot.id)).filter((task) => task.parallelOf);
    expect(linked.map((task) => task.parallelOf.threadId)).toEqual([bot.threadId, bot.threadId]);

    // the conversation shows each request and its live card
    let main = await messages(bot.id, bot.threadId);
    const request1 = main.find((m) => m.id === first.body.message.id);
    expect(request1).toMatchObject({ role: "user", text: "[gate:p1] summarize the logs", parallelTask: { role: "request", threadId: p1 } });
    expect(main.filter((m) => m.parallelTask?.role === "card")).toHaveLength(2);

    // the second finishes first; its answer replies to its own request
    open("p2");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p2), "the second result");
    main = await messages(bot.id, bot.threadId);
    const result2 = main.find((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p2);
    expect(result2.replyToId).toBe(second.body.message.id);
    expect(result2.text).toContain("[gate:p2] draft the email");
    // no cross-talk: one task never reads the other's request
    expect(result2.text).not.toContain("gate:p1");
    expect(main.find((m) => m.parallelTask?.role === "card" && m.parallelTask.threadId === p2).parallelTask.state).toBe("done");
    expect((await getBot(bot.id)).busy).toBe(true);

    open("p1");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p1), "the first result");
    main = await messages(bot.id, bot.threadId);
    const result1 = main.find((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p1);
    expect(result1.replyToId).toBe(first.body.message.id);
    expect(result1.text).not.toContain("gate:p2");
    // each task kept its own engine session
    const sessions = (await tasks(bot.id)).filter((task) => task.parallelOf).map((task) => task.threadId);
    expect(new Set(sessions).size).toBe(2);

    // the main turn never saw either request and finishes on its own
    open("main1");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "every turn to settle");
    main = await messages(bot.id, bot.threadId);
    const mainReply = main.find((m) => m.role === "bot" && m.kind === "text" && m.text.startsWith("reply to:") && !m.parallelTask);
    expect(mainReply.text).toContain("main work");
    expect(mainReply.text).not.toContain("summarize the logs");
  }, 60_000);

  it("after waits for the running turn; steer joins it", async () => {
    const bot = await busyBot("main2");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.kind === "activity"), "the tool chip");
    const after = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:after2] then do this", threadId: bot.threadId, busyMode: "after" });
    expect(after.status).toBe(202);
    expect(after.body.queued).toBe(true);
    const steer = await api("POST", `/api/bots/${bot.id}/messages`, { text: "and keep it short", threadId: bot.threadId, busyMode: "steer" });
    expect(steer.body.steered).toBe(true);
    open("main2");
    // the queued line runs as the next turn, after the steered one settled
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.role === "user" && m.text === "[gate:after2] then do this"), "the queued line to drain");
    open("after2");
    await waitFor(async () => (await getBot(bot.id)).busy === false && (await messages(bot.id, bot.threadId)).filter((m) => m.role === "bot" && m.text?.startsWith("reply to:")).length === 2, "both turns");
    const replies = (await messages(bot.id, bot.threadId)).filter((m) => m.role === "bot" && m.text?.startsWith("reply to:")).map((m) => m.text);
    expect(replies[0]).toContain("steered: and keep it short");
    expect(replies[1]).toContain("then do this");
    expect((await tasks(bot.id)).some((task) => task.parallelOf)).toBe(false);
  }, 60_000);

  it("a parallel task stops on its own and says so in the conversation", async () => {
    const bot = await busyBot("main3");
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:never3] long research", threadId: bot.threadId, busyMode: "parallel" });
    const taskThread = sent.body.parallel.threadId as string;
    await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === taskThread)?.busy === true, "the task to run");
    const stopped = await api("POST", `/api/bots/${bot.id}/parallel/${taskThread}/stop`, {});
    expect(stopped.status).toBe(200);
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === taskThread), "the stopped result");
    const main = await messages(bot.id, bot.threadId);
    expect(main.find((m) => m.parallelTask?.role === "card" && m.parallelTask.threadId === taskThread).parallelTask.state).toBe("stopped");
    expect(main.find((m) => m.parallelTask?.role === "result").text).toContain("stopped");
    // the main turn kept going
    expect((await tasks(bot.id)).find((task) => task.threadId === bot.threadId)?.busy).toBe(true);
    expect((await api("POST", `/api/bots/${bot.id}/parallel/${taskThread}/stop`, {})).status).toBe(404);
    open("main3");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the main turn");
  }, 60_000);

  it("the per-person limit queues the next task until one of theirs finishes", async () => {
    expect((await api("PATCH", "/api/config", { threads: { maxParallelPerPerson: 1 } })).status).toBe(200);
    try {
      const bot = await busyBot("main4");
      const first = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q1] first", threadId: bot.threadId, busyMode: "parallel" });
      const second = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q2] second", threadId: bot.threadId, busyMode: "parallel" });
      expect(first.body.parallel.state).toBe("running");
      expect(second.body.parallel.state).toBe("queued");
      // a third waits too; past twice the limit waiting, a send is refused
      const third = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q3] third", threadId: bot.threadId, busyMode: "parallel" });
      expect(third.body.parallel.state).toBe("queued");
      const refused = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q4] fourth", threadId: bot.threadId, busyMode: "parallel" });
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.code, JSON.stringify(refused.body)).toBe("parallel_limit");
      const q2 = second.body.parallel.threadId as string;
      const q3 = third.body.parallel.threadId as string;
      await new Promise((r) => setTimeout(r, 500));
      expect((await tasks(bot.id)).find((task) => task.threadId === q2)?.busy).toBeFalsy();
      open("q1");
      await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === q2)?.busy === true, "the queued task to start");
      // Check capacity while q2 is inside its real driver. q3 stays
      // queued even when both completion gates are then released.
      await waitFor(async () => (await messages(bot.id, q2)).some((m) => m.kind === "activity" && m.tool?.name === "Bash"), "the second task's gated tool");
      expect((await tasks(bot.id)).find((task) => task.threadId === q3)?.busy).toBe(false);
      open("q2");
      open("q3");
      open("main4");
      await waitFor(async () => (await messages(bot.id, bot.threadId)).filter((m) => m.parallelTask?.role === "result").length === 3, "three results");
      const results = (await messages(bot.id, bot.threadId)).filter((m) => m.parallelTask?.role === "result");
      expect(results.map((m) => m.replyToId)).toEqual([first.body.message.id, second.body.message.id, third.body.message.id]);
    } finally {
      await api("PATCH", "/api/config", { threads: { maxParallelPerPerson: null } });
    }
  }, 90_000);

  it("a parallel task's approval is its own: asked in its thread, named on its card, answered without touching the main turn", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    // a new bot starts on Approve for me; the cards under test need Ask
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "askFirst", model: "default" }, approvalMode: "ask" });
    const openCard = async (threadId: string) => (await messages(bot.id, threadId)).find((m) => m.kind === "options" && m.card?.requestId && !m.card.answered);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "main work", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => Boolean(await openCard(bot.threadId)), "the main turn's approval");
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "check the disk", threadId: bot.threadId, busyMode: "parallel" });
    const taskThread = sent.body.parallel.threadId as string;
    await waitFor(async () => Boolean(await openCard(taskThread)), "the task's approval");
    await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === taskThread)?.activity === "waiting-on-you", "the task to wait on the person");
    const mainCard = await openCard(bot.threadId);
    const taskCard = await openCard(taskThread);
    expect(taskCard.card.requestId).not.toBe(mainCard.card.requestId);
    // the conversation's card names the task that waits
    const card = (await messages(bot.id, bot.threadId)).find((m) => m.parallelTask?.role === "card");
    expect(card.threadRef).toMatchObject({ threadId: taskThread, title: "check the disk" });
    // the task's request cannot be answered from the main thread
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: taskCard.card.requestId, behavior: "allow" });
    await new Promise((r) => setTimeout(r, 300));
    expect((await openCard(taskThread))?.card.requestId).toBe(taskCard.card.requestId);
    expect((await api("POST", `/api/threads/${taskThread}/respond`, { requestId: taskCard.card.requestId, behavior: "allow" })).status).toBe(200);
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result"), "the task's result");
    const result = (await messages(bot.id, bot.threadId)).find((m) => m.parallelTask?.role === "result");
    expect(result.text).toContain("handled the permission decision");
    expect(result.replyToId).toBe(sent.body.message.id);
    // the main turn still waits on its own approval
    expect((await openCard(bot.threadId))?.card.requestId).toBe(mainCard.card.requestId);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: mainCard.card.requestId, behavior: "deny" });
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the main turn");
  }, 60_000);

  it("the task detail nests a sub-agent's calls under its Agent step, with its request and report", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claudeAgent", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "look into the errors", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.role === "bot" && m.kind === "text" && m.turnId), "the reply");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn to settle");
    const detail = (await api("GET", `/api/bots/${bot.id}/activity/item?threadId=${bot.threadId}`)).body.item;
    const agent = detail.steps.find((step: any) => step.name === "Agent");
    expect(agent.subagent).toMatchObject({ description: "check the logs", prompt: "Read the server logs and list errors", type: "general-purpose" });
    expect(agent.subagent.result).toContain("Two errors found");
    expect(detail.steps.find((step: any) => step.name === "Read")).toMatchObject({ parentId: agent.id });
    expect(detail.steps.find((step: any) => step.name === "Bash")).not.toHaveProperty("parentId");
  }, 60_000);
});
