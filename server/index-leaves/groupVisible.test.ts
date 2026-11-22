// #5152: a bot pair's channel lists no people by design (dm-has-no-humans).
// On an organization server everyone is filtered for themselves, the
// operator at this computer included, so its bots' owner sees it; a
// personal server keeps its answer.
import { describe, expect, it } from "vitest";

import { createGroupVisible } from "./groupVisible.ts";

function visibleOn(kind: "perspicax" | "solo") {
  const owners: Record<string, string> = { "bot-op": "pr_operator", "bot-op-2": "pr_operator", "bot-max": "pr_max" };
  const host: Record<string, any> = {
    IDENTITY: { kind },
    store: { bot: (id: string) => (owners[id] ? { id } : undefined) },
    effectiveBotOwner: (bot: { id: string }) => owners[bot.id],
    isPeopleDmParticipant: () => false,
    authzViewerFromId: (id: string) => ({ principalId: id, orgAdmin: false, teams: [], disabled: false }),
    roomSectionAccess: () => null,
  };
  return createGroupVisible(() => host);
}

const pair = { id: "pair", dm: true, memberIds: ["bot-op", "bot-op-2"] };

describe("groupVisible: a bot pair's channel", () => {
  it("is its bots' owner's on an organization server", () => {
    const visible = visibleOn("perspicax");
    expect(visible(pair, "pr_operator")).toBe(true);
    expect(visible(pair, "pr_max")).toBe(false);
    expect(visible({ ...pair, memberIds: ["bot-op", "bot-max"] }, "pr_operator")).toBe(false);
    expect(visible({ ...pair, memberIds: ["bot-op", "bot-gone"] }, "pr_operator")).toBe(false);
    expect(visible({ ...pair, archivedAt: 1 }, "pr_operator")).toBe(false);
    // a room still shows through its people
    expect(visible({ id: "room", memberIds: ["bot-op"], humanIds: [] }, "pr_operator")).toBe(false);
    expect(visible({ id: "room", memberIds: ["bot-op"], humanIds: ["pr_operator"] }, "pr_operator")).toBe(true);
  });

  it("keeps a personal server's answer", () => {
    const visible = visibleOn("solo");
    expect(visible(pair, "pr_operator")).toBe(false);
    expect(visible(pair, undefined)).toBe(true);
  });
});
