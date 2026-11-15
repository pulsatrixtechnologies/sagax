import { describe, expect, it } from "vitest";

import { wholeToolList } from "./whole-tool-list.ts";

// #4394: one rule for the environment relay (#3623) and the connector gate
describe("wholeToolList", () => {
  it("is a whole list only with no next page", () => {
    expect(wholeToolList({ tools: [] })).toBe(true);
    expect(wholeToolList({ tools: [{ name: "read" }], nextCursor: null })).toBe(true);
    expect(wholeToolList({ tools: [{ name: "read" }], nextCursor: "" })).toBe(true);
    expect(wholeToolList({ tools: [{ name: "read" }], nextCursor: "2" })).toBe(false);
  });

  it("is never a list that is not one", () => {
    expect(wholeToolList(null)).toBe(false);
    expect(wholeToolList([])).toBe(false);
    expect(wholeToolList({})).toBe(false);
    expect(wholeToolList({ tools: "read" })).toBe(false);
  });
});
