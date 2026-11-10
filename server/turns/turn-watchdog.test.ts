// Stall-watchdog contract: activity keeps a turn alive indefinitely, human
// approvals pause the clock, silence past the ceiling stalls exactly once.
import { transpileTs } from "../testing/transpile.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import type { ProviderAdapter, RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import { createStoppedTurnText } from "../index-leaves/stoppedTurnText.ts";
import { TurnStops, stoppedTurnOutcome } from "./turn-outcome.ts";
import { engineProcessGone, stallLimitMs, TurnWatchdog, type WatchedTurn } from "./turn-watchdog.ts";

const STALL = 10_000;
const TOOL_STALL = 50_000;
const PARKED_STALL = 1_000 * STALL;
const base = { eventId: "e1", provider: "claudeAgent", threadId: "t1", createdAt: "2026-01-01T00:00:00.000Z" };
const text = { ...base, type: "content.delta", streamKind: "assistant_text", delta: "working" } as RuntimeEvent;
const toolStarted = (itemId: string) => ({ ...base, type: "item.started", itemType: "tool", itemId }) as RuntimeEvent;
const toolEnded = (itemId: string) => ({ ...base, type: "item.completed", itemType: "tool", itemId, ok: true }) as RuntimeEvent;

function rig() {
  let now = 0;
  const stalls: WatchedTurn[] = [];
  const limits: number[] = [];
  const adapters = new Map<string, Pick<ProviderAdapter, "enginePid">>();
  const alive = new Set<number>();
  const working: Array<{ threadId: string; botId: string }> = [];
  const freed: string[] = [];
  const dog = new TurnWatchdog({
    stallMs: STALL,
    toolStallMs: TOOL_STALL,
    parkedStallMs: PARKED_STALL,
    checkMs: 60_000,
    engineGone: (turn) => engineProcessGone(adapters.get(turn.threadId), turn.threadId, (pid) => alive.has(pid)),
    onStall: (turn, silentMs) => { stalls.push(turn); limits.push(silentMs); },
    unheld: {
      threads: () => [...working],
      free: (threadId) => { freed.push(threadId); working.splice(working.findIndex((thread) => thread.threadId === threadId), 1); },
    },
    now: () => now,
  });
  return { dog, stalls, limits, adapters, alive, working, freed, tick: (ms: number) => (now += ms) };
}

const ENGINE_PID = 4242;
/** A driver that tracks its engine process: it names one while the turn is active, and none once it is not. */
const tracked = (pid: number | undefined): Pick<ProviderAdapter, "enginePid"> => ({ enginePid: () => pid });

describe("TurnWatchdog", () => {
  it("stalls a silent turn once, and only once", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    tick(STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(stalls).toEqual([expect.objectContaining({ threadId: "t1", botId: "bot1" })]);
    dog.sweep();
    expect(stalls).toHaveLength(1);
    expect(dog.watching("t1")).toBe(false);
  });

  it("any event on the thread resets the clock", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    for (let i = 0; i < 10; i++) {
      tick(STALL - 1);
      dog.observe(text);
    }
    dog.sweep();
    expect(stalls).toHaveLength(0);
  });

  it("never stalls a turn waiting on a human while its engine may still run it, however long they take", () => {
    const engines: Array<[string, Pick<ProviderAdapter, "enginePid"> | undefined]> = [
      ["no engine known", undefined],
      // An in-process engine names no process: that proves nothing about its turn.
      ["an engine that names no process", {}],
      ["an engine whose process runs", tracked(ENGINE_PID)],
    ];
    for (const [name, adapter] of engines) {
      const { dog, stalls, adapters, alive, tick } = rig();
      if (adapter) adapters.set("t1", adapter);
      alive.add(ENGINE_PID);
      dog.watch("t1", "bot1");
      dog.setWaitingOnHuman("t1", true);
      tick(PARKED_STALL * 2);
      dog.sweep();
      expect(stalls, name).toHaveLength(0);
      // the answer restarts the clock rather than inheriting the wait
      dog.setWaitingOnHuman("t1", false);
      tick(STALL - 1);
      dog.sweep();
      expect(stalls, name).toHaveLength(0);
      tick(2);
      dog.sweep();
      expect(stalls, name).toHaveLength(1);
    }
  });

  it("stops a parked turn whose engine is known to be gone, once it has been silent past the parked limit (#3300)", () => {
    for (const park of ["human", "computer"] as const) {
      for (const [name, adapter] of [["no process tracked for the turn", tracked(undefined)], ["its process exited", tracked(ENGINE_PID)]] as const) {
        const { dog, stalls, limits, adapters, tick } = rig();
        adapters.set("t1", adapter);
        dog.watch("t1", "bot1");
        if (park === "human") dog.setWaitingOnHuman("t1", true);
        else dog.setWaitingOnComputer("t1", true);
        tick(PARKED_STALL - 1);
        dog.sweep();
        expect(stalls, `${park}, ${name}`).toHaveLength(0);
        tick(2);
        dog.sweep();
        expect(stalls, `${park}, ${name}`).toEqual([expect.objectContaining({ threadId: "t1", botId: "bot1" })]);
        expect(limits, `${park}, ${name}`).toEqual([PARKED_STALL]);
        expect(dog.watching("t1"), park).toBe(false);
      }
    }
  });

  it("stops a turn that waited long on a live engine as soon as that engine's process exits (#3300)", () => {
    const { dog, stalls, limits, adapters, alive, tick } = rig();
    adapters.set("t1", tracked(ENGINE_PID));
    alive.add(ENGINE_PID);
    dog.watch("t1", "bot1");
    dog.setWaitingOnHuman("t1", true);
    tick(PARKED_STALL * 3);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    alive.delete(ENGINE_PID);
    dog.sweep();
    expect(limits).toEqual([PARKED_STALL]);
  });

  it("reads an engine as gone only when its driver tracks a process and that process is not there", () => {
    expect(engineProcessGone(undefined, "t1")).toBe(false);
    expect(engineProcessGone({}, "t1")).toBe(false);
    expect(engineProcessGone(tracked(undefined), "t1")).toBe(true);
    expect(engineProcessGone(tracked(process.pid), "t1")).toBe(false);
    expect(engineProcessGone(tracked(ENGINE_PID), "t1", () => false)).toBe(true);
  });

  it("a settled turn is forgotten", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    dog.settle("t1");
    tick(STALL * 2);
    dog.sweep();
    expect(stalls).toHaveLength(0);
  });

  it("lets the computer wait's own deadline govern, then restarts the stall clock", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    dog.setWaitingOnComputer("t1", true);
    tick(STALL * 100);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    // Resolving an unrelated human ask cannot clear the resource wait.
    dog.setWaitingOnHuman("t1", false);
    tick(STALL * 100);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    dog.setWaitingOnComputer("t1", false);
    tick(STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(stalls).toHaveLength(1);
  });

  it("re-watching a thread replaces the previous turn", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    tick(STALL - 1);
    dog.watch("t1", "bot2");
    tick(2);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(STALL);
    dog.sweep();
    expect(stalls).toEqual([expect.objectContaining({ botId: "bot2" })]);
  });

  it("lets a turn stay silent while its tool runs, up to the tool limit", () => {
    const { dog, stalls, limits, tick } = rig();
    dog.watch("t1", "bot1");
    dog.observe(toolStarted("tool-1"));
    tick(TOOL_STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(stalls).toEqual([expect.objectContaining({ threadId: "t1" })]);
    expect(limits).toEqual([TOOL_STALL]);
  });

  it("goes back to the turn limit once every running tool has ended", () => {
    const { dog, stalls, limits, tick } = rig();
    dog.watch("t1", "bot1");
    dog.observe(toolStarted("tool-1"));
    dog.observe(toolStarted("tool-2"));
    dog.observe(toolEnded("tool-1"));
    tick(STALL * 2);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    dog.observe(toolEnded("tool-2"));
    tick(STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(limits).toEqual([STALL]);
  });

  it("sets no deadline of its own on a tool while the turn keeps talking", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    dog.observe(toolStarted("long"));
    for (let i = 0; i < 6; i++) {
      tick(TOOL_STALL / 2);
      dog.observe(text);
      dog.sweep();
    }
    expect(stalls).toHaveLength(0);
  });

  it("never carries a running tool into a turn that did not start it", () => {
    const { dog, stalls, limits, tick } = rig();
    dog.observe(toolStarted("early"));
    dog.watch("t1", "bot1");
    dog.observe(toolStarted("tool-1"));
    dog.watch("t1", "bot1");
    tick(STALL);
    dog.sweep();
    expect(stalls).toHaveLength(1);
    expect(limits).toEqual([STALL]);
  });

  it("watches a turn whose later events are discarded as a fresh silent turn", () => {
    const { dog, stalls, limits, tick } = rig();
    dog.watch("t1", "bot1");
    dog.observe(toolStarted("tool-1"));
    tick(STALL * 2);
    dog.eventsDiscarded("t1");
    tick(STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(limits).toEqual([STALL]);
    // The stall handler cancels the dispatch after the sweep dropped the turn: that must not watch it again.
    dog.eventsDiscarded("t1");
    expect(dog.watching("t1")).toBe(false);
  });

  it("does not count the time the computer slept as a turn's silence (#3300)", () => {
    vi.useFakeTimers({ now: 0 });
    const stalls: WatchedTurn[] = [];
    const dog = new TurnWatchdog({ stallMs: STALL, toolStallMs: TOOL_STALL, parkedStallMs: PARKED_STALL, checkMs: 1_000, onStall: (turn) => stalls.push(turn) });
    try {
      dog.start();
      dog.watch("t1", "bot1");
      vi.advanceTimersByTime(STALL / 2);
      // The computer sleeps for an hour: the process is suspended, so no sweep runs while the wall clock keeps going.
      vi.setSystemTime(Date.now() + 60 * 60_000);
      vi.advanceTimersByTime(1_000);
      expect(stalls).toHaveLength(0);
      vi.advanceTimersByTime(STALL / 2 - 2_000);
      expect(stalls).toHaveLength(0);
      vi.advanceTimersByTime(STALL);
      expect(stalls).toEqual([expect.objectContaining({ threadId: "t1" })]);
    } finally {
      dog.stop();
      vi.useRealTimers();
    }
  });

  it("still counts silence across sweeps that are only a little late", () => {
    vi.useFakeTimers({ now: 0 });
    const stalls: WatchedTurn[] = [];
    const dog = new TurnWatchdog({ stallMs: STALL, toolStallMs: TOOL_STALL, parkedStallMs: PARKED_STALL, checkMs: 1_000, onStall: (turn) => stalls.push(turn) });
    try {
      dog.start();
      dog.watch("t1", "bot1");
      vi.advanceTimersByTime(STALL - 3_000);
      vi.setSystemTime(Date.now() + 2_000);
      vi.advanceTimersByTime(1_000);
      expect(stalls).toHaveLength(1);
    } finally {
      dog.stop();
      vi.useRealTimers();
    }
  });

  it("does not count the time the computer slept against a conversation shown working (#3300)", () => {
    vi.useFakeTimers({ now: 0 });
    const freed: string[] = [];
    const working = [{ threadId: "t1", botId: "bot1" }];
    const dog = new TurnWatchdog({ stallMs: STALL, toolStallMs: TOOL_STALL, checkMs: 1_000, onStall: () => {},
      unheld: { threads: () => working, free: (threadId) => { freed.push(threadId); working.length = 0; } } });
    try {
      dog.start();
      vi.advanceTimersByTime(STALL / 2);
      vi.setSystemTime(Date.now() + 60 * 60_000);
      vi.advanceTimersByTime(1_000);
      expect(freed).toEqual([]);
      vi.advanceTimersByTime(STALL);
      expect(freed).toEqual(["t1"]);
    } finally {
      dog.stop();
      vi.useRealTimers();
    }
  });

  it("frees a conversation shown working that no turn holds, once it has stayed so for the stall limit (#3300)", () => {
    const { dog, working, freed, stalls, tick } = rig();
    working.push({ threadId: "t1", botId: "bot1" });
    dog.sweep();
    tick(STALL - 1);
    dog.sweep();
    expect(freed).toEqual([]);
    tick(1);
    dog.sweep();
    expect(freed).toEqual(["t1"]);
    tick(STALL * 2);
    dog.sweep();
    expect(freed).toEqual(["t1"]);
    expect(stalls).toEqual([]);
  });

  it("leaves a conversation to the turn it watches, and counts from that turn's end", () => {
    const { dog, working, freed, tick } = rig();
    dog.watch("t1", "bot1");
    working.push({ threadId: "t1", botId: "bot1" });
    dog.setWaitingOnHuman("t1", true);
    dog.sweep();
    tick(STALL * 3);
    dog.sweep();
    expect(freed).toEqual([]);
    dog.settle("t1");
    dog.sweep();
    tick(STALL - 1);
    dog.sweep();
    expect(freed).toEqual([]);
    tick(1);
    dog.sweep();
    expect(freed).toEqual(["t1"]);
  });

  it("counts again from the start for a conversation that went back to being held in between", () => {
    const { dog, working, freed, tick } = rig();
    working.push({ threadId: "t1", botId: "bot1" });
    dog.sweep();
    tick(STALL - 1);
    working.pop();
    dog.sweep();
    working.push({ threadId: "t1", botId: "bot1" });
    tick(1);
    dog.sweep();
    tick(STALL - 1);
    dog.sweep();
    expect(freed).toEqual([]);
    tick(1);
    dog.sweep();
    expect(freed).toEqual(["t1"]);
  });
});

describe("stallLimitMs", () => {
  it("never lets the environment switch the watchdog off", () => {
    for (const raw of [undefined, "", "65m", "0", "-5", "Infinity", "-Infinity", "1e309"]) {
      expect(stallLimitMs(raw, 1_200_000)).toBe(1_200_000);
    }
    expect(stallLimitMs("3900000", 1_200_000)).toBe(3_900_000);
  });
});

// The harness's stall handler (index.ts), run without starting a server: the
// requester of a stalled teammate hears the stall and what the turn did, never
// a bare "The coordinated turn was interrupted".
describe("the stall handler", () => {
  function load(env: Record<string, string> = {}) {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const from = source.indexOf("\nconst TURN_STALL_MS"), to = source.indexOf("\nwatchdog.start();");
    if (from < 0 || to <= from) throw new Error("Stall handler section moved");
    // the section reads the stopped-turn text through the leaf host (#1388): bind it to the section's own turnStops
    // the leaf binding itself sits with the other leaves, above the section, so bind it here when the section lacks it
    const section = source.slice(from, to);
    const bindLeaf = section.includes("const stoppedTurnText = createStoppedTurnText(") ? "" : "const stoppedTurnText = createStoppedTurnText(getLeafHost);\n";
    const code = transpileTs(`globalThis.leafHost = {};\n${bindLeaf}${section}\nObject.assign(leafHost, { turnStops, store, stoppedTurnOutcome });\nglobalThis.watchdog = watchdog;\nglobalThis.stoppedTurnText = stoppedTurnText;`);
    const messages: Message[] = [
      { id: "a", role: "bot", kind: "activity", at: 1, turnId: "turn-1", tool: { name: "Bash", ok: true, itemId: "i1" } } as Message,
      { id: "b", role: "bot", kind: "text", at: 2, turnId: "turn-1", text: "Exporting the second half now." } as Message,
    ];
    const settled: Array<{ generation?: string; text: string }> = [], delegations: string[] = [];
    // the loop guard's counts end with the turn the watchdog stopped
    const guardSettled: string[] = [];
    const shellLoopGuard = { settle: (threadId: string) => { guardSettled.push(threadId); } };
    const context = vm.createContext({
      process: { env },
      RoomTurnStallRegistry: class { stall() {} },
      TurnStops, stoppedTurnOutcome, createStoppedTurnText, getLeafHost: () => context.leafHost, reportsToRequester: () => true, stallLimitMs,
      TurnWatchdog: class { options: unknown; constructor(options: { onStall: (turn: WatchedTurn) => void }) { this.options = options; } },
      store: { messagesFor: () => messages, activePath: () => messages, appendMessage() {} },
      turnResourceOwners: new Map(), directTurnGenerationByThread: new Map([["t1", "gen-1"]]), directRequestOwners: new Map(),
      localVmThreadTargets: new Map(), liveTurnByThread: new Map([["t1", "turn-1"]]), turnUsage: new Map(), turnContext: new Map(),
      cancelDirectTurnDispatch() {}, revokeInternalCapabilitiesForThread() {}, shellLoopGuard, directTurnBudget: { settle() {} }, closeOpenApprovals() {}, closeCutToolRows() { return 0; }, endedToolOutput: () => "",
      botForThread: () => ({ id: "eli" }), activeRoutineRunForThread: () => undefined,
      runningTurnInstance: () => ({ adapter: { interruptTurn: async () => {} } }),
      failedTurnTool: (name: string) => ({ name, ok: false }), reportIncident() {},
      settleDirectFollowup: (generation: string | undefined, outcome: { text: string }) => settled.push({ generation, text: outcome.text }),
      finalizeDelegationWatch: (_threadId: string, _ok: boolean, _reply: string, why: string) => delegations.push(why),
      reportBackgroundError: () => {},
      setTimeout: () => ({ unref() {} }),
    });
    vm.runInContext(code, context, { filename: "index.ts (stall handler fixture)" });
    return { context, settled, delegations, guardSettled };
  }

  it("tells a stalled turn's requester why it stopped and what it did", () => {
    const { context, settled, delegations, guardSettled } = load();
    context.watchdog.options.onStall({ threadId: "t1", botId: "eli" }, 20 * 60_000);
    expect(guardSettled).toEqual(["t1"]);
    const told = 'No activity for 20 minutes — the turn was stopped. Before it stopped it made 1 tool call: Bash ×1.\nIts last message, quoted: "Exporting the second half now."';
    // delegate_bot rides the job runtime now (#2702): its requester hears a
    // stall through the same settle as every assignment, no separate watch.
    expect(settled).toEqual([{ generation: "gen-1", text: told }]);
    // Legacy delegation watch still fires the same stall text for fixtures
    // that keep finalizeDelegationWatch wired; job-runtime settle is primary.
    expect(delegations).toEqual([`Delegated turn did not finish — ${told}`]);
  });

  it("names the silence that stopped a turn whose tool was running", () => {
    const { context, settled } = load();
    context.watchdog.options.onStall({ threadId: "t1", botId: "eli" }, 120 * 60_000);
    expect(settled[0]!.text).toMatch(/^No activity for 120 minutes — the turn was stopped\. Before it stopped/);
  });

  it("never lets the environment switch the watchdog off, and keeps the tool limit at or above the turn's", () => {
    for (const endless of ["Infinity", "1e309", "-Infinity"]) {
      const { context } = load({ SAGAX_TURN_STALL_MS: endless, SAGAX_TOOL_STALL_MS: endless });
      expect(context.watchdog.options).toMatchObject({ stallMs: 20 * 60_000, toolStallMs: 2 * 60 * 60_000 });
    }
    expect(load({ SAGAX_TURN_STALL_MS: "3900000", SAGAX_TOOL_STALL_MS: "1e309" }).context.watchdog.options)
      .toMatchObject({ stallMs: 3_900_000, toolStallMs: 2 * 60 * 60_000 });
    expect(load({ SAGAX_TURN_STALL_MS: "3900000", SAGAX_TOOL_STALL_MS: "60000" }).context.watchdog.options)
      .toMatchObject({ stallMs: 3_900_000, toolStallMs: 3_900_000 });
  });

  // A harness stop that leaves its engine attached (a Company change) notes
  // its cause first: the turn's own end, settling the requester before the
  // harness's teardown does, reports that cause instead of "interrupted".
  it("gives a stopped turn's own end the cause the harness noted before interrupting it", () => {
    const { context } = load();
    expect(context.stoppedTurnText("t1", "turn-1", undefined, "interrupted")).toMatch(/^The turn did not complete \(interrupted\)\. /);
    vm.runInContext('turnStops.stopping("t1", "turn-1", "turn interrupted — the Company connection changed")', context);
    expect(context.stoppedTurnText("t1", "turn-1", undefined, "interrupted")).toMatch(/^Turn interrupted — the Company connection changed\. Before it stopped/);
  });
});

describe("TurnWatchdog peek (#3461: the live state of a team bot)", () => {
  it("gives the start, the last event, the tool call in flight and the parks, and writes nothing", () => {
    const { dog, tick, stalls } = rig();
    expect(dog.peek("t1")).toBeUndefined();
    tick(1_000);
    dog.watch("t1", "bot1");
    expect(dog.peek("t1")).toEqual({ threadId: "t1", botId: "bot1", startedAt: 1_000, lastEventAt: 1_000, waitingOnHuman: false, waitingOnComputer: false });
    tick(2_000);
    dog.observe(toolStarted("a"));
    tick(1_000);
    dog.observe(toolStarted("b"));
    expect(dog.peek("t1")).toMatchObject({ lastEventAt: 4_000, toolSince: 3_000 });
    dog.observe(toolEnded("a"));
    expect(dog.peek("t1")).toMatchObject({ toolSince: 4_000 });
    dog.observe(toolEnded("b"));
    expect(dog.peek("t1")?.toolSince).toBeUndefined();
    dog.setWaitingOnHuman("t1", true);
    expect(dog.peek("t1")).toMatchObject({ waitingOnHuman: true });
    dog.setWaitingOnHuman("t1", false);
    dog.setWaitingOnComputer("t1", true);
    expect(dog.peek("t1")).toMatchObject({ waitingOnHuman: false, waitingOnComputer: true });
    // a copy: changing it changes nothing in the watchdog
    const seen = dog.peek("t1")!;
    seen.lastEventAt = 0;
    expect(dog.peek("t1")!.lastEventAt).toBe(4_000);
    expect(stalls).toHaveLength(0);
    dog.settle("t1");
    expect(dog.peek("t1")).toBeUndefined();
  });

  it("follows the forgiven sleep", () => {
    const { dog, tick } = rig();
    dog.watch("t1", "bot1");
    tick(5_000);
    dog.sweep(4_000);
    expect(dog.peek("t1")!.lastEventAt).toBe(4_000);
  });

  it("lists the open turns of a bot", () => {
    const { dog } = rig();
    dog.watch("t1", "bot1");
    dog.watch("t2", "bot1");
    dog.watch("t3", "bot2");
    expect(dog.openTurns("bot1").map((turn) => turn.threadId).sort()).toEqual(["t1", "t2"]);
    expect(dog.openTurns("bot3")).toEqual([]);
  });
});
