// #3296: after a server restart (a roll) the first turn of each bot waited 2
// to 8 minutes with one "Workspace: In the cloud" line and nothing else while
// the cluster of the server environments woke, the wake started only at the
// first turn of the first person, and a turn sent while the server stopped
// never came back. Here the server's start is played with a cold Kubernetes
// provisioner (fake: refuses connections until its start webhook was posted
// and a few health checks went by) and nobody's recent use on file:
//   1. the wake starts with the server, before any turn;
//   2. a first turn that comes meanwhile says what it waits for and since
//      when, keeps saying so while it waits, and says when it ended;
//   3. a message sent while the server stops waits in the durable queue
//      (never started then cut) and starts at the next start; nothing new
//      is dispatched while the server stops.
// The turns cut in flight are resumed by the #3148 path (routine-reliability
// and interrupted-turns tests); this file covers what that path never saw.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "../admission.ts";
import { createDrainQueuedSends } from "../index-leaves/drainQueuedSends.ts";
import { createEndSandboxWakeRows, createEndSandboxWakeRowsLeftOpen, createNoteSandboxClusterWait, SANDBOX_WAKE_REFRESH_MS } from "../index-leaves/noteSandboxClusterWait.ts";
import { createRevokeAllInternalCapabilities } from "../index-leaves/revokeAllInternalCapabilities.ts";
import { createRevokeEarlierTurnCapabilities } from "../index-leaves/revokeEarlierTurnCapabilities.ts";
import { createRevokeInternalCapabilityGeneration } from "../index-leaves/revokeInternalCapabilityGeneration.ts";
import { drainSteeredMessages, queuedSteerSnapshot, queueSteeredMessage, restoreSteeredMessages, type SteerStore } from "../turns/steer-queue.ts";
import type { BotRecord, Message } from "../store.ts";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE } from "../../shared/sandbox-wake.ts";
import { DEFAULT_WAKE_TIMEOUT_MS, SandboxClusterWaker } from "./sandbox-k8s-wake.ts";
import type { SandboxExecOutput, SandboxStatus } from "./sandboxd-core.ts";
import type { SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager, type ClusterWaitEvent } from "./user-sandbox-manager.ts";

const ALICE = "pr_00000000-0000-4000-8000-0000000000a1";
const WAKE_URL = "https://wake.example.invalid/hook";
const RUNNING = { state: "running" } as unknown as SandboxStatus;
const EXEC_OK = { exitCode: 0, stdout: "ok", stderr: "" } as unknown as SandboxExecOutput;

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:8791"), { code: "ECONNREFUSED" });
}

function provisioner(cluster: { up: boolean }, calls: string[]): SandboxdClient {
  const gate = async <T>(method: string, value: T): Promise<T> => {
    calls.push(method);
    if (!cluster.up) throw refused();
    return value;
  };
  return {
    info: () => gate("info", { instance: "default", egress: "enforced", maxRunning: 3, idleMinutes: 15 }),
    status: () => gate("status", RUNNING),
    ensure: () => gate("ensure", RUNNING),
    stop: () => gate("stop", RUNNING),
    pause: () => gate("pause", RUNNING),
    resume: () => gate("resume", RUNNING),
    markUsed: () => gate("markUsed", RUNNING),
    stats: () => gate("stats", {} as never),
    remove: () => gate("remove", RUNNING),
    exec: () => gate("exec", EXEC_OK),
    desktopStream: () => gate("desktopStream", {} as never),
    stdioStream: () => gate("stdioStream", {} as never),
  };
}

let dir: string;
let clock = 0;
let quiet: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wake-after-restart-"));
  clock = 1_800_000_000_000;
  quiet = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {})];
});

afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

/** A server just started: a cold cluster, an empty state file (nobody's
 * recent use), the start webhook, and the conversation rows the server writes. */
function coldServer(options: { upAfterProbes: number; timeoutMs?: number }) {
  const cluster = { up: false };
  const calls: string[] = [];
  const posts: string[] = [];
  let probesAfterPost = 0;
  const waker = new SandboxClusterWaker({
    settings: { url: new URL(WAKE_URL), timeoutMs: options.timeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS },
    health: async () => {
      if (posts.length) {
        probesAfterPost += 1;
        if (probesAfterPost >= options.upAfterProbes) cluster.up = true;
      }
      return cluster.up;
    },
    fetchImpl: (async (input: URL | string) => { posts.push(String(input)); return new Response("{}", { status: 202 }); }) as typeof fetch,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: () => {},
  });
  // The conversation of the first turn: what the server's leaf writes there.
  const messages: Message[] = [];
  let nextId = 0;
  const workplace = { generation: "gen-1", botId: "bot-1", decision: { target: "user-sandbox", principal: ALICE } };
  const host = {
    now: () => clock,
    turnWorkplaces: new Map<string, unknown>(),
    activeInternalGenerationByThread: new Map<string, string>(),
    workplaceUsesSandbox: (place: { decision: { target: string } }) => place.decision.target === "user-sandbox",
    sandboxWakeNoted: new Map(),
    SANDBOX_WAKE_NOTICE,
    SANDBOX_WAKE_TIMEOUT_NOTICE,
    store: {
      appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => {
        const full = { id: `m${(nextId += 1)}`, at: clock, ...message } as Message;
        messages.push(full);
        return full;
      },
      patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => {
        const at = messages.findIndex((message) => message.id === id);
        if (at < 0) return null;
        messages[at] = { ...messages[at]!, ...patch };
        return messages[at]!;
      },
    },
  };
  const note = createNoteSandboxClusterWait(() => host);
  const events: ClusterWaitEvent[] = [];
  const manager = new UserSandboxManager({
    client: provisioner({ up: true }, []),
    kubernetes: provisioner(cluster, calls),
    kubernetesWaker: waker,
    onClusterWait: (event) => { events.push(event); note(event); },
    backendFor: () => "kubernetes",
    instance: "default",
    stateFile: join(dir, "user-sandbox-deletions.json"),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  /** The first turn of the person: it works in their environment. */
  const turnStarts = (threadId = "thread-1") => {
    host.turnWorkplaces.set(threadId, workplace);
    host.activeInternalGenerationByThread.set(threadId, workplace.generation);
  };
  return { manager, waker, cluster, calls, posts, messages, events, turnStarts, host };
}

/** A row the chat draws as "did not start in time" (src/lib/activity-runs.ts statusActivity). */
const saysTimeout = (message: Message) =>
  message.tool?.name === SANDBOX_WAKE_TIMEOUT_NOTICE || (message.tool?.name === SANDBOX_WAKE_NOTICE && message.tool.sandboxWake?.outcome === "timeout");

describe("#3296 a restart with a cold provisioner", () => {
  it("1. the wake starts with the server, before any turn, even with nobody's recent use on file", async () => {
    const server = coldServer({ upAfterProbes: 3 });
    server.manager.start();
    try {
      await vi.waitFor(() => expect(server.cluster.up).toBe(true));
      expect(server.posts).toEqual([WAKE_URL]);
      // nothing ran for anybody: only the cluster was started
      expect(server.calls).toEqual([]);
      expect(server.messages).toEqual([]);
    } finally {
      server.manager.stopTimers();
    }
  });

  it("2. a first turn during the wake says what it waits for and since when, keeps saying so, and says when it ended", async () => {
    // about a minute of wake: probes back off 2 s, 3 s, 4.5 s ... up to 15 s
    const server = coldServer({ upAfterProbes: 9 });
    const wakeStartedAt = clock;
    const atStart = server.manager.wakeClusterAtStart();
    server.turnStarts();
    const result = await server.manager.exec(ALICE, { argv: ["true"] }, "bot-1");
    expect(await atStart).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(server.posts).toHaveLength(1);
    // one live row in the conversation, never one notice then silence
    const rows = server.messages.filter((message) => message.tool?.name === SANDBOX_WAKE_NOTICE);
    expect(rows).toHaveLength(1);
    const line = rows[0]!.tool!.sandboxWake!;
    expect(line.waitingFor).toBe("cluster");
    expect(line.since).toBe(wakeStartedAt);
    // said again while it lasted (refreshed past the refresh period), then ended
    expect(clock - wakeStartedAt).toBeGreaterThan(SANDBOX_WAKE_REFRESH_MS);
    expect(line.checkedAt).toBeGreaterThan(line.since);
    expect(line.endedAt).toBe(clock);
    expect(line.outcome).toBe("ready");
    // the manager said it at the start, after checks that found it down, and at its end
    expect(server.events[0]).toMatchObject({ phase: "waiting", waitingFor: "cluster", since: wakeStartedAt });
    expect(server.events.filter((event) => event.phase === "waiting").length).toBeGreaterThan(2);
    expect(server.events.at(-1)).toMatchObject({ phase: "ready" });
  });

  it("2b. a wake that does not finish in time ends the live row and says so once", async () => {
    const server = coldServer({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 60_000 });
    server.turnStarts();
    await expect(server.manager.exec(ALICE, { argv: ["true"] }, "bot-1")).rejects.toMatchObject({ code: "cluster_start_timeout" });
    const live = server.messages.find((message) => message.tool?.name === SANDBOX_WAKE_NOTICE)!;
    expect(live.tool!.sandboxWake).toMatchObject({ waitingFor: "cluster", outcome: "timeout" });
    // what the person reads: the timeout sentence once, on the live row, never twice in a row
    // (the chat draws both a live row ended by "timeout" and the timeout notice with that sentence)
    expect(server.messages.filter(saysTimeout)).toEqual([live]);
  });

  it("2c. a timeout for a turn that has no live row is still said, once", () => {
    const server = coldServer({ upAfterProbes: Number.POSITIVE_INFINITY });
    server.turnStarts();
    const note = createNoteSandboxClusterWait(() => server.host);
    note({ principalId: ALICE, botId: "bot-1", phase: "timeout" });
    note({ principalId: ALICE, botId: "bot-1", phase: "timeout" });
    expect(server.messages.filter(saysTimeout)).toHaveLength(1);
    expect(server.messages).toHaveLength(1);
  });

  it("3. a message sent while the server stops waits in the durable queue and starts at the next start", () => {
    // the decision: never start a turn the stop would cut
    expect(admit("direct", {}, { restarting: true })).toEqual({ action: "queue", reason: "restart" });
    expect(admit("opened-thread", {}, { restarting: true })).toEqual({ action: "queue", reason: "restart" });
    expect(admit("direct", {}, {})).toEqual({ action: "start" });
    // nothing waiting is dispatched while the server stops
    const drainNow = vi.fn();
    const stopping = { followupsReady: true, isShuttingDown: () => true, drainingQueuedSends: false, queuedSendsDrainOwed: false, drainQueuedSendsNow: drainNow, drainAgentReplyWakes: vi.fn() };
    createDrainQueuedSends(() => stopping)();
    expect(drainNow).not.toHaveBeenCalled();
    // the words are kept on disk with their reason, and the next process runs them
    const threadId = "thread-restart-3296";
    const bot = { id: "bot-restart-3296", threadId, name: "Bot", busy: false } as unknown as BotRecord;
    queueSteeredMessage(bot.id, threadId, "are the backups done?", { reason: "restart" });
    restoreSteeredMessages(); // the next start reads the queue back
    expect(queuedSteerSnapshot(() => true)[threadId]).toEqual([expect.objectContaining({ text: "are the backups done?", reason: "restart" })]);
    const appended: Message[] = [];
    const store: SteerStore = {
      bot: (id) => (id === bot.id ? bot : null),
      appendMessage: (_thread, message) => { const full = { id: `q${appended.length + 1}`, at: Date.now(), ...message } as Message; appended.push(full); return full; },
      patchMessage: () => null,
    };
    const run = vi.fn();
    drainSteeredMessages(store, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toBe(threadId);
    expect(appended.map((message) => message.text)).toEqual(["are the backups done?"]);
  });
});

/** The server's leaves around one conversation whose turn waits on the
 * environment: the wait row, the turn's end, its stop, the shutdown, and the
 * open-rows file a crash leaves behind. Messages persist across "processes". */
function waitingConversation(messages: Message[], rowsFile: string) {
  let nextId = messages.length;
  const host: Record<string, any> = {
    now: () => clock,
    turnWorkplaces: new Map<string, unknown>(),
    activeInternalGenerationByThread: new Map<string, string>(),
    workplaceUsesSandbox: () => true,
    sandboxWakeNoted: new Map(),
    sandboxWakeRowsFile: rowsFile,
    SANDBOX_WAKE_NOTICE,
    SANDBOX_WAKE_TIMEOUT_NOTICE,
    computerSelectionTurns: new Map(),
    internalCapabilities: new Map(),
    sessionCredentials: new Map(),
    internalGenerationByProviderTurn: Object.assign(new Map(), { deleteGeneration: () => {} }),
    standInRoots: new Set(),
    guestDrivenTurns: new Map(),
    endForeignTurns: () => {},
    store: {
      appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => {
        const full = { id: `m${(nextId += 1)}`, at: clock, ...message } as Message;
        messages.push(full);
        return full;
      },
      patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => {
        const at = messages.findIndex((message) => message.id === id);
        if (at < 0) return null;
        messages[at] = { ...messages[at]!, ...patch };
        return messages[at]!;
      },
      messagesFor: () => messages,
    },
  };
  host.endSandboxWakeRows = createEndSandboxWakeRows(() => host);
  host.revokeInternalCapabilityGeneration = createRevokeInternalCapabilityGeneration(() => host);
  const note = createNoteSandboxClusterWait(() => host);
  const turnWaits = (threadId: string, generation: string) => {
    host.turnWorkplaces.set(threadId, { generation, botId: "bot-1", decision: { target: "user-sandbox", principal: ALICE } });
    host.activeInternalGenerationByThread.set(threadId, generation);
    note({ principalId: ALICE, botId: "bot-1", phase: "waiting", waitingFor: "cluster", since: clock });
  };
  return {
    host,
    turnWaits,
    stop: createRevokeEarlierTurnCapabilities(() => host),
    shutdown: createRevokeAllInternalCapabilities(() => host),
    startAgain: createEndSandboxWakeRowsLeftOpen(() => host),
  };
}

const wakeRows = (messages: Message[]) => messages.filter((message) => message.tool?.name === SANDBOX_WAKE_NOTICE).map((message) => message.tool!.sandboxWake!);

describe("#3296 a wait row never outlives its turn", () => {
  it("4. the person stops the turn during the wait: the row ends then, and stays ended", () => {
    const messages: Message[] = [];
    const server = waitingConversation(messages, join(dir, "open.json"));
    server.turnWaits("thread-1", "gen-1");
    expect(wakeRows(messages)).toEqual([{ waitingFor: "cluster", since: clock }]);
    clock += 45_000;
    server.stop("thread-1");
    expect(wakeRows(messages)).toEqual([{ waitingFor: "cluster", since: clock - 45_000, endedAt: clock, outcome: "interrupted" }]);
    // the wake that comes later does not reopen or rewrite it
    clock += 60_000;
    createNoteSandboxClusterWait(() => server.host)({ principalId: ALICE, phase: "ready" });
    expect(wakeRows(messages)[0]).toMatchObject({ endedAt: clock - 60_000, outcome: "interrupted" });
  });

  it("4c. a full cache drops only rows whose wait ended, never one still open", () => {
    const messages: Message[] = [];
    const server = waitingConversation(messages, join(dir, "open.json"));
    server.turnWaits("thread-open", "gen-open");
    for (let i = 0; i < 501; i += 1) server.host.sandboxWakeNoted.set(`thread-${i}`, { generation: `g${i}`, messageId: `x${i}`, line: { waitingFor: "cluster", since: clock, endedAt: clock, outcome: "ready" } });
    server.turnWaits("thread-new", "gen-new");
    expect(server.host.sandboxWakeNoted.has("thread-open")).toBe(true);
    expect(server.host.sandboxWakeNoted.size).toBe(2);
    // the open row still ends with the shutdown
    server.shutdown();
    expect(wakeRows(messages).map((line) => line.outcome)).toEqual(["interrupted", "interrupted"]);
  });

  it("4b. the turn ends or fails before the call returns: the row ends with the turn", () => {
    const messages: Message[] = [];
    const server = waitingConversation(messages, join(dir, "open.json"));
    server.turnWaits("thread-1", "gen-1");
    clock += 20_000;
    server.host.revokeInternalCapabilityGeneration("thread-1", "gen-1");
    expect(wakeRows(messages)).toEqual([expect.objectContaining({ endedAt: clock, outcome: "interrupted" })]);
  });

  it("5. the server stops during the wait: every open row ends with the shutdown", () => {
    const messages: Message[] = [];
    const server = waitingConversation(messages, join(dir, "open.json"));
    server.turnWaits("thread-1", "gen-1");
    server.turnWaits("thread-2", "gen-2");
    clock += 30_000;
    server.shutdown();
    expect(wakeRows(messages)).toEqual([
      expect.objectContaining({ endedAt: clock, outcome: "interrupted" }),
      expect.objectContaining({ endedAt: clock, outcome: "interrupted" }),
    ]);
  });

  it("6. the server is killed during the wait: the next start finds the open row again and ends it", () => {
    const messages: Message[] = [];
    const rowsFile = join(dir, "open.json");
    const before = waitingConversation(messages, rowsFile);
    const since = clock;
    before.turnWaits("thread-1", "gen-1");
    clock += SANDBOX_WAKE_REFRESH_MS + 5_000;
    createNoteSandboxClusterWait(() => before.host)({ principalId: ALICE, phase: "waiting", waitingFor: "cluster", since });
    const lastCheck = clock;
    // killed here: no stop, no shutdown. The next process starts much later.
    clock += 3 * 3_600_000;
    const after = waitingConversation(messages, rowsFile);
    expect(after.startAgain()).toBe(1);
    expect(wakeRows(messages)).toEqual([{ waitingFor: "cluster", since, checkedAt: lastCheck, endedAt: lastCheck, outcome: "interrupted" }]);
    // once only
    expect(after.startAgain()).toBe(0);
    expect(waitingConversation(messages, rowsFile).startAgain()).toBe(0);
  });
});
