import { describe, expect, it } from "vitest";

import { routineRunReportable } from "../routines/routine-report.ts";
import { createSyncRoutineRunToSource } from "./syncRoutineRunToSource.ts";

type Row = { id: string; kind: string; text?: string; routineRun?: { runId: string; wakeTopic?: string }; attention?: unknown };

/** #2694 review: the attention a finished routine puts on its own card reads
 * the person's feedback (thumbs-down, "less", "never") like a relayed card. */
function world(level: "normal" | "quiet" | "muted", run: Record<string, unknown> = {}, guest = false) {
  const rows: Row[] = [];
  const asked: string[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const promoted: string[] = [];
  // A Cloud guest's run: no source conversation, a hidden bot, its own task.
  const bot = { id: "bot-atlas", name: "Atlas", ...(guest ? { hidden: true } : {}) };
  const host = {
    routineSourceOwner: () => guest ? null : ({ bot, group: undefined, threadId: "main" }),
    personAttention: (text: string) => text.includes("[HUMAIN]") ? { kind: "action", items: [{ text: "decide" }] } : undefined,
    routineFullReport: (r: { output: string }) => r.output,
    routineRunReportable: (r: { attention: boolean; postResults: boolean }) => r.attention || r.postResults,
    routineRunNeedsPerson: () => false,
    routineEffectivePostResults: () => false,
    backgroundBriefs: { wakeLevel: (_botId: string, topic: string) => { asked.push(topic); return level; } },
    store: {
      taskByThread: (_botId: string, threadId: string) => guest && threadId === "run" ? { threadId: "run", routineRunId: "run-1" } : null,
      messagesFor: () => rows,
      patchTask: (_botId: string, threadId: string, patch: { unread?: boolean; routineRunId?: string }) => {
        if (patch.unread) unread.push(threadId);
        if ("routineRunId" in patch && patch.routineRunId === undefined) promoted.push(threadId);
      },
      patchGroup: () => {},
      bot: () => bot,
      patchMessage: (_t: string, id: string, patch: Partial<Row>) => { const at = rows.findIndex((row) => row.id === id); rows[at] = { ...rows[at]!, ...patch }; },
      appendMessage: (_t: string, message: Omit<Row, "id">) => { rows.push({ ...message, id: `m${rows.length}` }); },
    },
    routineRunCard: (r: { id: string; proactive?: unknown }) => ({ runId: r.id, ...(r.proactive ? { wakeTopic: "mail" } : {}) }),
    routineRunFallbackText: () => "Hourly pass",
    attentionCard: () => ({ kind: "action", items: [{ text: "decide" }] }),
    attentionTicketUrl: undefined,
    deliverableNotification: (kind: string) => kind,
    notify: (kind: string) => { rang.push(kind); },
  };
  const sync = createSyncRoutineRunToSource(() => host);
  const theRun = { id: "run-1", botId: bot.id, routineName: "Hourly pass", status: "completed", target: "bot", threadId: "run", output: "- [HUMAIN] **100201** : decide.", ...run };
  return { rows, asked, unread, rang, promoted, sync: () => sync(theRun) };
}

describe("syncRoutineRunToSource and the person's feedback (#2694)", () => {
  it("rings and marks unread when nothing was said", () => {
    const w = world("normal");
    w.sync();
    expect(w.rows[0]?.attention).toBeTruthy();
    expect(w.rang).toEqual(["needs-you"]);
    expect(w.unread).toEqual(["main"]);
    expect(w.asked).toEqual(["attention"]);
  });

  it("thumbs-down or less: the card still comes, without ringing or unread", () => {
    const w = world("quiet");
    w.sync();
    expect(w.rows[0]?.attention).toBeTruthy();
    expect(w.rang).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("never: no attention card at all, and a run with nothing else stays out of the chat", () => {
    const w = world("muted");
    w.sync();
    expect(w.rows).toEqual([]);
    expect(w.rang).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("strips the raw NOTHING_TO_REPORT marker from the run's own thread (#3219)", () => {
    const w = world("normal", { output: "Rien de neuf aujourd'hui pour cette routine.\nNOTHING_TO_REPORT" });
    w.rows.push({ id: "bot-final", kind: undefined, role: "bot", text: "Rien de neuf.\n\nNOTHING_TO_REPORT" } as never);
    w.sync();
    expect(w.rows.find((row) => row.id === "bot-final")?.text).toBe("Rien de neuf.");
  });

  it("a proactive wake reads its own kind", () => {
    const w = world("quiet", { proactive: { sources: ["mail"] } });
    w.sync();
    expect(w.asked).toEqual(["mail"]);
    expect(w.rang).toEqual([]);
  });

  it("a Cloud guest's run (no source conversation): its task surfaces unread", () => {
    const w = world("normal", {}, true);
    w.sync();
    expect(w.promoted).toEqual(["run"]);
    expect(w.unread).toEqual(["run"]);
    expect(w.rows).toEqual([]);
  });

  it("a Cloud guest's run after thumbs-down or less: its task surfaces, never unread", () => {
    const w = world("quiet", {}, true);
    w.sync();
    expect(w.promoted).toEqual(["run"]);
    expect(w.unread).toEqual([]);
  });

  it("a Cloud guest's run muted with nothing else: its task stays in Automations", () => {
    const w = world("muted", {}, true);
    w.sync();
    expect(w.promoted).toEqual([]);
    expect(w.unread).toEqual([]);
  });
});

/** #3480: a bot in quiet mode, with the real report rule. */
function quietWorld(run: Record<string, unknown>, quiet = true, needsPerson = false) {
  const rows: Row[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const kept: Array<{ runId: string; problem: boolean }> = [];
  const bot = { id: "bot-atlas", name: "Atlas" };
  const host = {
    routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
    personAttention: (text: string) => text.includes("[HUMAIN]") ? { kind: "action", items: [{ text: "decide" }] } : undefined,
    routineFullReport: (r: { output: string }) => r.output,
    routineRunReportable,
    routineRunNeedsPerson: () => needsPerson,
    // the routine posts its results; quiet mode turns that off (index.ts)
    routineEffectivePostResults: () => !quiet,
    routinePostResultsOwn: () => true,
    botQuietMode: () => quiet,
    keepQuietRun: (_botId: string, runId: string, problem: boolean) => { kept.push({ runId, problem }); },
    backgroundBriefs: { wakeLevel: () => "normal" },
    store: {
      taskByThread: () => null,
      messagesFor: () => rows,
      patchTask: (_botId: string, threadId: string, patch: { unread?: boolean }) => { if (patch.unread) unread.push(threadId); },
      patchGroup: () => {},
      bot: () => bot,
      patchMessage: (_t: string, id: string, patch: Partial<Row>) => { const at = rows.findIndex((row) => row.id === id); rows[at] = { ...rows[at]!, ...patch }; },
      appendMessage: (_t: string, message: Omit<Row, "id">) => { rows.push({ ...message, id: `m${rows.length}` }); return rows.at(-1); },
    },
    routineRunCard: (r: { id: string }) => ({ runId: r.id }),
    routineRunFallbackText: () => "Hourly pass",
    attentionCard: () => ({ kind: "action", items: [{ text: "decide" }] }),
    attentionTicketUrl: undefined,
    deliverableNotification: (kind: string) => kind,
    notify: (kind: string) => { rang.push(kind); },
  };
  const sync = createSyncRoutineRunToSource(() => host);
  const theRun = { id: "run-1", botId: bot.id, routineName: "Hourly pass", status: "completed", target: "bot", threadId: "run", output: "Two new invoices.", ...run };
  return { rows, unread, rang, kept, sync: () => sync(theRun) };
}

describe("syncRoutineRunToSource in quiet mode (#3480)", () => {
  it("a completed run posts nothing, rings nothing, and is counted for the summary", () => {
    const w = quietWorld({});
    w.sync();
    expect(w.rows).toEqual([]);
    expect(w.unread).toEqual([]);
    expect(w.rang).toEqual([]);
    expect(w.kept).toEqual([{ runId: "run-1", problem: false }]);
  });

  it("a run with problems and a failed run post nothing and count as problems", () => {
    for (const run of [{ problems: "one step failed" }, { status: "failed", error: "timeout" }, { status: "blocked" }]) {
      const w = quietWorld(run);
      w.sync();
      expect(w.rows, JSON.stringify(run)).toEqual([]);
      expect(w.unread).toEqual([]);
      expect(w.kept).toEqual([{ runId: "run-1", problem: true }]);
    }
  });

  it("a wake posts nothing", () => {
    const w = quietWorld({ proactive: { hops: 0, sources: ["mail"] } });
    w.sync();
    expect(w.rows).toEqual([]);
    expect(w.rang).toEqual([]);
  });

  it("a question the run waits on still shows its card, silently", () => {
    const w = quietWorld({ status: "waiting" }, true, true);
    w.sync();
    expect(w.rows).toHaveLength(1);
    expect(w.unread).toEqual([]);
    expect(w.rang).toEqual([]);
  });

  it("items only the person can do show their card without ringing", () => {
    const w = quietWorld({ output: "- [HUMAIN] **100201** : decide." });
    w.sync();
    expect(w.rows[0]?.attention).toBeTruthy();
    expect(w.rang).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("a run that works again after problems (#3479) posts nothing, rings nothing", () => {
    const w = quietWorld({ recovered: { afterRuns: 2, since: 1 } });
    w.sync();
    expect(w.rows).toEqual([]);
    expect(w.unread).toEqual([]);
    expect(w.rang).toEqual([]);
    expect(w.kept).toEqual([{ runId: "run-1", problem: false }]);
  });

  it("the same problem again (#3479) leaves the row of the run kept quiet alone", () => {
    const w = quietWorld({ id: "run-2", problems: "one step failed", problemRepeat: { firstRunId: "run-1", since: 1, count: 2 }, finishedAt: 2 });
    // a row for the first run with this problem, posted before quiet mode
    w.rows.push({ id: "m0", kind: "routine.run", text: "Hourly pass: one step failed", routineRun: { runId: "run-1" } });
    w.sync();
    expect(w.rows).toEqual([{ id: "m0", kind: "routine.run", text: "Hourly pass: one step failed", routineRun: { runId: "run-1" } }]);
    expect(w.unread).toEqual([]);
    expect(w.rang).toEqual([]);
    expect(w.kept).toEqual([{ runId: "run-2", problem: true }]);
  });

  it("quiet mode off, a repeat of a problem first kept quiet posts its own card", () => {
    const w = quietWorld({ id: "run-2", problems: "one step failed", problemRepeat: { firstRunId: "run-1", since: 1, count: 2 }, finishedAt: 2 }, false);
    w.sync();
    expect(w.rows.map((row) => row.routineRun?.runId)).toEqual(["run-2"]);
  });

  it("off, the routine's own setting posts and marks unread again", () => {
    const w = quietWorld({}, false);
    w.sync();
    expect(w.rows).toHaveLength(1);
    expect(w.unread).toEqual(["main"]);
    expect(w.kept).toEqual([]);
  });
});
