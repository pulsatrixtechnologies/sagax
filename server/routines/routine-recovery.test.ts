import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import { CLAUDE_NEEDS_RECONNECTING, CLAUDE_SIGN_IN_EXPIRED, claudeSignInExpired } from "../drivers/claude-errors.ts";
import { CODEX_SIGN_IN_EXPIRED, codexSignInExpired } from "../drivers/codex-errors.ts";
import { engineNeedsReconnecting, engineReconnectAheadDetail } from "../engines/engine-reconnect-ahead.ts";
import {
  classifyRoutineFailure, dispatchRefusal, firstOwnerNotice, loadOwnerNotices, recoverRun, retryNote, ROUTINE_BUSY_RECHECK_MS, ROUTINE_BUSY_WAIT_MS, usedRetry, weekRuns, type RoutineAlert,
} from "./routine-recovery.ts";
import type { RoutineUsageLimit } from "./routine-limit-words.ts";
import { nextScheduledRun, RoutineManager, type Routine, type RoutineManagerOptions, type RoutineRun } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const START = new Date(2026, 7, 17, 8, 0, 0).getTime();
it("retains the artifact readiness notice across restart and reports it once (#1990)", () => {
  const saved = [{ botId: "fixture-bot", cause: "engine_artifacts", at: START }];
  const loaded = loadOwnerNotices(saved);
  expect(loaded).toEqual(saved);
  expect(firstOwnerNotice(loaded, "fixture-bot", "engine_artifacts", START + 1_000)).toBe(false);
  expect(firstOwnerNotice(loaded, "another-bot", "engine_artifacts", START + 1_000)).toBe(true);
});
const SECOND = 1_000;
const MINUTE = 60_000;
const ROUTING = "stream error: workspace routing discovery failed: error sending request";
const STALL = "No activity for 20 minutes, the routine was stopped";
const SIGNED_OUT = "Not logged in · Please run /login";
const BUSY = "this thread is already working, interrupt it first";
type EventBody = RuntimeEvent extends infer E ? E extends RuntimeEvent ? Omit<E, "eventId" | "provider" | "threadId" | "createdAt"> : never : never;

function harness(extra: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-routine-recovery-"));
  dirs.push(dir);
  let now = START;
  let tasks = 0;
  let refusal: Error | null = null;
  const attempts: string[] = [];
  const started: Array<{ threadId: string; prompt: string }> = [];
  const failed: Array<{ run: RoutineRun; alert: RoutineAlert | null | undefined }> = [];
  const deferred: Array<{ run: RoutineRun; alert?: RoutineAlert }> = [];
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++tasks}` }),
    startTurn: async (_botId, threadId, prompt) => {
      attempts.push(threadId);
      if (refusal) throw refusal;
      started.push({ threadId, prompt });
    },
    onRunFailed: (run, alert) => failed.push({ run, alert }),
    onRunDeferred: (run, alert) => deferred.push({ run, alert }),
    ...extra,
  };
  let manager = new RoutineManager(options);
  const event = (threadId: string, body: EventBody) =>
    manager.handleRuntimeEvent({ eventId: `event-${Math.random()}`, provider: "fake", threadId, createdAt: new Date(0).toISOString(), ...body } as RuntimeEvent);
  return {
    options, attempts, started, failed, deferred,
    get manager() { return manager; },
    restart: () => { manager = new RoutineManager(options); return manager; },
    tasks: () => tasks,
    refuse: (error: Error | null) => { refusal = error; },
    advance: async (ms: number) => { now += ms; await manager.tick(); },
    runs: () => manager.listRuns(),
    run: (id: string) => manager.listRuns().find((run) => run.id === id)!,
    routine: (botId = "maus-1", name = "Inbox sweep") =>
      manager.create({ name, prompt: "Sweep the inbox", botId, schedule: { type: "daily", time: "09:00", weekdays: [3] } }),
    start: async (routineId: string) => {
      const run = manager.runNow(routineId)!;
      await manager.tick();
      return manager.listRuns().find((candidate) => candidate.id === run.id)!;
    },
    event,
    fail: (threadId: string, message: string, extra: { stopReason?: string } & Partial<Extract<RuntimeEvent, { type: "runtime.error" }>> = {}) => {
      const { stopReason, ...flags } = extra;
      event(threadId, { type: "runtime.error", message, ...flags });
      event(threadId, { type: "turn.completed", ok: false, stopReason: stopReason ?? null });
    },
    complete: (threadId: string, text = "Inbox swept.") => {
      event(threadId, { type: "item.completed", itemType: "assistant_text", text });
      event(threadId, { type: "turn.completed", ok: true });
    },
  };
}

describe("classifyRoutineFailure", () => {
  it.each<[string, Parameters<typeof classifyRoutineFailure>[1], ReturnType<typeof classifyRoutineFailure>]>([
    [STALL, { cause: "stalled" }, { kind: "retry", cause: "stalled" }],
    ["OpenCode sent nothing for 10 minutes with no tool running, so the turn was stopped as stuck.", { stalled: true, stopReason: "rpc_error" }, { kind: "retry", cause: "stalled" }],
    [BUSY, { cause: "busy" }, { kind: "busy" }],
    ["xAI hit a rate limit (HTTP 429). Wait a minute, then run it again.", {}, { kind: "retry", cause: "rate_limited" }],
    ["Claude is overloaded right now (HTTP 529). This is usually temporary, so try again in a few minutes.", {}, { kind: "retry", cause: "provider" }],
    [ROUTING, {}, { kind: "retry", cause: "provider" }],
    [SIGNED_OUT, { setup: true, stopReason: "auth_required" }, { kind: "owner", cause: "signed_out" }],
    ["workspace routing discovery unauthorized (401)", {}, { kind: "owner", cause: "signed_out" }],
    ["Your xAI account is out of credits (xAI says: \"Your team has run out of credits\"). Add credits with xAI, then run it again.", {}, { kind: "owner", cause: "credits" }],
    ["Internal error: API error (status 402 Payment Required): pay up", { setup: true, stopReason: "auth_required" }, { kind: "owner", cause: "credits" }],
    ["This Claude account has reached its 5-hour limit.", { stopReason: "quota", limitResetsAt: START + 3_600_000 }, { kind: "owner", cause: "usage_limit", resetsAt: START + 3_600_000 }],
    ["You've hit your weekly limit · resets Oct 12 at 2:30pm (Asia/Calcutta)", {}, { kind: "owner", cause: "usage_limit" }],
    ["Claude Code is too old for this model. Update it.", { setup: true, stopReason: "update_required" }, { kind: "owner", cause: "setup" }],
    ["The engine stopped without saying why (stop reason: cancelled).", { stopReason: "cancelled" }, { kind: "final" }],
    ["the turn was interrupted", {}, { kind: "final" }],
    ["The model returned only its reasoning and no final answer.", { stopReason: "reasoning_only" }, { kind: "retry", cause: "empty_response" }],
    ["empty response from model (reasoning_only)", {}, { kind: "retry", cause: "empty_response" }],
    ["The engine ended the turn with no reply, image, or tool result.", { stopReason: "empty_turn" }, { kind: "retry", cause: "empty_response" }],
  ])("%s", (failure, facts, verdict) => {
    expect(classifyRoutineFailure(failure, facts)).toEqual(verdict);
  });

  it("holds a usage limit until the reset its words name when the engine gives no reset field", () => {
    const resetsAt = Math.ceil((Date.now() + 3_600_000) / 1_000) * 1_000;
    const failure = `rpc -32603: Internal error: You've hit your usage limit (429). Your plan resets at ${new Date(resetsAt).toISOString()} (session/prompt)`;
    expect(classifyRoutineFailure(failure, {})).toEqual({ kind: "owner", cause: "usage_limit", resetsAt });
    // The engine's own field still wins over its words.
    expect(classifyRoutineFailure(failure, { limitResetsAt: resetsAt + 60_000 })).toEqual({ kind: "owner", cause: "usage_limit", resetsAt: resetsAt + 60_000 });
  });

  it("reads a busy refusal from its code, never its words", () => {
    expect(dispatchRefusal(Object.assign(new Error(BUSY), { status: 409, code: "thread_busy" }))).toEqual({ cause: "busy" });
    expect(dispatchRefusal(Object.assign(new Error("this provider account is being updated"), { status: 409, code: "settling" }))).toEqual({ cause: "busy" });
    expect(dispatchRefusal(Object.assign(new Error(BUSY), { status: 409 }))).toEqual({});
    expect(dispatchRefusal("thread_busy")).toEqual({});
  });
});

describe("an unattended run that fails for a passing reason", () => {
  it("starts again once in its own thread, tells the engine to check what it already did, and completes", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    h.event("thread-1", { type: "item.started", itemType: "tool", itemId: "t1", title: "shell" });
    h.event("thread-1", { type: "item.completed", itemType: "assistant_text", text: "Half done" });
    h.fail("thread-1", ROUTING);
    expect(h.run(run.id)).toMatchObject({ status: "queued", retried: "provider", threadId: "thread-1", retryAt: START + 15 * SECOND,
      attention: `Starting again shortly after a temporary error: ${ROUTING}` });
    expect(h.failed).toEqual([]);

    await h.advance(14 * SECOND);
    expect(h.started).toHaveLength(1);
    await h.advance(2 * SECOND);
    expect(h.started.map((turn) => turn.threadId)).toEqual(["thread-1", "thread-1"]);
    // The note comes right after the work; since #4030 every unattended run
    // also reads the run contract, which stays after it, unchanged.
    expect(h.started[0]!.prompt.startsWith("Sweep the inbox\n\n")).toBe(true);
    expect(h.started[1]!.prompt).toBe(h.started[0]!.prompt.replace("Sweep the inbox\n\n", `Sweep the inbox\n\n${retryNote("provider")}\n\n`));
    h.complete("thread-1");
    expect(h.run(run.id)).toMatchObject({ status: "completed", retried: "provider", output: "Inbox swept.", attention: undefined, error: undefined });
    expect(h.tasks()).toBe(1);
  });

  it("fails the second time, and says it was retried", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    h.fail("thread-1", ROUTING);
    await h.advance(16 * SECOND);
    h.fail("thread-1", ROUTING);
    expect(h.run(run.id)).toMatchObject({ status: "failed", retried: "provider", error: `Failed after one automatic retry: ${ROUTING}` });
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0]!.alert).toBeUndefined();
    await h.advance(MINUTE);
    expect(h.started).toHaveLength(2);
  });

  it("waits a minute after a rate limit", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    h.fail("thread-1", "Claude hit a rate limit (HTTP 429). Wait a minute, then run it again.");
    expect(h.run(run.id)).toMatchObject({ status: "queued", retried: "rate_limited", retryAt: START + MINUTE });
    await h.advance(59 * SECOND);
    expect(h.started).toHaveLength(1);
    await h.advance(2 * SECOND);
    expect(h.started).toHaveLength(2);
  });

  it("retries once after reasoning_only / empty model, then fails on a second empty", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    const empty = "The model returned only its reasoning and no final answer.";
    h.fail("thread-1", empty, { stopReason: "reasoning_only" });
    expect(h.run(run.id)).toMatchObject({ status: "queued", retried: "empty_response" });
    expect(h.failed).toEqual([]);
    await h.advance(16 * SECOND);
    expect(h.started[1]!.prompt).toContain(retryNote("empty_response"));
    h.fail("thread-1", empty, { stopReason: "reasoning_only" });
    expect(h.run(run.id)).toMatchObject({ status: "failed", retried: "empty_response", error: `Failed after one automatic retry: ${empty}` });
  });

  it("starts again once after its engine stalled, ignores the stalled turn's own end, and fails on a second stall", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    h.manager.failThread("thread-1", STALL, { cause: "stalled" });
    expect(h.run(run.id)).toMatchObject({ status: "queued", retried: "stalled", attention: `Starting again shortly after the engine stalled: ${STALL}` });
    h.event("thread-1", { type: "turn.completed", ok: false, stopReason: "interrupted" });
    expect(h.run(run.id).status).toBe("queued");
    await h.advance(16 * SECOND);
    expect(h.started.map((turn) => turn.threadId)).toEqual(["thread-1", "thread-1"]);
    expect(h.started[1]!.prompt).toContain(retryNote("stalled"));

    h.manager.failThread("thread-1", STALL, { cause: "stalled" });
    expect(h.run(run.id)).toMatchObject({ status: "failed", retried: "stalled", error: `Failed after one automatic retry: ${STALL}` });
    expect(h.failed.map(({ run: failed }) => failed.id)).toEqual([run.id]);
  });

  it("never starts a room goal again by itself", async () => {
    const h = harness({ goalState: () => "ready", createGoalTask: () => ({ threadId: "goal-1" }), startGoal: async () => {} });
    const routine = h.manager.create({ name: "Team goal", prompt: "Ship it", botId: "maus-1", target: "room-goal", groupId: "group-1",
      schedule: { type: "daily", time: "09:00", weekdays: [1] } });
    const run = await h.start(routine.id);
    h.manager.failThread("goal-1", "Claude is overloaded right now (HTTP 529).");
    expect(h.run(run.id)).toMatchObject({ status: "failed", error: "Claude is overloaded right now (HTTP 529)." });
    expect(h.run(run.id).retried).toBeUndefined();
    const signedOut = await h.start(routine.id);
    h.manager.failThread("goal-1", "workspace routing discovery unauthorized (401)", { cause: "busy" });
    expect(h.run(signedOut.id)).toMatchObject({ status: "failed", error: "workspace routing discovery unauthorized (401)" });
    expect(h.failed.map(({ alert }) => alert)).toEqual([undefined, undefined]);
  });
});

describe("an unattended run whose bot is busy when it starts", () => {
  const busy = () => Object.assign(new Error(BUSY), { status: 409, code: "thread_busy" });

  it("waits in its own thread instead of failing, then runs once the bot is free", async () => {
    const h = harness();
    h.refuse(busy());
    const run = await h.start(h.routine().id);
    expect(h.run(run.id)).toMatchObject({ status: "queued", threadId: "thread-1", deferredAt: START, retryAt: START + ROUTINE_BUSY_RECHECK_MS,
      attention: `Waiting to start: ${BUSY}` });
    expect(h.run(run.id).retried).toBeUndefined();
    expect(h.failed).toEqual([]);
    await h.advance(ROUTINE_BUSY_RECHECK_MS - SECOND);
    expect(h.attempts).toHaveLength(1);

    // A wait is not a retry, and a restart leaves it waiting.
    h.restart();
    expect(h.run(run.id)).toMatchObject({ status: "queued", deferredAt: START });
    expect(h.run(run.id).retried).toBeUndefined();

    h.refuse(null);
    await h.advance(2 * SECOND);
    expect(h.started.map((turn) => turn.threadId)).toEqual(["thread-1"]);
    expect(h.started[0]!.prompt).not.toContain("Sagax: this run's first start");
    h.complete("thread-1");
    expect(h.run(run.id)).toMatchObject({ status: "completed", attention: undefined });
    expect(h.run(run.id).retried).toBeUndefined();
    expect(h.tasks()).toBe(1);
  });

  it("stops waiting after an hour, and a refusal without a busy code fails at once", async () => {
    const h = harness();
    h.refuse(busy());
    const run = await h.start(h.routine().id);
    for (let waited = 0; waited < ROUTINE_BUSY_WAIT_MS; waited += ROUTINE_BUSY_RECHECK_MS) await h.advance(ROUTINE_BUSY_RECHECK_MS);
    expect(h.run(run.id)).toMatchObject({ status: "failed", error: `Did not start: still busy after 60 minutes (${BUSY})` });
    expect(h.failed).toHaveLength(1);

    const other = harness();
    other.refuse(Object.assign(new Error('provider instance "gone" is unavailable, pick another model in settings'), { status: 409 }));
    const refused = await other.start(other.routine().id);
    expect(other.run(refused.id)).toMatchObject({ status: "failed", error: 'provider instance "gone" is unavailable, pick another model in settings' });
  });
});

describe("an unattended run only its owner can fix", () => {
  it("pauses a generic sign-in error as waiting and tells the owner once per bot until reconnect", async () => {
    const h = harness();
    const first = await h.start(h.routine("maus-1", "Inbox sweep").id);
    h.fail("thread-1", SIGNED_OUT, { setup: true, stopReason: "auth_required" });
    expect(h.run(first.id)).toMatchObject({
      status: "waiting",
      attention: engineNeedsReconnecting("Engine"),
      waitingSince: START,
    });
    expect(h.run(first.id).error).toBeUndefined();
    expect(h.failed).toEqual([]);
    expect(h.deferred.map(({ alert }) => alert)).toEqual([{ detail: engineReconnectAheadDetail("Engine") }]);
    await h.advance(5 * MINUTE);
    expect(h.attempts).toHaveLength(1);

    const second = await h.start(h.routine("maus-1", "Calendar check").id);
    h.fail(second.threadId!, SIGNED_OUT, { setup: true, stopReason: "auth_required" });
    expect(h.run(second.id).status).toBe("waiting");
    // Same bot already notified: no second deferred alert.
    expect(h.deferred).toHaveLength(1);
    const elsewhere = await h.start(h.routine("maus-2", "Other bot").id);
    h.fail(elsewhere.threadId!, SIGNED_OUT, { setup: true, stopReason: "auth_required" });
    expect(h.deferred.map(({ alert }) => alert)).toEqual([
      { detail: engineReconnectAheadDetail("Engine") },
      { detail: engineReconnectAheadDetail("Engine") },
    ]);
    expect(JSON.parse(readFileSync(h.options.file!, "utf8")).ownerNotices).toMatchObject([
      { botId: "maus-1", cause: "signed_out" }, { botId: "maus-2", cause: "signed_out" },
    ]);
  });

  it("blocks an out-of-credit refusal at once with what to do (#1946)", async () => {
    const h = harness();
    const credits = "Your xAI account is out of credits (xAI says: \"Your team has run out of credits\"). Add credits with xAI, then run it again.";
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", credits, { stopReason: "rpc_error" });
    expect(h.run(run.id)).toMatchObject({ status: "blocked", error: credits });
    expect(h.failed[0]!.alert).toEqual({ detail: `Inbox sweep: "${credits}" This bot's engine account is out of credit. Add credit with the provider, or choose another engine for this bot.` });

  });

  it("pauses a Claude sign-in expiry as waiting (Claude needs reconnecting), never fails it", async () => {
    const h = harness();
    const message = claudeSignInExpired("Not logged in · Please run /login");
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", message, { setup: true, stopReason: "auth_required" });
    expect(h.run(run.id)).toMatchObject({
      status: "waiting",
      attention: CLAUDE_NEEDS_RECONNECTING,
      waitingSince: START,
    });
    expect(h.run(run.id).error).toBeUndefined();
    expect(h.failed).toEqual([]);
    expect(h.deferred).toEqual([expect.objectContaining({
      alert: { detail: expect.stringContaining("Reconnect Claude") },
    })]);
    expect(message.startsWith(CLAUDE_SIGN_IN_EXPIRED)).toBe(true);
  });

  it("pauses a Codex sign-in expiry as waiting, never fails it", async () => {
    const h = harness();
    const message = codexSignInExpired("workspace routing discovery unauthorized");
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", message, { setup: true, stopReason: "auth_required" });
    expect(h.run(run.id)).toMatchObject({
      status: "waiting",
      attention: engineNeedsReconnecting("Codex"),
    });
    expect(h.run(run.id).error).toBeUndefined();
    expect(h.failed).toEqual([]);
    expect(h.deferred[0]!.alert?.detail).toContain(CODEX_SIGN_IN_EXPIRED);
  });

  it("pauses Claude extra-usage credits exhaustion as waiting (Claude needs reconnecting)", async () => {
    const h = harness();
    const credits = "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up. " +
      "Your plan's own usage is not affected: switch this bot to a model your plan includes, or add extra usage in your Claude account.";
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", credits, { stopReason: "quota", limitScope: "model" } as { stopReason: string });
    expect(h.run(run.id)).toMatchObject({
      status: "waiting",
      attention: CLAUDE_NEEDS_RECONNECTING,
    });
    expect(h.run(run.id).error).toBeUndefined();
    expect(h.failed).toEqual([]);
  });

  it("resumes Claude reconnect waits once after sign-in, without duplicating the run", async () => {
    const h = harness();
    const message = claudeSignInExpired("OAuth session expired");
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", message, { setup: true, stopReason: "auth_required" });
    expect(h.run(run.id).status).toBe("waiting");
    const resumed = h.manager.resumeClaudeReconnectWaits(["maus-1"]);
    expect(resumed).toHaveLength(1);
    expect(h.run(run.id)).toMatchObject({
      status: "queued",
      attention: "Starting again after Claude reconnected",
      id: run.id,
    });
    expect(h.manager.resumeClaudeReconnectWaits(["maus-1"])).toEqual([]);
    await h.manager.tick();
    expect(h.started.map((turn) => turn.threadId)).toEqual(["thread-1", "thread-1"]);
  });

  it("resumes Codex waits when Codex reconnects, without touching Claude waits", async () => {
    const h = harness();
    const claudeRun = await h.start(h.routine("maus-1", "Claude job").id);
    h.fail(claudeRun.threadId!, claudeSignInExpired("OAuth session expired"), { setup: true, stopReason: "auth_required" });
    const codexRun = await h.start(h.routine("maus-2", "Codex job").id);
    h.fail(codexRun.threadId!, codexSignInExpired("ChatGPT login is required"), { setup: true, stopReason: "auth_required" });
    expect(h.run(claudeRun.id).attention).toBe(CLAUDE_NEEDS_RECONNECTING);
    expect(h.run(codexRun.id).attention).toBe(engineNeedsReconnecting("Codex"));
    expect(h.manager.resumeEngineReconnectWaits(["maus-1", "maus-2"], "Codex").map((run) => run.id)).toEqual([codexRun.id]);
    expect(h.run(claudeRun.id).status).toBe("waiting");
    expect(h.run(codexRun.id).status).toBe("queued");
  });

  it("pauses a due Claude run ahead when the sign-in is already expired", async () => {
    const notified: Array<{ person: string; detail: string; names: string[]; engine?: string }> = [];
    const h = harness({
      engineReconnect: {
        botDriver: () => "claudeAgent",
        payer: () => "pr_alice",
        expired: () => true,
        onAheadNotify: (person, detail, names, engine) => notified.push({ person, detail, names, engine }),
      },
    });
    const routine = h.manager.create({
      name: "Morning brief",
      prompt: "Brief me",
      botId: "maus-1",
      schedule: { type: "daily", time: "08:30", weekdays: [1] },
    });
    // START is Mon 2026-08-17 08:00; next daily Mon 08:30 is today in 30 min.
    await h.manager.tick();
    expect(notified).toEqual([expect.objectContaining({
      person: "pr_alice",
      names: ["Morning brief"],
      engine: "Claude",
    })]);
    // Advance past due so the run is queued, then paused for reconnect.
    await h.advance(31 * MINUTE);
    const run = h.runs().find((candidate) => candidate.routineId === routine.id);
    expect(run).toMatchObject({ status: "waiting", attention: CLAUDE_NEEDS_RECONNECTING });
    expect(h.started).toEqual([]);
    expect(h.failed).toEqual([]);
  });

  it("tells a streak of failed proactive wakes once, at its telling run, even when each fails with the same words (#3990)", async () => {
    const h = harness();
    const REFUSED = "The engine refused the request.";
    const told: boolean[] = [];
    for (let wake = 1; wake <= 4; wake += 1) {
      const run = h.manager.enqueueProactive({ botId: "maus-1", name: "Proactive: webhook", prompt: "A post came", proactive: { mode: "proactive", hops: 0, sources: ["webhook"] } });
      await h.manager.tick();
      h.fail(h.run(run.id).threadId!, REFUSED);
      expect(h.run(run.id)).toMatchObject({ status: "failed", error: REFUSED });
      const { run: failed, alert } = h.failed.at(-1)!;
      told.push(h.manager.problemAlert(failed, alert) !== null);
      await h.advance(MINUTE);
    }
    // a wake runs on events, so several times a day: the third in a row is
    // the one its summary card is drawn for, and the one that rings
    expect(h.manager.problemToldAt(h.failed[0]!.run)).toBe(3);
    expect(told).toEqual([false, false, true, false]);
  });

  it("keeps a Flow refusal of a scheduled run silent, even at its streak's telling run (#3990)", async () => {
    const h = harness();
    const daily = h.manager.create({ name: "Brief", prompt: "Write the brief", botId: "maus-1", schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    const hourly = h.manager.create({ name: "Price check", prompt: "Check the price", botId: "maus-2", schedule: { type: "interval", everyMinutes: 60, anchorAt: START } });
    const told: Array<[string, boolean]> = [];
    for (let hour = 1; hour <= 3; hour += 1) {
      await h.advance(60 * MINUTE);
      for (const routine of [daily, hourly]) {
        const run = h.runs().find((candidate) => candidate.routineId === routine.id && candidate.status === "running");
        if (!run) continue;
        h.complete(run.threadId!, "run init refused: previous_unclosed");
        expect(h.run(run.id)).toMatchObject({ status: "blocked", triggerSource: "schedule" });
        const { run: blocked, alert } = h.failed.at(-1)!;
        told.push([routine.name, h.manager.problemAlert(blocked, alert) !== null]);
      }
    }
    // the daily brief tells at its first run, the hourly check at its third:
    // a Flow refusal is told by the streak's summary card, never rung
    expect(h.manager.problemToldAt(h.failed.find(({ run }) => run.routineId === daily.id)!.run)).toBe(1);
    expect(h.manager.problemToldAt(h.failed.find(({ run }) => run.routineId === hourly.id)!.run)).toBe(3);
    expect(told).toEqual([["Brief", false], ["Price check", false], ["Price check", false], ["Price check", false]]);
  });

  it("pauses a proactive wake when the engine is already expired, without starting a turn", async () => {
    const h = harness({
      engineReconnect: {
        botDriver: () => "codex",
        payer: () => "pr_alice",
        expired: () => true,
      },
    });
    const run = h.manager.enqueueProactive({
      botId: "maus-1",
      name: "Proactive: email",
      prompt: "Handle mail",
      proactive: { mode: "proactive", hops: 0, sources: ["mail"] },
    });
    await h.manager.tick();
    expect(h.run(run.id)).toMatchObject({
      status: "waiting",
      attention: engineNeedsReconnecting("Codex"),
    });
    expect(h.started).toEqual([]);
    expect(h.failed).toEqual([]);
  });

  it("waits out a usage limit that resets within twelve hours, once, and says so once", async () => {
    const h = harness();
    const resetsAt = START + 2 * 3_600_000;
    const limit = "This Claude account has reached its 5-hour limit, which resets soon. Until then, switch this bot to another engine or Claude account.";
    const run = await h.start(h.routine().id);
    h.fail("thread-1", limit, { stopReason: "quota", limitResetsAt: resetsAt });
    // No engine known to the run (no limit failover wired here): it names none rather than guess "this bot's engine".
    expect(h.run(run.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: resetsAt + MINUTE, threadId: "thread-1",
      attention: expect.stringMatching(/^This run's engine reached its usage limit\. This run starts again at the reset, .+\.$/) });
    expect(h.failed).toEqual([]);
    expect(h.deferred).toEqual([expect.objectContaining({ alert: { detail: expect.stringMatching(/^This run's engine reached its usage limit\. This run starts again at the reset, .+\.$/) } })]);
    expect(h.manager.wakeHold()).toEqual({ hold: false });
    expect(h.manager.wakeHold(3 * 3_600_000)).toEqual({ hold: true, reason: "due", at: resetsAt + MINUTE });

    await h.advance(2 * 3_600_000);
    expect(h.started).toHaveLength(1);
    await h.advance(MINUTE + SECOND);
    expect(h.started.map((turn) => turn.threadId)).toEqual(["thread-1", "thread-1"]);
    expect(h.started[1]!.prompt).toContain(retryNote("usage_limit"));
    h.fail("thread-1", limit, { stopReason: "quota", limitResetsAt: START + 5 * 3_600_000 });
    expect(h.run(run.id)).toMatchObject({ status: "blocked", error: limit });
    expect(h.failed[0]!.alert).toBeNull();
    expect(h.deferred).toHaveLength(1);
  });

  it("lets a recurring routine's next scheduled run do the work a usage limit stopped, when it comes within one interval of the reset", async () => {
    const h = harness();
    const limit = "This Claude account has reached its 5-hour limit, which resets soon. Until then, switch this bot to another engine or Claude account.";
    const hourly = h.manager.create({ name: "Price check", prompt: "Check the price", botId: "maus-1", schedule: { type: "interval", everyMinutes: 60, anchorAt: START } });
    const daily = h.manager.create({ name: "Brief", prompt: "Write the brief", botId: "maus-2", schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    await h.advance(60 * MINUTE);
    const scheduled = [hourly, daily].map((routine) => h.runs().find((run) => run.routineId === routine.id)!);
    for (const run of scheduled) {
      expect(run).toMatchObject({ status: "running", triggerSource: "schedule" });
      h.fail(run.threadId!, limit, { stopReason: "quota", limitResetsAt: START + 3 * 3_600_000 });
      expect(h.run(run.id)).toMatchObject({ status: "blocked", error: limit });
    }
    const action = "This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now.";
    expect(h.failed.map(({ run, alert }) => [run.id, alert])).toEqual(scheduled.map((run) => [run.id, { detail: `${run.routineName}: "${limit}" ${action}` }]));
    expect(h.deferred).toEqual([]);
  });

  it("still starts a run again at the reset when its routine's next run is further off, or it was started by hand, or runs once", async () => {
    const h = harness();
    const limit = "This Claude account has reached its 5-hour limit.";
    const resetsAt = START + 3 * 3_600_000;
    const mondays = h.manager.create({ name: "Weekly plan", prompt: "Plan the week", botId: "maus-1", schedule: { type: "daily", time: "09:00", weekdays: [1] } });
    const once = h.manager.create({ name: "Reminder", prompt: "Remind me", botId: "maus-2", schedule: { type: "once", at: START + 30 * MINUTE } });
    await h.advance(30 * MINUTE);
    const oneTime = h.runs().find((run) => run.routineId === once.id)!;
    h.fail(oneTime.threadId!, limit, { stopReason: "quota", limitResetsAt: resetsAt });
    expect(h.run(oneTime.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: resetsAt + MINUTE });
    await h.advance(30 * MINUTE);
    const weekly = h.runs().find((run) => run.routineId === mondays.id)!;
    expect(weekly).toMatchObject({ status: "running", triggerSource: "schedule" });
    h.fail(weekly.threadId!, limit, { stopReason: "quota", limitResetsAt: resetsAt });
    expect(h.run(weekly.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: resetsAt + MINUTE });
    const hourly = h.manager.create({ name: "Price check", prompt: "Check the price", botId: "maus-3", schedule: { type: "interval", everyMinutes: 60, anchorAt: START } });
    const manual = await h.start(hourly.id);
    h.fail(manual.threadId!, limit, { stopReason: "quota", limitResetsAt: resetsAt });
    expect(h.run(manual.id)).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: resetsAt + MINUTE });
    expect(h.failed).toEqual([]);
  });

  it("measures a cron routine's interval to the occurrence after its next one, and gives none for a run not its schedule started", () => {
    const routine = (schedule: Routine["schedule"], nextRunAt: number) => ({ id: "routine-1", enabled: true, schedule, nextRunAt }) as Routine;
    const weekdays = { type: "cron" as const, expression: "0 9 * * 1-5", timeZone: "UTC" };
    const thursday = Date.UTC(2026, 7, 20, 9), friday = Date.UTC(2026, 7, 21, 9);
    const scheduled = { routineId: "routine-1", triggerSource: "schedule" } as RoutineRun;
    expect(nextScheduledRun(scheduled, [routine(weekdays, thursday)])).toEqual({ at: thursday, interval: 24 * 60 * MINUTE });
    expect(nextScheduledRun(scheduled, [routine(weekdays, friday)])).toEqual({ at: friday, interval: 3 * 24 * 60 * MINUTE });
    expect(nextScheduledRun({ ...scheduled, triggerSource: "manual" }, [routine(weekdays, thursday)])).toBeUndefined();
    expect(nextScheduledRun({ routineId: "routine-1", triggerSource: "proactive" } as RoutineRun, [routine(weekdays, thursday)])).toBeUndefined();
    expect(nextScheduledRun({ ...scheduled, triggerSource: "webhook" }, [routine(weekdays, thursday)])).toBeUndefined();
    expect(nextScheduledRun(scheduled, [routine({ type: "once", at: thursday }, thursday)])).toBeUndefined();
    expect(nextScheduledRun(scheduled, [routine({ type: "limit_reset", engine: "claude", repeat: "once", at: thursday }, thursday)])).toBeUndefined();
  });

  it("skips the limit-failover reset wait when the next scheduled run covers that reset, and still waits when it does not", () => {
    const run = { id: "run-1", routineId: "routine-1", routineName: "Price check", botId: "bot-1", target: "bot", status: "running", createdAt: START } as RoutineRun;
    const limit: RoutineUsageLimit = { kind: "quota", from: "Claude", resetsAt: START + 2 * 3_600_000, estimated: false, noTaker: "none" };
    const covered = recoverRun(run, "You've hit your usage limit.", {
      limit, nextScheduled: { at: START + 3 * 3_600_000, interval: 24 * 3_600_000 },
    }, START, [], { timeZone: "UTC" });
    expect(covered).toMatchObject({ queued: false });
    expect(run.status).toBe("running");
    const later = { id: "run-2", routineId: "routine-1", routineName: "Price check", botId: "bot-1", target: "bot", status: "running", createdAt: START } as RoutineRun;
    expect(recoverRun(later, "You've hit your usage limit.", {
      limit, nextScheduled: { at: START + 48 * 3_600_000, interval: 24 * 3_600_000 },
    }, START, [], { timeZone: "UTC" })).toMatchObject({ queued: true });
    expect(later).toMatchObject({ status: "queued", retried: "usage_limit", retryAt: START + 2 * 3_600_000 + MINUTE });
  });

  it("blocks a usage limit with no reset time, or one too far off, and tells the owner (#1946)", async () => {
    const h = harness();
    const run = await h.start(h.routine("maus-1").id);
    h.fail("thread-1", "You've hit your weekly limit · resets Oct 12 at 2:30pm (Asia/Calcutta)", { stopReason: "quota" });
    expect(h.run(run.id).status).toBe("blocked");
    const far = await h.start(h.routine("maus-2").id);
    h.fail(far.threadId!, "This Claude account has reached its weekly limit.", { stopReason: "quota", limitResetsAt: START + 13 * 3_600_000 });
    expect(h.run(far.id).status).toBe("blocked");
    const action = "This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now.";
    expect(h.failed.map(({ alert }) => alert)).toEqual(h.failed.map(({ run }) => ({ detail: `${run.routineName}: "${run.error}" ${action}` })));
    expect(h.deferred).toEqual([]);
  });
});

describe("a run that a restart cut off", () => {
  it("resumes once in its own thread, and that resume is its one automatic second start", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    expect(h.run(run.id).status).toBe("running");
    h.restart();
    expect(h.run(run.id)).toMatchObject({ status: "running", retried: "restarted", threadId: "thread-1", restartResumes: 1 });
    h.manager.failThread("thread-1", ROUTING);
    expect(h.run(run.id)).toMatchObject({ status: "failed", error: `Failed after one automatic retry: ${ROUTING}` });
  });
});

// 2026-11-02 (review): a limit's takeover starts the run again on another engine at once. Its start carries the
// usage-limit note (retried), but it is not the run's one automatic retry: a stall on that engine, or a wait for a
// reset after it, still has it, and a failure never claims a retry the run did not have.
describe("a run a limit's takeover sent on", () => {
  const HOUR = 60 * MINUTE;
  const LIMIT = "You've hit your usage limit. Try again in 2 hours.";
  const fresh = () => ({ id: "run-1", routineId: "routine-1", routineName: "Inbox sweep", botId: "bot-1", target: "bot", status: "running", createdAt: START } as RoutineRun);
  const takenBy = (to: string): RoutineUsageLimit => ({
    kind: "quota", from: "Claude", resetsAt: START + 2 * HOUR, estimated: false, to, selection: { instanceId: to.toLowerCase(), model: "m" }, returnsAt: START + 2 * HOUR,
  });

  it("keeps the run's one retry for a stall on the engine that took it over", () => {
    const run = fresh();
    expect(recoverRun(run, LIMIT, { limit: takenBy("Codex") }, START, [], { timeZone: "UTC" })).toEqual({ queued: true });
    expect(run).toMatchObject({ status: "queued", retried: "usage_limit", takeoverRetried: true, limitTakeovers: 1, limitTakeoverUntil: START + 2 * HOUR });
    expect(usedRetry(run)).toBe(false);
    run.status = "running";
    expect(recoverRun(run, STALL, { stalled: true }, START + MINUTE, [])).toEqual({ queued: true });
    expect(run).toMatchObject({ status: "queued", retried: "stalled" });
    expect(run.takeoverRetried).toBeUndefined();
    expect(usedRetry(run)).toBe(true);
    run.status = "running";
    expect(recoverRun(run, STALL, { stalled: true }, START + 2 * MINUTE, [])).toEqual({ queued: false, error: `Failed after one automatic retry: ${STALL}` });
  });

  it("never says a takeover's run failed after a retry, and a second takeover keeps the retry unused", () => {
    const run = fresh();
    recoverRun(run, LIMIT, { limit: takenBy("Codex") }, START, []);
    recoverRun(run, LIMIT, { limit: { ...takenBy("Grok"), from: "Codex" } }, START + MINUTE, []);
    expect(run).toMatchObject({ limitTakeovers: 2, retried: "usage_limit", takeoverRetried: true, limitTakeover: { instanceId: "grok" } });
    run.status = "running";
    expect(recoverRun(run, "The model refused this request.", {}, START + 2 * MINUTE, [])).toEqual({ queued: false, error: "The model refused this request." });
  });

  it("marks the return time as Sagax's estimate when the engine that refused named none", () => {
    const run = fresh();
    recoverRun(run, LIMIT, { limit: { ...takenBy("Codex"), estimated: true, returnsEstimated: true } }, START, []);
    expect(run).toMatchObject({ limitTakeoverUntil: START + 2 * HOUR, limitTakeoverEstimated: true });
    recoverRun(run, LIMIT, { limit: { ...takenBy("Grok"), from: "Codex" } }, START + MINUTE, []);
    expect(run.limitTakeoverEstimated).toBeUndefined();
  });

  it("is still the run's one automatic second start when a restart cut it", async () => {
    const h = harness();
    const run = await h.start(h.routine().id);
    // As a takeover leaves it (recoverRun's takeOver), saved; then Sagax restarts while it runs.
    const inside = h.manager as unknown as { runs: RoutineRun[]; save(): void };
    Object.assign(inside.runs.find((candidate) => candidate.id === run.id)!, { retried: "usage_limit", takeoverRetried: true });
    inside.save();
    h.restart();
    expect(h.run(run.id)).toMatchObject({ status: "running", retried: "usage_limit", restartResumes: 1 });
    expect(h.run(run.id).takeoverRetried).toBeUndefined();
    h.manager.failThread("thread-1", ROUTING);
    expect(h.run(run.id)).toMatchObject({ status: "failed", error: `Failed after one automatic retry: ${ROUTING}` });
  });
});

describe("weekRuns", () => {
  it("counts the runs that finished in the last seven days, and how many completed", () => {
    const run = (status: RoutineRun["status"], finishedAt: number, routineId = "r1") =>
      ({ id: `${status}-${finishedAt}`, routineId, status, finishedAt, createdAt: finishedAt }) as RoutineRun;
    const day = 24 * 3_600_000;
    const runs = [run("completed", START), run("failed", START - day), run("missed", START - 2 * day), run("completed", START - 8 * day),
      run("cancelled", START), run("queued", START), run("completed", START, "r2")];
    expect(weekRuns(runs, "r1", START)).toEqual({ ok: 1, total: 3 });
    expect(weekRuns(runs, "r3", START)).toBeUndefined();
  });

  it("rides on each routine the list shows", async () => {
    const h = harness();
    const routine = h.routine();
    const run = await h.start(routine.id);
    h.complete(run.threadId!);
    expect(h.manager.listRoutines()[0]).toMatchObject({ id: routine.id, weekRuns: { ok: 1, total: 1 } });
    expect(JSON.parse(readFileSync(h.options.file!, "utf8")).routines[0]).not.toHaveProperty("weekRuns");
  });
});

// #3287: the retry and busy lines of a run are in the language of the person it is for, like its limit lines.
describe("a run's retry and busy lines for a French-speaking person", () => {
  const WORDS = { language: "fr-CA", timeZone: "America/Toronto" };
  const STALLED_FR = "Aucune activité depuis 20 minutes";
  const BUSY_FR = "occupé";
  const fresh = () => ({ id: "run-1", routineId: "routine-1", routineName: "Inbox sweep", botId: "bot-1", target: "bot", status: "running", createdAt: START } as RoutineRun);

  it("says the stall retry and its failure in French", () => {
    const run = fresh();
    expect(recoverRun(run, STALLED_FR, { stalled: true }, START, [], WORDS)).toEqual({ queued: true });
    expect(run.attention).toBe(`Nouveau départ sous peu après le blocage du moteur : ${STALLED_FR}`);
    run.status = "running";
    expect(recoverRun(run, STALLED_FR, { stalled: true }, START + MINUTE, [], WORDS))
      .toEqual({ queued: false, error: `Échec après une nouvelle tentative automatique : ${STALLED_FR}` });
  });

  it("says the busy wait and its end in French", () => {
    const run = fresh();
    expect(recoverRun(run, BUSY_FR, { cause: "busy" }, START, [], WORDS)).toEqual({ queued: true });
    expect(run.attention).toBe(`En attente de démarrage : ${BUSY_FR}`);
    run.status = "running";
    expect(recoverRun(run, BUSY_FR, { cause: "busy" }, START + ROUTINE_BUSY_WAIT_MS, [], WORDS))
      .toEqual({ queued: false, error: `Pas démarrée : toujours occupé après 60 minutes (${BUSY_FR})` });
  });

  it("keeps English for a person without French", () => {
    const run = fresh();
    recoverRun(run, STALL, { stalled: true }, START, [], { language: "en-CA" });
    expect(run.attention).toBe(`Starting again shortly after the engine stalled: ${STALL}`);
  });
});
