import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";
import {
  FIXTURE_ANTHROPIC_KEY_V2,
  seedClaudeApiKeyForInterrupt,
} from "./testing/seed-claude-api-key-interrupt.ts";

describe("routine delegation through the isolated harness", () => {
  let fixture: VerificationServer;
  let source: any;
  let peer: any;
  let evidence: unknown[];
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : { origin: fixture.info.url }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(value)}`).toBe(true);
    if (method !== "GET") evidence.push({ method, path, body, status: response.status });
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
  const start = async () => {
    const { routine } = await api("POST", "/api/routines", {
      name: "Delegated report", prompt: "Ask the peer for evidence, then report its result.", botId: source.id,
      enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const { run } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("running");
    return await runState(run.id);
  };
  /** The thread the job runtime runs the routine's delegation in (lot 3). */
  const workThread = async () => {
    let threadId = "";
    await expect.poll(() => (threadId = readHandoffs(fixture.info.dataDir).find((node) => node.botId === peer.id)?.threadId ?? ""), { timeout: 15_000 }).not.toBe("");
    return threadId;
  };
  const delegate = async (threadId: string) => {
    const launched = await dump(threadId);
    const result = await api("POST", "/api/internal/delegate-bot", { toBotId: peer.id, message: "Produce the fixture report." }, launched.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN);
    expect(result.queued).toBe(true);
    return result;
  };
  beforeEach(async () => {
    // Seed so a later anthropic.key save rebuilds this fixture's claude
    // instance (product scopes the key to claudeApi unless requireApiKey).
    fixture = await launchVerificationServer(
      process.env,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      { prepareDataDir: seedClaudeApiKeyForInterrupt },
    );
    evidence = [{ fixture: fixture.info }];
    source = (await control(["new-bot", "--name", "Routine owner"]) as any).bot;
    peer = (await control(["new-bot", "--name", "Routine peer"]) as any).bot;
    const wrapper = join(fixture.info.dataDir, "routine-gated.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'import { existsSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const at = process.argv.indexOf("--mcp-config");',
      'const agentsEnv = at < 0 ? undefined : JSON.parse(readFileSync(process.argv[at + 1], "utf8")).mcpServers?.agents?.env;',
      // A delegated peer turn one hop away keeps its agents server since
      // 2026-10-28 (SAGAX_PEER_HOP, only the peer tools leave): it is the
      // "probe" turn here, as a turn with no agents server was before. Let
      // that actual peer turn complete; gate only the source/occupied turns.
      'const thread = !agentsEnv || agentsEnv.SAGAX_PEER_HOP === "1" ? "probe" : agentsEnv.SAGAX_THREAD_ID ?? "probe";',
      `process.env.FAKE_CLAUDE_MODE = thread === "probe" && !existsSync(${JSON.stringify(join(fixture.info.dataDir, "gate-peer"))}) ? "happy" : "slow";`,
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
      bots: await api("GET", "/api/bots?messages=0").catch(() => null) }, null, 2));
    console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath: path }));
    await fixture.close();
  });

  // Lot 3: a routine thread's own delegate_bot call runs on the job runtime
  // (docs/runtime-contract.md): the work goes to the peer's work thread and is
  // admitted by slot, the run waits on it, and its report resumes the run once.
  it("waits for a busy peer, then resumes the same routine and records the final report", async () => {
    await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    const { bots } = await api("GET", "/api/bots");
    const peerThread = bots.find((bot: any) => bot.id === peer.id).threadId;
    await control(["send", "--bot", peer.id, "--text", "An existing task occupies the peer."]);
    expect((await dump(peerThread)).systemPrompt).not.toContain("Execute this routine now:");
    const run = await start();
    expect((await dump(run.threadId)).systemPrompt).toContain("Execute this routine now:");
    await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("waiting");
    expect((await runState(run.id)).finishedAt).toBeUndefined();
    // The peer's only slot is taken: the work waits queued.
    expect(readHandoffs(fixture.info.dataDir).find((node) => node.botId === peer.id)?.status).toBe("queued");
    finish(peerThread);
    const work = await workThread();
    await dump(work);
    finish(work);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 20_000 }).toBe("completed");
    const transcript = await messages(run.threadId);
    expect(transcript.some((message) => message.tool?.name?.startsWith("Routine peer replied"))).toBe(true);
    expect(transcript.some((message) => message.tool?.name?.startsWith("Resumed with Routine peer results"))).toBe(true);
    evidence.push({ waitedForBusyPeer: true, resumedRoutine: run.id, threadId: run.threadId, transcript });
  }, 60_000);

  it("wakes the routine with a denied handoff instead of leaving it waiting forever", async () => {
    await api("PATCH", `/api/bots/${source.id}`, { approvePeerComms: true });
    const run = await start();
    await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await messages(run.threadId)).some((message) => message.card?.tool === "delegate_bot"), { timeout: 15_000 }).toBe(true);
    const card = (await messages(run.threadId)).find((message) => message.card?.tool === "delegate_bot");
    await api("POST", `/api/bots/${source.id}/respond`, { threadId: run.threadId, requestId: card.card.requestId, behavior: "deny" });
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("completed");
    const transcript = await messages(run.threadId);
    expect(transcript.some((message) => /denied/i.test(message.text ?? message.tool?.name ?? ""))).toBe(true);
    expect(readHandoffs(fixture.info.dataDir).find((node) => node.botId === peer.id)).toMatchObject({ status: "failed", executions: 0 });
    evidence.push({ deniedHandoffResumed: true, transcript });
  }, 45_000);

  it("coordinates a new user request on a completed routine's thread without changing its recorded result", async () => {
    const run = await start();
    finish(run.threadId);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("completed");
    const finished = await runState(run.id);
    await expect.poll(async () => {
      const bot = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === source.id);
      return bot.tasks.find((task: any) => task.threadId === run.threadId)?.busy;
    }).toBe(false);
    unlinkSync(file(run.threadId, "gate"));
    unlinkSync(file(run.threadId, "json"));
    await api("POST", `/api/bots/${source.id}/messages`, { threadId: run.threadId, text: "A new request: ask the peer for a fresh report." });
    const launched = await dump(run.threadId);
    const coordinated = await api("POST", "/api/internal/coordinate-bots", {
      botIds: [peer.id], message: "Produce a fresh fixture report.",
    }, launched.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN);
    expect(coordinated.receipts).toHaveLength(1);
    const requestId = coordinated.receipts[0].requestId;
    // A person's request on the routine's thread is chat coordination: its
    // tree lives in the job runtime (runtime.db), not the routine ledger.
    const handoff = () => readHandoffs(fixture.info.dataDir).find((node) => node.id === requestId)!;
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
    await delegate(run.threadId);
    finish(run.threadId);
    await expect.poll(async () => (await messages(run.threadId)).some((message) => message.card?.tool === "delegate_bot"), { timeout: 15_000 }).toBe(true);
    const card = (await messages(run.threadId)).find((message) => message.card?.tool === "delegate_bot");
    await api("POST", `/api/routine-runs/${run.id}/cancel`);
    // A stale approval may be rejected or acknowledged as already settled;
    // either response must leave the cancelled work and target untouched.
    await fetch(`${fixture.info.url}/api/bots/${source.id}/respond`, {
      method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ threadId: run.threadId, requestId: card.card.requestId, behavior: "allow" }),
    });
    expect((await runState(run.id)).status).toBe("cancelled");
    const target = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === peer.id);
    expect(Boolean(target.busy)).toBe(false);
    expect(target.messages.some((message: any) => message.role === "user")).toBe(false);
    evidence.push({ cancelledHandoffNotDispatched: true, runId: run.id });
  }, 45_000);

  it("a routine run failed by a provider reload stops awaiting its delegation: the peer's work never resumes the run", async () => {
    await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    const { bots } = await api("GET", "/api/bots");
    const peerThread = bots.find((bot: any) => bot.id === peer.id).threadId;
    await control(["send", "--bot", peer.id, "--text", "An existing task occupies the peer."]);
    await dump(peerThread);
    const run = await start();
    await delegate(run.threadId);
    // Change the seeded key so the fixture claude launch differs (claudeApi
    // alone would not stop this turn; see seedClaudeApiKeyForInterrupt).
    await api("PUT", "/api/config", { anthropic: { key: FIXTURE_ANTHROPIC_KEY_V2 } });
    await expect.poll(async () => (await runState(run.id))?.status).toBe("failed");
    // Work that never started is dropped with the run (contract: Stop).
    await expect.poll(() => readHandoffs(fixture.info.dataDir).find((node) => node.botId === peer.id)?.status).toBe("cancelled");
    evidence.push({ providerFailureDroppedQueuedWork: true, runId: run.id });
  }, 45_000);

  it("does not revive a cancelled routine when an already-running peer replies during later user work", async () => {
    const run = await start();
    await delegate(run.threadId);
    finish(run.threadId);
    const work = await workThread();
    await dump(work);
    await expect.poll(async () => (await runState(run.id))?.status).toBe("waiting");
    await api("POST", `/api/routine-runs/${run.id}/cancel`);
    unlinkSync(file(run.threadId, "gate"));
    unlinkSync(file(run.threadId, "json"));
    await api("POST", `/api/bots/${source.id}/messages`, { threadId: run.threadId, text: "A new independent request after cancellation." });
    await dump(run.threadId);
    finish(work);
    await expect.poll(async () => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === peer.id)?.busy,
      { timeout: 15_000 }).toBe(false);
    finish(run.threadId);
    await control(["wait", "--bot", source.id, "--task", run.threadId]);
    const transcript = await messages(run.threadId);
    expect(transcript.some((message) => message.tool?.name?.startsWith("Resumed with"))).toBe(false);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 10_000 }).toBe("cancelled");
    evidence.push({ cancelledPeerDidNotResumeNewUserTurn: true, transcript });
  }, 45_000);
});
