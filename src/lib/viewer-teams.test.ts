import { describe, expect, it } from "vitest";

import { viewerOwnBots, viewerOwnTeamNames } from "./viewer-teams";

describe("viewerOwnTeamNames (#2045)", () => {
  const alice = "pr_alice";
  const bob = "pr_bob";
  const bots = [
    { id: "a1", section: "Equipe A", ownerUserId: alice },
    { id: "b1", section: "Equipe B", ownerUserId: bob },
    { id: "shared", section: "Equipe A", ownerUserId: alice, hidden: false },
    { id: "mine-unfiled", ownerUserId: bob },
    { id: "hidden", section: "Secret", ownerUserId: bob, hidden: true },
  ];

  it("on an organization server, never surfaces another person's team from a shared bot", () => {
    expect(viewerOwnTeamNames({
      orgMode: true,
      viewerId: bob,
      personalNames: ["Mine"],
      serverSections: ["Equipe A", "Equipe B"],
      bots,
      groups: [{ section: "Alice Room" }],
    })).toEqual(["Mine", "Equipe B"]);
    expect(viewerOwnTeamNames({
      orgMode: true,
      viewerId: bob,
      personalNames: ["Mine"],
      serverSections: ["Equipe A", "Equipe B"],
      bots: bots.filter((bot) => bot.id !== "b1"),
      groups: [{ section: "Alice Room" }],
    })).toEqual(["Mine"]);
  });

  it("still offers an own bot's server section when personal folders omit it", () => {
    expect(viewerOwnTeamNames({
      orgMode: true,
      viewerId: bob,
      personalNames: ["Mine"],
      bots: [...bots, { id: "b2", section: "Equipe B", ownerUserId: bob }],
    })).toEqual(["Mine", "Equipe B"]);
  });

  it("on a solo server, keeps every visible section from bots and groups", () => {
    expect(viewerOwnTeamNames({
      orgMode: false,
      viewerId: bob,
      serverSections: ["Ops"],
      bots,
      groups: [{ section: "Ops" }, { section: "Lab" }],
    })).toEqual(["Ops", "Equipe A", "Equipe B", "Lab"]);
  });
});

describe("viewerOwnBots (#2045)", () => {
  it("keeps the viewer's bots and drops another person's", () => {
    const bots = [
      { id: "mine", ownerUserId: "pr_bob" },
      { id: "theirs", ownerUserId: "pr_alice", section: "Equipe A" },
      { id: "legacy" },
      { id: "gone", ownerUserId: "pr_bob", hidden: true },
    ];
    expect(viewerOwnBots(bots, "pr_bob").map((bot) => bot.id)).toEqual(["mine", "legacy"]);
  });
});
