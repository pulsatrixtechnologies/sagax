// #5152: on an organization server a room shows through its people, so a
// scheduled call's room lists the people its bots are for; a personal
// server keeps an unlisted room.
import { describe, expect, it } from "vitest";

import { createEnsureCalendarCallRoom } from "./ensureCalendarCallRoom.ts";

function world(kind: "perspicax" | "solo") {
  const owners: Record<string, string> = { "bot-op": "pr_operator", "bot-op-2": "pr_operator", "bot-max": "pr_max" };
  const created: Array<{ name: string; memberIds: string[]; humanIds?: string[] }> = [];
  const linked: string[] = [];
  const host: Record<string, any> = {
    IDENTITY: { kind },
    store: {
      bot: (id: string) => (owners[id] ? { id } : undefined),
      group: () => undefined,
      createGroup: (name: string, memberIds: string[], _dm: boolean, _section: undefined, _setup: unknown, humanIds?: string[]) => {
        const group = { id: `room-${created.length}`, name, memberIds, ...(humanIds ? { humanIds } : {}) };
        created.push(group);
        return group;
      },
    },
    effectiveBotOwner: (bot: { id: string }) => owners[bot.id],
    sameCalendarRoster: () => false,
    roomAudienceConflict: () => null,
    calendarCalls: { linkRoom: (_callId: string, roomId: string) => { linked.push(roomId); } },
  };
  return { ensure: createEnsureCalendarCallRoom(() => host), created, linked };
}

const call = (botIds: string[]) => ({ id: "call", name: "Weekly sync", botIds });

describe("ensureCalendarCallRoom", () => {
  it("lists the people its bots are for on an organization server", () => {
    const { ensure, created, linked } = world("perspicax");
    expect(ensure(call(["bot-op", "bot-op-2"])).humanIds).toEqual(["pr_operator"]);
    expect(ensure(call(["bot-op", "bot-max"])).humanIds).toEqual(["pr_operator", "pr_max"]);
    expect(created).toHaveLength(2);
    expect(linked).toEqual(["room-0", "room-1"]);
  });

  it("keeps an unlisted room on a personal server", () => {
    const { ensure } = world("solo");
    expect(ensure(call(["bot-op", "bot-op-2"])).humanIds).toBeUndefined();
  });
});
