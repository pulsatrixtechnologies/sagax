// The order of bots inside a sidebar team (#5024).
import { describe, expect, it } from "vitest";

import { orderedBots, parseSectionBotOrder, placeBotInSection } from "./section-bot-order";

const bots = (ids: string[]) => ids.map((id) => ({ id }));

describe("section bot order", () => {
  it("keeps the current order until one is saved", () => {
    expect(orderedBots(bots(["a", "b", "c"]), undefined).map((bot) => bot.id)).toEqual(["a", "b", "c"]);
    expect(parseSectionBotOrder("not json")).toEqual({});
  });

  it("places a bot before another, and at the end when there is no anchor", () => {
    const placed = placeBotInSection({ Ops: ["a", "b", "c"] }, "Ops", "c", "a");
    expect(placed.Ops).toEqual(["c", "a", "b"]);
    expect(placeBotInSection(placed, "Ops", "a", null).Ops).toEqual(["c", "b", "a"]);
  });

  it("draws the saved order and leaves unknown bots after it", () => {
    expect(orderedBots(bots(["a", "b", "c"]), ["c", "a"]).map((bot) => bot.id)).toEqual(["c", "a", "b"]);
  });

  it("lands between the bots on screen the first time one is dragged", () => {
    expect(placeBotInSection({}, "Ops", "c", "b", ["a", "b", "c"]).Ops).toEqual(["a", "c", "b"]);
  });

  it("moves a bot out of its previous team when it is filed in another", () => {
    const next = placeBotInSection({ Ops: ["a", "b"], Desk: ["c"] }, "Desk", "b", "c");
    expect(next.Ops).toEqual(["a"]);
    expect(next.Desk).toEqual(["b", "c"]);
  });
});
