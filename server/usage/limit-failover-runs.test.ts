// A usage limit on a routine run, a webhook run and a proactive wake
// (2026-11-02): the real limit failover host (server/limit-failover-host.ts)
// wired to a real RoutineManager the way server/index.ts wires them. The
// report that started it: a bot's proactive wake was refused by an engine's
// limit; the run failed as "This bot's engine reached its usage limit", the
// bot's Primary Bot relayed that her engine was down, and the wake never ran
// while another engine was answering. Here a refused run goes on at once on
// an engine that works, and every line says which engine refused and when it
// is back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LimitFailoverLine } from "../../shared/limit-failover.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import { LimitFailoverStore, type LimitCandidate } from "./limit-failover.ts";
import { createLimitFailoverHost } from "./limit-failover-host.ts";
import { retryNote, type RoutineAlert } from "../routines/routine-recovery.ts";
import { RoutineManager, type RoutineRun } from "../routines/routines.ts";

const NOW = Date.UTC(2026, 10, 2, 13, 16);
const HOUR = 3_600_000;
const GROK: ModelSelection = { instanceId: "grok", model: "grok-4.5" };
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

/** One bot on `own`. `chat`: the thread "chat" is the person's conversation, its last message their own. */
function world(options: {
  own?: ModelSelection; allowed?: string[]; language?: string; chat?: boolean;
  /** Every run joins the person's conversation "chat" (a wait's follow-up does, wait-host.ts) instead of a hidden task. */
  joinChat?: boolean;
  /** false: SAGAX_LIMIT_FAILOVER=0, automatic switching off on this server. */
  failover?: boolean;
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
  /** Auto's refusal memory (server/index.ts rememberAutoRefusal): the model a thread's Auto turn ran on, until its reset. */
  const autoRefused: Array<{ payer: string; selection: ModelSelection; until: number }> = [];
  /** The model each thread's last turn ran on (server/index.ts autoTurnsByThread). */
  const lastRan = new Map<string, ModelSelection>();
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
    enabled: () => options.failover !== false,
    engineName: (id) => NAMES[id] ?? id,
    engine: (id) => DRIVERS[id] ? { instanceId: id, driverKind: DRIVERS[id]! } : undefined,
    candidates: async () => candidatesNow(),
    candidatesNow,
    preferred: () => [],
    config: () => undefined,
    payer: () => "person",
    threadSelection: (_bot, threadId) => threads.get(threadId) ?? null,
    busy: () => false,
    switchThread: (_bot, threadId, to) => { threads.set(threadId, { ...to }); switches.push({ threadId, to: { ...to } }); return null; },
    note: (threadId, line) => { lines.push({ threadId, line }); },
    replaceFailure: (threadId, _turnId, line) => { lines.push({ threadId, line }); },
    request: (threadId) => options.chat && threadId === "chat" ? { messageId: "msg-1", turnId: "turn-1", origin: { kind: "user" } } : undefined,
    resend: async (_bot, threadId, messageId) => {
      resent.push({ threadId, messageId, on: { ...threads.get(threadId)! } });
      return true;
    },
    autoRefuse: (threadId, payer, until) => {
      const ran = lastRan.get(threadId);
      if (ran) autoRefused.push({ payer, selection: { ...ran }, until });
    },
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
    // took it over first, then the usual limit check.
    joinConversation: () => options.joinChat ? "chat" : null,
    threadBusy: (_bot, threadId) => busyThreads.has(threadId),
    startTurn: async (botId, threadId, prompt, _runOn, _trigger, _onError, run) => {
      if (run?.limitTakeover) host.takeOver(botId, threadId, run.limitTakeover, undefined, run.limitTakeoverUntil);
      await host.beforeTurn(botId, threadId, undefined);
      const thread = threads.get(threadId)!;
      let selection: ModelSelection = thread;
      if (thread.auto) {
        // autoPickForTurn: the first model of an engine Sagax does not hold for this payer, skipping a model a limit
        // refused (its refusal memory); with every engine held, Auto keeps its list.
        const engines = candidatesNow();
        const held = host.autoExcluded("person", engines);
        const open = engines.filter((engine) => !held.has(engine.instanceId));
        const choice = (open.length ? open : engines).flatMap((engine) => engine.models.map((model) => ({ instanceId: engine.instanceId, model })))
          .find((candidate) => !autoRefused.some((refused) => refused.until > clock.now &&
            refused.selection.instanceId === candidate.instanceId && refused.selection.model === candidate.model));
        selection = choice ?? { instanceId: thread.instanceId, model: thread.model };
      }
      lastRan.set(threadId, { ...selection });
      host.noteDispatch(threadId, {
        botId, engine: { instanceId: selection.instanceId, driverKind: DRIVERS[selection.instanceId]! }, selection,
        payer: "person", at: clock.now,
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
  /** The error of each thread's turn running now (server/index.ts turnStops). */
  const turnErrors = new Map<string, string>();
  const event = (threadId: string, body: EventBody) => {
    const full = { eventId: `event-${Math.random()}`, provider: "fake", threadId, createdAt: new Date(clock.now).toISOString(), ...body } as RuntimeEvent;
    if (full.type === "runtime.error") {
      host.noteError(threadId, full.message, full.limitResetsAt, full.limitScope);
      turnErrors.set(threadId, full.message);
    }
    const run = manager.handleRuntimeEvent(full);
    // server/index.ts hands the same failure to turnFailed after the routine manager saw it, with the engine the turn
    // ran on (turn-completed.ts: the event's provider instance, else the bot's model).
    if (full.type === "turn.completed" && !full.ok) {
      const engine = lastRan.get(threadId)?.instanceId ?? threads.get(threadId)?.instanceId;
      // turnFailureCause: the turn's own error (turnStops), else its stop reason.
      const cause = turnErrors.get(threadId) ?? (full.stopReason?.trim() || undefined);
      turnErrors.delete(threadId);
      return { run, taken: host.turnFailed({ threadId, cause, stopReason: full.stopReason, routineRun: run?.status === "failed" ? run : null, engine }) };
    }
    return { run, taken: false };
  };
  return {
    clock, threads, busyThreads, lines, autoRefused, started, failed, deferred, resent, switches, store, host, manager,
    /** The person's message in "chat" starts its turn; the model it runs on. */
    say: async (): Promise<ModelSelection> => {
      await host.beforeTurn("nova", "chat", undefined);
      const selection = { ...threads.get("chat")! };
      host.noteDispatch("chat", { botId: "nova", engine: { instanceId: selection.instanceId, driverKind: DRIVERS[selection.instanceId]! }, selection, payer: "person", at: clock.now });
      return selection;
    },
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

// #3530: the run's own words say the limit and who takes it over; the turn.completed that follows (no dispatch left)
// adds no line saying no engine could answer, and never reads as a turn nothing sends again.
describe("a routine run whose limit the run already settled", () => {
  it("leaves no exhausted line when its turn completes, and turnFailed returns as before", async () => {
    const w = world({ own: GROK });
    const routine = w.manager.enqueueProactive({
      botId: "nova", name: "Daily report", prompt: "Write the daily report.", proactive: { mode: "proactive", hops: 0, sources: ["run"] },
    });
    await w.tick();
    const threadId = w.started[0]!.threadId;
    const { taken } = w.fail(threadId, LIMIT_2H);
    expect(taken).toBe(false);
    await w.host.idle();
    expect(w.lines.filter((entry) => entry.line.kind === "exhausted")).toEqual([]);
    expect(w.run(routine.id)).toMatchObject({ retried: "usage_limit", limitTakeovers: 1 });
    expect(w.failed).toEqual([]);
    // The run goes on, on its backup, and ends as a run does.
    await w.tick();
    w.complete(w.started.at(-1)!.threadId);
    expect(w.run(routine.id).status).toBe("completed");
    expect(w.lines.filter((entry) => entry.line.kind === "exhausted")).toEqual([]);
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

  it("goes on at most twice, then waits for the bot's own engine and names it", async () => {
    const w = world({ own: CLAUDE });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-3", webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: "delivery-3", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    await w.tick();
    expect(w.started[1]!.selection.instanceId).toBe("codex");
    w.fail(w.started[1]!.threadId, LIMIT_2H);
    // Codex stood in for Claude: the run goes back to Claude, never to Codex, at Claude's reset.
    expect(w.run(queued.id)).toMatchObject({
      status: "queued", limitTakeovers: 2, limitTakeover: { instanceId: "grok", model: "grok-4.5" },
      attention: "Usage limit reached on Codex: this run continues on Grok. Back on Claude once it resets, around Nov 2, 3:16 PM (UTC).",
    });
    // Its thread's notice names both engines, and the return to Claude at Claude's reset, never to Codex.
    await w.host.idle();
    expect(w.lines.at(-1)).toEqual({ threadId: w.started[0]!.threadId, line: { kind: "switched", from: "Codex", to: "Grok", resetsAt: NOW + 2 * HOUR, home: "Claude" } });
    await w.tick();
    expect(w.started[2]!.selection.instanceId).toBe("grok");
    expect(w.store.failover("nova", w.started[0]!.threadId)).toMatchObject({ from: CLAUDE, to: { instanceId: "grok" }, resetsAt: NOW + 2 * HOUR });
    w.fail(w.started[2]!.threadId, "You've hit your usage limit.");
    // Two takeovers already: nothing takes it a third time. Grok named no reset; Claude's is known and near.
    const text = "Usage limit reached on Grok, which was standing in for Claude. Sagax already moved this run twice, the most it does for one run. This run starts again on Claude at its reset, Nov 2, 3:17 PM (UTC).";
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: NOW + 2 * HOUR + 60_000, attention: text });
    expect(w.failed).toEqual([]);
    expect(w.deferred.map(({ alert }) => alert)).toEqual([{ detail: text }]);
    await w.advance(2 * HOUR + 60_000);
    expect(w.started[3]).toMatchObject({ runId: queued.id, threadId: w.started[0]!.threadId, selection: CLAUDE });
    w.complete(w.started[3]!.threadId);
    expect(w.run(queued.id).status).toBe("completed");
  });
});

// 2026-11-02 (review): a run another engine took over, whose new engine's limit refused it too. Before, the takeover
// had used the run's one automatic retry, so the run failed at once, naming only the last engine and telling the
// person to change the bot's engine while the bot's own engine came back sooner.
describe("a run a second engine's limit refused after it took the run over", () => {
  const LIMIT_3H = "You've hit your usage limit. Try again in 3 hours.";
  const hook = (w: ReturnType<typeof world>, id: string) => w.manager.enqueueWebhook({
    webhookId: id, webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: `delivery-${id}`, receivedAt: NOW,
  });

  it("waits for the bot's own engine when it resets first, names it, and runs there", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude", "codex"] });
    const queued = hook(w, "chain-1");
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    await w.tick();
    expect(w.started[1]!.selection.instanceId).toBe("codex");
    w.fail(w.started[1]!.threadId, LIMIT_3H);
    const text = "Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. This run starts again on Claude at its reset, Nov 2, 3:17 PM (UTC).";
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: NOW + 2 * HOUR + 60_000, attention: text });
    // Its next start goes back to Claude, never to the backup that refused.
    expect(w.run(queued.id).limitTakeover).toBeUndefined();
    expect(w.failed).toEqual([]);
    expect(w.deferred.map(({ alert }) => alert)).toEqual([{ detail: text }]);
    expect(text).not.toMatch(/choose another engine/i);
    await w.advance(2 * HOUR + 60_000);
    expect(w.started[2]).toMatchObject({ runId: queued.id, threadId: w.started[0]!.threadId, selection: CLAUDE });
    expect(w.lines.at(-1)).toEqual({ threadId: w.started[0]!.threadId, line: { kind: "back", engine: "Claude" } });
    w.complete(w.started[2]!.threadId);
    expect(w.run(queued.id).status).toBe("completed");
  });

  it("waits for the backup instead when its reset comes first, and stays on it", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude", "codex"] });
    const queued = hook(w, "chain-2");
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_3H);
    await w.tick();
    w.fail(w.started[1]!.threadId, LIMIT_2H);
    expect(w.run(queued.id)).toMatchObject({
      status: "queued", retryAt: NOW + 2 * HOUR + 60_000, limitTakeover: { instanceId: "codex", model: "gpt-6.1-sol" },
      attention: "Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. This run starts again on Codex at its reset, Nov 2, 3:17 PM (UTC).",
    });
    await w.advance(2 * HOUR + 60_000);
    expect(w.started[2]).toMatchObject({ runId: queued.id, selection: { instanceId: "codex", model: "gpt-6.1-sol" } });
  });

  it("goes back to the bot's own engine at once when its limit reset meanwhile", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude", "codex"] });
    const queued = hook(w, "chain-3");
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    await w.tick();
    // The run works on Codex past Claude's reset, then Codex refuses.
    w.clock.now = NOW + 2 * HOUR + 2 * 60_000;
    w.fail(w.started[1]!.threadId, LIMIT_3H);
    expect(w.run(queued.id)).toMatchObject({
      status: "queued", limitTakeovers: 2, limitTakeover: CLAUDE,
      attention: "Usage limit reached on Codex: this run goes back to Claude, whose limit has reset.",
    });
    await w.host.idle();
    expect(w.lines.at(-1)).toEqual({ threadId: w.started[0]!.threadId, line: { kind: "back", engine: "Claude", refused: "Codex" } });
    await w.tick();
    expect(w.started[2]).toMatchObject({ runId: queued.id, threadId: w.started[0]!.threadId, selection: CLAUDE });
    // Its conversation is back on its own model: no takeover is left to undo.
    expect(w.store.failover("nova", w.started[0]!.threadId)).toBeUndefined();
    expect(w.threads.get(w.started[0]!.threadId)).toEqual(CLAUDE);
  });

  it("fails a weekly limit with the bot's own engine and its real reset, never advice to change the engine", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude", "codex"] });
    const queued = hook(w, "chain-4");
    await w.tick();
    w.fail(w.started[0]!.threadId, "You've hit your usage limit.", { limitResetsAt: NOW + 3 * 24 * HOUR });
    await w.tick();
    w.fail(w.started[1]!.threadId, "You've hit your usage limit.", { limitResetsAt: NOW + 4 * 24 * HOUR });
    const text = "Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then.";
    // The run's own error says so too: its list row and any tool reading runs never get the raw engine words.
    expect(w.run(queued.id)).toMatchObject({ status: "blocked", error: text });
    expect(w.failed.map(({ alert }) => alert)).toEqual([{ detail: `${w.run(queued.id).routineName}: ${text}` }]);
  });

  it("keeps the run's one retry for a stall on the engine that took it over", async () => {
    const w = world({ own: CLAUDE });
    const queued = hook(w, "chain-5");
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    await w.tick();
    expect(w.started[1]!.selection.instanceId).toBe("codex");
    w.fail(w.started[1]!.threadId, "The engine stopped responding.", { stalled: true });
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retried: "stalled" });
    expect(w.failed).toEqual([]);
    await w.advance(20_000);
    expect(w.started[2]).toMatchObject({ runId: queued.id, selection: { instanceId: "codex", model: "gpt-6.1-sol" } });
    // The takeover still tells the next start why its first one stopped.
    expect(w.started[1]!.prompt).toContain(retryNote("usage_limit"));
    w.complete(w.started[2]!.threadId);
    expect(w.run(queued.id).status).toBe("completed");
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
    const text = "Usage limit reached on Claude. No other engine can take over. This run starts again at the reset, Nov 2, 3:17 PM (UTC).";
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retryAt: NOW + 2 * HOUR + 60_000, attention: text });
    expect(w.deferred.map(({ alert }) => alert)).toEqual([{ detail: text }]);
    expect(w.failed).toEqual([]);
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

  // 2026-11-02 (final review): the backup standing in for the conversation's own engine is refused in turn, and nothing
  // else can take the message: the wait names that backup as the engine that refused, and the engine it waits for.
  it("names the refused backup and the engine its message waits for, and goes back there at that engine's reset", async () => {
    const w = world({ own: CLAUDE, chat: true, allowed: ["claude", "codex"] });
    w.threads.set("chat", { ...CLAUDE });
    await w.say();
    w.fail("chat", LIMIT_2H);
    await w.host.idle();
    expect(await w.say()).toEqual({ instanceId: "codex", model: "gpt-6.1-sol" });
    expect(w.fail("chat", "You've hit your usage limit. Try again in 3 hours.").taken).toBe(true);
    await w.host.idle();
    // #3530: the line says the message waits for Claude's reset, as it does.
    expect(w.lines.at(-1)).toEqual({ threadId: "chat", line: { kind: "waiting", from: "Codex", home: "Claude", resetsAt: NOW + 2 * HOUR } });
    w.clock.now = NOW + 2 * HOUR + 61_000;
    expect(await w.say()).toEqual(CLAUDE);
    expect(w.lines.at(-1)).toEqual({ threadId: "chat", line: { kind: "back", engine: "Claude" } });
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

  // 2026-11-02 (review of the final pass): Claude holds nothing engine-wide for that model's own window, so when the
  // backup is refused in turn, Claude is no backup for its own model before that window resets, and no line says it has.
  it("keeps the conversation off its own model until that model's window resets when the backup is refused", async () => {
    const codex: ModelSelection = { instanceId: "codex", model: "gpt-6.1-sol" };
    const w = world({ own: CLAUDE, joinChat: true, chat: true });
    const routine = w.manager.create({ name: "Follow-up", prompt: "Check the reply", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    w.fail("chat", "This Claude account has reached its weekly Sonnet limit, which resets Nov 2, 4:16 PM (UTC). Until then, choose another model for this bot.",
      { stopReason: "quota", limitResetsAt: NOW + 3 * HOUR, limitScope: "model" });
    await w.tick();
    expect(w.threads.get("chat")).toEqual(codex);
    w.complete("chat");
    expect(w.run(run.id).status).toBe("completed");
    // The person's next message runs on Codex, and Codex's limit refuses it: Grok takes it, never Claude's own model.
    expect(await w.say()).toEqual(codex);
    expect(w.fail("chat", LIMIT_2H).taken).toBe(true);
    await w.host.idle();
    expect(w.resent).toEqual([{ threadId: "chat", messageId: "msg-1", on: GROK }]);
    expect(w.lines.at(-1)).toEqual({ threadId: "chat", line: { kind: "switched", from: "Codex", to: "Grok", home: "Claude", resetsAt: NOW + 3 * HOUR } });
    // Back on Claude at that window's reset.
    w.clock.now = NOW + 3 * HOUR + 61_000;
    expect(await w.say()).toEqual(CLAUDE);
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

describe("a refusal that names no reset", () => {
  // 2026-11-02 (final review): a refusal that names no reset is held for Sagax's one-hour estimate and tried again
  // after it, and the words say the engine gave no reset time.
  it("holds it for Sagax's estimate and says the engine gave none", async () => {
    const w = world({ own: CLAUDE, allowed: ["claude"] });
    const routine = w.manager.create({ name: "Inbox sweep", prompt: "Sweep the inbox", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    w.fail(w.started[0]!.threadId, "You've hit your usage limit.");
    expect(w.run(run.id).status).toBe("blocked");
    expect(w.store.holdOf("person", "claude")).toEqual({ until: NOW + HOUR, estimated: true });
    expect(w.failed.map(({ alert }) => alert)).toEqual([{
      detail: `${w.run(run.id).routineName}: Usage limit reached on Claude. No other engine can take over. Claude gave no reset time; runs on it work again once it resets.`,
    }]);
  });

  it("puts the person's own conversation back on their engine within the hour, never days later", async () => {
    const w = world({ own: GROK, chat: true, allowed: ["claude", "grok"] });
    w.threads.set("chat", { ...GROK });
    await w.say();
    expect(w.fail("chat", "Grok refused this turn (model grok-4.5): the Grok account it runs on reached its usage limit.").taken).toBe(true);
    await w.host.idle();
    expect(w.resent).toEqual([{ threadId: "chat", messageId: "msg-1", on: CLAUDE }]);
    expect(w.lines).toEqual([{ threadId: "chat", line: { kind: "switched", from: "Grok", to: "Claude", resetsAt: NOW + HOUR, estimated: true } }]);
    w.clock.now = NOW + HOUR + 61_000;
    // Their next message runs on Grok again, and nothing holds Grok for them any more.
    expect(await w.say()).toEqual(GROK);
    expect(w.lines.at(-1)).toEqual({ threadId: "chat", line: { kind: "back", engine: "Grok" } });
    expect(w.store.blockedUntil("person", "grok")).toBeNull();
    expect(w.host.autoExcluded("person", [{ instanceId: "grok", driverKind: "grokAgent" }]).size).toBe(0);
  });
});

// 2026-11-02 (review): the takeover paths the first pass left without a behaviour test.
describe("a run on Auto, or with automatic switching off", () => {
  const AUTO: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5", auto: true };

  it("lets Auto pick again on its next start, skipping the model a limit refused", async () => {
    const w = world({ own: AUTO });
    const routine = w.manager.create({ name: "Inbox sweep", prompt: "Sweep the inbox", botId: "nova", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
    const run = w.manager.runNow(routine.id)!;
    await w.tick();
    expect(w.started[0]!.selection).toEqual(CLAUDE);
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    expect(w.failed).toEqual([]);
    expect(w.run(run.id)).toMatchObject({
      status: "queued", limitTakeovers: 1,
      attention: "Usage limit reached on Claude: Auto continues it on another model. Back on Claude once it resets, around Nov 2, 3:16 PM (UTC).",
    });
    // Auto picks again: no model is forced on the next start.
    expect(w.run(run.id).limitTakeover).toBeUndefined();
    expect(w.autoRefused).toEqual([{ payer: "person", selection: CLAUDE, until: NOW + 2 * HOUR }]);
    await w.host.idle();
    expect(w.lines).toEqual([{ threadId: w.started[0]!.threadId, line: { kind: "switched", from: "Claude", to: "Auto", resetsAt: NOW + 2 * HOUR } }]);
    await w.tick();
    expect(w.started[1]).toMatchObject({ runId: run.id, selection: { instanceId: "codex", model: "gpt-6.1-sol" } });
    // The conversation stays on Auto: nothing to undo after the reset.
    expect(w.threads.get(w.started[0]!.threadId)).toEqual(AUTO);
    w.complete(w.started[1]!.threadId);
    expect(w.run(run.id).status).toBe("completed");
  });

  it("takes nothing over with switching off, and says so with the real reset", async () => {
    const w = world({ own: CLAUDE, failover: false });
    const queued = w.manager.enqueueWebhook({
      webhookId: "hook-off", webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: "delivery-off", receivedAt: NOW,
    });
    await w.tick();
    w.fail(w.started[0]!.threadId, LIMIT_2H);
    const text = "Usage limit reached on Claude. Automatic switching to another engine is off on this server. This run starts again at the reset, Nov 2, 3:17 PM (UTC).";
    expect(w.run(queued.id)).toMatchObject({ status: "queued", retryAt: NOW + 2 * HOUR + 60_000, attention: text });
    expect(w.run(queued.id).limitTakeovers).toBeUndefined();
    expect(w.store.failover("nova", w.started[0]!.threadId)).toBeUndefined();
    // The limit is still held for the payer: Sagax's own picks skip it.
    expect(w.store.blockedUntil("person", "claude")).toBe(NOW + 2 * HOUR);

    const weekly = w.manager.enqueueWebhook({
      webhookId: "hook-off-2", webhookName: "New email", prompt: "mail", botId: "nova", runOn: "maus", deliveryId: "delivery-off-2", receivedAt: NOW,
    });
    await w.tick();
    const started = w.started.find((start) => start.runId === weekly.id)!;
    w.fail(started.threadId, "You've hit your usage limit.", { limitResetsAt: NOW + 3 * 24 * HOUR });
    expect(w.run(weekly.id)).toMatchObject({
      status: "blocked",
      error: "Usage limit reached on Claude. Automatic switching to another engine is off on this server. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then. Or choose another engine for this bot now.",
    });
  });
});
