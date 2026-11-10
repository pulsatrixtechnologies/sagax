import { afterEach, describe, expect, it } from "vitest";
import { setSameOwner, type RosterMember } from "../peers/peer-roster.ts";
import { roomResponders } from "../store.ts";
import { chainedMentionResponders } from "./room-mention-chain.ts";

type Member = RosterMember & { owner: string };

const speaker: Member = { id: "bot-a1", name: "Planner", owner: "person-a" };
const ownTeammate: Member = { id: "bot-a2", name: "Writer", owner: "person-a" };
const otherPersons: Member = { id: "bot-b1", name: "Reviewer", owner: "person-b" };

describe("chained @mentions in a room holding bots of two people (#3263)", () => {
  afterEach(() => setSameOwner(null));

  it("starts the turn of the speaker's own bot and never one of another person's bot", () => {
    setSameOwner((a, b) => (a as Member).owner === (b as Member).owner);
    const members = [ownTeammate, otherPersons];
    const summoned = chainedMentionResponders("@Writer and @Reviewer, over to you", members, speaker, roomResponders);
    expect(summoned.map((bot) => bot.id)).toEqual([ownTeammate.id]);
  });

  it("keeps another person's bot out of an @everyone written by a bot", () => {
    setSameOwner((a, b) => (a as Member).owner === (b as Member).owner);
    const summoned = chainedMentionResponders("@everyone please weigh in", [ownTeammate, otherPersons], speaker, roomResponders);
    expect(summoned.map((bot) => bot.id)).toEqual([ownTeammate.id]);
  });

  it("follows every mention on a server of one person", () => {
    const summoned = chainedMentionResponders("@Writer and @Reviewer", [ownTeammate, otherPersons], speaker, roomResponders);
    expect(summoned.map((bot) => bot.id).sort()).toEqual([otherPersons.id, ownTeammate.id].sort());
  });
});
