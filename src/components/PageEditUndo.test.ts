// Undo of the bot's edit of a selected passage: what undoing it takes, and
// which newer versions the page still draws.
import { describe, expect, it } from "vitest";

import { followedVersion, undoEditPlan } from "./PageEditUndo";

const versions = (...entries: Array<[number, "proposed" | "published" | "declined"]>) => entries.map(([n, state]) => ({ n, kind: "markdown" as const, title: "t", createdAt: n, state, bytes: 1, botId: "b" }));

describe("undoEditPlan", () => {
  it("publishes the version asked about again when the bot's version is the published one", () => {
    expect(undoEditPlan({ status: "published", currentVersion: 2, versions: versions([1, "proposed"], [2, "published"]) }, { from: 1, to: 2 })).toEqual({ republish: true, decline: false });
  });

  it("declines the bot's version when it is a proposal", () => {
    expect(undoEditPlan({ status: "published", currentVersion: 1, versions: versions([1, "published"], [2, "proposed"]) }, { from: 1, to: 2 })).toEqual({ republish: false, decline: true });
    expect(undoEditPlan({ status: "draft", currentVersion: null, versions: versions([1, "proposed"], [2, "proposed"]) }, { from: 1, to: 2 })).toEqual({ republish: false, decline: true });
  });

  it("does nothing more when the version was already decided", () => {
    expect(undoEditPlan({ status: "draft", currentVersion: null, versions: versions([1, "proposed"], [2, "declined"]) }, { from: 1, to: 2 })).toEqual({ republish: false, decline: false });
  });
});

describe("followedVersion", () => {
  it("draws a newer version unless the person sent it back", () => {
    expect(followedVersion(null, 0)).toBeNull();
    expect(followedVersion(2, 0)).toBe(2);
    expect(followedVersion(2, 2)).toBeNull();
    expect(followedVersion(3, 2)).toBe(3);
  });
});
