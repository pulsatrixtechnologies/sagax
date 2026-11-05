import { describe, expect, it } from "vitest";

import { workingBots, type WorkingBotHold, type WorkingBotsSource } from "./computer-working-bots.ts";

function source(holders: WorkingBotHold[], names: Record<string, string | null>): WorkingBotsSource {
  return { holders: () => holders, botName: (id) => (id in names ? names[id] : null) };
}

describe("working bots on the computer (Settings > Computer)", () => {
  it("is empty when nothing holds the computer", () => {
    expect(workingBots(source([], {}))).toEqual([]);
  });

  it("resolves a human name and keeps the id and thread for the stop call", () => {
    const list = workingBots(source([{ botId: "b1", threadId: "t1" }], { b1: "Osprey" }));
    expect(list).toEqual([{ id: "b1", name: "Osprey", threadId: "t1" }]);
  });

  it("lists several working bots in the source's order", () => {
    const list = workingBots(source(
      [{ botId: "b1", threadId: "t1" }, { botId: "b2", threadId: "t2" }],
      { b1: "Osprey", b2: "Ember" },
    ));
    expect(list.map((b) => b.name)).toEqual(["Osprey", "Ember"]);
  });

  it("drops a holder whose bot is gone (no name)", () => {
    const list = workingBots(source(
      [{ botId: "ghost", threadId: "t1" }, { botId: "b2", threadId: "t2" }],
      { b2: "Ember" },
    ));
    expect(list).toEqual([{ id: "b2", name: "Ember", threadId: "t2" }]);
  });

  it("deduplicates the same bot and thread reported twice (lease and active thread)", () => {
    const list = workingBots(source(
      [{ botId: "b1", threadId: "t1" }, { botId: "b1", threadId: "t1" }],
      { b1: "Osprey" },
    ));
    expect(list).toEqual([{ id: "b1", name: "Osprey", threadId: "t1" }]);
  });

  it("keeps the same bot twice when it works on two threads", () => {
    const list = workingBots(source(
      [{ botId: "b1", threadId: "t1" }, { botId: "b1", threadId: "t2" }],
      { b1: "Osprey" },
    ));
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.threadId)).toEqual(["t1", "t2"]);
  });
});
