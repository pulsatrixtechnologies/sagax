// #3479: routines stay quiet when nothing needs the person. A run started by
// a trigger follows the same report rule as a scheduled run, and a problem
// that repeats is said once: the row of the first run with it is updated in
// place (how many runs, since when), with no new row and no notification. A
// different problem, and the first success after a problem, are said once.
// Every run stays in the run list with its outcome.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSyncRoutineRunToSource } from "../index-leaves/syncRoutineRunToSource.ts";
import { routineRunRingsDone } from "../runtime-events/turn-completed.ts";
import { ROUTINE_EXECUTION_PROMPT, WEBHOOK_PROMPT, routineExecutionPromptFor } from "../system-prompt.ts";
import { routineReportOutcome, routineRunReportable } from "./routine-report.ts";
import { routineRunCard, routineRunFallbackText } from "./routine-run-card.ts";
import { RoutineManager, type RoutineManagerOptions, type RoutineRun } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function manager(start: number) {
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
  };
  const routines = new RoutineManager(options);
  const send = (event: Record<string, unknown>) =>
    routines.handleRuntimeEvent({ eventId: String(Math.random()), provider: "fake", createdAt: new Date().toISOString(), ...event } as never);
  /** One Run now that ends with `said`, an hour after the previous one. */
  const run = async (routineId: string, said: string): Promise<RoutineRun> => {
    now += 3_600_000;
    const started = routines.runNow(routineId)!;
    await routines.tick();
    const threadId = routines.listRuns().find((candidate) => candidate.id === started.id)!.threadId!;
    send({ threadId, type: "item.completed", itemType: "assistant_text", text: said });
    send({ threadId, type: "turn.completed", ok: true });
    return routines.listRuns().find((candidate) => candidate.id === started.id)!;
  };
  return { routines, prompts, run };
}

type Row = { id: string; kind?: string; role?: string; text?: string; routineRun?: any };

/** The person's one conversation, with the real card, text and report rule. */
function conversation(options: { personAttention?: (text: string | undefined) => any; ownThread?: Row[] } = {}) {
  const rows: Row[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const bot = { id: "maus-1", name: "Atlas" };
  const host = {
    routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
    personAttention: options.personAttention ?? (() => undefined),
    routineFullReport: (r: RoutineRun) => r.output,
    routineRunReportable,
    routineRunNeedsPerson: () => false,
    routineEffectivePostResults: () => false,
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
 * for a routine that posts its results. */
const ringsDone = (run: RoutineRun) => routineRunRingsDone(run, { routineEffectivePostResults: () => true, personAttention: () => undefined });

const PROBLEM = "RUN_STATUS: partial: the backup host has not answered since Monday";
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

describe("a problem that repeats is said once (#3479)", () => {
  it("reads the bot's SAME_PROBLEM line and never shows it", () => {
    const outcome = routineReportOutcome(`${PROBLEM}\nStill down.\nSAME_PROBLEM`);
    expect(outcome.sameProblem).toBe(true);
    expect(outcome.declared?.status).toBe("partial");
    expect(outcome.report).toBe("Still down.");
    expect(routineReportOutcome(`${PROBLEM}\nStill down.`).sameProblem).toBeUndefined();
  });

  it("the same problem updates the first row in place; a different one and the first success are said once", async () => {
    const { routines, prompts, run } = manager(start);
    const routine = routines.create({ name: "Backup check", prompt: "Check the backups", botId: "maus-1", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start } });
    const chat = conversation();

    // 1. A new problem: one row, unread once.
    const first = await run(routine.id, `${PROBLEM}\nThe backup host did not answer.`);
    expect(first.problems).toContain("has not answered since Monday");
    expect(first.problemRepeat).toBeUndefined();
    chat.sync(first);
    expect(chat.rows).toHaveLength(1);
    expect(chat.unread).toEqual(["main"]);

    // 2. The bot is shown the previous problems and says it is the same.
    const second = await run(routine.id, `${PROBLEM}\nStill no answer from the backup host.\nSAME_PROBLEM`);
    expect(prompts.at(-1)).toContain("<previous-problems");
    expect(prompts.at(-1)).toContain("has not answered since Monday");
    expect(prompts.at(-1)).toContain("SAME_PROBLEM");
    expect(second.problemRepeat).toEqual({ firstRunId: first.id, since: first.finishedAt, count: 2 });
    chat.sync(second);
    expect(chat.rows).toHaveLength(1);
    expect(chat.unread).toEqual(["main"]);
    expect(chat.rang).toEqual([]);
    expect(ringsDone(second)).toBe(false);
    expect(chat.rows[0]!.routineRun.runId).toBe(first.id);
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 2, since: first.finishedAt, lastAt: second.finishedAt });
    expect(chat.rows[0]!.text).toContain("2 runs in a row");

    // 3. The very same recorded problems, without the line: still the same.
    const third = await run(routine.id, `${PROBLEM}\nThe backup host did not answer.`);
    expect(third.problemRepeat).toEqual({ firstRunId: first.id, since: first.finishedAt, count: 3 });
    chat.sync(third);
    expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0]!.routineRun.repeat.count).toBe(3);
    expect(chat.unread).toEqual(["main"]);

    // 4. A different problem is said: a new row, unread again.
    const other = await run(routine.id, "RUN_STATUS: partial: the CRM refused the login\nCould not read the CRM.");
    expect(other.problemRepeat).toBeUndefined();
    chat.sync(other);
    expect(chat.rows).toHaveLength(2);
    expect(chat.unread).toEqual(["main", "main"]);
    expect(ringsDone(other)).toBe(true);

    // 5. The first success after it is said once, even when quiet.
    const fixed = await run(routine.id, "All backups answered.\nNOTHING_TO_REPORT");
    expect(fixed.quiet).toBe(true);
    expect(fixed.recovered).toEqual({ afterRuns: 1, since: other.finishedAt });
    chat.sync(fixed);
    expect(chat.rows).toHaveLength(3);
    expect(chat.rows[2]!.text).toContain("Works again");
    expect(chat.unread).toHaveLength(3);

    // 6. The next quiet success is quiet again.
    const quiet = await run(routine.id, "All backups answered.\nNOTHING_TO_REPORT");
    expect(quiet.recovered).toBeUndefined();
    chat.sync(quiet);
    expect(chat.rows).toHaveLength(3);

    // Nothing is hidden: every run stays listed with its outcome.
    const listed = routines.listRuns().filter((candidate) => candidate.routineId === routine.id);
    expect(listed.map((candidate) => candidate.status)).toEqual(Array(6).fill("completed"));
    expect(listed.filter((candidate) => candidate.problems)).toHaveLength(4);
  });

  it("a run that says the problem is the same, with no recorded problem, is never marked recovered", async () => {
    const { routines, prompts, run } = manager(start);
    const routine = routines.create({ name: "Backup check", prompt: "Check the backups", botId: "maus-1", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start } });
    const chat = conversation();

    const first = await run(routine.id, `${PROBLEM}\nThe backup host did not answer.`);
    chat.sync(first);
    expect(chat.rows).toHaveLength(1);

    // The note asks the bot to keep its RUN_STATUS line beside SAME_PROBLEM.
    const second = await run(routine.id, "The backup host is still unreachable.\nSAME_PROBLEM");
    expect(prompts.at(-1)).toContain("Keep your RUN_STATUS: line as usual");
    expect(second.recovered).toBeUndefined();
    expect(second.problems).toBe(first.problems);
    expect(second.problemRepeat).toEqual({ firstRunId: first.id, since: first.finishedAt, count: 2 });
    chat.sync(second);
    expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0]!.text).not.toContain("Works again");
    expect(chat.rows[0]!.routineRun.repeat).toMatchObject({ count: 2 });
    expect(chat.unread).toEqual(["main"]);
    expect(chat.rang).toEqual([]);
    expect(ringsDone(second)).toBe(false);
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

  it("a repeat run with a new item only the person can do still posts its card and rings needs-you", async () => {
    const { routines, run } = manager(start);
    const routine = routines.create({ name: "Incoming mail", prompt: "Sort the mail", botId: "maus-1", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start } });
    const ASK = "[HUMAIN] Answer the new mail from the supplier.";
    const chat = conversation({
      personAttention: (text) => text?.includes("[HUMAIN]") ? { kind: "items", items: [{ text: "Answer the new mail from the supplier." }] } : undefined,
    });
    const CRM = "RUN_STATUS: partial: the CRM is unreachable";

    const first = await run(routine.id, `${CRM}\nCould not reach the CRM.`);
    chat.sync(first);
    expect(chat.rows).toHaveLength(1);
    expect(chat.rang).toEqual([]);

    const second = await run(routine.id, `${CRM}\nStill no CRM.\n${ASK}\nSAME_PROBLEM`);
    expect(second.problemRepeat).toMatchObject({ firstRunId: first.id, count: 2 });
    chat.sync(second);
    // its own card, with the item, unread and ringing once
    expect(chat.rows).toHaveLength(2);
    expect(chat.rows[1]!.routineRun.runId).toBe(second.id);
    expect((chat.rows[1] as any).attention?.items?.[0]?.text).toContain("Answer the new mail");
    expect(chat.unread).toEqual(["main", "main"]);
    expect(chat.rang).toEqual(["needs-you"]);
  });

  it("the run's own thread never shows the same-problem line, whatever its shape", () => {
    const own: Row[] = [{ id: "b1", role: "bot", text: "Still down.\n**Same problem.**\nNOTHING_TO_REPORT" }];
    const chat = conversation({ ownThread: own });
    chat.sync({ id: "r1", routineId: "x", botId: "maus-1", status: "completed", threadId: "own", output: "Still down.", quiet: true } as RoutineRun);
    expect(own[0]!.text).toBe("Still down.");
  });
});
