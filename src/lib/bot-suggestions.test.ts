import { describe, expect, it } from "vitest";
import { botSuggestions } from "./bot-suggestions";

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
});
