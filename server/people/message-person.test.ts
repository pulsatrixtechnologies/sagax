import { describe, expect, it } from "vitest";
import { findMessagePersonGroup, isMessagePersonTriad } from "./message-person.ts";

const triad = {
  id: "g1",
  name: "Ada",
  threadId: "t1",
  memberIds: ["bot-scout"],
  humanIds: ["pr_owner", "pr_ada"],
};

describe("message-person triad", () => {
  it("matches owner + person + this bot only", () => {
    expect(isMessagePersonTriad(triad, "pr_owner", "pr_ada", "bot-scout")).toBe(true);
    expect(isMessagePersonTriad(triad, "PR_OWNER", "PR_ADA", "BOT-SCOUT")).toBe(true);
  });

  it("refuses a people DM, a bot DM, an archive, extra people or extra bots", () => {
    expect(isMessagePersonTriad({ ...triad, peopleDm: true }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, dm: true }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, archivedAt: 1 }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, humanIds: ["pr_owner", "pr_ada", "pr_bob"] }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, memberIds: ["bot-scout", "bot-other"] }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, memberIds: ["bot-other"] }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
    expect(isMessagePersonTriad({ ...triad, humanIds: ["pr_owner"] }, "pr_owner", "pr_ada", "bot-scout")).toBe(false);
  });

  it("finds the triad among other rooms", () => {
    const rooms = [
      { ...triad, id: "people", peopleDm: true, memberIds: [] },
      { ...triad, id: "crowd", humanIds: ["pr_owner", "pr_ada", "pr_bob"] },
      triad,
      { ...triad, id: "other-bot", memberIds: ["bot-other"] },
    ];
    expect(findMessagePersonGroup(rooms, "pr_owner", "pr_ada", "bot-scout")?.id).toBe("g1");
    expect(findMessagePersonGroup(rooms, "pr_owner", "pr_bob", "bot-scout")).toBeUndefined();
  });
});
