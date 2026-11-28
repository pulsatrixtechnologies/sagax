// The bot view a page receives (shared/page-bot.ts): only the fields the
// page is allowed to show.
import { describe, expect, it } from "vitest";

import { pageBotView, type PageBotViewInput } from "./page-bot.ts";

const SECRET = "sk-live-do-not-leak";

describe("pageBotView", () => {
  it("builds the view from the bot, its routines and the last run of each", () => {
    const view = pageBotView({
      name: "  Nimbus  ",
      approvalMode: "auto",
      activity: "working",
      routines: [
        { id: "late", name: "Zebra", enabled: false },
        { id: "am", name: "Morning", enabled: true },
        { id: "am", name: "Duplicate", enabled: true },
      ],
      runs: [
        { routineId: "am", status: "completed", at: 10, happened: true },
        { routineId: "am", status: "failed", at: 40, happened: true },
        { routineId: "am", status: "queued", at: 9_000, happened: false },
        { routineId: "gone", status: "completed", at: 99, happened: true },
        { routineId: "late", status: "queued", at: 80, happened: false },
      ],
    });
    expect(view).toEqual({
      name: "Nimbus",
      approvalMode: "auto",
      activity: "working",
      routines: [
        { id: "am", name: "Morning", enabled: true, lastRun: { status: "failed", at: 40 } },
        { id: "late", name: "Zebra", enabled: false, lastRun: { status: "queued", at: 80 } },
      ],
    });
  });

  it("fails a bad level or activity closed, and drops a run whose status is not a status word", () => {
    expect(pageBotView({ name: "Nimbus", approvalMode: "yolo", activity: "on-fire" })).toEqual({
      name: "Nimbus",
      approvalMode: "ask",
      activity: "idle",
      routines: [],
    });
    expect(pageBotView({
      name: "Nimbus",
      approvalMode: "full",
      activity: "idle",
      routines: [{ id: "am", name: "Morning", enabled: true }],
      runs: [{ routineId: "am", status: "not a status", at: 1, happened: true }],
    }).routines).toEqual([{ id: "am", name: "Morning", enabled: true }]);
  });

  it("drops secrets, a working directory, an allow list and another person's id", () => {
    const input = {
      name: "Nimbus",
      approvalMode: "edits",
      activity: "waiting-on-you",
      cwd: "/home/secret",
      token: SECRET,
      alwaysAllow: ["Bash"],
      ownerId: "person-a",
      routines: [{ id: "am", name: "Morning", enabled: true, prompt: SECRET, ownerId: "person-b" }],
      runs: [{ routineId: "am", status: "completed", at: 5, happened: true, output: SECRET, error: SECRET }],
    };
    const view = pageBotView(input as PageBotViewInput);
    const text = JSON.stringify(view);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("person-");
    expect(text).not.toContain("cwd");
    expect(text).not.toContain("Bash");
    expect(text).not.toContain("prompt");
    expect(view).toEqual({
      name: "Nimbus",
      approvalMode: "edits",
      activity: "waiting-on-you",
      routines: [{ id: "am", name: "Morning", enabled: true, lastRun: { status: "completed", at: 5 } }],
    });
  });
});
