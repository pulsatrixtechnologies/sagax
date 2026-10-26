import { describe, expect, it } from "vitest";
import { picksInAnswer, sheetIndexForKey, sheetKey } from "./QuestionSheet";

describe("picksInAnswer", () => {
  it("reads one pick, several picks, and an answer in words", () => {
    expect(picksInAnswer("Pro", ["Free", "Pro"])).toEqual({ picked: ["Pro"], rest: "" });
    expect(picksInAnswer("Lint, Tests", ["Lint", "Tests", "Build"])).toEqual({ picked: ["Lint", "Tests"], rest: "" });
    expect(picksInAnswer("Lint, only on main", ["Lint", "Tests"])).toEqual({ picked: ["Lint"], rest: "only on main" });
    expect(picksInAnswer("Enterprise", ["Free", "Pro"])).toEqual({ picked: [], rest: "Enterprise" });
  });

  it("matches a label that holds a comma as a whole", () => {
    expect(picksInAnswer("Yes, pause them", ["Yes, pause them", "Yes"])).toEqual({ picked: ["Yes, pause them"], rest: "" });
    expect(picksInAnswer("Yes, pause them, Tests", ["Yes, pause them", "Yes", "Tests"])).toEqual({ picked: ["Yes, pause them", "Tests"], rest: "" });
  });

  it("is empty for no answer", () => {
    expect(picksInAnswer("  ", ["A"])).toEqual({ picked: [], rest: "" });
  });
});

describe("sheet keys", () => {
  it("names rows A, B, C and maps plain letters back", () => {
    expect([0, 1, 25].map(sheetKey)).toEqual(["A", "B", "Z"]);
    expect(sheetIndexForKey("b", 3)).toBe(1);
    expect(sheetIndexForKey("d", 3)).toBe(-1);
    expect(sheetIndexForKey("Tab", 3)).toBe(-1);
  });
});
