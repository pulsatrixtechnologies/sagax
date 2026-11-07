// Stall-watchdog contract: activity keeps a turn alive indefinitely, human
// approvals pause the clock, silence past the ceiling stalls exactly once.
import { transpileTs } from "../testing/transpile.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import { createStoppedTurnText } from "../index-leaves/stoppedTurnText.ts";
import { TurnStops, stoppedTurnOutcome } from "./turn-outcome.ts";
import { stallLimitMs, TurnWatchdog, type WatchedTurn } from "./turn-watchdog.ts";

const STALL = 10_000;
const TOOL_STALL = 50_000;
const base = { eventId: "e1", provider: "claudeAgent", threadId: "t1", createdAt: "2026-01-01T00:00:00.000Z" };
const text = { ...base, type: "content.delta", streamKind: "assistant_text", delta: "working" } as RuntimeEvent;
const toolStarted = (itemId: string) => ({ ...base, type: "item.started", itemType: "tool", itemId }) as RuntimeEvent;
const toolEnded = (itemId: string) => ({ ...base, type: "item.completed", itemType: "tool", itemId, ok: true }) as RuntimeEvent;

function rig() {
  let now = 0;
  const stalls: WatchedTurn[] = [];
  const limits: number[] = [];
  const dog = new TurnWatchdog({
    stallMs: STALL,
    toolStallMs: TOOL_STALL,
    checkMs: 60_000,
    onStall: (turn, silentMs) => { stalls.push(turn); limits.push(silentMs); },
    now: () => now,
  });
  return { dog, stalls, limits, tick: (ms: number) => (now += ms) };
}

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

  it("never stalls a turn waiting on a human, however long they take", () => {
    const { dog, stalls, tick } = rig();
    dog.watch("t1", "bot1");
    dog.setWaitingOnHuman("t1", true);
    tick(STALL * 100);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    // the answer restarts the clock rather than inheriting the wait
    dog.setWaitingOnHuman("t1", false);
    tick(STALL - 1);
    dog.sweep();
    expect(stalls).toHaveLength(0);
    tick(2);
    dog.sweep();
    expect(stalls).toHaveLength(1);
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
      cancelDirectTurnDispatch() {}, revokeInternalCapabilitiesForThread() {}, shellLoopGuard, closeOpenApprovals() {}, closeCutToolRows() { return 0; }, endedToolOutput: () => "",
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
