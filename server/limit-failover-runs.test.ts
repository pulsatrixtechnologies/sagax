// A usage limit on a routine run, a webhook run and a proactive wake
// (2026-11-02): the real limit failover host (server/limit-failover-host.ts)
// wired to a real RoutineManager the way server/index.ts wires them. The
// report that started it: a bot's proactive wake ran on its fast model, on
// another engine, and that engine's limit refused it; the run failed as
// "This bot's engine reached its usage limit", the bot's Primary Bot relayed
// that her engine was down, and the wake never ran while the bot's own
// engine was answering. Here a refused run goes on at once on an engine that
// works, and every line says which engine refused and when it is back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LimitFailoverLine } from "../shared/limit-failover.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import type { ModelSelection } from "../shared/wire.ts";
import { LimitFailoverStore, type LimitCandidate } from "./limit-failover.ts";
import { createLimitFailoverHost } from "./limit-failover-host.ts";
import { retryNote, type RoutineAlert } from "./routines/routine-recovery.ts";
import { RoutineManager, type RoutineRun } from "./routines/routines.ts";

const NOW = Date.UTC(2026, 10, 2, 13, 16);
const HOUR = 3_600_000;
const GROK: ModelSelection = { instanceId: "grok", model: "grok-4.5" };
const GROK_FAST: ModelSelection = { instanceId: "grok", model: "grok-4.7-build-fast" };
const CODEX_FAST: ModelSelection = { instanceId: "codex", model: "gpt-6.1-luna" };
const CLAUDE: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const DRIVERS: Record<string, string> = { claude: "claudeAgent", codex: "codex", grok: "grokAgent" };
const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok" };
const MODELS: Record<string, string[]> = { claude: ["claude-sonnet-5"], codex: ["gpt-6.1-sol", "gpt-6.1-luna"], grok: ["grok-4.5", "grok-4.7-build-fast"] };
const LIMIT_2H = "You've hit your usage limit. Try again in 2 hours.";
type EventBody = RuntimeEvent extends infer E ? E extends RuntimeEvent ? Omit<E, "eventId" | "provider" | "threadId" | "createdAt"> : never : never;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One bot on `own`; `fast` is the model a proactive wake picks (#1694), when it has one. `plans`: the engines whose
 * plan window the person's usage report showed spent, until when (J4). `chat`: the thread "chat" is the person's
 * conversation, its last message their own. */
function world(options: {
  own?: ModelSelection; fast?: ModelSelection; allowed?: string[]; language?: string; plans?: Record<string, number>; chat?: boolean;
  /** Every run joins the person's conversation "chat" (a wait's follow-up does, wait-host.ts) instead of a hidden task. */
  joinChat?: boolean;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-limit-runs-"));
  dirs.push(dir);
  const clock = { now: NOW };
  const own = options.own ?? GROK;
  const allowed = options.allowed ?? ["claude", "codex", "grok"];
  const threads = new Map<string, ModelSelection>();
  if (options.joinChat) threads.set("chat", { ...own });
  /** The conversations working now: a run that joins one waits (RoutineManager threadBusy). */
  const busyThreads = new Set<string>();
  const lines: Array<{ threadId: string; line: LimitFailoverLine }> = [];
  const refusedModels: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
  const started: Array<{ runId: string; threadId: string; selection: ModelSelection; prompt: string }> = [];
  const failed: Array<{ run: RoutineRun; alert: RoutineAlert | null | undefined }> = [];
  const deferred: Array<{ run: RoutineRun; alert?: RoutineAlert }> = [];
  const resent: Array<{ threadId: string; messageId: string; on: ModelSelection }> = [];
  /** Every model switch of a conversation (each one replays its engine session). */
  const switches: Array<{ threadId: string; to: ModelSelection }> = [];
  const candidatesNow = (): LimitCandidate[] => allowed.map((id) => ({ instanceId: id, driverKind: DRIVERS[id]!, models: MODELS[id]! }));
  const store = new LimitFailoverStore({ file: null, now: () => clock.now });
  const host = createLimitFailoverHost({
    store,
    now: () => clock.now,
    enabled: () => true,
    engineName: (id) => NAMES[id] ?? id,
    engine: (id) => DRIVERS[id] ? { instanceId: id, driverKind: DRIVERS[id]! } : undefined,
    candidates: async () => candidatesNow(),
    candidatesNow,
    refuseModel: (payer, selection, until) => { refusedModels.push({ payer, selection, until }); },
    planLimitUntil: (_payer, instanceId) => options.plans?.[instanceId] ?? null,
    preferred: () => [],
    config: () => undefined,
    payer: () => "person",
    threadSelection: (_bot, threadId) => threads.get(threadId) ?? null,
    busy: () => false,
    switchThread: (_bot, threadId, to) => { threads.set(threadId, { ...to }); switches.push({ threadId, to: { ...to } }); return null; },
    note: (threadId, line) => { lines.push({ threadId, line }); },
    replaceFailure: (threadId, _turnId, line) => { lines.push({ threadId, line }); },
    request: (threadId) => options.chat && threadId === "chat" ? { messageId: "msg-1", turnId: "turn-1", origin: { kind: "user" } } : undefined,
    resend: async (_bot, threadId, messageId) => { resent.push({ threadId, messageId, on: { ...threads.get(threadId)! } }); return true; },
    autoRefuse: () => {},
    rerunRoutine: () => false,
    after: () => ({ cancel: () => {} }),
  });
  let tasks = 0;
  const manager = new RoutineManager({
    file: join(dir, "routines.json"),
    now: () => clock.now,
    botState: () => "ready",
    createTask: () => {
      const threadId = `thread-${++tasks}`;
      threads.set(threadId, { ...own });
      return { threadId };
    },
    // What server/index.ts startTurn does with a run's model: the model that
    // took it over first, then the usual limit check, then a wake's fast pick.
    joinConversation: () => options.joinChat ? "chat" : null,
    threadBusy: (_bot, threadId) => busyThreads.has(threadId),
    startTurn: async (botId, threadId, prompt, _runOn, _trigger, _onError, run) => {
      if (run?.limitTakeover) host.takeOver(botId, threadId, run.limitTakeover, undefined, run.limitTakeoverUntil);
      await host.beforeTurn(botId, threadId, undefined);
      const thread = threads.get(threadId)!;
      // voicePickForTurn: the fast pick skips an engine the payer is known to be out of.
      const fastOut = options.fast ? host.autoExcluded("person", [{ instanceId: options.fast.instanceId, driverKind: DRIVERS[options.fast.instanceId]! }]).has(options.fast.instanceId) : true;
      const detour = Boolean(run?.proactive && options.fast && !run.limitTakeover && !fastOut);
      const selection = detour ? options.fast! : thread;
      host.noteDispatch(threadId, {
        botId, engine: { instanceId: selection.instanceId, driverKind: DRIVERS[selection.instanceId]! }, selection,
        payer: "person", at: clock.now, ...(detour ? { detour: true as const } : {}),
      });
      started.push({ runId: run!.id, threadId, selection: { ...selection }, prompt });
    },
    usageLimit: (run, failure, facts, takeover) => run.threadId
      ? host.routineLimit({ threadId: run.threadId, cause: failure, stopReason: facts.stopReason, takeover })
      : null,
    languageFor: () => options.language,
    timeZoneFor: () => "UTC",
    onRunFailed: (run, alert) => { failed.push({ run, alert }); },
    onRunDeferred: (run, alert) => { deferred.push({ run, alert }); },
  });
  const event = (threadId: string, body: EventBody) => {
    const full = { eventId: `event-${Math.random()}`, provider: "fake", threadId, createdAt: new Date(clock.now).toISOString(), ...body } as RuntimeEvent;
    if (full.type === "runtime.error") host.noteError(threadId, full.message, full.limitResetsAt, full.limitScope);
    const run = manager.handleRuntimeEvent(full);
    // server/index.ts hands the same failure to turnFailed after the routine manager saw it.
    if (full.type === "turn.completed" && !full.ok) {
      return { run, taken: host.turnFailed({ threadId, cause: run?.error, stopReason: full.stopReason, routineRun: run?.status === "failed" ? run : null }) };
    }
    return { run, taken: false };
  };
  return {
    clock, threads, busyThreads, lines, refusedModels, started, failed, deferred, resent, switches, store, host, manager,
    run: (id: string) => manager.listRuns().find((candidate) => candidate.id === id)!,
    tick: async () => { await manager.tick(); },
    advance: async (ms: number) => { clock.now += ms; await manager.tick(); },
    fail: (threadId: string, message: string, extra: { stopReason?: string } & Partial<Extract<RuntimeEvent, { type: "runtime.error" }>> = {}) => {
      const { stopReason, ...flags } = extra;
      event(threadId, { type: "runtime.error", message, ...flags });
      return event(threadId, { type: "turn.completed", ok: false, stopReason: stopReason ?? null });
    },
    complete: (threadId: string, text = "Done.") => {
      event(threadId, { type: "item.completed", itemType: "assistant_text", text });
      event(threadId, { type: "turn.completed", ok: true });
    },
    wake: () => manager.enqueueProactive({
      botId: "nova", name: "Proactive: failed run", prompt: "Proactive wake: a run failed.", proactive: { mode: "proactive", hops: 0, sources: ["run"] },
    }),
  };
}

describe("a proactive wake whose fast model a limit refused", () => {
  it("goes on at once on the bot's own engine, and says the other engine refused", async () => {
    const w = world({ own: GROK, fast: CODEX_FAST });
    const wake = w.wake();
    await w.tick();
    expect(w.started).toEqual([expect.objectContaining({ runId: wake.id, selection: CODEX_FAST })]);
    const { taken } = w.fail(w.started[0]!.threadId, LIMIT_2H);
    // The host read it before the run could fail; turnFailed has nothing left to do.
    expect(taken).toBe(false);
    expect(w.failed).toEqual([]);
    expect(w.run(wake.id)).toMatchObject({
      status: "queued", retried: "usage_limit", limitTakeovers: 1, limitTakeover: GROK,
      // The wake never goes back to that quick model: Sagax only skips it until it resets.
      attention: "Usage limit reached on Codex (gpt-6.1-luna): this run continues on Grok. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets, around Nov 2, 3:16 PM (UTC).",
    });
    // Another engine took it (it counts as one of two), and its own conversation never left its model.
    expect(w.run(wake.id).limitModelRetry).toBeUndefined();
    expect(w.run(wake.id).limitTakeoverUntil).toBeUndefined();
    // The limit is Codex's, held for its payer; the bot's own engine is free.
    expect(w.store.blockedUntil("person", "codex")).toBe(NOW + 2 * HOUR);
    expect(w.store.blockedUntil("person", "grok")).toBeNull();
    await w.host.idle();
    expect(w.lines).toEqual([{ threadId: w.started[0]!.threadId, line: { kind: "switched", from: "Codex (gpt-6.1-luna)", to: "Grok", resetsAt: NOW + 2 * HOUR, detour: true } }]);
    expect(w.store.failover("nova", w.started[0]!.threadId)).toBeUndefined();

    await w.tick();
    expect(w.started).toHaveLength(2);
    expect(w.started[1]).toMatchObject({ runId: wake.id, threadId: w.started[0]!.threadId, selection: GROK });
    expect(w.started[1]!.prompt).toContain(retryNote("usage_limit"));
    w.complete(w.started[1]!.threadId);
    expect(w.run(wake.id).status).toBe("completed");
    expect(w.failed).toEqual([]);
  });

  it("holds only the fast model when it is on the bot's own engine, never the engine", async () => {
    const w = world({ own: GROK, fast: GROK_FAST });
    const wake = w.wake();
    await w.tick();
    w.fail(w.started[0]!.threadId, "Grok refused this turn (model grok-4.7-build-fast): the Grok account it runs on reached its usage limit. Wait for it to reset, or choose another model for this bot.");
    expect(w.failed).toEqual([]);
    expect(w.store.blockedUntil("person", "grok")).toBeNull();
    expect(w.refusedModels).toEqual([{ payer: "person", selection: GROK_FAST, until: NOW + HOUR }]);
    expect(w.run(wake.id)).toMatchObject({
      status: "queued", limitTakeover: GROK, limitTakeovers: 1, limitModelRetry: true,
      attention: "Usage limit reached on Grok (grok-4.7-build-fast): this run continues on Grok (grok-4.5). Grok (grok-4.7-build-fast) gave no reset time: Sagax skips it for quick turns until around Nov 2, 2:16 PM (UTC).",
    });
    await w.tick();
    expect(w.started[1]!.selection).toEqual(GROK);
  });

  it("still has two backup engines when the same account refuses the conversation's own model too", async () => {
    const w = world({ own: GROK, fast: GROK_FAST });
    const wake = w.wake();
    const accountSpent = "Grok refused this turn (model grok-4.7-build-fast): the Grok account it runs on reached its usage limit. Wait for it to reset, or choose another model for this bot.";
    await w.tick();
    w.fail(w.started[0]!.threadId, accountSpent);
    await w.tick();
    // The retry on the conversation's own model is refused too: now the engine is held, and another engine takes over.
    w.fail(w.started[1]!.threadId, "Grok refused this turn (model grok-4.5): the Grok account it runs on reached its usage limit.");
    expect(w.store.blockedUntil("person", "grok")).toBe(NOW + HOUR);
    expect(w.run(wake.id)).toMatchObject({ status: "queued", limitTakeovers: 2, limitModelRetry: true, limitTakeover: CLAUDE });
    await w.tick();
    w.fail(w.started[2]!.threadId, LIMIT_2H);
    // The same-engine retry was not one of the two takeovers: a second backup engine still runs the wake.
    expect(w.run(wake.id)).toMatchObject({ status: "queued", limitTakeovers: 3, limitTakeover: { instanceId: "codex", model: "gpt-6.1-sol" } });
    await w.tick();
    expect(w.started.map((start) => start.selection)).toEqual([GROK_FAST, GROK, CLAUDE, { instanceId: "codex", model: "gpt-6.1-sol" }]);
    w.complete(w.started[3]!.threadId);
    expect(w.run(wake.id).status).toBe("completed");
    expect(w.failed).toEqual([]);
  });

  it("says it in Quebec French for a person who reads French", async () => {
    const w = world({ own: GROK, fast: CODEX_FAST, language: "fr-CA" });
    const wake = w.wake();
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    expect(w.run(wake.id).attention).toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) : cette exécution continue sur Grok. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation, vers le 2 nov., 15 h 16 (UTC).");
  });
});

describe("a webhook run or a scheduled routine its engine's limit refused", () => {
  it("runs the same webhook event again at once on a backup, on the run's own thread", async () => {
    const w = world({ own: CLAUDE });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-1", webhookName: "New email", prompt: "EVENT-PAYLOAD-7", botId: "nova", runOn: "maus", deliveryId: "delivery-1", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    expect(w.failed).toEqual([]);
    expect(w.run(queued.id)).toMatchObject({
      status: "queued", limitTakeover: { instanceId: "codex", model: "gpt-6.1-sol" },
      attention: "Usage limit reached on Claude: this run continues on Codex. Back on Claude once it resets, around Nov 2, 3:16 PM (UTC).",
    });
    await w.tick();
    expect(w.started[1]).toMatchObject({ runId: queued.id, threadId: w.started[0]!.threadId, selection: { instanceId: "codex", model: "gpt-6.1-sol" } });
    expect(w.started[1]!.prompt).toContain("EVENT-PAYLOAD-7");
    // The run's thread goes back to Claude after the reset, like a person's conversation.
    expect(w.store.failover("nova", w.started[0]!.threadId)).toMatchObject({ from: CLAUDE, to: { instanceId: "codex", model: "gpt-6.1-sol" }, resetsAt: NOW + 2 * HOUR });
    w.complete(w.started[1]!.threadId);
    expect(w.run(queued.id).status).toBe("completed");
  });

  it("runs a scheduled routine's run again at once on a backup, and its failure is never announced", async () => {
    const w = world({ own: CLAUDE });
    const routine = w.manager.create({ name: "Inbox sweep", prompt: "Sweep the inbox", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    w.fail(w.started[0]!.threadId, "This Claude account has reached its weekly limit.", { stopReason: "quota", limitResetsAt: NOW + 3 * HOUR });
    expect(w.failed).toEqual([]);
    expect(w.run(run.id).attention).toBe("Usage limit reached on Claude: this run continues on Codex. Back on Claude once it resets, around Nov 2, 4:16 PM (UTC).");
    await w.tick();
    expect(w.started[1]!.selection.instanceId).toBe("codex");
    w.complete(w.started[1]!.threadId);
    expect(w.run(run.id).status).toBe("completed");
  });

  it("calls a rate limit its driver gave up on a rate limit, and goes on a backup", async () => {
    const w = world({ own: CLAUDE });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-2", webhookName: "Deploys", prompt: "deploy 42", botId: "nova", runOn: "maus", deliveryId: "delivery-2", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, "429 Too Many Requests");
    expect(w.run(queued.id)).toMatchObject({
      status: "queued", retried: "rate_limited",
      attention: "Rate limit reached on Claude: this run continues on Codex. Claude gave no reset time: it is tried again around Nov 2, 1:31 PM (UTC).",
    });
  });

  it("goes on at most twice, then says the truth about the last engine", async () => {
    const w = world({ own: CLAUDE });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-3", webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: "delivery-3", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    await w.tick();
    expect(w.started[1]!.selection.instanceId).toBe("codex");
    w.fail(w.started[1]!.threadId, LIMIT_2H);
    expect(w.run(queued.id)).toMatchObject({ status: "queued", limitTakeovers: 2, limitTakeover: { instanceId: "grok", model: "grok-4.5" } });
    await w.tick();
    expect(w.started[2]!.selection.instanceId).toBe("grok");
    w.fail(w.started[2]!.threadId, "You've hit your usage limit.");
    expect(w.run(queued.id)).toMatchObject({ status: "failed", error: "You've hit your usage limit." });
    expect(w.failed.map(({ alert }) => alert)).toEqual([{
      detail: "Usage limit reached on Grok and no other engine could take this run. Grok gave no reset time; runs on it work again once it resets. Or choose another engine for this bot now.",
    }]);
  });
});

describe("a run no other engine can take", () => {
  it("waits for a reset under twelve hours and says which engine and when", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude"] });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-4", webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: "delivery-4", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    const text = "Usage limit reached on Claude and no other engine can take this run: it starts again at the reset, Nov 2, 3:17 PM (UTC).";
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retryAt: NOW + 2 * HOUR + 60_000, attention: text });
    expect(w.deferred.map(({ alert }) => alert)).toEqual([{ detail: text }]);
    expect(w.failed).toEqual([]);
  });

  it("fails a weekly limit with its real reset and what to do, never 'stays down'", async () => {
    const w = world({ own: GROK, fast: CODEX_FAST, allowed: ["codex"] });
    const wake = w.wake();
    await w.tick();
    // The bot's own engine is not one this person may use here: nothing takes the wake over.
    w.fail(w.started[0]!.threadId, "You've hit your usage limit. Upgrade to Pro or try again at 2026-11-05T13:16:00Z.", { limitResetsAt: NOW + 3 * 24 * HOUR });
    expect(w.run(wake.id).status).toBe("failed");
    const detail = w.failed[0]!.alert!.detail;
    expect(detail).toBe("Usage limit reached on Codex (gpt-6.1-luna) and no other engine could take this run. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets, around Nov 5, 1:16 PM (UTC).");
    // That quick model is not the bot's engine: no advice to change the bot's engine.
    expect(detail).not.toMatch(/this bot's engine|stays down|choose another engine/i);
  });
});

describe("a person's message its engine's limit refused (chat)", () => {
  it("goes on at once on a backup the person has, with one switch line", async () => {
    const w = world({ own: CLAUDE, chat: true });
    w.threads.set("chat", { ...CLAUDE });
    w.host.noteDispatch("chat", { botId: "nova", engine: { instanceId: "claude", driverKind: "claudeAgent" }, selection: CLAUDE, payer: "person", at: NOW });
    expect(w.host.turnFailed({ threadId: "chat", turnId: "turn-1", cause: LIMIT_2H })).toBe(true);
    await w.host.idle();
    expect(w.resent).toEqual([{ threadId: "chat", messageId: "msg-1", on: { instanceId: "codex", model: "gpt-6.1-sol" } }]);
    expect(w.lines).toEqual([{ threadId: "chat", line: { kind: "switched", from: "Claude", to: "Codex", resetsAt: NOW + 2 * HOUR } }]);
    expect(w.store.blockedUntil("person", "claude")).toBe(NOW + 2 * HOUR);
  });

  it("is neither moved nor held by a wake whose fast model on another engine a limit refused", async () => {
    const w = world({ own: GROK, fast: CODEX_FAST, chat: true });
    w.threads.set("chat", { ...GROK });
    w.wake();
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    // The person's next message starts on the conversation's own engine, which is not at any limit.
    expect(w.host.beforeTurn("nova", "chat", undefined)).toBeNull();
    expect(w.threads.get("chat")).toEqual(GROK);
    expect(w.store.blockedUntil("person", "grok")).toBeNull();
    expect(w.resent).toEqual([]);
  });
});

// A run that works in the person's own conversation (a wait's follow-up joins it): a takeover moves that conversation,
// so it always goes back to the person's model after the reset, even when the refusal held nothing engine-wide.
describe("a run in the person's own conversation that another engine took over", () => {
  it("puts the conversation back on its own model after a model-only refusal's reset", async () => {
    const w = world({ own: CLAUDE, joinChat: true });
    const routine = w.manager.create({ name: "Follow-up", prompt: "Check the reply", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    expect(w.started[0]).toMatchObject({ threadId: "chat", selection: CLAUDE });
    // One model's own weekly window (Claude's limitScope "model"): nothing is held engine-wide.
    w.fail("chat", "This Claude account has reached its weekly Sonnet limit, which resets Nov 2, 4:16 PM (UTC). Until then, choose another model for this bot.",
      { stopReason: "quota", limitResetsAt: NOW + 3 * HOUR, limitScope: "model" });
    expect(w.store.blockedUntil("person", "claude")).toBeNull();
    expect(w.run(run.id)).toMatchObject({ status: "queued", limitTakeover: { instanceId: "codex", model: "gpt-6.1-sol" }, limitTakeoverUntil: NOW + 3 * HOUR });
    await w.tick();
    expect(w.started[1]).toMatchObject({ threadId: "chat", selection: { instanceId: "codex", model: "gpt-6.1-sol" } });
    // The return is scheduled although no engine is held.
    expect(w.store.failover("nova", "chat")).toMatchObject({ from: CLAUDE, to: { instanceId: "codex", model: "gpt-6.1-sol" }, resetsAt: NOW + 3 * HOUR });
    w.complete("chat");
    expect(w.run(run.id).status).toBe("completed");
    // The person's next message before the reset still runs on the backup; after it, on their own model again.
    expect(w.host.beforeTurn("nova", "chat", undefined)).toBeNull();
    expect(w.threads.get("chat")).toEqual({ instanceId: "codex", model: "gpt-6.1-sol" });
    w.clock.now = NOW + 3 * HOUR + 61_000;
    expect(w.host.beforeTurn("nova", "chat", undefined)).toBeNull();
    expect(w.threads.get("chat")).toEqual(CLAUDE);
    expect(w.store.failover("nova", "chat")).toBeUndefined();
    expect(w.lines.at(-1)).toEqual({ threadId: "chat", line: { kind: "back", engine: "Claude" } });
  });

  it("never leaves the conversation on the backup when the hold lapsed before the run could start", async () => {
    const w = world({ own: CLAUDE, joinChat: true });
    const routine = w.manager.create({ name: "Follow-up", prompt: "Check the reply", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    // A rate limit the driver gave up on: Sagax holds Claude for its own 15 minute estimate.
    w.fail("chat", "429 Too Many Requests");
    expect(w.run(run.id)).toMatchObject({ status: "queued", limitTakeoverUntil: NOW + 15 * 60_000 });
    // The person's conversation works meanwhile: the run waits past that estimate.
    w.busyThreads.add("chat");
    await w.advance(20 * 60_000);
    expect(w.started).toHaveLength(1);
    w.busyThreads.delete("chat");
    await w.tick();
    // The limit is over by now: the run runs on the person's own model, and the conversation stays there,
    // never moved to the backup and straight back (two switches, its engine session replayed for nothing).
    expect(w.started[1]).toMatchObject({ threadId: "chat", selection: CLAUDE });
    expect(w.threads.get("chat")).toEqual(CLAUDE);
    expect(w.switches).toEqual([]);
    expect(w.lines.filter(({ line }) => line.kind === "back")).toEqual([]);
    expect(w.store.failover("nova", "chat")).toBeUndefined();
  });
});

describe("a limit Sagax already knew of from the person's plan usage (J4)", () => {
  it("never sends a proactive wake to the fast model of an engine whose plan is spent", async () => {
    const w = world({ own: GROK, fast: CODEX_FAST, plans: { codex: NOW + 3 * 24 * HOUR } });
    const wake = w.wake();
    await w.tick();
    // The fast pick skipped Codex: the wake runs on the bot's own model and is never refused.
    expect(w.started).toEqual([expect.objectContaining({ runId: wake.id, selection: GROK })]);
    w.complete(w.started[0]!.threadId);
    expect(w.run(wake.id)).toMatchObject({ status: "completed" });
    expect(w.run(wake.id).limitTakeovers).toBeUndefined();
    expect(w.failed).toEqual([]);
  });

  it("gives the plan's real reset when the engine's refusal named none", async () => {
    const weekly = NOW + 3 * 24 * HOUR;
    const w = world({ own: CLAUDE, allowed: ["claude"], plans: { claude: weekly } });
    const routine = w.manager.create({ name: "Inbox sweep", prompt: "Sweep the inbox", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    w.fail(w.started[0]!.threadId, "You've hit your usage limit.");
    expect(w.run(run.id).status).toBe("failed");
    expect(w.store.holdOf("person", "claude")).toEqual({ until: weekly, estimated: false });
    expect(w.failed.map(({ alert }) => alert)).toEqual([{
      detail: "Usage limit reached on Claude and no other engine could take this run. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then. Or choose another engine for this bot now.",
    }]);
  });
});
