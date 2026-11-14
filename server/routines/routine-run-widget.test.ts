// #4234: the widget a routine run drew for the person (its drafts as a form
// with checkboxes and Send / Skip) sat in the run's hidden task: the chat
// showed only the run's last sentence, which pointed at a form that was not
// there. The run's row now names the widget, moved into the conversation it
// reports to, where the row draws it and a press answers the bot.
import { describe, expect, it } from "vitest";

import type { WireMessage as Message } from "../../shared/wire.ts";
import { createSyncRoutineRunToSource } from "../index-leaves/syncRoutineRunToSource.ts";
import { routineRunWidget, settleRoutineForm, type RoutineWidgetStore } from "./routine-run-widget.ts";

const DRAFTS = { v: 1 as const, root: { type: "Card", id: "n0", children: [{ type: "Checkbox", id: "n1", name: "draft-1", label: "Reply to the supplier", defaultChecked: true }], confirm: { label: "Send", action: { type: "send" } }, cancel: { label: "Skip", action: { type: "skip" } } } } as unknown as NonNullable<Message["widget"]>;

function threads() {
  const byThread = new Map<string, Message[]>();
  let next = 0;
  const store: RoutineWidgetStore & { patchMessage(threadId: string, id: string, patch: Partial<Message>): void } = {
    messagesFor: (threadId) => byThread.get(threadId) ?? [],
    appendMessage: (threadId, message) => {
      const row = { ...message, id: `m${++next}`, at: next } as Message;
      byThread.set(threadId, [...(byThread.get(threadId) ?? []), row]);
      return row;
    },
    removeMessage: (threadId, messageId) => {
      const rows = byThread.get(threadId) ?? [];
      byThread.set(threadId, rows.filter((row) => row.id !== messageId));
      return rows.some((row) => row.id === messageId);
    },
    patchMessage: (threadId, id, patch) => {
      byThread.set(threadId, (byThread.get(threadId) ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)));
    },
  };
  return { store, byThread };
}

describe("routineRunWidget (#4234)", () => {
  it("moves the run's open widget from its hidden task into the conversation, once", () => {
    const { store, byThread } = threads();
    store.appendMessage("run", { role: "bot", kind: "text", text: "Working on tonight's drafts." });
    const drawn = store.appendMessage("run", { role: "bot", kind: "widget", text: "Tonight's drafts", widget: { ...DRAFTS, rev: 2 } })!;
    const id = routineRunWidget(store, { runThreadId: "run", conversationId: "main" });
    const moved = byThread.get("main")!.find((row) => row.id === id)!;
    expect(moved.kind).toBe("widget");
    expect(moved.widget?.root).toEqual(DRAFTS.root);
    // a new row starts at revision 0: its node ids are its own
    expect(moved.widget?.rev).toBeUndefined();
    // one copy: the hidden task keeps no second one
    expect(byThread.get("run")!.some((row) => row.id === drawn.id)).toBe(false);
    // a later sync of the same run keeps the same row
    expect(routineRunWidget(store, { runThreadId: "run", conversationId: "main", keptId: id })).toBe(id);
    expect(byThread.get("main")!.filter((row) => row.kind === "widget")).toHaveLength(1);
  });

  it("leaves an answered widget, a run with none, and a run that worked in the conversation itself", () => {
    const { store, byThread } = threads();
    store.appendMessage("run", { role: "bot", kind: "widget", text: "Old", widget: { ...DRAFTS, settled: { ref: "confirm", label: "Send", tone: "primary", at: 1 } } as never });
    expect(routineRunWidget(store, { runThreadId: "run", conversationId: "main" })).toBeUndefined();
    expect(routineRunWidget(store, { runThreadId: "empty", conversationId: "main" })).toBeUndefined();
    store.appendMessage("main", { role: "bot", kind: "widget", text: "Here", widget: DRAFTS });
    expect(routineRunWidget(store, { runThreadId: "main", conversationId: "main" })).toBeUndefined();
    expect(byThread.get("main")).toHaveLength(1);
  });
});

describe("syncRoutineRunToSource names the run's widget on its row (#4234)", () => {
  function world(run: Record<string, unknown>) {
    const { store, byThread } = threads();
    const noted: Array<{ runId: string; threadId: string; widgetId: string }> = [];
    const bot = { id: "bot-atlas", name: "Atlas" };
    const host = {
      routineSourceOwner: () => ({ bot, group: undefined, threadId: "main" }),
      personAttention: () => undefined,
      routineFullReport: (r: { output: string }) => r.output,
      routineRunReportable: (r: { postResults: boolean }) => r.postResults,
      routineRunNeedsPerson: () => false,
      routineEffectivePostResults: () => true,
      store: { ...store, taskByThread: () => null, patchTask: () => {}, patchGroup: () => {}, bot: () => bot },
      routineRunCard: (r: { id: string; output?: string }) => ({ runId: r.id, routineId: "routine-1", routineName: "Evening drafts", status: "completed", summary: r.output }),
      routineRunFallbackText: () => "Evening drafts",
      attentionCard: () => undefined,
      deliverableNotification: (kind: string) => kind,
      notify: () => {},
      routines: { noteRunForm: (runId: string, form: { threadId: string; widgetId: string }) => { noted.push({ runId, ...form }); } },
    };
    const sync = createSyncRoutineRunToSource(() => host);
    const theRun = { id: "run-1", botId: bot.id, routineName: "Evening drafts", status: "completed", target: "bot", threadId: "run", output: "I drafted 1 reply.", ...run };
    return { store, byThread, noted, sync: () => sync(theRun) };
  }

  it("a completed run that drew a form: its row names the form, moved beside it in the conversation", () => {
    const w = world({});
    w.store.appendMessage("run", { role: "bot", kind: "widget", text: "Tonight's drafts", widget: DRAFTS });
    w.sync();
    const rows = w.byThread.get("main")!;
    const row = rows.find((message) => message.kind === "routine.run")!;
    const widget = rows.find((message) => message.kind === "widget")!;
    expect(row.routineRun?.widgetId).toBe(widget.id);
    expect(w.byThread.get("run")!.some((message) => message.kind === "widget")).toBe(false);
    // the run keeps where its form waits on the person (Today, the pinned row)
    expect(w.noted.at(-1)).toEqual({ runId: "run-1", threadId: "main", widgetId: widget.id });
    // synced again (marked seen, a late answer): the same row, the same widget
    w.sync();
    const again = w.byThread.get("main")!;
    expect(again.filter((message) => message.kind === "widget")).toHaveLength(1);
    expect(again.find((message) => message.kind === "routine.run")!.routineRun?.widgetId).toBe(widget.id);
  });

  it("a run that is still working keeps its widget in its task until it ends", () => {
    const w = world({ status: "running" });
    w.store.appendMessage("run", { role: "bot", kind: "widget", text: "Tonight's drafts", widget: DRAFTS });
    w.sync();
    expect((w.byThread.get("main") ?? []).some((message) => message.kind === "widget")).toBe(false);
  });
});

describe("settleRoutineForm (#4234)", () => {
  it("draws a form answered away from its row as answered, once", () => {
    const patched: Array<[string, unknown]> = [];
    const patch = (id: string, widget: unknown) => { patched.push([id, widget]); };
    const form = { id: "w1", kind: "widget" as const, widget: DRAFTS };
    expect(settleRoutineForm(patch, form, { label: "Send the first one", skipped: false, at: 9 })).toBe(true);
    expect(patched[0]).toEqual(["w1", { ...DRAFTS, settled: { ref: "", label: "Send the first one", tone: "submit", at: 9 } }]);
    expect(settleRoutineForm(patch, { ...form, widget: { ...DRAFTS, settled: { ref: "", label: "x", tone: "submit", at: 1 } } }, { label: "Skipped", skipped: true, at: 9 })).toBe(false);
    expect(settleRoutineForm(patch, { id: "t", kind: "text" }, { label: "Skipped", skipped: true, at: 9 })).toBe(false);
  });
});
