// A routine's page and one of its runs, the way cloud routines read
// (2026-10-29): the state and its time first, the result rendered as
// Markdown, what waits on the person answerable in place, the steps
// grouped, and the routine's Configuration one tab away. A run of a
// deleted routine keeps all of it, minus Run again (#1567).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { BotActivityDetail } from "@/lib/bot-activity";
import type { Message } from "@/state/store";
import type { WaitingItem } from "@/lib/use-waiting-cards";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});
afterAll(() => vi.unstubAllGlobals());

const { RoutineRunDetail, runActivityStatus } = await import("./RoutineRunDetail");
const { RoutineDetail } = await import("./RoutineDetail");
const { waitingItemsOf } = await import("@/lib/use-waiting-cards");
const { routineNextText, routineRunDuration, routineRunPreview, routineState } = await import("@/lib/routine-display");

const NOW = Date.parse("2026-10-29T14:00:00Z");
const MIN = 60_000;
const bot = { id: "atlas", name: "Atlas", color: "blue", threadId: "atlas-thread", tasks: [] } as unknown as Bot;
const routine = {
  id: "r1", name: "Morning briefing", prompt: "Write the morning briefing.", target: "bot", botId: "atlas", runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30, nextRunAt: NOW + 60 * MIN, createdAt: 1, updatedAt: 1,
} as unknown as Routine;
const table = "Three items today.\n\n| Area | Open |\n| --- | ---: |\n| Inbox | 4 |\n| Quotes | 2 |";
const run = (status: RoutineRun["status"], extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id: `run-${status}`, routineId: "r1", routineName: "Morning briefing", target: "bot", botId: "atlas", runOn: "maus",
  scheduledFor: NOW - 10 * MIN, createdAt: NOW - 10 * MIN, startedAt: NOW - 10 * MIN, status, manual: false,
  ...(["completed", "failed"].includes(status) ? { finishedAt: NOW - 6 * MIN } : {}),
  ...extra,
} as RoutineRun);
const detail = (steps: number): BotActivityDetail => ({
  id: "run:x", kind: "routine", botId: "atlas", title: "Morning briefing", status: "finished", startedAt: NOW - 10 * MIN, endedAt: NOW - 6 * MIN, updatedAt: NOW - 6 * MIN,
  threadId: "atlas-run", steps: Array.from({ length: steps }, (_, index) => ({ id: `s${index}`, name: "read_mail", summary: `message ${index}`, ok: true, at: NOW - 9 * MIN + index })),
  stepsTruncated: false, files: [], children: [],
} as unknown as BotActivityDetail);

function html(props: Partial<Parameters<typeof RoutineRunDetail>[0]> & { run: RoutineRun }) {
  return renderToStaticMarkup(createElement(RoutineRunDetail, { routine, bots: [bot], now: NOW, ...props }));
}

describe("a run's detail", () => {
  it("leads with its state and time, then renders the result as Markdown: a table is a table, not pipes", () => {
    const markup = html({ run: run("completed", { output: table, cost: 0.042 }), detail: detail(3) });
    expect(markup).toContain('data-task-header="finished"');
    expect(markup).toContain("in 4m");
    expect(markup).toContain("$0.04");
    expect(markup.indexOf("data-task-header")).toBeLessThan(markup.indexOf("data-run-result"));
    expect(markup).toContain("<table");
    expect(markup).not.toContain("| Area |");
  });

  it("puts what waits on the person first, with the conversation's own approval card and a reply box", () => {
    const message = { id: "m-a", role: "bot", kind: "options", at: NOW - MIN, card: { requestId: "req-1", tool: "mcp__chat__post_message", title: "", subtitle: "To: the channel", options: ["Allow", "Deny"] } } as unknown as Message;
    const [pending] = waitingItemsOf([message], { threadId: "atlas-run", botId: "atlas" }) as [WaitingItem];
    const markup = html({ run: run("waiting", { threadId: "atlas-run", attention: "Post the digest?" }), detail: detail(1), waiting: [pending], onReply: async () => {}, onStop: () => {} });
    expect(markup).toContain("Waiting for your approval");
    expect(markup).toContain('data-task-waiting-approvals="1"');
    expect(markup.indexOf("data-run-waiting")).toBeLessThan(markup.indexOf("data-run-fold=\"steps\""));
    expect(markup).toContain("data-activity-steer");
    expect(markup).toContain("data-run-stop");
  });

  it("says what a waiting run asks even before its cards are read", () => {
    const markup = html({ run: run("waiting", { attention: "Post the digest?" }) });
    expect(markup).toContain("Post the digest?");
    expect(markup).toContain('data-task-waiting-item="note"');
  });

  it("shows a failure's error, the auto-pause and Run again; the steps open on their own", () => {
    const markup = html({ run: run("failed", { error: "The connector timed out.", autoPaused: { failures: 5 } } as Partial<RoutineRun>), detail: detail(2), canRunAgain: true, onRunAgain: () => {}, onResume: () => {} });
    expect(markup).toContain("data-run-error");
    expect(markup).toContain("The connector timed out.");
    expect(markup).toContain("data-run-auto-paused");
    expect(markup).toContain("data-routine-resume");
    expect(markup).toContain("data-run-again");
    expect(markup).toContain('id="run-fold-steps"');
  });

  it("groups repeated steps instead of listing every call", () => {
    const markup = html({ run: run("completed", { output: "Done." }), detail: detail(12), wide: true });
    expect(markup).toContain("×12");
  });

  it("keeps a deleted routine's run whole, says so, and offers no Run again", () => {
    const markup = html({ run: run("completed", { output: "Archived 27 items." }), routine: null, canRunAgain: true, onRunAgain: () => {} });
    expect(markup).toContain("data-deleted-routine");
    expect(markup).toContain("Archived 27 items.");
    expect(markup).toContain('data-run-fold="configuration"');
  });

  it("maps a run's status to the task sheet's words", () => {
    expect(runActivityStatus({ status: "missed" })).toBe("failed");
    expect(runActivityStatus({ status: "cancelled" })).toBe("stopped");
    expect(runActivityStatus({ status: "completed" })).toBe("finished");
  });
});

describe("a routine's page", () => {
  const runs = [run("completed", { id: "a", output: table, scheduledFor: NOW - 60 * MIN }), run("failed", { id: "b", error: "rpc_error", scheduledFor: NOW - 120 * MIN })];
  it("lists its runs newest first, each with its state, its time and its first line", () => {
    const markup = renderToStaticMarkup(createElement(RoutineDetail, { routine, runs, bots: [bot], now: NOW, onOpenRun: () => {} }));
    expect(markup).toContain("data-routine-history");
    expect(markup.indexOf('data-run-row="a"')).toBeLessThan(markup.indexOf('data-run-row="b"'));
    expect(markup).toContain("Three items today.");
    expect(markup).not.toContain("Write the morning briefing.");
  });

  it("keeps no second copy of the configuration: its summary opens the editor (2026-10-29)", () => {
    const markup = renderToStaticMarkup(createElement(RoutineDetail, { routine, runs, bots: [bot], now: NOW, onOpenRun: () => {}, onConfigure: () => {} }));
    expect(markup).not.toContain("data-routine-config-prompt");
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain("data-routine-summary");
    expect(markup).toContain("See and edit the configuration");
    const plain = renderToStaticMarkup(createElement(RoutineDetail, { routine, runs, bots: [bot], now: NOW, onOpenRun: () => {} }));
    expect(plain).not.toContain("See and edit the configuration");
  });
});

describe("the list's words", () => {
  it("says a run's duration in plain units", () => {
    expect(routineRunDuration({ startedAt: 1_000, finishedAt: 39_000, status: "completed" })).toBe("38 s");
    expect(routineRunDuration({ startedAt: 1_000, finishedAt: 1_000 + 72 * MIN, status: "completed" })).toBe("1 h 12 min");
    expect(routineRunDuration({ startedAt: undefined, status: "queued" } as never)).toBeUndefined();
  });

  it("previews a table's first row without its pipes", () => {
    expect(routineRunPreview({ status: "completed", output: "| Area | Open |\n| --- | --- |" })).toBe("Area · Open");
    expect(routineRunPreview({ status: "completed", quiet: true })).toContain("Nothing");
  });

  it("names a routine's state: running over paused over active", () => {
    expect(routineState(routine, [{ routineId: "r1", status: "running" }]).tone).toBe("info");
    expect(routineState({ ...routine, enabled: false }).tone).toBe("paused");
    expect(routineState(routine).tone).toBe("active");
    expect(routineNextText({ ...routine, nextRunAt: null, schedule: { type: "webhook" } } as unknown as Routine)).toBeTruthy();
  });
});

describe("the run logs (2026-10-29)", async () => {
  const { RoutineLogs } = await import("./RoutineLogs");
  const other = { ...bot, id: "boreas", name: "Boreas" } as unknown as Bot;
  const logs = [
    run("completed", { id: "l1", output: table, scheduledFor: NOW - 60 * MIN }),
    run("failed", { id: "l2", routineId: "gone", routineName: "Quarterly cleanup", botId: "boreas", error: "Timed out.", scheduledFor: NOW - 40 * 86_400_000 }),
  ];
  it("narrows by routine, bot, state and period, and previews a result without its pipes", () => {
    const markup = renderToStaticMarkup(createElement(RoutineLogs, { runs: logs, bots: [bot, other], status: "all", now: NOW, onStatusChange: () => {}, onClearRoutine: () => {}, onRoutineChange: () => {}, onOpen: () => {} }));
    for (const marker of ["data-logs-routine", "data-logs-bot", "data-logs-period"]) expect(markup).toContain(marker);
    // a deleted routine's runs stay listed and filterable (#1567)
    expect(markup).toContain("Quarterly cleanup");
    expect(markup).toContain("Three items today.");
    expect(markup).not.toContain("| Area |");
  });

  // JC 2026-11-01: "most routines make errors and end up showing success".
  it("a run that completed with problems says so, with the problems, never as a plain success", () => {
    const markup = html({ run: run("completed", { output: "Checked 10 invoices.", problems: "crm_login failed 2 times and never succeeded after" }), detail: detail(1) });
    expect(markup).toContain("data-run-problems");
    expect(markup).toContain("Completed with problems");
    expect(markup).toContain("crm_login failed 2 times");
    expect(markup).toContain("Checked 10 invoices.");
  });

  it("a queued run says why it waits and its place in its bot's queue", () => {
    const queued = run("queued", { startedAt: undefined, attention: "Waits for a free slot on this bot" });
    const earlier = { ...queued, id: "run-earlier", createdAt: queued.createdAt - 1 };
    const markup = html({ run: queued, runs: [earlier, queued] });
    expect(markup).toContain("Waits for a free slot on this bot");
    expect(markup).toContain("Number 2 of 2 waiting for this bot");
  });
});
