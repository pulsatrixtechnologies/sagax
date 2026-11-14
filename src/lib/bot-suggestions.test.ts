import { describe, expect, it } from "vitest";
import { botSuggestions, serverCards } from "./bot-suggestions";

describe("botSuggestions", () => {
  it("is empty with nothing to suggest", () => {
    expect(botSuggestions({})).toEqual([]);
    expect(botSuggestions({ setup: [{ id: "soul", label: "x", done: true }] })).toEqual([]);
  });

  it("puts what waits on the person before setup steps", () => {
    const items = botSuggestions({
      setup: [{ id: "soul", label: "x", done: false, section: "soul" }],
      tasks: [{ threadId: "t1", title: "Invoices", activity: "waiting-on-you" }, { threadId: "t2", activity: "working" }],
      waitingApprovals: [{ threadId: "t3", openedByName: "Scout" }, { threadId: "t1" }],
    });
    expect(items.map((item) => item.id)).toEqual(["approval:t1", "approval:t3", "setup:soul"]);
    expect(items[0]).toMatchObject({ subtitleKey: "botPanel.suggestions.approval.inThread", vars: { title: "Invoices" }, action: { kind: "openThread", threadId: "t1" } });
    expect(items[1]).toMatchObject({ subtitleKey: "botPanel.suggestions.approval.fromBot", vars: { name: "Scout" } });
    expect(items[2]).toMatchObject({ titleKey: "botPanel.suggestions.setup.soul.title", action: { kind: "openSection", section: "soul" } });
  });

  it("skips hidden conversations and unknown steps, and caps the list", () => {
    const items = botSuggestions({
      tasks: [{ threadId: "h", activity: "waiting-on-you", hidden: true }],
      setup: [
        { id: "identity", label: "", done: false },
        { id: "soul", label: "", done: false },
        { id: "folder", label: "", done: false },
        { id: "apps", label: "", done: false },
        { id: "schedule", label: "", done: false },
        { id: "nope" as never, label: "", done: false },
      ],
    });
    expect(items).toHaveLength(4);
    expect(items.some((item) => item.id === "approval:h")).toBe(false);
    expect(items[0]!.action).toEqual({ kind: "openSection", section: "overview" });
  });

  // #4250 (S6): what a routine needs and the server's open fix cards come
  // before the setup steps, each said once; a saving the server proposed
  // follows what waits on the person.
  it("puts the open fix cards and what routines need before what waits and the setup", () => {
    const items = botSuggestions({
      setup: [{ id: "soul", label: "x", done: false }],
      tasks: [
        { threadId: "main", activity: "waiting-on-you" },
        { threadId: "run-a", activity: "waiting-on-you", routineRunId: "ra" },
        { threadId: "t9", title: "Invoices", activity: "waiting-on-you" },
      ],
      routines: [
        { id: "r1", name: "Board sweep", needsPerson: { kind: "problem", text: "", since: 1 } },
        { id: "r2", name: "Inbox", needsPerson: { kind: "question", text: "Which folder?", runId: "ra", since: 2 } },
        { id: "r3", name: "Quiet one", needsPerson: null },
      ],
      cards: [
        { id: "q1", threadId: "main", title: "Board sweep needs a fix", key: "routine-problem:r1" },
        { id: "q2", threadId: "main", title: "Board sweep could run without waking its bot", key: "routine-cheap-path:r1" },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["fix:routine-problem:r1", "needs:r2", "approval:t9", "saving:routine-cheap-path:r1"]);
    expect(items[0]).toMatchObject({ title: "Board sweep needs a fix", subtitleKey: "botPanel.suggestions.fix.subtitle", action: { kind: "openThread", threadId: "main" } });
    expect(items[1]).toMatchObject({ titleKey: "botPanel.suggestions.needs.title", vars: { routine: "Inbox" }, need: { kind: "question" }, action: { kind: "openRun", runId: "ra" } });
    expect(items[3]).toMatchObject({ subtitleKey: "botPanel.suggestions.saving.subtitle" });
  });

  it("opens a routine whose need has no run, and before the setup steps", () => {
    const items = botSuggestions({
      setup: [{ id: "soul", label: "x", done: false }],
      routines: [{ id: "r1", name: "Board sweep", needsPerson: { kind: "paused", text: "", since: 1, failures: 3 } }],
    });
    expect(items.map((item) => item.id)).toEqual(["needs:r1", "setup:soul"]);
    expect(items[0]!.action).toEqual({ kind: "openRoutine", routineId: "r1" });
  });

  it("reads the server's own cards from the waiting list by their key", () => {
    const cards = serverCards([
      { id: "a", threadId: "t", title: "Desk needs a fix", message: { card: { askKey: "product:desk" } } },
      { id: "b", threadId: "t", title: "A bot question", message: { card: { askKey: "invoice-12" } } },
      { id: "c", threadId: "t", title: "Line", message: { card: { askKey: "voice-line" } } },
      { id: "d", threadId: "t", title: "No message" },
    ]);
    expect(cards).toEqual([
      { id: "a", threadId: "t", title: "Desk needs a fix", key: "product:desk" },
      { id: "c", threadId: "t", title: "Line", key: "voice-line" },
    ]);
  });
});
