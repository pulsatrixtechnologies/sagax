// A person tagged with @ in a room is notified like a direct message
// (server/rooms/room-mentions.ts).
import { describe, expect, it } from "vitest";

import { roomMentionNotification, roomMentionReadPatch } from "./room-mentions.ts";

const room = { id: "g1", name: "Ops", humanIds: ["pr_alice", "pr_bob", "pr_carol"] };
const people = [
  { id: "pr_alice", names: ["Alice"] },
  { id: "pr_bob", names: ["Bob Tremblay", "bob"] },
  { id: "pr_carol", names: ["Carol"] },
];
const send = (text: string, extra: Partial<typeof room & { mentionAll: boolean; peopleDm: boolean; dm: boolean }> = {}) =>
  roomMentionNotification({ room: { ...room, ...extra }, threadId: "t1", text, sender: { principalId: "pr_alice", name: "Alice" }, people });

describe("room mentions", () => {
  it("a room with three people, one tagged: only that person is the audience", () => {
    expect(send("@Bob Tremblay can you look at the deploy?")).toEqual({
      kind: "message", botId: "", botName: "Alice", threadId: "t1", groupId: "g1",
      title: "Alice in Ops", body: "@Bob Tremblay can you look at the deploy?", audience: ["pr_bob"],
    });
    expect(send("ping @bob")?.audience).toEqual(["pr_bob"]);
  });

  it("a message that tags nobody keeps the room's rules: no notification", () => {
    expect(send("the deploy is done")).toBeNull();
    expect(send("write to bob@example.test")).toBeNull();
    // the sender tagging themselves
    expect(send("@Alice note to self")).toBeNull();
  });

  it("@all reaches every other person only when the room allows it", () => {
    expect(send("@all standup")).toBeNull();
    expect(send("@all standup", { mentionAll: true })?.audience).toEqual(["pr_bob", "pr_carol"]);
  });

  it("only the room's people, and never a conversation between two people", () => {
    expect(roomMentionNotification({ room, threadId: "t1", text: "@Dave hi", sender: { principalId: "pr_alice", name: "Alice" }, people: [...people, { id: "pr_dave", names: ["Dave"] }] })).toBeNull();
    expect(send("@Carol hi", { peopleDm: true })).toBeNull();
    expect(send("@Carol hi", { dm: true })).toBeNull();
  });

  it("reading the room reads that person's tag only", () => {
    expect(roomMentionReadPatch({ unreadFor: ["pr_bob", "pr_carol"] }, "PR_BOB")).toEqual({ unreadFor: ["pr_carol"] });
    expect(roomMentionReadPatch({ unreadFor: ["pr_bob"] }, "pr_bob")).toEqual({ unreadFor: undefined });
    expect(roomMentionReadPatch({ unreadFor: ["pr_bob"] }, "pr_carol")).toEqual({});
    expect(roomMentionReadPatch({ peopleDm: true, unreadFor: ["pr_bob"] }, "pr_bob")).toEqual({});
  });
});
