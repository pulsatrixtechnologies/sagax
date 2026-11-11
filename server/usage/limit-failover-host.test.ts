import { describe, expect, it } from "vitest";
import { ENGINE_REFUSAL_TTL_MS, type EngineRefusal } from "../engines/engine-refusals.ts";

import type { LimitFailoverLine } from "../../shared/limit-failover.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import { LimitFailoverStore, type LimitCandidate } from "./limit-failover.ts";
import { createLimitFailoverHost, limitBackupRefusedText, type LimitFailoverHostDeps, type LimitRequest } from "./limit-failover-host.ts";
import { parseClaudeUsage, spentPlanUntil } from "./plan-usage.ts";

const A: ModelSelection = { instanceId: "claude", model: "opus" };
const B: ModelSelection = { instanceId: "codex", model: "gpt" };
const C: ModelSelection = { instanceId: "grok", model: "grok-4.5" };
const DRIVERS: Record<string, string> = { claude: "claudeAgent", codex: "codex", grok: "grokAgent", "grok-work": "grokAgent", forbidden: "geminiAgent" };
const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok", "grok-work": "Grok (work)", forbidden: "Gemini" };
const LIMIT = "You've hit your usage limit. Try again in 2 hours.";

/** A small world: one bot, one thread, the engines this speaker may use. */
function world(options: { allowed?: string[]; preferred?: Array<{ instanceId: string; model?: string }>; busy?: boolean } = {}) {
  const clock = { now: Date.UTC(2026, 9, 19, 16, 0) };
  const state = {
    selection: { ...A } as ModelSelection,
    lines: [] as Array<{ threadId: string; line: LimitFailoverLine; replaced?: string }>,
    resent: [] as Array<{ messageId: string; on: ModelSelection }>,
    reruns: [] as string[],
    superseded: [] as string[],
    cleared: [] as string[],
    request: { messageId: "m1", turnId: "turn-1", origin: { kind: "user" } } as LimitRequest | undefined,
    busy: options.busy ?? false,
    switches: [] as ModelSelection[],
  };
  const allowed = options.allowed ?? ["claude", "codex", "grok"];
  const store = new LimitFailoverStore({ file: null, now: () => clock.now });
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const refusals = new Map<string, EngineRefusal>();
  const deps: LimitFailoverHostDeps = {
    store,
    now: () => clock.now,
    enabled: () => true,
    engineName: (id) => NAMES[id] ?? id,
    engine: (id) => DRIVERS[id] ? { instanceId: id, driverKind: DRIVERS[id]! } : undefined,
    // Only what this speaker may use: allowedEngines, sign-ins, policy.
    candidates: async () => allowed.map((id): LimitCandidate => ({
      instanceId: id, driverKind: DRIVERS[id]!, models: [id === "codex" ? "gpt" : id.startsWith("grok") ? "grok-4.5" : "opus"],
    })),
    preferred: () => options.preferred ?? [],
    config: () => undefined,
    payer: () => "server",
    refusal: (_bot, _thread, _speaker, id) => refusals.get(id),
    threadSelection: () => state.selection,
    busy: () => state.busy,
    switchThread: (_bot, _thread, to) => {
      if (state.busy) return "the conversation is working";
      state.selection = { ...to };
      state.switches.push({ ...to });
      return null;
    },
    note: (threadId, line) => { state.lines.push({ threadId, line }); },
    replaceFailure: (threadId, turnId, line) => { state.lines.push({ threadId, line, replaced: turnId }); },
    request: () => state.request,
    resend: async (_bot, _thread, messageId) => {
      if (state.busy) return false;
      state.resent.push({ messageId, on: { ...state.selection } });
      return true;
    },
    rerunRoutine: (routineId, fromRunId) => {
      state.reruns.push(routineId);
      if (fromRunId) state.superseded.push(fromRunId);
      return true;
    },
    clearRoutineRun: (runId) => { state.cleared.push(runId); },
    after: (ms, run) => {
      const timer = { at: clock.now + ms, run, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
  };
  const host = createLimitFailoverHost(deps);
  const dispatch = (selection = state.selection, owner = false) => host.noteDispatch("thread", {
    botId: "bot", engine: { instanceId: selection.instanceId, driverKind: DRIVERS[selection.instanceId]! }, selection, payer: "server", at: clock.now,
    ...(owner ? { owner: true } : {}),
  });
  return { clock, state, store, host, dispatch, timers, refusals, deps };
}

describe("a turn its engine's limit refused", () => {
  it("continues the same message at once on another engine the person has, with one line", async () => {
    const w = world();
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + 2 * 3_600_000 } }]);
    expect(w.store.blockedUntil("server", "claude")).toBe(w.clock.now + 2 * 3_600_000);
  });

  it("leaves the failure as it is when a newer turn holds the thread", async () => {
    const w = world({ busy: true });
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(true);
    // The wait is the fake clock's timers: run them past the settle window.
    for (let index = 0; index < 400; index++) {
      await new Promise((resolve) => setImmediate(resolve));
      for (const timer of w.timers.splice(0)) if (!timer.cancelled) timer.run();
    }
    await w.host.idle();
    expect(w.state.switches).toEqual([]);
    expect(w.state.lines).toEqual([]);
    expect(w.store.blockedUntil("server", "claude")).not.toBeNull();
  });

  it("uses the engine's said reset (runtime.error) over its words", async () => {
    const w = world();
    w.dispatch();
    w.host.noteError("thread", "This Claude account has reached its weekly limit.", w.clock.now + 5 * 60_000);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" });
    await w.host.idle();
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", resetsAt: w.clock.now + 5 * 60_000 });
  });

  // port de OpenMausBot #3213: a model's extra-usage credits, or its own
  // weekly window, do not hold the whole engine for the payer's other models.
  it("takes the turn over without holding the engine when the refusal binds only its model", async () => {
    const w = world();
    w.dispatch();
    w.host.noteError("thread", "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up.", undefined, "model");
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
  });

  // 2026-11-02: a fast model Sagax picked (a call's, a wake's) that a limit
  // refused is that model's limit: the conversation's own model on the same
  // engine is not reported nor held as limited.
  it("holds only the fast model Sagax picked on the conversation's own engine, and the engine of one on another", async () => {
    const refused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, refuseModel: (payer, selection, until) => { refused.push({ payer, selection, until }); } });
    const fast: ModelSelection = { instanceId: "claude", model: "haiku" };
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: fast, payer: "server", at: w.clock.now, detour: true });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await host.idle();
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    expect(refused).toEqual([{ payer: "server", selection: fast, until: w.clock.now + 2 * 3_600_000 }]);
    // The person's own next turn starts on the conversation's model, untouched.
    expect(host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);

    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "codex", driverKind: "codex" }, selection: B, payer: "server", at: w.clock.now, detour: true });
    host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT });
    await host.idle();
    expect(w.store.blockedUntil("server", "codex")).toBe(w.clock.now + 2 * 3_600_000);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
  });

  it("ends a stale hold once a turn on the same engine works for the payer", async () => {
    const w = world();
    w.store.block("server", "claude", w.clock.now + 11 * 24 * 3_600_000);
    w.store.block("server", "codex", w.clock.now + 3_600_000);
    w.dispatch(A);
    w.host.turnSucceeded("thread");
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    // another engine's hold, and a success with no turn noted, change nothing
    expect(w.store.blockedUntil("server", "codex")).not.toBeNull();
    w.host.turnSucceeded("thread");
    expect(w.store.blockedUntil("server", "codex")).not.toBeNull();
  });

  it("never takes an engine this speaker may not use", async () => {
    const w = world({ allowed: ["claude", "grok"], preferred: [{ instanceId: "forbidden", model: "x" }, { instanceId: "codex" }] });
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.switches).toEqual([C]);
  });

  it("follows the bot's own backup order before the catalog", async () => {
    const w = world({ preferred: [{ instanceId: "grok", model: "grok-4.5" }] });
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.switches).toEqual([C]);
  });

  it("continues on another engine when this one had no conversation model left (#1696)", async () => {
    const exhausted = "This model is not supported for conversations (gpt-6.1-terra), and no other model of this engine could take over. Choose another model.";
    const w = world();
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: exhausted })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now, reason: "model" } }]);
    // No engine block and no return after a reset: the thread stays on the backup.
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(B);
  });

  it("lets Auto continue when the engine had no conversation model left (#1696)", async () => {
    const exhausted = "This model is not supported for conversations (gpt-6.1-terra), and no other model of this engine could take over. Choose another model.";
    const w = world();
    w.state.selection = { ...A, auto: true };
    w.dispatch(w.state.selection);
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: exhausted })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: w.state.selection }]);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Auto", reason: "model" });
    expect(w.state.switches).toEqual([]);
  });

  it("leaves the engine's own error when no other engine can take over an exhausted catalog (#1696)", async () => {
    const exhausted = "This model is not supported for conversations (gpt-6.1-terra), and no other model of this engine could take over. Choose another model.";
    const w = world({ allowed: ["claude"] });
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: exhausted })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([]);
    expect(w.state.lines).toEqual([]);
    expect(w.store.resumes()).toEqual([]);
  });

  it("does not take a failure that is not a limit, a stopped request, or someone else's turn", async () => {
    const w = world();
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "401 Unauthorized" })).toBe(false);
    w.dispatch();
    w.state.request = { messageId: "m1", turnId: "turn-1", stopped: true, origin: { kind: "user" } };
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(false);
    w.dispatch();
    w.state.request = { messageId: "m1", turnId: "turn-1", origin: { kind: "outside" } };
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(false);
    await w.host.idle();
    expect(w.state.resent).toEqual([]);
  });

  it("never passes a turn back and forth: a second spent engine moves it on, keeping the engine it started on", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    w.dispatch();
    w.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
    w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: "429 Too Many Requests; retry-after: 600" });
    await w.host.idle();
    expect(w.state.switches).toEqual([B, C]);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: C });
    // Codex refused, standing in for Claude: the line never names Claude as the engine that refused.
    expect(w.state.lines.at(-1)!.line).toMatchObject({ kind: "switched", from: "Codex", to: "Grok", home: "Claude" });
  });

  // 2026-11-02 (review): the conversation goes back to the engine it started on at that engine's own reset, never at
  // the later reset of the backup that stood in for it and was refused in turn.
  it("returns a conversation to its own engine at that engine's reset when the backup standing in for it is refused", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    w.dispatch();
    w.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
    w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: "You've hit your usage limit. Try again in 5 hours." });
    await w.host.idle();
    expect(w.state.switches).toEqual([B, C]);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: C, resetsAt: w.clock.now + 2 * 3_600_000 });
    expect(w.state.lines.at(-1)!.line).toEqual({ kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: w.clock.now + 2 * 3_600_000 });
    // Back on Claude once Claude resets, though Codex is still held.
    w.clock.now += 2 * 3_600_000 + w.store.afterResetMs;
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
    expect(w.store.blockedUntil("server", "codex")).not.toBeNull();
  });

  // #1942: primary + backup both limited, nothing left → exhausted (failed), not silent done.
  it("marks the turn exhausted when a second spent engine has no further backup (#1942)", async () => {
    const w = world({ allowed: ["claude", "codex"] });
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.lines.at(-1)!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Codex" });
    w.dispatch(B);
    w.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
    w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: "429 Too Many Requests; retry-after: 600" });
    await w.host.idle();
    expect(w.state.lines.at(-1)!.line).toMatchObject({
      kind: "exhausted",
      tried: expect.arrayContaining(["Claude", "Codex"]),
    });
    expect(w.state.switches).toEqual([B]);
  });

  it("surfaces exhausted when the backup switch records but resend does not start (#1942)", async () => {
    const clock = { now: Date.UTC(2026, 9, 19, 16, 0) };
    const state = {
      selection: { ...A } as ModelSelection,
      lines: [] as Array<{ threadId: string; line: LimitFailoverLine; replaced?: string }>,
      switches: [] as ModelSelection[],
      request: { messageId: "m1", turnId: "turn-1", origin: { kind: "user" } } as LimitRequest | undefined,
    };
    const store = new LimitFailoverStore({ file: null, now: () => clock.now });
    const host = createLimitFailoverHost({
      store,
      now: () => clock.now,
      enabled: () => true,
      engineName: (id) => NAMES[id] ?? id,
      engine: (id) => DRIVERS[id] ? { instanceId: id, driverKind: DRIVERS[id]! } : undefined,
      candidates: async () => ["claude", "codex"].map((id): LimitCandidate => ({
        instanceId: id, driverKind: DRIVERS[id]!, models: [id === "codex" ? "gpt" : "opus"],
      })),
      preferred: () => [],
      config: () => undefined,
      payer: () => "server",
      threadSelection: () => state.selection,
      busy: () => false,
      switchThread: (_bot, _thread, to) => {
        state.selection = { ...to };
        state.switches.push({ ...to });
        return null;
      },
      note: (threadId, line) => { state.lines.push({ threadId, line }); },
      replaceFailure: (threadId, turnId, line) => { state.lines.push({ threadId, line, replaced: turnId }); },
      request: () => state.request,
      resend: async () => false,
      rerunRoutine: () => true,
    });
    host.noteDispatch("thread", {
      botId: "bot", engine: { instanceId: A.instanceId, driverKind: DRIVERS[A.instanceId]! }, selection: A, payer: "server", at: clock.now,
    });
    expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(true);
    await host.idle();
    expect(state.lines.at(-1)!.line).toMatchObject({ kind: "exhausted", tried: expect.arrayContaining(["Claude", "Codex"]) });
  });

  it("says whose limit it is when the bot owner's plan pays for a member's turn (J4)", async () => {
    const waiting = world({ allowed: ["claude"] });
    waiting.dispatch(waiting.state.selection, true);
    waiting.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await waiting.host.idle();
    expect(waiting.state.lines.at(-1)!.line).toMatchObject({ kind: "waiting", from: "Claude", owner: true });
    const switching = world();
    switching.dispatch(switching.state.selection, true);
    switching.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await switching.host.idle();
    expect(switching.state.lines.at(-1)!.line).toMatchObject({ kind: "switched", to: "Codex", owner: true });
    const own = world({ allowed: ["claude"] });
    own.dispatch();
    own.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await own.host.idle();
    expect(own.state.lines.at(-1)!.line).not.toHaveProperty("owner");
  });

  it("with no engine left, says so and sends the message again on its own engine once the limit resets", async () => {
    const w = world({ allowed: ["claude"] });
    w.host.start();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    const resetsAt = w.clock.now + 2 * 3_600_000;
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1", line: { kind: "waiting", from: "Claude", resetsAt } }]);
    expect(w.state.resent).toEqual([]);
    expect(w.store.nextResumeAt()).toBe(resetsAt + w.store.afterResetMs);
    expect(w.timers.at(-1)!.at).toBe(resetsAt + w.store.afterResetMs);
    w.clock.now = resetsAt + w.store.afterResetMs;
    await w.host.tick();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: A }]);
    // It failed again on the same limit: no second resume. #3552: the
    // message box no longer says it, so the conversation's one line does:
    // nothing is held, try again around the new reset.
    w.state.request = { ...w.state.request!, turnId: "turn-3" };
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-3", cause: LIMIT });
    await w.host.idle();
    expect(w.store.resumes()).toEqual([]);
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", replaced: "turn-3", line: { kind: "exhausted", tried: ["Claude"], resetsAt: w.clock.now + 2 * 3_600_000 } });
    w.host.stop();
  });

  // Lot 3 (docs/plans/grok-convergence-runtime-evidence.md): Stop is final.
  it("never sends a request the person stopped while it waited for the reset, nor tries again later", async () => {
    const w = world({ allowed: ["claude"] });
    w.host.start();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    const resetsAt = w.clock.now + 2 * 3_600_000;
    // The person stops the conversation; the host's resend then refuses it.
    w.state.request = { ...w.state.request!, stopped: true };
    w.state.busy = true;
    w.clock.now = resetsAt + w.store.afterResetMs;
    await w.host.tick();
    expect(w.state.resent).toEqual([]);
    expect(w.store.resumes()).toEqual([]);
    w.host.stop();
  });

  it("runs a failed routine again on the backup, or at the reset when there is none", async () => {
    const w = world();
    w.dispatch();
    w.state.request = undefined;
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT, routineRun: { id: "run-1", routineId: "routine" } })).toBe(true);
    await w.host.idle();
    // Non-exhausted path: switch + record + switched note + rerun at once
    // (not deferred to beforeTurn).
    expect(w.state.reruns).toEqual(["routine"]);
    expect(w.state.superseded).toEqual(["run-1"]);
    expect(w.state.switches).toEqual([B]);
    expect(w.state.selection).toEqual(B);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + 2 * 3_600_000 } }]);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: B });
    // beforeTurn keeps the backup until the reset; no second switched note.
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.lines).toHaveLength(1);

    const alone = world({ allowed: ["claude"] });
    alone.dispatch();
    alone.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT, routineRun: { id: "run-1", routineId: "routine" } });
    await alone.host.idle();
    expect(alone.state.reruns).toEqual([]);
    expect(alone.state.cleared).toEqual(["run-1"]);
    expect(alone.state.lines[0]!.line).toMatchObject({ kind: "waitingRoutine", from: "Claude" });
    alone.clock.now = alone.store.nextResumeAt()!;
    await alone.host.tick();
    expect(alone.state.reruns).toEqual(["routine"]);
  });

  // R5 scorecard: before, non-exhausted routine failover skipped store.record
  // and the switched note; N synthetic limit cases now all write the note.
  it("writes a switched note and records failover for every routine limit with a backup (R5 before/after)", async () => {
    const N = 12;
    let switchedNotes = 0;
    let recorded = 0;
    let reruns = 0;
    for (let i = 0; i < N; i++) {
      const w = world();
      w.dispatch();
      w.state.request = undefined;
      expect(w.host.turnFailed({
        threadId: "thread", turnId: `turn-${i}`, cause: LIMIT,
        routineRun: { id: `run-${i}`, routineId: `routine-${i}` },
      })).toBe(true);
      await w.host.idle();
      if (w.state.lines.some((row) => row.line.kind === "switched")) switchedNotes += 1;
      if (w.store.failover("bot", "thread")) recorded += 1;
      if (w.state.reruns.length === 1) reruns += 1;
    }
    // Before R5: switchedNotes=0, recorded=0 on the non-exhausted path.
    // After R5: all N cases write the note, record, and rerun.
    expect({ switchedNotes, recorded, reruns, N }).toEqual({ switchedNotes: N, recorded: N, reruns: N, N });
  });
});

describe("the next turn", () => {
  it("records credits with the refusal TTL instead of an estimated quota reset (#1986)", async () => {
    const w = world();
    const at = w.clock.now;
    w.refusals.set(A.instanceId, { engine: A.instanceId, cause: "credits", at });
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", cause: "Credit balance is too low" })).toBe(true);
    await w.host.idle();
    expect(w.store.blockedUntil("server", A.instanceId)).toBe(at + ENGINE_REFUSAL_TTL_MS);
  });
  it("starts an Auto routine's resolved primary on a backup and preserves Auto for the return (#1986)", async () => {
    const w = world();
    const auto: ModelSelection = { ...A, auto: true };
    w.state.selection = auto;
    w.refusals.set(C.instanceId, { engine: C.instanceId, cause: "credits", at: w.clock.now });
    await w.host.beforeTurn("bot", "thread", undefined, C);
    expect(w.state.selection).toEqual(A);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: auto, to: A });
  });
  it.each(["credits", "usage_limit"] as const)("starts directly on a ready backup for a recorded %s refusal (#1986)", async (cause) => {
    const w = world({ preferred: [C, B] });
    const at = w.clock.now;
    const resetsAt = at + 2 * 3_600_000;
    w.refusals.set(A.instanceId, { engine: A.instanceId, cause, at, resetsAt });
    w.refusals.set(C.instanceId, { engine: C.instanceId, cause: "credits", at });
    expect(await w.host.backupFor("bot", "thread", undefined, A.instanceId)).toEqual(B);
    expect(w.state.switches).toEqual([]);
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(B);
    expect(w.state.resent).toEqual([]);
    const until = cause === "credits" ? at + ENGINE_REFUSAL_TTL_MS : resetsAt;
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: B, resetsAt: until });
    w.clock.now = until + w.store.afterResetMs;
    // A renewed refusal must keep the thread on the backup.
    w.refusals.set(A.instanceId, { engine: A.instanceId, cause, at: w.clock.now, resetsAt: w.clock.now + 60_000 });
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(B);
    w.refusals.delete(A.instanceId);
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(A);
  });
  it("goes back to the engine the thread was on once the reset has passed, with one line", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(B);
    w.clock.now += 2 * 3_600_000 + w.store.afterResetMs;
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", line: { kind: "back", engine: "Claude" } });
    expect(w.store.failover("bot", "thread")).toBeUndefined();
  });

  it("leaves a thread someone moved to another model since", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    w.state.selection = { instanceId: "grok", model: "grok-4.5" };
    w.clock.now += 3 * 3_600_000;
    w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(C);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
  });

  it("starts on a backup while the thread's engine is known to refuse, and yields only then", async () => {
    const w = world();
    w.store.block("server", "claude", w.clock.now + 60_000);
    const switching = w.host.beforeTurn("bot", "thread", undefined);
    expect(switching).not.toBeNull();
    await switching;
    expect(w.state.selection).toEqual(B);
    expect(w.state.lines).toEqual([{ threadId: "thread", line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + 60_000 } }]);
  });

  it("leaves Auto threads to Auto", () => {
    const w = world();
    w.state.selection = { ...A, auto: true };
    w.store.block("server", "claude", w.clock.now + 60_000);
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
  });
});

// 2026-10-27 (a bot on pi with a model on its owner's computer): a local model's failure
// read as a usage limit sent the turn to Claude, which the person had not
// connected, and a sign-in card followed.
describe("a local model and a backup the person cannot use", () => {
  const localDispatch = (w: ReturnType<typeof world>) => w.host.noteDispatch("thread", {
    botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: w.state.selection, payer: "server", at: w.clock.now, local: true,
  });

  it("never treats a local model's failure as a usage limit, whatever its words", async () => {
    for (const cause of ["402 Payment Required", "429 Too Many Requests", "subscription required", "billing", "503 This local model is unavailable."]) {
      const w = world();
      localDispatch(w);
      expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause, stopReason: "quota" })).toBe(false);
      await w.host.idle();
      expect(w.state.switches).toEqual([]);
      expect(w.state.lines).toEqual([]);
      expect(w.store.blockedUntil("server", "claude")).toBeNull();
    }
  });

  it("still takes over when a local server says plainly that its quota is spent", async () => {
    const w = world();
    localDispatch(w);
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "insufficient_quota: you exceeded your current quota" })).toBe(true);
    await w.host.idle();
    expect(w.state.switches).toEqual([B]);
  });

  it("sends the thread back and skips a backup that could not run for the person", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.selection).toEqual(B);
    expect(w.host.backupRefused("bot", "thread")).toEqual({ from: "Claude", to: "Codex" });
    expect(w.state.selection).toEqual(A);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.store.blockedUntil("server", "codex")).not.toBeNull();
    // Not on a backup any more: nothing to undo, so the caller shows its own error.
    expect(w.host.backupRefused("bot", "thread")).toBeNull();
  });

  it("is not a backup refusal when the person picked the engine", () => {
    const w = world();
    expect(w.host.backupRefused("bot", "thread")).toBeNull();
  });

  it("says one plain error with no sign-in step", () => {
    const text = limitBackupRefusedText({ from: "pi", to: "Claude" });
    expect(text).toContain("Claude is not connected for you");
    expect(text).not.toMatch(/sign in/i);
  });
});

// 2026-11-02: what Sagax holds is the limit of the engine that refused, and a
// line never passes Sagax's estimate off as that engine's reset.
describe("what Sagax knows of a limit, and says of its reset", () => {
  const HOUR = 3_600_000;

  it("marks a reset the engine never named as an estimate, on the hold and on every line", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "You've hit your usage limit." });
    await w.host.idle();
    expect(w.store.holdOf("server", "claude")).toEqual({ until: w.clock.now + HOUR, estimated: true });
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + HOUR, estimated: true } }]);
    // Another conversation on Claude finds the same hold before its turn: its line says the same.
    w.state.selection = { ...A };
    await w.host.beforeTurn("bot", "thread-2", undefined);
    expect(w.state.lines[1]).toEqual({ threadId: "thread-2",
      line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + HOUR, estimated: true } });
  });

  // 2026-11-02 (final review): a usage report is only a hint. A refusal that names no reset is held for Sagax's own
  // one-hour estimate, marked as one, and tried again after it, even while the report shows a window spent for days.
  // Before, it was held until that window's reset and not marked as an estimate; a top-up the next report showed
  // cleared only the hint, never the hold, so the person's own conversation on that engine was moved for days.
  it("holds a refusal that names no reset for Sagax's estimate, never a spent plan's reset, so a top-up is tried within the hour", async () => {
    const w = world();
    let spentUntil: number | null = w.clock.now + 3 * 24 * HOUR;
    const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (payer, id) => payer === "server" && id === "claude" ? spentUntil : null });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "You've hit your usage limit." });
    await host.idle();
    expect(w.store.holdOf("server", "claude")).toEqual({ until: w.clock.now + HOUR, estimated: true });
    expect(w.state.lines[0]!.line).toEqual({ kind: "switched", from: "Claude", to: "Codex", resetsAt: w.clock.now + HOUR, estimated: true });
    // The person tops their plan up, and the next report shows room on Claude.
    spentUntil = null;
    w.clock.now += HOUR + w.store.afterResetMs;
    // Their conversation goes back to Claude after Sagax's estimate, and nothing moves it off again.
    expect(host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", line: { kind: "back", engine: "Claude" } });
    expect(host.beforeTurn("bot", "thread-2", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
    // Auto, a backup and Sagax's quick pick all land on Claude again.
    const engines = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "codex", driverKind: "codex" }];
    expect([...host.autoExcluded("server", engines)]).toEqual([]);
    expect([...host.autoExcluded("server", engines, "quick")]).toEqual([]);
  });

  it("holds a run's refusal that names no reset for the same estimate, whatever window the report shows spent", () => {
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (_payer, id) => id === "claude" ? w.clock.now + 3 * 24 * HOUR : null });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    expect(host.routineLimit({ threadId: "thread", cause: "You've hit your usage limit.", takeover: false })).toMatchObject({
      from: "Claude", resetsAt: w.clock.now + HOUR, estimated: true,
    });
    expect(w.store.holdOf("server", "claude")).toEqual({ until: w.clock.now + HOUR, estimated: true });
  });

  it("keeps Sagax's quick pick off an engine whose plan is spent, but never moves a person's chosen engine on that alone", () => {
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (_payer, id) => id === "codex" ? w.clock.now + HOUR : null });
    const engines = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "codex", driverKind: "codex" }];
    expect([...host.autoExcluded("server", engines, "quick")]).toEqual(["codex"]);
    // 2026-11-02 (review): Auto and its panel read only the refusals Sagax saw: a report at 100 % can be wrong
    // (extra usage left, an early reset), and Auto then skipped an engine that still answered.
    expect([...host.autoExcluded("server", engines)]).toEqual([]);
    // The person put this conversation on Codex: only a real refusal moves it.
    w.state.selection = { ...B };
    expect(host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.switches).toEqual([]);
  });

  it("picks a backup from the refusals Sagax saw, never from a plan the report read as spent", async () => {
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (_payer, id) => id === "codex" ? w.clock.now + 3 * 24 * HOUR : null });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
    // A later turn of another conversation on Claude, held now, moves to Codex as well before it is refused.
    w.state.selection = { ...A };
    await host.beforeTurn("bot", "thread-2", undefined);
    expect(w.state.selection).toEqual(B);
  });

  it("holds the whole engine, not only the fast model, when that engine's plan is spent", async () => {
    const w = world();
    const refused: ModelSelection[] = [];
    const host = createLimitFailoverHost({
      ...w.deps, refuseModel: (_payer, selection) => { refused.push(selection); },
      planLimitUntil: (_payer, id) => id === "claude" ? w.clock.now + 4 * HOUR : null,
    });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: { instanceId: "claude", model: "haiku" }, payer: "server", at: w.clock.now, detour: true });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await host.idle();
    expect(refused).toEqual([]);
    expect(w.store.blockedUntil("server", "claude")).toBe(w.clock.now + 2 * HOUR);
  });
});

// 2026-11-02 (review): a call turn runs on a quick model Sagax picks (#1694),
// often another engine's. A limit refusing it is that model's: the person's
// spoken message goes again at once, the conversation stays on its own model,
// and nothing reports the raw limit as the bot's (turnFailed is true: no
// incident).
describe("a person's message that ran on a quick model Sagax picked", () => {
  const HOUR = 3_600_000;
  const quick = (w: ReturnType<typeof world>, host: ReturnType<typeof createLimitFailoverHost>, selection: ModelSelection) =>
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: selection.instanceId, driverKind: DRIVERS[selection.instanceId]! }, selection, payer: "server", at: w.clock.now, detour: true });

  it("goes again at once without moving the conversation when another engine's quick model refused", async () => {
    const w = world();
    const fast: ModelSelection = { instanceId: "codex", model: "gpt-mini" };
    quick(w, w.host, fast);
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(true);
    await w.host.idle();
    expect(w.state.switches).toEqual([]);
    expect(w.state.resent).toEqual([{ messageId: "m1", on: A }]);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Codex (gpt-mini)", to: "Claude", resetsAt: w.clock.now + 2 * HOUR, detour: true } }]);
    // The next quick pick skips that engine; the conversation's own engine is not held.
    expect([...w.host.autoExcluded("server", [{ instanceId: "codex", driverKind: "codex" }, { instanceId: "claude", driverKind: "claudeAgent" }])]).toEqual(["codex"]);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    expect(w.store.failover("bot", "thread")).toBeUndefined();
  });

  it("holds only that model when it is the conversation's own engine, and names Sagax's estimate as one", async () => {
    const refused: ModelSelection[] = [];
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, refuseModel: (_payer, selection) => { refused.push(selection); } });
    const fast: ModelSelection = { instanceId: "claude", model: "haiku" };
    quick(w, host, fast);
    expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "You've hit your usage limit." })).toBe(true);
    await host.idle();
    expect(refused).toEqual([fast]);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: A }]);
    expect(w.state.lines[0]!.line).toEqual({ kind: "switched", from: "Claude (haiku)", to: "Claude", resetsAt: w.clock.now + HOUR, detour: true, estimated: true });
  });

  it("leaves a run's turn and a message the person stopped to their own paths", () => {
    const w = world();
    quick(w, w.host, { instanceId: "codex", model: "gpt-mini" });
    w.state.request = { messageId: "m1", turnId: "turn-1", origin: { kind: "user" }, stopped: true };
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT })).toBe(false);
    expect(w.state.resent).toEqual([]);
  });

  // 2026-11-02 (final review): a refusal bound to one model (Claude's limitScope "model": its extra-usage credits, its
  // family's weekly window) holds nothing engine-wide, yet the quick model Sagax picked that it refused is skipped by
  // Sagax's quick picks until it resets, as the line says. Before, nothing at all was held: the next quick pick took the
  // same model again, and the call's message went up to MAX_RESENDS times onto it.
  it("skips a quick model a refusal bound to it refused, without holding its engine, and sends the message again once", async () => {
    const refused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, refuseModel: (payer, selection, until) => { refused.push({ payer, selection, until }); } });
    const fast: ModelSelection = { instanceId: "claude", model: "haiku" };
    quick(w, host, fast);
    host.noteError("thread", "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up.", undefined, "model");
    expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" })).toBe(true);
    await host.idle();
    expect(refused).toEqual([{ payer: "server", selection: fast, until: w.clock.now + HOUR }]);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: A }]);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1",
      line: { kind: "switched", from: "Claude (haiku)", to: "Claude", resetsAt: w.clock.now + HOUR, detour: true, estimated: true } }]);
  });

  it("skips another engine's quick model the same way until the reset it named, and leaves that engine to the others", async () => {
    const refused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, refuseModel: (payer, selection, until) => { refused.push({ payer, selection, until }); } });
    w.state.selection = { ...C };
    const fast: ModelSelection = { instanceId: "claude", model: "haiku" };
    quick(w, host, fast);
    host.noteError("thread", "This Claude account has reached its weekly limit for this model.", w.clock.now + 5 * HOUR, "model");
    expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" })).toBe(true);
    await host.idle();
    expect(refused).toEqual([{ payer: "server", selection: fast, until: w.clock.now + 5 * HOUR }]);
    expect([...host.autoExcluded("server", [{ instanceId: "claude", driverKind: "claudeAgent" }], "quick")]).toEqual([]);
    expect(w.state.resent).toEqual([{ messageId: "m1", on: C }]);
    expect(w.state.lines[0]!.line).toEqual({ kind: "switched", from: "Claude (haiku)", to: "Grok", resetsAt: w.clock.now + 5 * HOUR, detour: true });
  });

  it("skips it as well when a wake ran on it, and the wake goes on on the conversation's own model", () => {
    const refused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
    const w = world();
    const host = createLimitFailoverHost({
      ...w.deps, refuseModel: (payer, selection, until) => { refused.push({ payer, selection, until }); },
      candidatesNow: () => ["claude", "codex", "grok"].map((id) => ({ instanceId: id, driverKind: DRIVERS[id]!, models: [id === "codex" ? "gpt" : id === "grok" ? "grok-4.5" : "opus"] })),
    });
    const fast: ModelSelection = { instanceId: "claude", model: "haiku" };
    quick(w, host, fast);
    host.noteError("thread", "This Claude account has reached its weekly limit for this model.", w.clock.now + 5 * HOUR, "model");
    expect(host.routineLimit({ threadId: "thread", cause: undefined, stopReason: "quota", takeover: true })).toMatchObject({
      from: "Claude (haiku)", detour: true, resetsAt: w.clock.now + 5 * HOUR, estimated: false, to: "Claude (opus)", selection: A, sameEngine: true,
    });
    expect(refused).toEqual([{ payer: "server", selection: fast, until: w.clock.now + 5 * HOUR }]);
    expect(w.store.blockedUntil("server", "claude")).toBeNull();
  });

  // 2026-11-02 (review of the final pass): a call turn runs on Sagax's quick pick on Auto too ("pinned or Auto alike",
  // voicePickForTurn), in place of Auto's own pick, so Auto's refusal memory never sees that model. Before, a refusal bound
  // to it held nothing at all: Auto sent the call's message again, and the next quick pick took the same model, up to six
  // times. It is skipped as on a pinned conversation, even when it is the model Auto falls back to.
  it("skips it on an Auto conversation too, whose own pick a call turn replaces, without holding its engine", async () => {
    const quickModels: ModelSelection[] = [{ instanceId: "claude", model: "haiku" }, { instanceId: "codex", model: "gpt-mini" }, { ...A }];
    for (const fast of quickModels) {
      const refused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
      const w = world();
      const host = createLimitFailoverHost({ ...w.deps, refuseModel: (payer, selection, until) => { refused.push({ payer, selection, until }); } });
      w.state.selection = { ...A, auto: true };
      quick(w, host, fast);
      host.noteError("thread", "This account has reached its weekly limit for this model.", w.clock.now + 5 * HOUR, "model");
      expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" })).toBe(true);
      await host.idle();
      expect(refused).toEqual([{ payer: "server", selection: fast, until: w.clock.now + 5 * HOUR }]);
      expect(w.store.blockedUntil("server", fast.instanceId)).toBeNull();
      // Auto takes the same message again at once; the conversation stays on Auto.
      expect(w.state.resent).toEqual([{ messageId: "m1", on: { ...A, auto: true } }]);
      expect(w.state.switches).toEqual([]);
    }
  });

  it("never holds the conversation's own model for its quick picks when a refusal bound to it refused that model", async () => {
    const refused: ModelSelection[] = [];
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, refuseModel: (_payer, selection) => { refused.push(selection); } });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    host.noteError("thread", "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up.", undefined, "model");
    expect(host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" })).toBe(true);
    await host.idle();
    // Not a quick pick: the conversation's own turn moves to a backup and comes back at the reset, as before.
    expect(refused).toEqual([]);
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
  });
});

describe("a plan window Sagax read as spent", () => {
  // 2026-11-02 (review): the person's Claude report shows the weekly window at 100 % with extra usage still on. Claude
  // answers on that extra usage: even Sagax's quick pick lands on it, and a chat backup always could.
  it("keeps no engine off while its report shows extra usage left, from the provider's own payload", async () => {
    const weekly = "2026-10-26T18:00:00Z";
    const rowFor = (extra: number) => ({
      id: "claude", name: "Claude", driver: "claude", ok: true, error: null, state: "windows" as const, access: "subscription" as const,
      instanceId: "claude", failure: null,
      ...parseClaudeUsage({ seven_day: { utilization: 100, resets_at: weekly }, extra_usage: { is_enabled: true, utilization: extra } }),
    });
    const engines = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "codex", driverKind: "codex" }];
    for (const [extra, quick] of [[24, []], [100, ["claude"]]] as const) {
      const w = world();
      const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (_payer, id) => id === "claude" ? spentPlanUntil(rowFor(extra)) : null });
      expect([...host.autoExcluded("server", engines, "quick")]).toEqual(quick);
      expect([...host.autoExcluded("server", engines)]).toEqual([]);
      // A person's message Codex refused goes on on Claude either way: a backup reads only the refusals Sagax saw.
      w.state.selection = { ...B };
      host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "codex", driverKind: "codex" }, selection: B, payer: "server", at: w.clock.now });
      host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
      await host.idle();
      expect(w.state.resent).toEqual([{ messageId: "m1", on: A }]);
    }
  });

  it("no longer keeps Sagax's own picks off an engine once a turn on it worked", () => {
    const spent = new Map([["server\u0000codex", Date.UTC(2026, 9, 26)]]);
    const w = world();
    const host = createLimitFailoverHost({
      ...w.deps,
      planLimitUntil: (payer, id) => spent.get(`${payer}\u0000${id}`) ?? null,
      planWorked: (payer, id) => { spent.delete(`${payer}\u0000${id}`); },
    });
    const engines = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "codex", driverKind: "codex" }];
    expect([...host.autoExcluded("server", engines, "quick")]).toEqual(["codex"]);
    // Extra-usage credits, an upgrade or an early reset: the person's turn on Codex answers.
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "codex", driverKind: "codex" }, selection: B, payer: "server", at: w.clock.now });
    host.turnSucceeded("thread");
    expect([...host.autoExcluded("server", engines, "quick")]).toEqual([]);
  });
});

describe("a routine run another model took over", () => {
  it("schedules its conversation's return at the takeover's reset, even with nothing held engine-wide", () => {
    const w = world();
    const resetsAt = w.clock.now + 3 * 3_600_000;
    w.host.takeOver("bot", "thread", B, undefined, resetsAt);
    expect(w.state.selection).toEqual(B);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: B, resetsAt });
    // A later hold on the conversation's own engine delays the return.
    w.state.selection = { ...A };
    w.store.forget("thread");
    w.store.block("server", "claude", resetsAt + 3_600_000);
    w.host.takeOver("bot", "thread", B, undefined, resetsAt);
    expect(w.store.failover("bot", "thread")).toMatchObject({ resetsAt: resetsAt + 3_600_000 });
  });

  it("leaves the conversation on its own model when the limit that moved the run is over by the time it starts", () => {
    const w = world();
    // The run waited past that limit's reset (its thread was busy): moving the conversation to the backup only for
    // beforeTurn to move it straight back would switch it twice and replay its engine session for nothing.
    w.host.takeOver("bot", "thread", B, undefined, w.clock.now - 2 * 60_000);
    expect(w.state.selection).toEqual(A);
    expect(w.state.switches).toEqual([]);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.lines).toEqual([]);
    // A hold still on the conversation's own engine moves it all the same, back at that hold's end.
    const until = w.clock.now + 3_600_000;
    w.store.block("server", "claude", until);
    w.host.takeOver("bot", "thread", B, undefined, w.clock.now - 2 * 60_000);
    expect(w.state.switches).toEqual([B]);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: B, resetsAt: until });
  });
});

// #2192: sibling accounts of the same provider are a silent rotation pool.
describe("account rotation within a provider (#2192)", () => {
  const HOUR = 3_600_000;

  it("moves a person's message to the second sign-in of the same provider before another engine", async () => {
    const w = world({ allowed: ["codex", "grok", "grok-work"] });
    w.state.selection = { ...C };
    w.dispatch(C);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.switches).toEqual([{ instanceId: "grok-work", model: "grok-4.5" }]);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", from: "Grok", to: "Grok (work)" });
  });

  it("hands a run to the sibling account of the engine that refused", () => {
    const w = world({ allowed: ["codex", "grok", "grok-work"] });
    const host = createLimitFailoverHost({ ...w.deps, candidatesNow: () => ["codex", "grok", "grok-work"].map((id) => ({ instanceId: id, driverKind: DRIVERS[id]!, models: ["m"] })) });
    w.state.selection = { ...C };
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "grok", driverKind: "grokAgent" }, selection: C, payer: "server", at: w.clock.now });
    const verdict = host.routineLimit({ threadId: "thread", cause: LIMIT, takeover: true });
    expect(verdict).toMatchObject({ from: "Grok", to: "Grok (work)", selection: { instanceId: "grok-work", model: "m" } });
  });

  it("still takes a pay-per-use key on the same engine when preferred", async () => {
    const w = world({ allowed: ["codex", "grok", "grok-work"] });
    const host = createLimitFailoverHost({ ...w.deps, config: (id) => id === "grok-work" ? { access: "api" } : undefined, preferred: () => [{ instanceId: "grok-work" }] });
    w.store.block("server", "grok", w.clock.now + 3 * HOUR);
    w.state.selection = { ...B };
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "codex", driverKind: "codex" }, selection: B, payer: "server", at: w.clock.now });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await host.idle();
    expect(w.state.switches).toEqual([{ instanceId: "grok-work", model: "grok-4.5" }]);
  });

  it("rotates before the turn when the plan is near its limit and a sibling has headroom", async () => {
    const w = world({ allowed: ["claude", "claude-work", "codex"] });
    const drivers: Record<string, string> = { ...DRIVERS, "claude-work": "claudeAgent" };
    const names: Record<string, string> = { ...NAMES, "claude-work": "Claude (work)" };
    const used = new Map<string, number>([["claude", 92], ["claude-work", 20]]);
    const host = createLimitFailoverHost({
      ...w.deps,
      engine: (id) => drivers[id] ? { instanceId: id, driverKind: drivers[id]! } : undefined,
      engineName: (id) => names[id] ?? id,
      candidates: async () => ["claude", "claude-work", "codex"].map((id) => ({
        instanceId: id, driverKind: drivers[id]!, models: [id === "codex" ? "gpt" : "opus"],
      })),
      planUsedPercent: (_payer, id) => used.get(id) ?? null,
    });
    const pending = host.beforeTurn("bot", "thread", undefined);
    expect(pending).not.toBeNull();
    await pending;
    expect(w.state.switches).toEqual([{ instanceId: "claude-work", model: "opus" }]);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Claude (work)", estimated: true });
  });

  it("retries an empty reply once on the next pool member", async () => {
    const w = world({ allowed: ["claude", "claude-work", "codex"] });
    const drivers: Record<string, string> = { ...DRIVERS, "claude-work": "claudeAgent" };
    const names: Record<string, string> = { ...NAMES, "claude-work": "Claude (work)" };
    const host = createLimitFailoverHost({
      ...w.deps,
      engine: (id) => drivers[id] ? { instanceId: id, driverKind: drivers[id]! } : undefined,
      engineName: (id) => names[id] ?? id,
      candidates: async () => ["claude", "claude-work", "codex"].map((id) => ({
        instanceId: id, driverKind: drivers[id]!, models: [id === "codex" ? "gpt" : "opus"],
      })),
      candidatesNow: () => ["claude", "claude-work", "codex"].map((id) => ({
        instanceId: id, driverKind: drivers[id]!, models: [id === "codex" ? "gpt" : "opus"],
      })),
    });
    expect(host.emptyReplyRetry({ botId: "bot", threadId: "thread", speaker: undefined, messageId: "m1", turnId: "turn-1" })).toBe(true);
    await host.idle();
    expect(w.state.switches).toEqual([{ instanceId: "claude-work", model: "opus" }]);
    expect(w.state.resent).toEqual([{ messageId: "m1", on: { instanceId: "claude-work", model: "opus" } }]);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Claude (work)" });
  });

  it("surfaces exhausted only when every account of every allowed engine is spent", async () => {
    const w = world({ allowed: ["claude", "claude-work"] });
    const drivers: Record<string, string> = { ...DRIVERS, "claude-work": "claudeAgent" };
    const names: Record<string, string> = { ...NAMES, "claude-work": "Claude (work)" };
    const host = createLimitFailoverHost({
      ...w.deps,
      engine: (id) => drivers[id] ? { instanceId: id, driverKind: drivers[id]! } : undefined,
      engineName: (id) => names[id] ?? id,
      candidates: async () => ["claude", "claude-work"].map((id) => ({
        instanceId: id, driverKind: drivers[id]!, models: ["opus"],
      })),
    });
    w.store.block("server", "claude-work", w.clock.now + HOUR);
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await host.idle();
    expect(w.state.switches).toEqual([]);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "waiting", from: "Claude" });
  });
});

// 2026-11-02 (review): the engines' report (/api/limit-resets) says an engine is at its limit only when the refusal
// holds that engine: never for one model's own window, nor for a fast model Sagax picked on the conversation's own
// engine, which holds only that model.
describe("whether a refusal holds its whole engine", () => {
  it("says no for a fast model Sagax picked on the conversation's own engine, yes for another engine's", () => {
    const w = world();
    w.host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: { instanceId: "claude", model: "haiku" }, payer: "server", at: w.clock.now, detour: true });
    expect(w.host.refusalHoldsEngine("thread")).toBe(false);
    w.host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "codex", driverKind: "codex" }, selection: B, payer: "server", at: w.clock.now, detour: true });
    expect(w.host.refusalHoldsEngine("thread")).toBe(true);
    w.host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
    expect(w.host.refusalHoldsEngine("thread")).toBe(true);
    expect(w.host.refusalHoldsEngine("thread", "model")).toBe(false);
    // A turn Sagax never saw dispatched: the engine's own words decide, as before.
    expect(w.host.refusalHoldsEngine("unknown")).toBe(true);
  });

  it("says yes for that fast model when the engine's plan is spent", () => {
    const w = world();
    const host = createLimitFailoverHost({ ...w.deps, planLimitUntil: (_payer, id) => id === "claude" ? w.clock.now + 3_600_000 : null });
    host.noteDispatch("thread", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: { instanceId: "claude", model: "haiku" }, payer: "server", at: w.clock.now, detour: true });
    expect(host.refusalHoldsEngine("thread")).toBe(true);
  });
});

describe("a routine run going back to the conversation's own model", () => {
  it("ends the takeover that moved the conversation off it, with no second line", () => {
    const w = world();
    w.store.record({ botId: "bot", threadId: "thread", from: A, to: B, resetsAt: w.clock.now - 3_600_000, at: w.clock.now - 4 * 3_600_000 });
    w.state.selection = { ...B };
    w.host.takeOver("bot", "thread", A, undefined);
    expect(w.state.selection).toEqual(A);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.state.lines).toEqual([]);
  });

  it("returns a conversation a backup took over to its own model at that model's reset, not the backup's", () => {
    const w = world();
    const own = w.clock.now + 3 * 3_600_000;
    w.store.block("server", "claude", own);
    w.store.record({ botId: "bot", threadId: "thread", from: A, to: B, resetsAt: own, at: w.clock.now });
    w.state.selection = { ...B };
    // Codex refused in turn (held for an hour): Grok takes the run over, back on Claude at Claude's reset.
    w.store.block("server", "codex", w.clock.now + 3_600_000);
    w.host.takeOver("bot", "thread", C, undefined, own);
    expect(w.state.selection).toEqual(C);
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: C, resetsAt: own });
  });
});

// 2026-11-02 (final review): a person's message, or a run the routine manager left to turnFailed, whose backup standing
// in for the conversation's own engine is refused in turn. The line names that backup as the engine that refused, and
// the conversation's own engine with its own reset, as a run's line does (routineLimit). Before, the switch line named
// the conversation's own engine as the one that had just refused, and the wait never named the backup.
describe("a turn whose backup standing in for the conversation's own engine is refused in turn", () => {
  const HOUR = 3_600_000;
  const LIMIT_5H = "You've hit your usage limit. Try again in 5 hours.";
  /** Claude (2 h, or `first`) moved the conversation to Codex; the next turn runs on Codex. */
  const onStandIn = async (w: ReturnType<typeof world>, options: { owner?: boolean; first?: string } = {}) => {
    w.dispatch(w.state.selection, options.owner === true);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: options.first ?? LIMIT });
    await w.host.idle();
    expect(w.state.selection).toEqual(B);
    w.dispatch(w.state.selection, options.owner === true);
    w.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
  };

  it("names the refused backup and the engine it stood in for when another backup takes the message over", async () => {
    const w = world();
    await onStandIn(w);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await w.host.idle();
    expect(w.state.resent.at(-1)).toEqual({ messageId: "m1", on: C });
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", replaced: "turn-2",
      line: { kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: w.clock.now + 2 * HOUR } });
  });

  it("names them when it waits for the conversation's own engine, and sends the message again there at its reset", async () => {
    const w = world({ allowed: ["claude", "codex"] });
    w.host.start();
    await onStandIn(w);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await w.host.idle();
    const claudeReset = w.clock.now + 2 * HOUR;
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", replaced: "turn-2",
      line: { kind: "exhausted", tried: ["Claude", "Codex"], resetsAt: claudeReset } });
    expect(w.store.resumes()).toEqual([expect.objectContaining({ kind: "message", messageId: "m1", engine: "claude", at: claudeReset + w.store.afterResetMs })]);
    // At Claude's reset the conversation is back on Claude, though Codex is still held, and the message goes there.
    w.clock.now = claudeReset + w.store.afterResetMs;
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
    await w.host.tick();
    expect(w.state.resent.at(-1)).toEqual({ messageId: "m1", on: A });
    w.host.stop();
  });

  it("says the conversation's own engine gave no reset time when its return is only Sagax's estimate", async () => {
    const switching = world();
    await onStandIn(switching, { first: "You've hit your usage limit." });
    switching.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await switching.host.idle();
    expect(switching.state.lines.at(-1)!.line).toEqual({ kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: switching.clock.now + HOUR, estimated: true });
    const waiting = world({ allowed: ["claude", "codex"] });
    await onStandIn(waiting, { first: "You've hit your usage limit." });
    waiting.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await waiting.host.idle();
    expect(waiting.state.lines.at(-1)!.line).toEqual({ kind: "exhausted", tried: ["Claude", "Codex"], resetsAt: waiting.clock.now + HOUR });
  });

  it("still says whose limit it is when the bot owner's plan pays for a member's turn (J4)", async () => {
    const switching = world();
    await onStandIn(switching, { owner: true });
    switching.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await switching.host.idle();
    expect(switching.state.lines.at(-1)!.line).toEqual({ kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: switching.clock.now + 2 * HOUR, owner: true });
    const waiting = world({ allowed: ["claude", "codex"] });
    await onStandIn(waiting, { owner: true });
    waiting.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
    await waiting.host.idle();
    expect(waiting.state.lines.at(-1)!.line).toEqual({ kind: "exhausted", tried: ["Claude", "Codex"], resetsAt: waiting.clock.now + 2 * HOUR, owner: true });
  });

  it("names them too when that backup is known to be held before the next turn, and returns at the own engine's reset", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.selection).toEqual(B);
    // Another conversation of this payer met Codex's limit meanwhile: Codex is held for five hours.
    w.store.block("server", "codex", w.clock.now + 5 * HOUR);
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(C);
    // Back on Claude at Claude's own reset, never at Codex's later one.
    expect(w.store.failover("bot", "thread")).toMatchObject({ from: A, to: C, resetsAt: w.clock.now + 2 * HOUR });
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", line: { kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: w.clock.now + 2 * HOUR } });
    w.clock.now += 2 * HOUR + w.store.afterResetMs;
    expect(w.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(w.state.selection).toEqual(A);
  });

  // 2026-11-02 (review of the final pass): the conversation's own engine took turns again before its return was due (its
  // hold ended at its reset, and the return waits a minute more; or a turn on it worked since, which ends its hold), so
  // the backup picked for the refused stand-in was that engine itself. Before, the conversation moved "to" Claude as a
  // stand-in for Claude, its row went from Claude to Claude, and the line said "continuing on Claude, back on Claude when
  // it resets". It goes back to Claude, as a run does (routineLimit's backHome), and the line says so.
  it("goes back to the conversation's own engine when its limit ended before its return was due", async () => {
    for (const ended of ["at its reset", "a turn on it worked"] as const) {
      const w = world();
      await onStandIn(w);
      if (ended === "at its reset") w.clock.now += 2 * HOUR + 30_000;
      else {
        // Another conversation of this payer gets an answer from Claude: its hold ends now.
        w.host.noteDispatch("thread-2", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: A, payer: "server", at: w.clock.now });
        w.host.turnSucceeded("thread-2");
      }
      w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H });
      await w.host.idle();
      expect(w.state.selection).toEqual(A);
      expect(w.state.resent.at(-1)).toEqual({ messageId: "m1", on: A });
      expect(w.store.failover("bot", "thread")).toBeUndefined();
      expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", replaced: "turn-2", line: { kind: "back", engine: "Claude", refused: "Codex" } });
      expect(w.store.blockedUntil("server", "codex")).toBe(w.clock.now + 5 * HOUR);
    }
  });

  it("goes back to it before the next turn too, when the backup is held and that engine's limit ended", async () => {
    const w = world();
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.selection).toEqual(B);
    // Claude's hold ended at its reset, its return is due a minute later, and another conversation met Codex's limit.
    w.clock.now += 2 * HOUR + 30_000;
    w.store.block("server", "codex", w.clock.now + 5 * HOUR);
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(A);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.state.lines.at(-1)).toEqual({ threadId: "thread", line: { kind: "back", engine: "Claude", refused: "Codex" } });
  });

  it("sends a routine run back to it too, and runs the routine there", async () => {
    const w = world();
    await onStandIn(w);
    w.state.request = undefined;
    w.clock.now += 2 * HOUR + 30_000;
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H, routineRun: { id: "run-1", routineId: "routine" } })).toBe(true);
    await w.host.idle();
    expect(w.state.selection).toEqual(A);
    expect(w.state.reruns).toEqual(["routine"]);
    expect(w.state.superseded).toEqual(["run-1"]);
    expect(w.store.failover("bot", "thread")).toBeUndefined();
    expect(w.state.lines.at(-1)!.line).toEqual({ kind: "back", engine: "Claude", refused: "Codex" });
  });

  // A limit bound only to the conversation's own model (Claude's limitScope "model": that model's weekly window) holds
  // nothing on its engine, so Claude takes turns, even answers one, while that model's own limit holds. Claude is no
  // backup for it then (as for a run, routineBackup), and no line says its limit has reset.
  it("never takes the conversation's own engine back while a limit bound to its own model still holds", async () => {
    const ownModelLimit = (w: ReturnType<typeof world>) => {
      w.dispatch();
      w.host.noteError("thread", "This Claude account has reached its weekly limit for this model.", w.clock.now + 3 * HOUR, "model");
      w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: undefined, stopReason: "quota" });
    };
    const switching = world();
    ownModelLimit(switching);
    await switching.host.idle();
    expect(switching.state.selection).toEqual(B);
    expect(switching.store.blockedUntil("server", "claude")).toBeNull();
    // Another model of Claude answers another conversation: that says nothing of this model's own limit.
    switching.host.noteDispatch("thread-2", { botId: "bot", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: { instanceId: "claude", model: "sonnet" }, payer: "server", at: switching.clock.now });
    switching.host.turnSucceeded("thread-2");
    switching.dispatch(switching.state.selection);
    switching.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
    switching.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT });
    await switching.host.idle();
    expect(switching.state.selection).toEqual(C);
    expect(switching.state.lines.at(-1)!.line).toEqual({ kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: switching.clock.now + 3 * HOUR });
    // Back on Claude at that model's own reset.
    switching.clock.now += 3 * HOUR + switching.store.afterResetMs;
    expect(switching.host.beforeTurn("bot", "thread", undefined)).toBeNull();
    expect(switching.state.selection).toEqual(A);

    const waiting = world({ allowed: ["claude", "codex"] });
    ownModelLimit(waiting);
    await waiting.host.idle();
    waiting.dispatch(waiting.state.selection);
    waiting.state.request = { messageId: "m1", turnId: "turn-2", origin: { kind: "user" } };
    waiting.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT });
    await waiting.host.idle();
    expect(waiting.state.selection).toEqual(B);
    expect(waiting.state.lines.at(-1)!.line).toEqual({ kind: "exhausted", tried: ["Claude", "Codex"], resetsAt: waiting.clock.now + 3 * HOUR });
    expect(waiting.store.resumes()).toEqual([expect.objectContaining({ kind: "message", engine: "claude", at: waiting.clock.now + 3 * HOUR + waiting.store.afterResetMs })]);
    // Within the minute after that model's reset, its limit is over: the stand-in's next refusal sends it back there.
    waiting.clock.now += 3 * HOUR + 30_000;
    waiting.dispatch(waiting.state.selection);
    waiting.state.request = { messageId: "m2", turnId: "turn-3", origin: { kind: "user" } };
    waiting.host.turnFailed({ threadId: "thread", turnId: "turn-3", cause: LIMIT });
    await waiting.host.idle();
    expect(waiting.state.selection).toEqual(A);
    expect(waiting.state.lines.at(-1)!.line).toEqual({ kind: "back", engine: "Claude", refused: "Codex" });
  });

  it("names them for a routine run too, when it goes on another backup or waits for the conversation's own engine", async () => {
    const run = { id: "run-1", routineId: "routine" };
    const switching = world();
    await onStandIn(switching);
    switching.state.request = undefined;
    expect(switching.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H, routineRun: run })).toBe(true);
    await switching.host.idle();
    expect(switching.state.reruns).toEqual(["routine"]);
    expect(switching.state.lines.at(-1)!.line).toEqual({ kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: switching.clock.now + 2 * HOUR });
    const waiting = world({ allowed: ["claude", "codex"] });
    await onStandIn(waiting);
    waiting.state.request = undefined;
    expect(waiting.host.turnFailed({ threadId: "thread", turnId: "turn-2", cause: LIMIT_5H, routineRun: run })).toBe(true);
    await waiting.host.idle();
    expect(waiting.state.lines.at(-1)!.line).toEqual({ kind: "waitingRoutine", from: "Codex", home: "Claude", resetsAt: waiting.clock.now + 2 * HOUR });
    expect(waiting.store.resumes()).toEqual([expect.objectContaining({ kind: "routine", routineId: "routine", engine: "claude", at: waiting.clock.now + 2 * HOUR + waiting.store.afterResetMs })]);
  });
});

// #3552 (review): an engine out of credit. The runtime error writes no row for
// credit (runtime-lifecycle's engineLimited), and the message box draws no bar:
// the conversation's one line says it, promising no resend and no reset, by the
// same verdict as the runtime error (classifyRoutineFailure's "credits").
describe("an engine out of credit (#3552)", () => {
  const CREDIT_WORDS = [
    "Payment required",
    "No credits remaining on this account.",
    "You have used all available credits.",
    "HTTP 402: Payment Required",
    "Your credit balance is too low to access the API.",
  ];

  it.each(CREDIT_WORDS)("tells %j once, holding nothing for a reset", async (cause) => {
    const w = world({ allowed: ["claude"] });
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause })).toBe(true);
    await w.host.idle();
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1", line: { kind: "credits", engine: "Claude" } }]);
    expect(w.store.resumes()).toEqual([]);
    expect(w.host.heldUntil("bot", "thread")).toBeNull();
    expect(w.state.resent).toEqual([]);
  });

  it("names the owner's credit on a bot the owner pays for", async () => {
    const w = world({ allowed: ["claude"] });
    w.dispatch(undefined, true);
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "Payment required" });
    await w.host.idle();
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1", line: { kind: "credits", engine: "Claude", owner: true } }]);
  });

  it("still tells it when the failover is off", async () => {
    const w = world();
    w.deps.enabled = () => false;
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "Payment required" })).toBe(true);
    expect(w.state.lines).toEqual([{ threadId: "thread", replaced: "turn-1", line: { kind: "credits", engine: "Claude" } }]);
  });

  it("goes on another engine that can answer, with the switch line", async () => {
    const w = world();
    w.dispatch();
    expect(w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: "Payment required" })).toBe(true);
    await w.host.idle();
    expect(w.state.resent).toEqual([{ messageId: "m1", on: B }]);
    expect(w.state.lines).toHaveLength(1);
    expect(w.state.lines[0]!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Codex" });
  });

  it("keeps the wait for a usage limit, and tells that the message is held", async () => {
    const w = world({ allowed: ["claude"] });
    const held: string[] = [];
    w.deps.messageHeld = (_bot, threadId) => { held.push(threadId); };
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT });
    await w.host.idle();
    expect(w.state.lines.at(-1)!.line).toMatchObject({ kind: "waiting", from: "Claude" });
    expect(w.host.heldUntil("bot", "thread")).not.toBeNull();
    // one way to resume: an earlier "Continue at" automation is dropped
    expect(held).toEqual(["thread"]);
  });
});
