// A routine run's hand-offs on the job runtime (docs/runtime-contract.md §9):
// the real server, the isolated fake Claude as every engine, coordinate_bots
// from the run's own turn. A run that hands work on
// goes waiting until the runtime resumes it with the reports, as a routine
// turn; its hand-offs are rows in DATA_DIR/runtime.db, not a ledger of the
// routine's own. Every teammate turn now carries the agents server, so the
// fixture gates each turn on its own thread's gate file.
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";

/** Every resume of a requester opens with this (runtime/envelope.ts composeResume). */
const SETTLED = "Your downstream room requests have settled.";
const REPORT_FROM_PEER = "[Sagax report from @Routine peer";

describe("routine delegation through the isolated harness", () => {
  let fixture: VerificationServer;
  let source: any;
  let peer: any;
  let evidence: unknown[];
  const raw = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : { origin: fixture.info.url }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    if (method !== "GET") evidence.push({ method, path, body, status: response.status });
    return { status: response.status, body: value };
  };
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const { status, body: value } = await raw(method, path, body, token);
    expect(status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const file = (threadId: string, extension: string) => join(fixture.info.dataDir, `${threadId}.${extension}`);
  const finish = (threadId: string) => writeFileSync(file(threadId, "gate"), "finish isolated turn");
  const dump = async (threadId: string) => {
    let parsed: any;
    await expect.poll(() => {
      try {
        parsed = JSON.parse(readFileSync(file(threadId, "json"), "utf8"));
        return true;
      } catch {
        return false;
      }
    }, { timeout: 15_000 }).toBe(true);
    return parsed;
  };
  const runState = async (id: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === id);
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const botState = async (botId: string) => (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === botId);
  /** The runtime's rows, as the server reads them (DATA_DIR/runtime.db). */
  const rows = () => readHandoffs(fixture.info.dataDir);
  /** The peer's assignment under a run's root: it runs in the work thread the run's bot has with the peer. */
  const peerWork = (threadId: string) => rows().find((node) => node.botId === peer.id && node.parentId && rows().find((root) => root.id === node.parentId)?.threadId === threadId);
  const awaitPeerWork = async (threadId: string) => {
    await expect.poll(() => Boolean(peerWork(threadId)), { timeout: 15_000 }).toBe(true);
    return peerWork(threadId)!;
  };
  const token = async (threadId: string) => (await dump(threadId)).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN as string;
  const start = async () => {
    const { routine } = await api("POST", "/api/routines", {
      name: "Delegated report", prompt: "Ask the peer for evidence, then report its result.", botId: source.id,
      enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const { run } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("running");
    return await runState(run.id);
  };
  /** coordinate_bots from the run's own turn. */
  const delegate = async (threadId: string) => {
    const result = await api("POST", "/api/internal/coordinate-bots", { botIds: [peer.id], message: "Produce the fixture report." }, await token(threadId));
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({ botId: peer.id, outcome: "queued", requestId: expect.any(String) });
    expect(result.message).toContain("End your turn");
    return result;
  };
  /** The isolated fake runs every bot: one slot per bot makes "busy" mean busy. */
  const oneSlotPerBot = () => api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
  beforeEach(async () => {
    fixture = await launchVerificationServer();
    evidence = [{ fixture: fixture.info }];
    source = (await control(["new-bot", "--name", "Routine owner"]) as any).bot;
    peer = (await control(["new-bot", "--name", "Routine peer"]) as any).bot;
    const wrapper = join(fixture.info.dataDir, "routine-gated.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const at = process.argv.indexOf("--mcp-config");',
      'const thread = at < 0 ? "probe" : JSON.parse(readFileSync(process.argv[at + 1], "utf8")).mcpServers?.agents?.env?.SAGAX_THREAD_ID ?? "probe";',
      // Every bot turn carries the agents server now, the teammate's
      // included: each is gated on its own thread's gate file. A one-shot
      // text run (no agents server) completes on its own.
      'process.env.FAKE_CLAUDE_MODE = thread === "probe" ? "happy" : "slow";',
      `process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = join(${JSON.stringify(fixture.info.dataDir)}, thread + ".gate");`,
      `process.env.FAKE_CLAUDE_DUMP = join(${JSON.stringify(fixture.info.dataDir)}, thread + ".json");`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
  }, 30_000);
  afterEach(async () => {
    if (!fixture) return;
    const path = `${fixture.info.logPath}.json`;
    writeFileSync(path, JSON.stringify({ evidence, final: await api("GET", "/api/routines").catch(() => null),
      bots: await api("GET", "/api/bots?messages=0").catch(() => null), rows: rows() }, null, 2));
    console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath: path }));
    await fixture.close();
  });

  it("waits for a busy peer, then resumes the same routine as a routine turn and records the final report", async () => {
    await oneSlotPerBot();
    const peerThread = (await botState(peer.id)).threadId;
    await control(["send", "--bot", peer.id, "--text", "An existing task occupies the peer."]);
    expect((await dump(peerThread)).systemPrompt).not.toContain("Execute this routine now:");
    const run = await start();
    expect((await dump(run.threadId)).systemPrompt).toContain("Execute this routine now:");
    expect((await dump(run.threadId)).systemPrompt).toContain("use coordinate_bots for required handoffs");
    expect((await dump(run.threadId)).systemPrompt).toContain("after an accepted hand-off, end this turn for automatic resumption");
    const { receipts } = await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("waiting");
    expect((await runState(run.id)).attention).toContain("delegated");
    expect((await runState(run.id)).finishedAt).toBeUndefined();
    // The hand-off is the runtime's: queued behind the peer's one slot, in
    // the work thread the run's bot has with the peer, under the run's root.
    const work = await awaitPeerWork(run.threadId);
    expect(work).toMatchObject({ id: receipts[0].requestId, status: "queued", mode: "work", reply: "resume", text: "Produce the fixture report." });
    expect(work.threadId).not.toBe(peerThread);
    expect(rows().find((node) => node.id === work.parentId)).toMatchObject({ threadId: run.threadId, botId: source.id, status: "waiting" });
    finish(peerThread);
    // The peer's slot frees: its turn for the run starts and the gate ends it.
    await dump(work.threadId);
    finish(work.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 20_000 }).toBe("completed");
    const transcript = await messages(run.threadId);
    expect(transcript.some((message) => message.tool?.name === "Routine peer replied" && message.from?.botId === peer.id)).toBe(true);
    expect(transcript.some((message) => message.tool?.name?.startsWith("Resumed with Routine peer results"))).toBe(true);
    // The resume ran as a routine turn and its output is the run's report.
    const finished = await runState(run.id);
    expect(finished.output).toContain(SETTLED);
    expect(finished.output).toContain(REPORT_FROM_PEER);
    expect((await dump(run.threadId)).systemPrompt).toContain("Execute this routine now:");
    expect(peerWork(run.threadId)).toMatchObject({ status: "completed" });
    expect(rows().find((node) => node.id === work.parentId)?.status).toBe("completed");
    evidence.push({ waitedForBusyPeer: true, resumedRoutine: run.id, threadId: run.threadId, transcript });
  }, 60_000);

  it("completes the routine when the person denies its hand-off, instead of leaving it waiting", async () => {
    await api("PATCH", `/api/bots/${source.id}`, { approvePeerComms: true });
    const run = await start();
    // The route asks the person before anything is queued, so the call
    // stays open until the card is answered.
    const pending = raw("POST", "/api/internal/coordinate-bots", { botIds: [peer.id], message: "Produce the fixture report." }, await token(run.threadId));
    await expect.poll(async () => (await messages(run.threadId)).some((message) => message.card?.tool === "delegate_bot"), { timeout: 15_000 }).toBe(true);
    const card = (await messages(run.threadId)).find((message) => message.card?.tool === "delegate_bot");
    // The run's own turn is a root (every turn is one, docs/runtime-contract.md
    // §10 PR 4); nothing was handed out under it.
    expect(rows().map((node) => [Boolean(node.parentId), node.threadId])).toEqual([[false, run.threadId]]);
    await api("POST", `/api/bots/${source.id}/respond`, { threadId: run.threadId, requestId: card.card.requestId, behavior: "deny" });
    const denied = await pending;
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/denied by user/i);
    finish(run.threadId);
    // Nothing was handed out, so the run's own turn is its last.
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("completed");
    const transcript = await messages(run.threadId);
    expect(transcript.find((message) => message.card?.requestId === card.card.requestId).card.answered).toBe("deny");
    // Still nothing handed out; the run's root ended with its turn.
    await expect.poll(() => rows().map((node) => [Boolean(node.parentId), node.status]), { timeout: 10_000 }).toEqual([[false, "completed"]]);
    expect(Boolean((await botState(peer.id)).busy)).toBe(false);
    expect((await botState(peer.id)).tasks).toHaveLength(1);
    evidence.push({ deniedHandoffCompleted: true, transcript });
  }, 45_000);

  // The resume is a turn of the run's bot and takes a slot like any turn:
  // while every slot is held, the settled results wait and the run stays
  // waiting; a freed slot or a raised capacity lets the resume run.
  it.each([
    { capacity: 3, resume: "completion" },
    { capacity: 1, resume: "raise" },
  ])("resumes the waiting routine once a slot frees at capacity $capacity, on $resume", async ({ capacity, resume }) => {
    await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: capacity } });
    const run = await start();
    await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("waiting");
    // The peer's turn is held open while the source bot's slots fill up.
    const work = await awaitPeerWork(run.threadId);
    await dump(work.threadId);

    const occupiedThreads: string[] = [];
    for (let index = 0; index < capacity; index++) {
      const { task } = await api("POST", `/api/bots/${source.id}/tasks`, { title: `Occupied ${index}` });
      occupiedThreads.push(task.threadId);
      await api("POST", `/api/bots/${source.id}/messages`, { threadId: task.threadId, text: "Hold this task open." });
      await dump(task.threadId);
    }
    finish(work.threadId);
    await expect.poll(async () => (await messages(run.threadId)).some(
      (message) => message.tool?.name === "Routine peer replied" && message.from?.botId === peer.id,
    ), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => peerWork(run.threadId)?.status, { timeout: 15_000 }).toBe("completed");
    // The result is in and the root owes its resume, but no slot is free.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect((await runState(run.id)).status).toBe("waiting");
    expect(rows().find((node) => node.id === work.parentId)?.status).toBe("resume");
    expect((await messages(run.threadId)).some((message) => message.tool?.name?.startsWith("Resumed with"))).toBe(false);

    if (resume === "raise") await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: capacity + 1 } });
    else {
      finish(occupiedThreads[0]);
      await expect.poll(async () => (await botState(source.id)).tasks.find((task: any) => task.threadId === occupiedThreads[0]).busy, { timeout: 15_000 }).toBe(false);
    }
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("completed");
    expect((await runState(run.id)).output).toContain(SETTLED);
    expect((await messages(run.threadId)).some((message) => message.tool?.name?.startsWith("Resumed with Routine peer results"))).toBe(true);
    const bot = await botState(source.id);
    expect(occupiedThreads.map(threadId => bot.tasks.find((task: any) => task.threadId === threadId).busy))
      .toEqual(resume === "raise" ? [true] : [false, true, true]);
    evidence.push({ resumeWaitedForSlot: true, capacity, resume, runId: run.id, transcript: await messages(run.threadId) });
  }, 60_000);

  it("coordinates a new user request on a completed routine's thread without changing its recorded result", async () => {
    const run = await start();
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("completed");
    const finished = await runState(run.id);
    await expect.poll(async () => (await botState(source.id)).tasks.find((task: any) => task.threadId === run.threadId)?.busy).toBe(false);
    unlinkSync(file(run.threadId, "gate"));
    unlinkSync(file(run.threadId, "json"));
    await api("POST", `/api/bots/${source.id}/messages`, { threadId: run.threadId, text: "A new request: ask the peer for a fresh report." });
    const coordinated = await api("POST", "/api/internal/coordinate-bots", {
      botIds: [peer.id], message: "Produce a fresh fixture report.",
    }, await token(run.threadId));
    expect(coordinated.receipts).toHaveLength(1);
    const requestId = coordinated.receipts[0].requestId;
    // A person's request on the routine's thread is chat coordination: its
    // tree lives in the job runtime (runtime.db), under a person's root.
    const handoff = () => rows().find((node) => node.id === requestId)!;
    finish(run.threadId);
    await dump(handoff().threadId);
    finish(handoff().threadId);
    await expect.poll(async () => (await messages(run.threadId)).some(
      (message) => message.from?.botId === peer.id && message.roomRequest?.id === requestId && message.roomRequest.phase === "result",
    ), { timeout: 20_000 }).toBe(true);
    await control(["wait", "--bot", source.id, "--task", run.threadId]);
    expect(handoff().status).toBe("completed");
    expect(await runState(run.id)).toMatchObject({ status: "completed", finishedAt: finished.finishedAt, output: finished.output });
    evidence.push({ reusedCompletedExecution: true, transcript: await messages(run.threadId) });
  }, 45_000);

  it("does not dispatch an approved handoff after the routine was cancelled", async () => {
    await api("PATCH", `/api/bots/${source.id}`, { approvePeerComms: true });
    const run = await start();
    const pending = raw("POST", "/api/internal/coordinate-bots", { botIds: [peer.id], message: "Produce the fixture report." }, await token(run.threadId));
    await expect.poll(async () => (await messages(run.threadId)).some((message) => message.card?.tool === "delegate_bot"), { timeout: 15_000 }).toBe(true);
    const card = (await messages(run.threadId)).find((message) => message.card?.tool === "delegate_bot");
    await api("POST", `/api/routine-runs/${run.id}/cancel`);
    // A stale approval may be rejected or acknowledged as already settled;
    // either response must leave the cancelled work and target untouched.
    await fetch(`${fixture.info.url}/api/bots/${source.id}/respond`, {
      method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ threadId: run.threadId, requestId: card.card.requestId, behavior: "allow" }),
    });
    const outcome = await pending;
    expect(outcome.status, JSON.stringify(outcome.body)).toBeGreaterThanOrEqual(400);
    expect((await runState(run.id)).status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(rows().filter((node) => node.botId === peer.id)).toEqual([]);
    const target = await botState(peer.id);
    expect(Boolean(target.busy)).toBe(false);
    expect(target.tasks).toHaveLength(1);
    evidence.push({ cancelledHandoffNotDispatched: true, runId: run.id });
  }, 45_000);

  // A provider reload fails the run's own turn. Its queued hand-off is the
  // runtime's, not the run's: nothing drops it, it runs on the rebuilt
  // engine, and its report resumes the thread without reviving the run or
  // rewriting the failure it recorded.
  it("keeps a failed routine's queued hand-off on the runtime through a provider reload without reviving the run", async () => {
    await oneSlotPerBot();
    const peerThread = (await botState(peer.id)).threadId;
    await control(["send", "--bot", peer.id, "--text", "An existing task occupies the peer."]);
    await dump(peerThread);
    const run = await start();
    const { receipts } = await delegate(run.threadId);
    const work = await awaitPeerWork(run.threadId);
    expect(work).toMatchObject({ id: receipts[0].requestId, status: "queued" });
    // A workspace Anthropic key reaches the fixture's Claude engine, so the
    // save rebuilds it; it makes no credential probe or external request.
    await api("PUT", "/api/config", { anthropic: { key: "fixture-anthropic-key" } });
    await expect.poll(async () => (await runState(run.id))?.status).toBe("failed");
    const failed = await runState(run.id);
    const health = (await api("GET", "/api/routines")).routines.find((routine: any) => routine.id === run.routineId);
    expect(health.failureStreak).toBe(1);
    evidence.push({ failedRunHealth: health });
    // The reload also ended the peer's occupying turn: the queued hand-off
    // dispatches on the rebuilt engine and settles.
    await dump(work.threadId);
    finish(work.threadId);
    await expect.poll(() => peerWork(run.threadId)?.status, { timeout: 20_000 }).toBe("completed");
    await expect.poll(async () => (await messages(run.threadId)).some(
      (message) => message.tool?.name === "Routine peer replied" && message.from?.botId === peer.id,
    ), { timeout: 15_000 }).toBe(true);
    // Its report resumes the thread (a plain turn: the run is over), and the
    // run's recorded failure stands.
    finish(run.threadId);
    await expect.poll(() => rows().find((node) => node.id === work.parentId)?.status, { timeout: 20_000 }).toBe("completed");
    await control(["wait", "--bot", source.id, "--task", run.threadId]);
    expect(await runState(run.id)).toMatchObject({ status: "failed", finishedAt: failed.finishedAt, error: failed.error });
    expect((await api("GET", "/api/routines")).routines.find((routine: any) => routine.id === run.routineId).failureStreak).toBe(1);
    evidence.push({ providerReloadKeptRuntimeHandoff: true, runId: run.id, transcript: await messages(run.threadId) });
  }, 60_000);

  // Cancelling the run is the person stopping the requester's conversation
  // (docs/runtime-contract.md §2, stop awaiting): a teammate already mid-turn
  // keeps its process and its result is still recorded, but nothing resumes
  // the cancelled run's thread, and later user work there is not disturbed.
  it("does not revive a cancelled routine when its running peer replies during later user work", async () => {
    const run = await start();
    await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status).toBe("waiting");
    const work = await awaitPeerWork(run.threadId);
    await dump(work.threadId);
    await expect.poll(() => peerWork(run.threadId)?.status, { timeout: 15_000 }).toBe("running");
    await api("POST", `/api/routine-runs/${run.id}/cancel`);
    await expect.poll(() => rows().find((node) => node.id === work.parentId)?.status, { timeout: 10_000 }).toBe("cancelled");
    unlinkSync(file(run.threadId, "gate"));
    unlinkSync(file(run.threadId, "json"));
    await api("POST", `/api/bots/${source.id}/messages`, { threadId: run.threadId, text: "A new independent request after cancellation." });
    await dump(run.threadId);
    finish(work.threadId);
    await expect.poll(() => peerWork(run.threadId)?.status, { timeout: 15_000 }).toBe("completed");
    finish(run.threadId);
    await control(["wait", "--bot", source.id, "--task", run.threadId]);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const transcript = await messages(run.threadId);
    expect(transcript.some((message) => message.text?.includes(SETTLED))).toBe(false);
    expect(transcript.some((message) => message.tool?.name?.startsWith("Resumed with"))).toBe(false);
    expect((await runState(run.id)).status).toBe("cancelled");
    expect(Boolean((await botState(source.id)).busy)).toBe(false);
    evidence.push({ cancelledPeerDidNotResumeNewUserTurn: true, transcript });
  }, 45_000);
});
