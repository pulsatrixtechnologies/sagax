import { describe, expect, it } from "vitest";

import type { LimitFailoverLine } from "../shared/limit-failover.ts";
import type { ModelSelection } from "../shared/wire.ts";
import { LimitFailoverStore, type LimitCandidate } from "./limit-failover.ts";
import { createLimitFailoverHost, limitBackupRefusedText, type LimitFailoverHostDeps, type LimitRequest } from "./limit-failover-host.ts";

const A: ModelSelection = { instanceId: "claude", model: "opus" };
const B: ModelSelection = { instanceId: "codex", model: "gpt" };
const C: ModelSelection = { instanceId: "grok", model: "grok-4.5" };
const DRIVERS: Record<string, string> = { claude: "claudeAgent", codex: "codex", grok: "grokAgent", forbidden: "geminiAgent" };
const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok", forbidden: "Gemini" };
const LIMIT = "You've hit your usage limit. Try again in 2 hours.";

/** A small world: one bot, one thread, the engines this speaker may use. */
function world(options: { allowed?: string[]; preferred?: Array<{ instanceId: string; model?: string }>; busy?: boolean } = {}) {
  const clock = { now: Date.UTC(2026, 9, 19, 16, 0) };
  const state = {
    selection: { ...A } as ModelSelection,
    lines: [] as Array<{ threadId: string; line: LimitFailoverLine; replaced?: string }>,
    resent: [] as Array<{ messageId: string; on: ModelSelection }>,
    reruns: [] as string[],
    request: { messageId: "m1", turnId: "turn-1", origin: { kind: "user" } } as LimitRequest | undefined,
    busy: options.busy ?? false,
    switches: [] as ModelSelection[],
  };
  const allowed = options.allowed ?? ["claude", "codex", "grok"];
  const store = new LimitFailoverStore({ file: null, now: () => clock.now });
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const deps: LimitFailoverHostDeps = {
    store,
    now: () => clock.now,
    enabled: () => true,
    engineName: (id) => NAMES[id] ?? id,
    engine: (id) => DRIVERS[id] ? { instanceId: id, driverKind: DRIVERS[id]! } : undefined,
    // Only what this speaker may use: allowedEngines, sign-ins, policy.
    candidates: async () => allowed.map((id): LimitCandidate => ({
      instanceId: id, driverKind: DRIVERS[id]!, models: [id === "codex" ? "gpt" : id === "grok" ? "grok-4.5" : "opus"],
    })),
    preferred: () => options.preferred ?? [],
    config: () => undefined,
    payer: () => "server",
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
    rerunRoutine: (routineId) => { state.reruns.push(routineId); return true; },
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
  return { clock, state, store, host, dispatch, timers };
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
    expect(w.state.lines.at(-1)!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Grok" });
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
    // It failed again on the same limit: no second resume, the error stays.
    w.dispatch();
    w.host.turnFailed({ threadId: "thread", turnId: "turn-3", cause: LIMIT });
    await w.host.idle();
    expect(w.store.resumes()).toEqual([]);
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
    expect(w.state.reruns).toEqual(["routine"]);
    // The next run starts on the backup, with its line.
    await w.host.beforeTurn("bot", "thread", undefined);
    expect(w.state.selection).toEqual(B);
    expect(w.state.lines.at(-1)!.line).toMatchObject({ kind: "switched", from: "Claude", to: "Codex" });

    const alone = world({ allowed: ["claude"] });
    alone.dispatch();
    alone.host.turnFailed({ threadId: "thread", turnId: "turn-1", cause: LIMIT, routineRun: { id: "run-1", routineId: "routine" } });
    await alone.host.idle();
    expect(alone.state.reruns).toEqual([]);
    expect(alone.state.lines[0]!.line).toMatchObject({ kind: "waitingRoutine", from: "Claude" });
    alone.clock.now = alone.store.nextResumeAt()!;
    await alone.host.tick();
    expect(alone.state.reruns).toEqual(["routine"]);
  });
});

describe("the next turn", () => {
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
