// @vitest-environment happy-dom
// 2026-11-01: View run under a routine's report, a run's notification and a
// link to a run's execution thread (an Inbox entry) open the run as an
// exchange sheet over the chat column (same place as Melonie <-> Katarina),
// never a modal. Continue in the conversation stays a footer action.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const drafts = vi.hoisted(() => ({ appended: [] as Array<{ id: string; additions: unknown[] }> }));
vi.mock("@/lib/drafts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/drafts")>(),
  appendDraftAttachments: (id: string, additions: unknown[]) => { drafts.appended.push({ id, additions }); },
}));

import { RoutineRunCard } from "@/components/RoutineRunCard";
import { closeSideThread, currentSideThread } from "@/lib/side-thread";
import { continueRoutineRunInConversation, initialState, openBotThread, openNotificationTarget, openRoutineRun, openThread, reducer, routineRunOfThread, type Action, type Message } from "./store";

const bot = {
  id: "scout",
  name: "Scout",
  threadId: "main-chat",
  tasks: [
    { threadId: "main-chat", createdAt: 1 },
    { threadId: "run-thread", createdAt: 2, routineRunId: "run-1" },
  ],
};
const state = { bots: [bot], groups: [], routineRuns: [{ id: "run-1" }] };

function report(): Message {
  return {
    id: "report",
    role: "bot",
    kind: "routine.run",
    at: 1,
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "Project health watch", status: "completed", executionThreadId: "run-thread", summary: "All green." },
  };
}

describe("opening a routine run", () => {
  it("View run opens the exchange sheet over chat, not a modal or split", () => {
    const actions: Action[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const run = report().routineRun!;
    flushSync(() => root.render(createElement(RoutineRunCard, {
      message: report(),
      onOpen: () => openRoutineRun((action) => actions.push(action), { runId: run.runId, routineId: run.routineId }),
    })));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]');
    expect(button).not.toBeNull();
    button!.click();
    expect(actions).toEqual([{ type: "openRoutineRunSheet", runId: "run-1", routineId: "routine-1" }]);
    const withBot = { ...initialState, bots: [{ ...initialState.bots[0], id: "scout", threadId: "main-chat" } as never], routineRuns: [{ id: "run-1", botId: "scout", routineId: "routine-1" } as never], selectedId: "other" };
    const next = reducer(withBot as typeof initialState, actions[0]!);
    expect(next.activeView).toBe("chat");
    expect(next.routineRunSheet).toEqual({ runId: "run-1", routineId: "routine-1" });
    expect(next.selectedId).toBe("scout");
    root.unmount();
    host.remove();
  });

  it("offers View run for a run whose execution thread is gone (a deleted routine reads)", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const message = report();
    message.routineRun = { ...message.routineRun!, executionThreadId: undefined };
    flushSync(() => root.render(createElement(RoutineRunCard, { message, onOpen: () => {} })));
    expect(host.textContent).toContain("View run");
    root.unmount();
  });

  it("a run's notification opens its exchange sheet, not its report conversation", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "main-chat", routineRunId: "run-1" }, state, false);
    expect(actions).toEqual([{ type: "openRoutineRunSheet", runId: "run-1" }]);
  });

  it("a link to a run's execution thread (an Inbox entry) opens the exchange sheet", () => {
    const actions: Action[] = [];
    expect(routineRunOfThread(state, "run-thread")).toBe("run-1");
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "run-thread" }, state, false);
    expect(actions).toEqual([{ type: "openRoutineRunSheet", runId: "run-1" }]);
  });

  it("a run this client does not know keeps opening its thread", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "main-chat", routineRunId: "run-gone" }, state, false);
    expect(actions.some((action) => action.type === "openRoutineRunSheet" || action.type === "showRoutines")).toBe(false);
  });

  it("the owner's access notification (no thread) still opens the bot's activity", () => {
    const actions: Action[] = [];
    openNotificationTarget((action) => actions.push(action), { botId: "scout", threadId: "", routineRunId: "run-1" }, state, false);
    expect(actions).toEqual([{ type: "openBotActivity", botId: "scout", itemId: "run:run-1" }]);
  });

  it("openThread with threads shown still opens the thread itself", () => {
    const actions: Action[] = [];
    openThread((action) => actions.push(action), { botId: "scout", threadId: "run-thread" }, state, true);
    expect(actions.some((action) => action.type === "showRoutines")).toBe(false);
  });
});

// 2026-10-29 (maintainer: "we are in a unified chat"): Continue in the
// conversation and every link into a run's task stay in the main pane.
describe("continuing a routine run in the conversation", () => {
  const run = { id: "run-1", output: "Draft 1: ...\nDraft 2: ...", resultsThreadId: "main-chat", sourceThreadId: "main-chat" };

  it("opens the bot's conversation, scrolls to the report and quotes it, never a split", () => {
    drafts.appended.length = 0;
    closeSideThread();
    const actions: Action[] = [];
    const opened = continueRoutineRunInConversation((action) => actions.push(action), { ...bot, messages: [report()] }, run, false);
    expect(opened).toBe("main-chat");
    expect(currentSideThread()).toBeNull();
    expect(actions.some((action) => "threadId" in action && action.threadId === "run-thread")).toBe(false);
    expect(actions).toContainEqual({ type: "focusMessage", threadId: "main-chat", messageId: "report" });
    expect(drafts.appended).toHaveLength(1);
    expect(drafts.appended[0]!.id).toBe("bot:scout:main-chat");
    expect(drafts.appended[0]!.additions[0]).toMatchObject({ kind: "citation", quote: "All green.", source: { threadId: "main-chat", messageId: "report" } });
  });

  it("a report the window has not loaded is quoted from the run's record", () => {
    drafts.appended.length = 0;
    const actions: Action[] = [];
    continueRoutineRunInConversation((action) => actions.push(action), bot, run, false);
    expect(drafts.appended[0]!.additions[0]).toMatchObject({ quote: run.output, source: { messageId: "routine-run:run-1" } });
  });

  it("a report in the run's own task (an older version) opens the conversation", () => {
    const actions: Action[] = [];
    expect(continueRoutineRunInConversation((action) => actions.push(action), bot, { ...run, resultsThreadId: "run-thread" }, false)).toBe("main-chat");
    expect(currentSideThread()).toBeNull();
  });

  it("with threads hidden, a link into a run's task opens the exchange sheet, not a column", () => {
    closeSideThread();
    const actions: Action[] = [];
    openBotThread((action) => actions.push(action), bot, "run-thread", false);
    expect(actions).toEqual([{ type: "openRoutineRunSheet", runId: "run-1" }]);
    expect(currentSideThread()).toBeNull();
  });
});
