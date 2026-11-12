// #3479, #3695, #3990: routines stay quiet when nothing needs the person. A
// run started by a trigger follows the same report rule as a scheduled run,
// and every routine reports by its streak: no run in the chat, one summary
// (at the first run with a problem for a routine that runs at most once a
// day, at the third in a row for one that can run several times a day),
// turned to works again in place. A routine set to post its results posts
// each one when it runs at most once a day. A run's outcome comes from
// explicit signals only. Every run stays in the run list with its outcome.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSyncRoutineRunToSource } from "../index-leaves/syncRoutineRunToSource.ts";
import { openCardIn } from "../turns/person-attention-relay.ts";
import { routineRunRingsDone } from "../runtime-events/turn-completed.ts";
import { ROUTINE_EXECUTION_PROMPT, WEBHOOK_PROMPT, routineExecutionPromptFor } from "../system-prompt.ts";
import { proactiveWakePrompt, wakeAlwaysReports } from "../proactive/proactive-wake.ts";
import { ROUTINE_NOTHING_TO_DO_RULE, ROUTINE_REPORT_CONTRACT, routineReportOutcome, routineRunReportable } from "./routine-report.ts";
import { routineRunCard, routineRunFallbackText } from "./routine-run-card.ts";
import { ROUTINE_RESTARTED, RoutineManager, type RoutineManagerOptions, type RoutineRun } from "./routines.ts";
import { routineRunPostsResult, routineRunRowOutOfChat } from "../../shared/routine-repeat.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function manager(start: number, extra: Partial<RoutineManagerOptions> = {}) {
  let now = start;
  let task = 0;
  const prompts: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "sagax-quiet-routines-"));
  dirs.push(dir);
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    emit: () => {},
    botState: () => "ready",
    goalState: () => "ready",
    createTask: () => ({ threadId: `thread-${++task}` }),
    createGoalTask: () => ({ threadId: `goal-${++task}` }),
    startTurn: async (_botId, _threadId, prompt) => { prompts.push(prompt); },
    startGoal: async () => {},
    interruptTurn: async () => {},
    interruptGoal: async () => {},
    ...extra,
  };
  const routines = new RoutineManager(options);
  const send = (event: Record<string, unknown>) =>
    routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), ...event } as never);
  /** One Run now that ends with `said`, an hour after the previous one;
   * `startedBy` "person" when the person pressed Run now. */
  const run = async (routineId: string, said: string, startedBy?: "person"): Promise<RoutineRun> => {
    now += 3_600_000;
    const started = routines.runNow(routineId, undefined, startedBy)!;
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === started.id)!.threadId!;
    send({ threadId, type: "item.completed", itemType: "assistant_text", text: said });
    send({ threadId, type: "turn.completed", ok: true });
    return routines.listRuns().find((candidate) => candidate.id === started.id)!;
  };
  return { routines, prompts, run, advance: (ms: number) => { now += ms; return now; } };
}

type Row = { id: string; kind?: string; role?: string; text?: string; routineRun?: any };

/** The person's one conversation, with the real card, text and report rule. */
function conversation(options: { personAttention?: (text: string | undefined) => any; ownThread?: Row[]; routines?: RoutineManager; needsPerson?: boolean | ((run: RoutineRun) => boolean); postResults?: boolean } = {}) {
  const rows: Row[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const bot = { id: "maus-1", name: "Atlas" };
  const host = {
    routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
    personAttention: options.personAttention ?? (() => undefined),
    routineFullReport: (r: RoutineRun) => r.output,
    routineRunReportable,
    routineRunNeedsPerson: (r: RoutineRun) => typeof options.needsPerson === "function" ? options.needsPerson(r) : options.needsPerson === true,
    // the server's rule (server/index.ts routineEffectivePostResults)
    routineEffectivePostResults: (r: RoutineRun) => routineRunPostsResult(r, options.routines?.getRoutine(r.routineId), options.postResults === true),
    routines: options.routines,
    store: {
      taskByThread: () => null,
      messagesFor: (threadId: string) => threadId === "main" ? rows : options.ownThread ?? [],
      patchTask: (_botId: string, threadId: string, patch: { unread?: boolean }) => { if (patch.unread) unread.push(threadId); },
      patchGroup: () => {},
      bot: () => bot,
      patchMessage: (threadId: string, id: string, patch: Partial<Row>) => {
        const list = threadId === "main" ? rows : options.ownThread ?? [];
        const at = list.findIndex((row) => row.id === id);
        list[at] = { ...list[at]!, ...patch };
      },
      appendMessage: (_t: string, message: Omit<Row, "id">) => { const row = { ...message, id: `m${rows.length}` }; rows.push(row); return row; },
      removeMessage: (threadId: string, id: string) => {
        const list = threadId === "main" ? rows : options.ownThread ?? [];
        const at = list.findIndex((row) => row.id === id);
        if (at < 0) return false;
        list.splice(at, 1);
        return true;
      },
    },
    routineRunCard,
    routineRunFallbackText,
    attentionCard: (_bot: unknown, _threadId: string, _task: unknown, _key: string, found: unknown) => found,
    deliverableNotification: (kind: string) => kind,
    notify: (kind: string) => { rang.push(kind); },
  };
  const sync = createSyncRoutineRunToSource(() => host);
  return { rows, unread, rang, sync: (run: RoutineRun) => sync(run) };
}

/** Whether the finished turn of `run` rings "done" (server/runtime-events/turn-completed.ts),
 * for a routine set to post its results. */
const ringsDone = (run: RoutineRun, routines?: RoutineManager) => routineRunRingsDone(run, {
  routineEffectivePostResults: (r: RoutineRun) => routineRunPostsResult(r, routines?.getRoutine(r.routineId), true),
  personAttention: () => undefined,
  routines,
});

const PROBLEM = "RUN_STATUS: partial: the backup host has not answered since Monday";
/** A routine that runs once a day: each run is told as before (#3695). */
const DAILY = { type: "daily" as const, time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
const start = Date.parse("2026-11-10T08:00:00Z");

describe("a run started by a trigger follows the same report rule (#3479)", () => {
  it("a webhook or startup run gets the report contract, like a scheduled or manual one", () => {
    for (const source of ["schedule", "manual", "webhook", "startup"]) {
      expect(routineExecutionPromptFor(source, { id: "r1" } as never)).toBe(ROUTINE_EXECUTION_PROMPT);
      expect(routineExecutionPromptFor(source, { id: "r1" } as never)).toContain("NOTHING_TO_REPORT");
    }
    // A trigger turn with no routine run active on its thread is no routine run.
    expect(routineExecutionPromptFor("webhook")).toBe("");
    expect(routineExecutionPromptFor("startup", null)).toBe("");
    for (const source of ["schedule", "manual"]) {
      expect(routineExecutionPromptFor(source)).toBe(ROUTINE_EXECUTION_PROMPT);
    }
    // a proactive wake carries the contract in its own prompt, said once
    expect(routineExecutionPromptFor("proactive")).toBe("");
    expect(routineExecutionPromptFor("webhook", { proactive: { sources: ["mail"] } })).toBe("");
    expect(routineExecutionPromptFor(undefined)).toBe("");
    expect(WEBHOOK_PROMPT).not.toContain("NOTHING_TO_REPORT");
  });

  it("a trigger run that ends with NOTHING_TO_REPORT posts nothing and rings nothing", async () => {
    const { routines } = manager(start);
    const delivery = routines.enqueueWebhook({ webhookId: "hook", webhookName: "Incoming mail", prompt: "A mail arrived", botId: "maus-1", runOn: "maus", deliveryId: "d1", receivedAt: start });
    await routines.tick();
    const threadId = routines.listRuns().find((run) => run.id === delivery.id)!.threadId!;
    routines.handleRuntimeEvent({ eventId: "a", provider: "fake", createdAt: new Date().toISOString(), threadId, type: "item.completed", itemType: "assistant_text", text: "Newsletter, nothing for you.\nNOTHING_TO_REPORT" } as never);
    routines.handleRuntimeEvent({ eventId: "b", provider: "fake", createdAt: new Date().toISOString(), threadId, type: "turn.completed", ok: true } as never);
    const run = routines.listRuns().find((candidate) => candidate.id === delivery.id)!;
    expect(run.status).toBe("completed");
    expect(run.quiet).toBe(true);
    const chat = conversation();
    chat.sync(run);
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
    expect(chat.rang).toEqual([]);
    expect(ringsDone(run)).toBe(false);
    // it stays listed with its outcome
    expect(routines.listRuns().map((candidate) => candidate.id)).toContain(run.id);
  });
});

describe("a problem's words and its card (#3479)", () => {
  it("reads the bot's SAME_PROBLEM line and never shows it", () => {
    const outcome = routineReportOutcome(`${PROBLEM}\nStill down.\nSAME_PROBLEM`);
    expect(outcome.sameProblem).toBe(true);
    expect(outcome.declared?.status).toBe("partial");
    expect(outcome.report).toBe("Still down.");
    expect(routineReportOutcome(`${PROBLEM}\nStill down.`).sameProblem).toBeUndefined();
  });

  it("the fallback text gives the times in the person's zone, like the card", () => {
    const since = Date.parse("2026-11-10T14:00:00Z");
    const card = { runId: "r2", routineId: "x", routineName: "Backup check", status: "completed", summary: "Still down.",
      problems: "the backup host has not answered", repeat: { firstRunId: "r1", since, count: 2, lastAt: since + 3_600_000 } } as never;
    expect(routineRunFallbackText(card, "en", "America/Toronto")).toContain("Same problem since 2026-11-10 09:00, 2 runs in a row.");
    expect(routineRunFallbackText(card, "en")).toContain("since 2026-11-10 14:00 UTC");
    const recovered = { runId: "r3", routineId: "x", routineName: "Backup check", status: "nothing_to_report", recovered: { afterRuns: 2, since } } as never;
    expect(routineRunFallbackText(recovered, "fr", "America/Toronto")).toContain("depuis 2026-11-10 09:00.");
  });

  it("a run with a new item only the person can do posts its card and rings needs-you, its problems aside", async () => {
    const { routines, run } = manager(start);
    // a routine that can run several times a day: its first problem waits for its streak
    const routine = routines.create({ name: "Incoming mail", prompt: "Sort the mail", botId: "maus-1", enabled: false,
      schedule: { type: "interval", everyMinutes: 30, anchorAt: start } });
    const ASK = "[HUMAIN] Answer the new mail from the supplier.";
    const chat = conversation({
      routines,
      personAttention: (text) => text?.includes("[HUMAIN]") ? { kind: "items", items: [{ text: "Answer the new mail from the supplier." }] } : undefined,
    });
    const CRM = "RUN_STATUS: partial: the CRM is unreachable";

    // #3990: a first run with problems is not told (its streak is one run of three)
    const first = await run(routine.id, `${CRM}\nCould not reach the CRM.`);
    chat.sync(first);
    expect(chat.rows).toHaveLength(0);
    expect(chat.rang).toEqual([]);

    const second = await run(routine.id, `${CRM}\nStill no CRM.\n${ASK}\nSAME_PROBLEM`);
    expect(second.problemRepeat).toMatchObject({ firstRunId: first.id, count: 2 });
    chat.sync(second);
    // its own card, with the item, unread and ringing once
    expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.runId).toBe(second.id);
    expect((chat.rows[0] as any).attention?.items?.[0]?.text).toContain("Answer the new mail");
    expect(chat.unread).toEqual(["main"]);
    expect(chat.rang).toEqual(["needs-you"]);
  });

  it("the run's own thread never shows the same-problem line, whatever its shape", () => {
    const own: Row[] = [{ id: "b1", role: "bot", text: "Still down.\n**Same problem.**\nNOTHING_TO_REPORT" }];
    const chat = conversation({ ownThread: own });
    chat.sync({ id: "r1", routineId: "x", botId: "maus-1", status: "completed", threadId: "own", output: "Still down.", quiet: true } as RoutineRun);
    expect(own[0]!.text).toBe("Still down.");
  });
});

/** The fields of a run's card the released apps (0.8.90) decode. */
const RELEASED_CARD_FIELDS = ["readiness", "runId", "routineId", "routineName", "scheduledFor", "status", "deferredAt", "goalStatus", "executionThreadId", "summary", "error",
  "autoPausedAfter", "problems", "repeat", "recovered", "attention", "handedTo", "startedAt", "wakeTopic", "watches", "feedback"];

describe("a routine that repeats more than once a day reports by its streak (#3695)", () => {
  const EVERY_FIVE = { type: "interval" as const, everyMinutes: 5, anchorAt: start };
  const OK = "Checked the work queue.\nNOTHING_TO_REPORT";
  const REPORT = "Two finished worktrees removed.";
  const problem = (why: string) => `RUN_STATUS: partial: ${why}\nCould not finish the pass.`;
  const routineCards = (rows: Row[]) => rows.filter((row) => row.kind === "routine.run");

  it("ten runs of a five-minute routine: one card at the third problem run, its count in place, then works again, and nothing else", async () => {
    const { routines, prompts, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines });
    const runs: RoutineRun[] = [];
    const step = async (said: string) => { const done = await run(routine.id, said); runs.push(done); chat.sync(done); return done; };

    // ok, ok with a report: nothing in the chat, nothing rings
    await step(OK);
    const reported = await step(REPORT);
    expect(reported.quiet).toBeUndefined();
    expect(ringsDone(reported, routines)).toBe(false);
    expect(chat.rows).toEqual([]);
    // the bot reads the rule: the person does not read each run, asks with a tool
    expect(prompts.at(-1)).toContain("the person does not read each run");
    expect(prompts.at(-1)).toContain("never inside your report");

    // problems, problems reworded: nothing yet
    const p1 = await step(problem("the merge queue is stuck on one branch"));
    const p2 = await step(problem("two branches wait in the queue and nothing lands"));
    expect(p2.problemRepeat).toEqual({ firstRunId: p1.id, since: p1.finishedAt, count: 2, anyProblem: true });
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
    expect(ringsDone(p1, routines) || ringsDone(p2, routines)).toBe(false);

    // the third run is told it would make three in a row, with the earlier remarks
    const p3 = await step(`${problem("the queue still holds the same two branches")}\nThe merge queue has been stuck for fifteen minutes: two branches wait on a failed check. Rerun the check or drop the branches.`);
    const third = prompts.at(-1)!;
    expect(third).toContain("<earlier-problems>");
    expect(third).toContain("the merge queue is stuck on one branch");
    expect(third).toContain("two branches wait in the queue and nothing lands");
    expect(third).toContain("one short summary");
    expect(p3.problemRepeat).toMatchObject({ firstRunId: p1.id, count: 3 });
    expect(routineCards(chat.rows)).toHaveLength(1);
    const card = chat.rows[0]!;
    expect(card.routineRun.runId).toBe(p3.id);
    expect(card.routineRun.repeat).toMatchObject({ firstRunId: p1.id, count: 3, since: p1.finishedAt, streak: true });
    expect(card.routineRun.brief).toContain("Rerun the check or drop the branches");
    expect(card.text).toContain("3 runs with problems since");
    expect(chat.unread).toEqual(["main"]);
    expect(ringsDone(p3, routines)).toBe(true);
    // the released apps draw it with the fields they know (repeat.streak aside)
    expect(Object.keys(card.routineRun).filter((key) => !RELEASED_CARD_FIELDS.includes(key))).toEqual(["brief"]);

    // problems again: the same card counts, in place, quietly
    const p4 = await step(problem("still stuck"));
    expect(prompts.at(-1)).toContain("already has one summary");
    expect(ringsDone(p4, routines)).toBe(false);
    expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: p3.id, repeat: { count: 4, lastAt: p4.finishedAt, streak: true } });
    expect(chat.unread).toEqual(["main"]);

    // the first ok turns that card to works again, in place, once
    const fixed = await step(OK);
    expect(fixed.recovered).toEqual({ afterRuns: 4, since: p1.finishedAt });
    expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: p3.id, status: "completed", recovered: { afterRuns: 4, since: p1.finishedAt } });
    expect(chat.rows[0]!.routineRun.problems).toBeUndefined();
    expect(chat.rows[0]!.routineRun.repeat).toBeUndefined();
    expect(chat.rows[0]!.text).toContain("Works again");
    expect(Object.keys(chat.rows[0]!.routineRun).filter((key) => !RELEASED_CARD_FIELDS.includes(key))).toEqual(["brief"]);

    // ok, a single problem, ok: nothing more
    await step(OK);
    await step(problem("one branch failed its check"));
    const last = await step(OK);
    expect(last.recovered).toEqual({ afterRuns: 1, since: runs.at(-2)!.finishedAt });
    expect(chat.rows).toHaveLength(1);
    expect(chat.unread).toEqual(["main"]);
    expect(chat.rang).toEqual([]);

    // nothing is hidden: every run stays listed with its outcome and report
    const listed = routines.listRuns().filter((candidate) => candidate.routineId === routine.id);
    expect(listed).toHaveLength(10);
    expect(listed.filter((candidate) => candidate.problems)).toHaveLength(5);
    expect(listed.find((candidate) => candidate.id === reported.id)?.output).toBe(REPORT);
  });

  it("a streak of two then ok writes nothing", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines });
    for (const said of [problem("the queue is stuck"), problem("nothing lands"), OK]) chat.sync(await run(routine.id, said));
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
  });

  it("a third run that fails before its bot writes is told with the streak's own words, deduplicated", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines });
    chat.sync(await run(routine.id, problem("the queue is stuck")));
    chat.sync(await run(routine.id, problem("the queue is stuck")));
    const started = routines.runNow(routine.id)!;
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === started.id)!.threadId!;
    routines.failThread(threadId, "The engine stopped answering");
    const failed = routines.listRuns().find((candidate) => candidate.id === started.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.problemRepeat).toMatchObject({ count: 3 });
    chat.sync(failed);
    expect(routineCards(chat.rows)).toHaveLength(1);
    const card = chat.rows[0]!.routineRun;
    expect(card).toMatchObject({ runId: failed.id, status: "failed", repeat: { count: 3, streak: true } });
    expect(card.error.match(/the queue is stuck/g)).toHaveLength(1);
    expect(card.error).toContain("The engine stopped answering");
    expect(chat.rows[0]!.text).toContain("3 runs with problems since");
  });

  it("a run the person starts during a told streak keeps the summary card's streak: its count goes on and it says works again", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines });
    const p1 = await run(routine.id, problem("the queue is stuck"));
    chat.sync(p1);
    chat.sync(await run(routine.id, problem("nothing lands")));
    const p3 = await run(routine.id, problem("two branches still wait"));
    chat.sync(p3);
    expect(routineCards(chat.rows)).toHaveLength(1);
    // Run now from the person, which ends with problems too
    const byHand = await run(routine.id, problem("the queue is still stuck"), "person");
    expect(byHand.startedBy).toBe("person");
    expect(byHand.problemRepeat).toMatchObject({ firstRunId: p1.id, count: 4 });
    chat.sync(byHand);
    const summary = chat.rows.find((row) => row.routineRun?.runId === p3.id)!;
    expect(summary.routineRun.repeat).toMatchObject({ firstRunId: p1.id, count: 4, streak: true });
    expect(summary.text).toContain("4 runs with problems since");
    // the person's own run shows its result on its own card
    expect(routineCards(chat.rows).map((row) => row.routineRun.runId)).toEqual([p3.id, byHand.id]);
    // #3910: in the streak's words, never the #3479 same-problem wording; the
    // summary stays the one card with the streak flag
    const own = chat.rows.find((row) => row.routineRun?.runId === byHand.id)!;
    expect(own.routineRun.repeat).toMatchObject({ count: 4, anyProblem: true });
    expect(own.routineRun.repeat.streak).toBeUndefined();
    expect(own.text).toContain("4 runs with problems since");
    expect(own.text).not.toContain("Same problem");
    // the next good run turns the summary card to works again
    const fixed = await run(routine.id, OK);
    chat.sync(fixed);
    expect(fixed.recovered).toEqual({ afterRuns: 4, since: p1.finishedAt });
    const after = chat.rows.find((row) => row.routineRun?.runId === p3.id)!;
    expect(after.routineRun).toMatchObject({ status: "completed", recovered: { afterRuns: 4, since: p1.finishedAt } });
    expect(after.text).toContain("Works again");
    expect(routineCards(chat.rows)).toHaveLength(2);
  });

  it("the works-again card after a streak told by a failed run keeps what was wrong in its words", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines });
    chat.sync(await run(routine.id, problem("the queue is stuck")));
    chat.sync(await run(routine.id, problem("the queue is stuck")));
    const started = routines.runNow(routine.id)!;
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === started.id)!.threadId!;
    routines.failThread(threadId, "The engine stopped answering");
    chat.sync(routines.listRuns().find((candidate) => candidate.id === started.id)!);
    chat.sync(await run(routine.id, OK));
    const card = chat.rows[0]!.routineRun;
    expect(card).toMatchObject({ runId: started.id, status: "completed", recovered: { afterRuns: 3 } });
    expect(card.error).toBeUndefined();
    expect(card.summary).toContain("the queue is stuck");
    expect(card.summary).toContain("The engine stopped answering");
    expect(chat.rows[0]!.text).toContain("The engine stopped answering");
  });

  it("a question a run raises reaches the person at once, and a run the person started shows its result", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const done = await run(routine.id, REPORT);
    // waiting on the person's answer (the card in its thread, on the pinned row)
    const asking = conversation({ routines, needsPerson: true });
    asking.sync({ ...done, status: "waiting", attention: "Publish the release notes?" } as RoutineRun);
    expect(routineCards(asking.rows)).toHaveLength(1);
    expect(asking.unread).toEqual(["main"]);
    // #3990: once answered, a run with nothing the routine posts takes its
    // row back (the run log keeps it), whatever starts the routine
    asking.sync(done);
    expect(routineCards(asking.rows)).toHaveLength(0);
    expect(asking.unread).toEqual(["main"]);
    // Run now from the person: its result shows as always
    const byHand = conversation({ routines });
    byHand.sync({ ...done, startedBy: "person" });
    expect(routineCards(byHand.rows)).toHaveLength(1);
    // items only the person can do still post
    const items = conversation({ routines, personAttention: (text) => text?.includes("[HUMAIN]") ? { kind: "items", items: [{ text: "Approve the release" }] } : undefined });
    items.sync({ ...done, output: "[HUMAIN] Approve the release" });
    expect(routineCards(items.rows)).toHaveLength(1);
  });

  it("a routine that runs once a day tells its first problem at once, as the one summary, counted and turned to works again in place (#3990)", async () => {
    const { routines, prompts, run } = manager(start);
    const routine = routines.create({ name: "Backup check", prompt: "Check the backups", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines });
    // the run is told that its problem reaches the person at once
    const first = await run(routine.id, problem("the backup host did not answer"));
    expect(prompts.at(-1)).toContain("the person gets your final message as one summary of the problem");
    expect(prompts.at(-1)).not.toContain("runs in a row");
    chat.sync(first);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: first.id, repeat: { count: 1, streak: true } });
    expect(chat.rows[0]!.text).not.toContain("runs with problems");
    expect(ringsDone(first, routines)).toBe(true);
    expect(chat.unread).toEqual(["main"]);
    // the next day, still wrong: the same card counts, in place, quietly
    const second = await run(routine.id, problem("the backup host did not answer"));
    expect(prompts.at(-1)).toContain("already has one summary");
    chat.sync(second);
    expect(ringsDone(second, routines)).toBe(false);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: first.id, repeat: { count: 2, streak: true } });
    expect(chat.rows[0]!.text).toContain("2 runs with problems since");
    // fixed: that card turns to works again, in place, and nothing else is drawn
    chat.sync(await run(routine.id, "All backups ran.\nNOTHING_TO_REPORT"));
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: first.id, status: "completed", recovered: { afterRuns: 2, streak: true } });
    expect(chat.rows[0]!.text).toContain("Works again");
  });

  it("a routine that runs once a day and posts its results posts each result; its first problem is its one summary (#3990)", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Morning brief", prompt: "Brief me", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines, postResults: true });
    const first = await run(routine.id, problem("the calendar did not answer"));
    chat.sync(first);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: first.id, repeat: { count: 1, streak: true } });
    const brief = await run(routine.id, "Three meetings today, the first at nine.");
    chat.sync(brief);
    expect(routineCards(chat.rows)).toHaveLength(2);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: first.id, recovered: { afterRuns: 1, streak: true } });
    expect(chat.rows[1]!.routineRun.runId).toBe(brief.id);
    expect(ringsDone(brief, routines)).toBe(true);
  });
});

/** #3990: one rule for every routine, whatever starts it. */
describe("no routine run in the chat, whatever starts the routine (#3990)", () => {
  const ON_MAIL = { type: "event" as const, source: "email" as const };
  const problem = (why: string) => `RUN_STATUS: partial: ${why}\nCould not finish the pass.`;
  const routineCards = (rows: Row[]) => rows.filter((row) => row.kind === "routine.run");

  /** One run of `routineId` started by its trigger (a webhook delivery), ten
   * minutes after the previous one, that ends with `said` after `tools`. */
  function triggered(start: number) {
    const m = manager(start);
    let delivery = 0;
    const send = (event: Record<string, unknown>) =>
      m.routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), ...event } as never);
    const fire = async (routineId: string, said: string, tools: Array<{ title: string; ok: boolean; output: string }> = []): Promise<RoutineRun> => {
      const now = m.advance(6 * 60_000);
      const queued = m.routines.enqueueWebhook({ webhookId: `hook-${routineId}`, webhookName: "New email", prompt: "A mail arrived", botId: "maus-1", runOn: "maus", deliveryId: `d${++delivery}`, receivedAt: now, routineId });
      await m.routines.tick();
      const threadId = m.routines.listRuns().find((candidate) => candidate.id === queued.id)!.threadId!;
      for (const [index, tool] of tools.entries()) {
        send({ threadId, type: "item.started", itemType: "tool", itemId: `t${index}`, title: tool.title });
        send({ threadId, type: "item.completed", itemType: "tool", itemId: `t${index}`, ok: tool.ok, output: tool.output });
      }
      send({ threadId, type: "item.completed", itemType: "assistant_text", text: said });
      send({ threadId, type: "turn.completed", ok: true });
      return m.routines.listRuns().find((candidate) => candidate.id === queued.id)!;
    };
    return { ...m, fire };
  }

  it("a routine started by a trigger, ten runs in an hour, set to post its results: nothing in the chat, nothing rings", async () => {
    const { routines, fire } = triggered(start);
    const routine = routines.create({ name: "New email", prompt: "Sort the mail", botId: "maus-1", enabled: false, schedule: ON_MAIL, postResults: true });
    const chat = conversation({ routines, postResults: true });
    const said = [
      "Newsletter, nothing for you.\nNOTHING_TO_REPORT", "Filed the invoice from the supplier.", problem("the mailbox refused one move"),
      "Archived two notices.", "Replied to the meeting request as you asked.", problem("the archive folder was missing"),
      "Nothing urgent, and it is no longer in the inbox.", "Filed a receipt.", problem("the mailbox refused one move"), "Sorted three mails.",
    ];
    const runs: RoutineRun[] = [];
    for (const words of said) {
      const done = await fire(routine.id, words);
      runs.push(done);
      chat.sync(done);
      expect(ringsDone(done, routines)).toBe(false);
    }
    expect(runs.every((done) => done.status === "completed" && !done.startedBy)).toBe(true);
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
    expect(chat.rang).toEqual([]);
    // every run stays in the routine's run log with its report
    const listed = routines.listRuns().filter((candidate) => candidate.routineId === routine.id);
    expect(listed).toHaveLength(10);
    expect(listed.map((candidate) => candidate.output)).toContain("Filed the invoice from the supplier.");
  });

  it("three runs in a row with the same problem: one summary, its count in place, then works again in place", async () => {
    const { routines, fire } = triggered(start);
    const routine = routines.create({ name: "New email", prompt: "Sort the mail", botId: "maus-1", enabled: false, schedule: ON_MAIL, postResults: true });
    const chat = conversation({ routines, postResults: true });
    for (const words of [problem("the mailbox refused the move"), problem("the mailbox refused the move")]) chat.sync(await fire(routine.id, words));
    expect(chat.rows).toEqual([]);
    const third = await fire(routine.id, `${problem("the mailbox refused the move")}\nThe mailbox has refused every move for twenty minutes: sign in to it again.`);
    chat.sync(third);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: third.id, repeat: { count: 3, streak: true } });
    expect(ringsDone(third, routines)).toBe(true);
    chat.sync(await fire(routine.id, problem("the mailbox refused the move")));
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 4 });
    chat.sync(await fire(routine.id, "Moved the mail.\nNOTHING_TO_REPORT"));
    expect(routineCards(chat.rows)).toHaveLength(1);
    // the streak's card, turned to works again, stays the streak's
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: third.id, recovered: { afterRuns: 4, streak: true } });
    expect(chat.unread).toEqual(["main"]);
  });

  it("a run the person starts shows its result, and a routine set to post its results that runs once a day posts each one", async () => {
    const { routines, run } = manager(start);
    const watch = routines.create({ name: "New email", prompt: "Sort the mail", botId: "maus-1", enabled: false, schedule: ON_MAIL, postResults: true });
    const byHand = conversation({ routines, postResults: true });
    const sorted = await run(watch.id, "Sorted three mails.", "person");
    byHand.sync(sorted);
    expect(routineCards(byHand.rows)).toHaveLength(1);
    expect(byHand.rows[0]!.routineRun.startedBy).toBe("person");
    // the person who pressed Run now hears it is done, on a trigger routine too
    expect(ringsDone(sorted, routines)).toBe(true);
    // and on a routine that runs several times a day, even one not set to post its results
    const often = routines.create({ name: "Queue check", prompt: "Check the queue", botId: "maus-1", enabled: false, schedule: { type: "interval", everyMinutes: 5, anchorAt: start }, postResults: false });
    expect(ringsDone(await run(often.id, "The queue is empty.", "person"), routines)).toBe(true);
    const daily = routines.create({ name: "Morning brief", prompt: "Brief me", botId: "maus-1", enabled: false, schedule: DAILY, postResults: true });
    const posted = conversation({ routines, postResults: true });
    posted.sync(await run(daily.id, "Three meetings today."));
    expect(routineCards(posted.rows)).toHaveLength(1);
    // a routine like it, not set to post its results: nothing
    const quiet = routines.create({ name: "Evening brief", prompt: "Brief me", botId: "maus-1", enabled: false, schedule: DAILY, postResults: false });
    const kept = conversation({ routines, postResults: true });
    kept.sync(await run(quiet.id, "Two meetings today."));
    expect(kept.rows).toEqual([]);
  });
});

/** #3990: a run's outcome comes from explicit signals only: the bot's
 * status line, its NOTHING_TO_REPORT line, a tool call that failed and
 * never succeeded, an approval nobody answered. Never from its words. */
describe("a run's outcome comes from explicit signals, never from its words (#3990)", () => {
  async function ending(said: string, tools: Array<{ title: string; ok: boolean; output: string }>) {
    const { routines } = manager(start);
    const routine = routines.create({ name: "New email", prompt: "Sort the mail", botId: "maus-1", enabled: false, schedule: { type: "event", source: "email" } });
    const queued = routines.enqueueWebhook({ webhookId: "hook", webhookName: "New email", prompt: "A mail arrived", botId: "maus-1", runOn: "maus", deliveryId: "d1", receivedAt: start, routineId: routine.id });
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === queued.id)!.threadId!;
    const send = (event: Record<string, unknown>) =>
      routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), threadId, ...event } as never);
    for (const [index, tool] of tools.entries()) {
      send({ type: "item.started", itemType: "tool", itemId: `t${index}`, title: tool.title });
      send({ type: "item.completed", itemType: "tool", itemId: `t${index}`, ok: tool.ok, output: tool.output });
    }
    send({ type: "item.completed", itemType: "assistant_text", text: said });
    send({ type: "turn.completed", ok: true });
    return routines.listRuns().find((candidate) => candidate.id === queued.id)!;
  }

  it("every routine run and every proactive wake is told that a run with nothing to do ends with NOTHING_TO_REPORT, never a partial status", () => {
    expect(ROUTINE_NOTHING_TO_DO_RULE).toBe("A run that found nothing to do, or whose only finding is that nothing needs the person (the item was already handled, is gone, or needs no answer), did its work: end it with the line NOTHING_TO_REPORT, never with a partial or failed RUN_STATUS: line. Use that status line only when a step the work needed failed or work that was needed was left undone.");
    expect(ROUTINE_REPORT_CONTRACT).toContain(ROUTINE_NOTHING_TO_DO_RULE);
    expect(ROUTINE_EXECUTION_PROMPT).toContain(ROUTINE_NOTHING_TO_DO_RULE);
    const wake = proactiveWakePrompt({ mode: "act", events: [{ source: "peer", label: "A teammate wrote", detail: "The ticket is closed." }], more: 0 } as never);
    expect(wake).toContain(ROUTINE_NOTHING_TO_DO_RULE);
    // plain words for a model: no dash
    expect(ROUTINE_NOTHING_TO_DO_RULE).not.toMatch(/[\u2013\u2014]/);
  });

  it("a run that ends with NOTHING_TO_REPORT and nothing failed is done and quiet", async () => {
    const done = await ending("The mail was already handled.\nNOTHING_TO_REPORT", []);
    expect(done.status).toBe("completed");
    expect(done.quiet).toBe(true);
    expect(done.problems).toBeUndefined();
  });

  it("a send that failed twice with 403 stays a problem, whatever the closing words say", async () => {
    const refused = { title: "outlook_send_mail", ok: false, output: "403 Forbidden" };
    const done = await ending("Drafted the reply to the supplier. Nothing else to do.", [refused, refused]);
    expect(done.status).toBe("completed");
    expect(done.problems).toContain("failed 2 times and never succeeded after: 403 Forbidden");
    const plain = await ending("Drafted the reply to the supplier.", [refused, refused]);
    expect(plain.problems).toBe(done.problems);
    // the bot's own quiet line does not hide it either
    const quiet = await ending("Nothing else to do.\nNOTHING_TO_REPORT", [refused, refused]);
    expect(quiet.problems).toContain("failed 2 times and never succeeded after: 403 Forbidden");
  });

  it("a partial status stays a problem, whatever else its reason says", async () => {
    for (const reason of [
      "the backup host has not answered since Monday, nothing new otherwise",
      "already handled the urgent ones; the CRM is unreachable",
      "the CRM is down, nothing else to report",
      "skipped 3 mails because the mailbox is not reachable, nothing more",
      "only sorted 2 of 5, the rest did not load; nothing else",
    ]) {
      const done = await ending(`RUN_STATUS: partial: ${reason}\nSorted what I could.`, []);
      expect(done.problems, reason).toContain(reason);
      expect(done.quiet, reason).toBeUndefined();
      expect(routineReportOutcome(`RUN_STATUS: partial: ${reason}`).declared, reason).toEqual({ status: "partial", reason });
    }
  });

  it("a tool that answered \"not found\" twice and never succeeded stays a problem", async () => {
    for (const output of [
      "HTTP 404 Not Found",
      "The requested URL /v2/tickets was not found on this server",
      "Mailbox not found: someone@example.com",
    ]) {
      const failed = { title: "http_get", ok: false, output };
      const done = await ending("Sorted the inbox.", [failed, failed]);
      expect(done.problems, output).toContain(`failed 2 times and never succeeded after: ${output}`);
    }
  });

  it("an announcement stays one, whatever words follow it", async () => {
    const cut = await ending("I'll leave it: nothing urgent, and it is no longer in the inbox.", []);
    expect(cut.problems).toContain("announcement");
  });
});

/** #3990: a proactive wake posts only a request or its streak's summary. */
describe("a proactive wake posts no result of its own (#3990)", () => {
  async function wake(said: string, alwaysReport = false) {
    const { routines } = manager(start);
    const queued = routines.enqueueProactive({ botId: "maus-1", name: "Proactive: teammate message", prompt: "A teammate wrote",
      proactive: { mode: "act", hops: 0, sources: [alwaysReport ? "watch" : "peer"], ...(alwaysReport ? { alwaysReport: true as const } : {}) } as never });
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === queued.id)!.threadId!;
    const send = (event: Record<string, unknown>) =>
      routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), threadId, ...event } as never);
    send({ type: "item.completed", itemType: "assistant_text", text: said });
    send({ type: "turn.completed", ok: true });
    return { routines, run: routines.listRuns().find((candidate) => candidate.id === queued.id)! };
  }

  it("a teammate's message whose result needs nothing from the person posts nothing and rings nothing", async () => {
    const { routines, run } = await wake("I read the teammate's note: the ticket is closed and nothing needs you.");
    expect(run.status).toBe("completed");
    expect(run.quiet).toBeUndefined();
    const chat = conversation({ routines, postResults: true });
    chat.sync(run);
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
    expect(ringsDone(run, routines)).toBe(false);
  });

  it("a wake the person chose to hear (an accepted suggestion, a watch) posts its result, with its feedback strip", async () => {
    const { routines, run } = await wake("The watch saw the queue grow: I drafted a reply for you to review.", true);
    const chat = conversation({ routines, postResults: true });
    chat.sync(run);
    expect(chat.rows.filter((row) => row.kind === "routine.run")).toHaveLength(1);
    expect(ringsDone(run, routines)).toBe(true);
  });

  it("an item only the person can do still reaches them", async () => {
    const { routines, run } = await wake("[HUMAIN] Approve the refund the teammate prepared.");
    const chat = conversation({ routines, personAttention: (text) => text?.includes("[HUMAIN]") ? { kind: "items", items: [{ text: "Approve the refund" }] } : undefined });
    chat.sync(run);
    expect(chat.rows.filter((row) => row.kind === "routine.run")).toHaveLength(1);
  });

  // #3990 (owner, 2026-11-11 23:51): a wake the person chose (a watch they
  // keep, an accepted suggestion) is a request to be told when there is
  // something, never each time there is nothing.
  it("a wake the person chose that ends with nothing for them posts nothing, rings nothing and stays in the run log", async () => {
    const { routines, run } = await wake("Nothing to bring up, the teammate closed it.\nNOTHING_TO_REPORT", true);
    expect(run.status).toBe("completed");
    expect(run.quiet).toBe(true);
    const chat = conversation({ routines, postResults: true });
    chat.sync(run);
    expect(chat.rows).toEqual([]);
    expect(chat.unread).toEqual([]);
    expect(chat.rang).toEqual([]);
    expect(ringsDone(run, routines)).toBe(false);
    expect(routines.listRuns().some((candidate) => candidate.id === run.id && candidate.quiet)).toBe(true);
  });

  it("the same wake with a report for the person posts it once, marked as for the person", async () => {
    const { routines, run } = await wake("The watch saw three tickets past due: I drafted the reminders for you to review.", true);
    expect(run.quiet).toBeUndefined();
    const chat = conversation({ routines, postResults: true });
    chat.sync(run);
    chat.sync(run);
    const cards = chat.rows.filter((row) => row.kind === "routine.run");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.routineRun.forPerson).toBe(true);
    expect(routineRunRowOutOfChat(cards[0] as never)).toBe(false);
  });

  it("the same wake that needs the person reaches them once, as a request", async () => {
    const { routines, run } = await wake("[HUMAIN] Approve the refund the teammate prepared.", true);
    const chat = conversation({ routines, postResults: true, personAttention: (text) => text?.includes("[HUMAIN]") ? { kind: "human", items: [{ text: "Approve the refund" }] } : undefined });
    chat.sync(run);
    chat.sync(run);
    const cards = chat.rows.filter((row) => row.kind === "routine.run");
    expect(cards).toHaveLength(1);
    expect((cards[0] as { attention?: unknown }).attention).toBeTruthy();
    expect(chat.rang).toEqual(["needs-you"]);
  });

  it("a watch's wake prompt says plainly to end with the nothing-to-report line when nothing is for the person", () => {
    const prompt = proactiveWakePrompt({ mode: "proactive", more: 0, events: [{ botId: "maus-1", source: "watch", key: "w", label: "Watch", detail: "queue at 12" }] });
    expect(prompt).not.toMatch(/never ends with NOTHING_TO_REPORT|ALWAYS tell the person/);
    expect(prompt).toContain("When nothing in it is for the person, end with NOTHING_TO_REPORT");
    expect(prompt).not.toMatch(/[–—]/);
  });
});

// #3990 (owner, 2026-11-11 23:51, server v0.8.91 with #4030): a bot that
// receives its teammates' notices got one row per "Proactive: teammate
// message" wake, each saying in its own words there was nothing for the
// person. The wake below is shaped as startProactiveWake builds it (sources
// ["peer"] only, no alwaysReport). Its turn asks for an approval: while the
// request waits on the person its row is in the chat (as the rule says);
// once answered, the wake ends with plain words for the person. origin/main
// kept that row, completed with those words (and the released app draws it
// with its feedback strip); now the run takes it back: nothing in the chat,
// nothing unread, nothing rings.
describe("a teammate's message wake, the real shape (#3990)", () => {
  async function peerWake(said: string, opts: { asks: boolean }) {
    const ownThread: Row[] = [];
    let chat!: ReturnType<typeof conversation>;
    const { routines } = manager(start, { onRunChanged: (changed: RoutineRun) => chat?.sync(changed) } as never);
    // the server's rule: a card still open in the run's task (server/index.ts routineRunNeedsPerson)
    chat = conversation({ routines, ownThread, needsPerson: () => openCardIn(ownThread as never) });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => { if (typeof line === "string" && line.startsWith("[routine-row]")) lines.push(line); });
    try {
      const queued = routines.enqueueProactive({ botId: "maus-1", name: "Proactive: teammate message", prompt: "A teammate wrote",
        proactive: { mode: "proactive", hops: 1, sources: ["peer"] } as never });
      await routines.tick();
      const threadId = routines.listRuns().find((candidate) => candidate.id === queued.id)!.threadId!;
      const send = (event: Record<string, unknown>) =>
        routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), threadId, ...event } as never);
      const current = () => routines.listRuns().find((candidate) => candidate.id === queued.id)!;
      if (opts.asks) {
        send({ type: "request.opened", requestId: "req-1", requestType: "permission", summary: "Send a message to a teammate" });
        // presentRequestOpened: the approval card in the run's task, and the run's row told
        ownThread.push({ id: "approval", role: "bot", kind: "options", card: { requestId: "req-1" } } as Row);
        chat.sync(current());
        expect(chat.rows.map((row) => row.routineRun?.status)).toEqual(["waiting"]);
        expect(chat.rows[0]!.routineRun.wakeTopic).toBe("peer");
        ownThread[0] = { ...ownThread[0]!, card: { requestId: "req-1", answered: "allow" } } as Row;
        send({ type: "request.resolved", requestId: "req-1" });
        send({ type: "turn.started" });
      }
      send({ type: "item.completed", itemType: "assistant_text", text: said });
      send({ type: "turn.completed", ok: true });
      return { run: current(), chat, lines };
    } finally {
      spy.mockRestore();
    }
  }

  for (const said of ["Nothing to do on your side.", "Nothing to bring up.\nNOTHING_TO_REPORT"]) {
    it(`a wake whose approval was answered and that ends with nothing for the person takes its row back: ${JSON.stringify(said)}`, async () => {
      const { run, chat, lines } = await peerWake(said, { asks: true });
      expect(run.status).toBe("completed");
      expect(run.routineName).toBe("Proactive: teammate message");
      expect(chat.rows).toEqual([]);
      expect(chat.unread.filter((thread) => thread === "main")).toHaveLength(1); // the request, once
      expect(chat.rang).toEqual([]);
      // the server says which writer wrote and took back the row, never its words
      expect(lines[0]).toMatch(/^\[routine-row\] run append run=\S+ kind=wake:peer status=waiting waits=yes$/);
      expect(lines.at(-1)).toMatch(/^\[routine-row\] run remove run=\S+ kind=wake:peer status=completed waits=no$/);
      expect(lines.join("\n")).not.toMatch(/Nothing/);
    });

    it(`the same wake on time without a request writes nothing at all: ${JSON.stringify(said)}`, async () => {
      const { chat, lines } = await peerWake(said, { asks: false });
      expect([chat.rows, chat.unread, chat.rang, lines]).toEqual([[], [], [], []]);
    });
  }

  it("a card answered, dismissed or expired in the run's task is no request waiting on the person", () => {
    expect(openCardIn([{ card: { requestId: "a", answered: "allow" } }, { card: { requestId: "b", expired: true } }, { card: { requestId: "c", dismissed: true } }] as never)).toBe(false);
    expect(openCardIn([{ card: { requestId: "d" } }] as never)).toBe(true);
  });
});


/** #4050, #4051: a streak belongs to one thing; it is told once, at the run
 * it names, whatever reads the run again; a row always reaches a final
 * state; a run the person started keeps its row. */
describe("#4050: one streak per thing, told once at the run it names", () => {
  const EVERY_FIVE = { type: "interval" as const, everyMinutes: 5, anchorAt: start };
  const OK = "Checked the work queue.\nNOTHING_TO_REPORT";
  const problem = (why: string) => `RUN_STATUS: partial: ${why}\nCould not finish the pass.`;
  const routineCards = (rows: Row[]) => rows.filter((row) => row.kind === "routine.run");

  /** One proactive wake of `source`, run as `runAs`, that fails or ends with `said`. */
  async function wake(h: ReturnType<typeof manager>, opts: { source: string; runAs?: string; said?: string; fail?: string; botId?: string }): Promise<RoutineRun> {
    h.advance(60_000);
    const queued = h.routines.enqueueProactive({ botId: opts.botId ?? "maus-1", name: `Proactive: ${opts.source}`, prompt: "Something happened",
      ...(opts.runAs ? { runAs: opts.runAs } : {}), proactive: { mode: "proactive", hops: 0, sources: [opts.source] } as never });
    await h.routines.tick();
    return settle(h, queued.id, opts);
  }
  /** One webhook run (a wait_until follow-up, a reach run) that fails or ends with `said`. */
  async function hook(h: ReturnType<typeof manager>, opts: { webhookId: string; eventSource?: "wait"; said?: string; fail?: string; botId?: string }): Promise<RoutineRun> {
    h.advance(60_000);
    const queued = h.routines.enqueueWebhook({ webhookId: opts.webhookId, webhookName: "Follow-up", prompt: "[Wait finished: the build] Deploy it and tell the person",
      botId: opts.botId ?? "maus-1", runOn: "maus", deliveryId: `d-${h.advance(0)}`, receivedAt: h.advance(0), ...(opts.eventSource ? { eventSource: opts.eventSource } : {}) });
    await h.routines.tick();
    return settle(h, queued.id, opts);
  }
  function settle(h: ReturnType<typeof manager>, id: string, opts: { said?: string; fail?: string }): RoutineRun {
    const threadId = h.routines.listRuns().find((candidate) => candidate.id === id)!.threadId!;
    if (opts.fail) h.routines.failThread(threadId, opts.fail);
    else {
      const send = (event: Record<string, unknown>) =>
        h.routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), threadId, ...event } as never);
      send({ type: "item.completed", itemType: "assistant_text", text: opts.said ?? OK });
      send({ type: "turn.completed", ok: true });
    }
    return h.routines.listRuns().find((candidate) => candidate.id === id)!;
  }

  it("one person's wake problems are never counted, quoted or printed for another person of the same bot", async () => {
    const h = manager(start);
    await wake(h, { source: "mail", runAs: "alice", fail: "Mail from the bank about invoice 42 could not be read" });
    await wake(h, { source: "mail", runAs: "alice", fail: "Mail from the bank about invoice 42 could not be read" });
    const bob = await wake(h, { source: "mail", runAs: "bob", fail: "The calendar did not answer" });
    expect(h.prompts.at(-1)).not.toContain("invoice 42");
    expect(bob.problemRepeat).toBeUndefined();
    expect(h.routines.problemStreakTexts(bob)).toEqual(["The calendar did not answer"]);
  });

  it("a watch that fails each time is told at its third failure, whatever other wake kinds do in between", async () => {
    const h = manager(start);
    const chat = conversation({ routines: h.routines });
    const watch = async () => { const done = await wake(h, { source: "watch", fail: "The board did not load" }); chat.sync(done); return done; };
    const peer = async () => chat.sync(await wake(h, { source: "peer", said: "Nova closed it.\nNOTHING_TO_REPORT" }));
    await watch(); await peer(); await watch(); await peer();
    const third = await watch();
    expect(third.problemRepeat).toMatchObject({ count: 3 });
    expect(third.tellsStreak).toBe(true);
    expect(h.routines.problemAlert(third, { detail: "told" })).toEqual({ detail: "told" });
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: third.id, repeat: { count: 3, streak: true } });
    // a good wake of another kind says nothing about the watch
    await peer();
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ streak: true });
  });

  it("each bot's reach runs keep their own streak", async () => {
    const h = manager(start);
    await hook(h, { webhookId: "reach-me-teams", botId: "maus-1", fail: "Teams refused the token" });
    await hook(h, { webhookId: "reach-me-teams", botId: "maus-2", said: "Sent.\nNOTHING_TO_REPORT" });
    const again = await hook(h, { webhookId: "reach-me-teams", botId: "maus-1", fail: "Teams refused the token" });
    expect(again.problemRepeat).toMatchObject({ count: 2 });
  });

  it("a wake that gathered a mail and a watch counts in neither the mail streak nor the watch streak", async () => {
    const h = manager(start);
    await wake(h, { source: "mail", fail: "The mailbox did not answer" });
    h.advance(60_000);
    const queued = h.routines.enqueueProactive({ botId: "maus-1", name: "Proactive: mail", prompt: "Something happened",
      proactive: { mode: "proactive", hops: 0, sources: ["mail", "watch"] } as never });
    await h.routines.tick();
    const gathered = settle(h, queued.id, { fail: "The mailbox did not answer" });
    expect(gathered.problemRepeat).toBeUndefined();
    const mail = await wake(h, { source: "mail", fail: "The mailbox did not answer" });
    expect(mail.problemRepeat).toMatchObject({ count: 2 });
  });

  it("a wait_until follow-up reads no background rule and is told at its first failure", async () => {
    const h = manager(start);
    const chat = conversation({ routines: h.routines });
    const failed = await hook(h, { webhookId: "wait:w1", eventSource: "wait", fail: "The deploy tool is missing" });
    expect(h.prompts.at(-1)).not.toContain("the person does not read each run");
    expect(h.prompts.at(-1)).not.toContain("Say nothing unless you need them");
    expect(failed.tellsStreak).toBe(true);
    expect(h.routines.problemAlert(failed, { detail: "told" })).toEqual({ detail: "told" });
    chat.sync(failed);
    expect(routineCards(chat.rows)).toHaveLength(1);
  });

  it("the failed last run of a routine that is then deleted keeps its summary and its alert", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Reminder", prompt: "Remind me", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines: h.routines });
    const failed = await h.run(routine.id, problem("the reminder could not be sent"));
    chat.sync(failed);
    expect(routineCards(chat.rows)).toHaveLength(1);
    h.routines.remove(routine.id);
    const after = h.routines.listRuns().find((candidate) => candidate.id === failed.id)!;
    chat.sync(after);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(h.routines.problemAlert(after, { detail: "told" })).toEqual({ detail: "told" });
  });

  it("a run a restart cut is told on its own", async () => {
    const h = manager(start);
    const cut = await wake(h, { source: "watch", fail: ROUTINE_RESTARTED });
    expect(cut.tellsStreak).toBe(true);
    expect(h.routines.problemAlert(cut, { detail: "told" })).toEqual({ detail: "told" });
  });

  it("syncing an old run again never rewrites its works again, drops its streak, rolls its count back or adds a summary", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines: h.routines });
    const step = async (said: string) => { const done = await h.run(routine.id, said); chat.sync(done); return done; };
    await step(problem("stuck")); await step(problem("stuck"));
    const p3 = await step(problem("stuck"));
    // Mark all as read syncs the telling run again: its card stays the summary
    chat.sync(p3);
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 3, streak: true });
    const p4 = await step(problem("stuck"));
    await step(problem("stuck"));
    // opening an older run of the streak never rolls the count back
    chat.sync(p4);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 5, streak: true });
    await step(OK);
    const unread = chat.unread.length;
    // after it works again: the telling run and a later problem run, synced again
    chat.sync(h.routines.listRuns().find((candidate) => candidate.id === p3.id)!);
    chat.sync(h.routines.listRuns().find((candidate) => candidate.id === p4.id)!);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun).toMatchObject({ runId: p3.id, status: "completed", recovered: { streak: true } });
    expect(chat.unread).toHaveLength(unread);
  });

  it("a schedule edit in the middle of a streak tells it once, card and alert together", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines: h.routines });
    chat.sync(await h.run(routine.id, problem("stuck")));
    h.routines.update(routine.id, { schedule: DAILY });
    const second = await h.run(routine.id, problem("stuck"));
    chat.sync(second);
    expect(second.tellsStreak).toBe(true);
    expect(h.routines.problemAlert(second, { detail: "told" })).toEqual({ detail: "told" });
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(ringsDone(second, h.routines)).toBe(true);
  });

  /** The runs a server before #4050 settled carry no `tellsStreak`. */
  const settledBefore = (routines: RoutineManager) => {
    for (const entry of (routines as unknown as { runs: RoutineRun[] }).runs) delete entry.tellsStreak;
  };

  it("an upgrade in the middle of a streak told at its third run tells it no second time", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines: h.routines });
    for (let index = 0; index < 3; index += 1) chat.sync(await h.run(routine.id, problem("stuck")));
    settledBefore(h.routines);
    const rang = chat.rang.length;
    const fourth = await h.run(routine.id, problem("stuck"));
    chat.sync(fourth);
    expect(fourth.problemRepeat).toMatchObject({ count: 4 });
    expect(fourth.tellsStreak).toBe(false);
    expect(h.routines.problemAlert(fourth, { detail: "told" })).toBeNull();
    expect(ringsDone(fourth, h.routines)).toBe(false);
    expect(routineCards(chat.rows)).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 4, streak: true });
    expect(chat.rang).toHaveLength(rang);
  });

  it("an upgrade after a daily routine's first problem, told then, tells its streak no second time", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Backup check", prompt: "Check the backups", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines: h.routines });
    chat.sync(await h.run(routine.id, problem("the backup host is down")));
    settledBefore(h.routines);
    const second = await h.run(routine.id, problem("the backup host is down"));
    chat.sync(second);
    expect(second.tellsStreak).toBe(false);
    expect(h.routines.problemAlert(second, { detail: "told" })).toBeNull();
    expect(ringsDone(second, h.routines)).toBe(false);
    expect(routineCards(chat.rows)).toHaveLength(1);
  });

  it("an upgrade before a streak reached its told count still tells it at that count", async () => {
    const h = manager(start);
    const routine = h.routines.create({ name: "Work watch", prompt: "Make sure the work goes on", botId: "maus-1", enabled: false, schedule: EVERY_FIVE });
    const chat = conversation({ routines: h.routines });
    for (let index = 0; index < 2; index += 1) chat.sync(await h.run(routine.id, problem("stuck")));
    settledBefore(h.routines);
    const third = await h.run(routine.id, problem("stuck"));
    expect(third.tellsStreak).toBe(true);
    expect(h.routines.problemAlert(third, { detail: "told" })).toEqual({ detail: "told" });
  });
});

describe("#4051: a row always reaches a final state, and a run the person started keeps its row", () => {
  it("Run now then Stop: the person's card says it stopped, never Running", async () => {
    const { routines } = manager(start);
    const routine = routines.create({ name: "Check", prompt: "Check", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines });
    const started = routines.runNow(routine.id, undefined, "person")!;
    await routines.tick();
    chat.sync(routines.listRuns().find((candidate) => candidate.id === started.id)!);
    expect(chat.rows[0]!.routineRun.status).toBe("running");
    const stopped = (await routines.cancelRun(started.id))!;
    chat.sync(stopped);
    expect(chat.rows.filter((row) => row.kind === "routine.run")).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.status).toBe("cancelled");
  });

  it("a waiting row of a background run that is cancelled is taken back", async () => {
    const { routines } = manager(start);
    const routine = routines.create({ name: "Check", prompt: "Check", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines, needsPerson: true });
    const started = routines.runNow(routine.id)!;
    await routines.tick();
    const waiting = { ...routines.listRuns().find((candidate) => candidate.id === started.id)!, status: "waiting" as const };
    chat.sync(waiting);
    expect(chat.rows).toHaveLength(1);
    chat.sync((await routines.cancelRun(started.id))!);
    expect(chat.rows).toEqual([]);
  });

  it("a run the person started that ends quiet keeps its card, without ringing", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Check", prompt: "Check", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines });
    const done = await run(routine.id, "All good.\nNOTHING_TO_REPORT", "person");
    chat.sync({ ...done, status: "running" });
    chat.sync(done);
    expect(chat.rows.filter((row) => row.kind === "routine.run")).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.status).toBe("nothing_to_report");
    expect(chat.rang).toEqual([]);
    expect(ringsDone(done, routines)).toBe(false);
  });

  it("a result posted after an earlier problem is drawn: it never carries the streak's works again", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Morning brief", prompt: "Brief me", botId: "maus-1", enabled: false, schedule: DAILY });
    const chat = conversation({ routines, postResults: true });
    // a problem told by an older server (no summary card in this chat)
    await run(routine.id, "RUN_STATUS: partial: the calendar did not answer");
    const brief = await run(routine.id, "Three meetings today, the first at nine.");
    expect(brief.recovered).toBeTruthy();
    chat.sync(brief);
    const cards = chat.rows.filter((row) => row.kind === "routine.run");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.routineRun.recovered).toBeUndefined();
    expect(routineRunRowOutOfChat(cards[0] as never)).toBe(false);
    expect(chat.unread).toEqual(["main"]);
  });
});

describe("#4051: a wake kind told to answer the person posts its answer", () => {
  it("a screen offer, a mention, a text and the bot's look at its failed run post; a teammate, a mail, a calendar or a webhook wake does not", () => {
    const posts = (source: string) => wakeAlwaysReports([{ source, label: "x", detail: "y" } as never]);
    expect(["screen", "bot", "sms", "run", "watch", "suggestion"].map(posts)).toEqual([true, true, true, true, true, true]);
    expect(["peer", "mail", "calendar", "webhook"].map(posts)).toEqual([false, false, false, false]);
  });
});

describe("#4051: a wake's answer rings only where every desktop in use draws its row", () => {
  /** The chat filter of the desktop released as 0.8.92 (shared/routine-repeat.ts
   * routineRunRowOutOfChat at that tag), as those desktops still run it. */
  const releasedOutOfChat = (message: Row & { attention?: unknown }): boolean => {
    const run = message.kind === "routine.run" ? message.routineRun : null;
    if (!run?.status) return false;
    if (message.attention || run.goalStatus || run.startedBy === "person" || run.repeat?.streak || run.recovered?.streak) return false;
    if ((run.autoPausedAfter ?? 0) > 0) return false;
    switch (run.status) {
      case "queued": case "running": case "waiting": case "failed": case "missed": return false;
      case "completed": return Boolean(run.problems || run.recovered || (run.wakeTopic && !new Set(["suggestion", "watch"]).has(run.wakeTopic)));
      default: return true;
    }
  };

  for (const source of ["screen", "bot", "sms", "run", "suggestion", "watch"]) {
    it(`a ${source} wake's answer posts, and rings or turns unread only if the 0.8.92 desktop draws it`, async () => {
      const h = manager(start);
      const chat = conversation({ routines: h.routines });
      h.advance(60_000);
      const queued = h.routines.enqueueProactive({ botId: "maus-1", name: `Proactive: ${source}`, prompt: "Something happened",
        proactive: { mode: "proactive", hops: 0, sources: [source], alwaysReport: true } as never });
      await h.routines.tick();
      const threadId = h.routines.listRuns().find((candidate) => candidate.id === queued.id)!.threadId!;
      const send = (event: Record<string, unknown>) =>
        h.routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), threadId, ...event } as never);
      send({ type: "item.completed", itemType: "assistant_text", text: "The build on your screen failed at the signing step; I can retry it." });
      send({ type: "turn.completed", ok: true });
      const done = h.routines.listRuns().find((candidate) => candidate.id === queued.id)!;
      chat.sync(done);
      const rows = chat.rows.filter((row) => row.kind === "routine.run");
      expect(rows).toHaveLength(1);
      expect(routineRunRowOutOfChat(rows[0] as never)).toBe(false);
      const releasedDraws = !releasedOutOfChat(rows[0]!);
      expect(releasedDraws).toBe(source === "suggestion" || source === "watch");
      expect(chat.unread.length > 0).toBe(releasedDraws);
      expect(ringsDone(done, h.routines)).toBe(releasedDraws);
    });
  }
});
