// Stored outcome records (#4098): name rules, load, and order.
import { describe, expect, it } from "vitest";

import {
  cleanOutcomeId,
  cleanOutcomeName,
  cleanOutcomeNote,
  loadOutcomeRecords,
  orderedOutcomeRecords,
  OUTCOME_NAME_MAX,
  OUTCOMES_PER_BOT,
} from "./outcome-records.ts";

describe("cleanOutcomeName / note / id", () => {
  it("trims, collapses spaces and drops control characters", () => {
    expect(cleanOutcomeName("  Inbox\n at  zero  ")).toBe("Inbox at zero");
    expect(cleanOutcomeNote("a".repeat(OUTCOME_NAME_MAX + 50))?.length).toBeLessThanOrEqual(400);
    expect(cleanOutcomeName("   ")).toBeUndefined();
    expect(cleanOutcomeId(" o1 ")).toBe("o1");
    expect(cleanOutcomeId("")).toBeUndefined();
    expect(cleanOutcomeId("x".repeat(65))).toBeUndefined();
  });
});

describe("loadOutcomeRecords", () => {
  it("keeps readable rows per bot and drops the rest", () => {
    const loaded = loadOutcomeRecords({
      "bot-a": [
        { id: "o1", name: "Inbox at zero", createdAt: 1, updatedAt: 2, note: "daily" },
        { id: "o1", name: "dup", createdAt: 1, updatedAt: 1 },
        { id: "bad", name: "", createdAt: 1, updatedAt: 1 },
        null,
        { id: "o2", name: "Board current", createdAt: 3, updatedAt: 4 },
      ],
      "bot-b": "nope",
    });
    expect(loaded.get("bot-a")).toEqual([
      { id: "o1", name: "Inbox at zero", note: "daily", createdAt: 1, updatedAt: 2 },
      { id: "o2", name: "Board current", createdAt: 3, updatedAt: 4 },
    ]);
    expect(loaded.has("bot-b")).toBe(false);
  });

  it("caps at OUTCOMES_PER_BOT", () => {
    const rows = Array.from({ length: OUTCOMES_PER_BOT + 5 }, (_, index) => ({
      id: `o${index}`, name: `N${index}`, createdAt: index, updatedAt: index,
    }));
    expect(loadOutcomeRecords({ "bot-a": rows }).get("bot-a")).toHaveLength(OUTCOMES_PER_BOT);
  });
});

describe("orderedOutcomeRecords", () => {
  it("keeps the saved order, then orphans a routine still names", () => {
    const saved = [
      { id: "o1", name: "One", createdAt: 1, updatedAt: 1 },
      { id: "o2", name: "Two", createdAt: 2, updatedAt: 2 },
    ];
    expect(orderedOutcomeRecords(saved, [{ outcome: "o2" }, { outcome: "ghost" }, {}], 99)).toEqual([
      saved[0],
      saved[1],
      { id: "ghost", name: "ghost", createdAt: 99, updatedAt: 99 },
    ]);
  });
});
