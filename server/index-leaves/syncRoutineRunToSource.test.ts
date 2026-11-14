import { describe, expect, it } from "vitest";

import { routineRunRowOutOfChat } from "../../shared/routine-repeat.ts";
import { isTransientChatNotice } from "../../shared/transient-notices.ts";
import { routineRunReportable } from "../routines/routine-report.ts";
import { createRoutineRunLateRow, createSyncRoutineRunToSource } from "./syncRoutineRunToSource.ts";

type Row = { id: string; kind: string; text?: string; routineRun?: { runId: string; wakeTopic?: string }; attention?: unknown };

/** #2694 review: the attention a finished routine puts on its own card reads
 * the person's feedback (thumbs-down, "less", "never") like a relayed card. */
function world(level: "normal" | "quiet" | "muted", run: Record<string, unknown> = {}, guest = false, extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
  const sync = createSyncRoutineRunToSource(() => host);
  const theRun = { id: "run-1", botId: bot.id, routineName: "Hourly pass", status: "completed", target: "bot", threadId: "run", output: "- [HUMAIN] **100201** : decide.", ...run };
  return { rows, asked, unread, rang, promoted, sync: () => sync(theRun) };
}

describe("#4233 (Q4): a completed run's [HUMAIN] items go to their keyed cards", () => {
  const human = (text: string) => text.includes("[HUMAIN]") ? { kind: "human", items: [{ text: "decide", ticketId: 100201 }, { text: "call back" }] } : undefined;
  function keyed(level: "normal" | "quiet" | "muted", run: Record<string, unknown> = {}, left: (items: unknown[]) => unknown[] | undefined = () => []) {
    const calls: Array<{ threadId: string; items: unknown[] }> = [];
    const w = world(level, run, false, {
      personAttention: human,
      attentionTicketUrl: (_threadId: string, id: number) => `https://tickets.example.com/${id}`,
      personItemCards: (_run: unknown, threadId: string, items: unknown[]) => { calls.push({ threadId, items }); return left(items); },
    });
    return { ...w, calls };
  }

  it("each item is its card in the person's conversation: no list card, no needs-you ring", () => {
    const w = keyed("normal");
    w.sync();
    expect(w.calls).toEqual([{ threadId: "main", items: [{ text: "decide", ticketId: 100201, ticketUrl: "https://tickets.example.com/100201" }, { text: "call back" }] }]);
    expect(w.rows.some((row) => row.attention)).toBe(false);
    expect(w.rang).toEqual([]);
  });

  it("a run that lists no item retires the routine's item cards", () => {
    const w = keyed("normal", { output: "All clear." });
    w.sync();
    expect(w.calls).toEqual([{ threadId: "main", items: [] }]);
  });

  it("an item no card could carry stays on the run's attention card", () => {
    const w = keyed("normal", {}, (items) => items.slice(1));
    w.sync();
    expect(w.rows[0]?.attention).toBeTruthy();
    expect(w.rang).toEqual(["needs-you"]);
  });

  it("less or never keeps what the person's feedback gave", () => {
    const quiet = keyed("quiet");
    quiet.sync();
    expect(quiet.calls).toEqual([]);
    expect(quiet.rows[0]?.attention).toBeTruthy();
    const muted = keyed("muted");
    muted.sync();
    expect(muted.calls).toEqual([]);
  });
});

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

/** #3581: every bot, with the real report rule and no switch. */
function ruleWorld(run: Record<string, unknown>, postResults = true, needsPerson = false) {
  const rows: Row[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const bot = { id: "bot-atlas", name: "Atlas" };
  const host = {
    routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
    personAttention: (text: string) => text.includes("[HUMAIN]") ? { kind: "action", items: [{ text: "decide" }] } : undefined,
    routineFullReport: (r: { output: string }) => r.output,
    routineRunReportable,
    routineRunNeedsPerson: () => needsPerson,
    routineEffectivePostResults: () => postResults,
    // a host that still answered the retired switch is never read (#3480)
    botQuietMode: () => true,
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
    // the card's state and pause, as server/routines/routine-run-card.ts writes them
    routineRunCard: (r: { id: string; status: string; startedBy?: string; autoPaused?: { failures: number } }) => ({
      runId: r.id, status: r.status, ...(r.startedBy === "person" ? { startedBy: "person" } : {}), ...(r.autoPaused ? { autoPausedAfter: r.autoPaused.failures } : {}),
    }),
    routineRunFallbackText: () => "Hourly pass",
    attentionCard: () => ({ kind: "action", items: [{ text: "decide" }] }),
    attentionTicketUrl: undefined,
    deliverableNotification: (kind: string) => kind,
    notify: (kind: string) => { rang.push(kind); },
  };
  const sync = createSyncRoutineRunToSource(() => host);
  const theRun = { id: "run-1", botId: bot.id, routineName: "Hourly pass", status: "completed", target: "bot", threadId: "run", output: "Two new invoices.", ...run };
  return { rows, unread, sync: () => sync(theRun), rang };
}

describe("syncRoutineRunToSource reads one rule for every bot (#3581: quiet mode retired)", () => {
  it("a completed result posts by the routine's own choice and marks the chat unread", () => {
    const posted = ruleWorld({});
    posted.sync();
    expect(posted.rows).toHaveLength(1);
    expect(posted.unread).toEqual(["main"]);
    const kept = ruleWorld({}, false);
    kept.sync();
    expect(kept.rows).toEqual([]);
    expect(kept.unread).toEqual([]);
  });

  it("#3990: a run with problems, a failed run and a blocked run wait for their streak, whatever the routine's choice; one the person started posts", () => {
    for (const run of [{ problems: "one step failed" }, { status: "failed", error: "timeout" }, { status: "blocked" }]) {
      for (const postResults of [true, false]) {
        const w = ruleWorld(run, postResults);
        w.sync();
        expect(w.rows, JSON.stringify(run)).toEqual([]);
        expect(w.unread).toEqual([]);
      }
      const mine = ruleWorld({ ...run, startedBy: "person" }, false);
      mine.sync();
      expect(mine.rows, JSON.stringify(run)).toHaveLength(1);
      expect(mine.unread).toEqual(["main"]);
    }
  });

  // #4058: the summary a failing streak tells is a row the chat draws and
  // keeps, never a passing banner gone at the next run.
  it("#4058: a failed run that tells its streak writes the summary as a row the chat keeps", () => {
    for (const run of [{ status: "failed", error: "timeout" }, { status: "failed", error: "timeout", autoPaused: { failures: 3 } }]) {
      const w = ruleWorld({ ...run, tellsStreak: true, problemRepeat: { firstRunId: "run-0", since: 1, count: 3 } }, false);
      w.sync();
      expect(w.rows, JSON.stringify(run)).toHaveLength(1);
      const row = w.rows[0] as Row & { routineRun: { status: string; repeat?: { streak?: true } } };
      expect(row.routineRun.status).toBe("failed");
      expect(row.routineRun.repeat?.streak).toBe(true);
      expect(routineRunRowOutOfChat(row), JSON.stringify(run)).toBe(false);
      expect(isTransientChatNotice(row), JSON.stringify(run)).toBe(false);
    }
  });

  it("a question the run waits on and items only the person can do post and ring", () => {
    const waiting = ruleWorld({ status: "waiting" }, false, true);
    waiting.sync();
    expect(waiting.rows).toHaveLength(1);
    const items = ruleWorld({ output: "- [HUMAIN] **100201** : decide." }, false);
    items.sync();
    expect(items.rows[0]?.attention).toBeTruthy();
    expect(items.rang).toEqual(["needs-you"]);
  });
});

describe("a run's late answer goes through the run's own card write (#3581)", () => {
  function lateWorld(timeZone: string) {
    const rows = [{
      id: "card", kind: "routine.run", text: "Hourly pass",
      routineRun: { runId: "run-1", wakeTopic: "mail", feedback: "down", repeat: { firstRunId: "run-1", count: 4, since: 1, lastAt: 2 } },
    }];
    const zones: unknown[] = [];
    const languages: unknown[] = [];
    const host = {
      routines: { runForThread: (threadId: string) => threadId === "run" ? { id: "run-1", botId: "bot-atlas", routineName: "Hourly pass", status: "completed", quiet: true, runAs: "person-1" } : undefined },
      store: { messagesFor: () => rows },
      // a routine that posts its results (the one row gate, #4051)
      routineEffectivePostResults: () => true,
      routineRunNeedsPerson: () => false,
      personAttention: () => undefined,
      routineRunReportable,
      isPrincipalId: () => true,
      botSettings: { person: () => ({ timeZone }) },
      routineTimeZone: () => "UTC",
      languageOfPerson: () => "fr",
      routineRunCard: (r: { id: string; quiet?: boolean }, _target: string, report: string) => ({ runId: r.id, summary: report, quiet: r.quiet }),
      routineRunFallbackText: (_card: unknown, language: unknown, zone: unknown) => { languages.push(language); zones.push(zone); return "Hourly pass"; },
    };
    return { late: createRoutineRunLateRow(() => host), zones, languages };
  }

  it("keeps the person's feedback and the lasting-problem count, and gives times in the person's zone", () => {
    const w = lateWorld("America/Toronto");
    const card = w.late("run", "main", "The teammate answered: done.");
    expect(card?.routineRun).toMatchObject({ runId: "run-1", summary: "The teammate answered: done.", feedback: "down", repeat: { count: 4, firstRunId: "run-1" } });
    expect(card?.routineRun.quiet).toBeUndefined();
    expect(w.zones).toEqual(["America/Toronto"]);
    expect(w.languages).toEqual(["en"]);
  });

  it("#3990, #4051: a late answer that ends with the nothing-to-report line gives no row: the gate reads it quiet", () => {
    expect(lateWorld("UTC").late("run", "main", "Rien à remonter.\nNOTHING_TO_REPORT")).toBeUndefined();
  });

  it("a thread with no run gives no card", () => {
    expect(lateWorld("UTC").late("other", "main", "words")).toBeUndefined();
  });
});
