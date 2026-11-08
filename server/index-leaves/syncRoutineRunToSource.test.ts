import { describe, expect, it } from "vitest";

import { createSyncRoutineRunToSource } from "./syncRoutineRunToSource.ts";

type Row = { id: string; kind: string; routineRun?: { runId: string; wakeTopic?: string }; attention?: unknown };

/** #2694 review: the attention a finished routine puts on its own card reads
 * the person's feedback (thumbs-down, "less", "never") like a relayed card. */
function world(level: "normal" | "quiet" | "muted", run: Record<string, unknown> = {}) {
  const rows: Row[] = [];
  const asked: string[] = [];
  const unread: string[] = [];
  const rang: string[] = [];
  const bot = { id: "bot-atlas", name: "Atlas" };
  const host = {
    routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
    personAttention: (text: string) => text.includes("[HUMAIN]") ? { kind: "action", items: [{ text: "decide" }] } : undefined,
    routineFullReport: (r: { output: string }) => r.output,
    routineRunReportable: (r: { attention: boolean; postResults: boolean }) => r.attention || r.postResults,
    routineRunNeedsPerson: () => false,
    routineEffectivePostResults: () => false,
    backgroundBriefs: { wakeLevel: (_botId: string, topic: string) => { asked.push(topic); return level; } },
    store: {
      taskByThread: () => null,
      messagesFor: () => rows,
      patchTask: (_botId: string, threadId: string, patch: { unread?: boolean }) => { if (patch.unread) unread.push(threadId); },
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
  return { rows, asked, unread, rang, sync: () => sync(theRun) };
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

  it("a proactive wake reads its own kind", () => {
    const w = world("quiet", { proactive: { sources: ["mail"] } });
    w.sync();
    expect(w.asked).toEqual(["mail"]);
    expect(w.rang).toEqual([]);
  });
});
