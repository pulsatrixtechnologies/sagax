// Lot 3 of the Grok convergence plan (docs/plans/2026-10-31-grok-convergence.md):
// reliable execution. Each case drives the real server, the real agents MCP
// proxy and scripted fake engines in an owned temporary home, injects one
// failure (a provider usage limit, a Stop, a restart during a tool call,
// concurrent sends) and checks what the job runtime promises
// (docs/runtime-contract.md): no accepted message lost, one child dispatch,
// one result, one source wake, and a terminal or explicit waiting state.
// No provider is called and no user data is read.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";
import { openSse } from "./testing/sse.ts";
import { checkInvariants } from "./runtime/invariants.ts";
import { openRuntimeStore } from "./runtime/store.ts";

const BACKUP = { instanceId: "backup", model: "claude-sonnet-5" };

interface Fixture {
  session: VerificationServer;
  url: string;
  dataDir: string;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  cli: (...args: string[]) => Promise<any>;
  plan: Record<string, any>;
  save: () => void;
  evidence: () => any[];
  messages: (threadId: string) => Promise<any[]>;
  restart: (env?: NodeJS.ProcessEnv) => Promise<void>;
  stop: () => Promise<void>;
}

/** A scripted server with a second Claude engine the person pays for by
 * key: the backup a usage limit moves a conversation to. */
async function withFixture(test: (f: Fixture) => Promise<void>, options: { backup?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = session.info;
  const planPath = join(dataDir, "room-plan.json");
  let server: ChildProcess | undefined;
  const start = async (extra: NodeJS.ProcessEnv = {}) => {
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), ...extra },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 30_000, interval: 200 }).toBe(true);
  };
  const stop = async () => { await waitForExit(server, { signal: "SIGTERM" }); server = undefined; };
  try {
    await waitForExit(session.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (options.backup !== false) config.instances.backup = {
      driver: "claudeAgent", displayName: "Backup fixture", config: { ...config.instances.claude.config },
      environment: { ...config.instances.claude.environment, ANTHROPIC_API_KEY: "fixture-only-not-a-key" },
    };
    writeFileSync(configPath, JSON.stringify(config));
    await start(options.env);
    const api = (path: string, body?: unknown, method = "POST") =>
      request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, url) as Promise<any>;
    const plan: Record<string, any> = {};
    await test({
      session, url, dataDir, api, plan,
      cli: (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: url } }) as Promise<any>,
      save: () => writeFileSync(planPath, JSON.stringify(plan)),
      evidence: () => existsSync(`${planPath}.evidence.jsonl`)
        ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [],
      messages: async (threadId: string) => (await api(`/api/threads/${threadId}/messages?limit=500`, undefined, "GET")).messages,
      restart: async (env = options.env ?? {}) => { await stop(); await start(env); },
      stop,
    });
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await session.close();
  }
}

/** The contract's invariants (docs/runtime-contract.md §7, I11 included)
 * over the server's own runtime.db, once nothing runs. */
const runtimeInvariants = (f: Fixture): string[] => {
  const store = openRuntimeStore(join(f.dataDir, "runtime.db"));
  try { return checkInvariants(store, { running: new Set(), parked: new Set() }); } finally { store.close(); }
};

const settledBots = async (f: Fixture, ids: string[]) => {
  await expect.poll(async () => {
    const bots = (await f.api("/api/bots?messages=0", undefined, "GET")).bots as any[];
    return ids.every((id) => {
      const bot = bots.find((entry) => entry.id === id);
      return bot && !bot.busy && !bot.waitingForTeammates;
    });
  }, { timeout: 60_000, interval: 250 }).toBe(true);
};

it("a provider limit after coordinate_bots dispatches the child once and wakes the requester once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.txt");
  writeFileSync(limitFile, "You've hit your weekly limit · resets Dec 31 at 11:30pm (UTC)");
  f.plan[chief.id] = {
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    usageLimitFile: limitFile, reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { reply: "CSV export built" };
  f.save();
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId: chief.activeTaskId });
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length, { timeout: 60_000, interval: 250 })
    .toBeGreaterThanOrEqual(1);
  await settledBots(f, [chief.id, lead.id]);
  // Give a late duplicate the time to show up.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const turns = f.evidence();
  const leadTurns = turns.filter((turn) => turn.botId === lead.id);
  const chiefTurns = turns.filter((turn) => turn.botId === chief.id);
  const messages = await f.messages(chief.activeTaskId);
  const finals = messages.filter((message) => message.role === "bot" && message.kind === "text" && message.text === "CSV export delivered");
  const dropped = messages.filter((message) => /dropped/.test(message.tool?.name ?? ""));
  const report = { leadTurns: leadTurns.length, chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed, model: turn.model })),
    finals: finals.length, dropped: dropped.map((message) => message.tool.name), nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status, parent: node.parentId ? "child" : "root" })) };
  writeFileSync(join(f.session.info.logPath + ".limit-coordination.json"), JSON.stringify(report, null, 2));
  expect(runtimeInvariants(f)).toEqual([]);
  // One teammate turn, one wake of the requester, one final answer.
  expect(report.leadTurns, JSON.stringify(report)).toBe(1);
  expect(chiefTurns.filter((turn) => turn.resumed), JSON.stringify(report)).toHaveLength(1);
  expect(report.finals, JSON.stringify(report)).toBe(1);
  expect(report.dropped, JSON.stringify(report)).toEqual([]);
  // The resent request ran on the backup.
  const moved = (await f.api("/api/bots", undefined, "GET")).bots.find((bot: any) => bot.id === chief.id);
  expect(moved.tasks.find((task: any) => task.threadId === chief.activeTaskId).modelSelection.instanceId, JSON.stringify(report)).toBe(BACKUP.instanceId);
}), 150_000);

it("a Stop while a limited request waits for its reset is final: nothing is sent again and the requester never resumes", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.json");
  const leadGate = join(f.dataDir, "lead-gate");
  // No backup: the request waits for the reset, a few seconds away.
  const resetsAt = Math.ceil(Date.now() / 1_000) + 6;
  writeFileSync(limitFile, JSON.stringify({ text: "You've hit your session limit", resetsAt }));
  f.plan[chief.id] = {
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    usageLimitFile: limitFile, reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.tool?.limitFailover?.kind === "waiting"),
    { timeout: 45_000, interval: 250 }).toBe(true);
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === lead.id).length + readHandoffs(f.dataDir).filter((node) => node.botId === lead.id && node.status === "running").length,
    { timeout: 30_000, interval: 250 }).toBeGreaterThanOrEqual(1);
  // The person stops the conversation while it waits for the reset.
  await f.api(`/api/bots/${chief.id}/interrupt`, { threadId });
  await expect.poll(() => readHandoffs(f.dataDir).find((node) => node.botId === chief.id && !node.parentId)?.status, { timeout: 15_000 }).toBe("cancelled");
  // The teammate already at work finishes and reports; the reset passes.
  writeFileSync(leadGate, "finish");
  await expect.poll(() => Date.now(), { timeout: 30_000, interval: 250 }).toBeGreaterThan(resetsAt * 1_000 + 3_000);
  await settledBots(f, [chief.id, lead.id]);
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const report = { chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed })), leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status })) };
  // The stopped request ran once (its limited turn) and was never sent again.
  expect(chiefTurns, JSON.stringify(report)).toHaveLength(1);
  expect(report.leadTurns, JSON.stringify(report)).toBe(1);
  expect((await f.messages(threadId)).some((message) => message.text === "CSV export delivered"), JSON.stringify(report)).toBe(false);
  expect(runtimeInvariants(f)).toEqual([]);
}, { backup: false, env: { SAGAX_TEST_LIMIT_AFTER_RESET_MS: "300" } }), 150_000);

it("a restart while a limited request waits for its reset keeps one root: the teammate's turn reruns once and the request is answered once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.json");
  const leadGate = join(f.dataDir, "lead-gate");
  const leadReady = join(f.dataDir, "lead-ready");
  const resetsAt = Math.ceil(Date.now() / 1_000) + 40;
  writeFileSync(limitFile, JSON.stringify({ text: "You've hit your session limit", resetsAt }));
  f.plan[chief.id] = {
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    usageLimitFile: limitFile, reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  // The teammate is mid-tool (its turn holds) when the server restarts.
  f.plan[lead.id] = { readyFile: leadReady, gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.tool?.limitFailover?.kind === "waiting"),
    { timeout: 45_000, interval: 250 }).toBe(true);
  await expect.poll(() => existsSync(leadReady), { timeout: 30_000, interval: 100 }).toBe(true);
  await f.restart();
  // After the restart the cut teammate turn runs again once and settles.
  writeFileSync(leadGate, "finish");
  await expect.poll(() => Date.now(), { timeout: 60_000, interval: 500 }).toBeGreaterThan(resetsAt * 1_000 + 4_000);
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const finals = (await f.messages(threadId)).filter((message) => message.role === "bot" && message.kind === "text" && message.text === "CSV export delivered");
  const report = { chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed })), leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    finals: finals.length, nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status, restarts: node.restarts })) };
  writeFileSync(`${f.session.info.logPath}.limit-restart.json`, JSON.stringify(report, null, 2));
  expect(report.nodes.filter((node) => node.bot === "lead"), JSON.stringify(report)).toHaveLength(1);
  expect(report.finals, JSON.stringify(report)).toBe(1);
  expect(chiefTurns.filter((turn) => turn.resumed), JSON.stringify(report)).toHaveLength(1);
  expect(runtimeInvariants(f)).toEqual([]);
}, { backup: false, env: { SAGAX_TEST_LIMIT_AFTER_RESET_MS: "300" } }), 200_000);

/** A routine of `botId`, run now; resolves with its run once it is under way. */
async function runRoutine(f: Fixture, botId: string, prompt: string, enabled = false): Promise<{ routineId: string; runId: string }> {
  const { routine } = await f.api("/api/routines", {
    name: "Convergence routine", prompt, botId, enabled,
    schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
  });
  const { run } = await f.api(`/api/routines/${routine.id}/run`, {});
  return { routineId: routine.id, runId: run.id };
}
const routineRuns = async (f: Fixture, routineId: string) =>
  ((await f.api("/api/routines", undefined, "GET")).runs as any[]).filter((run) => run.routineId === routineId);

it("a routine run hands work out on the job runtime: it waits, resumes once with the result and completes", () => withFixture(async (f) => {
  const owner = (await f.cli("new-bot", "--name", "Routine owner")).bot;
  const peer = (await f.cli("new-bot", "--name", "Routine peer")).bot;
  f.plan[owner.id] = {
    steps: [{ arguments: { bot_ids: [peer.id], message: "Produce the nightly report" } }],
    reply: "Asked the peer", resumeReply: "ROUTINE_REPORT_DELIVERED",
  };
  f.plan[peer.id] = { reply: "Nightly report ready" };
  f.save();
  const { routineId, runId } = await runRoutine(f, owner.id, "Ask the peer for the nightly report, then report it.");
  await expect.poll(async () => (await routineRuns(f, routineId)).find((run) => run.id === runId)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
  await settledBots(f, [owner.id, peer.id]);
  const run = (await routineRuns(f, routineId)).find((entry) => entry.id === runId);
  const ownerTurns = f.evidence().filter((turn) => turn.botId === owner.id);
  const report = { run: { status: run.status, output: run.output }, ownerTurns: ownerTurns.map((turn) => turn.resumed),
    peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === owner.id ? "owner" : "peer", status: node.status })) };
  // The routine turn was offered coordinate_bots (not the legacy ledger), its
  // run waited for the teammate and the one resume completed it.
  const tools = ownerTurns[0].evidence[0].result.tools.map((tool: any) => tool.name);
  expect(tools).toContain("coordinate_bots");
  expect(tools).not.toContain("delegate_bot");
  expect(report.peerTurns, JSON.stringify(report)).toBe(1);
  expect(ownerTurns.filter((turn) => turn.resumed), JSON.stringify(report)).toHaveLength(1);
  expect(run.output ?? "", JSON.stringify(report)).toContain("ROUTINE_REPORT_DELIVERED");
  expect(report.nodes, JSON.stringify(report)).toEqual([{ bot: "owner", status: "completed" }, { bot: "peer", status: "completed" }]);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("a routine run limited after handing work out runs again on the backup without a second dispatch or a resume of the failed run", () => withFixture(async (f) => {
  const owner = (await f.cli("new-bot", "--name", "Routine owner")).bot;
  const peer = (await f.cli("new-bot", "--name", "Routine peer")).bot;
  const limitFile = join(f.dataDir, "owner-limited.txt");
  const peerGate = join(f.dataDir, "peer-gate");
  const peerReady = join(f.dataDir, "peer-ready");
  writeFileSync(limitFile, "You've hit your weekly limit · resets Dec 31 at 11:30pm (UTC)");
  f.plan[owner.id] = {
    steps: [{ arguments: { bot_ids: [peer.id], message: "Produce the nightly report" } }],
    // The limit hits only once the peer is mid-turn.
    gateFile: peerReady, usageLimitFile: limitFile, reply: "Asked the peer", resumeReply: "ROUTINE_REPORT_DELIVERED",
  };
  // The peer is still at work when the first run fails and the second asks again.
  f.plan[peer.id] = { readyFile: peerReady, gateFile: peerGate, reply: "Nightly report ready" };
  f.save();
  // Enabled (its next scheduled run an hour away): a usage limit reruns only an enabled routine.
  const { routineId } = await runRoutine(f, owner.id, "Ask the peer for the nightly report, then report it.", true);
  await expect.poll(async () => (await routineRuns(f, routineId)).length, { timeout: 60_000, interval: 250 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === owner.id).length, { timeout: 60_000, interval: 250 }).toBeGreaterThanOrEqual(2);
  writeFileSync(peerGate, "finish");
  await expect.poll(async () => (await routineRuns(f, routineId)).some((run) => run.status === "completed"), { timeout: 60_000, interval: 250 }).toBe(true);
  await settledBots(f, [owner.id, peer.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const runs = await routineRuns(f, routineId);
  const ownerTurns = f.evidence().filter((turn) => turn.botId === owner.id);
  const report = { runs: runs.map((run) => ({ status: run.status, error: run.error, output: run.output })),
    ownerTurns: ownerTurns.map((turn) => ({ resumed: turn.resumed, thread: turn.threadId })),
    peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === owner.id ? "owner" : "peer", status: node.status })) };
  writeFileSync(`${f.session.info.logPath}.routine-limit.json`, JSON.stringify(report, null, 2));
  expect(report.peerTurns, JSON.stringify(report)).toBe(1);
  // The failed run's request stopped awaiting (as a Stop does); the teammate
  // it had already started finished once, and the rerun's same request
  // joined it instead of starting a second turn.
  expect(report.nodes, JSON.stringify(report)).toEqual([{ bot: "owner", status: "cancelled" }, { bot: "peer", status: "completed" },
    { bot: "owner", status: "completed" }, { bot: "peer", status: "completed" }]);
  expect(runs.filter((run) => run.status === "completed"), JSON.stringify(report)).toHaveLength(1);
  expect(ownerTurns.filter((turn) => turn.resumed), JSON.stringify(report)).toHaveLength(1);
  expect(runtimeInvariants(f)).toEqual([]);
}), 200_000);

it("a restart while a routine run waits on its teammate keeps the run: the teammate's cut turn reruns once and the run completes once", () => withFixture(async (f) => {
  const owner = (await f.cli("new-bot", "--name", "Routine owner")).bot;
  const peer = (await f.cli("new-bot", "--name", "Routine peer")).bot;
  const peerGate = join(f.dataDir, "peer-gate");
  const peerReady = join(f.dataDir, "peer-ready");
  f.plan[owner.id] = {
    steps: [{ arguments: { bot_ids: [peer.id], message: "Produce the nightly report" } }],
    reply: "Asked the peer", resumeReply: "ROUTINE_REPORT_DELIVERED",
  };
  f.plan[peer.id] = { readyFile: peerReady, gateFile: peerGate, reply: "Nightly report ready" };
  f.save();
  const { routineId, runId } = await runRoutine(f, owner.id, "Ask the peer for the nightly report, then report it.");
  await expect.poll(async () => (await routineRuns(f, routineId)).find((run) => run.id === runId)?.status, { timeout: 60_000, interval: 250 }).toBe("waiting");
  await expect.poll(() => existsSync(peerReady), { timeout: 30_000, interval: 100 }).toBe(true);
  // The peer is mid-tool: Sagax restarts.
  await f.restart();
  expect((await routineRuns(f, routineId)).find((run) => run.id === runId)?.status).toBe("waiting");
  writeFileSync(peerGate, "finish");
  await expect.poll(async () => (await routineRuns(f, routineId)).find((run) => run.id === runId)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
  await settledBots(f, [owner.id, peer.id]);
  const run = (await routineRuns(f, routineId)).find((entry) => entry.id === runId);
  const ownerTurns = f.evidence().filter((turn) => turn.botId === owner.id);
  const peerNodes = readHandoffs(f.dataDir).filter((node) => node.botId === peer.id);
  const report = { run: { status: run.status, output: run.output }, ownerTurns: ownerTurns.map((turn) => turn.resumed),
    peerNodes: peerNodes.map((node) => ({ status: node.status, restarts: node.restarts, executions: node.executions })) };
  expect(peerNodes, JSON.stringify(report)).toHaveLength(1);
  expect(peerNodes[0], JSON.stringify(report)).toMatchObject({ status: "completed", restarts: 1 });
  expect(ownerTurns.filter((turn) => turn.resumed), JSON.stringify(report)).toHaveLength(1);
  expect(run.output ?? "", JSON.stringify(report)).toContain("ROUTINE_REPORT_DELIVERED");
  expect(runtimeInvariants(f)).toEqual([]);
}), 200_000);

it("old entrypoint: delegate_bot from a chat turn is an alias of coordinate_bots on the runtime, readable with check_delegation", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  f.plan[chief.id] = {
    steps: [
      { internal: { path: "/api/internal/delegate-bot", body: { toBotId: lead.id, message: "Build the CSV export" }, saveAs: "task" } },
      // The same request again (a retried call after a dropped connection): one dispatch.
      { internal: { path: "/api/internal/delegate-bot", body: { toBotId: lead.id, message: "Build the CSV export" } } },
      // Not readable during the turn that delegated it.
      { internal: { method: "GET", path: "/api/internal/delegations/{{task}}" } },
    ],
    resumeSteps: [{ internal: { method: "GET", path: "/api/internal/delegations/{{task}}" } }],
    reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { reply: "CSV export built" };
  f.save();
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId: chief.activeTaskId });
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length, { timeout: 60_000, interval: 250 }).toBe(1);
  await settledBots(f, [chief.id, lead.id]);
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const first = chiefTurns[0].evidence.filter((entry: any) => entry.internal).map((entry: any) => entry.internal);
  const resumed = chiefTurns.find((turn) => turn.resumed).evidence.filter((entry: any) => entry.internal).map((entry: any) => entry.internal);
  const nodes = readHandoffs(f.dataDir);
  const child = nodes.find((node) => node.botId === lead.id)!;
  const report = { first, resumed, nodes: nodes.map((node) => ({ id: node.id, bot: node.botId === chief.id ? "chief" : "lead", status: node.status })) };
  expect(first[0], JSON.stringify(report)).toMatchObject({ status: 200, body: { queued: true, taskId: child.id, toBotName: "Engineering lead" } });
  expect(first[1], JSON.stringify(report)).toMatchObject({ status: 200, body: { queued: true, taskId: child.id, duplicate: true } });
  expect(first[2].status, JSON.stringify(report)).toBe(409);
  expect(resumed[0], JSON.stringify(report)).toMatchObject({ status: 200, body: { status: "done", toBotName: "Engineering lead", result: "CSV export built" } });
  expect(f.evidence().filter((turn) => turn.botId === lead.id), JSON.stringify(report)).toHaveLength(1);
  expect(nodes, JSON.stringify(report)).toHaveLength(2);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("concurrent sends while the requester waits on a teammate: every accepted message lands once, the teammate runs once, the requester resumes once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const leadGate = join(f.dataDir, "lead-gate");
  f.plan[chief.id] = {
    byPrompt: [
      { promptIncludes: "Your downstream room requests have settled.", plan: { resumeReply: "CSV export delivered" } },
      { promptIncludes: "FOLLOWUP", plan: { reply: "Noted the follow-up" } },
    ],
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  await expect.poll(async () => {
    const bot = ((await f.api("/api/bots?messages=0", undefined, "GET")).bots as any[]).find((entry) => entry.id === chief.id);
    return { busy: bot.busy, waiting: bot.waitingForTeammates };
  }, { timeout: 30_000, interval: 200 }).toEqual({ busy: false, waiting: true });
  // Three sends at once: two messages, and a retry of the first with its sendId.
  const sendA = "FOLLOWUP_A_utf8_please_0001";
  const sendB = "FOLLOWUP_B_and_a_header_0002";
  const results = await Promise.allSettled([
    f.api(`/api/bots/${chief.id}/messages`, { text: "FOLLOWUP A: make it UTF-8.", threadId, sendId: sendA }),
    f.api(`/api/bots/${chief.id}/messages`, { text: "FOLLOWUP B: add a header row.", threadId, sendId: sendB }),
    f.api(`/api/bots/${chief.id}/messages`, { text: "FOLLOWUP A: make it UTF-8.", threadId, sendId: sendA }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled"), JSON.stringify(results)).toHaveLength(3);
  // Every accepted message reaches the requester: in a turn's own prompt, or
  // steered into the turn running then (shown as such), and a reply follows.
  await expect.poll(async () => {
    const lines = await f.messages(threadId);
    const told = f.evidence().filter((turn) => turn.botId === chief.id).map((turn) => JSON.stringify(turn.prompt)).join("\n");
    const reached = (text: string) => lines.some((m) => m.role === "user" && m.text?.startsWith(text) && (m.steered || told.includes(text)));
    const lastUser = lines.findLastIndex((m) => m.role === "user");
    return reached("FOLLOWUP A") && reached("FOLLOWUP B") && lines.slice(lastUser + 1).some((m) => m.role === "bot" && m.kind === "text");
  }, { timeout: 45_000, interval: 250 }).toBe(true);
  writeFileSync(leadGate, "finish");
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length, { timeout: 60_000, interval: 250 }).toBe(1);
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const messages = await f.messages(threadId);
  const said = (text: string) => messages.filter((message) => message.role === "user" && message.text === text).length;
  const report = { a: said("FOLLOWUP A: make it UTF-8."), b: said("FOLLOWUP B: add a header row."),
    leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    chiefResumes: f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length,
    finals: messages.filter((message) => message.role === "bot" && message.text === "CSV export delivered").length };
  expect(report, JSON.stringify(report)).toEqual({ a: 1, b: 1, leadTurns: 1, chiefResumes: 1, finals: 1 });
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("old entrypoint: an external runtime's delegate_bot is a runtime poll root; it reads its result and nothing wakes the gateway bot", () => withFixture(async (f) => {
  const gateway = (await f.cli("new-bot", "--name", "Gateway")).bot;
  const peer = (await f.cli("new-bot", "--name", "Peer")).bot;
  const token = "convergence-external-runtime-token-0123456789";
  writeFileSync(join(f.dataDir, "external-runtimes.json"), JSON.stringify({ [gateway.id]: { token, threadId: gateway.activeTaskId } }), { mode: 0o600 });
  f.plan[peer.id] = { reply: "External work done" };
  f.save();
  const asRuntime = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(f.url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const sent = await asRuntime("POST", "/api/internal/delegate-bot", { toBotId: peer.id, message: "Do the external work" });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body).toMatchObject({ queued: true, taskId: expect.any(String) });
  await expect.poll(async () => (await asRuntime("GET", `/api/internal/delegations/${sent.body.taskId}`)).body.status, { timeout: 30_000, interval: 250 }).toBe("done");
  expect((await asRuntime("GET", `/api/internal/delegations/${sent.body.taskId}`)).body).toMatchObject({ status: "done", result: "External work done" });
  await settledBots(f, [gateway.id, peer.id]);
  const nodes = readHandoffs(f.dataDir);
  expect(nodes.map((node) => ({ bot: node.botId === gateway.id ? "gateway" : "peer", status: node.status }))).toEqual([
    { bot: "gateway", status: "completed" }, { bot: "peer", status: "completed" }]);
  // The gateway's own engine never ran: it polls its result.
  expect(f.evidence().filter((turn) => turn.botId === gateway.id)).toHaveLength(0);
  expect(f.evidence().filter((turn) => turn.botId === peer.id)).toHaveLength(1);
  expect(runtimeInvariants(f)).toEqual([]);
}), 120_000);

it("reconnect: a client that drops while the teammate finishes and the requester resumes replays the final answer exactly once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const leadGate = join(f.dataDir, "lead-gate");
  f.plan[chief.id] = { steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }], reply: "Assigned to the lead", resumeReply: "CSV export delivered" };
  f.plan[lead.id] = { gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  const first = await openSse(`${f.url}/api/events`, { origin: f.url });
  const hello = await first.until((frame) => frame.kind === "hello");
  const stream = String(hello.cursor).split(":")[0];
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  const assigned = await first.until((frame) => JSON.stringify(frame).includes("Assigned to the lead"), 30_000);
  // The connection drops; meanwhile the teammate finishes and the requester resumes.
  first.close();
  writeFileSync(leadGate, "finish");
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length, { timeout: 60_000, interval: 250 }).toBe(1);
  await settledBots(f, [chief.id, lead.id]);
  const again = await openSse(`${f.url}/api/events`, { origin: f.url, "last-event-id": `${stream}:${assigned.seq}` });
  try {
    const resumed = await again.until((frame) => frame.kind === "hello");
    expect(resumed.resumed).toBe(true);
    await again.until((frame) => JSON.stringify(frame).includes("CSV export delivered"), 15_000);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const finals = again.frames.filter((frame) => frame.kind === "message" && frame.message?.text === "CSV export delivered");
    expect(finals, JSON.stringify(again.frames.map((frame) => frame.kind))).toHaveLength(1);
  } finally { again.close(); }
  expect((await f.messages(threadId)).filter((message) => message.text === "CSV export delivered")).toHaveLength(1);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("old entrypoint: ask_bot from a chat turn is a runtime consultation; the answer resumes the requester once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  f.plan[chief.id] = {
    steps: [{ internal: { path: "/api/internal/ask-bot", body: { toBotId: lead.id, message: "Which CSV delimiter do we use?" }, saveAs: "ask" } }],
    resumeSteps: [{ internal: { method: "GET", path: "/api/internal/delegations/{{ask}}" } }],
    reply: "Asked the lead", resumeReply: "We use commas",
  };
  f.plan[lead.id] = { reply: "Commas" };
  f.save();
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Which delimiter does the lead use?", threadId: chief.activeTaskId });
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length, { timeout: 60_000, interval: 250 }).toBe(1);
  await settledBots(f, [chief.id, lead.id]);
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const asked = chiefTurns[0].evidence.find((entry: any) => entry.internal).internal;
  const read = chiefTurns.find((turn) => turn.resumed).evidence.find((entry: any) => entry.internal).internal;
  const consult = readHandoffs(f.dataDir).find((node) => node.botId === lead.id)!;
  expect(asked, JSON.stringify(asked)).toMatchObject({ status: 200, body: { busy: true, taskId: consult.id } });
  expect(read, JSON.stringify(read)).toMatchObject({ status: 200, body: { status: "done", result: "Commas" } });
  expect(f.evidence().filter((turn) => turn.botId === lead.id)).toHaveLength(1);
  // a consultation: the envelope tells the teammate to act on nothing
  expect(JSON.stringify(f.evidence().find((turn) => turn.botId === lead.id).prompt)).toMatch(/act on nothing|Answer from what you know/i);
  expect(runtimeInvariants(f)).toEqual([]);
}), 120_000);

it("old entrypoint: an external runtime's ask_bot to a busy peer waits as a runtime consultation it polls; the peer answers once", () => withFixture(async (f) => {
  const gateway = (await f.cli("new-bot", "--name", "Gateway")).bot;
  const peer = (await f.cli("new-bot", "--name", "Busy peer")).bot;
  const token = "convergence-external-ask-token-0123456789abcd";
  writeFileSync(join(f.dataDir, "external-runtimes.json"), JSON.stringify({ [gateway.id]: { token, threadId: gateway.activeTaskId } }), { mode: 0o600 });
  const hold = join(f.dataDir, "peer-hold");
  const holdReady = join(f.dataDir, "peer-hold-ready");
  f.plan[peer.id] = { byPrompt: [
    { promptIncludes: "Which delimiter?", plan: { reply: "Semicolons" } },
    { promptIncludes: "KEEP_BUSY", plan: { readyFile: holdReady, gateFile: hold, reply: "Done being busy" } },
  ], reply: "Unexpected turn" };
  f.save();
  // The peer is busy in another conversation of its own, with one slot (in
  // the conversation the ask addresses, the aside lane would fold it in).
  await f.api("/api/config", { threads: { maxConcurrentPerBot: 1 } }, "PATCH");
  // A new conversation becomes the one an ask addresses; the hold runs in the first.
  await f.api(`/api/bots/${peer.id}/tasks`, { title: "Other work" });
  await f.api(`/api/bots/${peer.id}/messages`, { text: "KEEP_BUSY until released", threadId: peer.activeTaskId });
  await expect.poll(() => existsSync(holdReady), { timeout: 30_000, interval: 100 }).toBe(true);
  const asRuntime = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(f.url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const asked = await asRuntime("POST", "/api/internal/ask-bot", { toBotId: peer.id, message: "Which delimiter?" });
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  expect(asked.body).toMatchObject({ busy: true, taskId: expect.any(String) });
  expect((await asRuntime("GET", `/api/internal/delegations/${asked.body.taskId}`)).body.status).toBe("queued");
  writeFileSync(hold, "release");
  await expect.poll(async () => (await asRuntime("GET", `/api/internal/delegations/${asked.body.taskId}`)).body.status, { timeout: 45_000, interval: 250 }).toBe("done");
  expect((await asRuntime("GET", `/api/internal/delegations/${asked.body.taskId}`)).body.result).toBe("Semicolons");
  await settledBots(f, [gateway.id, peer.id]);
  expect(f.evidence().filter((turn) => turn.botId === gateway.id)).toHaveLength(0);
  expect(f.evidence().filter((turn) => turn.botId === peer.id && JSON.stringify(turn.prompt).includes("Which delimiter?"))).toHaveLength(1);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("a provider limit after send_to_bot keeps the one-way notice: the teammate gets it once and nothing resumes the sender", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.txt");
  writeFileSync(limitFile, "You've hit your weekly limit · resets Dec 31 at 11:30pm (UTC)");
  f.plan[chief.id] = { turns: [
    // The limited turn sent the notice (accepted), then hit the limit.
    { steps: [{ tool: "send_to_bot", arguments: { bot_id: lead.id, title: "Release notice", message: "FYI: the release ships at 5 PM" } }],
      usageLimitFile: limitFile, reply: "Told the lead" },
    // The backup is told the steps the limited turn already took: it sends nothing again.
    { reply: "The lead has the release notice" },
  ] };
  f.plan[lead.id] = { reply: "Noted the release time" };
  f.save();
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Tell the lead the release ships at 5 PM.", threadId: chief.activeTaskId });
  await expect.poll(async () => (await f.messages(chief.activeTaskId)).some((message) => message.role === "bot" && message.text === "The lead has the release notice"),
    { timeout: 60_000, interval: 250 }).toBe(true);
  await expect.poll(() => f.evidence().filter((turn) => turn.botId === lead.id).length, { timeout: 30_000, interval: 250 }).toBeGreaterThanOrEqual(1);
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const leadTurns = f.evidence().filter((turn) => turn.botId === lead.id);
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const report = { leadTurns: leadTurns.length, chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed, model: turn.model })),
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status })) };
  expect(report.leadTurns, JSON.stringify(report)).toBe(1);
  expect(JSON.stringify(leadTurns[0].prompt)).toContain("FYI: the release ships at 5 PM");
  // One-way: the sender's limited turn and its backup, never a resume.
  expect(chiefTurns.map((turn) => turn.resumed), JSON.stringify(report)).toEqual([false, false]);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("cancelling a routine run that waits on its teammate is a Stop: the teammate at work reports, nothing resumes the cancelled run", () => withFixture(async (f) => {
  const owner = (await f.cli("new-bot", "--name", "Routine owner")).bot;
  const peer = (await f.cli("new-bot", "--name", "Routine peer")).bot;
  const peerGate = join(f.dataDir, "peer-gate");
  const peerReady = join(f.dataDir, "peer-ready");
  f.plan[owner.id] = {
    steps: [{ arguments: { bot_ids: [peer.id], message: "Produce the nightly report" } }],
    reply: "Asked the peer", resumeReply: "ROUTINE_REPORT_DELIVERED",
  };
  f.plan[peer.id] = { readyFile: peerReady, gateFile: peerGate, reply: "Nightly report ready" };
  f.save();
  const { routineId, runId } = await runRoutine(f, owner.id, "Ask the peer for the nightly report, then report it.");
  await expect.poll(async () => (await routineRuns(f, routineId)).find((run) => run.id === runId)?.status, { timeout: 60_000, interval: 250 }).toBe("waiting");
  await expect.poll(() => existsSync(peerReady), { timeout: 30_000, interval: 100 }).toBe(true);
  await f.api(`/api/routine-runs/${runId}/cancel`, {});
  writeFileSync(peerGate, "finish");
  await expect.poll(() => readHandoffs(f.dataDir).find((node) => node.botId === peer.id)?.status, { timeout: 30_000, interval: 250 }).toBe("completed");
  await settledBots(f, [owner.id, peer.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const run = (await routineRuns(f, routineId)).find((entry) => entry.id === runId);
  const ownerTurns = f.evidence().filter((turn) => turn.botId === owner.id);
  const report = { run: run.status, ownerTurns: ownerTurns.map((turn) => turn.resumed), peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === owner.id ? "owner" : "peer", status: node.status })) };
  expect(report.run, JSON.stringify(report)).toBe("cancelled");
  expect(report.peerTurns, JSON.stringify(report)).toBe(1);
  // The cancelled run's own turn only: no resume in its thread.
  expect(report.ownerTurns, JSON.stringify(report)).toEqual([false]);
  expect(report.nodes, JSON.stringify(report)).toEqual([{ bot: "owner", status: "cancelled" }, { bot: "peer", status: "completed" }]);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("a resume that hits the same usage limit before the reset leaves the request to its resend: the teammate runs once, the request is answered once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.json");
  const leadGate = join(f.dataDir, "lead-gate");
  const resetsAt = Math.ceil(Date.now() / 1_000) + 15;
  const limit = JSON.stringify({ text: "You've hit your session limit", resetsAt });
  writeFileSync(limitFile, limit);
  f.plan[chief.id] = {
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    usageLimitFile: limitFile, reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.tool?.limitFailover?.kind === "waiting"),
    { timeout: 45_000, interval: 250 }).toBe(true);
  // The engine is still limited when the teammate finishes: the resume it
  // owes hits the same limit.
  writeFileSync(limitFile, limit);
  writeFileSync(leadGate, "finish");
  await expect.poll(() => Date.now(), { timeout: 60_000, interval: 250 }).toBeGreaterThan(resetsAt * 1_000 + 4_000);
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.role === "bot" && message.text === "CSV export delivered"),
    { timeout: 45_000, interval: 250 }).toBe(true);
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const finals = (await f.messages(threadId)).filter((message) => message.role === "bot" && message.kind === "text" && message.text === "CSV export delivered");
  const report = { chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed })), leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    finals: finals.length, nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status, parent: node.parentId ? "child" : "root" })) };
  writeFileSync(`${f.session.info.logPath}.limit-resume-limited.json`, JSON.stringify(report, null, 2));
  // The request ran once; its limited resume ran again (not the request).
  expect(report.chiefTurns, JSON.stringify(report)).toEqual([{ resumed: false }, { resumed: true }, { resumed: true }]);
  expect(report.leadTurns, JSON.stringify(report)).toBe(1);
  expect(report.nodes.filter((node) => node.bot === "lead"), JSON.stringify(report)).toHaveLength(1);
  expect(report.finals, JSON.stringify(report)).toBe(1);
  expect(runtimeInvariants(f)).toEqual([]);
}, { backup: false, env: { SAGAX_TEST_LIMIT_AFTER_RESET_MS: "300" } }), 200_000);

it("an external runtime's delegate_bot retried after a dropped connection is one request: the same task id, the peer runs once", () => withFixture(async (f) => {
  const gateway = (await f.cli("new-bot", "--name", "Gateway")).bot;
  const peer = (await f.cli("new-bot", "--name", "Peer")).bot;
  const token = "convergence-external-retry-token-0123456789";
  writeFileSync(join(f.dataDir, "external-runtimes.json"), JSON.stringify({ [gateway.id]: { token, threadId: gateway.activeTaskId } }), { mode: 0o600 });
  const peerGate = join(f.dataDir, "peer-gate");
  f.plan[peer.id] = { gateFile: peerGate, reply: "External work done" };
  f.save();
  const asRuntime = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(f.url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  // The first call is accepted; its answer never reaches the caller, which
  // sends the same call again (the proxy's retry keeps the call's key).
  const call = { toBotId: peer.id, message: "Do the external work", idempotencyKey: "retry-key-0001" };
  const first = await asRuntime("POST", "/api/internal/delegate-bot", call);
  const retried = await asRuntime("POST", "/api/internal/delegate-bot", { toBotId: peer.id, message: "Do the external work" }, { "idempotency-key": "retry-key-0001" });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(retried.body, JSON.stringify(retried.body)).toMatchObject({ queued: true, taskId: first.body.taskId, duplicate: true });
  writeFileSync(peerGate, "finish");
  await expect.poll(async () => (await asRuntime("GET", `/api/internal/delegations/${first.body.taskId}`)).body.status, { timeout: 30_000, interval: 250 }).toBe("done");
  await settledBots(f, [gateway.id, peer.id]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const report = { peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === gateway.id ? "gateway" : "peer", status: node.status })) };
  expect(report, JSON.stringify(report)).toEqual({ peerTurns: 1, nodes: [{ bot: "gateway", status: "completed" }, { bot: "peer", status: "completed" }] });
  expect(runtimeInvariants(f)).toEqual([]);
}), 120_000);

it("a resume that hits a usage limit while a backup takes over runs again on the backup: the teammate runs once, the request is answered once", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const limitFile = join(f.dataDir, "chief-limited.txt");
  const leadGate = join(f.dataDir, "lead-gate");
  f.plan[chief.id] = {
    steps: [{ arguments: { bot_ids: [lead.id], message: "Build the CSV export" } }],
    usageLimitFile: limitFile, reply: "Assigned to the lead", resumeReply: "CSV export delivered",
  };
  f.plan[lead.id] = { gateFile: leadGate, reply: "CSV export built" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Please have the lead build the CSV export.", threadId });
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.role === "bot" && message.text === "Assigned to the lead"),
    { timeout: 45_000, interval: 250 }).toBe(true);
  // The first turn ran on the home engine; its resume hits the limit, and the backup takes over.
  writeFileSync(limitFile, "You've hit your weekly limit · resets Dec 31 at 11:30pm (UTC)");
  writeFileSync(leadGate, "finish");
  await expect.poll(async () => (await f.messages(threadId)).some((message) => message.role === "bot" && message.text === "CSV export delivered"),
    { timeout: 60_000, interval: 250 }).toBe(true);
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const chiefTurns = f.evidence().filter((turn) => turn.botId === chief.id);
  const finals = (await f.messages(threadId)).filter((message) => message.role === "bot" && message.kind === "text" && message.text === "CSV export delivered");
  const report = { chiefTurns: chiefTurns.map((turn) => ({ resumed: turn.resumed, model: turn.model })), leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    finals: finals.length, nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status })) };
  writeFileSync(`${f.session.info.logPath}.limit-resume-backup.json`, JSON.stringify(report, null, 2));
  expect(report.leadTurns, JSON.stringify(report)).toBe(1);
  expect(report.finals, JSON.stringify(report)).toBe(1);
  expect(report.nodes, JSON.stringify(report)).toEqual([{ bot: "chief", status: "completed" }, { bot: "lead", status: "completed" }]);
  // The request's own turn once; its resume twice (limited, then on the backup); never the request again.
  expect(chiefTurns.map((turn) => turn.resumed), JSON.stringify(report)).toEqual([false, true, true]);
  expect(runtimeInvariants(f)).toEqual([]);
}), 200_000);

it("send_to_bot on the runtime: a Stop before the sender's turn ends cancels the notice that never started; the teammate never runs", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const chiefReady = join(f.dataDir, "chief-ready");
  const chiefGate = join(f.dataDir, "chief-gate");
  f.plan[chief.id] = {
    steps: [{ tool: "send_to_bot", arguments: { bot_id: lead.id, title: "Release notice", message: "FYI: the release ships at 5 PM" } }],
    readyFile: chiefReady, gateFile: chiefGate, reply: "Told the lead",
  };
  f.plan[lead.id] = { reply: "Noted the release time" };
  f.save();
  const threadId = chief.activeTaskId;
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Tell the lead the release ships at 5 PM.", threadId });
  await expect.poll(() => existsSync(chiefReady), { timeout: 30_000, interval: 100 }).toBe(true);
  // A normal send waits for its sender's turn to end; the person stops that turn first.
  expect(readHandoffs(f.dataDir).find((node) => node.botId === lead.id)?.status).toBe("queued");
  await f.api(`/api/bots/${chief.id}/interrupt`, { threadId });
  await expect.poll(() => readHandoffs(f.dataDir).find((node) => node.botId === lead.id)?.status, { timeout: 15_000 }).toBe("cancelled");
  writeFileSync(chiefGate, "finish");
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const report = { leadTurns: f.evidence().filter((turn) => turn.botId === lead.id).length,
    chiefResumes: f.evidence().filter((turn) => turn.botId === chief.id && turn.resumed).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === chief.id ? "chief" : "lead", status: node.status })) };
  expect(report, JSON.stringify(report)).toMatchObject({ leadTurns: 0, chiefResumes: 0 });
  expect(runtimeInvariants(f)).toEqual([]);
}), 120_000);

it("send_to_bot on the runtime: a restart while the teammate is mid-tool reruns its turn once; the notice is handled once and nothing resumes the sender", () => withFixture(async (f) => {
  const chief = (await f.cli("new-bot", "--name", "Clive")).bot;
  const lead = (await f.cli("new-bot", "--name", "Engineering lead")).bot;
  await f.api(`/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true }, "PATCH");
  const leadReady = join(f.dataDir, "lead-ready");
  const leadGate = join(f.dataDir, "lead-gate");
  f.plan[chief.id] = {
    steps: [{ tool: "send_to_bot", arguments: { bot_id: lead.id, title: "Release notice", message: "FYI: the release ships at 5 PM", priority: "now" } }],
    reply: "Told the lead",
  };
  f.plan[lead.id] = { readyFile: leadReady, gateFile: leadGate, reply: "Noted the release time" };
  f.save();
  await f.api(`/api/bots/${chief.id}/messages`, { text: "Tell the lead the release ships at 5 PM.", threadId: chief.activeTaskId });
  await expect.poll(() => existsSync(leadReady), { timeout: 30_000, interval: 100 }).toBe(true);
  await f.restart();
  writeFileSync(leadGate, "finish");
  await expect.poll(() => readHandoffs(f.dataDir).find((node) => node.botId === lead.id)?.status, { timeout: 45_000, interval: 250 }).toBe("completed");
  await settledBots(f, [chief.id, lead.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const leadTurns = f.evidence().filter((turn) => turn.botId === lead.id);
  const report = { leadTurns: leadTurns.length, chief: f.evidence().filter((turn) => turn.botId === chief.id).map((turn) => turn.resumed),
    restarts: readHandoffs(f.dataDir).find((node) => node.botId === lead.id)?.restarts };
  // The cut turn (its process ended with the server, before it recorded a
  // turn) ran again once with the notice; the sender is never resumed.
  expect(report, JSON.stringify(report)).toEqual({ leadTurns: 1, chief: [false], restarts: 1 });
  expect(leadTurns.every((turn) => JSON.stringify(turn.prompt).includes("FYI: the release ships at 5 PM"))).toBe(true);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("a routine thread's direct delegate-bot call (older caller) runs on the runtime: a retried call is one dispatch and its result resumes the run once", () => withFixture(async (f) => {
  const owner = (await f.cli("new-bot", "--name", "Routine owner")).bot;
  const peer = (await f.cli("new-bot", "--name", "Routine peer")).bot;
  const call = { internal: { path: "/api/internal/delegate-bot", body: { toBotId: peer.id, message: "Produce the nightly report" }, saveAs: "task" } };
  f.plan[owner.id] = { steps: [call, call], reply: "Asked the peer", resumeReply: "ROUTINE_REPORT_DELIVERED" };
  f.plan[peer.id] = { reply: "Nightly report ready" };
  f.save();
  const { routineId, runId } = await runRoutine(f, owner.id, "Ask the peer for the nightly report, then report it.");
  await expect.poll(async () => (await routineRuns(f, routineId)).find((run) => run.id === runId)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
  await settledBots(f, [owner.id, peer.id]);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const ownerTurns = f.evidence().filter((turn) => turn.botId === owner.id);
  const sent = ownerTurns[0].evidence.filter((entry: any) => entry.internal).map((entry: any) => entry.internal.body);
  const report = { peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length, owner: ownerTurns.map((turn) => turn.resumed),
    taskIds: sent.map((body: any) => body.taskId), duplicate: sent.map((body: any) => Boolean(body.duplicate)) };
  expect(report.taskIds[0], JSON.stringify(report)).toEqual(report.taskIds[1]);
  expect(report, JSON.stringify(report)).toMatchObject({ peerTurns: 1, owner: [false, true], duplicate: [false, true] });
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);

it("an external runtime's synchronous ask_bot retried after a dropped connection is one consultation: the peer answers once and the retry reads that answer", () => withFixture(async (f) => {
  const gateway = (await f.cli("new-bot", "--name", "Gateway")).bot;
  const peer = (await f.cli("new-bot", "--name", "Peer")).bot;
  const token = "convergence-external-sync-ask-0123456789ab";
  writeFileSync(join(f.dataDir, "external-runtimes.json"), JSON.stringify({ [gateway.id]: { token, threadId: gateway.activeTaskId } }), { mode: 0o600 });
  const peerGate = join(f.dataDir, "peer-gate");
  const peerReady = join(f.dataDir, "peer-ready");
  f.plan[peer.id] = { readyFile: peerReady, gateFile: peerGate, reply: "Semicolons" };
  f.save();
  const ask = (signal?: AbortSignal) => fetch(f.url + "/api/internal/ask-bot", { method: "POST", signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": "sync-ask-key-0001" },
    body: JSON.stringify({ toBotId: peer.id, message: "Which delimiter?" }) });
  // The first call's connection drops while it waits for the answer.
  const dropped = new AbortController();
  const first = ask(dropped.signal).catch((error: Error) => error);
  await expect.poll(() => existsSync(peerReady), { timeout: 30_000, interval: 100 }).toBe(true);
  dropped.abort();
  expect(await first).toBeInstanceOf(Error);
  // The caller sends it again with the same key, and the peer finishes.
  const retry = ask();
  writeFileSync(peerGate, "finish");
  const answered = await (await retry).json() as any;
  expect(answered, JSON.stringify(answered)).toMatchObject({ botName: "Peer", text: "Semicolons" });
  await settledBots(f, [gateway.id, peer.id]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const report = { peerTurns: f.evidence().filter((turn) => turn.botId === peer.id).length, gatewayTurns: f.evidence().filter((turn) => turn.botId === gateway.id).length,
    nodes: readHandoffs(f.dataDir).map((node) => ({ bot: node.botId === gateway.id ? "gateway" : "peer", status: node.status })) };
  expect(report, JSON.stringify(report)).toEqual({ peerTurns: 1, gatewayTurns: 0, nodes: [{ bot: "gateway", status: "completed" }, { bot: "peer", status: "completed" }] });
  expect(runtimeInvariants(f)).toEqual([]);
}), 120_000);

it("an external runtime's delegate_bot that needs the person's review is not held open: the work waits for the card, runs once on allow and is refused on deny", () => withFixture(async (f) => {
  const gateway = (await f.cli("new-bot", "--name", "Gateway")).bot;
  const peer = (await f.cli("new-bot", "--name", "Peer")).bot;
  await f.api(`/api/bots/${gateway.id}`, { approvePeerComms: true }, "PATCH");
  const token = "convergence-external-review-0123456789abcd";
  writeFileSync(join(f.dataDir, "external-runtimes.json"), JSON.stringify({ [gateway.id]: { token, threadId: gateway.activeTaskId } }), { mode: 0o600 });
  f.plan[peer.id] = { byPrompt: [
    { promptIncludes: "Approved work", plan: { reply: "Approved work done" } },
    { promptIncludes: "Denied work", plan: { reply: "Denied work must never run" } },
  ], reply: "Unexpected turn" };
  f.save();
  const asRuntime = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(f.url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const card = async (text: string) => {
    let found: any;
    await expect.poll(async () => {
      found = (await f.messages(gateway.activeTaskId)).find((message) => message.card?.requestId && !message.card.answered && JSON.stringify(message.card).includes(text));
      return Boolean(found);
    }, { timeout: 30_000, interval: 250 }).toBe(true);
    return found;
  };
  for (const [text, behavior] of [["Approved work", "allow"], ["Denied work", "deny"]] as const) {
    const sent = await asRuntime("POST", "/api/internal/delegate-bot", { toBotId: peer.id, message: text });
    // Answered at once: the card waits on the person, the call does not.
    expect(sent.body, JSON.stringify(sent.body)).toMatchObject({ queued: true, approvalRequired: true, taskId: expect.any(String) });
    expect((await asRuntime("GET", `/api/internal/delegations/${sent.body.taskId}`)).body.status).toBe("queued");
    const shown = await card(text);
    await f.api(`/api/threads/${gateway.activeTaskId}/respond`, { requestId: shown.card.requestId, behavior });
    await expect.poll(async () => (await asRuntime("GET", `/api/internal/delegations/${sent.body.taskId}`)).body.status, { timeout: 30_000, interval: 250 })
      .toBe(behavior === "allow" ? "done" : "failed");
  }
  await settledBots(f, [gateway.id, peer.id]);
  const peerTurns = f.evidence().filter((turn) => turn.botId === peer.id);
  expect(peerTurns.map((turn) => JSON.stringify(turn.prompt).includes("Approved work"))).toEqual([true]);
  expect(f.evidence().filter((turn) => turn.botId === gateway.id)).toHaveLength(0);
  expect(runtimeInvariants(f)).toEqual([]);
}), 150_000);
